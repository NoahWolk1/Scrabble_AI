import { useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface VoiceCaptureTriggerProps {
  onCapture: () => void;
  active: boolean;
}

/**
 * Listens for "your turn", "capture", or "done" and triggers capture.
 * Used on the Camera tab for hands-free capture.
 */
export function VoiceCaptureTrigger({ onCapture, active }: VoiceCaptureTriggerProps) {
  const { supported, startListening, stopListening } = useSpeechRecognition((cmd) => {
    if (cmd === 'your_turn') {
      console.log('"Your turn" heard');
      onCapture();
    }
  });

  useEffect(() => {
    if (active && supported) {
      startListening();
      return () => stopListening();
    }
  }, [active, supported, startListening, stopListening]);

  return null;
}
