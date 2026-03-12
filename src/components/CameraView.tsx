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

    let { width, height } = video;
    const max = 1280;
    if (width > max || height > max) {
      const scale = max / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => blob && onCapture?.(blob), 'image/jpeg', 0.85);
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
