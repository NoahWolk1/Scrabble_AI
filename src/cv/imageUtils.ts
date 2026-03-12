/**
 * Image utilities for board recognition - orientation fix and resize.
 * Mobile photos often have wrong orientation (EXIF or video capture).
 */

/** EXIF orientation values: 1=normal, 2=flip H, 3=180, 4=flip V, 5-8=rotated */
function getExifOrientation(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const view = new DataView(reader.result as ArrayBuffer);
      if (view.getUint16(0, false) !== 0xffd8) {
        resolve(1);
        return;
      }
      const length = view.byteLength;
      let offset = 2;
      while (offset < length) {
        if (view.getUint16(offset + 2, false) <= 8) {
          resolve(1);
          return;
        }
        const marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xffe1) {
          offset += 2;
          if (view.getUint32(offset, false) !== 0x45786966) {
            resolve(1);
            return;
          }
          const little = view.getUint16((offset += 6), false) === 0x4949;
          offset += view.getUint32(offset + 4, little);
          const tags = view.getUint16(offset, little);
          offset += 2;
          for (let i = 0; i < tags; i++) {
            const pos = offset + i * 12;
            if (view.getUint16(pos, little) === 0x0112) {
              resolve(view.getUint16(pos + 8, little));
              return;
            }
          }
        } else if ((marker & 0xff00) !== 0xff00) break;
        else offset += view.getUint16(offset, false);
      }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(blob.slice(0, 64 * 1024));
  });
}

/** Draw image to canvas with EXIF orientation applied. Returns canvas. */
function drawWithOrientation(
  img: HTMLImageElement,
  orientation: number
): HTMLCanvasElement {
  const { width: w, height: h } = img;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const swapDims = orientation >= 5 && orientation <= 8;
  canvas.width = swapDims ? h : w;
  canvas.height = swapDims ? w : h;

  ctx.save();
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, h, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, h, w);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, w);
      break;
    default:
      break;
  }
  ctx.drawImage(img, 0, 0);
  ctx.restore();

  return canvas;
}

/**
 * Resize and fix orientation. Mobile uploads often have EXIF rotation;
 * canvas ignores it, so we must apply it explicitly for Scrabblecam.
 */
export async function prepareImageForRecognition(
  blob: Blob,
  maxSize = 1920,
  quality = 0.92
): Promise<Blob> {
  const orientation = await getExifOrientation(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let canvas: HTMLCanvasElement;
      if (orientation !== 1) {
        canvas = drawWithOrientation(img, orientation);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
      }

      let { width, height } = canvas;
      if (width > maxSize || height > maxSize) {
        const scale = maxSize / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const resized = document.createElement('canvas');
        resized.width = width;
        resized.height = height;
        resized.getContext('2d')!.drawImage(canvas, 0, 0, width, height);
        canvas = resized;
      }

      canvas.toBlob(
        (b) => (b ? resolve(b) : resolve(blob)),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
