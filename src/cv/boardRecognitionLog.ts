/** Prefix for filtering DevTools console (e.g. filter: board-recognition). */
const PREFIX = '[board-recognition]';

export function boardRecLog(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.log(`${PREFIX} ${message}`, detail);
  } else {
    console.log(`${PREFIX} ${message}`);
  }
}

export function boardRecWarn(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.warn(`${PREFIX} ${message}`, detail);
  } else {
    console.warn(`${PREFIX} ${message}`);
  }
}

export function countFilledCells(grid: (string | null)[][]): number {
  let n = 0;
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (grid[r]?.[c]) n++;
    }
  }
  return n;
}

/** Cells empty in prior but with a letter after recognition (candidate new plays). */
export function listNewVsPrior(
  prior: (string | null)[][],
  grid: (string | null)[][]
): string[] {
  const out: string[] = [];
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const p = prior[r]?.[c];
      const g = grid[r]?.[c];
      if (!p && g) out.push(`r${r}c${c}=${g}`);
    }
  }
  return out;
}
