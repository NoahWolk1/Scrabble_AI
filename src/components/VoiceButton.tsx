import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface VoiceButtonProps {
  onCommand: (cmd: 'play' | 'pass' | 'suggest') => void;
  disabled?: boolean;
}

export function VoiceButton({ onCommand, disabled }: VoiceButtonProps) {
  const { listening, supported, error, startListening, stopListening } =
    useSpeechRecognition((cmd) => {
      if (cmd === 'play' || cmd === 'pass' || cmd === 'suggest') {
        onCommand(cmd);
      }
    });

  if (!supported) return null;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={listening ? stopListening : startListening}
        disabled={disabled}
        className={`py-3 px-4 rounded-xl font-medium min-h-[48px] touch-manipulation transition
          ${listening
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-stone-300 dark:bg-stone-600 hover:bg-stone-400 dark:hover:bg-stone-500'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {listening ? 'Stop listening' : 'Voice command'}
      </button>
      {error && <p className="text-red-500 text-xs">{error}</p>}
    </div>
  );
}
