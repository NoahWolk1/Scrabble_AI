import { useEffect, useRef } from 'react';
import { useElevenLabsMic } from './useElevenLabsMic';

export function useGeminiVoice({
  enabled,
  buildGameState,
  onTranscript,
}: {
  enabled: boolean;
  buildGameState: () => unknown;
  onTranscript: (t: { text: string; confidence: 'high' | 'medium' | 'low' }) => void;
}) {
  const buildGameStateRef = useRef(buildGameState);
  buildGameStateRef.current = buildGameState;

  const { supported, listening, status, startListening, stopListening } = useElevenLabsMic({
    gameState: () => buildGameStateRef.current(),
    onTranscript: ({ text, confidence }) => {
      if (confidence === 'low') return;
      onTranscript({ text, confidence });
    },
  });

  useEffect(() => {
    if (enabled) {
      startListening();
    } else {
      stopListening();
    }
    return () => stopListening();
  }, [enabled, startListening, stopListening]);

  return { supported, active: listening, status, startListening, stopListening };
}
