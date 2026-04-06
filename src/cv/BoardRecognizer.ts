import { BOARD_SIZE } from '../game/constants';
import {
  recognizeBoardFromImage,
  parseBoardString,
} from './scrabblecamApi';
import { recognizeBoardWithGeminiVision } from './geminiRecognizeApi';
import { alignRecognizedGridToPrior } from './alignRecognizedGridToPrior';
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
  options?: { priorBoard?: (string | null)[][] | null }
): Promise<(string | null)[][]> {
  const prior = options?.priorBoard;
  let grid: (string | null)[][];
  let primaryPath: string;

  boardRecLog('start', {
    imageBytes: imageBlob.size,
    hasPrior: !!prior,
    priorFilled: prior ? countFilledCells(prior) : 0,
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
    primaryPath = 'scrabblecam-primary';
    try {
      boardRecLog('strategy: Scrabblecam primary; Gemini Vision fallback; optional Gemini fix', {
        priorFilled: countFilledCells(prior),
      });
      grid = await readBoardScrabblecam(imageBlob);
      boardRecLog('after Scrabblecam (primary)', {
        filledCells: countFilledCells(grid),
        newVsPrior: listNewVsPrior(prior, grid),
      });
      const aligned = alignRecognizedGridToPrior(prior, grid);
      grid = aligned.grid;
      boardRecLog('align to prior (primary)', {
        dr: aligned.dr,
        dc: aligned.dc,
        transposed: aligned.transposed,
        score: aligned.score,
        anchors: aligned.anchorCount,
        applied: aligned.applied,
      });
      grid = mergeWithPrior(grid, prior);
      boardRecLog('after mergeWithPrior', {
        newVsPrior: listNewVsPrior(prior, grid),
      });
    } catch (err) {
      boardRecWarn('Scrabblecam failed → Gemini Vision fallback', err);
      primaryPath = 'gemini-vision-fallback';
      grid = await recognizeBoardWithGeminiVision(imageBlob, prior);
      grid = ensure15x15(grid);
      boardRecLog('after Gemini Vision (fallback raw)', {
        filledCells: countFilledCells(grid),
        newVsPrior: listNewVsPrior(prior, grid),
      });
      const alignedFb = alignRecognizedGridToPrior(prior, grid);
      grid = alignedFb.grid;
      boardRecLog('align to prior (fallback)', {
        dr: alignedFb.dr,
        dc: alignedFb.dc,
        transposed: alignedFb.transposed,
        score: alignedFb.score,
        anchors: alignedFb.anchorCount,
        applied: alignedFb.applied,
      });
      grid = mergeWithPrior(grid, prior);
      boardRecLog('after mergeWithPrior (fallback)', {
        newVsPrior: listNewVsPrior(prior, grid),
      });
    }
  }

  boardRecLog('done', {
    primaryPath,
    filledCells: countFilledCells(grid),
    ...(prior ? { newVsPrior: listNewVsPrior(prior, grid) } : {}),
  });

  return grid;
}
