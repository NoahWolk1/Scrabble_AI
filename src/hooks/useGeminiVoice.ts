import { useCallback, useEffect, useRef, useState } from 'react';
import { uint8ArrayToBase64 } from '../utils/base64';

type TranscribeResponse =
  | { status: 'OK'; transcript: string; confidence: 'high' | 'medium' | 'low' }
  | {
      status: 'ERROR';
      message: string;
      detail?: string;
      geminiCode?: number;
      geminiStatus?: string;
    };

/** Voice-activity polling interval (~12 Hz). rAF at 60 Hz was heating phones. */
const VAD_POLL_MS = 80;

function pickBestMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const t of candidates) {
    if ((MediaRecorder as any).isTypeSupported?.(t)) return t;
  }
  return null;
}

export function useGeminiVoice({
  enabled,
  buildGameState,
  onTranscript,
}: {
  enabled: boolean;
  buildGameState: () => unknown;
  onTranscript: (t: { text: string; confidence: 'high' | 'medium' | 'low' }) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<string>('idle');

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** Timer for voice-activity polling (keep well below display refresh to save CPU/battery). */
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const speakingRef = useRef(false);
  const speechStartRef = useRef<number>(0);
  const lastSpeechRef = useRef<number>(0);
  const lastSentAtRef = useRef<number>(0);
  const mimeTypeRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  }, []);

  const stopAll = useCallback(() => {
    setActive(false);
    setStatus('idle');
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
        audioCtxRef.current.close();
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

  const sendBlobToGemini = useCallback(
    async (blob: Blob) => {
      const now = Date.now();
      if (now - lastSentAtRef.current < 700) return;
      lastSentAtRef.current = now;

      setStatus('transcribing');
      const mimeType = blob.type || mimeTypeRef.current || 'audio/webm;codecs=opus';
      const buf = await blob.arrayBuffer();
      const b64 = uint8ArrayToBase64(new Uint8Array(buf));
      const gameState = buildGameState();

      console.log('[gemini-client:transcribe] sending', {
        bytes: buf.byteLength,
        mimeType,
        b64Chars: b64.length,
      });

      const resp = await fetch('/api/gemini/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: b64, mimeType, gameState }),
      });
      const rawText = await resp.text();
      let data: TranscribeResponse;
      try {
        data = JSON.parse(rawText) as TranscribeResponse;
      } catch {
        console.error('[gemini-client:transcribe] non-JSON response', resp.status, rawText.slice(0, 500));
        setStatus('listening');
        return;
      }
      if (!resp.ok || data.status !== 'OK') {
        const err = data.status === 'ERROR' ? data : ({ message: rawText } as TranscribeResponse);
        console.error('[gemini-client:transcribe] failed', {
          httpStatus: resp.status,
          message: 'message' in err ? err.message : undefined,
          detail: 'detail' in err ? err.detail : undefined,
          geminiCode: 'geminiCode' in err ? err.geminiCode : undefined,
          bodyPreview: rawText.slice(0, 800),
        });
        setStatus('listening');
        return;
      }
      const text = data.transcript.trim();
      if (text) onTranscript({ text, confidence: data.confidence });
      setStatus('listening');
    },
    [buildGameState, onTranscript]
  );

  const startSegmentRecorder = useCallback(() => {
    if (!streamRef.current) return;
    const mimeType = mimeTypeRef.current;
    chunksRef.current = [];
    try {
      recorderRef.current = mimeType ? new MediaRecorder(streamRef.current, { mimeType }) : new MediaRecorder(streamRef.current);
    } catch {
      recorderRef.current = new MediaRecorder(streamRef.current);
    }
    const rec = recorderRef.current;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.start();
  }, []);

  const stopAndFlushRecorder = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'inactive') return;
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
    // Avoid sending tiny blobs (accidental clicks/noise)
    if (blob.size < 4000) return;
    await sendBlobToGemini(blob);
  }, [sendBlobToGemini]);

  const loop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);

    const now = performance.now();
    const SPEECH_ON = 0.03; // tuned for mobile; adjust if too sensitive
    const SPEECH_OFF_MS = 700;
    const MIN_SPEECH_MS = 500;
    const MAX_SEGMENT_MS = 8000;

    if (!speakingRef.current) {
      if (rms > SPEECH_ON) {
        speakingRef.current = true;
        speechStartRef.current = now;
        lastSpeechRef.current = now;
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

    pollTimerRef.current = window.setTimeout(loop, VAD_POLL_MS);
  }, [startSegmentRecorder, stopAndFlushRecorder]);

  const start = useCallback(async () => {
    if (!supported) return;
    stopAll();
    setActive(true);
    setStatus('starting');
    mimeTypeRef.current = pickBestMimeType();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    analyserRef.current = analyser;

    setStatus('listening');
    pollTimerRef.current = window.setTimeout(loop, VAD_POLL_MS);
  }, [loop, stopAll, supported]);

  useEffect(() => {
    if (!enabled) {
      stopAll();
      return;
    }
    void start();
    return () => stopAll();
  }, [enabled, start, stopAll]);

  return { supported, active, status, stop: stopAll };
}

