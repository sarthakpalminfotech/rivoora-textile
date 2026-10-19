import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Printer, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CHALLAN_KIND_CONFIG,
  challanLabel,
  formatMeters,
  formatPcs,
  ROLES,
  type ChallanDetail,
  type ChallanKind,
  type ChallanOrderGroup,
  type ChallanTakaRow,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { TickBox as Checkbox } from '@/components/ui/tick-box';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { StatTile } from '../jobsheets/parts';
import { useCancelChallan, useChallan, useReceive } from './api';
import { ReceivedCountControl } from './received-count';
import { challanPrintPath, kindPermission, sentListPath } from './kind';

function OrderSection({
  kind,
  group,
  ticked,
  canReceive,
  onToggle,
  onToggleAll,
}: {
  kind: ChallanKind;
  group: ChallanOrderGroup;
  ticked: Set<number>;
  canReceive: boolean;
  onToggle: (id: number, on: boolean) => void;
  onToggleAll: (ids: number[], on: boolean) => void;
}) {
  const pendingRows = group.takas.filter((t) => t.receivedAt === null);
  const allTicked = pendingRows.length > 0 && pendingRows.every((t) => ticked.has(t.id));
  const someTicked = pendingRows.some((t) => ticked.has(t.id));
  return (
    <section id={`order-section-${group.orderId}`} className="scroll-mt-20 rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
      <div className="mb-3 flex items-center gap-3">
        <ImageThumb
          thumbUrl={group.thumbUrl}
          fullUrl={group.imageUrl}
          alt={group.designCode ? `Design ${group.designCode}` : 'No design'}
          className="size-14 shrink-0"
          rounded="rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold text-slate-900">Order {formatOrderNo(group.orderNo)}</h3>
          <p className="truncate text-sm text-slate-500">
            {[group.designCode && `Design ${group.designCode}`, group.quality].filter(Boolean).join(' · ')}
          </p>
        </div>
        <p className="shrink-0 text-right text-sm font-semibold text-slate-600">
          {group.takaCount} {group.takaCount === 1 ? 'taka' : 'takas'}
          <span className="block font-medium text-slate-400">{formatMeters(group.totalMeters)}</span>
        </p>
      </div>
      {canReceive && pendingRows.length > 1 && (
        <label className="mb-1 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-slate-50 px-3 text-sm font-semibold text-slate-700">
          <Checkbox
            checked={allTicked}
            partial={someTicked && !allTicked}
            onCheckedChange={(on) => onToggleAll(pendingRows.map((t) => t.id), on)}
            aria-label={`Tick all takas of order ${formatOrderNo(group.orderNo)} that are ${CHALLAN_KIND_CONFIG[kind].inLabel.toLowerCase()}`}
          />
          Tick all {CHALLAN_KIND_CONFIG[kind].inLabel.toLowerCase()} ({pendingRows.length})
        </label>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {group.takas.map((t) => (
          <TakaRowItem key={t.id} kind={kind} taka={t} ticked={ticked.has(t.id)} canReceive={canReceive} onToggle={(on) => onToggle(t.id, on)} />
        ))}
      </ul>
    </section>
  );
}

function TakaRowItem({
  kind,
  taka,
  ticked,
  canReceive,
  onToggle,
}: {
  kind: ChallanKind;
  taka: ChallanTakaRow;
  ticked: boolean;
  canReceive: boolean;
  onToggle: (on: boolean) => void;
}) {
  const received = taka.receivedAt !== null;
  return (
    <li className={cn('flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', received ? 'bg-green-50/50' : ticked ? 'bg-primary-soft/40' : '')}>
      {canReceive && !received ? (
        <Checkbox size="lg" checked={ticked} onCheckedChange={onToggle} aria-label={`Select taka ${taka.takaNo}`} />
      ) : (
        <span className="size-7 shrink-0" aria-hidden />
      )}
      <span className="text-xl font-bold tabular-nums text-slate-900">{taka.takaNo}</span>
      <span className="text-[15px] font-semibold tabular-nums text-slate-600">
        {taka.meters != null ? formatMeters(taka.meters) : '—'}
        <span className="ml-2 text-slate-400">{taka.pcs != null ? formatPcs(taka.pcs) : '—'}</span>
      </span>
      {taka.isDamaged && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
          <AlertTriangle className="size-3" aria-hidden /> Damage
        </span>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {received ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800">
              <CheckCircle2 className="size-3.5" aria-hidden /> Received · {formatDateTime(taka.receivedAt)}
            </span>
            {taka.qcDone && <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800">QC done</span>}
          </>
        ) : (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{CHALLAN_KIND_CONFIG[kind].inLabel}</span>
        )}
      </span>
    </li>
  );
}

function Body({ challan }: { challan: ChallanDetail }) {
  const kind = challan.kind;
  const cfg = CHALLAN_KIND_CONFIG[kind];
  const { can } = useRole();
  const navigate = useNavigate();
  const receive = useReceive(kind);
  const cancel = useCancelChallan(kind);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelled = challan.status === 'cancelled';
  // Butta cutting ticks takas off; the mill is counted (just a number) and the Mill QC finds out which takas came.
  const canReceive = kind === 'butta' && can(kindPermission(kind)) && !cancelled;
  const canCount = kind === 'mill' && can(kindPermission(kind)) && !cancelled;
  const qcReceived = challan.orders.reduce((n, o) => n + o.takas.filter((t) => t.receivedAt !== null).length, 0);
  // Only rows that are still with the party can be ticked (a refetch may have received some meanwhile).
  const pendingIds = useMemo(() => new Set(challan.orders.flatMap((o) => o.takas.filter((t) => t.receivedAt === null).map((t) => t.id))), [challan]);
  const tickedNow = [...ticked].filter((id) => pendingIds.has(id));

  const setOne = (id: number, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const setMany = (ids: number[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const markReceived = () =>
    receive.mutate(
      { takaIds: tickedNow },
      {
        onSuccess: (res) => {
          setTicked(new Set());
          const failed = res.results.filter((r) => !r.ok);
          if (res.received) toast.success(`${res.received} ${res.received === 1 ? 'taka' : 'takas'} received`);
          for (const f of failed.slice(0, 3)) toast.error(f.message);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-3xl font-extrabold tracking-tight text-slate-900">
              <span className={cn(cancelled && 'text-slate-400 line-through')}>{challanLabel(challan.challanNo, kind)}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                <span className="size-2 rounded-full" style={{ backgroundColor: cfg.colour }} aria-hidden />
                {cfg.label}
              </span>
              {cancelled && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">
                  <Ban className="size-3.5" aria-hidden /> Cancelled
                </span>
              )}
            </h1>
            <p className="mt-1 text-lg font-semibold text-slate-800">M/s. {challan.party.name}</p>
            <div className="mt-0.5 space-y-0.5 text-sm text-slate-600">
              {challan.party.address && <p className="whitespace-pre-line">{challan.party.address}</p>}
              {challan.party.mobile && <p>Mo: {challan.party.mobile}</p>}
              {challan.party.gstin && <p>GSTIN: {challan.party.gstin}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary" size="lg" className="h-12">
              <Link to={challanPrintPath(kind, challan.id)}>
                <Printer /> Print
              </Link>
            </Button>
            {can('canCancelChallan') && challan.canCancel && (
              <Button variant="secondary" size="lg" className="h-12 text-destructive hover:bg-destructive-soft" onClick={() => setConfirmCancel(true)}>
                <Ban /> Cancel challan
              </Button>
            )}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-4">
          <div>
            <dt className="text-[13px] text-muted-foreground">Date</dt>
            <dd className="text-[15px] font-semibold text-slate-900">{formatDate(challan.challanDate)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Eway no</dt>
            <dd className="text-[15px] font-semibold text-slate-900">{challan.ewayNo ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Created by</dt>
            <dd className="text-[15px] font-semibold text-slate-900">{ROLES[challan.createdBy]?.name ?? challan.createdBy}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Created</dt>
            <dd className="text-[15px] font-semibold text-slate-900">{formatDateTime(challan.createdAt)}</dd>
          </div>
        </dl>
      </section>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile label="Total takas" value={challan.totalTakas} />
        <StatTile label="Total meters" value={formatMeters(challan.totalMeters)} />
        <StatTile
          label="Received"
          value={
            <span className={cn(!cancelled && challan.receivedCount === challan.totalTakas && 'text-green-700')}>
              {challan.receivedCount} / {challan.totalTakas}
            </span>
          }
        />
        <StatTile label="Pending" value={<span className={cn(challan.pendingCount > 0 && 'text-amber-700')}>{challan.pendingCount}</span>} />
      </div>

      {canCount && (
        <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
          <ReceivedCountControl challanId={challan.id} total={challan.totalTakas} received={challan.receivedCount} minimum={qcReceived} />
          <p className="mt-2 text-sm text-slate-500">Just the count. Which takas came back is found out at the Mill QC.</p>
        </section>
      )}

      {/* Orders in this challan */}
      <div className="flex flex-wrap items-center gap-2" aria-label="Orders in this challan">
        <span className="text-sm font-semibold text-slate-500">Orders:</span>
        {challan.orders.map((o) => (
          <button
            key={o.orderId}
            type="button"
            onClick={() => document.getElementById(`order-section-${o.orderId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="min-h-10 rounded-full border border-border bg-white px-3.5 text-sm font-semibold text-slate-700 transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
          >
            Order {formatOrderNo(o.orderNo)}
            <span className="ml-1.5 font-medium text-slate-400">
              {o.takaCount} · {formatMeters(o.totalMeters)}
            </span>
          </button>
        ))}
      </div>

      {/* Order-wise taka lists */}
      <div className="space-y-4">
        {challan.orders.map((g) => (
          <OrderSection key={g.orderId} kind={kind} group={g} ticked={ticked} canReceive={canReceive} onToggle={setOne} onToggleAll={setMany} />
        ))}
      </div>

      {canReceive && tickedNow.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-white/95 px-4 py-3 shadow-pop backdrop-blur lg:sticky lg:inset-x-auto lg:bottom-4 lg:rounded-xl lg:border">
          <div className="mx-auto flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm font-semibold text-slate-800">{tickedNow.length} selected</p>
            <Button variant="secondary" size="lg" className="h-12" onClick={() => setTicked(new Set())}>
              Clear
            </Button>
            <Button size="lg" className="h-12 flex-1 bg-green-600 hover:bg-green-700 sm:flex-none" onClick={markReceived} loading={receive.isPending}>
              <CheckCircle2 /> Mark received ({tickedNow.length})
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel challan ${challanLabel(challan.challanNo, kind)}?`}
        description={`All its takas go back to waiting to be sent to ${kind === 'butta' ? 'butta cutting' : 'the mill'}. The challan stays in the list as Cancelled and its number is never reused.`}
        confirmLabel="Cancel challan"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(challan.id, {
            onSuccess: () => {
              toast.success(`Challan ${challanLabel(challan.challanNo, kind)} cancelled`);
              setConfirmCancel(false);
              navigate(sentListPath(kind, 'all'), { replace: true });
            },
            onError: (err) => {
              toast.error(errorMessage(err));
              setConfirmCancel(false);
            },
          })
        }
      />
    </div>
  );
}

/** `/butta/challans/:id` and `/mill/challans/:id` — header, summary tiles, order chips, order-wise taka lists, Print / Cancel / Mark received. */
export default function ChallanDetailsPage({ kind }: { kind: ChallanKind }) {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const location = useLocation();
  const query = useChallan(kind, id);
  usePageTitle(query.data ? `Challan ${challanLabel(query.data.challanNo, kind)}` : 'Challan');
  const from = (location.state as { from?: string } | null)?.from ?? CHALLAN_KIND_CONFIG[kind].route;

  const back = (
    <button
      type="button"
      onClick={() => navigate(from)}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary"
    >
      <ArrowLeft className="size-4" /> {CHALLAN_KIND_CONFIG[kind].label}
    </button>
  );

  return (
    <div className="page-container space-y-3 pb-28 pt-3 md:pt-5">
      {back}
      {query.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : query.isError || !query.data ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {query.error instanceof ApiError && query.error.status === 404 ? (
            <EmptyState icon={SearchX} title="Challan not found" />
          ) : (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          )}
        </div>
      ) : (
        <Body challan={query.data} />
      )}
    </div>
  );
}
