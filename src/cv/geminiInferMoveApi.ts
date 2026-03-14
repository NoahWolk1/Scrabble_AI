/**
 * Use Gemini API to infer the Scrabble move a player most likely played
 * from before/after board images and the player's rack.
 */

const API_BASE = '/api/gemini';

export interface InferMoveResponse {
  status: 'OK' | 'ERROR';
  tiles?: { row: number; col: number; letter: string; isBlank?: boolean }[];
  message?: string;
}

export async function inferMoveFromBoardImage(
  previousBoard: (string | null)[][],
  recognizedBoard: (string | null)[][],
  humanRack: string[]
): Promise<InferMoveResponse> {
  const res = await fetch(`${API_BASE}/infer-move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      previousBoard,
      recognizedBoard,
      humanRack,
    }),
  });

  const data = (await res.json()) as InferMoveResponse;

  if (!res.ok) {
    return {
      status: 'ERROR',
      message: data.message ?? `Request failed: ${res.status}`,
    };
  }

  return data;
}
