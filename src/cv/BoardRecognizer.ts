import { BOARD_SIZE } from '../game/constants';
import {
  recognizeBoardFromImage,
  parseBoardString,
} from './scrabblecamApi';
import { recognizeBoardWithGeminiVision } from './geminiRecognizeApi';
import { fixBoardWithGemini } from './geminiFixApi';
import {
  boardRecLog,
  boardRecWarn,
  countFilledCells,
  listNewVsPrior,
} from './boardRecognitionLog';

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

async function readBoardScrabblecam(imageBlob: Blob): Promise<(string | null)[][]> {
  const response = await recognizeBoardFromImage(imageBlob);
  if (response.status === 'ERROR') {
    throw new Error(response.message ?? 'Board recognition failed');
  }
  if (!response.board) {
    throw new Error('No board found in image');
  }
  return ensure15x15(parseBoardString(response.board));
}

/**
 * Merge prior board into result: existing tiles are immutable.
 * Cells that had a letter in the prior must stay that letter—recognition cannot overwrite them.
 * Only cells that were empty in the prior can show new letters from recognition.
 */
function mergeWithPrior(
  grid: (string | null)[][],
  prior: (string | null)[][]
): (string | null)[][] {
  return grid.map((row, r) =>
    row.map((cell, c) => {
      const p = prior[r]?.[c];
      if (p) return p;
      return cell;
    })
  );
}

/**
 * Recognize board state from a captured image.
 *
 * - **Empty board (no prior):** Scrabblecam first. Full 15×15 alignment matches the physical
 *   board better than raw Gemini Vision, which often shifts the first play.
 * - **Non-empty prior:** Gemini Vision first (diff-style prompt + prior), then Scrabblecam fallback.
 * - Optional Gemini fix; prior cells are re-applied after fix so known tiles stay put.
 */
export async function recognizeBoard(
  imageBlob: Blob,
  options?: { useGeminiFix?: boolean; priorBoard?: (string | null)[][] | null }
): Promise<(string | null)[][]> {
  const prior = options?.priorBoard;
  const useFix = options?.useGeminiFix !== false;
  let grid: (string | null)[][];
  let primaryPath: string;

  boardRecLog('start', {
    imageBytes: imageBlob.size,
    hasPrior: !!prior,
    priorFilled: prior ? countFilledCells(prior) : 0,
    useGeminiFix: useFix,
  });

  if (!prior) {
    primaryPath = 'scrabblecam-empty-board';
    boardRecLog(
      'strategy: Scrabblecam first for full-board read (avoids Gemini grid misalignment on first play)'
    );
    try {
      grid = await readBoardScrabblecam(imageBlob);
      boardRecLog('after Scrabblecam', {
        filledCells: countFilledCells(grid),
      });
    } catch (err) {
      boardRecWarn('Scrabblecam failed on empty board → Gemini Vision fallback', err);
      primaryPath = 'gemini-vision-empty-fallback';
      grid = await recognizeBoardWithGeminiVision(imageBlob, null);
      grid = ensure15x15(grid);
      boardRecLog('after Gemini Vision (empty-board fallback)', {
        filledCells: countFilledCells(grid),
      });
    }
  } else {
    primaryPath = 'gemini-vision';
    try {
      boardRecLog('strategy: Gemini Vision with prior (diff-friendly)', {
        priorFilled: countFilledCells(prior),
      });
      grid = await recognizeBoardWithGeminiVision(imageBlob, prior);
      grid = ensure15x15(grid);
      boardRecLog('after Gemini Vision (raw)', {
        filledCells: countFilledCells(grid),
        newVsPrior: listNewVsPrior(prior, grid),
      });
      grid = mergeWithPrior(grid, prior);
      boardRecLog('after mergeWithPrior', {
        newVsPrior: listNewVsPrior(prior, grid),
      });
    } catch (err) {
      boardRecWarn('Gemini Vision failed → Scrabblecam fallback', err);
      primaryPath = 'scrabblecam-fallback';
      grid = await readBoardScrabblecam(imageBlob);
      boardRecLog('after Scrabblecam (fallback)', {
        filledCells: countFilledCells(grid),
        newVsPrior: listNewVsPrior(prior, grid),
      });
      grid = mergeWithPrior(grid, prior);
      boardRecLog('after mergeWithPrior (fallback)', {
        newVsPrior: listNewVsPrior(prior, grid),
      });
    }
  }

  if (useFix) {
    try {
      boardRecLog('running Gemini fix-board…');
      grid = await fixBoardWithGemini(grid);
      grid = ensure15x15(grid);
      boardRecLog('after Gemini fix', {
        filledCells: countFilledCells(grid),
        ...(prior ? { newVsPrior: listNewVsPrior(prior, grid) } : {}),
      });
      if (prior) {
        grid = mergeWithPrior(grid, prior);
        boardRecLog('after mergeWithPrior (post-fix)', {
          newVsPrior: listNewVsPrior(prior, grid),
        });
      }
    } catch (err) {
      boardRecWarn('Gemini fix skipped', err);
    }
  } else {
    boardRecLog('Gemini fix skipped (disabled in UI)');
  }

  boardRecLog('done', {
    primaryPath,
    filledCells: countFilledCells(grid),
    ...(prior ? { newVsPrior: listNewVsPrior(prior, grid) } : {}),
  });

  return grid;
}
