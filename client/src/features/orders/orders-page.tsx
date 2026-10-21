import { ClipboardList, Factory, Plus, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { STATUS, type OrderListItem } from '@rivoora/shared';
import { OrderTypeTag } from './order-type-tag';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, Fab, FetchingIndicator, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { OnHoldBadge } from './hold/hold-order';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { formatDate, formatOrderNo, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOrders, useSendToProduction } from './api';
import { useOrderFilters } from './filters';
import { FilterChips, OrderFiltersDialog } from './order-filters';
import { BlouseTag } from '../free-stock/blouse';

const isPending = (o: OrderListItem) => o.status === STATUS.PENDING_PRODUCTION;

function SendButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      variant="soft"
      size="sm"
      className={cn('h-8 px-2.5 text-xs', className)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Factory className="!size-3.5" /> Send for production
    </Button>
  );
}

const GRID = 'grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 2xl:gap-4';

function ListSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-soft">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-6 w-32 rounded-full" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="size-16 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="truncate text-sm text-slate-700" title={value}>
        {value}
      </dd>
    </div>
  );
}

export default function OrdersPage() {
  usePageTitle('Orders');
  const navigate = useNavigate();
  const { can } = useRole();
  const canAdd = can('canAddOrder');
  const canSend = can('canSendToProduction');

  const { filters, setFilters, activeCount } = useOrderFilters();
  const [searchText, setSearchText] = useState(filters.search);
  const debounced = useDebounce(searchText, 300);
  useEffect(() => {
    if (debounced.trim() !== filters.search) setFilters({ search: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query = useOrders(filters);
  const { items, total, isPending: loading, isError, error, refetch } = query;
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Selection mode for "Send for production"
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const send = useSendToProduction();
  const pendingLoaded = useMemo(() => items.filter(isPending), [items]);

  // Drop selections that are no longer pending (e.g. after a refetch).
  useEffect(() => {
    if (!selecting) return;
    setSelected((prev) => {
      const pendingIds = new Set(pendingLoaded.map((o) => o.id));
      const next = new Set([...prev].filter((id) => pendingIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingLoaded, selecting]);

  const startSelecting = (order: OrderListItem) => {
    setSelecting(true);
    setSelected(new Set([order.id]));
  };
  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirmOpen && exitSelecting();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, confirmOpen]);

  const confirmSend = () => {
    const ids = [...selected];
    send.mutate(ids, {
      onSuccess: (res) => {
        toast.success(`${res.updated} order${res.updated === 1 ? '' : 's'} sent for production`);
        setConfirmOpen(false);
        exitSelecting();
      },
      onError: () => setConfirmOpen(false),
    });
  };

  const onRowClick = (o: OrderListItem) => {
    if (selecting) {
      if (isPending(o)) toggle(o.id);
      return;
    }
    navigate(`/orders/${o.id}`);
  };

  const hasFilters = activeCount > 0 || !!filters.search;
  const clearAll = () => {
    setSearchText('');
    setFilters({ search: '', statuses: [], materials: [], parties: [], types: [], from: undefined, to: undefined });
  };
  const count = selected.size;

  return (
    <div className="page-container space-y-3 pb-24 pt-4 md:space-y-4 md:py-5">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <SearchBar
          value={searchText}
          onChange={setSearchText}
          placeholder={can('canSeeClient') ? 'Search by client, broker, order no, design, quantity, material…' : 'Search by order no, design, quantity, material…'}
        />
        <FetchingIndicator show={query.isFetching && !loading && !query.isFetchingNextPage} />
        <Button
          variant="secondary"
          size="icon"
          className="relative shrink-0 bg-white"
          onClick={() => setFiltersOpen(true)}
          aria-label={activeCount ? `Filters (${activeCount} active)` : 'Filters'}
        >
          <SlidersHorizontal className="!size-5" />
          {activeCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white ring-2 ring-background">
              {activeCount}
            </span>
          )}
        </Button>
        {canAdd && (
          <Button className="hidden shrink-0 md:inline-flex" onClick={() => navigate('/orders/new')}>
            <Plus /> Add Order
          </Button>
        )}
      </div>
      <FilterChips filters={filters} onChange={setFilters} />

      {selecting && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary-soft px-4 py-2.5 text-sm text-primary" role="status">
          <Factory className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">Select the pending orders to send for production.</span>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <ListSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {hasFilters ? (
            <EmptyState
              icon={SearchX}
              title="No orders match your search/filters"
              action={
                <Button variant="secondary" onClick={clearAll}>
                  Clear filters
                </Button>
              }
            />
          ) : canAdd ? (
            <EmptyState
              icon={ClipboardList}
              title="No orders yet — add your first order"
              action={
                <Button onClick={() => navigate('/orders/new')}>
                  <Plus /> Add Order
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="No orders pending for jobsheets yet"
              description="Orders appear here once they are sent for production."
            />
          )}
        </div>
      ) : (
        <>
          {/* Order cards — grid on every breakpoint (1 / 2 / 3 / 4 columns) */}
          <ul className={GRID}>
            {items.map((o) => {
              const pending = isPending(o);
              const disabled = selecting && !pending;
              const checked = selected.has(o.id);
              return (
                <li key={o.id} className="min-w-0">
                  <div
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-disabled={disabled || undefined}
                    aria-pressed={selecting && pending ? checked : undefined}
                    onClick={() => !disabled && onRowClick(o)}
                    onKeyDown={(e) => {
                      if (!disabled && (e.key === 'Enter' || (selecting && e.key === ' '))) {
                        e.preventDefault();
                        onRowClick(o);
                      }
                    }}
                    className={cn(
                      'flex h-full gap-3 rounded-xl border border-border bg-white p-4 shadow-soft outline-none transition',
                      disabled
                        ? 'cursor-not-allowed opacity-40'
                        : 'cursor-pointer hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40 active:bg-slate-50',
                      checked && 'border-primary/40 bg-primary-soft/60',
                    )}
                  >
                    {selecting && pending && (
                      <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                        <Checkbox checked={checked} onCheckedChange={() => toggle(o.id)} aria-label={`Select order ${o.orderNo}`} />
                      </div>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900">{formatOrderNo(o.orderNo)}</span>
                        <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
                          <StatusBadge status={o.status} className="min-w-0" />
                          {o.isOnHold && <OnHoldBadge />}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <ImageThumb
                          thumbUrl={o.designThumbUrl}
                          alt={o.designCode ? `Design ${o.designCode}` : 'No design'}
                          preview={false}
                          className="size-16 shrink-0 ring-1 ring-inset ring-black/5"
                        />
                        <div className="min-w-0 flex-1">
                          {can('canSeeClient') && (
                            <p className="truncate text-[15px] font-semibold text-slate-900" title={o.customerName}>
                              {o.customerName}
                            </p>
                          )}
                          <p
                            className={cn('mt-0.5 truncate text-xs', o.designCode ? 'font-medium text-slate-500' : 'text-slate-400')}
                            title={o.designCode ?? undefined}
                          >
                            {o.designCode ? `Design ${o.designCode}` : 'No design'}
                          </p>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3">
                        <Field label="Quality" value={o.materialName} />
                        <Field label="Quantity" value={formatQuantity(o.quantity, o.unit)} />
                        <Field label="Date" value={formatDate(o.orderDate)} />
                        <div className="flex flex-wrap items-end gap-1.5 pb-0.5">
                          <OrderTypeTag type={o.orderType} />
                          <BlouseTag option={o.blouseOption} />
                        </div>
                        {can('canSeeClient') && o.brokerName && <Field label="Broker" value={o.brokerName} />}
                      </dl>
                      {!selecting && canSend && pending && (
                        <div className="mt-auto pt-3">
                          <SendButton onClick={() => startSelecting(o)} className="w-full" />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <LoadMore
            hasNextPage={!!query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={() => void query.fetchNextPage()}
            shown={items.length}
            total={total}
            noun="orders"
          />
        </>
      )}

      {/* Selection action bar */}
      {selecting && (
        <div className="kb-bar fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-white/95 px-4 py-3 shadow-pop backdrop-blur lg:sticky lg:inset-x-auto lg:bottom-4 lg:rounded-xl lg:border">
          <div className="mx-auto flex flex-wrap items-center gap-2">
            <p className="mr-auto hidden text-sm font-medium text-slate-700 sm:block">
              {count} of {pendingLoaded.length} pending selected
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set(pendingLoaded.map((o) => o.id)))}
              disabled={pendingLoaded.length === 0 || count === pendingLoaded.length}
            >
              Select all pending
            </Button>
            <Button variant="secondary" size="sm" onClick={exitSelecting}>
              <X /> Cancel
            </Button>
            <Button size="sm" className="flex-1 sm:flex-none" disabled={count === 0} onClick={() => setConfirmOpen(true)}>
              <Factory /> Send for production ({count})
            </Button>
          </div>
        </div>
      )}

      {canAdd && !selecting && <Fab onClick={() => navigate('/orders/new')} label="Add Order" />}

      <OrderFiltersDialog open={filtersOpen} onOpenChange={setFiltersOpen} value={filters} onApply={setFilters} />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Send ${count} order${count === 1 ? '' : 's'} for production?`}
        description="They will move to Jobsheet pending and become visible to the production team."
        confirmLabel="Confirm"
        loading={send.isPending}
        onConfirm={confirmSend}
      />
    </div>
  );
}
