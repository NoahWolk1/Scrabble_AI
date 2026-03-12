import { BOARD_SIZE } from '../game/constants';

const GRID_SIZE = BOARD_SIZE;

/**
 * Extract 15×15 tile images from a source image.
 * Uses either provided corners for perspective correction, or centers on image.
 */
export async function extractTiles(
  imageData: ImageData
): Promise<ImageData[]> {
  const { width, height } = imageData;
  const tiles: ImageData[] = [];

  // Use center square if no corners
  const size = Math.min(width, height);
  const x0 = (width - size) / 2;
  const y0 = (height - size) / 2;

  const cellSize = size / GRID_SIZE;

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const sx = x0 + col * cellSize;
      const sy = y0 + row * cellSize;
      const tileData = extractRegion(imageData, sx, sy, cellSize, cellSize);
      tiles.push(tileData);
    }
  }
  return tiles;
}

function extractRegion(
  src: ImageData,
  x: number,
  y: number,
  w: number,
  h: number
): ImageData {
  const size = Math.max(1, Math.min(Math.floor(w), Math.floor(h), 64));
  const out = new ImageData(size, size);
  const scaleX = w / size;
  const scaleY = h / size;

  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const sx = Math.floor(x + dx * scaleX);
      const sy = Math.floor(y + dy * scaleY);
      const si = (sy * src.width + sx) * 4;
      const oi = (dy * size + dx) * 4;
      if (sx >= 0 && sx < src.width && sy >= 0 && sy < src.height) {
        out.data[oi] = src.data[si];
        out.data[oi + 1] = src.data[si + 1];
        out.data[oi + 2] = src.data[si + 2];
        out.data[oi + 3] = src.data[si + 3];
      }
    }
  }
  return out;
}

export function imageDataFromBlob(blob: Blob): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No 2d context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
