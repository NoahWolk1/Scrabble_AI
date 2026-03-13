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
  const t = transcript.toLowerCase();
  if (/\b(your turn|capture|done|i'm done|i am done|finished)\b/.test(t)) return 'your_turn';
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
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const activeRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

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
    recognitionRef.current?.abort();
    setError(null);
    activeRef.current = true;
    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!activeRef.current) return;
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript.trim();
      if (!event.results[last].isFinal) return;
      const cmd = matchCommand(transcript);
      if (cmd) onCommandRef.current?.(cmd);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(event.error);
      }
    };

    recognition.onend = () => {
      setListening(false);
      if (activeRef.current) {
        try {
          recognition.start();
          setListening(true);
        } catch {
          // Ignore restart errors
        }
      }
    };

    try {
      recognition.start();
      setListening(true);
    } catch (e) {
      setError('Could not start recognition');
    }
  }, []);

  const stopListening = useCallback(() => {
    activeRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  return { listening, supported, error, startListening, stopListening };
}
