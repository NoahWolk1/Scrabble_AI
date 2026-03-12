
let workerInstance: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null = null;

async function getWorker() {
  if (workerInstance) return workerInstance;
  const { createWorker, PSM } = await import('tesseract.js');
  workerInstance = await createWorker('eng', 1, { logger: () => {} });
  await workerInstance.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    tessedit_pageseg_mode: PSM.SINGLE_CHAR,
  });
  return workerInstance;
}

/**
 * Classify a single tile image as a letter (A-Z) or empty.
 * Uses Tesseract.js for OCR. Returns null for empty cells.
 */
export async function classifyTile(tileImage: ImageData): Promise<string | null> {
  try {
    const worker = await getWorker();
    const canvas = document.createElement('canvas');
    canvas.width = tileImage.width;
    canvas.height = tileImage.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(tileImage, 0, 0);

    const { data } = await worker.recognize(canvas);
    const text = data.text.trim().toUpperCase();
    if (text.length === 0) return null;
    if (text.length === 1 && /[A-Z]/.test(text)) return text;
    if (text.length > 1) return text[0];
    return null;
  } catch {
    return null;
  }
}

export async function terminateClassifier() {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
  }
}
