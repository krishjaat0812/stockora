import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw, X } from 'lucide-react';
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Button, Spinner } from '../ui';

/**
 * Optional mobile-camera barcode scanner built on the maintained zxing
 * browser library.
 *
 * Requirements and honest limits:
 *  - Camera access needs an explicit permission prompt and a secure context
 *    (HTTPS or localhost); on an insecure origin `navigator.mediaDevices` is
 *    absent and we say so instead of failing silently.
 *  - Only the decoded text ever leaves this component — no frames are stored,
 *    uploaded or kept; the stream is stopped when the scanner closes or the
 *    page unmounts.
 *  - Not every browser/device supports camera decoding; the UI always keeps
 *    the keyboard-scanner and manual-entry paths available.
 */

const SCAN_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_128,
  BarcodeFormat.ITF,
];

/** Same-code suppression: one physical frame decodes several times in a row. */
const SAME_CODE_COOLDOWN_MS = 1200;

type Status =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'denied'; message: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'error'; message: string };

export function CameraScanner({
  open,
  onDetect,
  onClose,
}: {
  open: boolean;
  onDetect: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  const [lastDetected, setLastDetected] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);

  const stop = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      // The controls may already be stopped; nothing to release.
    }
    controlsRef.current = null;
    readerRef.current = null;
  }, []);

  const start = useCallback(
    async (device: string | undefined) => {
      stop();
      setStatus({ kind: 'starting' });

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatus({
          kind: 'unsupported',
          message:
            'Camera scanning needs a secure context (HTTPS or localhost) and a browser with camera access. Use a USB scanner or type the barcode instead.',
        });
        return;
      }

      const reader = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: 200,
        delayBetweenScanSuccess: 600,
      });
      reader.possibleFormats = SCAN_FORMATS;
      readerRef.current = reader;

      try {
        const list = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(list);
        if (list.length === 0) {
          setStatus({
            kind: 'unsupported',
            message: 'No camera was found on this device. Use a USB scanner or type the barcode.',
          });
          return;
        }
        const controls = await reader.decodeFromVideoDevice(device, videoRef.current ?? undefined, (result) => {
          if (!result) return;
          const text = result.getText();
          if (!text) return;
          const now = Date.now();
          const last = lastCodeRef.current;
          if (last && last.code === text && now - last.at < SAME_CODE_COOLDOWN_MS) return;
          lastCodeRef.current = { code: text, at: now };
          setLastDetected(text);
          onDetect(text);
        });
        controlsRef.current = controls;
        setStatus({ kind: 'scanning' });
      } catch (error) {
        const name = (error as { name?: string })?.name ?? '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setStatus({
            kind: 'denied',
            message:
              'Camera permission was declined. Allow camera access in your browser settings, or use a USB scanner / manual entry.',
          });
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus({
            kind: 'unsupported',
            message: 'No usable camera was found. Use a USB scanner or type the barcode.',
          });
        } else {
          setStatus({
            kind: 'error',
            message: 'The camera could not start. Close other apps using the camera and try again.',
          });
        }
      }
    },
    [onDetect, stop],
  );

  useEffect(() => {
    if (!open) {
      stop();
      setLastDetected(null);
      lastCodeRef.current = null;
      return;
    }
    void start(deviceId);
    return stop;
    // Restart only when the modal opens or the chosen camera changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Camera barcode scanner"
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-modal">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-ink">Camera scanner</h2>
              <p className="text-[11px] text-muted">Point the camera at the product barcode.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink"
            aria-label="Close camera scanner"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
            aria-label="Camera preview"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-1/3 w-4/5 rounded-lg border-2 border-primary/90 shadow-[0_0_0_9999px_rgba(23,33,27,0.35)]" aria-hidden="true" />
          </div>
          {status.kind === 'starting' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/80 text-white">
              <Spinner className="h-6 w-6" />
              <p className="text-sm font-medium">Starting camera…</p>
            </div>
          ) : null}
          {status.kind === 'denied' || status.kind === 'unsupported' || status.kind === 'error' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/90 p-5 text-center text-white">
              <CameraOff className="h-6 w-6 text-warn" aria-hidden="true" />
              <p className="text-sm leading-5">{status.message}</p>
              <Button variant="secondary" size="sm" onClick={() => void start(deviceId)}>
                Try again
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <span
                className={`h-2 w-2 rounded-full ${status.kind === 'scanning' ? 'animate-pulse bg-ok' : 'bg-warn'}`}
                aria-hidden="true"
              />
              {status.kind === 'scanning' ? 'Scanning…' : 'Camera idle'}
            </span>
            {lastDetected ? (
              <span className="truncate font-semibold text-primary-dark">Last seen: {lastDetected}</span>
            ) : null}
          </div>

          {devices.length > 1 ? (
            <label className="flex items-center gap-2 text-xs font-medium text-ink">
              <span>Camera</span>
              <select
                value={deviceId ?? ''}
                onChange={(event) => setDeviceId(event.target.value || undefined)}
                className="input-base flex-1"
              >
                {devices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={() => void start(deviceId)}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Restart
            </Button>
            <Button size="sm" onClick={onClose}>
              Done scanning
            </Button>
          </div>
          <p className="text-[11px] leading-4 text-muted">
            No images are recorded — decoding happens entirely in your browser. Camera scanning requires
            HTTPS (or localhost) and may be unavailable on some devices; a USB scanner or manual entry
            always works.
          </p>
        </div>
      </div>
    </div>
  );
}
