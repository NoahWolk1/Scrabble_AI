import { useEffect, useRef } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface VoiceCaptureTriggerProps {
  onCapture: () => void;
  active: boolean;
  /** When true, user must tap a button to start listening (required for mobile mic permission) */
  requireTapToStart?: boolean;
}

/**
 * Listens for "your turn", "capture", or "done" and triggers capture.
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
        className={`w-full py-3 px-4 rounded-xl font-medium touch-manipulation ${
          listening
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-stone-300 dark:bg-stone-600 hover:bg-stone-400 dark:hover:bg-stone-500 text-stone-900 dark:text-white'
        }`}
      >
        {listening ? 'Listening' : 'Listen'}
      </button>
    );
  }

  return null;
}
