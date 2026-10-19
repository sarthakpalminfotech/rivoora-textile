import { Boxes, ChevronRight, ClipboardList, PackagePlus } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { FREE_STOCK_REASON_LABEL, formatMeters, isBlouseFilter, takaStageShortLabel, type BlouseFilter, type FreeStockTaka, type InventoryOrderRow } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { TickBox } from '@/components/ui/tick-box';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { useDebounce } from '@/hooks/useDebounce';
import { formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { AddFromFreeStockDialog } from '../free-stock/add-from-free-stock-dialog';
import { useItemFreeStock } from '../free-stock/api';
import { BlouseTag, BlouseToggle } from '../free-stock/blouse';
import { StageDot } from '../takas/taka-chip';
import { useInventoryItem, useInventoryItemOrders } from './api';
import { BackLink, ExpandingSearch, ItemHeader, KpiSkeleton, KpiTile, pcsText } from './parts';

const KPI_GRID = 'grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7';

type ItemFilter = '' | 'ready' | 'making' | 'godown' | 'free';
const ITEM_FILTERS: readonly ItemFilter[] = ['ready', 'making', 'godown', 'free'];

/** The figure an order row shows: the one of the active KPI filter (Ready for dispatch by default). */
const ROW_FIGURE = {
  ready: { label: 'ready for dispatch', bar: 'bg-teal-500', pcs: (o: InventoryOrderRow) => o.readyPcs },
  making: { label: 'in making', bar: 'bg-sky-400', pcs: (o: InventoryOrderRow) => o.makingPcs },
  godown: { label: 'ready for order', bar: 'bg-emerald-500', pcs: (o: InventoryOrderRow) => o.godownPcs },
} as const;

function OrderRow({ order, figure }: { order: InventoryOrderRow; figure: keyof typeof ROW_FIGURE }) {
  const f = ROW_FIGURE[figure];
  const value = f.pcs(order);
  const share = order.orderedPcs > 0 ? Math.min(100, (value / order.orderedPcs) * 100) : 0;
  return (
    <li>
      <Link
        to={`/orders/${order.orderId}`}
        className="flex min-h-[64px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 outline-none transition hover:bg-slate-50 focus-visible:bg-slate-50"
        aria-label={`Open order ${formatOrderNo(order.orderNo)}`}
      >
        <div className="min-w-[9rem] flex-1">
          <p className="text-[17px] font-bold leading-tight text-slate-900">Order {formatOrderNo(order.orderNo)}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-slate-500">
            <span className="truncate">{order.customerName}</span>
            <BlouseTag option={order.blouseOption} />
          </p>
        </div>
        <div className="flex min-w-[14rem] flex-[2] items-center gap-4">
          <div className="shrink-0">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">Ordered</p>
            <p className="text-[15px] font-semibold tabular-nums text-slate-800">{pcsText(order.orderedPcs)}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="whitespace-nowrap text-[12px] font-medium tabular-nums text-slate-500">
              <b className="text-slate-800">{pcsText(value)}</b> / {pcsText(order.orderedPcs)} {f.label}
            </p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={cn('h-full rounded-full', f.bar)} style={{ width: `${share}%` }} />
            </div>
          </div>
        </div>
        <StatusBadge status={order.status} className="shrink-0" />
        <ChevronRight className="hidden size-4 shrink-0 text-slate-300 lg:block" aria-hidden />
      </Link>
    </li>
  );
}

function FreeTakaRow({ t, selectable, on, onToggle }: { t: FreeStockTaka; selectable: boolean; on: boolean; onToggle: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {selectable && <TickBox size="lg" checked={on} onCheckedChange={onToggle} aria-label={`Select taka ${t.takaNo}`} />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[17px] font-bold tabular-nums text-slate-900">{t.takaNo}</span>
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500">
            <StageDot stage={t.stage} className="ring-0" /> {takaStageShortLabel(t.stage)}
          </span>
          <BlouseTag option={t.blouseOption} />
          {t.isDamaged && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[12px] font-semibold text-red-600">Damaged{t.damagedPcs ? ` · ${t.damagedPcs} pcs` : ''}</span>}
        </p>
        <p className="text-[13px] tabular-nums text-slate-500">
          {t.pcs != null ? `${pcsText(t.pcs)} pcs` : 'no pcs'}
          {t.meters != null && ` · ${formatMeters(t.meters)}`} · from Order {formatOrderNo(t.fromOrderNo)}
        </p>
      </div>
      <div className="shrink-0 text-right text-[12px] text-slate-500">
        {t.reason && <p className="font-semibold text-slate-700">{FREE_STOCK_REASON_LABEL[t.reason]}</p>}
        {t.freeStockAt && <p>{formatDate(t.freeStockAt)}</p>}
      </div>
    </li>
  );
}

/** Free stock of the item (belongs to no order): the figures and the free takas; Assign to order puts them on an order. */
function FreeStockSection({ itemKey, designCode, blouse, showEmpty }: { itemKey: string; designCode: string | null; blouse: BlouseFilter; showEmpty?: boolean }) {
  const { can } = useRole();
  const free = useItemFreeStock(itemKey, blouse);
  const [picked, setPicked] = useState<number[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const canAssign = can('canMoveToInventory');
  const data = free.data;
  if (free.isPending) return <Skeleton className="h-28 rounded-xl" />;
  if (free.isError || !data) return showEmpty ? <ErrorState error={free.error} onRetry={() => void free.refetch()} /> : null;
  if (data.takas.length === 0) {
    // Free stock KPI filter on: say so instead of an empty page.
    return showEmpty ? (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        <EmptyState icon={Boxes} title="No free stock" description="Takas moved to inventory or returned by a customer show here." className="py-10" />
      </div>
    ) : null;
  }
  const f = data.figures;
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white shadow-soft" aria-labelledby="free-stock-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 id="free-stock-title" className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
          <Boxes className="size-4 text-indigo-500" aria-hidden /> Free stock <span className="font-medium text-slate-400">· {pcsText(f.total)} pcs</span>
        </h2>
        {canAssign && (
          <Button variant="secondary" size="sm" onClick={() => setAssignOpen(true)}>
            <PackagePlus /> Assign to order{picked.length ? ` (${picked.length})` : ''}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2.5 border-b border-border p-3">
        <KpiTile label="Free pcs ready" value={pcsText(f.ready)} dot="#10B981" />
        <KpiTile label="Free pcs in making" value={pcsText(f.making)} dot="#38BDF8" />
        <KpiTile label="Free damaged pcs" value={pcsText(f.damaged)} dot="#EF4444" tone={f.damaged > 0 ? 'danger' : undefined} />
      </div>
      <ul className="divide-y divide-border">
        {data.takas.map((t) => (
          <FreeTakaRow key={t.id} t={t} selectable={canAssign} on={picked.includes(t.id)} onToggle={() => toggle(t.id)} />
        ))}
      </ul>
      {canAssign && (
        <AddFromFreeStockDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          choices={{ itemKey, designCode }}
          preselectIds={picked}
          onDone={() => setPicked([])}
        />
      )}
    </section>
  );
}

/** Inventory → item details: one design / variation — pcs tiles and its orders (search by order or taka number). */
export default function InventoryItemDetailsPage() {
  const { key = '' } = useParams<{ key: string }>();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounce(search, 300).trim();
  useEffect(() => {
    if ((params.get('q') ?? '') === debounced) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debounced) next.set('q', debounced);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
    // only react to the debounced text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const blouseParam = params.get('blouse');
  const blouse: BlouseFilter = isBlouseFilter(blouseParam) ? blouseParam : 'all';
  const setBlouse = (b: BlouseFilter) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (b === 'all') next.delete('blouse');
        else next.set('blouse', b);
        return next;
      },
      { replace: true },
    );
  const item = useInventoryItem(key, blouse);
  const navigate = useNavigate();
  const filterParam = params.get('filter') as ItemFilter | null;
  const filter: ItemFilter = filterParam && ITEM_FILTERS.includes(filterParam) ? filterParam : '';
  // Free stock belongs to no order: that filter shows only the free stock section (no order list).
  const orders = useInventoryItemOrders(key, debounced, filter === 'free' ? '' : filter, blouse);
  // In making / Ready for order / Ready for dispatch filter the order list; Free stock shows the free takas (click again to clear).
  const toggleFilter = (f: Exclude<ItemFilter, ''>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (filter === f) next.delete('filter');
        else next.set('filter', f);
        return next;
      },
      { replace: true },
    );
  // Damaged / In refinish open this design's Damaged details.
  const from = `/inventory/items/${key}${params.toString() ? `?${params.toString()}` : ''}`;
  const openDamaged = (refinish: boolean) => navigate(`/inventory/damaged/${key}${refinish ? '?refinish=1' : ''}`, { state: { from } });
  usePageTitle(item.data?.code ?? 'Inventory');

  const pcs = item.data?.pcs;
  return (
    <div className="page-container space-y-4 pb-28 pt-2 md:py-4">
      <BackLink />

      {item.isError ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <ErrorState error={item.error} onRetry={() => void item.refetch()} />
        </div>
      ) : (
        <>
          {item.data ? <ItemHeader item={item.data} /> : <Skeleton className="h-28 rounded-2xl" />}
          {item.data && <BlouseToggle value={blouse} onChange={setBlouse} counts={item.data.blouseCounts} />}
          <div className={KPI_GRID}>
            {pcs ? (
              <>
                <KpiTile label="Ordered" value={pcsText(pcs.ordered)} />
                <KpiTile label="In making" value={pcsText(pcs.inMaking)} dot="#38BDF8" onClick={() => toggleFilter('making')} active={filter === 'making'} />
                <KpiTile label="Ready for order" value={pcsText(pcs.inGodown)} dot="#10B981" onClick={() => toggleFilter('godown')} active={filter === 'godown'} />
                <KpiTile label="Ready for dispatch" value={pcsText(pcs.readyDispatch)} dot="#14B8A6" onClick={() => toggleFilter('ready')} active={filter === 'ready'} />
                <KpiTile label="Damaged" value={pcsText(pcs.damaged)} dot="#EF4444" tone={pcs.damaged > 0 ? 'danger' : undefined} onClick={() => openDamaged(false)} />
                <KpiTile label="In refinish" value={pcsText(pcs.inRefinish)} dot="#F59E0B" onClick={() => openDamaged(true)} />
                <KpiTile label="Free stock" value={pcsText(item.data?.free.total ?? 0)} dot="#6366F1" onClick={() => toggleFilter('free')} active={filter === 'free'} />
              </>
            ) : (
              <KpiSkeleton count={7} />
            )}
          </div>

          {filter !== 'free' && (
          <section className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
              <h2 className={cn('text-[15px] font-semibold text-slate-900', search && 'hidden sm:block')}>
                Orders {orders.data && <span className="font-medium text-slate-400">· {orders.data.length}</span>}
              </h2>
              <ExpandingSearch value={search} onChange={setSearch} placeholder="Search order or taka no…" className={search ? 'flex-1 sm:flex-none' : undefined} />
            </div>
            {orders.isPending ? (
              <div className="space-y-px p-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : orders.isError ? (
              <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
            ) : orders.data.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title={debounced || filter ? 'No orders match' : 'No orders for this design yet'}
                description={debounced || filter ? undefined : 'Orders on this design will be listed here.'}
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-border">
                {orders.data.map((o) => (
                  <OrderRow key={o.orderId} order={o} figure={filter === 'making' || filter === 'godown' ? filter : 'ready'} />
                ))}
              </ul>
            )}
          </section>
          )}

          <FreeStockSection itemKey={key} designCode={item.data?.code ?? null} blouse={blouse} showEmpty={filter === 'free'} />
        </>
      )}
    </div>
  );
}
