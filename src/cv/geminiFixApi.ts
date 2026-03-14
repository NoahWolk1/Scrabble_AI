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
