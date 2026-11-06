import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dualText, type DamagedLotRow } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { BackLink } from '../inventory/parts';
import { useDamagedLot, useDamagedLots } from './api';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function LotDetails({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useDamagedLot(id ?? 0);
  const lot = q.data;
  return (
    <Modal open={id !== null} onOpenChange={(o) => !o && onClose()} title={lot ? `${lot.label} · ${formatDate(lot.lotDate)}` : 'Damaged lot'} variant="right" size="md">
      {!lot ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">Buyer</dt><dd className="font-semibold">{lot.buyer ?? '—'}</dd></div>
            {lot.amount !== null && <div><dt className="text-slate-500">Amount</dt><dd className="font-semibold">{rupees(lot.amount)}</dd></div>}
            <div><dt className="text-slate-500">Takas</dt><dd className="font-semibold">{lot.takas}</dd></div>
            <div><dt className="text-slate-500">Quantity</dt><dd className="font-semibold">{dualText(lot.pcs, lot.meters)}</dd></div>
          </dl>
          {lot.note && <p className="text-sm text-slate-600">{lot.note}</p>}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {lot.items.map((i) => (
              <li key={i.takaId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-bold tabular-nums">{i.takaNo}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500">{i.designCode ?? '—'} · {i.quality}</span>
                <span className="tabular-nums">{i.meters !== null && i.pcs === null ? `${i.meters} m` : `${i.pcs ?? 0} pcs`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function LotCard({ l, onOpen, showAmount }: { l: DamagedLotRow; onOpen: () => void; showAmount: boolean }) {
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-xl border border-border bg-white p-4 text-left shadow-soft hover:border-primary/30">
      <span className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-slate-900">{l.label}</span>
        <span className="text-sm text-slate-500">{formatDate(l.lotDate)}</span>
      </span>
      <span className="block text-sm text-slate-600">{l.buyer ?? 'No buyer noted'}</span>
      <span className="mt-1 block text-sm font-semibold tabular-nums text-slate-800">{l.takas} takas · {dualText(l.pcs, l.meters)}</span>
      {showAmount && l.amount !== null && <span className="mt-1 block text-sm font-bold text-emerald-700">{rupees(l.amount)}</span>}
    </button>
  );
}

/** Inventory → Damaged → Damaged lots sold: date, buyer, takas, pcs / m and (rate roles only) the amount. */
export default function DamagedLotsPage() {
  usePageTitle('Damaged lots sold');
  const { can } = useRole();
  const q = useDamagedLots();
  const [open, setOpen] = useState<number | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const showAmount = can('canSeeRate');
  return (
    <div className="page-container space-y-4 pb-24 pt-2 md:py-4">
      <BackLink fallback="/inventory?section=damaged" label="Damaged" />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold text-slate-900">Damaged lots sold</h1>
        {can('canAdjustFinishedStock') && (
          <Button asChild size="sm">
            <Link to="/inventory/damaged/sell-lot">
              <Trash2 /> Sell as lot
            </Link>
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={Trash2} title="No damaged lots sold yet" className="py-14" />
        </div>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
            {items.map((l) => (
              <li key={l.id}><LotCard l={l} onOpen={() => setOpen(l.id)} showAmount={showAmount} /></li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-xl border border-border bg-white shadow-soft lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Lot</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Buyer</th><th className="px-3 py-2">Takas</th><th className="px-3 py-2">Quantity</th>{showAmount && <th className="px-3 py-2 text-right">Amount</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-slate-50" onClick={() => setOpen(l.id)}>
                    <td className="px-3 py-2 font-bold">{l.label}</td>
                    <td className="px-3 py-2">{formatDate(l.lotDate)}</td>
                    <td className="px-3 py-2">{l.buyer ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{l.takas}</td>
                    <td className="px-3 py-2 tabular-nums">{dualText(l.pcs, l.meters)}</td>
                    {showAmount && <td className="px-3 py-2 text-right font-semibold tabular-nums">{l.amount !== null ? rupees(l.amount) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMore hasNextPage={!!q.hasNextPage} isFetchingNextPage={q.isFetchingNextPage} fetchNextPage={() => void q.fetchNextPage()} shown={items.length} total={total} noun="lots" />
        </>
      )}
      <LotDetails id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
