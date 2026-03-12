import { BOARD_SIZE } from './constants';
import { BoardState } from './BoardState';
import { calculateMoveScore } from './Scorer';
import type { Move, PlacedTile } from './types';
import type { Trie } from './Trie';

export function generateMoves(
  board: BoardState,
  rack: string[],
  trie: Trie,
  isFirstMove: boolean
): Move[] {
  const moves: Move[] = [];
  const words = trie.getWordsWithLetters(rack, 2);

  if (isFirstMove) {
    // First move must cross center (7,7)
    for (const word of words) {
      if (word.length > 15) continue;
      // Horizontal placements crossing (7,7)
      for (let col = Math.max(0, 7 - word.length + 1); col <= 7 && col + word.length <= BOARD_SIZE; col++) {
        const tiles = buildTilesForWord(word, 7, col, 'horizontal', board, rack);
        if (tiles && tiles.length > 0) {
          const score = calculateMoveScore(board, tiles, true);
          moves.push({ tiles, word, score, direction: 'horizontal', row: 7, col });
        }
      }
      // Vertical placements crossing (7,7)
      for (let row = Math.max(0, 7 - word.length + 1); row <= 7 && row + word.length <= BOARD_SIZE; row++) {
        const tiles = buildTilesForWord(word, row, 7, 'vertical', board, rack);
        if (tiles && tiles.length > 0) {
          const score = calculateMoveScore(board, tiles, true);
          moves.push({ tiles, word, score, direction: 'vertical', row, col: 7 });
        }
      }
    }
  } else {
    // Find all valid placements
    for (const word of words) {
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col <= BOARD_SIZE - word.length; col++) {
          const tiles = buildTilesForWord(word, row, col, 'horizontal', board, rack);
          if (tiles && tiles.length > 0 && validateMove(board, tiles, word, 'horizontal', trie)) {
            const score = calculateMoveScore(board, tiles, false);
            moves.push({ tiles, word, score, direction: 'horizontal', row, col });
          }
        }
      }
      for (let row = 0; row <= BOARD_SIZE - word.length; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          const tiles = buildTilesForWord(word, row, col, 'vertical', board, rack);
          if (tiles && tiles.length > 0 && validateMove(board, tiles, word, 'vertical', trie)) {
            const score = calculateMoveScore(board, tiles, false);
            moves.push({ tiles, word, score, direction: 'vertical', row, col });
          }
        }
      }
    }
  }

  return moves;
}

function buildTilesForWord(
  word: string,
  row: number,
  col: number,
  direction: 'horizontal' | 'vertical',
  board: BoardState,
  rack: string[]
): PlacedTile[] | null {
  const rackCount: Record<string, number> = {};
  for (const c of rack) {
    const k = c === ' ' ? ' ' : c.toUpperCase();
    rackCount[k] = (rackCount[k] ?? 0) + 1;
  }

  const tiles: PlacedTile[] = [];
  for (let i = 0; i < word.length; i++) {
    const r = direction === 'horizontal' ? row : row + i;
    const c = direction === 'horizontal' ? col + i : col;
    const existing = board.get(r, c);
    const letter = word[i].toUpperCase();

    if (existing) {
      if (existing !== letter) return null;
      continue;
    }

    if (rackCount[letter] && rackCount[letter] > 0) {
      rackCount[letter]--;
      tiles.push({ letter, row: r, col: c });
    } else if ((rackCount[' '] ?? 0) > 0) {
      rackCount[' ']--;
      tiles.push({ letter, row: r, col: c, isBlank: true });
    } else {
      return null;
    }
  }
  return tiles;
}

function validateMove(
  board: BoardState,
  tiles: PlacedTile[],
  mainWord: string,
  direction: 'horizontal' | 'vertical',
  trie: Trie
): boolean {
  if (!trie.has(mainWord)) return false;

  // Must be adjacent to or overlap existing tiles (for non-first-move)
  const hasAttachment = tiles.some(t => {
    const neighbors = [
      board.get(t.row - 1, t.col),
      board.get(t.row + 1, t.col),
      board.get(t.row, t.col - 1),
      board.get(t.row, t.col + 1),
    ];
    return neighbors.some(n => n !== null) || board.get(t.row, t.col) !== null;
  });
  if (!hasAttachment) return false;

  // Check cross words
  const crossWords = board.getCrossWords(tiles, direction);
  const uniqueCross = [...new Set(crossWords)];
  for (const cw of uniqueCross) {
    if (cw.length > 1 && !trie.has(cw)) return false;
  }
  return true;
}
