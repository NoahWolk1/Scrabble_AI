import { BOARD_SIZE } from '../game/constants';
import {
  recognizeBoardFromImage,
  parseBoardString,
} from './scrabblecamApi';
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
 * Recognize board state from a captured image using Scrabblecam API.
 * Optionally fixes OCR errors via Gemini (removes non-words, corrects letters).
 * @see https://scrabblecam.com/api
 */
export async function recognizeBoard(
  imageBlob: Blob,
  options?: { useGeminiFix?: boolean }
): Promise<(string | null)[][]> {
  const response = await recognizeBoardFromImage(imageBlob);

  if (response.status === 'ERROR') {
    throw new Error(response.message ?? 'Board recognition failed');
  }

  if (!response.board) {
    throw new Error('No board found in image');
  }

  let grid = ensure15x15(parseBoardString(response.board));

  if (options?.useGeminiFix !== false) {
    try {
      grid = await fixBoardWithGemini(grid);
      grid = ensure15x15(grid);
    } catch (err) {
      console.warn('Gemini fix skipped:', err);
      // Fall back to raw recognition
    }
  }

  return grid;
}
