/**
 * Perspective correction before board recognition.
 * Detect the board quadrilateral, warp to top-down view, then run row/column recognition.
 * Uses scanic (WASM Canny + warp) loaded on demand so the main bundle stays smaller.
 */

import type { DetectionOptions } from 'scanic';
import { boardRecLog, boardRecWarn } from './boardRecognitionLog';

type ScanicModule = typeof import('scanic');
type ScannerInstance = InstanceType<ScanicModule['Scanner']>;

let scanicModulePromise: Promise<ScanicModule> | null = null;
let scannerSingleton: ScannerInstance | null = null;

async function loadScanic(): Promise<ScanicModule> {
  if (!scanicModulePromise) {
    scanicModulePromise = import('scanic');
  }
  return scanicModulePromise;
}

async function getBoardScanner(): Promise<ScannerInstance> {
  const { Scanner } = await loadScanic();
  if (!scannerSingleton) {
    scannerSingleton = new Scanner({
      maxProcessingDimension: 1000,
      output: 'canvas',
    });
    await scannerSingleton.initialize();
  }
  return scannerSingleton;
}

/** Tighter first; then looser edges / smaller min quad area for hard photos. */
const DEWARP_PASSES: DetectionOptions[] = [
  {
    mode: 'extract',
    output: 'canvas',
    maxProcessingDimension: 1000,
    minArea: 15000,
  },
  {
    mode: 'extract',
    output: 'canvas',
    maxProcessingDimension: 1200,
    minArea: 8000,
    lowThreshold: 50,
    highThreshold: 150,
    dilationKernelSize: 5,
  },
  {
    mode: 'extract',
    output: 'canvas',
    maxProcessingDimension: 1000,
    minArea: 4000,
    lowThreshold: 40,
    highThreshold: 120,
    dilationKernelSize: 5,
    dilationIterations: 2,
  },
  {
    mode: 'extract',
    output: 'canvas',
    maxProcessingDimension: 900,
    minArea: 2500,
    lowThreshold: 35,
    highThreshold: 100,
    dilationKernelSize: 3,
    dilationIterations: 1,
  },
];

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for dewarp'));
    };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b && b.size > 0) resolve(b);
        else reject(new Error('Dewarp canvas toBlob failed'));
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * If a clear board-like quadrilateral is found, returns a perspective-corrected JPEG blob.
 * Otherwise returns the input unchanged.
 */
export async function dewarpBoardImageIfPossible(blob: Blob): Promise<Blob> {
  if (typeof document === 'undefined') {
    return blob;
  }

  try {
    const img = await loadImage(blob);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < 80 || h < 80) {
      boardRecLog('dewarp skipped: image too small');
      return blob;
    }

    boardRecLog('dewarp: perspective correction (scanic, multi-pass)…', {
      inputSize: `${w}x${h}`,
      passes: DEWARP_PASSES.length,
    });

    const scanner = await getBoardScanner();

    for (let i = 0; i < DEWARP_PASSES.length; i++) {
      const passOpts = DEWARP_PASSES[i];
      boardRecLog(`dewarp pass ${i + 1}/${DEWARP_PASSES.length}`, {
        maxProcessingDimension: passOpts.maxProcessingDimension,
        minArea: passOpts.minArea,
        lowThreshold: passOpts.lowThreshold,
        highThreshold: passOpts.highThreshold,
        dilationKernelSize: passOpts.dilationKernelSize,
        dilationIterations: passOpts.dilationIterations,
      });

      const result = await scanner.scan(img, passOpts);

      if (result.success && result.output instanceof HTMLCanvasElement) {
        const out = result.output;
        boardRecLog('dewarp OK', {
          pass: i + 1,
          outSize: `${out.width}x${out.height}`,
          corners: result.corners,
          message: result.message,
        });
        return await canvasToJpegBlob(out, 0.92);
      }

      boardRecWarn(`dewarp pass ${i + 1} no extract`, {
        message: result.message,
        success: result.success,
      });
    }

    boardRecWarn('dewarp: all passes failed, using original image');
    return blob;
  } catch (e) {
    boardRecWarn('dewarp error, using original image', e);
    return blob;
  }
}
