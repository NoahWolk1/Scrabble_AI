import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';

interface CameraViewProps {
  stream: MediaStream | null;
  onCapture?: (blob: Blob) => void;
  showCaptureButton?: boolean;
}

export interface CameraViewRef {
  capture: () => void;
}

/** Draw source onto dest with rotation (0, 90, 180, 270 CW). Returns output dimensions. */
function drawRotated(
  src: HTMLCanvasElement | HTMLVideoElement,
  dest: HTMLCanvasElement,
  rotationDeg: number
): { w: number; h: number } {
  const sw = 'videoWidth' in src ? src.videoWidth : src.width;
  const sh = 'videoHeight' in src ? src.videoHeight : src.height;
  const ctx = dest.getContext('2d')!;

  const swapDims = rotationDeg === 90 || rotationDeg === 270;
  const outW = swapDims ? sh : sw;
  const outH = swapDims ? sw : sh;
  dest.width = outW;
  dest.height = outH;

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.translate(-sw / 2, -sh / 2);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  return { w: outW, h: outH };
}

export const CameraView = forwardRef<CameraViewRef, CameraViewProps>(function CameraView(
  { stream, onCapture, showCaptureButton = false },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270 degrees CW

  const cycleRotation = () => {
    setRotation((r) => (r + 90) % 360);
  };

  const capture = () => {
    if (!videoRef.current || !canvasRef.current || !stream) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const max = 1920;

    // Base rotation: on mobile portrait, camera outputs landscape — rotate 90° CW
    const isPortrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    const baseRotation = isPortrait && vw > vh ? 90 : 0;

    // Draw video to temp, apply base rotation, then user rotation
    const tmp = document.createElement('canvas');
    tmp.width = vw;
    tmp.height = vh;
    tmp.getContext('2d')!.drawImage(video, 0, 0);

    const tmp2 = document.createElement('canvas');
    drawRotated(tmp, tmp2, baseRotation);

    const { w: outW, h: outH } = drawRotated(tmp2, canvas, rotation);

    let w = outW;
    let h = outH;
    if (w > max || h > max) {
      const scale = max / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const scaled = document.createElement('canvas');
      scaled.width = w;
      scaled.height = h;
      scaled.getContext('2d')!.drawImage(canvas, 0, 0, outW, outH, 0, 0, w, h);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(scaled, 0, 0);
    }

    canvas.toBlob((blob) => blob && onCapture?.(blob), 'image/jpeg', 0.92);
  };

  useImperativeHandle(ref, () => ({ capture }), [stream, onCapture, rotation]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative aspect-square max-w-md mx-auto bg-stone-900 rounded-2xl overflow-hidden isolate shadow-xl border border-stone-700/50">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover origin-center transition-transform duration-200"
        style={{
          transform: rotation !== 0 ? `rotate(${rotation}deg) scale(${Math.SQRT2})` : undefined,
        }}
      />
      <canvas ref={canvasRef} className="hidden" />
      <button
        type="button"
        onClick={() => {
          if (navigator.vibrate) navigator.vibrate(20);
          cycleRotation();
        }}
        className="absolute top-3 right-3 p-2.5 rounded-full bg-white/90 hover:bg-white text-stone-900 shadow-lg touch-manipulation z-10"
        title="Rotate 90°"
        aria-label="Rotate camera 90 degrees"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
      {showCaptureButton && (
        <button
          type="button"
          onClick={capture}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-3 bg-white text-stone-900 rounded-full font-medium shadow-lg"
        >
          Capture board
        </button>
      )}
    </div>
  );
});
