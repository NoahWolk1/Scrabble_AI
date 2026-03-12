import { useEffect, useRef } from 'react';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface LetterPickerProps {
  onSelect: (letter: string | null) => void;
  onClose: () => void;
}

export function LetterPicker({ onSelect, onClose }: LetterPickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-xl bg-stone-200 dark:bg-stone-700 p-4 shadow-xl"
      role="dialog"
      aria-label="Edit square"
    >
      <p className="text-center text-sm text-stone-600 dark:text-stone-400 mb-3">
        Tap a letter or Clear
      </p>
      <div className="grid grid-cols-9 gap-1 mb-3">
        {LETTERS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onSelect(c)}
            className="w-8 h-9 flex items-center justify-center text-sm font-bold bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-800 rounded border border-amber-800/30"
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSelect(' ')}
          className="flex-1 py-2 text-sm font-medium bg-stone-300 dark:bg-stone-600 hover:bg-stone-400 dark:hover:bg-stone-500 rounded-lg"
        >
          Blank (?)
        </button>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="flex-1 py-2 text-sm font-medium bg-red-200 dark:bg-red-900/50 hover:bg-red-300 dark:hover:bg-red-800/50 rounded-lg"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
