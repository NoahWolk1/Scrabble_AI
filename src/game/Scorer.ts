import { TILE_VALUES, BINGO_BONUS } from './constants';
import { BoardState } from './BoardState';
import type { PlacedTile } from './types';

function getSquareMultipliers(row: number, col: number): { letterMult: number; wordMult: number } {
  const sq = BoardState.getSquareType(row, col);
  let letterMult = 1;
  let wordMult = 1;
  if (sq === 'double_letter') letterMult = 2;
  if (sq === 'triple_letter') letterMult = 3;
  if (sq === 'double_word' || sq === 'center') wordMult = 2;
  if (sq === 'triple_word') wordMult = 3;
  return { letterMult, wordMult };
}

export function calculateMoveScore(
  board: BoardState,
  tiles: PlacedTile[],
  _isFirstMove: boolean
): number {
  if (tiles.length === 0) return 0;

  const mainWord = board.getMainWord(tiles);
  if (!mainWord) return 0;

  const { word, row, col, direction } = mainWord;
  let mainScore = 0;
  let wordMultiplier = 1;

  for (let i = 0; i < word.length; i++) {
    const r = direction === 'horizontal' ? row : row + i;
    const c = direction === 'horizontal' ? col + i : col;
    const placedTile = tiles.find(t => t.row === r && t.col === c);
    const isNewTile = !!placedTile;
    const isBlank = placedTile?.isBlank ?? false;
    const letterVal = isBlank ? 0 : (TILE_VALUES[word[i]] ?? 0);
    const { letterMult, wordMult } = getSquareMultipliers(r, c);

    mainScore += letterVal * (isNewTile ? letterMult : 1);
    if (isNewTile) wordMultiplier *= wordMult;
  }
  mainScore *= wordMultiplier;

  // Cross words - score each word formed perpendicular to main word
  const crossWords = board.getCrossWords(tiles, direction);
  const seen = new Set<string>();
  for (const cw of crossWords) {
    if (cw.length < 2 || seen.has(cw)) continue;
    seen.add(cw);
    const crossTile = tiles.find(t => cw.includes(t.letter));
    if (crossTile) {
      const { wordMult } = getSquareMultipliers(crossTile.row, crossTile.col);
      let cwScore = 0;
      for (const ch of cw) {
        cwScore += (crossTile.isBlank && ch === crossTile.letter ? 0 : (TILE_VALUES[ch] ?? 0));
      }
      mainScore += cwScore * wordMult;
    }
  }

  if (tiles.length === 7) mainScore += BINGO_BONUS;
  return mainScore;
}
