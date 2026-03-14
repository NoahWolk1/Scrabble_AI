/**
 * Fix board recognition errors using Gemini API.
 * Removes spurious letters and corrects OCR mistakes.
 */

const API_BASE = '/api/gemini';

export interface FixBoardResponse {
  status: 'OK' | 'ERROR';
  grid?: (string | null)[][];
  message?: string;
}

export async function fixBoardWithGemini(
  grid: (string | null)[][]
): Promise<(string | null)[][]> {
  const res = await fetch(`${API_BASE}/fix-board`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grid }),
  });

  const text = await res.text();
  let data: FixBoardResponse;
  try {
    data = JSON.parse(text) as FixBoardResponse;
  } catch {
    throw new Error(`Invalid response (${res.status}): ${text.slice(0, 100)}`);
  }

  if (data.status === 'OK' && Array.isArray(data.grid)) {
    return data.grid;
  }

  throw new Error(data.message ?? `Fix failed: ${res.status}`);
}

export interface InferredTile {
  letter: string;
  row: number;
  col: number;
  isBlank?: boolean;
}

export interface InferMoveResponse {
  status: 'OK' | 'ERROR';
  tiles?: InferredTile[];
  message?: string;
}

/**
 * Infer the most likely legal Scrabble move from board recognition.
 * Handles OCR errors (wrong letters, extra tiles) by asking Gemini to pick the best fit.
 */
export async function inferMoveFromBoard(
  board: (string | null)[][],
  rack: string[],
  newTiles: { letter: string; row: number; col: number }[]
): Promise<InferredTile[]> {
  const res = await fetch(`${API_BASE}/infer-move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board, rack, newTiles }),
  });

  const text = await res.text();
  let data: InferMoveResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid response: ${text.slice(0, 100)}`);
  }

  if (data.status === 'OK' && Array.isArray(data.tiles)) {
    return data.tiles;
  }

  throw new Error(data.message ?? 'Could not infer move');
}
