import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

interface CameraViewProps {
  stream: MediaStream | null;
  onCapture?: (blob: Blob) => void;
  showCaptureButton?: boolean;
}

export interface CameraViewRef {
  capture: () => void;
}

export const CameraView = forwardRef<CameraViewRef, CameraViewProps>(function CameraView(
  { stream, onCapture, showCaptureButton = false },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const capture = () => {
    if (!videoRef.current || !canvasRef.current || !stream) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const max = 1920;

    // On mobile, camera often outputs landscape while device is portrait.
    // Rotate 90° CW so the captured image matches what the user sees.
    const isPortrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    const needsRotation = isPortrait && vw > vh;

    let w = needsRotation ? vh : vw;
    let h = needsRotation ? vw : vh;

    if (w > max || h > max) {
      const scale = max / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    if (needsRotation) {
      const tmp = document.createElement('canvas');
      tmp.width = vw;
      tmp.height = vh;
      tmp.getContext('2d')!.drawImage(video, 0, 0);
      canvas.width = vh;
      canvas.height = vw;
      ctx.setTransform(0, 1, -1, 0, vh, 0);
      ctx.drawImage(tmp, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (w !== vh || h !== vw) {
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        out.getContext('2d')!.drawImage(canvas, 0, 0, vh, vw, 0, 0, w, h);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(out, 0, 0);
      }
    } else {
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
    }
    canvas.toBlob((blob) => blob && onCapture?.(blob), 'image/jpeg', 0.92);
  };

  useImperativeHandle(ref, () => ({ capture }), [stream, onCapture]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative aspect-square max-w-md mx-auto bg-stone-800 rounded-xl overflow-hidden isolate">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas ref={canvasRef} className="hidden" />
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
