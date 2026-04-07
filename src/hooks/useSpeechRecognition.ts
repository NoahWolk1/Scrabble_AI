import { useState, useCallback, useEffect, useRef } from 'react';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

export type VoiceCommand = 'play' | 'pass' | 'challenge' | 'my_turn' | 'suggest' | 'your_turn' | 'recapture' | null;

const VOICE_LISTEN_PREFIX = '[voice-listening]';
const VOICE_TRANSCRIPT_PREFIX = '[voice-transcript]';

function voiceTranscriptLog(isFinal: boolean, result: SpeechRecognitionResult): void {
  const alternatives: string[] = [];
  for (let j = 0; j < result.length; j++) {
    alternatives.push((result[j]?.transcript ?? '').trim());
  }
  console.log(`${VOICE_TRANSCRIPT_PREFIX} ${isFinal ? 'final' : 'interim'}`, alternatives);
}

function voiceListenLog(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.log(`${VOICE_LISTEN_PREFIX} ${message}`, detail);
  } else {
    console.log(`${VOICE_LISTEN_PREFIX} ${message}`);
  }
}

/** Normalize transcript for matching: lowercase, collapse punctuation/spaces. */
function normalize(t: string): string {
  return t.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchCommand(transcript: string): VoiceCommand {
  const t = normalize(transcript);
  if (!t || t.length < 2) return null;

  // Recapture first (before any capture-related match)
  if (/\brecapture\b/.test(t) || /\bre\s*capture\b/.test(t)) return 'recapture';

  // Capture triggers – broad patterns to catch misrecognitions
  if (/(?:your|you['\u2019]?re|you|ur|year|yaw|yor)\s*turn\b/.test(t)) return 'your_turn';
  if (/\b(?:done|don|dun|finish|finished|finishing|did\s*it)\b/.test(t)) return 'your_turn';
  if (/\b(?:i\s*am\s*done|i\s*m\s*done|im\s*done|i'm\s*done)\b/.test(t)) return 'your_turn';
  if (/\b(?:go|lets\s*go|let['\u2019]s\s*go|okay\s*go|ok\s*go|alright\s*go)\b/.test(t)) return 'your_turn';
  if (/\b(?:ready|complete|submitted|submit|next|got\s*it)\b/.test(t)) return 'your_turn';
  if (/\btake\s*(?:a\s*)?(?:picture|photo|shot|pick)\b/.test(t)) return 'your_turn';
  if (/\b(?:ok(?:ay)?|yeah|yes|yep)\s*(?:go|done|finish)\b/.test(t)) return 'your_turn';
  if (/\b(?:capture|snap|shoot)\b/.test(t)) return 'your_turn'; // after recapture check
  if (/^(?:go|done)$/.test(t)) return 'your_turn'; // short confirmations

  if (/\bplay\b/.test(t)) return 'play';
  if (/\bpass\b/.test(t) || /\bpause\b/.test(t)) return 'pass';
  if (/\bchallenge\b/.test(t)) return 'challenge';
  if (/\bmy\s*turn\b/.test(t)) return 'my_turn';
  if (/\b(?:suggest|hint)\b/.test(t)) return 'suggest';
  return null;
}

export function useSpeechRecognition(onCommand?: (cmd: VoiceCommand) => void) {
  const [listening, setListening] = useState(false);
  const [hasReceivedSpeech, setHasReceivedSpeech] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const activeRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  const lastCommandTimeRef = useRef(0);
  const transcriptAccumRef = useRef('');
  const hasReceivedSpeechRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  onCommandRef.current = onCommand;

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  useEffect(() => {
    voiceListenLog(listening ? 'listening: ON' : 'listening: OFF');
  }, [listening]);

  const debugRef = useRef(false);
  debugRef.current = typeof window !== 'undefined' && (window.location.search.includes('debug=1') || localStorage.getItem('scrabble-voice-debug') === '1');

  const isSafari = typeof navigator !== 'undefined' && /Apple|Safari|iPhone|iPad|iPod/.test(navigator.userAgent);
  const restartScheduledRef = useRef(false);
  const createAndStartRecognitionRef = useRef<() => SpeechRecognition | null>(() => null);

  const createAndStartRecognition = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return null;
    const recognition = new SR();
    recognition.continuous = !isSafari; // iOS Safari: continuous often stops after first result
    recognition.interimResults = true;
    recognition.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US';
    (recognition as any).maxAlternatives = 3;

    const doRestart = () => {
      if (restartScheduledRef.current || !activeRef.current) return;
      restartScheduledRef.current = true;
      const delay = isSafari ? 250 : 150;
      setTimeout(() => {
        restartScheduledRef.current = false;
        if (!activeRef.current) return;
        const next = createAndStartRecognitionRef.current();
        if (next) {
          try {
            next.start();
            recognitionRef.current = next;
            consecutiveFailuresRef.current = 0;
          } catch {
            consecutiveFailuresRef.current += 1;
            recognitionRef.current = null;
            if (consecutiveFailuresRef.current >= 3) {
              setListening(false);
              setError('Could not start microphone');
            } else {
              doRestart();
            }
          }
        } else {
          setListening(false);
        }
      }, delay);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!activeRef.current) return;
      consecutiveFailuresRef.current = 0;
      hasReceivedSpeechRef.current = true;
      setHasReceivedSpeech(true);
      let chunk = '';
      let hadFinal = false;
      let lastResultWithAlts: SpeechRecognitionResult | null = null;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        voiceTranscriptLog(result.isFinal, result);
        const t = (result[0]?.transcript || '').trim();
        chunk += t + ' ';
        if (result.isFinal) hadFinal = true;
        if ((result.length ?? 0) > 1) lastResultWithAlts = result;
      }
      transcriptAccumRef.current = (transcriptAccumRef.current + chunk).trim();
      if (transcriptAccumRef.current.length > 200) {
        transcriptAccumRef.current = transcriptAccumRef.current.slice(-200);
      }
      const toCheck = transcriptAccumRef.current;
      let cmd: VoiceCommand | null = matchCommand(toCheck);
      if (!cmd && lastResultWithAlts) {
        for (let j = 1; j < (lastResultWithAlts.length ?? 1); j++) {
          const alt = (lastResultWithAlts[j]?.transcript || '').trim();
          if (alt && (cmd = matchCommand(alt))) break;
        }
      }
      if (!cmd && toCheck) cmd = matchCommand(toCheck.split(/\s+/).slice(-5).join(' '));
      if (debugRef.current) console.log('[voice] check', JSON.stringify(toCheck), '→', cmd ?? 'no match');
      if (cmd) {
        const now = Date.now();
        if (now - lastCommandTimeRef.current < 1500) return;
        lastCommandTimeRef.current = now;
        transcriptAccumRef.current = '';
        if (debugRef.current) console.log('[voice] triggering', cmd);
        onCommandRef.current?.(cmd);
      }
      if (isSafari && hadFinal) doRestart();
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      voiceListenLog('recognition error', event.error);
      if (debugRef.current) console.log('[voice] error', event.error);
      if (event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setListening(false);
        setError('Microphone access denied');
        return;
      }
      if (event.error !== 'no-speech') setError(event.error);
      if (activeRef.current) doRestart();
    };

    recognition.onend = () => {
      if (!activeRef.current) return;
      if (debugRef.current) console.log('[voice] onend – restarting…');
      recognitionRef.current = null;
      doRestart();
    };

    return recognition;
  }, [isSafari]);

  createAndStartRecognitionRef.current = createAndStartRecognition;

  const startListening = useCallback(() => {
    voiceListenLog('startListening() called');
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      voiceListenLog('not supported (no SpeechRecognition API)');
      setError('Speech recognition not supported');
      return;
    }
    recognitionRef.current?.abort();
    setError(null);
    setHasReceivedSpeech(false);
    hasReceivedSpeechRef.current = false;
    consecutiveFailuresRef.current = 0;
    activeRef.current = true;
    transcriptAccumRef.current = '';
    if (debugRef.current) console.log('[voice] Debug ON – recognition starting. Speak to see transcripts.');

    const recognition = createAndStartRecognition();
    if (recognition) {
      recognitionRef.current = recognition;
      try {
        recognition.start();
        setListening(true);
        voiceListenLog('recognition.start() OK', { lang: recognition.lang, continuous: recognition.continuous });
      } catch (e) {
        voiceListenLog('recognition.start() failed', e);
        setError('Could not start recognition');
        setListening(false);
      }
    } else {
      voiceListenLog('createAndStartRecognition() returned null');
    }
  }, [createAndStartRecognition]);

  const stopListening = useCallback(() => {
    voiceListenLog('stopListening() called');
    activeRef.current = false;
    setHasReceivedSpeech(false);
    hasReceivedSpeechRef.current = false;
    transcriptAccumRef.current = '';
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        // Safari bug: mic keeps listening after stop—call start() before stop() to fix
        if (typeof navigator !== 'undefined' && /Apple|Safari|iPhone|iPad|iPod/.test(navigator.userAgent)) {
          try {
            rec.start();
          } catch {
            // Ignore
          }
        }
        rec.abort();
      } catch {
        // Ignore
      }
    }
    setListening(false);
  }, []);

  // Watchdog: if we should be listening but recognition died, restart
  useEffect(() => {
    if (!supported) return;
    const id = setInterval(() => {
      if (activeRef.current && !recognitionRef.current && !restartScheduledRef.current) {
        voiceListenLog('watchdog: recognition died while active — restarting');
        if (debugRef.current) console.log('[voice] watchdog – restarting');
        restartScheduledRef.current = true;
        const delay = isSafari ? 250 : 150;
        setTimeout(() => {
          restartScheduledRef.current = false;
          if (!activeRef.current) return;
          const next = createAndStartRecognitionRef.current();
          if (next) {
            try {
              next.start();
              recognitionRef.current = next;
              consecutiveFailuresRef.current = 0;
              setListening(true);
            } catch {
              recognitionRef.current = null;
              consecutiveFailuresRef.current += 1;
              if (consecutiveFailuresRef.current >= 3) {
                setListening(false);
                setError('Microphone unavailable');
              }
            }
          }
        }, delay);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [supported, isSafari]);

  return { listening, supported, error, hasReceivedSpeech, startListening, stopListening };
}
