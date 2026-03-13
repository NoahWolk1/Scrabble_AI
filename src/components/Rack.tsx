interface RackProps {
  letters: string[];
  selected?: number[];
  onTileClick?: (index: number) => void;
  label?: string;
}

export function Rack({ letters, selected = [], onTileClick, label }: RackProps) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</span>
      )}
      <div className="flex gap-1.5 flex-wrap justify-center">
        {letters.map((letter, i) => (
          <button
            key={`${letter}-${i}`}
            type="button"
            onClick={() => onTileClick?.(i)}
            className={`
              w-10 h-12 flex items-center justify-center text-xl font-bold
              bg-amber-50 dark:bg-amber-900/60 border-2 border-amber-600/70 rounded-lg
              text-stone-900 dark:text-white shadow-md
              transition-all duration-150
              ${selected.includes(i) ? 'ring-2 ring-amber-500 scale-105 shadow-lg' : ''}
              ${onTileClick ? 'cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-800/80 hover:shadow-lg' : 'cursor-default'}
            `}
          >
            {letter === ' ' ? '?' : letter}
          </button>
        ))}
      </div>
    </div>
  );
}
