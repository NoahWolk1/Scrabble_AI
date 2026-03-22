/**
 * Recognize Scrabble board from image using Gemini Vision.
 * Primary recognition path—more accurate than OCR for letter reading.
 */

const API_BASE = '/api/gemini';

export interface RecognizeBoardResponse {
  status: 'OK' | 'ERROR';
  grid?: (string | null)[][];
  message?: string;
}

export async function recognizeBoardWithGeminiVision(
  imageBlob: Blob
): Promise<(string | null)[][]> {
  const base64 = await blobToBase64(imageBlob);
  const mimeType = imageBlob.type || 'image/jpeg';

  const res = await fetch(`${API_BASE}/recognize-board`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: base64.includes(',') ? base64.split(',')[1]! : base64,
      mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
    }),
  });

  const text = await res.text();
  let data: RecognizeBoardResponse;
  try {
    data = JSON.parse(text) as RecognizeBoardResponse;
  } catch {
    throw new Error(`Invalid response (${res.status}): ${text.slice(0, 100)}`);
  }

  if (data.status === 'OK' && Array.isArray(data.grid)) {
    return data.grid;
  }

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
