/**
 * Scrabblecam API client
 * Uses same-origin /api/scrabblecam proxy to avoid CORS.
 * @see https://scrabblecam.com/api
 */

// Relative URL - proxied in dev (Vite) and prod (Vercel serverless)
const API_BASE = '/api/scrabblecam';

export interface BoardResponse {
  status: 'OK' | 'ERROR';
  board: string | null;
  message?: string;
}

export interface RackResponse {
  status: 'OK' | 'ERROR';
  rack: string | null;
  message?: string;
}

export interface SolveResponse {
  status: 'OK' | 'ERROR';
  moves: string[];
  message?: string;
}

/** Scrabblecam move format: "row,column,tiles,letters,score,orientation" (H or V) */
export interface ParsedScrabblecamMove {
  row: number;
  col: number;
  word: string;
  score: number;
  tiles: { letter: string; row: number; col: number; isBlank?: boolean }[];
}

export function parseScrabblecamMove(
  moveStr: string,
  board: (string | null)[][]
): ParsedScrabblecamMove | null {
  const parts = moveStr.split(',');
  if (parts.length < 6) return null;
  const [rowStr, colStr, tilesStr, lettersStr, scoreStr, orient] = parts;
  const row = parseInt(rowStr, 10);
  const col = parseInt(colStr, 10);
  const score = parseInt(scoreStr, 10);
  const isVertical = orient === 'V';
  const letters = lettersStr;
  const tilesRaw = tilesStr;

  if (isNaN(row) || isNaN(col) || isNaN(score) || letters.length !== tilesRaw.length) return null;

  const tiles: { letter: string; row: number; col: number; isBlank?: boolean }[] = [];
  for (let i = 0; i < letters.length; i++) {
    const r = isVertical ? row + i : row;
    const c = isVertical ? col : col + i;
    const existing = board[r]?.[c];
    if (existing && existing !== ' ') continue;
    const letter = letters[i].toUpperCase();
    const isBlank = tilesRaw[i] === '?';
    tiles.push({ letter, row: r, col: c, isBlank });
  }
  return { row, col, word: letters, score, tiles };
}

/**
 * Recognize board state from image.
 * Returns 15×15 grid: comma-separated cells, rows separated by |. Empty = "", blank = ?
 */
export async function recognizeBoardFromImage(file: Blob): Promise<BoardResponse> {
  if (file.size === 0) {
    throw new Error('Image is empty. Please try capturing again.');
  }
  const formData = new FormData();
  const blob = file.type?.startsWith('image/') ? file : new Blob([file], { type: 'image/jpeg' });
  formData.append('file', blob, 'board.jpg');

  const res = await fetch(`${API_BASE}/process`, {
    method: 'POST',
    body: formData,
  });

  const data = (await res.json()) as BoardResponse;
  if (!res.ok) {
    const msg = data?.message ?? `Scrabblecam API error: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Recognize rack (player tiles) from image.
 * Returns comma-separated letters, blank = ?
 */
export async function recognizeRackFromImage(file: Blob): Promise<RackResponse> {
  if (file.size === 0) {
    throw new Error('Image is empty. Please try capturing again.');
  }
  const formData = new FormData();
  const blob = file.type?.startsWith('image/') ? file : new Blob([file], { type: 'image/jpeg' });
  formData.append('file', blob, 'rack.jpg');

  const res = await fetch(`${API_BASE}/process_rack`, {
    method: 'POST',
    body: formData,
  });

  const data = (await res.json()) as RackResponse;
  if (!res.ok) {
    const msg = data?.message ?? `Scrabblecam API error: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Get top move suggestions from Scrabblecam.
 * @param rackStr e.g. "L,E,T,?,E,R,S"
 * @param boardStr Board format from recognizeBoardFromImage
 * @param lang EN | EN_NWL | FR | IT
 */
export async function getMovesFromApi(
  rackStr: string,
  boardStr: string,
  lang = 'EN'
): Promise<SolveResponse> {
  const params = new URLSearchParams({
    lang,
    rack_str: rackStr,
    board_str: boardStr,
  });
  const res = await fetch(`${API_BASE}/solve?${params}`);

  if (!res.ok) {
    throw new Error(`Scrabblecam API error: ${res.status}`);
  }
  return res.json() as Promise<SolveResponse>;
}

/**
 * Parse Scrabblecam board string to 15×15 grid.
 * Format: "cell,cell,...|row2...". Empty = "" (between commas), blank = ?
 */
export function parseBoardString(boardStr: string): (string | null)[][] {
  const rows = boardStr.split('|');
  const grid: (string | null)[][] = [];

  for (const row of rows) {
    const cells = row.split(',');
    const parsed = cells.map((c) => {
      const s = c.trim();
      if (s === '') return null;
      if (s === '?') return ' ';
      if (s.length === 1 && /[A-Za-z]/.test(s)) return s.toUpperCase();
      return null;
    });
    grid.push(parsed);
  }
  return grid;
}

/**
 * Convert rack array to Scrabblecam format: "L,E,T,?,E,R,S"
 */
export function rackToApiFormat(rack: string[]): string {
  return rack.map((c) => (c === ' ' ? '?' : c)).join(',');
}

/**
 * Convert 15×15 board grid to Scrabblecam board string.
 */
export function boardToApiFormat(grid: (string | null)[][]): string {
  return grid
    .map((row) =>
      row.map((c) => (c === null ? '' : c === ' ' ? '?' : c)).join(',')
    )
    .join('|');
}
