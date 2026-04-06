import { BOARD_SIZE, PREMIUM_SQUARES } from '../game/constants';
import { BoardState } from '../game/BoardState';
import type { PlacedTile } from '../game/types';

interface BoardProps {
  board: BoardState;
  pendingTiles?: PlacedTile[];
  onCellClick?: (row: number, col: number) => void;
}

const SQUARE_COLORS: Record<string, string> = {
  normal: 'bg-amber-50/90 dark:bg-amber-900/25',
  double_letter: 'bg-sky-100 dark:bg-sky-900/40',
  triple_letter: 'bg-sky-200/80 dark:bg-sky-800/50',
  double_word: 'bg-rose-100 dark:bg-rose-900/40',
  triple_word: 'bg-rose-200/80 dark:bg-rose-800/50',
  center: 'bg-amber-100 dark:bg-amber-800/40',
};

const SQUARE_LABELS: Record<string, string> = {
  double_letter: '2L',
  triple_letter: '3L',
  double_word: '2W',
  triple_word: '3W',
  center: '★',
};

export function Board({ board, pendingTiles = [], onCellClick }: BoardProps) {
  const arr = board.toArray();

  return (
    <div className="inline-block p-2.5 bg-emerald-800 rounded-xl shadow-board border-2 border-emerald-900/50">
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
          const row = Math.floor(i / BOARD_SIZE);
          const col = i % BOARD_SIZE;
          const sqType = PREMIUM_SQUARES[`${row},${col}`] ?? 'normal';
          const letter = arr[row][col];
          const pending = pendingTiles.find(t => t.row === row && t.col === col);
          const raw = letter ?? pending?.letter ?? '';
          const display = raw === ' ' ? '?' : raw;
          const isPending = !!pending;
          const isBlankOnBoard = !isPending && !!letter && board.isBlankAt(row, col);

          return (
            <button
              key={i}
              type="button"
              onClick={() => onCellClick?.(row, col)}
              className={`
                w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-sm font-bold
                border border-amber-800/30 rounded-md transition-all duration-150
                ${SQUARE_COLORS[sqType]}
                ${display ? 'text-stone-900 dark:text-white shadow-sm' : 'text-stone-500 dark:text-stone-400'}
                ${onCellClick ? 'cursor-pointer hover:ring-2 hover:ring-amber-500/70 hover:ring-offset-0' : 'cursor-default'}
                ${isPending ? 'ring-2 ring-amber-500 ring-offset-0' : ''}
                ${isBlankOnBoard ? 'ring-2 ring-orange-500 ring-offset-0' : ''}
              `}
            >
              {SQUARE_LABELS[sqType] && !display ? (
                <span className="text-[9px] font-semibold opacity-80">{SQUARE_LABELS[sqType]}</span>
              ) : (
                display
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
