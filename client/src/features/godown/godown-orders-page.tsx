import { PackageOpen, SearchX } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GodownOrderCard } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore, SearchBar } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useGodownOrders } from './api';

function OrderCard({ order }: { order: GodownOrderCard }) {
  const navigate = useNavigate();
  const open = () => navigate(`/godown/orders/${order.orderId}`);
  return (
    <li>
      <article
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            open();
          }
        }}
        className="flex min-h-[7rem] cursor-pointer items-center gap-4 rounded-xl border border-border bg-white p-4 shadow-soft outline-none transition duration-200 hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={`Open order ${formatOrderNo(order.orderNo)}`}
      >
        <ImageThumb
          thumbUrl={order.thumbUrl}
          fullUrl={order.imageUrl}
          alt={order.designCode ? `Design ${order.designCode}` : 'No design'}
          className="size-20 shrink-0"
          rounded="rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="whitespace-nowrap text-2xl font-extrabold leading-tight tracking-tight text-slate-900">Order {formatOrderNo(order.orderNo)}</p>
          {order.customerName && <p className="truncate text-[15px] font-semibold text-slate-800">{order.customerName}</p>}
          <p className="truncate text-[15px] font-semibold text-slate-600">{order.designCode ? `Design ${order.designCode}` : 'No design'}</p>
          <p className="mt-0.5 whitespace-nowrap text-sm font-medium tabular-nums text-slate-500">{order.orderedPcs.toLocaleString('en-IN')} pcs ordered</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {order.uncheckedCount > 0 && (
              <span className="inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold tabular-nums text-amber-800" title="Final takas not checked yet">
                {order.uncheckedCount} to check
              </span>
            )}
            {order.readyDispatchCount > 0 && (
              <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold tabular-nums text-emerald-800" title="Takas ready for dispatch">
                {order.readyDispatchCount} ready to dispatch
              </span>
            )}
          </div>
        </div>
      </article>
    </li>
  );
}

/** Godown supervisor → Orders: orders with at least one taka that passed the Mill QC. Search by order or taka number. */
export default function GodownOrdersPage() {
  usePageTitle('Orders');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300).trim();
  const query = useGodownOrders(debounced);

  return (
    <div className="page-container space-y-4 pb-28 pt-4 md:py-5">
      <SearchBar value={search} onChange={setSearch} placeholder="Search by order no, client or taka no…" />
      {query.isPending ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState
            icon={debounced ? SearchX : PackageOpen}
            title={debounced ? 'No orders match your search' : 'No orders in the godown yet'}
            description={debounced ? undefined : 'Orders appear here once their takas pass the Mill QC.'}
          />
        </div>
      ) : (
        <>
          <ul className={cn('grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]', query.isPlaceholderData && 'opacity-60')}>
            {query.items.map((o) => (
              <OrderCard key={o.orderId} order={o} />
            ))}
          </ul>
          <LoadMore
            hasNextPage={!!query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={() => void query.fetchNextPage()}
            shown={query.items.length}
            total={query.total}
            noun="orders"
          />
        </>
      )}
    </div>
  );
}
