import { generateMoves } from '../game/MoveGenerator';
import { BoardState } from '../game/BoardState';
import type { Move } from '../game/types';
import type { Trie } from '../game/Trie';

export function getBestMove(
  board: BoardState,
  rack: string[],
  trie: Trie,
  isFirstMove: boolean
): Move | null {
  const moves = generateMoves(board, rack, trie, isFirstMove);
  if (moves.length === 0) return null;
  return moves.reduce((best, m) => (m.score > best.score ? m : best));
}
