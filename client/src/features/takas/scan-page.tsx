import { AlertTriangle, CameraOff, Check, Flashlight, FlashlightOff, Keyboard, Loader2, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type QrScanner from 'qr-scanner';
import { parseJobsheetQr } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bi, bi } from '@/lib/bilingual';
import { cn } from '@/lib/utils';

type CameraState = 'starting' | 'running' | 'found' | 'insecure' | 'denied' | 'no-camera' | 'error';

/** Classifies a camera start failure (qr-scanner rejects with a string or a DOMException). */
function cameraError(err: unknown): CameraState {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const text = String(err instanceof Error ? err.message : err);
  if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied/i.test(text)) return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || /not found|no camera/i.test(text)) return 'no-camera';
  return 'error';
}

const CAMERA_MESSAGES: Record<'insecure' | 'denied' | 'no-camera' | 'error', { en: string; hi: string; icon: typeof CameraOff }> = {
  insecure: {
    en: 'The camera only works on a secure (https) website. Type the jobsheet number below instead.',
    hi: 'कैमरा सिर्फ सुरक्षित (https) वेबसाइट पर चलता है। नीचे जॉबशीट नंबर लिखें।',
    icon: ShieldAlert,
  },
  denied: {
    en: 'Camera permission was denied. Allow the camera for this website in the browser settings, or type the jobsheet number below.',
    hi: 'कैमरा की अनुमति नहीं मिली। ब्राउज़र सेटिंग में इस वेबसाइट को कैमरा की अनुमति दें, या नीचे जॉबशीट नंबर लिखें।',
    icon: CameraOff,
  },
  'no-camera': {
    en: 'No camera was found on this device. Type the jobsheet number below.',
    hi: 'इस डिवाइस में कैमरा नहीं मिला। नीचे जॉबशीट नंबर लिखें।',
    icon: CameraOff,
  },
  error: {
    en: "The camera couldn't be started. Close other apps using the camera and try again, or type the jobsheet number below.",
    hi: 'कैमरा चालू नहीं हो पाया। कैमरा इस्तेमाल करने वाले दूसरे ऐप बंद करके फिर कोशिश करें, या नीचे जॉबशीट नंबर लिखें।',
    icon: AlertTriangle,
  },
};

/** Live QR scanner with a square guide. Calls `onScan` once with the jobsheet number of a valid Rivoora QR. */
function CameraScanner({ onScan }: { onScan: (jobsheetNo: number) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const doneRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [state, setState] = useState<CameraState>('starting');
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Phone browsers only allow the camera on https (or localhost).
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('insecure');
      return;
    }
    let cancelled = false;
    let invalidTimer: number | undefined;
    let foundTimer: number | undefined;
    setState('starting');

    void (async () => {
      const { default: Scanner } = await import('qr-scanner');
      const video = videoRef.current;
      if (cancelled || !video) return;
      const scanner = new Scanner(
        video,
        (result) => {
          if (doneRef.current) return;
          const no = parseJobsheetQr(result.data);
          if (no === null) {
            // Not ours: say so and keep scanning.
            setInvalid(true);
            window.clearTimeout(invalidTimer);
            invalidTimer = window.setTimeout(() => setInvalid(false), 2500);
            return;
          }
          doneRef.current = true;
          setInvalid(false);
          setState('found');
          navigator.vibrate?.(80);
          scanner.stop();
          foundTimer = window.setTimeout(() => onScanRef.current(no), 350);
        },
        { preferredCamera: 'environment', maxScansPerSecond: 8, returnDetailedScanResult: true, onDecodeError: () => {} },
      );
      scannerRef.current = scanner;
      try {
        await scanner.start();
        if (cancelled) return;
        setState('running');
        const flash = await scanner.hasFlash().catch(() => false);
        if (!cancelled) setHasFlash(flash);
      } catch (err) {
        if (!cancelled) setState(cameraError(err));
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(invalidTimer);
      window.clearTimeout(foundTimer);
      // Stops the camera stream when leaving the screen.
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [attempt]);

  const toggleFlash = async () => {
    const s = scannerRef.current;
    if (!s) return;
    await s.toggleFlash().catch(() => undefined);
    setFlashOn(s.isFlashOn());
  };

  const failed = state === 'insecure' || state === 'denied' || state === 'no-camera' || state === 'error';
  if (failed) {
    const msg = CAMERA_MESSAGES[state];
    const Icon = msg.icon;
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900" role="status">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 size-6 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0 space-y-1.5">
            <p className="text-[15px] font-semibold leading-snug">{msg.en}</p>
            <p lang="hi" className="text-[15px] leading-snug">
              {msg.hi}
            </p>
          </div>
        </div>
        {state === 'insecure' && (
          <p className="mt-3 border-t border-amber-200 pt-3 text-xs leading-relaxed text-amber-800">
            <span className="font-semibold">For admins:</span> this page is open at <code className="break-all">{window.location.origin}</code>,
            which isn't a secure context. Serve the app over HTTPS (or open it on localhost) to enable the camera scanner.
          </p>
        )}
        {(state === 'error' || state === 'denied') && (
          <Button variant="secondary" size="lg" className="mt-4 w-full" onClick={() => {
              // Render the video element before the effect restarts the scanner.
              setState('starting');
              setAttempt((n) => n + 1);
            }}>
            <Bi en="Try again" hi="फिर कोशिश करें" layout="inline" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-2xl bg-slate-900 shadow-soft">
        <video ref={videoRef} className="size-full object-cover" muted playsInline aria-label={bi('Camera', 'कैमरा')} />

        {/* Square guide: matches qr-scanner's default scan region (the centred 2/3 of the frame). */}
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 size-2/3 -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] transition-colors',
            state === 'found' ? 'ring-4 ring-green-400' : invalid ? 'ring-4 ring-red-400' : 'ring-2 ring-white/80',
          )}
          aria-hidden
        >
          {state === 'running' && !invalid && (
            <span className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse rounded-full bg-white/70" />
          )}
        </div>

        {state === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
            <Loader2 className="size-8 animate-spin" aria-hidden />
            <Bi en="Starting camera…" hi="कैमरा चालू हो रहा है…" className="items-center text-center text-sm" />
          </div>
        )}
        {state === 'found' && (
          <div className="absolute inset-0 flex items-center justify-center" role="status">
            <span className="flex size-24 items-center justify-center rounded-full bg-green-500 text-white shadow-pop animate-in zoom-in-50">
              <Check className="size-14" strokeWidth={3} aria-label={bi('Found', 'मिल गया')} />
            </span>
          </div>
        )}
        {invalid && state === 'running' && (
          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-red-600/95 px-3 py-2 text-center text-white shadow-pop" role="alert">
            <Bi en="This is not a Rivoora jobsheet QR" hi="यह रिवोरा जॉबशीट का QR नहीं है" className="items-center text-sm font-semibold" />
          </div>
        )}

        {hasFlash && state === 'running' && (
          <button
            type="button"
            onClick={() => void toggleFlash()}
            className={cn(
              'absolute right-3 top-3 flex size-12 items-center justify-center rounded-full text-white backdrop-blur transition',
              flashOn ? 'bg-amber-400 text-slate-900' : 'bg-black/40 hover:bg-black/55',
            )}
            aria-pressed={flashOn}
            aria-label={flashOn ? bi('Torch off', 'टॉर्च बंद') : bi('Torch on', 'टॉर्च चालू')}
          >
            {flashOn ? <FlashlightOff className="size-6" /> : <Flashlight className="size-6" />}
          </button>
        )}
      </div>
      <p className="text-center text-sm text-slate-500">
        <Bi en="Point the camera at the QR code on the jobsheet" hi="कैमरा को जॉबशीट के QR कोड पर रखें" className="items-center text-center" />
      </p>
    </div>
  );
}

function ManualEntry({ onOpen }: { onOpen: (jobsheetNo: number) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<ReactNode>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!/^\d+$/.test(value) || n < 1) {
      setError(<Bi en="Type the jobsheet number" hi="जॉबशीट नंबर लिखें" layout="inline" />);
      return;
    }
    onOpen(n);
  };
  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-white p-4 shadow-soft" noValidate>
      <label htmlFor="manual-jobsheet-no" className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-slate-800">
        <Keyboard className="size-5 shrink-0 text-slate-400" aria-hidden />
        <Bi en="Type jobsheet number" hi="जॉबशीट नंबर लिखें" />
      </label>
      <div className="flex gap-2">
        <Input
          id="manual-jobsheet-no"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/\D/g, '').slice(0, 9));
            setError(null);
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="go"
          placeholder="319"
          invalid={!!error}
          className="h-14 min-w-0 flex-1 text-2xl font-bold tabular-nums"
        />
        <Button type="submit" size="lg" className="h-14 shrink-0 px-5">
          <Bi en="Open" hi="खोलें" className="items-center" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/** `/scan` — the Taka entry role's landing: scan the QR on a jobsheet (or type its number). */
export default function ScanPage() {
  usePageTitle(bi('Scan jobsheet', 'जॉबशीट स्कैन करें'));
  const navigate = useNavigate();
  const open = (no: number) => navigate(`/j/${no}`);
  return (
    <div className="page-container max-w-xl space-y-4 pb-6 pt-4 md:py-6">
      <CameraScanner onScan={open} />
      <ManualEntry onOpen={open} />
    </div>
  );
}
