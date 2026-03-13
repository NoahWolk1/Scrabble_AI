import { useEffect, useRef } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface VoiceCaptureTriggerProps {
  onCapture: () => void;
  active: boolean;
  /** When true, user must tap a button to start listening (required for mobile mic permission) */
  requireTapToStart?: boolean;
}

/**
 * Listens for "your turn", "capture", "done", "finish", "go", and similar phrases—triggers capture.
 * Used on the Camera tab for hands-free capture.
 */
export function VoiceCaptureTrigger({ onCapture, active, requireTapToStart = true }: VoiceCaptureTriggerProps) {
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  const { supported, listening, startListening, stopListening } = useSpeechRecognition((cmd) => {
    if (cmd === 'your_turn') {
      onCaptureRef.current();
    }
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
          listening
            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
            : 'bg-stone-200 dark:bg-stone-600 hover:bg-stone-300 dark:hover:bg-stone-500 text-stone-800 dark:text-white border border-stone-300/50 dark:border-stone-500/50'
        }`}
      >
        {listening ? 'Listening' : 'Listen'}
      </button>
    );
  }

  return null;
}
