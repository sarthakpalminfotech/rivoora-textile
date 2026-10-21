import { Boxes, CornerUpLeft, PackageCheck, PackagePlus, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  canReceiveFreeStock,
  formatMeters,
  formatPcs,
  JOBSHEET_STATUS,
  reworkSelectable,
  takaActualPcs,
  takaStageShortLabel,
  TAKA_STAGES,
  totalMeters,
  totalPcs,
  type JobsheetDetail,
  type JobsheetTakaGroup,
  type OrderDetail,
  type Taka,
  type TakaStage,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';
import { AddFromFreeStockDialog, itemKeyOf } from '../free-stock/add-from-free-stock-dialog';
import { MoveToInventoryDialog } from '../free-stock/move-to-inventory-dialog';
import { FramesValue, machineNumbers, StatTile } from '../jobsheets/parts';
import { useOrderTakas } from './api';
import { EditTakasDialog, type EditTakasTarget } from './edit-takas-dialog';
import { SendBackDialog, type SendBackTarget } from './send-back-dialog';
import { StageDot, TakaChip } from './taka-chip';
import { TakaDrawer } from './taka-drawer';

type Filter = 'all' | 'damaged';
type StageFilter = 'all' | TakaStage;

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

/**
 * Taka chips: "6245 · 105.5 m · 12 pcs" with a stage dot; open damages in red ("Machine damage · Hole · 2 pcs"),
 * resolved ones grey, and a green "Fresh" tag. Tapping a chip opens the taka details drawer (`onOpen`).
 */
/** Selection mode of the Takas tab (send back): the ticked taka ids and a toggle. */
export interface TakaSelection {
  ids: Set<number>;
  toggle: (t: Taka) => void;
}

export function TakaChips({
  takas,
  onOpen,
  showStage = true,
  showChallan = false,
  selection,
}: {
  takas: Taka[];
  onOpen?: (t: Taka) => void;
  showStage?: boolean;
  showChallan?: boolean;
  selection?: TakaSelection;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {takas.map((t) => (
        <TakaChip
          key={t.id}
          taka={t}
          showStage={showStage}
          showChallan={showChallan}
          onClick={onOpen ? () => onOpen(t) : undefined}
          select={
            selection
              ? { selected: selection.ids.has(t.id), disabledReason: reworkSelectable(t.stage).reason, onToggle: () => selection.toggle(t) }
              : undefined
          }
        />
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

/** Stage filter pills (next to All / Damaged only): All + every stage that has takas, with a colour dot. */
function StageFilterPills({ value, onChange, stages }: { value: StageFilter; onChange: (s: StageFilter) => void; stages: TakaStage[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter takas by stage">
      {(['all', ...stages] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-pressed={value === s}
          className={cn(
            'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors',
            value === s ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-white text-slate-600 hover:bg-muted',
          )}
        >
          {s !== 'all' && <StageDot stage={s} className="ring-0" />}
          {s === 'all' ? 'All stages' : takaStageShortLabel(s)}
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

/** One jobsheet's takas. `header` shows "Order #26 (319) · 10 frames · Machine 7" (the order card). */
function TakaGroup({
  group,
  filter,
  stage = 'all',
  header,
  onEdit,
  onOpen,
  selection,
}: {
  group: JobsheetTakaGroup;
  filter: Filter;
  stage?: StageFilter;
  header: boolean;
  onEdit?: () => void;
  onOpen?: (t: Taka) => void;
  selection?: TakaSelection;
}) {
  const shown = group.takas.filter((t) => (filter === 'damaged' ? t.isDamaged : true) && (stage === 'all' || t.stage === stage));
  const machine = machineText(group);
  return (
    <div className={cn(header && 'rounded-xl border border-border p-3.5')}>
      {(header || onEdit) && (
        <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
          {header ? (
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold text-slate-900">
                <Link to={`/jobsheets/${group.jobsheetId}`} className="text-primary hover:underline">
                  <JobsheetRef orderNo={group.orderNo} jobsheetNo={group.jobsheetNo} bracketClassName="text-primary/60" />
                </Link>
                <StatusBadge kind="jobsheet" status={group.status} className="py-0.5" />
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                <FramesValue status={group.status} frames={group.frames} completedFrames={group.completedFrames} withUnit />
                {machine && ` · ${machine}`}
                {group.takas.length > 0 && ` · ${group.takas.length} taka${group.takas.length === 1 ? '' : 's'}`}
                {totalMeters(group.takas) !== null && ` · ${formatMeters(totalMeters(group.takas)!)}`}
                {totalPcs(group.takas) !== null && ` · ${formatPcs(totalPcs(group.takas)!)}`}
              </p>
            </div>
          ) : (
            <span />
          )}
          {onEdit && !selection && (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil /> Edit takas
            </Button>
          )}
        </div>
      )}
      {group.takas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No takas yet</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{filter === 'damaged' ? 'No damaged takas' : 'No takas in this stage'}</p>
      ) : (
        <TakaChips takas={shown} onOpen={onOpen} selection={selection} />
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

function Summary({ total, damaged, meters, pcs }: { total: number; damaged: number; meters: number | null; pcs: number | null }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:max-w-3xl sm:grid-cols-4">
      <StatTile label="Total takas" value={total} />
      <StatTile
        label="Damaged takas"
        value={<span className={cn(damaged > 0 && 'text-red-600')}>{damaged}</span>}
        className={cn(damaged > 0 && 'border-red-200 bg-red-50/60')}
      />
      <StatTile label="Total pcs" value={pcs !== null ? formatPcs(pcs) : '—'} />
      {meters !== null && <StatTile label="Total meters" value={formatMeters(meters)} />}
    </div>
  );
}

export const toTarget = (g: JobsheetTakaGroup): EditTakasTarget => ({
  jobsheetId: g.jobsheetId,
  jobsheetNo: g.jobsheetNo,
  orderNo: g.orderNo,
  status: g.status,
  // Free stock / assigned-away takas are not part of the jobsheet's set any more.
  takas: g.takas.filter((t) => !t.isFreeStock && t.allocatedOrderNo === null),
  note: g.note,
});

/** Order details → Takas card (Jenish / Gaurang): summary, All / Damaged only, grouped by jobsheet. */
export function OrderTakasCard({ order }: { order: OrderDetail }) {
  const { can } = useRole();
  const query = useOrderTakas(order.id);
  const [filter, setFilter] = useState<Filter>('all');
  const [stage, setStage] = useState<StageFilter>('all');
  const [editing, setEditing] = useState<EditTakasTarget | null>(null);
  const [openTaka, setOpenTaka] = useState<Taka | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Map<number, Taka>>(new Map());
  const [sendTarget, setSendTarget] = useState<SendBackTarget | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const canEdit = can('canEditTakas');
  const canRework = can('canReworkTakas');
  // Sprint 13: Move to inventory (free stock) and Add from free stock.
  const canStock = can('canMoveToInventory') && order.unit === 'pcs';
  const lump = order.orderType === 'lump';
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Map());
    setSendTarget(null);
    setMoveOpen(false);
  };
  const selection: TakaSelection | undefined = selecting
    ? {
        ids: new Set(picked.keys()),
        toggle: (t) =>
          setPicked((prev) => {
            const next = new Map(prev);
            if (next.has(t.id)) next.delete(t.id);
            else next.set(t.id, t);
            return next;
          }),
      }
    : undefined;
  const data = query.data;
  // Pcs-to-pcs orders move a pcs count: the pcs in the godown stages (final + ready for dispatch).
  const godownPcs = (data?.groups ?? []).flatMap((g) => g.takas).filter((t) => t.stage === 'final' || t.stage === 'ready_dispatch').reduce((n, t) => n + (takaActualPcs(t) ?? 0), 0);
  // Only the stages that have takas get a pill.
  const stagesPresent = TAKA_STAGES.filter((s) => data?.groups.some((g) => g.takas.some((t) => t.stage === s)));
  const activeStage: StageFilter = stage !== 'all' && !stagesPresent.includes(stage) ? 'all' : stage;

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
    const groups = data.groups.filter((g) =>
      filter === 'damaged' || activeStage !== 'all'
        ? g.takas.some((t) => (filter === 'damaged' ? t.isDamaged : true) && (activeStage === 'all' || t.stage === activeStage))
        : true,
    );
    body = (
      <div className="space-y-4">
        <Summary total={data.total} damaged={data.damaged} meters={data.totalMeters} pcs={data.totalPcs} />
        {stagesPresent.length > 1 && <StageFilterPills value={activeStage} onChange={setStage} stages={stagesPresent} />}
        <div className="space-y-3">
          {groups.map((g) => (
            <TakaGroup
              key={g.jobsheetId}
              group={g}
              filter={filter}
              stage={activeStage}
              header
              onOpen={setOpenTaka}
              selection={selection}
              // A jobsheet without takas can only get them once it is completed.
              onEdit={canEdit && (g.takas.length > 0 || g.status === JOBSHEET_STATUS.COMPLETED) ? () => setEditing(toTarget(g)) : undefined}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Shell
      action={
        data && data.total > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {canStock && !selecting && canReceiveFreeStock(order.status) && (
              <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
                <PackagePlus /> Add from free stock
              </Button>
            )}
            {canStock && !selecting && !lump && (
              <Button variant="secondary" size="sm" disabled={godownPcs === 0} onClick={() => setMoveOpen(true)}>
                <Boxes /> Move to inventory
              </Button>
            )}
            {(canRework || (canStock && lump)) && !selecting && (
              <Button variant="secondary" size="sm" onClick={() => setSelecting(true)}>
                <CornerUpLeft /> Select
              </Button>
            )}
            <FilterToggle value={filter} onChange={setFilter} damaged={data.damaged} />
          </div>
        ) : undefined
      }
    >
      {body}
      {selecting && (
        <div className="kb-bar sticky bottom-20 z-10 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-white p-3 shadow-card lg:bottom-4">
          <p className="text-[15px] font-semibold tabular-nums text-slate-900">
            {picked.size} taka{picked.size === 1 ? '' : 's'} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canRework && (
              <>
                <Button size="sm" disabled={picked.size === 0} onClick={() => setSendTarget('butta')}>
                  Send back to butta cutting
                </Button>
                <Button size="sm" variant="secondary" disabled={picked.size === 0} onClick={() => setSendTarget('mill')}>
                  Send back to mill
                </Button>
              </>
            )}
            {canStock && lump && (
              <Button size="sm" variant="secondary" disabled={picked.size === 0} onClick={() => setMoveOpen(true)}>
                <Boxes /> Move to inventory
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={stopSelecting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {canRework && (
        <SendBackDialog orderId={order.id} target={sendTarget} takas={[...picked.values()]} onClose={() => setSendTarget(null)} onDone={stopSelecting} />
      )}
      {canStock && (
        <>
          <MoveToInventoryDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            orderId={order.id}
            orderNo={order.orderNo}
            designCode={order.variation?.code ?? order.design?.code ?? null}
            takas={lump ? [...picked.values()] : undefined}
            availablePcs={godownPcs}
            onDone={stopSelecting}
          />
          <AddFromFreeStockDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            order={{
              orderId: order.id,
              orderNo: order.orderNo,
              orderType: order.orderType,
              designCode: order.variation?.code ?? order.design?.code ?? null,
              blouseOption: order.blouseOption,
              itemKey: itemKeyOf(order.design?.id, order.variation?.id),
            }}
          />
        </>
      )}
      {canEdit && <EditTakasDialog target={editing} onClose={() => setEditing(null)} />}
      <TakaDrawer takaId={openTaka?.id ?? null} takaNo={openTaka?.takaNo} onClose={() => setOpenTaka(null)} />
    </Shell>
  );
}

/** Jobsheet details → Takas block (Jenish / Gaurang), with the same Edit form. */
export function JobsheetTakasCard({ js }: { js: JobsheetDetail }) {
  const { can } = useRole();
  const [editing, setEditing] = useState<EditTakasTarget | null>(null);
  if (!js.takas) return null;
  const group: JobsheetTakaGroup = {
    jobsheetId: js.id,
    jobsheetNo: js.jobsheetNo,
    orderNo: js.orderNo,
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
        {js.takas.length > 0 && (
          <Summary total={js.takas.length} damaged={damaged} meters={totalMeters(js.takas)} pcs={totalPcs(js.takas)} />
        )}
        <TakaGroup group={group} filter="all" header={false} />
      </div>
      {can('canEditTakas') && <EditTakasDialog target={editing} onClose={() => setEditing(null)} />}
    </Shell>
  );
}
