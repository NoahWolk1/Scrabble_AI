import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { generateMoves } from '../game/MoveGenerator';
import {
  getMovesFromApi,
  boardToApiFormat,
  rackToApiFormat,
  parseScrabblecamMove,
} from '../cv/scrabblecamApi';

interface SuggestedMove {
  word: string;
  score: number;
  row: number;
  col: number;
  direction: string;
  tiles: { row: number; col: number; letter: string; isBlank?: boolean }[];
}

interface GameControlsProps {
  onError?: (message: string) => void;
}

export function GameControls({ onError }: GameControlsProps) {
  const {
    board,
    humanRack,
    trie,
    isFirstMove,
    currentPlayer,
    gameOver,
    playHumanMove,
    passHuman,
    status,
    validateMove,
  } = useGameStore();

  const [suggestions, setSuggestions] = useState<SuggestedMove[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const canPlay = currentPlayer === 'human' && !gameOver && trie;

  const handleSuggest = async () => {
    if (!trie || !canPlay) return;
    setSuggestLoading(true);
    setSuggestions([]);
    try {
      const boardStr = boardToApiFormat(board.toArray());
      const rackStr = rackToApiFormat(humanRack);
      const res = await getMovesFromApi(rackStr, boardStr);
      let valid: SuggestedMove[] = [];
      if (res.status === 'OK' && res.moves?.length > 0) {
        const boardArr = board.toArray();
        for (const moveStr of res.moves) {
          if (valid.length >= 5) break;
          const parsed = parseScrabblecamMove(moveStr, boardArr);
          if (!parsed || parsed.tiles.length === 0 || !validateMove(parsed.tiles)) continue;
          const dir = parsed.tiles[0].row === parsed.tiles[parsed.tiles.length - 1].row ? 'H' : 'V';
          valid.push({
            word: parsed.word,
            score: parsed.score,
            row: parsed.row,
            col: parsed.col,
            direction: dir,
            tiles: parsed.tiles,
          });
        }
      }
      if (valid.length === 0 && humanRack.length > 0) {
        const moves = generateMoves(board, humanRack, trie, isFirstMove);
        valid = moves
          .sort((a, b) => b.score - a.score)
          .filter((m) => validateMove(m.tiles))
          .slice(0, 5)
          .map((m) => ({
            word: m.word,
            score: m.score,
            row: m.row,
            col: m.col,
            direction: m.direction === 'horizontal' ? 'H' : 'V',
            tiles: m.tiles,
          }));
      }
      setSuggestions(valid);
    } catch (err) {
      console.warn('Scrabblecam suggest failed, using local:', err);
      if (humanRack.length > 0) {
        const moves = generateMoves(board, humanRack, trie, isFirstMove);
        const fallback = moves
          .sort((a, b) => b.score - a.score)
          .filter((m) => validateMove(m.tiles))
          .slice(0, 5)
          .map((m) => ({
            word: m.word,
            score: m.score,
            row: m.row,
            col: m.col,
            direction: m.direction === 'horizontal' ? 'H' : 'V',
            tiles: m.tiles,
          }));
        setSuggestions(fallback);
      }
    } finally {
      setSuggestLoading(false);
    }
  };

  const handlePlaySuggestion = (s: SuggestedMove) => {
    const result = playHumanMove(s.tiles);
    if (result.success) {
      setSuggestions([]);
    } else if (result.message && onError) {
      onError(result.message);
    }
  };

  const handlePass = () => {
    passHuman();
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white/60 dark:bg-stone-800/40 px-4 py-3 border border-stone-200/60 dark:border-stone-700/60">
      <p className="text-sm text-stone-600 dark:text-stone-400 min-h-[2rem]">{status}</p>

      {canPlay && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(30);
                handleSuggest();
              }}
              disabled={suggestLoading}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-semibold min-h-[48px] touch-manipulation shadow-md hover:shadow-lg transition-all"
            >
              {suggestLoading ? 'Loading...' : 'Suggest moves'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(30);
                handlePass();
              }}
              className="px-5 py-2.5 bg-stone-600 hover:bg-stone-700 text-white rounded-xl font-semibold min-h-[48px] touch-manipulation shadow-md hover:shadow-lg transition-all"
            >
              Pass
            </button>
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Top moves (tap to play)</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handlePlaySuggestion(s)}
                className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/40 hover:bg-amber-100 dark:hover:bg-amber-800/60 rounded-xl text-left transition-all border border-amber-200/60 dark:border-amber-800/40"
              >
                <span className="font-bold text-stone-900 dark:text-white">{s.word}</span>{' '}
                <span className="text-amber-700 dark:text-amber-400">({s.score} pts)</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
