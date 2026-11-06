import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import type { StockAdjustmentRow } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { DateRangePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BackLink } from '../inventory/parts';
import { useStockAdjustments } from './api';

const qtyText = (a: StockAdjustmentRow) => (a.unit === 'meters' ? `${a.qty.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m` : `${a.qty.toLocaleString('en-IN')} pcs`);
const kindBadge = (k: 'add' | 'remove') => cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold', k === 'add' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700');

/** Inventory → Stock adjustments: every manual Add / Remove stock and every damaged lot. Table on desktop, 2-column cards on tablet. */
export default function StockAdjustmentsPage() {
  usePageTitle('Stock adjustments');
  const [kind, setKind] = useState<'all' | 'add' | 'remove'>('all');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const q = useStockAdjustments({ kind: kind === 'all' ? undefined : kind, from: range.from, to: range.to });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;

  return (
    <div className="page-container space-y-4 pb-24 pt-2 md:py-4">
      <BackLink />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold text-slate-900">Stock adjustments</h1>
        <Segmented<'all' | 'add' | 'remove'>
          aria-label="Add or remove"
          size="lg"
          value={kind}
          onChange={setKind}
          options={[{ value: 'all', label: 'All' }, { value: 'add', label: 'Added' }, { value: 'remove', label: 'Removed' }]}
        />
        <DateRangePicker value={range} onChange={(r) => setRange({ from: r.from, to: r.to })} />
      </div>
      {q.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={ClipboardList} title="No adjustments" description="Manual Add stock / Remove stock and damaged lots appear here." className="py-14" />
        </div>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
            {items.map((a) => (
              <li key={a.id} className="rounded-xl border border-border bg-white p-4 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <span className={kindBadge(a.kind)}>{a.kind === 'add' ? 'Added' : 'Removed'}</span>
                  <span className="text-xs text-slate-400">{formatDateTime(a.createdAt)}</span>
                </div>
                <p className="mt-2 text-lg font-bold text-slate-900">{a.designCode ?? '—'} <span className="text-sm font-medium text-slate-500">· {a.quality}</span></p>
                <p className="text-[15px] font-semibold tabular-nums text-slate-800">
                  {qtyText(a)} {a.condition === 'damaged' && <span className="text-red-600">· damaged</span>} {a.takaNo && <span className="text-slate-400">· {a.takaNo}</span>}
                </p>
                <p className="mt-1 text-sm text-slate-600">{a.remark}</p>
                <p className="mt-1 text-xs text-slate-400">{a.userName ?? a.role}</p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-xl border border-border bg-white shadow-soft lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Add / Remove</th>
                  <th className="px-3 py-2">Quality</th>
                  <th className="px-3 py-2">Design</th>
                  <th className="px-3 py-2">Quantity</th>
                  <th className="px-3 py-2">Taka</th>
                  <th className="px-3 py-2">Fresh / damaged</th>
                  <th className="px-3 py-2">Reason / remark</th>
                  <th className="px-3 py-2">User</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-slate-600">{formatDateTime(a.createdAt)}</td>
                    <td className="px-3 py-2"><span className={kindBadge(a.kind)}>{a.kind === 'add' ? 'Added' : 'Removed'}</span></td>
                    <td className="px-3 py-2">{a.quality}</td>
                    <td className="px-3 py-2 font-semibold">{a.designCode ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{qtyText(a)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{a.takaNo ?? '—'}</td>
                    <td className="px-3 py-2">{a.condition ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{a.remark}</td>
                    <td className="px-3 py-2 text-slate-500">{a.userName ?? a.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMore hasNextPage={!!q.hasNextPage} isFetchingNextPage={q.isFetchingNextPage} fetchNextPage={() => void q.fetchNextPage()} shown={items.length} total={total} noun="adjustments" />
        </>
      )}
    </div>
  );
}
