import { AlertTriangle, ClipboardCheck, Loader2, PackageOpen, ScanSearch } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { challanLabel, cleanTakaNo, formatMeters, takaNoError, TAKA_NO_MAX_LENGTH, type QcPendingTaka } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { Bi, bi } from '@/lib/bilingual';
import { useDebounce } from '@/hooks/useDebounce';
import { formatOrderNo, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { fetchTakaByNo, useQcPending } from '../butta-qc/api';
import { useMillQcPending } from '../mill-qc/api';

type QcKind = 'butta' | 'mill';

const buttaPath = (takaNo: string) => `/butta-qc/taka/${encodeURIComponent(takaNo)}`;
const millPath = (takaNo: string) => `/mill-qc/taka/${encodeURIComponent(takaNo)}`;

/** The tag that says which QC a pending taka is waiting for. */
const KIND_TAG: Record<QcKind, { en: string; hi: string; className: string }> = {
  butta: { en: 'Butta', hi: 'बुट्टा', className: 'bg-amber-100 text-amber-800' },
  mill: { en: 'Mill', hi: 'मिल', className: 'bg-violet-100 text-violet-800' },
};

type PendingItem = QcPendingTaka & { kind: QcKind };

function PendingRow({ taka, onOpen }: { taka: PendingItem; onOpen: () => void }) {
  const tag = KIND_TAG[taka.kind];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-2.5 text-left shadow-soft transition hover:border-primary/40 active:bg-slate-50"
        aria-label={bi(`Check taka ${taka.takaNo} (${tag.en} QC)`, `टाका ${taka.takaNo} जांचें (${tag.hi} QC)`)}
      >
        <span className="text-2xl font-bold tabular-nums text-slate-900">{taka.takaNo}</span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-slate-600">
          {formatOrderNo(taka.orderNo)}
          {taka.meters != null && <span className="ml-2 text-slate-400">{formatMeters(taka.meters)}</span>}
          {taka.challanNo != null && <span className={cn('ml-2', taka.kind === 'mill' ? 'text-violet-700' : 'text-amber-700')}>{challanLabel(taka.challanNo, taka.kind)}</span>}
        </span>
        {taka.isDamaged && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
            <AlertTriangle className="size-3" aria-hidden /> Damage
          </span>
        )}
        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold', tag.className)}>
          {tag.en} / <span lang="hi">{tag.hi}</span>
        </span>
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{formatTime(taka.receivedAt)}</span>
      </button>
    </li>
  );
}

/**
 * QC home (`/qc`, bilingual, phone-first): one taka number box for both QCs. The taka's stage decides which screen
 * opens (Butta QC or Mill QC). Below it, the takas waiting for either QC, each tagged Butta / Mill.
 */
export default function QcHomePage() {
  usePageTitle(bi('QC', 'क्यूसी'));
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [opening, setOpening] = useState(false);
  const [alert, setAlert] = useState<{ en: string; hi: string } | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300).trim();
  const butta = useQcPending(debounced);
  const mill = useMillQcPending(debounced);
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

  // Both lists in one, newest first.
  const items = useMemo<PendingItem[]>(
    () =>
      [...butta.items.map((t) => ({ ...t, kind: 'butta' as const })), ...mill.items.map((t) => ({ ...t, kind: 'mill' as const }))].sort((a, b) =>
        (b.receivedAt ?? '').localeCompare(a.receivedAt ?? ''),
      ),
    [butta.items, mill.items],
  );
  const total = butta.total !== undefined && mill.total !== undefined ? butta.total + mill.total : undefined;
  const isPending = butta.isPending || mill.isPending;
  const error = butta.error ?? mill.error;
  const hasNextPage = !!butta.hasNextPage || !!mill.hasNextPage;

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

      <section aria-label={bi('QC pending', 'जांच बाकी')} className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <ClipboardCheck className="size-5 text-primary" aria-hidden />
            <Bi en="QC pending" hi="जांच बाकी" layout="inline" />
          </h2>
          {total !== undefined && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-bold text-amber-800">{total}</span>}
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder={bi('Search by taka no', 'टाका नंबर खोजें')} />
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => void Promise.all([butta.refetch(), mill.refetch()])} />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-4 py-10 text-center text-slate-500">
            <PackageOpen className="mb-2 size-8 text-slate-300" aria-hidden />
            <p className="font-semibold">{debounced ? 'No takas match' : 'No takas waiting for QC'}</p>
            <p lang="hi" className="text-sm">
              {debounced ? 'कोई टाका नहीं मिला' : 'कोई टाका जांच के लिए बाकी नहीं'}
            </p>
          </div>
        ) : (
          <>
            <ul className={cn('space-y-2', (butta.isPlaceholderData || mill.isPlaceholderData) && 'opacity-60')}>
              {items.map((t) => (
                <PendingRow key={`${t.kind}-${t.id}`} taka={t} onOpen={() => navigate(t.kind === 'butta' ? buttaPath(t.takaNo) : millPath(t.takaNo))} />
              ))}
            </ul>
            <LoadMore
              hasNextPage={hasNextPage}
              isFetchingNextPage={butta.isFetchingNextPage || mill.isFetchingNextPage}
              fetchNextPage={() => {
                if (butta.hasNextPage) void butta.fetchNextPage();
                if (mill.hasNextPage) void mill.fetchNextPage();
              }}
              shown={items.length}
              total={total}
              noun="takas"
              bilingual
            />
          </>
        )}
        {(butta.isFetching || mill.isFetching) && !isPending && !butta.isFetchingNextPage && !mill.isFetchingNextPage && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Updating
          </p>
        )}
      </section>
    </div>
  );
}
