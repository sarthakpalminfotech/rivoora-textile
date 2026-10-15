import { Ban, Check, Clock } from 'lucide-react';
import { useMemo } from 'react';
import { mainStepsOfHistory, orderMilestones, type Milestone, type MilestoneKey, type OrderDetail } from '@rivoora/shared';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { ROLES } from '@/config/roles';
import { getStatus } from '@/config/statuses';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOrderMilestones } from './api';
import type { OrderView } from './dashboard/view-state';

/** The "took 4 days 6 h" pill that sits on the line between two main steps. */
function TimePill({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
      <Clock className="size-3" aria-hidden /> {text}
    </span>
  );
}

/** Overview: the main steps only, with date + time, lots and the time taken between steps. */
function Overview({ steps }: { steps: Milestone[] }) {
  return (
    <ol className="relative pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-0.5 before:bg-slate-200">
      {steps.map((m) => (
        <li key={m.key} className="relative">
          {m.sincePrevious && (
            <div className="-mt-1 mb-2 pt-1">
              <TimePill text={m.sincePrevious.text} />
            </div>
          )}
          <div className={cn('relative pb-5', m.state !== 'done' && 'opacity-70')}>
            <span
              className={cn(
                'absolute -left-8 top-0.5 flex size-6 items-center justify-center rounded-full border-[3px] border-white shadow',
                m.state === 'done' && 'bg-primary text-primary-foreground',
                m.state === 'pending' && 'bg-slate-200',
                m.state === 'skipped' && 'bg-slate-100 ring-1 ring-slate-300',
              )}
              aria-hidden
            >
              {m.state === 'done' && <Check className="size-3.5" strokeWidth={3} />}
              {m.state === 'skipped' && <Ban className="size-3 text-slate-400" />}
            </span>
            <p className={cn('text-[15px] font-semibold', m.state === 'done' ? 'text-slate-900' : 'text-slate-500')}>{m.label}</p>
            {m.state === 'done' ? (
              <>
                <p className="text-sm text-slate-500">{formatDateTime(m.at)}</p>
                {m.lots > 1 && (
                  <p className="text-[13px] text-slate-400">
                    {m.lots} lots · last on {formatDateTime(m.lastAt)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm font-medium text-slate-400">{m.state === 'skipped' ? 'Skipped' : 'Pending'}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Detailed: every status change. Main steps get a stronger dot, a soft tint and the "time since previous step" pill. */
function Detailed({ order, steps }: { order: OrderDetail; steps: Milestone[] | null }) {
  const entries = [...order.history].reverse();
  const mainOf = useMemo(() => mainStepsOfHistory(order.history), [order.history]);
  const stepByKey = useMemo(() => new Map<MilestoneKey, Milestone>((steps ?? []).map((m) => [m.key, m])), [steps]);
  return (
    <ol className="relative space-y-5 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-slate-200">
      {entries.map((h, i) => {
        const to = getStatus(h.toStatus);
        const isUndo = h.fromStatus !== null && getStatus(h.fromStatus).sequence > to.sequence;
        const title = h.fromStatus === null ? 'Order created' : isUndo ? `Moved back to ${to.label}` : `Moved to ${to.label}`;
        const stepKey = mainOf.get(h.id);
        const pill = stepKey ? stepByKey.get(stepKey)?.sincePrevious : null;
        return (
          <li key={h.id} className="relative">
            <span
              className={cn('absolute -left-6 rounded-full border-[3px] border-white shadow', stepKey ? 'top-2.5 size-4 ring-2 ring-primary/30' : 'top-1 size-4')}
              style={{ backgroundColor: stepKey ? 'hsl(var(--primary))' : i === 0 ? to.badge.dot : '#CBD5E1' }}
              aria-hidden
            />
            <div className={cn(stepKey && '-my-1.5 rounded-lg bg-primary-soft px-3 py-1.5')}>
              <p className="text-[15px] font-semibold text-slate-900">{title}</p>
              <p className="text-sm text-slate-500">
                {formatDateTime(h.changedAt)} · by {ROLES[h.role]?.name ?? h.role}
              </p>
              {pill && (
                <div className="mt-1">
                  <TimePill text={pill.text} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Order details → History: Overview (default) / Detailed toggle, kept in the URL as `?hview=`. */
export function HistoryTab({ order, view }: { order: OrderDetail; view: OrderView }) {
  const query = useOrderMilestones(order.id);
  const steps = useMemo(() => (query.data ? orderMilestones(query.data) : null), [query.data]);
  const mode = view.historyView;

  return (
    <div className="space-y-4">
      <Segmented
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'detailed', label: 'Detailed' },
        ]}
        value={mode}
        onChange={view.setHistoryView}
        aria-label="History view"
        className="sm:w-64"
      />
      {mode === 'overview' ? (
        steps ? (
          <Overview steps={steps} />
        ) : query.isError ? (
          <p className="text-sm text-muted-foreground">The overview is not available right now.</p>
        ) : (
          <div className="space-y-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        )
      ) : (
        <Detailed order={order} steps={steps} />
      )}
    </div>
  );
}
