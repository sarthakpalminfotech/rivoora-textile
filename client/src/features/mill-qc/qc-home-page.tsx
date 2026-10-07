import { AlertTriangle, ClipboardCheck, Loader2, PackageOpen, ScanSearch } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { challanLabel, cleanTakaNo, formatMeters, MILL_QC_TEXT, takaNoError, TAKA_NO_MAX_LENGTH, type QcPendingTaka } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { Bi, bi } from '@/lib/bilingual';
import { useDebounce } from '@/hooks/useDebounce';
import { formatOrderNo, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { fetchMillQcTaka, useMillQcPending } from './api';

export const millQcTakaPath = (takaNo: string) => `/mill-qc/taka/${encodeURIComponent(takaNo)}`;

function PendingRow({ taka, onOpen }: { taka: QcPendingTaka; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-2.5 text-left shadow-soft transition hover:border-primary/40 active:bg-slate-50"
        aria-label={bi(`Check taka ${taka.takaNo}`, `टाका ${taka.takaNo} जांचें`)}
      >
        <span className="text-2xl font-bold tabular-nums text-slate-900">{taka.takaNo}</span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-slate-600">
          {formatOrderNo(taka.orderNo)}
          {taka.meters != null && <span className="ml-2 text-slate-400">{formatMeters(taka.meters)}</span>}
          {taka.challanNo != null && <span className="ml-2 text-violet-700">{challanLabel(taka.challanNo, 'mill')}</span>}
        </span>
        {taka.isDamaged && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
            <AlertTriangle className="size-3" aria-hidden /> Damage
          </span>
        )}
        <span className="shrink-0 text-xs text-slate-400">{formatTime(taka.receivedAt)}</span>
      </button>
    </li>
  );
}

/** Mill QC home (`/mill-qc`, bilingual, phone-first): open a taka by number, or pick one from "QC pending". */
export default function MillQcHomePage() {
  usePageTitle(bi('Mill QC', 'मिल QC'));
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [opening, setOpening] = useState(false);
  const [alert, setAlert] = useState<{ en: string; hi: string } | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300).trim();
  const query = useMillQcPending(debounced);
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
      const { taka, state } = await fetchMillQcTaka(no);
      if (state === 'never_sent') {
        // Never sent to the mill (or marked for refinish): blocked.
        setAlert(MILL_QC_TEXT.neverSent);
        inputRef.current?.focus();
      } else {
        navigate(millQcTakaPath(taka.takaNo));
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
        <label htmlFor="mqc-no" className="mb-2 block text-sm font-semibold text-slate-600">
          Taka number / <span lang="hi">टाका नंबर</span>
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="mqc-no"
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

      <section aria-label={bi('QC pending', 'जांच बाकी')} className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <ClipboardCheck className="size-5 text-primary" aria-hidden />
            <Bi en="QC pending" hi="जांच बाकी" layout="inline" />
          </h2>
          {query.total !== undefined && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-bold text-amber-800">{query.total}</span>}
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder={bi('Search by taka no', 'टाका नंबर खोजें')} />
        {query.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.items.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-4 py-10 text-center text-slate-500">
            <PackageOpen className="mb-2 size-8 text-slate-300" aria-hidden />
            <p className="font-semibold">{debounced ? 'No takas match' : 'No takas waiting for QC'}</p>
            <p lang="hi" className="text-sm">
              {debounced ? 'कोई टाका नहीं मिला' : 'कोई टाका जांच के लिए बाकी नहीं'}
            </p>
          </div>
        ) : (
          <>
            <ul className={cn('space-y-2', query.isPlaceholderData && 'opacity-60')}>
              {query.items.map((t) => (
                <PendingRow key={t.id} taka={t} onOpen={() => navigate(millQcTakaPath(t.takaNo))} />
              ))}
            </ul>
            <LoadMore
              hasNextPage={!!query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              fetchNextPage={() => void query.fetchNextPage()}
              shown={query.items.length}
              total={query.total}
              noun="takas"
              bilingual
            />
          </>
        )}
        {query.isFetching && !query.isPending && !query.isFetchingNextPage && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Updating
          </p>
        )}
      </section>
    </div>
  );
}

