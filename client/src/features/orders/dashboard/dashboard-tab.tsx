import { AlertTriangle, ArrowRight, Check, ChevronRight, ClipboardList, CornerDownRight, Hourglass, Inbox, Plus, Send } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ALERT_NOT_STARTED_HOURS,
  formatHours,
  formatPcs,
  jobsheetRef,
  getMainStage,
  getSubStage,
  JOBSHEET_STATUS,
  STATUS,
  type DashboardAlert,
  type DashboardJobsheetItem,
  type MainStageCount,
  type MainStageKey,
  type OrderDashboard,
  type OrderDetail,
  type SubStageCount,
  type SubStageKey,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { formatElapsed, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOrderJobsheets } from '../../jobsheets/api';
import { CreateJobsheetsDialog } from '../../jobsheets/jobsheet-forms';
import { FramesValue, machineNumbers } from '../../jobsheets/parts';
import { TakaChips } from '../../takas/takas-card';
import { useSendToProduction } from '../api';
import { useDashboardItems, useOrderDashboard } from './api';
import type { OrderView } from './view-state';

/* ------------------------------------------------------------------ */
/* small parts                                                          */
/* ------------------------------------------------------------------ */

const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;
const unitWord = (unit: 'jobsheets' | 'takas', n: number) => (unit === 'jobsheets' ? (n === 1 ? 'jobsheet' : 'jobsheets') : n === 1 ? 'taka' : 'takas');
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
const hoursSince = (iso: string | null, now: number) => (iso ? (now - Date.parse(iso)) / 3_600_000 : null);

export function ComingSoon({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500', className)}>
      Coming soon
    </span>
  );
}

function Panel({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-20 rounded-xl border border-border bg-white p-4 shadow-soft md:p-5', className)}>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Selected cards: primary ring + tint. */
const selectable = (selected: boolean) =>
  cn(
    'rounded-xl border bg-white text-left shadow-soft outline-none transition focus-visible:ring-2 focus-visible:ring-primary/50',
    selected ? 'border-primary bg-primary-soft/50 ring-2 ring-primary/70' : 'border-border hover:border-primary/30 hover:shadow-pop',
  );

/* ------------------------------------------------------------------ */
/* §4 progress bar                                                      */
/* ------------------------------------------------------------------ */

function ProgressCard({ data }: { data: OrderDashboard }) {
  const { progress, bar, barTotalPcs, alerts } = data;
  const scrollToAlerts = () => document.getElementById('needs-attention')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5" aria-label="Progress">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <p className="shrink-0 text-slate-900">
          <span className="text-2xl font-bold tabular-nums">{barTotalPcs.toLocaleString('en-IN')}</span>
          <span className="text-lg font-semibold text-slate-400"> / {progress.targetPcs.toLocaleString('en-IN')}</span>
          <span className="ml-1.5 text-sm font-medium text-slate-500">pcs</span>
        </p>
        <div className="min-w-0 flex-1">
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
            role="img"
            aria-label={`Pcs by stage: ${bar.map((b) => `${getMainStage(b.stage).label} ${fmt(b.pcs)}`).join(', ')}`}
          >
            {barTotalPcs > 0 &&
              bar
                .filter((b) => b.share > 0)
                .map((b) => (
                  <span
                    key={b.stage}
                    className="h-full first:rounded-l-full last:rounded-r-full [&:not(:last-child)]:border-r-2 [&:not(:last-child)]:border-white"
                    style={{ width: `${b.share * 100}%`, backgroundColor: getMainStage(b.stage).colour }}
                    title={`${getMainStage(b.stage).label}: ${fmt(b.pcs)} pcs · ${Math.round(b.share * 100)}%`}
                  />
                ))}
          </div>
          <p className="mt-2 text-[12px] font-medium tabular-nums text-slate-600">
            Pcs by stage
            {bar
              .filter((b) => b.share > 0)
              .map((b) => (
                <span key={b.stage} className="ml-1.5 inline-flex items-center gap-1 text-slate-500">
                  · <span className="size-2 rounded-full" style={{ backgroundColor: getMainStage(b.stage).colour }} aria-hidden />
                  {getMainStage(b.stage).label} <b className="font-semibold text-slate-700">{Math.round(b.share * 100)}%</b>
                </span>
              ))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="text-2xl font-bold tabular-nums text-slate-900">
            {fmt(progress.targetPcs > 0 ? Math.round((barTotalPcs / progress.targetPcs) * 1000) / 10 : 0)}
            <span className="text-base font-semibold text-slate-400">%</span>
            <span className="ml-1 text-sm font-medium text-slate-500">of order</span>
          </p>
          {alerts.length > 0 && (
            <button
              type="button"
              onClick={scrollToAlerts}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 text-[13px] font-semibold text-amber-800 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <AlertTriangle className="size-3.5" aria-hidden />
              {alerts.length} need attention
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* §7.1 main stage cards                                                */
/* ------------------------------------------------------------------ */

function MainStageCard({ stage, data, selected, onSelect }: { stage: MainStageCount; data: OrderDashboard; selected: boolean; onSelect: () => void }) {
  const config = getMainStage(stage.key);
  const muted = !stage.connected;
  // Completed / skipped: a calm grey state (visual only — the card stays fully clickable).
  const done = stage.state !== null;
  let secondary: ReactNode;
  if (stage.key === 'production') {
    secondary = data.isPcs ? (
      `${plural(data.production.frames, 'frame')} · ${plural(data.production.takas, 'taka')} made${
        data.production.takaPcs !== null ? ` · ${formatPcs(data.production.takaPcs)}` : ''
      }`
    ) : (
      <span className="text-slate-500">Jobsheets for kg / g / meter orders — coming soon</span>
    );
  } else {
    secondary = stage.connected ? `${stage.pcs.toLocaleString('en-IN')} pcs` : <ComingSoon />;
  }
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={cn(selectable(selected), 'relative flex h-full w-full flex-col gap-1.5 p-3.5 md:p-4', (muted || done) && !selected && 'bg-slate-50/70')}>
      {done && (
        <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
          {stage.state === 'completed' ? <Check className="size-3" aria-hidden /> : null}
          {stage.state === 'completed' ? 'Completed' : 'Skipped'}
        </span>
      )}
      <span className={cn('flex items-center gap-2 text-[13px] font-semibold text-slate-600 md:text-sm', done && 'pr-[5.25rem]')}>
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: done ? '#94A3B8' : config.colour, opacity: muted ? 0.5 : 1 }} aria-hidden />
        <span className={cn('truncate', done && 'text-slate-500')}>{config.label}</span>
      </span>
      <span className={cn('text-[26px] font-bold leading-none tabular-nums md:text-3xl', muted || done ? 'text-slate-400' : 'text-slate-900')}>
        {stage.count.toLocaleString('en-IN')}
        <span className="ml-1.5 text-sm font-semibold text-slate-500">{unitWord(stage.unit, stage.count)}</span>
      </span>
      <span className="text-[13px] leading-snug text-slate-500">{secondary}</span>
      {stage.damaged > 0 && (
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-red-600">
          <AlertTriangle className="size-3.5" aria-hidden /> {stage.damaged} damaged
        </span>
      )}
    </button>
  );
}

function MainStages({ data, selected, onSelect }: { data: OrderDashboard; selected: MainStageKey; onSelect: (k: MainStageKey) => void }) {
  return (
    <ol className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6" aria-label="Order stages">
      {data.mainStages.map((s, i) => (
        <li key={s.key} className="relative min-w-0">
          <MainStageCard stage={s} data={data} selected={selected === s.key} onSelect={() => onSelect(s.key)} />
          {i < data.mainStages.length - 1 && (
            <span
              className="absolute -right-[22px] top-1/2 z-10 hidden size-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white text-slate-400 md:flex"
              aria-hidden
            >
              <ChevronRight className="size-3.5" />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* §7.2 summary line + sub-stage KPIs                                   */
/* ------------------------------------------------------------------ */

function SummaryLine({ data, stage }: { data: OrderDashboard; stage: MainStageKey }) {
  let parts: ReactNode[];
  if (stage === 'production') {
    const p = data.production;
    parts = [
      <>Total jobsheets <b>{p.jobsheets}</b></>,
      <>Total frames <b>{fmt(p.frames)}</b></>,
      <>Woven <b>{fmt(p.wovenFrames)}</b> frames ({p.wovenPcs.toLocaleString('en-IN')} pcs)</>,
      <>On loom <b>{fmt(p.onLoomFrames)}</b> frames</>,
      <>Takas <b>{p.takas}</b></>,
      <>Taka pcs <b>{p.takaPcs !== null ? p.takaPcs.toLocaleString('en-IN') : '—'}</b></>,
    ];
  } else {
    const m = data.mainStages.find((s) => s.key === stage)!;
    parts = m.connected
      ? [<>Takas <b>{m.takas}</b></>, <>Pieces <b>{m.pcs.toLocaleString('en-IN')}</b></>, <>Damaged <b className={cn(m.damaged > 0 && 'text-red-600')}>{m.damaged}</b></>]
      : [<>{getMainStage(stage).label} will be connected when it's built</>];
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[13px] text-slate-500 [&_b]:font-semibold [&_b]:text-slate-800">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span className="text-slate-300" aria-hidden>·</span>}
          <span>{p}</span>
        </span>
      ))}
    </p>
  );
}

function subFact(s: SubStageCount, now: number): ReactNode {
  if (!s.connected) return <ComingSoon />;
  switch (s.key) {
    case 'not_sent':
    case 'taka_pending':
      return plural(s.frames, 'frame');
    case 'with_supervisor': {
      const h = hoursSince(s.oldestSince, now);
      const over = h !== null && h > ALERT_NOT_STARTED_HOURS;
      return (
        <>
          {plural(s.frames, 'frame')}
          {h !== null && <span className={cn(over && 'font-semibold text-amber-600')}> · oldest {formatHours(h)}</span>}
        </>
      );
    }
    case 'on_loom':
      return `${plural(s.frames, 'frame')} · ${plural(s.machines, 'machine')}`;
    default:
      return (
        <>
          from {plural(s.jobsheetCount, 'jobsheet')}
          {s.takaPcs !== null && ` · ${formatPcs(s.takaPcs)}`}
          {s.damaged > 0 && <span className="font-semibold text-red-600"> · {s.damaged} damaged</span>}
        </>
      );
  }
}

function SubStageCards({ subs, selected, onToggle }: { subs: SubStageCount[]; selected: SubStageKey | null; onToggle: (k: SubStageKey) => void }) {
  const now = useNow();
  return (
    <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] md:gap-3">
      {subs.map((s) => {
        const config = getSubStage(s.key);
        const isSel = selected === s.key;
        return (
          <li key={s.key} className="min-w-0">
            <button
              type="button"
              onClick={() => onToggle(s.key)}
              aria-pressed={isSel}
              aria-haspopup="dialog"
              className={cn(selectable(isSel), 'flex h-full w-full flex-col gap-1 p-3', !s.connected && !isSel && 'bg-slate-50/70')}
            >
              <span className="flex items-start gap-1.5 text-[13px] font-medium leading-snug text-slate-600">
                <span className="mt-[5px] size-2 shrink-0 rounded-full" style={{ backgroundColor: config.colour, opacity: s.connected ? 1 : 0.5 }} aria-hidden />
                {config.label}
              </span>
              <span className={cn('mt-auto pt-1 text-2xl font-bold leading-none tabular-nums', s.connected ? 'text-slate-900' : 'text-slate-400')}>
                {s.count}
                <span className="ml-1 text-[13px] font-semibold text-slate-500">{unitWord(s.unit, s.count)}</span>
              </span>
              <span className="text-[12px] leading-snug text-slate-500">{subFact(s, now)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* §7.3 detail panel                                                    */
/* ------------------------------------------------------------------ */

function timeInStage(j: DashboardJobsheetItem, now: number): { text: string; over: boolean } | null {
  switch (j.status) {
    case JOBSHEET_STATUS.PENDING: {
      const e = formatElapsed(j.createdAt, now);
      return e ? { text: `created ${e} ago`, over: false } : null;
    }
    case JOBSHEET_STATUS.SENT: {
      const h = hoursSince(j.sentAt, now);
      return h !== null ? { text: `sent ${formatHours(h)} ago`, over: h > ALERT_NOT_STARTED_HOURS } : null;
    }
    case JOBSHEET_STATUS.ONGOING: {
      const e = formatElapsed(j.startedAt, now);
      return e ? { text: `running ${e}`, over: false } : null;
    }
    default: {
      const e = formatElapsed(j.completedAt, now);
      return e ? { text: `woven ${e} ago`, over: false } : null;
    }
  }
}

const machineText = (j: DashboardJobsheetItem) =>
  j.runningMachine && (j.status === JOBSHEET_STATUS.ONGOING || j.status === JOBSHEET_STATUS.COMPLETED)
    ? `Machine ${j.runningMachine.machineNo}`
    : j.machines.length
      ? `Machine ${machineNumbers(j.machines)}`
      : '—';

function JobsheetRows({ items }: { items: DashboardJobsheetItem[] }) {
  const navigate = useNavigate();
  const now = useNow();
  const time = (j: DashboardJobsheetItem) => {
    const t = timeInStage(j, now);
    return t ? <span className={cn(t.over && 'font-semibold text-amber-600')}>{t.text}</span> : '—';
  };
  const continued = (j: DashboardJobsheetItem) =>
    j.parentJobsheetNo !== null && (
      <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
        <CornerDownRight className="size-3.5 shrink-0" aria-hidden /> continued from #{j.orderNo} ({j.parentJobsheetNo})
      </span>
    );
  return (
    <>
      {/* Phones: cards */}
      <ul className="space-y-2 md:hidden">
        {items.map((j) => (
          <li key={j.id}>
            <Link
              to={`/jobsheets/${j.id}`}
              className="block rounded-xl border border-border p-3.5 outline-none transition hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/40 active:bg-slate-50"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-lg font-bold text-slate-900">
                  <JobsheetRef orderNo={j.orderNo} jobsheetNo={j.jobsheetNo} />
                </span>
                <span className="text-[13px] text-slate-500">{time(j)}</span>
              </span>
              {continued(j)}
              <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
                <span>
                  <FramesValue status={j.status} frames={j.frames} completedFrames={j.completedFrames} withUnit className="font-semibold text-slate-800" />
                </span>
                {j.picks && <span>Picks {j.picks}</span>}
                <span>{machineText(j)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {/* md+: table; each row opens the jobsheet */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-[12px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-semibold">Order (jobsheet)</th>
              <th className="py-2 pr-4 font-semibold">Frames</th>
              <th className="py-2 pr-4 font-semibold">Picks</th>
              <th className="py-2 pr-4 font-semibold">Machine(s)</th>
              <th className="py-2 font-semibold">Time in stage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((j) => (
              <tr
                key={j.id}
                tabIndex={0}
                role="link"
                aria-label={`Open ${jobsheetRef(j.orderNo, j.jobsheetNo)}`}
                onClick={() => navigate(`/jobsheets/${j.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(`/jobsheets/${j.id}`);
                }}
                className="cursor-pointer outline-none hover:bg-slate-50 focus-visible:bg-primary-soft/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
              >
                <td className="py-2.5 pr-4">
                  <span className="text-[15px] font-bold text-primary">
                    <JobsheetRef orderNo={j.orderNo} jobsheetNo={j.jobsheetNo} bracketClassName="text-primary/60" />
                  </span>
                  {continued(j)}
                </td>
                <td className="py-2.5 pr-4 font-semibold text-slate-800">
                  <FramesValue status={j.status} frames={j.frames} completedFrames={j.completedFrames} />
                </td>
                <td className="py-2.5 pr-4 text-slate-700">{j.picks ?? <span className="text-slate-400">—</span>}</td>
                <td className="py-2.5 pr-4 text-slate-700">{machineText(j)}</td>
                <td className="py-2.5 text-slate-600">{time(j)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The items of the opened sub-stage, in a drawer that slides in from the right (full screen on phones). */
function DetailDrawer({ orderId, open, onClose }: { orderId: number; open: SubStageCount | undefined; onClose: () => void }) {
  // Keep the last sub-stage while the drawer slides out, so its content doesn't vanish mid-animation.
  const lastRef = useRef(open);
  if (open) lastRef.current = open;
  const shown = open ?? lastRef.current;
  return (
    <Modal
      open={!!open}
      onOpenChange={(o) => !o && onClose()}
      variant="right"
      title={
        shown ? (
          <span className="flex items-center gap-2">
            {getSubStage(shown.key).label}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{shown.count}</span>
          </span>
        ) : (
          ''
        )
      }
    >
      {shown && <DetailBody orderId={orderId} sub={shown.key} />}
    </Modal>
  );
}

function DetailBody({ orderId, sub }: { orderId: number; sub: SubStageKey }) {
  const config = getSubStage(sub);
  const query = useDashboardItems(orderId, sub, config.connected);
  let body: ReactNode;
  if (!config.connected) {
    body = <EmptyState icon={Hourglass} title="This stage will be connected when it's built" className="py-8" />;
  } else if (query.isPending) {
    body = (
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  } else if (query.isError || !query.data) {
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else {
    const d = query.data;
    const empty = d.kind === 'jobsheets' ? d.jobsheets.length === 0 : d.groups.length === 0;
    if (empty) body = <EmptyState icon={Inbox} title="Nothing here right now" className="py-8" />;
    else if (d.kind === 'jobsheets') body = <JobsheetRows items={d.jobsheets} />;
    else
      body = (
        <div className="space-y-3">
          {d.groups.map((g) => (
            <div key={g.jobsheetId} className="rounded-xl border border-border p-3.5">
              <Link
                to={`/jobsheets/${g.jobsheetId}`}
                className="mb-2.5 inline-flex items-center gap-1 rounded text-[15px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <JobsheetRef orderNo={g.orderNo} jobsheetNo={g.jobsheetNo} bracketClassName="text-primary/60" />
                <span className="font-normal text-slate-500">
                  {' · '}
                  <FramesValue status={g.status} frames={g.frames} completedFrames={g.completedFrames} withUnit />
                </span>
              </Link>
              <TakaChips takas={g.takas} showChallan={['at_butta', 'butta_qc', 'at_mill', 'mill_qc', 'refinish'].includes(sub)} />
            </div>
          ))}
        </div>
      );
  }
  return <>{body}</>;
}

/* ------------------------------------------------------------------ */
/* §8 alerts                                                            */
/* ------------------------------------------------------------------ */

function AlertsCard({ alerts, view }: { alerts: DashboardAlert[]; view: OrderView }) {
  if (alerts.length === 0) return null;
  return (
    <Panel id="needs-attention" title="Needs attention" className="border-amber-200">
      <ul className="space-y-2">
        {alerts.map((a, i) => (
          <li
            key={`${a.kind}-${a.jobsheetId ?? i}`}
            className="flex flex-col gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900 sm:flex-row sm:items-center"
          >
            <span className="flex flex-1 items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              <span>{a.message}</span>
            </span>
            {a.jobsheetId ? (
              <Link to={`/jobsheets/${a.jobsheetId}`} className="inline-flex shrink-0 items-center gap-1 self-end rounded font-semibold text-primary hover:underline sm:self-auto">
                Open jobsheet <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : (
              <button type="button" onClick={() => view.setTab('jobsheets')} className="inline-flex shrink-0 items-center gap-1 self-end rounded font-semibold text-primary hover:underline sm:self-auto">
                View jobsheets <ArrowRight className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* special cases                                                        */
/* ------------------------------------------------------------------ */

/** Pending for production (Jemish only): nothing to show yet, with the Send for production action. */
function NotSentYet({ order }: { order: OrderDetail }) {
  const { can } = useRole();
  const send = useSendToProduction();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-white shadow-soft">
      <EmptyState
        icon={Send}
        title="Not sent for production yet"
        description="Once the order is sent for production, its jobsheets, takas and damages show up here."
        action={
          can('canSendToProduction') ? (
            <Button onClick={() => setConfirm(true)}>
              <Send /> Send for production
            </Button>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Send order ${formatOrderNo(order.orderNo)} for production?`}
        description="It becomes visible to the production team as Jobsheet pending."
        confirmLabel="Send"
        loading={send.isPending}
        onConfirm={() =>
          send.mutate([order.id], {
            onSuccess: () => toast.success(`Order ${formatOrderNo(order.orderNo)} sent for production`),
            onSettled: () => setConfirm(false),
          })
        }
      />
    </div>
  );
}

function NoJobsheetsYet({ order }: { order: OrderDetail }) {
  const { can } = useRole();
  const canCreate = can('canManageJobsheets') && order.unit === 'pcs';
  const jobsheets = useOrderJobsheets(order.id, canCreate);
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-dashed border-border bg-white">
      <EmptyState
        icon={ClipboardList}
        title="No jobsheets yet"
        description={canCreate ? 'Create the jobsheets for this order to send them to the looms.' : undefined}
        className="py-10"
        action={
          canCreate ? (
            <Button onClick={() => setOpen(true)} disabled={!jobsheets.data}>
              <Plus /> Create jobsheets
            </Button>
          ) : undefined
        }
      />
      {jobsheets.data && <CreateJobsheetsDialog open={open} onOpenChange={setOpen} data={jobsheets.data} />}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-[84px] rounded-xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[124px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the tab                                                              */
/* ------------------------------------------------------------------ */

export function DashboardTab({ order, view }: { order: OrderDetail; view: OrderView }) {
  const pending = order.status === STATUS.PENDING_PRODUCTION;
  const query = useOrderDashboard(order.id, !pending);

  if (pending) return <NotSentYet order={order} />;
  if (query.isPending) return <DashboardSkeleton />;
  if (query.isError || !query.data) {
    return (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const data = query.data;
  const stage = view.stage ?? data.defaultStage;
  const subs = data.subStages.filter((s) => s.mainStage === stage);
  const openSub = view.sub ? data.subStages.find((s) => s.key === view.sub) : undefined;
  const productionOff = stage === 'production' && !data.isPcs;

  return (
    <div className="space-y-4">
      <ProgressCard data={data} />
      <MainStages data={data} selected={stage} onSelect={view.selectStage} />

      {data.isPcs && !data.hasJobsheets ? (
        <NoJobsheetsYet order={order} />
      ) : productionOff ? (
        <div className="rounded-xl border border-dashed border-border bg-white">
          <EmptyState
            icon={Hourglass}
            title="Jobsheets for kg / g / meter orders — coming soon"
            description="For now, jobsheets can be created for orders in pieces (pcs)."
            className="py-10"
          />
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-slate-50/60 p-3 md:p-4" aria-label={`${getMainStage(stage).label} details`}>
          <SummaryLine data={data} stage={stage} />
          <SubStageCards subs={subs} selected={view.sub} onToggle={view.toggleSub} />
        </div>
      )}

      <DetailDrawer
        orderId={order.id}
        open={productionOff ? undefined : openSub}
        onClose={() => openSub && view.toggleSub(openSub.key)}
      />

      <AlertsCard alerts={data.alerts} view={view} />
    </div>
  );
}

