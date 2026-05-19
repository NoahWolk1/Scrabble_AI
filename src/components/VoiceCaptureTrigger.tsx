import { useEffect, useRef } from 'react';
import { useElevenLabsMic } from '../hooks/useElevenLabsMic';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { matchVoiceCommand } from '../utils/voiceCommands';

interface VoiceCaptureTriggerProps {
  onCapture: () => void;
  onRecapture?: () => void;
  active: boolean;
  /** When true, user must tap a button to start listening (required for mobile mic permission) */
  requireTapToStart?: boolean;
  /** Optional: receive final recognized utterances (for chatbot / assistant). */
  onFinalTranscript?: (text: string) => void;
}

/**
 * Listens for "your turn", "recapture", "done", "finish", "go", and similar phrases.
 * Prefers ElevenLabs Scribe on devices where browser speech recognition is unreliable (e.g. iOS Safari).
 */
export function VoiceCaptureTrigger({
  onCapture,
  onRecapture,
  onFinalTranscript,
  active,
  requireTapToStart = true,
}: VoiceCaptureTriggerProps) {
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;
  const onRecaptureRef = useRef(onRecapture);
  onRecaptureRef.current = onRecapture;
  const onFinalTranscriptRef = useRef<VoiceCaptureTriggerProps['onFinalTranscript']>(undefined);
  onFinalTranscriptRef.current = onFinalTranscript;
  const lastCommandTimeRef = useRef(0);

  const handleTranscript = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onFinalTranscriptRef.current?.(trimmed);

    const cmd = matchVoiceCommand(trimmed);
    if (!cmd) return;
    const now = Date.now();
    if (now - lastCommandTimeRef.current < 1500) return;
    lastCommandTimeRef.current = now;
    if (cmd === 'your_turn') onCaptureRef.current();
    if (cmd === 'recapture') onRecaptureRef.current?.();
  };

  const elevenLabs = useElevenLabsMic({
    minBlobBytes: 1500,
    onTranscript: ({ text, confidence }) => {
      if (confidence === 'low') return;
      handleTranscript(text);
    },
  });

  const webSpeech = useSpeechRecognition(
    (cmd) => {
      if (cmd === 'your_turn') onCaptureRef.current();
      if (cmd === 'recapture') onRecaptureRef.current?.();
    },
    (text) => handleTranscript(text)
  );

  const useEleven = elevenLabs.supported;
  const { supported, listening, hasReceivedSpeech, startListening, stopListening } = useEleven
    ? elevenLabs
    : webSpeech;

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
