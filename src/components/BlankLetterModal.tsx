import { useEffect, useState } from 'react';

function key(r: number, c: number) {
  return `${r},${c}`;
}

interface BlankLetterModalProps {
  pending: { row: number; col: number }[];
  onConfirm: (lettersByKey: Record<string, string>) => void;
  onCancel: () => void;
}

export function BlankLetterModal({ pending, onConfirm, onCancel }: BlankLetterModalProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const p of pending) {
      next[key(p.row, p.col)] = '';
    }
    setValues(next);
  }, [pending]);

  const allFilled = pending.every((p) => /^[A-Z]$/i.test(values[key(p.row, p.col)] ?? ''));

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal
      aria-labelledby="blank-letter-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-600 shadow-2xl p-5">
        <h2 id="blank-letter-title" className="text-lg font-semibold text-stone-800 dark:text-stone-100 mb-1">
          Blank tile letter
        </h2>
        <p className="text-sm text-stone-600 dark:text-stone-400 mb-4">
          The camera read a blank as an empty tile. Choose the letter each blank represents (A–Z).
        </p>
        <div className="space-y-3 mb-5 max-h-[50vh] overflow-y-auto">
          {pending.map((p) => {
            const k = key(p.row, p.col);
            return (
              <label key={k} className="flex items-center gap-3 text-sm">
                <span className="text-stone-600 dark:text-stone-400 w-28 shrink-0">
                  Row {p.row + 1}, col {p.col + 1}
                </span>
                <input
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  maxLength={1}
                  value={values[k] ?? ''}
                  onChange={(e) => {
                    const ch = e.target.value.replace(/[^A-Za-z]/g, '').slice(-1).toUpperCase();
                    setValues((prev) => ({ ...prev, [k]: ch }));
                  }}
                  className="flex-1 min-w-0 rounded-xl border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 px-3 py-2 text-center text-lg font-bold tracking-widest text-stone-900 dark:text-stone-100"
                  placeholder="?"
                />
              </label>
            );
          })}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm font-medium bg-stone-200 dark:bg-stone-600 hover:bg-stone-300 dark:hover:bg-stone-500 text-stone-800 dark:text-stone-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!allFilled}
            onClick={() => {
              const out: Record<string, string> = {};
              for (const p of pending) {
                const k = key(p.row, p.col);
                out[k] = (values[k] ?? '').toUpperCase();
              }
              onConfirm(out);
            }}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none text-white"
          >
            Apply move
          </button>
        </div>
      </div>
    </div>
  );
}
