/**
 * Recognize Scrabble board from image using Gemini Vision.
 * Used when a prior board exists (diff-style read); empty boards use Scrabblecam in BoardRecognizer.
 */

import { boardRecLog } from './boardRecognitionLog';

const API_BASE = '/api/gemini';

export interface RecognizeBoardResponse {
  status: 'OK' | 'ERROR';
  grid?: (string | null)[][];
  message?: string;
}

export async function recognizeBoardWithGeminiVision(
  imageBlob: Blob,
  priorBoard?: (string | null)[][] | null
): Promise<(string | null)[][]> {
  const base64 = await blobToBase64(imageBlob);
  const mimeType = imageBlob.type || 'image/jpeg';

  const body: Record<string, unknown> = {
    image: base64.includes(',') ? base64.split(',')[1]! : base64,
    mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
  };
  if (
    priorBoard &&
    Array.isArray(priorBoard) &&
    priorBoard.length === 15
  ) {
    body.priorBoard = priorBoard;
  }

  boardRecLog('POST /api/gemini/recognize-board', {
    bytes: imageBlob.size,
    withPrior: !!body.priorBoard,
  });

  const res = await fetch(`${API_BASE}/recognize-board`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: RecognizeBoardResponse;
  try {
    data = JSON.parse(text) as RecognizeBoardResponse;
  } catch {
    throw new Error(`Invalid response (${res.status}): ${text.slice(0, 100)}`);
  }

  if (data.status === 'OK' && Array.isArray(data.grid)) {
    boardRecLog('recognize-board OK', { httpStatus: res.status });
    return data.grid;
  }

  boardRecLog('recognize-board ERROR', { httpStatus: res.status, message: data.message });
  throw new Error(data.message ?? `Recognition failed: ${res.status}`);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(typeof result === 'string' ? result : '');
    };
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}
