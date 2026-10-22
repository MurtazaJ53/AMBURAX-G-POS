"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, AlertCircle } from "lucide-react";

interface CameraBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

type Detector = { detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<Array<{ rawValue?: string }>> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

const FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code"];

export function CameraBarcodeScannerModal({ isOpen, onClose, onScan }: CameraBarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isStarting, setIsStarting] = useState(false);

  // Latest callbacks without restarting the camera when the parent re-renders.
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;

    let stream: MediaStream | null = null;
    let frame: number | null = null;
    let stopped = false;

    // Check BarcodeDetector support
    const Ctor = typeof window !== "undefined" ? (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector : undefined;
    const detector = Ctor ? new Ctor({ formats: FORMATS }) : null;

    const stop = () => {
      stopped = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
    };

    const scan = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          if (detector) {
            const barcodes = await detector.detect(video);
            const found = barcodes[0]?.rawValue;
            if (found) {
              stop();
              onScanRef.current(found);
              onCloseRef.current();
              return;
            }
          }
        } catch {
          // Frame error, skip to next
        }
      }
      frame = requestAnimationFrame(scan);
    };

    const startCamera = async () => {
      setIsStarting(true);
      setError(null);

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("Camera is not supported on this browser or requires a secure context (HTTPS / localhost).");
        setIsStarting(false);
        return;
      }

      try {
        // Enumerate video input devices if possible
        try {
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          const videoDevs = allDevices.filter((d) => d.kind === "videoinput");
          setDevices(videoDevs);
          if (videoDevs.length > 0 && !selectedDeviceId) {
            // Prefer back camera if available, otherwise first camera
            const backCam = videoDevs.find((d) => /back|rear|environment/i.test(d.label));
            setSelectedDeviceId(backCam ? backCam.deviceId : videoDevs[0].deviceId);
          }
        } catch {
          // Enumeration may fail if permission not yet granted; will re-check after getUserMedia
        }

        const constraints: MediaStreamConstraints = {
          video: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
        };

        let s: MediaStream;
        try {
          s = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          // Fallback to basic unconstrained video
          s = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        if (stopped) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = s;
        setError(null);

        // Re-enumerate to get friendly camera labels now that permission is granted
        try {
          const allDevs = await navigator.mediaDevices.enumerateDevices();
          setDevices(allDevs.filter((d) => d.kind === "videoinput"));
        } catch {}

        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => {});
          void scan();
        }
      } catch (err: unknown) {
        if (stopped) return;
        if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
          setError("Camera permission was denied. Please click the camera icon in your browser address bar and choose 'Always allow'.");
        } else if (err instanceof DOMException && err.name === "NotFoundError") {
          setError("No camera / webcam found on this computer. You can use any handheld USB/Bluetooth barcode scanner directly, or type the barcode.");
        } else if (err instanceof DOMException && err.name === "NotReadableError") {
          setError("Camera is currently in use by another application or tab. Please close other camera apps and retry.");
        } else {
          setError("Unable to access camera: " + (err instanceof Error ? err.message : String(err)));
        }
      } finally {
        setIsStarting(false);
      }
    };

    void startCamera();

    return stop;
  }, [isOpen, selectedDeviceId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Live Camera Barcode Scanner</h3>
              <p className="text-xs text-slate-500">Hold barcode steadily in front of the lens</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label="Close scanner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Camera Device Switcher (if multiple cameras available) */}
        {devices.length > 1 && (
          <div className="bg-slate-50 border-b border-slate-100 px-6 py-2 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">Select Camera:</span>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {devices.map((d, idx) => (
                <option key={d.deviceId || idx} value={d.deviceId}>
                  {d.label || `Camera ${idx + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Camera Viewport */}
        <div className="relative aspect-[4/3] w-full bg-slate-950 flex items-center justify-center overflow-hidden">
          {error ? (
            <div className="px-6 py-8 text-center text-sm text-slate-200 flex flex-col items-center gap-3">
              <div className="rounded-2xl bg-rose-500/20 p-3.5 text-rose-400 ring-4 ring-rose-500/10">
                <AlertCircle className="h-9 w-9" />
              </div>
              <div className="max-w-xs space-y-2">
                <p className="font-semibold text-white text-sm leading-snug">{error}</p>
                <p className="text-xs text-slate-400">
                  Tip: Physical handheld USB or wireless barcode guns require zero camera setup and work immediately in any input field!
                </p>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                className="h-full w-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Viewfinder Target Box Overlay */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="relative h-44 w-72 rounded-2xl border-2 border-emerald-400/90 bg-emerald-500/5 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
                  {/* Corner accents */}
                  <div className="absolute -top-0.5 -left-0.5 h-4 w-4 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                  <div className="absolute -top-0.5 -right-0.5 h-4 w-4 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                  <div className="absolute -bottom-0.5 -left-0.5 h-4 w-4 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                  <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />
                  
                  {/* Animated laser scan bar */}
                  <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-red-500 to-transparent animate-pulse mt-20 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                </div>
                <span className="mt-3 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-emerald-300 backdrop-blur-md">
                  Point camera at barcode or QR code
                </span>
              </div>
            </>
          )}

          {isStarting && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 text-white text-xs font-semibold gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
              Opening camera...
            </div>
          )}
        </div>

        {/* Manual Barcode Fallback Box */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center gap-2">
          <input
            type="text"
            placeholder="Or enter barcode manually here..."
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-mono font-semibold text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.currentTarget.value || "").trim();
                if (val) {
                  onScanRef.current(val);
                  onCloseRef.current();
                }
              }
            }}
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
