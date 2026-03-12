interface RackProps {
  letters: string[];
  selected?: number[];
  onTileClick?: (index: number) => void;
  label?: string;
}

export function Rack({ letters, selected = [], onTileClick, label }: RackProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</span>
      )}
      <div className="flex gap-1 flex-wrap justify-center">
        {letters.map((letter, i) => (
          <button
            key={`${letter}-${i}`}
            type="button"
            onClick={() => onTileClick?.(i)}
            className={`
              w-10 h-12 flex items-center justify-center text-xl font-bold
              bg-amber-100 dark:bg-amber-900 border-2 border-amber-700 rounded-lg
              text-gray-900 dark:text-white shadow
              ${selected.includes(i) ? 'ring-2 ring-blue-500 scale-105' : ''}
              ${onTileClick ? 'cursor-pointer hover:bg-amber-200' : 'cursor-default'}
            `}
          >
            {letter === ' ' ? '?' : letter}
          </button>
        ))}
      </div>
    </div>
  );
}
