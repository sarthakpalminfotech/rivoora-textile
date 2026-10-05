import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, PackageOpen, Scissors, SearchX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { formatMeters, formatPcs, type ButtaPendingOrder, type ButtaPendingTaka } from '@rivoora/shared';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { TickBox as Checkbox } from '@/components/ui/tick-box';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ResponsiveModal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { ApiError, errorMessage } from '@/lib/api';
import { formatOrderNo, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useButtaPartyLookup } from '../masters/api';
import { fetchPendingOrderTakas, useCreateChallan, usePendingOrders, usePendingOrderTakas } from './api';

/** orderId → the ids of its pending takas that are ticked (the takas themselves are cached in `known`). */
type Selection = Map<number, Set<number>>;

interface SelectedTotals {
  takas: number;
  meters: number;
  orders: number;
}

/* ------------------------------------------------------------------ */
/* order card                                                           */
/* ------------------------------------------------------------------ */

function OrderCard({
  order,
  selectedCount,
  busy,
  onOpen,
  onToggle,
}: {
  order: ButtaPendingOrder;
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
        'relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-white shadow-soft outline-none transition hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40',
        selectedCount > 0 ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/30',
      )}
    >
      <div className="relative">
        <ImageThumb
          thumbUrl={order.thumbUrl}
          fullUrl={order.imageUrl}
          alt={order.designCode ? `Design ${order.designCode}` : 'No design'}
          className="aspect-[4/3] w-full"
          rounded="rounded-none"
        />
        <div className="absolute left-2.5 top-2.5 flex items-center gap-2 rounded-lg bg-white/95 p-1.5 shadow-soft">
          {busy ? (
            <Loader2 className="size-7 animate-spin text-primary" aria-label="Selecting" />
          ) : (
            <Checkbox
              size="lg"
              checked={all}
              partial={partial}
              onCheckedChange={(c) => onToggle(c)}
              aria-label={`Select all pending takas of order ${formatOrderNo(order.orderNo)}`}
              className="before:absolute before:-inset-2 before:content-['']"
            />
          )}
          {partial && <span className="pr-1 text-xs font-bold text-primary">{selectedCount} of {order.takaCount}</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-2xl font-bold leading-tight text-slate-900">Order {formatOrderNo(order.orderNo)}</p>
        <p className="truncate text-sm text-slate-500">
          {order.designCode ? `Design ${order.designCode}` : 'No design'}
          {order.quality && ` · ${order.quality}`}
        </p>
        <p className="mt-auto pt-2 text-[15px] font-semibold text-slate-800">
          {order.takaCount} pending {order.takaCount === 1 ? 'taka' : 'takas'}
          <span className="font-medium text-slate-500"> · {formatMeters(order.totalMeters)}</span>
        </p>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* takas drawer                                                         */
/* ------------------------------------------------------------------ */

function TakasDrawer({
  order,
  selected,
  onSelected,
  onLoaded,
  onClose,
}: {
  order: ButtaPendingOrder | null;
  selected: Set<number> | undefined;
  onSelected: (orderId: number, ids: Set<number>) => void;
  onLoaded: (orderId: number, takas: ButtaPendingTaka[]) => void;
  onClose: () => void;
}) {
  const query = usePendingOrderTakas(order?.orderId ?? null);
  const takas = query.data?.takas;
  const initialised = useRef<number | null>(null);

  // Opening an order selects all of its pending takas (the user can untick any); a selection made earlier is kept.
  useEffect(() => {
    if (!order || !takas) return;
    onLoaded(order.orderId, takas);
    if (initialised.current !== order.orderId) {
      initialised.current = order.orderId;
      if (!selected || selected.size === 0) onSelected(order.orderId, new Set(takas.map((t) => t.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.orderId, takas]);
  useEffect(() => {
    if (!order) initialised.current = null;
  }, [order]);

  const ids = selected ?? new Set<number>();
  const all = !!takas && takas.length > 0 && takas.every((t) => ids.has(t.id));
  const some = ids.size > 0;
  const meters = takas?.filter((t) => ids.has(t.id)).reduce((s, t) => s + (t.meters ?? 0), 0) ?? 0;

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
            {ids.size} selected{ids.size > 0 && ` · ${formatMeters(Math.round(meters * 100) / 100)}`}
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
          <label className="mb-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg bg-slate-50 px-3 text-[15px] font-semibold text-slate-800">
            <Checkbox
              size="lg"
              checked={all}
              partial={some && !all}
              onCheckedChange={(c) => onSelected(order!.orderId, c ? new Set(takas.map((t) => t.id)) : new Set())}
              aria-label="Select all takas"
            />
            Select all ({takas.length})
          </label>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {takas.map((t) => {
              const on = ids.has(t.id);
              return (
                <li key={t.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      const next = new Set(ids);
                      if (on) next.delete(t.id);
                      else next.add(t.id);
                      onSelected(order!.orderId, next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        const next = new Set(ids);
                        if (on) next.delete(t.id);
                        else next.add(t.id);
                        onSelected(order!.orderId, next);
                      }
                    }}
                    className={cn('flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 transition-colors', on ? 'bg-primary-soft/40' : 'hover:bg-slate-50')}
                  >
                    <Checkbox
                      size="lg"
                      checked={on}
                      onCheckedChange={(c) => {
                        const next = new Set(ids);
                        if (c) next.add(t.id);
                        else next.delete(t.id);
                        onSelected(order!.orderId, next);
                      }}
                      aria-label={`Select taka ${t.takaNo}`}
                    />
                    <span className="text-xl font-bold tabular-nums text-slate-900">{t.takaNo}</span>
                    <span className="ml-auto text-right text-[15px] font-semibold tabular-nums text-slate-600">
                      {t.meters != null ? formatMeters(t.meters) : '—'}
                      <span className="ml-2 text-slate-400">{t.pcs != null ? formatPcs(t.pcs) : '—'}</span>
                    </span>
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
/* send confirmation                                                    */
/* ------------------------------------------------------------------ */

function SendDialog({
  open,
  onOpenChange,
  totals,
  takaIds,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  totals: SelectedTotals;
  takaIds: number[];
  onSent: (challanId: number, challanNo: number) => void;
}) {
  const create = useCreateChallan();
  const [partyId, setPartyId] = useState<number | null>(null);
  const [partyLabel, setPartyLabel] = useState<string>();
  const [partySearch, setPartySearch] = useState('');
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [eway, setEway] = useState('');
  const [partyError, setPartyError] = useState<string | null>(null);
  const parties = useButtaPartyLookup(useDebounce(partySearch.trim(), 250), open);
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
      setPartyError('Select the butta party');
      return;
    }
    create.mutate(
      { takaIds, partyId, challanDate: date, ewayNo: eway.trim() || null },
      {
        onSuccess: (res) => {
          toast.success(`Challan GSM-${res.challanNo} created`);
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
      title="Send to butta cutting"
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
        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
          <div>
            <dt className="text-[12px] text-muted-foreground">Takas</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{totals.takas}</dd>
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
        <Field label="Butta party" htmlFor="send-party" required error={partyError ?? undefined}>
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
            emptyText="No butta parties yet — add one in the Butta parties master"
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
        <Skeleton key={i} className="h-72 rounded-xl" />
      ))}
    </div>
  );
}

/** Orders with takas waiting for butta cutting: select orders / takas, then send them on one challan. */
export function SendPending({ search }: { search: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const query = usePendingOrders(search);
  const [selection, setSelection] = useState<Selection>(new Map());
  /** Meters of every taka we have seen (to total the selection). */
  const [known, setKnown] = useState<Map<number, ButtaPendingTaka[]>>(new Map());
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const orders = query.items;
  const ordersById = useMemo(() => new Map(orders.map((o) => [o.orderId, o])), [orders]);
  const openOrder = openOrderId !== null ? ordersById.get(openOrderId) ?? null : null;

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
  const rememberTakas = (orderId: number, takas: ButtaPendingTaka[]) => setKnown((prev) => new Map(prev).set(orderId, takas));

  const toggleOrder = async (order: ButtaPendingOrder, checked: boolean) => {
    if (!checked) {
      setOrderSelection(order.orderId, new Set());
      return;
    }
    setBusy((b) => new Set(b).add(order.orderId));
    try {
      const res = await fetchPendingOrderTakas(qc, order.orderId);
      rememberTakas(order.orderId, res.takas);
      setOrderSelection(order.orderId, new Set(res.takas.map((t) => t.id)));
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
    for (const [orderId, ids] of selection) {
      takas += ids.size;
      for (const t of known.get(orderId) ?? []) if (ids.has(t.id)) meters += t.meters ?? 0;
    }
    return { takas, meters: Math.round(meters * 100) / 100, orders: selection.size };
  }, [selection, known]);
  const takaIds = useMemo(() => [...selection.values()].flatMap((s) => [...s]), [selection]);

  if (query.isPending) return <GridSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <>
      {orders.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState
            icon={search ? SearchX : PackageOpen}
            title={search ? 'No orders match your search' : 'Nothing waiting for butta cutting'}
            description={search ? undefined : 'Takas appear here once the taka entry is done for orders that go for butta cutting.'}
          />
        </div>
      ) : (
        <>
          <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5', query.isPlaceholderData && 'opacity-60')}>
            {orders.map((o) => (
              <OrderCard
                key={o.orderId}
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
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-white/95 px-4 py-3 shadow-pop backdrop-blur md:sticky md:inset-x-auto md:bottom-4 md:rounded-xl md:border">
          <div className="mx-auto flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm font-semibold text-slate-800">
              {totals.takas} {totals.takas === 1 ? 'taka' : 'takas'} · {formatMeters(totals.meters)} selected
              <span className="hidden font-medium text-slate-500 sm:inline"> · {totals.orders} {totals.orders === 1 ? 'order' : 'orders'}</span>
            </p>
            <Button variant="secondary" size="lg" className="h-12" onClick={() => setSelection(new Map())}>
              <X /> Clear
            </Button>
            <Button size="lg" className="h-12 flex-1 sm:flex-none" onClick={() => setSendOpen(true)}>
              <Scissors /> Send to butta cutting
            </Button>
          </div>
        </div>
      )}

      <TakasDrawer
        order={openOrder}
        selected={openOrder ? selection.get(openOrder.orderId) : undefined}
        onSelected={setOrderSelection}
        onLoaded={rememberTakas}
        onClose={() => setOpenOrderId(null)}
      />
      <SendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        totals={totals}
        takaIds={takaIds}
        onSent={(challanId) => {
          setSendOpen(false);
          setSelection(new Map());
          // The challan preview with Print and Close.
          navigate(`/print/challan/${challanId}?preview=1`);
        }}
      />
    </>
  );
}
