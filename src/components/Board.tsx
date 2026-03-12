import { BOARD_SIZE, PREMIUM_SQUARES } from '../game/constants';
import { BoardState } from '../game/BoardState';
import type { PlacedTile } from '../game/types';

interface BoardProps {
  board: BoardState;
  pendingTiles?: PlacedTile[];
  onCellClick?: (row: number, col: number) => void;
}

const SQUARE_COLORS: Record<string, string> = {
  normal: 'bg-amber-100 dark:bg-amber-900/30',
  double_letter: 'bg-sky-200 dark:bg-sky-800/50',
  triple_letter: 'bg-sky-300 dark:bg-sky-700/50',
  double_word: 'bg-rose-200 dark:bg-rose-800/50',
  triple_word: 'bg-rose-300 dark:bg-rose-700/50',
  center: 'bg-amber-200 dark:bg-amber-800/50',
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
    <div className="inline-block p-2 bg-green-800 rounded-lg shadow-lg">
      <div
        className="grid gap-0.5"
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

          return (
            <button
              key={i}
              type="button"
              onClick={() => onCellClick?.(row, col)}
              className={`
                w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-sm font-bold
                border border-amber-800/50 rounded
                ${SQUARE_COLORS[sqType]}
                ${display ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}
                ${onCellClick ? 'cursor-pointer hover:ring-2 hover:ring-amber-500' : 'cursor-default'}
                ${isPending ? 'ring-2 ring-blue-500' : ''}
              `}
            >
              {SQUARE_LABELS[sqType] && !display ? (
                <span className="text-[10px]">{SQUARE_LABELS[sqType]}</span>
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
