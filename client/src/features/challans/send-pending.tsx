import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, PackageOpen, Scissors, SearchX, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CHALLAN_KIND_CONFIG,
  challanLabel,
  formatMeters,
  formatPcs,
  takaStageStatusText,
  type ChallanKind,
  type ChallanPendingOrder,
  type ChallanPendingTaka,
} from '@rivoora/shared';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { TickBox as Checkbox } from '@/components/ui/tick-box';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Input } from '@/components/ui/input';
import { Modal, ResponsiveModal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { ApiError, errorMessage } from '@/lib/api';
import { formatOrderNo, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { usePartyLookup } from '../masters/api';
import { fetchPendingOrderTakas, useCreateChallan, usePendingOrders, usePendingOrderTakas, type FilterQuery, type SendMode } from './api';
import { ReButtaTag, ReMillTag } from '../takas/taka-tags';
import { challanPrintPath } from './kind';

/** orderId → the ids of its READY takas that are ticked (the takas themselves are cached in `known`). */
type Selection = Map<number, Set<number>>;

interface SelectedTotals {
  takas: number;
  /** Total pcs of the selected takas (a taka without pcs counts 0). */
  pcs: number;
  meters: number;
  orders: number;
}

const readyIds = (takas: readonly ChallanPendingTaka[]) => new Set(takas.filter((t) => t.ready).map((t) => t.id));

/* ------------------------------------------------------------------ */
/* order card                                                           */
/* ------------------------------------------------------------------ */

/** "18 / 20 ready to send" + a thin progress bar, or a calm "All 20 ready" (the mill). */
function Readiness({ order }: { order: ChallanPendingOrder }) {
  const all = order.takaCount >= order.notSentCount;
  const share = order.notSentCount > 0 ? order.takaCount / order.notSentCount : 0;
  return (
    <div className="mt-auto space-y-1.5 pt-2">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={order.notSentCount}
        aria-valuenow={order.takaCount}
        aria-label={`${order.takaCount} of ${order.notSentCount}${order.expectedMore ? ' expected' : ''} ready to send`}
      >
        <div className={cn('h-full rounded-full transition-all duration-200', all ? 'bg-green-500' : 'bg-amber-500')} style={{ width: `${share * 100}%` }} />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        {all ? (
          <p className="inline-flex items-center gap-1 text-[15px] font-semibold text-green-700">
            <CheckCircle2 className="size-4" aria-hidden /> All {order.notSentCount} ready
          </p>
        ) : (
          <p className="text-[15px] font-semibold tabular-nums text-slate-800">
            {order.takaCount}{' '}
            <span className="font-medium text-slate-500">
              / {order.expectedMore ? '~' : ''}{order.notSentCount}{order.expectedMore ? ' expected' : ''} ready to send
            </span>
          </p>
        )}
        <p className="shrink-0 text-sm font-medium tabular-nums text-slate-500">{formatMeters(order.totalMeters)}</p>
      </div>
    </div>
  );
}

function OrderCard({
  kind,
  mode,
  order,
  selectedCount,
  busy,
  onOpen,
  onToggle,
}: {
  kind: ChallanKind;
  mode: SendMode;
  order: ChallanPendingOrder;
  selectedCount: number;
  busy: boolean;
  onOpen: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const all = selectedCount > 0 && selectedCount >= order.takaCount;
  const partial = selectedCount > 0 && !all;
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
      aria-label={`Open the takas of order ${formatOrderNo(order.orderNo)}`}
      className={cn(
        'relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-white shadow-soft outline-none transition duration-200 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40',
        selectedCount > 0 ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/30',
      )}
    >
      <div className="flex items-start gap-3 p-4 pb-0">
        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5" onClick={(e) => e.stopPropagation()}>
          {busy ? (
            <Loader2 className="size-7 animate-spin text-primary" aria-label="Selecting" />
          ) : (
            <Checkbox
              size="lg"
              checked={all}
              partial={partial}
              onCheckedChange={(c) => onToggle(c)}
              aria-label={`Select all ready takas of order ${formatOrderNo(order.orderNo)}`}
              className="before:absolute before:-inset-2 before:content-['']"
            />
          )}
        </div>
        {/* The design as a small thumbnail (tap = full image); the lightbox's clicks must not open the drawer. */}
        <div className="shrink-0" onClick={order.thumbUrl ? (e) => e.stopPropagation() : undefined}>
          <ImageThumb
            thumbUrl={order.thumbUrl}
            fullUrl={order.imageUrl}
            alt={order.designCode ? `Design ${order.designCode}` : 'No design'}
            className="size-16"
            rounded="rounded-lg"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold leading-tight text-slate-900">Order {formatOrderNo(order.orderNo)}</p>
          <p className="truncate text-sm text-slate-500">
            {order.designCode ? `Design ${order.designCode}` : 'No design'}
            {order.quality && ` · ${order.quality}`}
          </p>
          {partial && (
            <p className="mt-0.5 text-xs font-bold text-primary">
              {selectedCount} of {order.takaCount} selected
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 pb-4">
        {mode === 'refinish' ? (
          <p className="mt-auto flex items-center gap-2 pt-2 text-[15px] font-semibold text-slate-800">
            <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[11px] font-bold text-pink-700">Refinish</span>
            {order.takaCount} {order.takaCount === 1 ? 'taka' : 'takas'}
            <span className="font-medium text-slate-500"> · {formatMeters(order.totalMeters)}</span>
          </p>
        ) : kind === 'mill' ? (
          <Readiness order={order} />
        ) : (
          <p className="mt-auto pt-2 text-[15px] font-semibold text-slate-800">
            {order.takaCount} pending {order.takaCount === 1 ? 'taka' : 'takas'}
            <span className="font-medium text-slate-500"> · {formatMeters(order.totalMeters)}</span>
          </p>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* takas drawer                                                         */
/* ------------------------------------------------------------------ */

function TakasDrawer({
  kind,
  mode,
  order,
  selected,
  onSelected,
  onLoaded,
  onClose,
  filters,
}: {
  kind: ChallanKind;
  mode: SendMode;
  filters: FilterQuery;
  order: ChallanPendingOrder | null;
  selected: Set<number> | undefined;
  onSelected: (orderId: number, ids: Set<number>) => void;
  onLoaded: (orderId: number, takas: ChallanPendingTaka[]) => void;
  onClose: () => void;
}) {
  const query = usePendingOrderTakas(kind, order?.orderId ?? null, mode, filters);
  const takas = query.data?.takas;
  const initialised = useRef<number | null>(null);

  // Opening an order selects all of its READY takas (the user can untick any); a selection made earlier is kept.
  useEffect(() => {
    if (!order || !takas) return;
    onLoaded(order.orderId, takas);
    if (initialised.current !== order.orderId) {
      initialised.current = order.orderId;
      if (!selected || selected.size === 0) onSelected(order.orderId, readyIds(takas));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.orderId, takas]);
  useEffect(() => {
    if (!order) initialised.current = null;
  }, [order]);

  const ids = selected ?? new Set<number>();
  const ready = takas?.filter((t) => t.ready) ?? [];
  const notReady = takas?.filter((t) => !t.ready) ?? [];
  const all = ready.length > 0 && ready.every((t) => ids.has(t.id));
  const some = ids.size > 0;
  const meters = takas?.filter((t) => ids.has(t.id)).reduce((s, t) => s + (t.meters ?? 0), 0) ?? 0;
  const pcs = takas?.filter((t) => ids.has(t.id)).reduce((s, t) => s + (t.pcs ?? 0), 0) ?? 0;
  const toggle = (id: number, on: boolean) => {
    const next = new Set(ids);
    if (on) next.add(id);
    else next.delete(id);
    onSelected(order!.orderId, next);
  };

  return (
    <Modal
      open={!!order}
      onOpenChange={(o) => !o && onClose()}
      variant="right"
      title={order ? `Order ${formatOrderNo(order.orderNo)}` : ''}
      description={order ? [order.designCode && `Design ${order.designCode}`, order.quality].filter(Boolean).join(' · ') : undefined}
      footer={
        <>
          <p className="mr-auto text-sm font-semibold text-slate-700">
            {ids.size} selected{ids.size > 0 && ` · ${formatPcs(pcs)} · ${formatMeters(Math.round(meters * 100) / 100)}`}
          </p>
          <Button size="lg" className="h-12 min-w-28" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : query.isError || !takas ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div>
          {(notReady.length > 0 || !!order?.expectedMore) && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              {order?.expectedMore
                ? `${ready.length} of ~${order.notSentCount} expected takas are ready to send. ~${order.expectedMore} more are still in making (jobsheets without taka entry).`
                : `${ready.length} of ${takas.length} ready to send.`}{' '}
              {notReady.length > 0 && "The greyed takas can't be selected yet."}
            </p>
          )}
          <label
            className={cn(
              'mb-2 flex min-h-12 items-center gap-3 rounded-lg bg-slate-50 px-3 text-[15px] font-semibold text-slate-800',
              ready.length > 0 ? 'cursor-pointer' : 'opacity-60',
            )}
          >
            <Checkbox
              size="lg"
              checked={all}
              partial={some && !all}
              disabled={ready.length === 0}
              onCheckedChange={(c) => onSelected(order!.orderId, c ? readyIds(takas) : new Set())}
              aria-label="Select all ready takas"
            />
            Select all ({ready.length})
          </label>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {takas.map((t) => {
              const on = ids.has(t.id);
              return (
                <li key={t.id}>
                  <div
                    role={t.ready ? 'button' : undefined}
                    tabIndex={t.ready ? 0 : undefined}
                    aria-disabled={!t.ready || undefined}
                    onClick={t.ready ? () => toggle(t.id, !on) : undefined}
                    onKeyDown={
                      t.ready
                        ? (e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              toggle(t.id, !on);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      'flex min-h-14 items-center gap-3 px-3 py-2 transition-colors duration-150',
                      t.ready ? cn('cursor-pointer', on ? 'bg-primary-soft/40' : 'hover:bg-slate-50') : 'bg-slate-50/70 text-slate-400',
                    )}
                  >
                    {t.ready ? (
                      <Checkbox size="lg" checked={on} onCheckedChange={(c) => toggle(t.id, c)} aria-label={`Select taka ${t.takaNo}`} />
                    ) : (
                      <span className="size-7 shrink-0" aria-hidden />
                    )}
                    <span className={cn('text-xl font-bold tabular-nums', t.ready ? 'text-slate-900' : 'text-slate-400')}>{t.takaNo}</span>
                    {(t.reworkCount ?? 0) > 0 && (t.stage === 'rework_butta' || t.ready) && <ReButtaTag count={t.reworkCount!} />}
                    <span className="ml-auto text-right text-[15px] font-semibold tabular-nums">
                      <span className={t.ready ? 'text-slate-600' : 'text-slate-400'}>{t.meters != null ? formatMeters(t.meters) : '—'}</span>
                      <span className="ml-2 text-slate-400">{t.pcs != null ? formatPcs(t.pcs) : '—'}</span>
                    </span>
                    {mode === 'refinish' && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pink-100 px-2 py-0.5 text-[11px] font-bold text-pink-700">
                        Refinish{(t.refinishCount ?? 0) > 1 ? ` ×${t.refinishCount}` : ''}
                      </span>
                    )}
                    {mode === 'refinish' && t.sentBackByOwner && <ReMillTag />}
                    {!t.ready && (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-200/70 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                        {takaStageStatusText(t.stage)}
                      </span>
                    )}
                    {t.isDamaged && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                        <AlertTriangle className="size-3" aria-hidden /> Damage
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* not-ready warning                                                    */
/* ------------------------------------------------------------------ */

interface NotReadyGroup {
  orderId: number;
  orderNo: number;
  takas: { id: number; takaNo: string; stage: string }[];
  /** Takas of the order that can go now, and how many are expected in all (approx while jobsheets lack taka entry). */
  readyCount: number;
  expectedTotal: number;
  approx: boolean;
}

/** "Order #26: 2 takas not ready — 6251 (At butta cutting), 6252 (Butta QC pending)" for each selected order. */
function NotReadyDialog({
  open,
  groups,
  readyCount,
  kind,
  onCancel,
  onContinue,
}: {
  open: boolean;
  groups: NotReadyGroup[];
  readyCount: number;
  kind: ChallanKind;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const place = CHALLAN_KIND_CONFIG[kind].place;
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title="Not all takas are ready"
      description={`Takas that aren't ready for ${place} yet stay behind and go on a later challan.`}
      desktopVariant="center"
      mobileVariant="bottom"
      size="md"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" className="h-12" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="lg" className="h-12" onClick={onContinue} disabled={readyCount === 0}>
            Send ready takas only ({readyCount})
          </Button>
        </div>
      }
    >
      <ul className="space-y-3 pb-1" role="alert">
        {groups.map((g) => (
          <li key={g.orderId} className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <p className="flex items-center gap-2 text-[15px] font-bold text-amber-900">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              Order {formatOrderNo(g.orderNo)}: {g.readyCount} of {g.approx ? '~' : ''}{g.expectedTotal} {g.approx ? 'expected ' : ''}takas ready
            </p>
            {g.approx && (
              <p className="mt-1 text-sm text-amber-900/90">
                The rest are still in making — the number is approximate until taka entry is done.
              </p>
            )}
            <p className="mt-1 text-sm leading-relaxed text-amber-900/90">
              {g.takas.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ', '}
                  <b className="tabular-nums">{t.takaNo}</b> ({takaStageStatusText(t.stage)})
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </ResponsiveModal>
  );
}

/* ------------------------------------------------------------------ */
/* send confirmation                                                    */
/* ------------------------------------------------------------------ */

function SendDialog({
  kind,
  refinish,
  open,
  onOpenChange,
  totals,
  takaIds,
  onSent,
}: {
  kind: ChallanKind;
  refinish?: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  totals: SelectedTotals;
  takaIds: number[];
  onSent: (challanId: number, challanNo: number) => void;
}) {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  const create = useCreateChallan(kind);
  const [partyId, setPartyId] = useState<number | null>(null);
  const [partyLabel, setPartyLabel] = useState<string>();
  const [partySearch, setPartySearch] = useState('');
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [eway, setEway] = useState('');
  const [partyError, setPartyError] = useState<string | null>(null);
  const parties = usePartyLookup(kind, useDebounce(partySearch.trim(), 250), open);
  const options = useMemo(() => (parties.data ?? []).map((p) => ({ value: p.id, label: p.name })), [parties.data]);

  useEffect(() => {
    if (open) {
      setDate(toApiDate(new Date()));
      setEway('');
      setPartyError(null);
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    if (!partyId) {
      setPartyError(`Select the ${cfg.partyLabel.toLowerCase()}`);
      return;
    }
    create.mutate(
      { takaIds, partyId, challanDate: date, ewayNo: eway.trim() || null },
      {
        onSuccess: (res) => {
          toast.success(`Challan ${challanLabel(res.challanNo, kind)} created`);
          onSent(res.challanId, res.challanNo);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field === 'partyId') setPartyError(err.message);
        },
      },
    );
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !create.isPending && onOpenChange(o)}
      title={`Send to ${kind === 'butta' ? 'butta cutting' : refinish ? 'mill for refinishing' : 'mill'}`}
      desktopVariant="center"
      mobileVariant="bottom"
      size="md"
      dismissible={!create.isPending}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" className="h-12" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button size="lg" className="h-12" onClick={submit} loading={create.isPending}>
            Create challan
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        <dl className="grid grid-cols-4 gap-2 rounded-xl bg-slate-50 p-3 text-center">
          <div>
            <dt className="text-[12px] text-muted-foreground">Takas</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{totals.takas}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Pcs</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{totals.pcs.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Meters</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{formatMeters(totals.meters)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Orders</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{totals.orders}</dd>
          </div>
        </dl>
        <Field label={cfg.partyLabel} htmlFor="send-party" required error={partyError ?? undefined}>
          <Select
            id="send-party"
            value={partyId}
            onChange={(id, opt) => {
              setPartyId(id);
              setPartyLabel(opt.label);
              setPartyError(null);
            }}
            selectedLabel={partyLabel}
            options={options}
            placeholder="Select party"
            searchable
            searchPlaceholder="Search parties…"
            onSearchChange={setPartySearch}
            loading={parties.isFetching}
            emptyText={`No ${cfg.partyLabel.toLowerCase()}s yet — add one in the ${cfg.partyLabel}s master`}
            invalid={!!partyError}
            triggerClassName="h-12 text-base"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Challan date" htmlFor="send-date" required>
            <DatePicker id="send-date" value={date} onChange={setDate} />
          </Field>
          <Field label="Eway no" htmlFor="send-eway" hint="Optional">
            <Input id="send-eway" value={eway} onChange={(e) => setEway(e.target.value)} maxLength={40} autoComplete="off" className="h-11" />
          </Field>
        </div>
        {create.isError && (
          <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive">
            {errorMessage(create.error)}
          </p>
        )}
      </div>
    </ResponsiveModal>
  );
}

/* ------------------------------------------------------------------ */
/* Send → Pending                                                       */
/* ------------------------------------------------------------------ */

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-40 rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Orders with takas ready to send (butta cutting: waiting for it · mill: waiting for the mill): select orders / takas,
 * then send them on one challan. Takas that are not ready yet are shown (greyed) in the drawer; sending with some of
 * them left over asks first ("Send ready takas only").
 */
export function SendPending({ kind, search, mode = 'send', filters = {} }: { kind: ChallanKind; search: string; mode?: SendMode; filters?: FilterQuery }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Filters (loom / quality / …): only the matching takas are listed, counted and selected.
  const query = usePendingOrders(kind, search, mode, filters);
  const filtered = Object.values(filters).some(Boolean);
  const [selection, setSelection] = useState<Selection>(new Map());
  /** Every taka we have seen per order (to total the selection and to find the not-ready ones). */
  const [known, setKnown] = useState<Map<number, ChallanPendingTaka[]>>(new Map());
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const orders = query.items;
  const ordersById = useMemo(() => new Map(orders.map((o) => [o.orderId, o])), [orders]);
  const openOrder = openOrderId !== null ? (ordersById.get(openOrderId) ?? null) : null;

  // Drop selections of orders that are no longer pending (they were sent meanwhile).
  useEffect(() => {
    if (query.isPending || query.isPlaceholderData || query.hasNextPage) return;
    setSelection((prev) => {
      const next = new Map([...prev].filter(([id]) => ordersById.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ordersById, query.isPending, query.isPlaceholderData, query.hasNextPage]);

  const setOrderSelection = (orderId: number, ids: Set<number>) =>
    setSelection((prev) => {
      const next = new Map(prev);
      if (ids.size === 0) next.delete(orderId);
      else next.set(orderId, ids);
      return next;
    });
  const rememberTakas = (orderId: number, takas: ChallanPendingTaka[]) => setKnown((prev) => new Map(prev).set(orderId, takas));

  const toggleOrder = async (order: ChallanPendingOrder, checked: boolean) => {
    if (!checked) {
      setOrderSelection(order.orderId, new Set());
      return;
    }
    setBusy((b) => new Set(b).add(order.orderId));
    try {
      const res = await fetchPendingOrderTakas(qc, kind, order.orderId, mode, filters);
      rememberTakas(order.orderId, res.takas);
      setOrderSelection(order.orderId, readyIds(res.takas));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(order.orderId);
        return next;
      });
    }
  };

  const totals: SelectedTotals = useMemo(() => {
    let takas = 0;
    let meters = 0;
    let pcs = 0;
    for (const [orderId, ids] of selection) {
      takas += ids.size;
      for (const t of known.get(orderId) ?? [])
        if (ids.has(t.id)) {
          meters += t.meters ?? 0;
          pcs += t.pcs ?? 0;
        }
    }
    return { takas, pcs, meters: Math.round(meters * 100) / 100, orders: selection.size };
  }, [selection, known]);
  const takaIds = useMemo(() => [...selection.values()].flatMap((s) => [...s]), [selection]);

  /** The takas of the selected orders that are not ready (grouped by order, in the order list's order). */
  const notReadyGroups = useMemo<NotReadyGroup[]>(() => {
    const groups: NotReadyGroup[] = [];
    for (const [orderId] of selection) {
      const order = ordersById.get(orderId);
      const notReady = (known.get(orderId) ?? []).filter((t) => !t.ready);
      if (order && (notReady.length || order.notSentCount > order.takaCount)) {
        groups.push({
          orderId,
          orderNo: order.orderNo,
          takas: notReady.map((t) => ({ id: t.id, takaNo: t.takaNo, stage: t.stage })),
          readyCount: order.takaCount,
          expectedTotal: order.notSentCount,
          approx: !!order.expectedMore,
        });
      }
    }
    return groups.sort((a, b) => a.orderNo - b.orderNo);
  }, [selection, known, ordersById]);

  const trySend = () => {
    if (notReadyGroups.length > 0) setWarnOpen(true);
    else setSendOpen(true);
  };

  if (query.isPending) return <GridSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <>
      {orders.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState
            icon={search || filtered ? SearchX : PackageOpen}
            title={search ? 'No orders match your search' : filtered ? 'No orders match the filters' : mode === 'refinish' ? 'No takas to refinish' : kind === 'butta' ? 'Nothing waiting for butta cutting' : 'Nothing ready for the mill'}
            description={
              search || filtered
                ? undefined
                : mode === 'refinish'
                  ? 'Takas that Mill QC or the godown marks for refinish wait here to go back to the mill.'
                  : kind === 'butta'
                  ? 'Takas appear here once the taka entry is done for orders that go for butta cutting.'
                  : 'Takas appear here once their butta QC is done (or when the design skips butta cutting).'
            }
          />
        </div>
      ) : (
        <>
          <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5', query.isPlaceholderData && 'opacity-60')}>
            {orders.map((o) => (
              <OrderCard
                key={o.orderId}
                kind={kind}
                mode={mode}
                order={o}
                selectedCount={selection.get(o.orderId)?.size ?? 0}
                busy={busy.has(o.orderId)}
                onOpen={() => setOpenOrderId(o.orderId)}
                onToggle={(c) => void toggleOrder(o, c)}
              />
            ))}
          </div>
          <LoadMore
            hasNextPage={!!query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={() => void query.fetchNextPage()}
            shown={orders.length}
            total={query.total}
            noun="orders"
          />
        </>
      )}

      {/* Selection action bar (above the phone bottom nav, sticky on md+) */}
      {totals.takas > 0 && (
        <div className="kb-bar fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-white/95 px-4 py-3 shadow-pop backdrop-blur lg:sticky lg:inset-x-auto lg:bottom-4 lg:rounded-xl lg:border">
          <div className="mx-auto flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm font-semibold text-slate-800">
              {totals.takas} {totals.takas === 1 ? 'taka' : 'takas'} · {formatPcs(totals.pcs)} · {formatMeters(totals.meters)} selected
              <span className="hidden font-medium text-slate-500 sm:inline">
                {' '}
                · {totals.orders} {totals.orders === 1 ? 'order' : 'orders'}
              </span>
            </p>
            <Button variant="secondary" size="lg" className="h-12" onClick={() => setSelection(new Map())}>
              <X /> Clear
            </Button>
            <Button size="lg" className="h-12 flex-1 sm:flex-none" onClick={trySend}>
              {kind === 'butta' ? <Scissors /> : <Send />} Send to {kind === 'butta' ? 'butta cutting' : 'mill'}
            </Button>
          </div>
        </div>
      )}

      <TakasDrawer
        kind={kind}
        mode={mode}
        order={openOrder}
        filters={filters}
        selected={openOrder ? selection.get(openOrder.orderId) : undefined}
        onSelected={setOrderSelection}
        onLoaded={rememberTakas}
        onClose={() => setOpenOrderId(null)}
      />
      <NotReadyDialog
        open={warnOpen}
        groups={notReadyGroups}
        readyCount={totals.takas}
        kind={kind}
        onCancel={() => setWarnOpen(false)}
        onContinue={() => {
          setWarnOpen(false);
          setSendOpen(true);
        }}
      />
      <SendDialog
        kind={kind}
        refinish={mode === 'refinish'}
        open={sendOpen}
        onOpenChange={setSendOpen}
        totals={totals}
        takaIds={takaIds}
        onSent={(challanId) => {
          setSendOpen(false);
          setSelection(new Map());
          // The challan preview with Print and Close.
          navigate(`${challanPrintPath(kind, challanId)}?preview=1`);
        }}
      />
    </>
  );
}
