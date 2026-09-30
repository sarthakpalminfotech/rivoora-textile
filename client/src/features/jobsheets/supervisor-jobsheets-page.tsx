import { ArrowLeftRight, CheckCircle2, ClipboardCheck, CornerDownRight, Factory, Inbox, Play, SearchX } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { JOBSHEET_STATUS, JOBSHEET_TABS, type JobsheetTab, type SupervisorJobsheetItem } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, FetchingIndicator, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { useDebounce } from '@/hooks/useDebounce';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { formatDate, formatElapsed, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSupervisorJobsheets } from './api';
import { FramesValue, machineNumbers } from './parts';
import { JobsheetRunDialogs, type RunAction, type RunJobsheet } from './run-dialogs';

const TAB_LABEL: Record<JobsheetTab, string> = { all: 'All', pending: 'Pending', ongoing: 'Ongoing', completed: 'Completed' };

const EMPTY: Record<JobsheetTab, { title: string; description: string; icon: typeof Inbox }> = {
  all: { title: 'No jobsheets yet', description: 'Jobsheets sent by the office appear here.', icon: ClipboardCheck },
  pending: { title: 'No jobsheets waiting', description: 'New jobsheets from the office appear here, ready to start.', icon: Inbox },
  ongoing: { title: 'Nothing running right now', description: 'Start a pending jobsheet to see it here.', icon: Factory },
  completed: { title: 'No completed jobsheets yet', description: 'Completed jobsheets appear here, newest first.', icon: CheckCircle2 },
};

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

const isTab = (v: string | null): v is JobsheetTab => !!v && (JOBSHEET_TABS as readonly string[]).includes(v);

function toRun(js: SupervisorJobsheetItem): RunJobsheet {
  return {
    id: js.id,
    jobsheetNo: js.jobsheetNo,
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

function JobsheetTile({ js, now, onOpen, onAction }: { js: SupervisorJobsheetItem; now: number; onOpen: () => void; onAction: (a: RunAction) => void }) {
  const run = toRun(js);
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
      aria-label={`Open jobsheet ${js.jobsheetNo}`}
      className="flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-white shadow-soft outline-none transition hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {/* Clicks inside the lightbox bubble through the React portal — keep them from opening the card. */}
      <div onClick={js.thumbUrl ? (e) => e.stopPropagation() : undefined}>
        <ImageThumb
          thumbUrl={js.thumbUrl}
          fullUrl={js.imageUrl}
          alt={js.designCode ? `Design ${js.designCode}` : 'No design'}
          className="aspect-[16/10] w-full"
          rounded="rounded-none"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-2xl font-bold leading-tight text-slate-900">
            <span className="sr-only">Jobsheet </span>
            <span aria-hidden className="mr-1.5 text-base font-semibold text-slate-400">Jobsheet</span>
            {js.jobsheetNo}
          </p>
          <StatusBadge kind="jobsheet" status={js.status} className="mt-1 shrink-0 text-[13px]" />
        </div>
        <p className="-mt-1.5 truncate text-sm text-slate-500">
          {js.designCode ? `Design ${js.designCode}` : 'No design'} · Order {formatOrderNo(js.orderNo)}
        </p>

        <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          <Fact label={js.status === JOBSHEET_STATUS.COMPLETED ? 'Frames made' : 'Frames'}>
            <FramesValue status={js.status} frames={js.frames} completedFrames={js.completedFrames} withUnit />
          </Fact>
          <Fact label="Machine">
            {js.status === JOBSHEET_STATUS.ONGOING && js.runningMachine ? (
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
            ) : js.status === JOBSHEET_STATUS.COMPLETED && js.runningMachine ? (
              `Machine ${js.runningMachine.machineNo}`
            ) : (
              machineNumbers(js.machines)
            )}
          </Fact>
        </dl>

        {js.status === JOBSHEET_STATUS.COMPLETED && (
          <p className="text-sm text-slate-500">
            Completed {formatDate(js.completedAt)}
          </p>
        )}
        {js.status === JOBSHEET_STATUS.SENT && suggested && (
          <p className="text-sm font-medium text-primary">Suggested: Machine {suggested.machineNo}</p>
        )}
        {js.parentJobsheetNo !== null && (
          <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <CornerDownRight className="size-3.5 shrink-0" aria-hidden /> continued from {js.parentJobsheetNo}
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
          <Skeleton className="aspect-[16/10] w-full rounded-none" />
          <div className="space-y-3 p-4">
            <div className="flex justify-between">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-2/3" />
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

/** The supervisor's Jobsheets module (tablet-first). */
export default function SupervisorJobsheetsPage() {
  usePageTitle('Jobsheets');
  const navigate = useNavigate();
  const { can } = useRole();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const tab: JobsheetTab = isTab(params.get('tab')) ? (params.get('tab') as JobsheetTab) : 'all';
  const [searchText, setSearchText] = useState(params.get('q') ?? '');
  const search = useDebounce(searchText, 300).trim();
  const [run, setRun] = useState<RunAction | null>(null);

  // Tab + search live in the URL so going to a jobsheet and back keeps them.
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

  const query = useSupervisorJobsheets(tab, search);
  const { items, total, counts, isPending, isError, error, refetch } = query;
  const empty = search
    ? { title: 'No jobsheets match your search', description: 'Try a jobsheet number or a design code.', icon: SearchX }
    : EMPTY[tab];

  return (
    <div className="page-container space-y-4 pb-24 pt-4 md:py-5">
      <div className="flex items-center gap-2">
        <SearchBar value={searchText} onChange={setSearchText} placeholder="Search jobsheet number or design code…" className="md:max-w-md" />
        <FetchingIndicator show={query.isFetching && !isPending && !query.isFetchingNextPage} />
      </div>

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
