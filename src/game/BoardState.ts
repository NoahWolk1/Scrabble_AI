import { BOARD_SIZE, PREMIUM_SQUARES, TILE_DISTRIBUTION } from './constants';
import type { SquareType } from './constants';
import type { PlacedTile } from './types';

export class BoardState {
  private board: (string | null)[][];

  constructor(existing?: (string | null)[][]) {
    this.board = existing
      ? existing.map(row => [...row])
      : Array(BOARD_SIZE)
          .fill(null)
          .map(() => Array(BOARD_SIZE).fill(null));
  }

  get(r: number, c: number): string | null {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
    return this.board[r][c];
  }

  set(r: number, c: number, letter: string): void {
    if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
      this.board[r][c] = letter.toUpperCase();
    }
  }

  setCell(r: number, c: number, letter: string | null): BoardState {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return this;
    const next = this.board.map((row, ri) =>
      row.map((cell, ci) =>
        ri === r && ci === c ? (letter ? letter.toUpperCase() : null) : cell
      )
    );
    return new BoardState(next);
  }

  clone(): BoardState {
    return new BoardState(this.board);
  }

  toArray(): (string | null)[][] {
    return this.board.map(row => [...row]);
  }

  static getSquareType(row: number, col: number): SquareType {
    return PREMIUM_SQUARES[`${row},${col}`] ?? 'normal';
  }

  // Get the main word formed when placing tiles (horizontal or vertical)
  getMainWord(tiles: PlacedTile[]): { word: string; row: number; col: number; direction: 'horizontal' | 'vertical' } | null {
    if (tiles.length === 0) return null;

    const minRow = Math.min(...tiles.map(t => t.row));
    const maxRow = Math.max(...tiles.map(t => t.row));
    const minCol = Math.min(...tiles.map(t => t.col));
    const maxCol = Math.max(...tiles.map(t => t.col));

    const isHorizontal = maxRow - minRow === 0;
    const isVertical = maxCol - minCol === 0;
    if (!isHorizontal && !isVertical) return null;

    if (isHorizontal) {
      let startCol = minCol;
      while (startCol > 0 && this.get(minRow, startCol - 1)) startCol--;
      let endCol = maxCol;
      while (endCol < BOARD_SIZE - 1 && this.get(minRow, endCol + 1)) endCol++;
      let word = '';
      for (let c = startCol; c <= endCol; c++) {
        const t = tiles.find(t => t.row === minRow && t.col === c);
        word += t ? t.letter : (this.get(minRow, c) ?? '');
      }
      return { word, row: minRow, col: startCol, direction: 'horizontal' };
    } else {
      let startRow = minRow;
      while (startRow > 0 && this.get(startRow - 1, minCol)) startRow--;
      let endRow = maxRow;
      while (endRow < BOARD_SIZE - 1 && this.get(endRow + 1, minCol)) endRow++;
      let word = '';
      for (let r = startRow; r <= endRow; r++) {
        const t = tiles.find(t => t.row === r && t.col === minCol);
        word += t ? t.letter : (this.get(r, minCol) ?? '');
      }
      return { word, row: startRow, col: minCol, direction: 'vertical' };
    }
  }

  // Get all cross words (perpendicular to main word)
  getCrossWords(tiles: PlacedTile[], mainDirection: 'horizontal' | 'vertical'): string[] {
    const words: string[] = [];
    for (const t of tiles) {
      const crossDir = mainDirection === 'horizontal' ? 'vertical' : 'horizontal';
      if (crossDir === 'vertical') {
        let start = t.row;
        while (start > 0 && (this.get(start - 1, t.col) || tiles.some(x => x.row === start - 1 && x.col === t.col))) start--;
        let end = t.row;
        while (end < BOARD_SIZE - 1 && (this.get(end + 1, t.col) || tiles.some(x => x.row === end + 1 && x.col === t.col))) end++;
        if (end > start) {
          let w = '';
          for (let r = start; r <= end; r++) {
            const pt = tiles.find(x => x.row === r && x.col === t.col);
            w += pt ? pt.letter : (this.get(r, t.col) ?? '');
          }
          if (w.length > 1) words.push(w);
        }
      } else {
        let start = t.col;
        while (start > 0 && (this.get(t.row, start - 1) || tiles.some(x => x.row === t.row && x.col === start - 1))) start--;
        let end = t.col;
        while (end < BOARD_SIZE - 1 && (this.get(t.row, end + 1) || tiles.some(x => x.row === t.row && x.col === end + 1))) end++;
        if (end > start) {
          let w = '';
          for (let c = start; c <= end; c++) {
            const pt = tiles.find(x => x.row === t.row && x.col === c);
            w += pt ? pt.letter : (this.get(t.row, c) ?? '');
          }
          if (w.length > 1) words.push(w);
        }
      }
    }
    return words;
  }

  isEmpty(): boolean {
    return this.board.every(row => row.every(cell => !cell));
  }
}

// Create initial tile bag
export function createTileBag(): string[] {
  const bag: string[] = [];
  for (const [letter, count] of Object.entries(TILE_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      bag.push(letter);
    }
  }
  // Fisher-Yates shuffle
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

// Draw tiles from bag
export function drawTiles(bag: string[], count: number): { drawn: string[]; remaining: string[] } {
  const drawn: string[] = [];
  const remaining = [...bag];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const idx = Math.floor(Math.random() * remaining.length);
    drawn.push(remaining.splice(idx, 1)[0]);
  }
  return { drawn, remaining };
}
