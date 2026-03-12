import { generateMoves } from '../game/MoveGenerator';
import { BoardState } from '../game/BoardState';
import type { Move } from '../game/types';
import type { Trie } from '../game/Trie';

// Tile values for leave evaluation - prefer keeping flexible tiles
const TILE_UTILITY: Record<string, number> = {
  ' ': 15, 'E': 8, 'A': 7, 'R': 6, 'I': 6, 'O': 6, 'T': 5, 'N': 5, 'S': 5, 'L': 5,
  'D': 4, 'U': 4, 'G': 3, 'B': 3, 'C': 3, 'M': 3, 'P': 3, 'F': 3, 'H': 3, 'V': 3,
  'W': 2, 'Y': 2, 'K': 2, 'J': 2, 'X': 1, 'Q': 1, 'Z': 1,
};

function evaluateLeave(letters: string[]): number {
  let score = 0;
  const vowels = new Set('AEIOU');
  let vowelCount = 0;
  for (const l of letters) {
    const letter = l === ' ' ? ' ' : l.toUpperCase();
    score += TILE_UTILITY[letter] ?? 5;
    if (vowels.has(letter)) vowelCount++;
  }
  // Penalize very vowel-heavy or consonant-heavy leaves
  if (vowelCount === 0 && letters.length >= 4) score -= 5;
  if (vowelCount >= letters.length - 1 && letters.length >= 4) score -= 5;
  return score;
}

function evaluateMove(move: Move, leave: string[]): number {
  let score = move.score;
  score += evaluateLeave(leave) * 0.5;
  return score;
}

export function getExpertMove(
  board: BoardState,
  rack: string[],
  trie: Trie,
  isFirstMove: boolean
): Move | null {
  const moves = generateMoves(board, rack, trie, isFirstMove);
  if (moves.length === 0) return null;

  let best: Move | null = null;
  let bestScore = -Infinity;

  for (const move of moves) {
    const rackCopy = [...rack];
    for (const t of move.tiles) {
      if (t.isBlank) {
        const i = rackCopy.indexOf(' ');
        if (i >= 0) rackCopy.splice(i, 1);
      } else {
        const i = rackCopy.indexOf(t.letter);
        if (i >= 0) rackCopy.splice(i, 1);
      }
    }
    const leaveScore = evaluateMove(move, rackCopy);
    if (leaveScore > bestScore) {
      bestScore = leaveScore;
      best = move;
    }
  }
  return best;
}
