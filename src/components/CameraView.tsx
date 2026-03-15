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
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const isMobile =
    typeof window !== 'undefined' &&
    /Mobi|Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270 degrees CW
  const [zoom, setZoom] = useState(1);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(3);
  const [zoomStep, setZoomStep] = useState(0.1);
  const [lastFocusPoint, setLastFocusPoint] = useState<{ x: number; y: number } | null>(null);

  const cycleRotation = () => {
    setRotation((r) => (r + 90) % 360);
  };

  const applyZoom = (value: number) => {
    const track = videoTrackRef.current;
    if (!track) return;
    const caps = track.getCapabilities?.() as MediaTrackCapabilities | undefined;
    if (caps && 'zoom' in (caps as any)) {
      track
        .applyConstraints({ advanced: [{ zoom: value } as any] })
        .catch(() => {
          // Ignore zoom failures; some devices report capability but reject constraints.
        });
    }
  };

  const handleZoomChange = (value: number) => {
    const clamped = Math.min(Math.max(value, zoomMin), zoomMax);
    setZoom(clamped);
    if (zoomSupported) {
      applyZoom(clamped);
    }
  };

  const refocus = () => {
    const track = videoTrackRef.current;
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities() as MediaTrackCapabilities & {
      focusMode?: string[];
      focusDistance?: { min: number; max: number; step?: number };
      pointsOfInterest?: any;
    };

    const advanced: MediaTrackConstraintSet[] = [];
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' } as any);
    } else if (caps.focusMode && caps.focusMode.includes('single-shot')) {
      advanced.push({ focusMode: 'single-shot' } as any);
    }

    if (caps.focusDistance) {
      const mid = (caps.focusDistance.min + caps.focusDistance.max) / 2;
      advanced.push({ focusDistance: mid } as any);
    }

    if (advanced.length === 0) return;

    track.applyConstraints({ advanced }).catch(() => {
      // Ignore focus failures; many devices silently reject unsupported constraints.
    });
  };

  const refocusAt = (clientX: number, clientY: number) => {
    if (!videoRef.current) return;
    const rect = videoRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    setLastFocusPoint({ x, y });

    const track = videoTrackRef.current;
    if (!track || !track.getCapabilities) {
      refocus();
      return;
    }
    const caps = track.getCapabilities() as MediaTrackCapabilities & {
      pointsOfInterest?: any;
      focusMode?: string[];
      focusDistance?: { min: number; max: number; step?: number };
    };

    const advanced: MediaTrackConstraintSet[] = [];
    if (caps.pointsOfInterest) {
      advanced.push({ pointsOfInterest: [{ x, y }] } as any);
    }

    if (advanced.length === 0) {
      refocus();
      return;
    }

    track.applyConstraints({ advanced }).catch(() => {
      // Fallback to generic refocus if point-based focus fails.
      refocus();
    });
  };

  const handleClickToFocus: React.MouseEventHandler<HTMLVideoElement> = (e) => {
    refocusAt(e.clientX, e.clientY);
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
      const tracks = stream.getVideoTracks();
      const track = tracks[0];
      videoTrackRef.current = track ?? null;

      if (track && track.getCapabilities) {
        const caps = track.getCapabilities() as MediaTrackCapabilities & {
          zoom?: { min: number; max: number; step?: number; default?: number };
        };
        if (caps.zoom && typeof caps.zoom.min === 'number' && typeof caps.zoom.max === 'number') {
          setZoomSupported(true);
          const min = caps.zoom.min;
          const max = caps.zoom.max;
          const step = caps.zoom.step ?? ((max - min) / 10 || 0.1);
          const initial = caps.zoom.default ?? caps.zoom.min;
          setZoomMin(min);
          setZoomMax(max);
          setZoomStep(step);
          setZoom(initial);
          applyZoom(initial);
        } else {
          setZoomSupported(false);
          setZoom(1);
          setZoomMin(1);
          setZoomMax(3);
        }
      } else {
        videoTrackRef.current = null;
        setZoomSupported(false);
        setZoom(1);
        setZoomMin(1);
        setZoomMax(3);
      }
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
        onClick={handleClickToFocus}
        style={{
          // On mobile, rely on the browser's native pinch-zoom and tap-to-focus.
          transform:
            rotation !== 0
              ? `rotate(${rotation}deg)${isMobile ? '' : ` scale(${Math.SQRT2 * (zoomSupported ? 1 : zoom)})`}`
              : isMobile
              ? undefined
              : zoomSupported
              ? undefined
              : `scale(${zoom})`,
        }}
      />
      <canvas ref={canvasRef} className="hidden" />
      {lastFocusPoint && (
        <div
          className="pointer-events-none absolute border-2 border-amber-400 rounded-full"
          style={{
            width: 80,
            height: 80,
            left: `calc(${lastFocusPoint.x * 100}% - 40px)`,
            top: `calc(${lastFocusPoint.y * 100}% - 40px)`,
          }}
        />
      )}
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

      {/* Desktop zoom + focus controls; on mobile we rely on native pinch + tap-to-focus. */}
      {!isMobile && (
        <>
          <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 px-3 py-2 rounded-full bg-black/40 backdrop-blur text-white text-xs">
            <span className="whitespace-nowrap">Zoom</span>
            <input
              type="range"
              min={zoomMin}
              max={zoomMax}
              step={zoomStep}
              value={zoom}
              onChange={(e) => handleZoomChange(Number(e.target.value))}
              className="flex-1 accent-amber-400"
            />
            <span className="w-10 text-right">{zoom.toFixed(1)}x</span>
          </div>

          {/* Refocus button (best-effort; only works on devices that support focus constraints) */}
          <button
            type="button"
            onClick={() => {
              if (navigator.vibrate) navigator.vibrate(10);
              refocus();
            }}
            className="absolute top-3 left-3 px-2.5 py-1.5 rounded-full bg-white/90 hover:bg-white text-stone-900 shadow-lg touch-manipulation z-10 text-xs font-medium"
            title="Refocus camera"
            aria-label="Refocus camera"
          >
            Focus
          </button>
        </>
      )}
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
