import { useCallback, useEffect, useRef, useState } from 'react';
import { uint8ArrayToBase64 } from '../utils/base64';

type TranscribeResponse =
  | { status: 'OK'; transcript: string; confidence: 'high' | 'medium' | 'low' }
  | { status: 'ERROR'; message: string; detail?: string };

/** Voice-activity polling interval (~12 Hz). */
const VAD_POLL_MS = 80;

const isAppleMobile =
  typeof navigator !== 'undefined' &&
  /iPhone|iPad|iPod/i.test(navigator.userAgent) &&
  !(window as unknown as { MSStream?: unknown }).MSStream;

function pickBestMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = isAppleMobile
    ? ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  const MR = MediaRecorder as typeof MediaRecorder & { isTypeSupported?: (mimeType: string) => boolean };
  for (const t of candidates) {
    if (MR.isTypeSupported?.(t)) return t;
  }
  return null;
}

export function useElevenLabsMic({
  onTranscript,
  minBlobBytes = 2000,
  gameState,
}: {
  onTranscript: (t: { text: string; confidence: 'high' | 'medium' | 'low' }) => void;
  minBlobBytes?: number;
  gameState?: () => unknown;
}) {
  const [supported] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
  );
  const [listening, setListening] = useState(false);
  const [hasReceivedSpeech, setHasReceivedSpeech] = useState(false);
  const [status, setStatus] = useState<string>('idle');

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const speakingRef = useRef(false);
  const speechStartRef = useRef<number>(0);
  const lastSpeechRef = useRef<number>(0);
  const lastSentAtRef = useRef<number>(0);
  const mimeTypeRef = useRef<string | null>(null);
  const loopRef = useRef<() => void>(() => {});
  const activeRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const gameStateRef = useRef(gameState);
  onTranscriptRef.current = onTranscript;
  gameStateRef.current = gameState;

  const stopAll = useCallback(() => {
    activeRef.current = false;
    setListening(false);
    setStatus('idle');
    setHasReceivedSpeech(false);
    speakingRef.current = false;
    chunksRef.current = [];
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        // ignore
      }
    }
    audioCtxRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
    }
    streamRef.current = null;
  }, []);

  const sendBlob = useCallback(
    async (blob: Blob) => {
      const now = Date.now();
      if (now - lastSentAtRef.current < 700) return;
      lastSentAtRef.current = now;

      setStatus('transcribing');
      const mimeType = blob.type || mimeTypeRef.current || 'audio/webm;codecs=opus';
      const buf = await blob.arrayBuffer();
      const b64 = uint8ArrayToBase64(new Uint8Array(buf));
      const gs = gameStateRef.current?.();

      const resp = await fetch('/api/elevenlabs/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: b64, mimeType, gameState: gs }),
      });
      const rawText = await resp.text();
      let data: TranscribeResponse;
      try {
        data = JSON.parse(rawText) as TranscribeResponse;
      } catch {
        console.error('[elevenlabs-client:transcribe] non-JSON', resp.status, rawText.slice(0, 500));
        if (activeRef.current) setStatus('listening');
        return;
      }
      if (!resp.ok || data.status !== 'OK') {
        console.error('[elevenlabs-client:transcribe] failed', {
          httpStatus: resp.status,
          message: data.status === 'ERROR' ? data.message : rawText.slice(0, 400),
        });
        if (activeRef.current) setStatus('listening');
        return;
      }
      const text = data.transcript.trim();
      if (text) onTranscriptRef.current({ text, confidence: data.confidence });
      if (activeRef.current) setStatus('listening');
    },
    []
  );

  const startSegmentRecorder = useCallback(() => {
    if (!streamRef.current) return;
    const mimeType = mimeTypeRef.current;
    chunksRef.current = [];
    try {
      recorderRef.current = mimeType
        ? new MediaRecorder(streamRef.current, { mimeType })
        : new MediaRecorder(streamRef.current);
    } catch {
      recorderRef.current = new MediaRecorder(streamRef.current);
    }
    recorderRef.current.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current.start();
  }, []);

  const stopAndFlushRecorder = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return;
    await new Promise<void>((resolve) => {
      const onStop = () => resolve();
      rec.addEventListener('stop', onStop, { once: true });
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || undefined });
    chunksRef.current = [];
    recorderRef.current = null;
    if (blob.size < minBlobBytes) return;
    await sendBlob(blob);
  }, [minBlobBytes, sendBlob]);

  const loop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || !activeRef.current) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);

    const now = performance.now();
    const SPEECH_ON = isAppleMobile ? 0.025 : 0.03;
    const SPEECH_OFF_MS = 700;
    const MIN_SPEECH_MS = 450;
    const MAX_SEGMENT_MS = 8000;

    if (!speakingRef.current) {
      if (rms > SPEECH_ON) {
        speakingRef.current = true;
        speechStartRef.current = now;
        lastSpeechRef.current = now;
        setHasReceivedSpeech(true);
        startSegmentRecorder();
        setStatus('listening');
      }
    } else {
      if (rms > SPEECH_ON) lastSpeechRef.current = now;
      const sinceSpeech = now - lastSpeechRef.current;
      const dur = now - speechStartRef.current;
      if (dur > MAX_SEGMENT_MS || (sinceSpeech > SPEECH_OFF_MS && dur > MIN_SPEECH_MS)) {
        speakingRef.current = false;
        void stopAndFlushRecorder();
      }
    }

    pollTimerRef.current = window.setTimeout(() => loopRef.current(), VAD_POLL_MS);
  }, [startSegmentRecorder, stopAndFlushRecorder]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  const startListening = useCallback(() => {
    if (!supported || activeRef.current) return;

    stopAll();
    activeRef.current = true;
    setListening(true);
    setStatus('starting');
    setHasReceivedSpeech(false);
    mimeTypeRef.current = pickBestMimeType();

    // iOS Safari: getUserMedia must be requested in the same turn as the user tap.
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext | null = null;
    if (AC) {
      try {
        ctx = new AC();
        audioCtxRef.current = ctx;
        void ctx.resume();
      } catch {
        ctx = null;
      }
    }

    void (async () => {
      try {
        const stream = await streamPromise;
        if (!activeRef.current) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;

        if (!ctx) {
          if (!AC) throw new Error('AudioContext not supported');
          ctx = new AC();
          audioCtxRef.current = ctx;
        }
        if (ctx.state === 'suspended') await ctx.resume();

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyserRef.current = analyser;

        setStatus('listening');
        pollTimerRef.current = window.setTimeout(loop, VAD_POLL_MS);
      } catch (err) {
        console.error('[elevenlabs-mic] start failed', err);
        stopAll();
      }
    })();
  }, [loop, stopAll, supported]);

  const stopListening = useCallback(() => {
    stopAll();
  }, [stopAll]);

  useEffect(() => () => stopAll(), [stopAll]);

  return { supported, listening, hasReceivedSpeech, status, startListening, stopListening, stopAll };
}
