import { ChevronRight, Truck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { InventoryDispatchedOrderRow } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatOrderNo } from '@/lib/format';
import { BlouseTag } from '../free-stock/blouse';
import { useInventoryItem, useInventoryItemDispatched } from './api';
import { BackLink, ItemHeader, pcsText } from './parts';

function DispatchedRow({ order }: { order: InventoryDispatchedOrderRow }) {
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
        <div className="flex shrink-0 items-center gap-6">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">Ordered</p>
            <p className="text-[15px] font-semibold tabular-nums text-slate-800">{pcsText(order.orderedPcs)}</p>
          </div>
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">Dispatched</p>
            <p className="text-[15px] font-semibold tabular-nums text-slate-800">{pcsText(order.dispatchedPcs)}</p>
          </div>
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">Last dispatch</p>
            <p className="text-[15px] font-semibold tabular-nums text-slate-800">
              {order.lastDispatchDate ? formatDate(order.lastDispatchDate) : '—'}
              {order.challanCount > 1 && <span className="ml-1 text-[12px] font-medium text-slate-400">· {order.challanCount} challans</span>}
            </p>
          </div>
        </div>
        <StatusBadge status={order.status} className="shrink-0" />
        <ChevronRight className="hidden size-4 shrink-0 text-slate-300 lg:block" aria-hidden />
      </Link>
    </li>
  );
}

/** Inventory → item → Dispatched history: the design's fully dispatched orders (they are not in the inventory figures). */
export default function DispatchedHistoryPage() {
  const { key = '' } = useParams<{ key: string }>();
  const item = useInventoryItem(key);
  const orders = useInventoryItemDispatched(key);
  usePageTitle(item.data?.code ? `${item.data.code} · Dispatched` : 'Dispatched history');

  const totalPcs = orders.data?.reduce((n, o) => n + o.dispatchedPcs, 0) ?? 0;
  return (
    <div className="page-container space-y-4 pb-28 pt-2 md:py-4">
      <BackLink fallback={`/inventory/items/${key}`} label={item.data?.code ?? 'Back'} />
      {item.isError ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <ErrorState error={item.error} onRetry={() => void item.refetch()} />
        </div>
      ) : (
        <>
          {item.data ? <ItemHeader item={item.data} /> : <Skeleton className="h-28 rounded-2xl" />}
          <section className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
            <div className="flex min-h-12 items-center gap-2 border-b border-border px-4 py-2">
              <Truck className="size-4 text-teal-600" aria-hidden />
              <h2 className="text-[15px] font-semibold text-slate-900">
                Dispatched orders
                {orders.data && (
                  <span className="font-medium text-slate-400">
                    {' '}
                    · {orders.data.length} · {pcsText(totalPcs)} pcs
                  </span>
                )}
              </h2>
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
              <EmptyState icon={Truck} title="No dispatched orders yet" description="Orders of this design show here once they are fully dispatched." className="py-10" />
            ) : (
              <ul className="divide-y divide-border">
                {orders.data.map((o) => (
                  <DispatchedRow key={o.orderId} order={o} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
