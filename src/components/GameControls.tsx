import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { generateMoves } from '../game/MoveGenerator';
import { VoiceButton } from './VoiceButton';
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

export function GameControls() {
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
      if (res.status === 'OK' && res.moves?.length > 0) {
        const boardArr = board.toArray();
        const valid: SuggestedMove[] = [];
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
        setSuggestions(valid);
      } else if (humanRack.length > 0) {
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
    } else if (result.message) {
      alert(result.message);
    }
  };

  const handlePass = () => {
    passHuman();
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-600 dark:text-gray-400 min-h-[2rem]">{status}</p>

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
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition min-h-[48px] touch-manipulation"
            >
              {suggestLoading ? 'Loading...' : 'Suggest moves'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(30);
                handlePass();
              }}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition min-h-[48px] touch-manipulation"
            >
              Pass
            </button>
          </div>
          <VoiceButton
            onCommand={(cmd) => {
              if (cmd === 'suggest') handleSuggest();
              if (cmd === 'pass') handlePass();
              if (cmd === 'play' && suggestions.length > 0) handlePlaySuggestion(suggestions[0]);
            }}
            disabled={!canPlay}
          />
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Top moves (click to play):</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handlePlaySuggestion(s)}
                className="px-3 py-2 bg-amber-100 dark:bg-amber-900 hover:bg-amber-200 dark:hover:bg-amber-800 rounded-lg text-left transition"
              >
                <span className="font-bold">{s.word}</span>{' '}
                <span className="text-amber-700">({s.score} pts)</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
