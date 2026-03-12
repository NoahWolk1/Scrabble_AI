import { useState, useCallback, useEffect } from 'react';

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
  const t = transcript.toLowerCase();
  if (/\byour turn\b/.test(t) || /\bcapture\b/.test(t) || /\bdone\b/.test(t)) return 'your_turn';
  if (/\bplay\b/.test(t)) return 'play';
  if (/\bpass\b/.test(t) || /\bpause\b/.test(t)) return 'pass';
  if (/\bchallenge\b/.test(t)) return 'challenge';
  if (/\bmy turn\b/.test(t)) return 'my_turn';
  if (/\bsuggest\b/.test(t) || /\bhint\b/.test(t)) return 'suggest';
  return null;
}

export function useSpeechRecognition(onCommand?: (cmd: VoiceCommand) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      setError('Speech recognition not supported');
      return;
    }
    setError(null);
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript.trim();
      const cmd = matchCommand(transcript);
      if (cmd) onCommand?.(cmd);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'no-speech') {
        setError(event.error);
      }
    };

    recognition.onend = () => setListening(false);

    try {
      recognition.start();
      setListening(true);
    } catch (e) {
      setError('Could not start recognition');
    }
  }, [onCommand]);

  const stopListening = useCallback(() => {
    setListening(false);
  }, []);

  return { listening, supported, error, startListening, stopListening };
}
