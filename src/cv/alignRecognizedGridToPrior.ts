import { BOARD_SIZE } from '../game/constants';

const MAX_SHIFT = 3;

/** Need enough anchors; one tile makes shift ambiguous. */
const MIN_PRIOR_TILES_FOR_SHIFT = 2;

function lettersMatch(
  priorCell: string | null | undefined,
  guessCell: string | null | undefined
): boolean {
  if (priorCell === null || priorCell === undefined || priorCell === '') return false;
  const p = priorCell === ' ' ? ' ' : String(priorCell).toUpperCase();
  if (guessCell === null || guessCell === undefined || guessCell === '') return false;
  const g = guessCell === ' ' ? ' ' : String(guessCell).toUpperCase();
  return p === g;
}

function countPriorAnchors(prior: (string | null)[][]): number {
  let n = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (prior[r]?.[c]) n++;
    }
  }
  return n;
}

/**
 * Interpret recognized[r][c] as raw[r+dr][c+dc] — corrects systematic row/column offset
 * when the model's grid is shifted vs our 0-based top-left indexing.
 */
function applyShift(
  raw: (string | null)[][],
  dr: number,
  dc: number
): (string | null)[][] {
  const out: (string | null)[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: (string | null)[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const rr = r + dr;
      const cc = c + dc;
      row.push(
        rr >= 0 && rr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE
          ? raw[rr]?.[cc] ?? null
          : null
      );
    }
    out.push(row);
  }
  return out;
}

function scoreAgainstPrior(
  prior: (string | null)[][],
  candidate: (string | null)[][]
): number {
  let score = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!prior[r]?.[c]) continue;
      if (lettersMatch(prior[r][c], candidate[r]?.[c])) score++;
    }
  }
  return score;
}

function transposeGrid(g: (string | null)[][]): (string | null)[][] {
  const out: (string | null)[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: (string | null)[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push(g[c]?.[r] ?? null);
    }
    out.push(row);
  }
  return out;
}

function shiftIsBetter(
  a: { dr: number; dc: number; score: number; transposed: boolean },
  b: { dr: number; dc: number; score: number; transposed: boolean }
): boolean {
  if (b.score > a.score) return true;
  if (b.score < a.score) return false;
  if (a.transposed !== b.transposed) return !b.transposed;
  const distA = Math.abs(a.dr) + Math.abs(a.dc);
  const distB = Math.abs(b.dr) + Math.abs(b.dc);
  if (distB !== distA) return distB < distA;
  if (b.dr !== a.dr) return b.dr < a.dr;
  return b.dc < a.dc;
}

type Best = { dr: number; dc: number; score: number; transposed: boolean };

function searchShifts(
  prior: (string | null)[][],
  raw: (string | null)[][],
  transposed: boolean
): Best {
  const base = transposed ? transposeGrid(raw) : raw;
  let best: Best = {
    dr: 0,
    dc: 0,
    score: scoreAgainstPrior(
      prior,
      transposed ? transposeGrid(base) : base
    ),
    transposed,
  };

  for (let dr = -MAX_SHIFT; dr <= MAX_SHIFT; dr++) {
    for (let dc = -MAX_SHIFT; dc <= MAX_SHIFT; dc++) {
      if (dr === 0 && dc === 0) continue;
      const shifted = applyShift(base, dr, dc);
      const candidate = transposed ? transposeGrid(shifted) : shifted;
      const score = scoreAgainstPrior(prior, candidate);
      if (shiftIsBetter(best, { dr, dc, score, transposed })) {
        best = { dr, dc, score, transposed };
      }
    }
  }

  return best;
}

function buildAlignedGrid(
  raw: (string | null)[][],
  best: Best
): (string | null)[][] {
  const base = best.transposed ? transposeGrid(raw) : raw;
  const shifted =
    best.dr === 0 && best.dc === 0 ? base : applyShift(base, best.dr, best.dc);
  return best.transposed ? transposeGrid(shifted) : shifted;
}

/**
 * When we already know the board from a prior capture, find shift (and optional transpose)
 * so recognized tiles line up with prior letters — fixes row/column drift or swapped axes.
 */
export function alignRecognizedGridToPrior(
  prior: (string | null)[][],
  raw: (string | null)[][]
): {
  grid: (string | null)[][];
  dr: number;
  dc: number;
  transposed: boolean;
  score: number;
  anchorCount: number;
  applied: boolean;
} {
  const anchorCount = countPriorAnchors(prior);
  if (anchorCount < MIN_PRIOR_TILES_FOR_SHIFT) {
    return {
      grid: raw,
      dr: 0,
      dc: 0,
      transposed: false,
      score: scoreAgainstPrior(prior, raw),
      anchorCount,
      applied: false,
    };
  }

  const plain = searchShifts(prior, raw, false);
  const flipped = searchShifts(prior, raw, true);

  let best: Best = plain;
  if (shiftIsBetter(plain, flipped)) {
    best = flipped;
  }

  const aligned = buildAlignedGrid(raw, best);
  const applied =
    best.dr !== 0 || best.dc !== 0 || best.transposed;

  return {
    grid: aligned,
    dr: best.dr,
    dc: best.dc,
    transposed: best.transposed,
    score: best.score,
    anchorCount,
    applied,
  };
}
