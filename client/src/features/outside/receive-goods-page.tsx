import { Inbox, PackageSearch } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPoQty } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { formatOrderNo, formatMoney } from '@/lib/format';
import { BlouseTag } from '../free-stock/blouse';
import { useReceiveGoods } from './api';
import { PoStatusPill } from './po-status';

const CARD = 'flex flex-col gap-2 rounded-xl border border-border bg-white p-3.5 shadow-soft';

/** `/receive-goods` — open outside POs + FG orders awaiting goods (the godown supervisor, Dhruvil; owners too). */
export default function ReceiveGoodsPage() {
  usePageTitle('Receive goods');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const query = useReceiveGoods(useDebounce(search.trim(), 300));

  return (
    <div className="page-container space-y-5 pb-24 pt-4 md:py-5">
      <SearchBar value={search} onChange={setSearch} placeholder="Search by order no, PO no, weaver, design…" />

      {query.isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.pos.length === 0 && query.data.fgOrders.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={PackageSearch} title="Nothing waiting to be received" description="Open outside POs and FG purchases awaiting goods show up here." className="py-14" />
        </div>
      ) : (
        <>
          {query.data.pos.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Outside POs ({query.data.pos.length})</h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {query.data.pos.map((po) => (
                  <li key={po.id} className={CARD}>
                    <div className="flex items-start gap-3">
                      <ImageThumb thumbUrl={po.thumbUrl} alt={po.designCode ? `Design ${po.designCode}` : 'No design'} preview={false} className="size-14 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center justify-between gap-2 text-lg font-bold text-slate-900">
                          {po.label}
                          <PoStatusPill status={po.status} />
                        </p>
                        <p className="truncate text-sm font-semibold text-slate-700">
                          {formatOrderNo(po.orderNo)} {po.designCode ? `· ${po.designCode}` : ''}
                        </p>
                        <p className="truncate text-sm text-slate-500">
                          {po.weaver.name} ({po.weaver.shortCode}) · {po.quality.name}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-medium text-slate-700">
                      {formatPoQty(po.pendingQty, po.unit)} pending of {formatPoQty(po.quantity, po.unit)}
                      {po.rate != null && ` · ${formatMoney(po.rate)}`}
                    </p>
                    <BlouseTag option={po.blouseOption} />
                    <Button size="sm" className="mt-auto w-fit" onClick={() => navigate(`/outside-pos/${po.id}/receive`)}>
                      Receive challan
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {query.data.fgOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">FG purchases awaiting goods ({query.data.fgOrders.length})</h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {query.data.fgOrders.map((o) => (
                  <li key={o.orderId} className={CARD}>
                    <div className="flex items-start gap-3">
                      <ImageThumb thumbUrl={o.thumbUrl} alt={o.designCode ? `Design ${o.designCode}` : 'No design'} preview={false} className="size-14 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-lg font-bold text-slate-900">{formatOrderNo(o.orderNo)}</p>
                        <p className="truncate text-sm font-semibold text-slate-700">{o.designCode ?? 'No design'}</p>
                        {o.customerName && <p className="truncate text-sm text-slate-500">{o.customerName}</p>}
                      </div>
                    </div>
                    <p className="text-sm text-slate-500">{o.quality}</p>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      {o.receivedTakas > 0 ? (
                        <>
                          <Inbox className="size-3.5 text-amber-500" aria-hidden /> {o.receivedTakas} received so far ({o.receivedPcs} pcs)
                        </>
                      ) : (
                        'Nothing received yet'
                      )}
                    </p>
                    <BlouseTag option={o.blouseOption} />
                    <Button size="sm" className="mt-auto w-fit" onClick={() => navigate(`/orders/${o.orderId}/receive-fg`)}>
                      Receive goods
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
