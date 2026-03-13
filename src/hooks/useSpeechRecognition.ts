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

export type VoiceCommand = 'play' | 'pass' | 'challenge' | 'my_turn' | 'suggest' | 'your_turn' | null;

function matchCommand(transcript: string): VoiceCommand {
  const t = transcript.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // Match phrase as substring (transcript can have prior text, e.g. "helloyouryour turn")
  if (/(your|you\s*re|you|ur)\s*turn\b/.test(t)) return 'your_turn';
  if (/\bcapture\b/.test(t)) return 'your_turn';
  if (/\b(done|finished)\b/.test(t)) return 'your_turn';
  if (/\b(i\s*am\s*done|im\s*done)\b/.test(t)) return 'your_turn';
  if (/\btake\s*(?:a\s*)?(?:picture|photo)\b/.test(t)) return 'your_turn';
  if (/\bok(?:ay)?\s*capture\b/.test(t)) return 'your_turn';
  if (/\bplay\b/.test(t)) return 'play';
  if (/\bpass\b/.test(t) || /\bpause\b/.test(t)) return 'pass';
  if (/\bchallenge\b/.test(t)) return 'challenge';
  if (/\bmy\s*turn\b/.test(t)) return 'my_turn';
  if (/\bsuggest\b/.test(t) || /\bhint\b/.test(t)) return 'suggest';
  return null;
}

export function useSpeechRecognition(onCommand?: (cmd: VoiceCommand) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const activeRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  const lastCommandTimeRef = useRef(0);
  const transcriptAccumRef = useRef('');
  onCommandRef.current = onCommand;

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

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

    const doRestart = () => {
      if (restartScheduledRef.current || !activeRef.current) return;
      restartScheduledRef.current = true;
      const delay = isSafari ? 250 : 150;
      setTimeout(() => {
        restartScheduledRef.current = false;
        if (!activeRef.current) return;
        const next = createAndStartRecognitionRef.current();
        if (next) {
          recognitionRef.current = next;
          next.start();
        } else {
          setListening(false);
        }
      }, delay);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!activeRef.current) return;
      let chunk = '';
      let hadFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const t = (result[0].transcript || '').trim();
        chunk += t + ' ';
        if (result.isFinal) hadFinal = true;
        if (debugRef.current) console.log('[voice]', result.isFinal ? 'final' : 'interim', t ? JSON.stringify(t) : '(empty)');
      }
      transcriptAccumRef.current = (transcriptAccumRef.current + chunk).trim();
      if (transcriptAccumRef.current.length > 150) {
        transcriptAccumRef.current = transcriptAccumRef.current.slice(-150);
      }
      const toCheck = transcriptAccumRef.current;
      if (!toCheck) return;
      const cmd = matchCommand(toCheck);
      if (debugRef.current) console.log('[voice] check', JSON.stringify(toCheck), '→', cmd ?? 'no match');
      if (cmd) {
        const now = Date.now();
        if (now - lastCommandTimeRef.current < 2500) return;
        lastCommandTimeRef.current = now;
        transcriptAccumRef.current = '';
        if (debugRef.current) console.log('[voice] triggering', cmd);
        onCommandRef.current?.(cmd);
      }
      // iOS Safari: onresult stops firing after first phrase—restart here
      if (isSafari && hadFinal) doRestart();
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (debugRef.current) console.log('[voice] error', event.error);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(event.error);
      }
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
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      setError('Speech recognition not supported');
      return;
    }
    recognitionRef.current?.abort();
    setError(null);
    activeRef.current = true;
    transcriptAccumRef.current = '';
    if (debugRef.current) console.log('[voice] Debug ON – recognition starting. Speak to see transcripts.');

    const recognition = createAndStartRecognition();
    if (recognition) {
      recognitionRef.current = recognition;
      try {
        recognition.start();
        setListening(true);
      } catch (e) {
        setError('Could not start recognition');
        setListening(false);
      }
    }
  }, [createAndStartRecognition]);

  const stopListening = useCallback(() => {
    activeRef.current = false;
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

  return { listening, supported, error, startListening, stopListening };
}
