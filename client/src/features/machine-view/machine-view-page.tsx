import { ChevronDown, Factory, MoonStar, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { MachineViewJobsheet, MachineViewMachine } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { formatElapsed, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMachineView } from '../jobsheets/api';

type Filter = 'all' | 'running' | 'idle';

const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';
const VISIBLE_ROWS = 3;

const pad = (n: number) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------ */
/* summary bar                                                          */
/* ------------------------------------------------------------------ */

function StatPill({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone: 'all' | 'running' | 'idle';
}) {
  const dot = tone === 'running' ? 'bg-emerald-500' : tone === 'idle' ? 'bg-slate-400' : 'bg-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-h-[64px] min-w-0 flex-1 flex-col justify-center rounded-xl border bg-white px-3 py-2 text-left shadow-soft transition sm:px-4',
        active
          ? tone === 'running'
            ? 'border-emerald-300 ring-2 ring-emerald-500/20'
            : tone === 'idle'
              ? 'border-slate-300 ring-2 ring-slate-400/20'
              : 'border-primary/40 ring-2 ring-primary/15'
          : 'border-border hover:border-slate-300',
      )}
    >
      <span className="flex items-center gap-1.5 truncate text-[12px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[13px]">
        <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />
        {label}
      </span>
      <span
        className={cn(
          'text-2xl font-bold tabular-nums leading-tight sm:text-3xl',
          tone === 'running' ? 'text-emerald-700' : tone === 'idle' ? 'text-slate-600' : 'text-slate-900',
        )}
      >
        {value}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* tiles                                                                */
/* ------------------------------------------------------------------ */

function JobsheetRow({ js, now, onOpen }: { js: MachineViewJobsheet; now: number; onOpen: () => void }) {
  const elapsed = formatElapsed(js.startedAt, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-[10px] border border-emerald-200/70 bg-white px-2 py-2 text-left shadow-sm transition hover:border-emerald-400 active:bg-emerald-50 sm:px-2.5"
      aria-label={`Open jobsheet ${js.jobsheetNo}`}
    >
      <ImageThumb
        thumbUrl={js.thumbUrl}
        alt={js.designCode ? `Design ${js.designCode}` : 'No design'}
        preview={false}
        className="hidden size-10 shrink-0 ring-1 ring-inset ring-black/5 sm:block"
        rounded="rounded-md"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold leading-tight text-slate-900">Jobsheet {js.jobsheetNo}</span>
        <span className="block truncate text-xs text-slate-500">
          {js.designCode ?? 'No design'} · {js.frames} fr{elapsed ? <span className="sm:hidden"> · {elapsed}</span> : null}
        </span>
      </span>
      {elapsed && (
        <span className="hidden shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-800 sm:inline">
          {elapsed}
        </span>
      )}
    </button>
  );
}

function MachineTile({ m, now, onOpen, muted }: { m: MachineViewMachine; now: number; onOpen: (id: number) => void; muted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const running = m.ongoing.length > 0;
  const rows = expanded ? m.ongoing : m.ongoing.slice(0, VISIBLE_ROWS);
  const hidden = m.ongoing.length - rows.length;
  const idleFor = formatElapsed(m.lastCompletedAt, now);

  return (
    <article
      className={cn(
        'relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border shadow-soft transition',
        running ? 'border-emerald-200 bg-emerald-50/60' : 'border-border bg-slate-50/80',
        muted && 'opacity-60 grayscale',
      )}
      aria-label={`Machine ${m.machineNo}: ${running ? 'running' : 'idle'}`}
    >
      <div className={cn('h-1.5 w-full', running ? 'bg-emerald-500' : 'bg-slate-200')} aria-hidden />
      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Machine</p>
            <p className={cn('text-3xl font-extrabold leading-none tabular-nums sm:text-4xl', running ? 'text-slate-900' : 'text-slate-400')}>
              {pad(m.machineNo)}
            </p>
            {m.name && <p className="mt-1 truncate text-xs font-medium text-slate-500">{m.name}</p>}
          </div>
          {running ? (
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="sr-only sm:not-sr-only">Running</span>
            </span>
          ) : (
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-200/70 px-2 py-1 text-xs font-semibold text-slate-600">
              <span className="size-2 rounded-full bg-slate-400" aria-hidden />
              <span className="sr-only sm:not-sr-only">Idle</span>
            </span>
          )}
        </header>

        {running ? (
          <div className="space-y-1.5">
            {rows.map((js) => (
              <JobsheetRow key={js.id} js={js} now={now} onOpen={() => onOpen(js.id)} />
            ))}
            {(hidden > 0 || expanded) && m.ongoing.length > VISIBLE_ROWS && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex h-9 w-full items-center justify-center gap-1 rounded-[10px] text-xs font-semibold text-emerald-800 hover:bg-emerald-100/70"
                aria-expanded={expanded}
              >
                {expanded ? 'Show less' : `+${hidden} more`}
                <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden />
              </button>
            )}
          </div>
        ) : (
          <div className="mt-auto flex items-center gap-2 text-slate-500">
            <MoonStar className="size-5 shrink-0 text-slate-400" aria-hidden />
            <p className="min-w-0 text-sm leading-tight">
              <span className="font-semibold text-slate-600">Idle</span>
              {idleFor && <span className="block truncate text-xs text-slate-400">since {idleFor}</span>}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2 sm:gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 flex-1 rounded-xl" />
        ))}
      </div>
      <div className={GRID}>
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div className="page-container space-y-4 pb-24 pt-4 md:py-5">{children}</div>;
}

/** The machine floor board: which machines are running what, and which are idle. */
export default function MachineViewPage() {
  usePageTitle('Machine view');
  const navigate = useNavigate();
  const { can } = useRole();
  const now = useNow(30_000);
  const query = useMachineView();
  const [filter, setFilter] = useState<Filter>('all');
  const [showInactive, setShowInactive] = useState(false);
  const open = (id: number) => navigate(`/jobsheets/${id}`);

  if (query.isPending) {
    return (
      <Section>
        <BoardSkeleton />
      </Section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Section>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Section>
    );
  }

  const { machines, inactive } = query.data;
  if (machines.length === 0 && inactive.length === 0) {
    return (
      <Section>
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState
            icon={Factory}
            title="No machines yet"
            description={can('canManageMachines') ? 'Add your looms in Machine Master to see them here.' : 'Machines appear here once they are added.'}
            action={
              can('canManageMachines') ? (
                <Button asChild>
                  <Link to="/machines">Open Machine Master</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      </Section>
    );
  }

  const runningCount = machines.filter((m) => m.ongoing.length > 0).length;
  const shown = machines.filter((m) =>
    filter === 'running' ? m.ongoing.length > 0 : filter === 'idle' ? m.ongoing.length === 0 : true,
  );

  return (
    <Section>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-1 gap-2 sm:gap-3 md:max-w-2xl" role="group" aria-label="Filter machines">
          <StatPill label="All" value={machines.length} tone="all" active={filter === 'all'} onClick={() => setFilter('all')} />
          <StatPill label="Running" value={runningCount} tone="running" active={filter === 'running'} onClick={() => setFilter('running')} />
          <StatPill label="Idle" value={machines.length - runningCount} tone="idle" active={filter === 'idle'} onClick={() => setFilter('idle')} />
        </div>
        <div className="flex items-center justify-end gap-2 text-sm text-slate-500 md:ml-auto">
          <span aria-live="polite">Last updated {formatTime(new Date(query.dataUpdatedAt))}</span>
          <Tooltip content="Refresh now">
            <Button variant="secondary" size="icon-sm" aria-label="Refresh" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={cn(query.isFetching && 'animate-spin')} />
            </Button>
          </Tooltip>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {filter === 'running' ? 'No machines are running right now.' : filter === 'idle' ? 'Every machine is running.' : 'No active machines.'}
        </div>
      ) : (
        <ul className={GRID}>
          {shown.map((m) => (
            <li key={m.id} className="min-w-0">
              <MachineTile m={m} now={now} onOpen={open} />
            </li>
          ))}
        </ul>
      )}

      {inactive.length > 0 && (
        <section className="pt-2">
          <button
            type="button"
            onClick={() => setShowInactive((s) => !s)}
            aria-expanded={showInactive}
            className="flex min-h-11 items-center gap-2 rounded-[10px] px-2 text-sm font-semibold text-slate-500 hover:bg-muted hover:text-slate-700"
          >
            <ChevronDown className={cn('size-4 transition-transform', !showInactive && '-rotate-90')} aria-hidden />
            Inactive machines ({inactive.length})
          </button>
          {showInactive && (
            <ul className={cn(GRID, 'mt-3')}>
              {inactive.map((m) => (
                <li key={m.id} className="min-w-0">
                  <MachineTile m={m} now={now} onOpen={open} muted />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Section>
  );
}
