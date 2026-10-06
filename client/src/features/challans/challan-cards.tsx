import { Ban, CheckCircle2, FileText, SearchX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CHALLAN_KIND_CONFIG, challanLabel, formatMeters, type ChallanFilter, type ChallanKind, type ChallanListItem } from '@rivoora/shared';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useChallans } from './api';
import { challanDetailsPath } from './kind';

/** One challan card: GSM-173 / MIL-12, party, date, totals and "8 / 20 received" with a thin progress bar. */
export function ChallanCard({ challan, onOpen }: { challan: ChallanListItem; onOpen: () => void }) {
  const cancelled = challan.status === 'cancelled';
  const done = challan.totalTakas > 0 && challan.receivedCount >= challan.totalTakas;
  const share = challan.totalTakas > 0 ? challan.receivedCount / challan.totalTakas : 0;
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open challan ${challanLabel(challan.challanNo, challan.kind)}`}
      className={cn(
        'flex h-full cursor-pointer flex-col gap-3 rounded-xl border bg-white p-4 shadow-soft outline-none transition hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40',
        cancelled ? 'border-slate-200 bg-slate-50' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('text-2xl font-bold leading-tight tabular-nums', cancelled ? 'text-slate-400 line-through' : 'text-slate-900')}>
            {challanLabel(challan.challanNo, challan.kind)}
          </p>
          <p className="truncate text-[15px] font-semibold text-slate-700">{challan.partyName}</p>
          <p className="text-sm text-slate-500">{formatDate(challan.challanDate)}</p>
        </div>
        {cancelled && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">
            <Ban className="size-3.5" aria-hidden /> Cancelled
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 text-sm">
        <div>
          <dt className="text-[12px] text-muted-foreground">Takas</dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">{challan.totalTakas}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted-foreground">Meters</dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">{formatMeters(challan.totalMeters)}</dd>
        </div>
      </dl>
      {!cancelled && (
        <div className="mt-auto space-y-1">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={challan.totalTakas}
            aria-valuenow={challan.receivedCount}
            aria-label={`${challan.receivedCount} of ${challan.totalTakas} received`}
          >
            <div className={cn('h-full rounded-full', done ? 'bg-green-500' : 'bg-amber-500')} style={{ width: `${share * 100}%` }} />
          </div>
          {done ? (
            <p className="inline-flex items-center gap-1 text-sm font-bold text-green-700">
              <CheckCircle2 className="size-4" aria-hidden /> All {challan.totalTakas} / {challan.totalTakas} received
            </p>
          ) : (
            <p className="text-sm font-semibold text-amber-700">
              {challan.receivedCount} / {challan.totalTakas} received
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </div>
  );
}

const EMPTY: Record<ChallanFilter, string> = {
  open: 'No challans waiting to be received',
  received: 'No fully received challans yet',
  all: 'No challans yet',
};

/**
 * A grid of challan cards for one filter + search. `live` (Receive → Challans) refetches every 10 s and on focus.
 * Clicking a card opens the challan details; `from` is where "back" returns to.
 */
export function ChallanList({ kind, filter, search, live, from }: { kind: ChallanKind; filter: ChallanFilter; search: string; live?: boolean; from: string }) {
  const navigate = useNavigate();
  const query = useChallans(kind, filter, search, live);
  if (query.isPending) return <GridSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        <EmptyState
          icon={search ? SearchX : FileText}
          title={search ? 'No challans match your search' : EMPTY[filter]}
          description={search || filter !== 'open' ? undefined : `Challans you create in Send → Pending appear here until their takas are back from ${CHALLAN_KIND_CONFIG[kind].place}.`}
        />
      </div>
    );
  }
  return (
    <>
      <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4', query.isPlaceholderData && 'opacity-60')}>
        {query.items.map((c) => (
          <ChallanCard key={c.id} challan={c} onOpen={() => navigate(challanDetailsPath(kind, c.id), { state: { from } })} />
        ))}
      </div>
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        shown={query.items.length}
        total={query.total}
        noun="challans"
      />
    </>
  );
}
