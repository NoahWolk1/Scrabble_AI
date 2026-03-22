import { BOARD_SIZE } from '../game/constants';
import {
  recognizeBoardFromImage,
  parseBoardString,
} from './scrabblecamApi';
import { recognizeBoardWithGeminiVision } from './geminiRecognizeApi';
import { fixBoardWithGemini } from './geminiFixApi';

function ensure15x15(grid: (string | null)[][]): (string | null)[][] {
  const padded: (string | null)[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = grid[r] ?? [];
    const cells: (string | null)[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      cells.push(row[c] ?? null);
    }
    padded.push(cells);
  }
  return padded;
}

/**
 * Recognize board state from a captured image.
 * Tries Gemini Vision first (direct image→board, most accurate).
 * Falls back to Scrabblecam OCR if Vision fails.
 * Optionally applies Gemini fix to correct remaining errors.
 */
export async function recognizeBoard(
  imageBlob: Blob,
  options?: { useGeminiFix?: boolean }
): Promise<(string | null)[][]> {
  let grid: (string | null)[][];

  try {
    grid = await recognizeBoardWithGeminiVision(imageBlob);
    grid = ensure15x15(grid);
  } catch (err) {
    console.warn('Gemini Vision recognition failed, falling back to Scrabblecam:', err);
    const response = await recognizeBoardFromImage(imageBlob);

    if (response.status === 'ERROR') {
      throw new Error(response.message ?? 'Board recognition failed');
    }

    if (!response.board) {
      throw new Error('No board found in image');
    }

    grid = ensure15x15(parseBoardString(response.board));
  }

  if (options?.useGeminiFix !== false) {
    try {
      grid = await fixBoardWithGemini(grid);
      grid = ensure15x15(grid);
    } catch (err) {
      console.warn('Gemini fix skipped:', err);
    }
  }

  return grid;
}
