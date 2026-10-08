import { ChevronRight, ClipboardList } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { type InventoryOrderRow } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDebounce } from '@/hooks/useDebounce';
import { formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useInventoryItem, useInventoryItemOrders } from './api';
import { BackLink, ExpandingSearch, ItemHeader, KpiSkeleton, KpiTile, pcsText } from './parts';

const KPI_GRID = 'grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6';

function OrderRow({ order }: { order: InventoryOrderRow }) {
  const share = order.orderedPcs > 0 ? Math.min(100, (order.readyPcs / order.orderedPcs) * 100) : 0;
  return (
    <li>
      <Link
        to={`/orders/${order.orderId}`}
        className="flex min-h-[64px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 outline-none transition hover:bg-slate-50 focus-visible:bg-slate-50"
        aria-label={`Open order ${formatOrderNo(order.orderNo)}`}
      >
        <div className="min-w-[9rem] flex-1">
          <p className="text-[17px] font-bold leading-tight text-slate-900">Order {formatOrderNo(order.orderNo)}</p>
          <p className="truncate text-[13px] text-slate-500">{order.customerName}</p>
        </div>
        <div className="flex min-w-[14rem] flex-[2] items-center gap-4">
          <div className="shrink-0">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">Ordered</p>
            <p className="text-[15px] font-semibold tabular-nums text-slate-800">{pcsText(order.orderedPcs)}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="whitespace-nowrap text-[12px] font-medium tabular-nums text-slate-500">
              <b className="text-slate-800">{pcsText(order.readyPcs)}</b> / {pcsText(order.orderedPcs)} ready
            </p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${share}%` }} />
            </div>
          </div>
        </div>
        <StatusBadge status={order.status} className="shrink-0" />
        <ChevronRight className="hidden size-4 shrink-0 text-slate-300 lg:block" aria-hidden />
      </Link>
    </li>
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

  const item = useInventoryItem(key);
  const navigate = useNavigate();
  const filter = params.get('filter') === 'ready' ? 'ready' : params.get('filter') === 'making' ? 'making' : '';
  const orders = useInventoryItemOrders(key, debounced, filter);
  // In making / Ready for dispatch filter the order list (click again to clear).
  const toggleFilter = (f: 'ready' | 'making') =>
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
          <div className={KPI_GRID}>
            {pcs ? (
              <>
                <KpiTile label="Ordered" value={pcsText(pcs.ordered)} />
                <KpiTile label="In making" value={pcsText(pcs.inMaking)} dot="#38BDF8" onClick={() => toggleFilter('making')} active={filter === 'making'} />
                <KpiTile label="In godown" value={pcsText(pcs.inGodown)} dot="#10B981" />
                <KpiTile label="Ready for dispatch" value={pcsText(pcs.readyDispatch)} dot="#14B8A6" onClick={() => toggleFilter('ready')} active={filter === 'ready'} />
                <KpiTile label="Damaged" value={pcsText(pcs.damaged)} dot="#EF4444" tone={pcs.damaged > 0 ? 'danger' : undefined} onClick={() => openDamaged(false)} />
                <KpiTile label="In refinish" value={pcsText(pcs.inRefinish)} dot="#F59E0B" onClick={() => openDamaged(true)} />
              </>
            ) : (
              <KpiSkeleton count={6} />
            )}
          </div>

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
                  <OrderRow key={o.orderId} order={o} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
