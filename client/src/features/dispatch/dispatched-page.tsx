import { SearchX, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { DispatchedOrderCard } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore, SearchBar } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDispatchedOrders } from './api';
import { BlouseTag } from '../free-stock/blouse';

/** Status filter of the Dispatched list (Returned = dispatched, then goods came back to stock). */
const DISPATCHED_FILTERS = [
  { key: '', label: 'All' },
  { key: 'partly_dispatched', label: 'Partly dispatched' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'returned', label: 'Returned' },
] as const;

function OrderCard({ order }: { order: DispatchedOrderCard }) {
  const navigate = useNavigate();
  const open = () => navigate(`/dispatched/${order.orderId}`);
  const percent = order.orderedPcs > 0 ? Math.min(100, (order.dispatchedPcs / order.orderedPcs) * 100) : 0;
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
        className="flex cursor-pointer gap-4 rounded-xl border border-border bg-white p-4 shadow-soft outline-none transition duration-200 hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={`Open dispatched order ${formatOrderNo(order.orderNo)}`}
      >
        <ImageThumb
          thumbUrl={order.thumbUrl}
          fullUrl={order.imageUrl}
          alt={order.designCode ? `Design ${order.designCode}` : 'No design'}
          className="size-24 shrink-0"
          rounded="rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="whitespace-nowrap text-2xl font-extrabold leading-tight tracking-tight text-slate-900">Order {formatOrderNo(order.orderNo)}</p>
            <StatusBadge status={order.status} />
          </div>
          <p className="truncate text-[15px] font-semibold text-slate-700">{order.customerName}</p>
          <p className="truncate text-sm text-slate-500">
            {order.designCode ? `Design ${order.designCode}` : 'No design'}
            {order.quality && ` · ${order.quality}`}
          </p>
          {order.blouseOption && <BlouseTag option={order.blouseOption} className="mt-1" />}
          <div className="mt-2.5">
            <p className="text-sm font-semibold tabular-nums text-slate-800">
              {order.dispatchedPcs.toLocaleString('en-IN')} <span className="font-medium text-slate-500">/ {order.orderedPcs.toLocaleString('en-IN')} pcs dispatched</span>
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
              <div className="h-full rounded-full bg-teal-600" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <p className="mt-2 text-xs font-medium tabular-nums text-slate-500">
            {order.latestChallanLabel} · {formatDate(order.latestChallanDate)}
          </p>
        </div>
      </article>
    </li>
  );
}

/** `/dispatched` — orders with dispatch challans, newest dispatch first. Server-side search. */
export default function DispatchedPage() {
  usePageTitle('Dispatched');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300).trim();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status = (DISPATCHED_FILTERS.some((f) => f.key === raw) ? raw : '') as string;
  const query = useDispatchedOrders(debounced, status);
  const setStatus = (key: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (key) next.set('status', key);
        else next.delete('status');
        return next;
      },
      { replace: true },
    );

  return (
    <div className="page-container space-y-4 pb-28 pt-4 md:py-5">
      <SearchBar value={search} onChange={setSearch} placeholder="Search order no, client, broker, challan (DC-12), taka no, design, quality…" />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {DISPATCHED_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatus(f.key)}
            aria-pressed={status === f.key}
            className={cn(
              'min-h-9 rounded-full border px-3.5 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
              status === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-white text-slate-600 hover:bg-muted',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {query.isPending ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState
            icon={debounced ? SearchX : Truck}
            title={debounced ? 'No dispatches match your search' : 'Nothing dispatched yet'}
            description={debounced ? undefined : 'Orders appear here once a dispatch challan is created.'}
          />
        </div>
      ) : (
        <>
          <ul className={cn('grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]', query.isPlaceholderData && 'opacity-60')}>
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
