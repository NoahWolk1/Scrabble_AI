import { useEffect, useRef } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface VoiceCaptureTriggerProps {
  onCapture: () => void;
  onRecapture?: () => void;
  active: boolean;
  /** When true, user must tap a button to start listening (required for mobile mic permission) */
  requireTapToStart?: boolean;
}

/**
 * Listens for "your turn", "recapture", "done", "finish", "go", and similar phrases.
 * "your turn" / "done" / etc. trigger capture; "recapture" triggers recapture (undo + capture).
 */
export function VoiceCaptureTrigger({ onCapture, onRecapture, active, requireTapToStart = true }: VoiceCaptureTriggerProps) {
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;
  const onRecaptureRef = useRef(onRecapture);
  onRecaptureRef.current = onRecapture;

  const { supported, listening, hasReceivedSpeech, startListening, stopListening } = useSpeechRecognition((cmd) => {
    if (cmd === 'your_turn') onCaptureRef.current();
    if (cmd === 'recapture') onRecaptureRef.current?.();
  });

  useEffect(() => {
    if (active && supported && !requireTapToStart) {
      startListening();
    }
    if (!active) {
      stopListening();
    }
    return () => stopListening();
  }, [active, supported, requireTapToStart, startListening, stopListening]);

  if (!supported || !active) return null;

  if (requireTapToStart) {
    return (
      <button
        type="button"
        onClick={() => {
          if (navigator.vibrate) navigator.vibrate(30);
          listening ? stopListening() : startListening();
        }}
        className={`w-full py-3 px-4 rounded-xl font-semibold touch-manipulation transition-all ${
          !listening
            ? 'bg-stone-200 dark:bg-stone-600 hover:bg-stone-300 dark:hover:bg-stone-500 text-stone-800 dark:text-white border border-stone-300/50 dark:border-stone-500/50'
            : hasReceivedSpeech
            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
            : 'bg-amber-500 hover:bg-amber-600 text-white shadow-md'
        }`}
      >
        {!listening ? 'Listen' : hasReceivedSpeech ? 'Listening' : 'Listening…'}
      </button>
    );
  }

  return null;
}
