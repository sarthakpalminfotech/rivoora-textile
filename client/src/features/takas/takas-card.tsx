import { AlertTriangle, PackageCheck, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  DAMAGE_TYPE_LABEL,
  formatMeters,
  JOBSHEET_STATUS,
  totalMeters,
  type JobsheetDetail,
  type JobsheetTakaGroup,
  type OrderDetail,
  type Taka,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';
import { FramesValue, machineNumbers, StatTile } from '../jobsheets/parts';
import { useOrderTakas } from './api';
import { EditTakasDialog, type EditTakasTarget } from './edit-takas-dialog';

type Filter = 'all' | 'damaged';

function Shell({ title = 'Takas', action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5" aria-label={title}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <PackageCheck className="size-4 text-slate-400" aria-hidden />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Taka numbers (+ meters when entered) as chips; damaged ones in red with their damage type. */
export function TakaChips({ takas }: { takas: Taka[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {takas.map((t) => (
        <li
          key={t.id}
          className={cn(
            'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[15px] font-bold tabular-nums',
            t.isDamaged ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-800',
          )}
          title={t.isDamaged && t.damageType ? DAMAGE_TYPE_LABEL[t.damageType] : undefined}
        >
          {t.isDamaged && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
          {t.takaNo}
          {t.meters != null && (
            <span className={cn('text-[13px] font-semibold', t.isDamaged ? 'text-red-600' : 'text-slate-500')}>· {formatMeters(t.meters)}</span>
          )}
          {t.isDamaged && (
            <span className="text-[11px] font-semibold uppercase tracking-wide">
              {t.damageType ? DAMAGE_TYPE_LABEL[t.damageType] : 'Damage'}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function FilterToggle({ value, onChange, damaged }: { value: Filter; onChange: (f: Filter) => void; damaged: number }) {
  return (
    <div className="inline-flex rounded-[10px] bg-muted p-1" role="group" aria-label="Filter takas">
      {(['all', 'damaged'] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onChange(f)}
          aria-pressed={value === f}
          disabled={f === 'damaged' && damaged === 0}
          className={cn(
            'min-h-8 rounded-lg px-3 text-[13px] font-semibold text-muted-foreground transition-colors disabled:opacity-50',
            value === f && 'bg-white text-primary shadow-soft',
          )}
        >
          {f === 'all' ? 'All' : 'Damaged only'}
        </button>
      ))}
    </div>
  );
}

function machineText(g: Pick<JobsheetTakaGroup, 'status' | 'runningMachine' | 'machines'>) {
  if (g.runningMachine && (g.status === JOBSHEET_STATUS.ONGOING || g.status === JOBSHEET_STATUS.COMPLETED)) {
    return `Machine ${g.runningMachine.machineNo}`;
  }
  return g.machines.length ? `Machine ${machineNumbers(g.machines)}` : null;
}

/** One jobsheet's takas. `header` shows "Jobsheet 319 · 10 frames · Machine 7" (the order card). */
function TakaGroup({
  group,
  filter,
  header,
  onEdit,
}: {
  group: JobsheetTakaGroup;
  filter: Filter;
  header: boolean;
  onEdit?: () => void;
}) {
  const shown = filter === 'damaged' ? group.takas.filter((t) => t.isDamaged) : group.takas;
  const machine = machineText(group);
  return (
    <div className={cn(header && 'rounded-xl border border-border p-3.5')}>
      {(header || onEdit) && (
        <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
          {header ? (
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold text-slate-900">
                <Link to={`/jobsheets/${group.jobsheetId}`} className="text-primary hover:underline">
                  Jobsheet {group.jobsheetNo}
                </Link>
                <StatusBadge kind="jobsheet" status={group.status} className="py-0.5" />
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                <FramesValue status={group.status} frames={group.frames} completedFrames={group.completedFrames} withUnit />
                {machine && ` · ${machine}`}
                {group.takas.length > 0 && ` · ${group.takas.length} taka${group.takas.length === 1 ? '' : 's'}`}
                {totalMeters(group.takas) !== null && ` · ${formatMeters(totalMeters(group.takas)!)}`}
              </p>
            </div>
          ) : (
            <span />
          )}
          {onEdit && (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil /> Edit takas
            </Button>
          )}
        </div>
      )}
      {group.takas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No takas yet</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No damaged takas</p>
      ) : (
        <TakaChips takas={shown} />
      )}
      {group.note && (
        <p className="mt-2.5 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="font-semibold text-slate-500">Note: </span>
          {group.note}
        </p>
      )}
    </div>
  );
}

function Summary({ total, damaged, meters }: { total: number; damaged: number; meters: number | null }) {
  return (
    <div className={cn('grid gap-2.5', meters !== null ? 'grid-cols-2 sm:max-w-xl sm:grid-cols-3' : 'grid-cols-2 sm:max-w-sm')}>
      <StatTile label="Total takas" value={total} />
      <StatTile
        label="Damaged · Machine damage"
        value={<span className={cn(damaged > 0 && 'text-red-600')}>{damaged}</span>}
        className={cn(damaged > 0 && 'border-red-200 bg-red-50/60')}
      />
      {meters !== null && <StatTile label="Total meters" value={formatMeters(meters)} />}
    </div>
  );
}

export const toTarget = (g: JobsheetTakaGroup): EditTakasTarget => ({
  jobsheetId: g.jobsheetId,
  jobsheetNo: g.jobsheetNo,
  status: g.status,
  takas: g.takas,
  note: g.note,
});

/** Order details → Takas card (Jemish / Gaurang): summary, All / Damaged only, grouped by jobsheet. */
export function OrderTakasCard({ order }: { order: OrderDetail }) {
  const { can } = useRole();
  const query = useOrderTakas(order.id);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<EditTakasTarget | null>(null);
  const canEdit = can('canEditTakas');
  const data = query.data;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:max-w-sm">
          <Skeleton className="h-[68px] rounded-[10px]" />
          <Skeleton className="h-[68px] rounded-[10px]" />
        </div>
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  } else if (query.isError || !data) {
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else {
    const groups = filter === 'damaged' ? data.groups.filter((g) => g.takas.some((t) => t.isDamaged)) : data.groups;
    body = (
      <div className="space-y-4">
        <Summary total={data.total} damaged={data.damaged} meters={data.totalMeters} />
        <div className="space-y-3">
          {groups.map((g) => (
            <TakaGroup
              key={g.jobsheetId}
              group={g}
              filter={filter}
              header
              // A jobsheet without takas can only get them once it is completed.
              onEdit={canEdit && (g.takas.length > 0 || g.status === JOBSHEET_STATUS.COMPLETED) ? () => setEditing(toTarget(g)) : undefined}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Shell action={data && data.total > 0 ? <FilterToggle value={filter} onChange={setFilter} damaged={data.damaged} /> : undefined}>
      {body}
      {canEdit && <EditTakasDialog target={editing} onClose={() => setEditing(null)} />}
    </Shell>
  );
}

/** Jobsheet details → Takas block (Jemish / Gaurang), with the same Edit form. */
export function JobsheetTakasCard({ js }: { js: JobsheetDetail }) {
  const { can } = useRole();
  const [editing, setEditing] = useState<EditTakasTarget | null>(null);
  if (!js.takas) return null;
  const group: JobsheetTakaGroup = {
    jobsheetId: js.id,
    jobsheetNo: js.jobsheetNo,
    status: js.status,
    frames: js.frames,
    completedFrames: js.completedFrames,
    runningMachine: js.runningMachine,
    machines: js.machines,
    note: js.takaNote,
    takas: js.takas,
  };
  const damaged = js.takas.filter((t) => t.isDamaged).length;
  const canEdit = can('canEditTakas') && (js.takas.length > 0 || js.status === JOBSHEET_STATUS.COMPLETED);
  return (
    <Shell
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing(toTarget(group))}>
            <Pencil /> Edit takas
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {js.takas.length > 0 && <Summary total={js.takas.length} damaged={damaged} meters={totalMeters(js.takas)} />}
        <TakaGroup group={group} filter="all" header={false} />
      </div>
      {can('canEditTakas') && <EditTakasDialog target={editing} onClose={() => setEditing(null)} />}
    </Shell>
  );
}
