/**
 * Fix board recognition errors using Gemini API.
 * Removes spurious letters and corrects OCR mistakes.
 */

import { boardRecLog, boardRecWarn } from './boardRecognitionLog';

const API_BASE = '/api/gemini';

export interface FixBoardResponse {
  status: 'OK' | 'ERROR';
  grid?: (string | null)[][];
  message?: string;
}

export async function fixBoardWithGemini(
  grid: (string | null)[][]
): Promise<(string | null)[][]> {
  boardRecLog('POST /api/gemini/fix-board');
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
    boardRecWarn('fix-board parse error', { httpStatus: res.status, snippet: text.slice(0, 80) });
    throw new Error(`Invalid response (${res.status}): ${text.slice(0, 100)}`);
  }

  if (data.status === 'OK' && Array.isArray(data.grid)) {
    boardRecLog('fix-board OK', { httpStatus: res.status });
    return data.grid;
  }

  boardRecWarn('fix-board ERROR', { httpStatus: res.status, message: data.message });
  throw new Error(data.message ?? `Fix failed: ${res.status}`);
}
