import { ArrowLeftRight, CheckCircle2, ChevronRight, ClipboardCheck, CornerDownRight, Factory, Inbox, Play, Printer, SearchX } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getJobsheetStatus,
  JOBSHEET_STATUS,
  JOBSHEET_TABS,
  jobsheetRef,
  jobsheetStatusLabel,
  type JobsheetStatusKey,
  type JobsheetTab,
  type SupervisorJobsheetItem,
  type SupervisorOrderHeader,
  type SupervisorOrderItem,
  EMPTY_WORK_FILTERS,
  WORK_FILTER_PARAM_KEYS,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, FetchingIndicator, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { useDebounce } from '@/hooks/useDebounce';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { formatDate, formatElapsed, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { printUrl, useSupervisorJobsheets, useSupervisorOrders } from './api';
import { FramesValue, machineNumbers } from './parts';
import { JobsheetRunDialogs, type RunAction, type RunJobsheet } from './run-dialogs';
import { BlouseTag } from '../free-stock/blouse';
import { FiltersButton, useWorkFilters, WorkFilterChips, WorkFiltersDialog, workFilterSearch, type WorkFilterField } from '../filters/work-filters';

/** The supervisor's Filters modal: loom-wise, quality, order type, blouse and the date the jobsheet was sent. */
const JOBSHEET_FILTER_FIELDS: readonly WorkFilterField[] = ['loom', 'quality', 'type', 'blouse', 'date'];

// The supervisor's labels: Sent = "Pending", Ongoing = "On-loom" (from the status config's roleLabels).
const TAB_LABEL: Record<JobsheetTab, string> = {
  all: 'All',
  pending: jobsheetStatusLabel('sent', 'supervisor'),
  ongoing: jobsheetStatusLabel('ongoing', 'supervisor'),
  completed: jobsheetStatusLabel('completed', 'supervisor'),
};

const EMPTY: Record<JobsheetTab, { title: string; description: string; icon: typeof Inbox }> = {
  all: { title: 'No jobsheets yet', description: 'Jobsheets sent by the office appear here.', icon: ClipboardCheck },
  pending: { title: 'No jobsheets waiting', description: 'New jobsheets from the office appear here, ready to start.', icon: Inbox },
  ongoing: { title: 'Nothing on-loom right now', description: 'Start a pending jobsheet to see it here.', icon: Factory },
  completed: { title: 'No completed jobsheets yet', description: 'Completed jobsheets appear here, newest first.', icon: CheckCircle2 },
};

// Two cards side by side from 480px, so portrait tablets (often 600–760px wide) don't show one huge card per row.
const GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4';

const isTab = (v: string | null): v is JobsheetTab => !!v && (JOBSHEET_TABS as readonly string[]).includes(v);

type View = 'order' | 'all';
const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'order', label: 'Order' },
  { value: 'all', label: 'All' },
];

function toRun(js: SupervisorJobsheetItem): RunJobsheet {
  return {
    id: js.id,
    jobsheetNo: js.jobsheetNo,
    orderNo: js.orderNo,
    status: js.status,
    frames: js.frames,
    machines: js.machines,
    runningMachine: js.runningMachine,
    suggestedMachineId: js.suggestedMachineId,
    designCode: js.designCode,
    thumbUrl: js.thumbUrl,
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="truncate text-[15px] font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * The design as a small thumbnail beside the card title (like the Orders cards); tapping it opens the full image.
 * Clicks in the lightbox bubble through the portal — keep them from the card.
 */
export function CardThumb({ thumbUrl, imageUrl, code }: { thumbUrl: string | null; imageUrl: string | null; code: string | null }) {
  return (
    <div className="shrink-0" onClick={thumbUrl ? (e) => e.stopPropagation() : undefined}>
      <ImageThumb thumbUrl={thumbUrl} fullUrl={imageUrl} alt={code ? `Design ${code}` : 'No design'} className="size-16" rounded="rounded-lg" />
    </div>
  );
}

function JobsheetTile({ js, now, onOpen, onAction }: { js: SupervisorJobsheetItem; now: number; onOpen: () => void; onAction: (a: RunAction) => void }) {
  const run = toRun(js);
  const navigate = useNavigate();
  const { can } = useRole();
  const action = (kind: RunAction['kind']) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onAction({ kind, js: run });
  };
  const suggested = js.suggestedMachineId ? js.machines.find((m) => m.id === js.suggestedMachineId) : null;

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
      aria-label={`Open ${jobsheetRef(js.orderNo, js.jobsheetNo)}`}
      className="flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-white shadow-soft outline-none transition hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <CardThumb thumbUrl={js.thumbUrl} imageUrl={js.imageUrl} code={js.designCode} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold leading-tight text-slate-900">
              <JobsheetRef orderNo={js.orderNo} jobsheetNo={js.jobsheetNo} />
            </p>
            <p className="truncate text-sm text-slate-500">
              {js.designCode ? `Design ${js.designCode}` : 'No design'} · {js.quality}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge kind="jobsheet" status={js.status} className="text-[13px]" />
              {js.blouseOption && <BlouseTag option={js.blouseOption} />}
            </div>
          </div>
          {can('canPrintJobsheets') && (
            <Tooltip content="Print jobsheet">
              <button
                type="button"
                title="Print jobsheet"
                aria-label={`Print ${jobsheetRef(js.orderNo, js.jobsheetNo)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(printUrl([js.id]));
                }}
                className="-mr-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 ring-1 ring-border transition hover:bg-slate-50 hover:text-slate-900 active:scale-95"
              >
                <Printer className="size-5" />
              </button>
            </Tooltip>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          <Fact label={js.status === JOBSHEET_STATUS.COMPLETED ? 'Frames made' : 'Frames'}>
            <FramesValue status={js.status} frames={js.frames} completedFrames={js.completedFrames} withUnit />
          </Fact>
          {js.runningMachine && (js.status === JOBSHEET_STATUS.ONGOING || js.status === JOBSHEET_STATUS.COMPLETED) ? (
            <Fact label={js.status === JOBSHEET_STATUS.ONGOING ? 'Running on' : 'Ran on'}>
              {js.status === JOBSHEET_STATUS.ONGOING ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-blue-600">
                  <span className="relative flex size-2 shrink-0" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
                  </span>
                  <span className="truncate">
                    Machine {js.runningMachine.machineNo}
                    {js.startedAt && <span className="font-medium text-blue-600/80"> · {formatElapsed(js.startedAt, now)} ago</span>}
                  </span>
                </span>
              ) : (
                `Machine ${js.runningMachine.machineNo}`
              )}
            </Fact>
          ) : null}
          <div className="col-span-2">
            <Fact label="Assigned looms">{machineNumbers(js.machines)}</Fact>
          </div>
        </dl>

        {js.status === JOBSHEET_STATUS.COMPLETED && <p className="text-sm text-slate-500">Completed {formatDate(js.completedAt)}</p>}
        {js.status === JOBSHEET_STATUS.SENT && suggested && (
          <p className="text-sm font-medium text-primary">Suggested: Machine {suggested.machineNo}</p>
        )}
        {js.parentJobsheetNo !== null && (
          <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <CornerDownRight className="size-3.5 shrink-0" aria-hidden /> continued from #{js.orderNo} ({js.parentJobsheetNo})
          </p>
        )}
      </div>

      {js.status === JOBSHEET_STATUS.SENT && (
        <div className="border-t border-border p-3">
          <Button size="lg" className="w-full" onClick={action('start')}>
            <Play /> Start
          </Button>
        </div>
      )}
      {js.status === JOBSHEET_STATUS.ONGOING && (
        <div className="flex items-center gap-2 border-t border-border p-3">
          <Button size="lg" className="flex-1" onClick={action('complete')}>
            <CheckCircle2 /> Complete
          </Button>
          <Tooltip content="Change machine">
            <Button
              variant="secondary"
              size="lg"
              className="w-12 shrink-0 px-0"
              title="Change machine"
              aria-label="Change machine"
              onClick={action('change')}
            >
              <ArrowLeftRight />
            </Button>
          </Tooltip>
        </div>
      )}
    </article>
  );
}

function GridSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
          <div className="space-y-3 p-4">
            <div className="flex gap-3">
              <Skeleton className="size-16 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-10" />
          </div>
          <div className="border-t border-border p-3">
            <Skeleton className="h-12 rounded-[10px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Keeps the debounced search text in the URL (`q`), so opening a card and coming back keeps it. */
function useUrlSearch() {
  const [params, setParams] = useSearchParams();
  const [searchText, setSearchText] = useState(params.get('q') ?? '');
  const search = useDebounce(searchText, 300).trim();
  useEffect(() => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (search) next.set('q', search);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [search, setParams]);
  return { searchText, setSearchText, search };
}

/**
 * The supervisor's jobsheet list: tabs (All / Pending / On-loom / Completed with counts), search and the jobsheet
 * cards with Start / Complete / Change machine. `orderId` = one order's jobsheets (Order view); `onOrder` gets that
 * order's header once loaded.
 */
export function SupervisorJobsheetList({
  orderId,
  onOrder,
}: {
  orderId?: number;
  onOrder?: (order: SupervisorOrderHeader | null, error: unknown) => void;
}) {
  const navigate = useNavigate();
  const { can } = useRole();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const tab: JobsheetTab = isTab(params.get('tab')) ? (params.get('tab') as JobsheetTab) : 'all';
  const { searchText, setSearchText, search } = useUrlSearch();
  const [run, setRun] = useState<RunAction | null>(null);
  const work = useWorkFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const setTab = (t: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (t === 'all') next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: true },
    );

  const query = useSupervisorJobsheets(tab, search, orderId, work.query);
  const { items, total, counts, order, isPending, isError, error, refetch } = query;
  useEffect(() => {
    onOrder?.(order, isError ? error : null);
  }, [order, isError, error, onOrder]);
  const empty =
    search || work.count
      ? {
          title: search ? 'No jobsheets match your search' : 'No jobsheets match the filters',
          description: search ? 'Try an order number, a jobsheet number or a design code.' : 'Change or clear the filters.',
          icon: SearchX,
        }
      : EMPTY[tab];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchBar
          value={searchText}
          onChange={setSearchText}
          placeholder={orderId ? 'Search jobsheet no…' : 'Search order no, jobsheet no or design…'}
          className="md:max-w-md"
        />
        <FetchingIndicator show={query.isFetching && !isPending && !query.isFetchingNextPage} />
        <FiltersButton count={work.count} onClick={() => setFiltersOpen(true)} />
      </div>
      <WorkFilterChips value={work.filters} onChange={work.setFilters} />
      <WorkFiltersDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        value={work.filters}
        onApply={work.setFilters}
        fields={JOBSHEET_FILTER_FIELDS}
        title="Filter jobsheets"
        dateLabel="Sent date"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="md:max-w-2xl" aria-label="Jobsheet status">
          {JOBSHEET_TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="group min-h-12 px-2 text-[15px] font-semibold">
              <span className="truncate">{TAB_LABEL[t]}</span>
              {counts && (
                <span className="ml-1.5 rounded-full bg-slate-200/80 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-600 group-data-[state=active]:bg-primary-soft group-data-[state=active]:text-primary">
                  {counts[t]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isPending ? (
        <GridSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            description={empty.description}
            action={
              search ? (
                <Button variant="secondary" onClick={() => setSearchText('')}>
                  Clear search
                </Button>
              ) : work.count ? (
                <Button variant="secondary" onClick={() => work.setFilters(EMPTY_WORK_FILTERS)}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <ul className={cn(GRID, query.isPlaceholderData && 'opacity-60 transition-opacity')}>
            {items.map((js) => (
              <li key={js.id} className="min-w-0">
                <JobsheetTile js={js} now={now} onOpen={() => navigate(`/jobsheets/${js.id}`)} onAction={setRun} />
              </li>
            ))}
          </ul>
          <LoadMore
            hasNextPage={!!query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={() => void query.fetchNextPage()}
            shown={items.length}
            total={total}
            noun="jobsheets"
          />
        </>
      )}

      {can('canRunJobsheets') && <JobsheetRunDialogs action={run} onClose={() => setRun(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Order view                                                           */
/* ------------------------------------------------------------------ */

/** "Pending 2" pill in the supervisor's label + colours of that jobsheet status. */
function CountPill({ status, n }: { status: JobsheetStatusKey; n: number }) {
  const s = getJobsheetStatus(status);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold', n === 0 && 'opacity-50')}
      style={{ backgroundColor: s.badge.bg, color: s.badge.text }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.badge.dot }} aria-hidden />
      {jobsheetStatusLabel(status, 'supervisor')}
      <span className="tabular-nums">{n}</span>
    </span>
  );
}

function OrderTile({ order, onOpen }: { order: SupervisorOrderItem; onOpen: () => void }) {
  const { counts } = order;
  const done = counts.total > 0 ? counts.completed / counts.total : 0;
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
      aria-label={`Open the jobsheets of order ${formatOrderNo(order.orderNo)}`}
      className="flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-white shadow-soft outline-none transition hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <CardThumb thumbUrl={order.designThumbUrl} imageUrl={order.designImageUrl} code={order.designCode} />
          <div className="min-w-0">
            <p className="text-xl font-bold leading-tight text-slate-900">Order {formatOrderNo(order.orderNo)}</p>
            <p className="truncate text-sm text-slate-500">{order.designCode ? `Design ${order.designCode}` : 'No design'}</p>
            {order.blouseOption && <BlouseTag option={order.blouseOption} className="mt-1" />}
          </div>
        </div>
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="shrink-0 text-slate-500">Quality:</dt>
            <dd className="min-w-0 truncate font-semibold text-slate-800">{order.quality}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="shrink-0 text-slate-500">Machines:</dt>
            <dd className="min-w-0 font-semibold text-slate-800">{order.machineNos.length ? order.machineNos.join(', ') : '—'}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-1.5" aria-label="Jobsheets per status">
          <CountPill status="sent" n={counts.pending} />
          <CountPill status="ongoing" n={counts.ongoing} />
          <CountPill status="completed" n={counts.completed} />
        </div>
        <div className="mt-auto space-y-1">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={counts.total}
            aria-valuenow={counts.completed}
            aria-label={`${counts.completed} of ${counts.total} jobsheets completed`}
          >
            <div className="h-full rounded-full" style={{ width: `${done * 100}%`, backgroundColor: getJobsheetStatus('completed').badge.dot }} />
          </div>
          <p className="text-xs font-medium text-slate-500">
            {counts.completed} of {counts.total} completed
          </p>
        </div>
      </div>
      <div className="border-t border-border p-3">
        <Button
          size="lg"
          variant="secondary"
          className="w-full"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          View jobsheets ({counts.total}) <ChevronRight />
        </Button>
      </div>
    </article>
  );
}

/** Order view, level 1: one card per order (number + design only — never the client). */
function SupervisorOrdersList() {
  const navigate = useNavigate();
  const { searchText, setSearchText, search } = useUrlSearch();
  const work = useWorkFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useSupervisorOrders(search, work.query);
  const { items, total, isPending, isError, error, refetch } = query;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchBar value={searchText} onChange={setSearchText} placeholder="Search order no or design…" className="md:max-w-md" />
        <FetchingIndicator show={query.isFetching && !isPending && !query.isFetchingNextPage} />
        <FiltersButton count={work.count} onClick={() => setFiltersOpen(true)} />
      </div>
      <WorkFilterChips value={work.filters} onChange={work.setFilters} />
      <WorkFiltersDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        value={work.filters}
        onApply={work.setFilters}
        fields={JOBSHEET_FILTER_FIELDS}
        title="Filter orders"
        dateLabel="Jobsheet sent date"
      />
      {isPending ? (
        <GridSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {search ? (
            <EmptyState
              icon={SearchX}
              title="No orders match your search"
              description="Try an order number or a design code."
              action={
                <Button variant="secondary" onClick={() => setSearchText('')}>
                  Clear search
                </Button>
              }
            />
          ) : work.count ? (
            <EmptyState
              icon={SearchX}
              title="No orders match the filters"
              description="Change or clear the filters."
              action={
                <Button variant="secondary" onClick={() => work.setFilters(EMPTY_WORK_FILTERS)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState icon={ClipboardCheck} title="No jobsheets yet" description="Jobsheets sent by the office appear here, grouped by order." />
          )}
        </div>
      ) : (
        <>
          <ul className={cn(GRID, query.isPlaceholderData && 'opacity-60 transition-opacity')}>
            {items.map((o) => (
              <li key={o.orderId} className="min-w-0">
                {/* The filters go along: the order's jobsheets open filtered the same way. */}
                <OrderTile order={o} onOpen={() => navigate(`/jobsheets/order/${o.orderId}${workFilterSearch(work.filters)}`)} />
              </li>
            ))}
          </ul>
          <LoadMore
            hasNextPage={!!query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={() => void query.fetchNextPage()}
            shown={items.length}
            total={total}
            noun="orders"
          />
        </>
      )}
    </div>
  );
}

/** The supervisor's Jobsheets module (tablet-first): Order view (default) or All jobsheets, kept in the URL. */
export default function SupervisorJobsheetsPage() {
  usePageTitle('Jobsheets');
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'all' ? 'all' : 'order';
  const setView = (v: View) =>
    setParams(
      (prev) => {
        // Each view has its own search / tab — start clean; the filters stay.
        const next = new URLSearchParams();
        if (v === 'all') next.set('view', 'all');
        for (const k of WORK_FILTER_PARAM_KEYS) {
          const val = prev.get(k);
          if (val) next.set(k, val);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <div className="page-container space-y-4 pb-24 pt-4 md:py-5">
      <Segmented<View> options={VIEW_OPTIONS} value={view} onChange={setView} size="lg" aria-label="View" className="max-w-xs" />
      {/* key: the search box re-reads the URL when the view changes. */}
      {view === 'all' ? <SupervisorJobsheetList key="all" /> : <SupervisorOrdersList key="order" />}
    </div>
  );
}
