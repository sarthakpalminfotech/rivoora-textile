import { AlertTriangle, ScanSearch } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cleanTakaNo, takaNoError, TAKA_NO_MAX_LENGTH } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/lib/api';
import { Bi, bi } from '@/lib/bilingual';
import { cn } from '@/lib/utils';
import { fetchTakaByNo } from '../butta-qc/api';

const buttaPath = (takaNo: string) => `/butta-qc/taka/${encodeURIComponent(takaNo)}`;
const millPath = (takaNo: string) => `/mill-qc/taka/${encodeURIComponent(takaNo)}`;

/**
 * QC home (`/qc`, bilingual, phone-first): one taka number box for both QCs. The taka's stage decides which screen
 * opens (Butta QC or Mill QC). Nothing else on the screen.
 */
export default function QcHomePage() {
  usePageTitle(bi('QC', 'क्यूसी'));
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [opening, setOpening] = useState(false);
  const [alert, setAlert] = useState<{ en: string; hi: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = async () => {
    const no = value.trim();
    if (!no || opening) return;
    if (takaNoError(no)) {
      setAlert({ en: 'Use digits, - or / only', hi: 'सिर्फ अंक, - या / लिखें' });
      return;
    }
    setOpening(true);
    setAlert(null);
    try {
      const taka = await fetchTakaByNo(no);
      if (taka.stage === 'entered' || taka.stage === 'at_butta') {
        // Still at (or on its way to) butta cutting: nothing to check yet.
        setAlert({ en: 'This taka has not been received from butta cutting', hi: 'यह टाका अभी बुट्टा से वापस नहीं आया' });
        inputRef.current?.focus();
      } else if (taka.stage === 'butta_qc') {
        navigate(buttaPath(taka.takaNo));
      } else {
        // At / back from the mill, or past it: the Mill QC screen explains the state.
        navigate(millPath(taka.takaNo));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setAlert({ en: 'Taka not found', hi: 'टाका नहीं मिला' });
      else setAlert({ en: errorMessage(err), hi: '' });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="page-container max-w-2xl space-y-5 pb-28 pt-4 md:py-6">
      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <label htmlFor="qc-no" className="mb-2 block text-sm font-semibold text-slate-600">
          Taka number / <span lang="hi">टाका नंबर</span>
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="qc-no"
            value={value}
            autoFocus
            onChange={(e) => {
              setValue(cleanTakaNo(e.target.value));
              if (alert) setAlert(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void open();
              }
            }}
            inputMode="tel"
            autoComplete="off"
            enterKeyHint="go"
            maxLength={TAKA_NO_MAX_LENGTH}
            placeholder="—"
            aria-invalid={!!alert || undefined}
            className={cn(
              'h-16 min-w-0 flex-1 rounded-xl border bg-white px-4 text-3xl font-bold tabular-nums tracking-wide text-slate-900 focus:outline-none focus:ring-2',
              alert ? 'border-destructive focus:ring-destructive/20' : 'border-input focus:border-primary focus:ring-primary/15',
            )}
          />
          <Button size="lg" className="h-16 shrink-0 px-5 text-lg" onClick={() => void open()} disabled={!value.trim()} loading={opening}>
            <ScanSearch className="!size-6" />
            <Bi en="Open" hi="खोलें" className="items-start" />
          </Button>
        </div>
        {alert && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base font-semibold text-red-700">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              {alert.en}
              {alert.hi && (
                <span lang="hi" className="block font-bold">
                  {alert.hi}
                </span>
              )}
            </span>
          </p>
        )}
      </section>

    </div>
  );
}
