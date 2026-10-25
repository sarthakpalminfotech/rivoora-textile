import { Plus, ReceiptText, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { YarnPoListItem } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, Fab, FetchingIndicator, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { FiltersButton } from '../filters/work-filters';
import { useYarnPos } from './api';
import { Kg, money, ProgressBar, YarnPoStatusBadge } from './parts';
import { useYarnPoFilters, YarnPoFilterChips, YarnPoFiltersDialog } from './po-filters';

function Qualities({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-slate-400">—</span>;
  return (
    <span className="truncate">
      {names[0]}
      {names.length > 1 && <span className="ml-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">+{names.length - 1}</span>}
    </span>
  );
}

function PoCard({ po, onOpen, showAmount }: { po: YarnPoListItem; onOpen: () => void; showAmount: boolean }) {
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-xl border border-border bg-white p-4 text-left shadow-soft active:bg-slate-50">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold tabular-nums text-slate-900">PO {po.poNo}</span>
        <span className="text-sm text-slate-500">{formatDate(po.poDate)}</span>
        <YarnPoStatusBadge status={po.status} className="ml-auto" />
      </div>
      <p className="mt-1 truncate font-semibold text-slate-800">{po.party.name}</p>
      <p className="mt-0.5 flex min-w-0 text-sm text-slate-500">
        <Qualities names={po.qualities} />
      </p>
      <ProgressBar value={po.orderedG ? po.receivedG / po.orderedG : 0} className="mt-3" />
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-xs text-slate-400">Ordered</p>
          <Kg g={po.orderedG} className="font-semibold text-slate-800" />
        </div>
        <div>
          <p className="text-xs text-slate-400">Received</p>
          <Kg g={po.receivedG} className="font-semibold text-slate-800" />
        </div>
        <div>
          <p className="text-xs text-slate-400">Pending</p>
          <Kg g={po.pendingG} className="font-semibold text-slate-800" />
        </div>
      </div>
      {showAmount && <p className="mt-2 text-right text-sm font-semibold text-slate-700">{money(po.amountPaise)}</p>}
    </button>
  );
}

/** Sprint 17 — Yarn PO list (`/yarn-po`): search, URL filters + chips; a table from 768px, cards on phones. */
export default function YarnPoListPage() {
  usePageTitle('Yarn PO');
  const navigate = useNavigate();
  const { can } = useRole();
  const canManage = can('canManageYarnPo');
  const { filters, setFilters, activeCount } = useYarnPoFilters();
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search.trim(), 300);
  useEffect(() => {
    if (debounced !== filters.search) setFilters({ search: debounced });
  }, [debounced, filters.search, setFilters]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useYarnPos({ ...filters, search: debounced });
  const { items, total, isPending, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const showAmount = items.some((p) => p.amountPaise !== null);
  const open = (po: YarnPoListItem) => navigate(`/yarn-po/${po.id}`);
  const filtered = !!debounced || activeCount > 0;

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      <div className="flex items-center gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search PO no, party, quality…" />
        <FetchingIndicator show={query.isFetching && !isPending && !isFetchingNextPage} />
        <FiltersButton count={activeCount} onClick={() => setFiltersOpen(true)} className="size-11" />
        {canManage && (
          <Button onClick={() => navigate('/yarn-po/new')} className="hidden md:inline-flex">
            <Plus /> New PO
          </Button>
        )}
      </div>
      <YarnPoFilterChips filters={filters} onChange={setFilters} />

      {isPending ? (
        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-0">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {filtered ? (
            <EmptyState
              icon={SearchX}
              title="No Yarn POs match"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setFilters({ search: '', status: [], party: [], quality: [], from: undefined, to: undefined });
                  }}
                >
                  Clear search and filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ReceiptText}
              title="No Yarn POs yet"
              description="Raise a PO to a yarn party; receive its challans partly or fully into a zone."
              action={
                canManage ? (
                  <Button onClick={() => navigate('/yarn-po/new')}>
                    <Plus /> New PO
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      ) : (
        <>
          {/* Tablet / desktop table */}
          <div className="hidden overflow-clip rounded-xl border border-border bg-white shadow-soft md:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="sticky top-16 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="w-[13%] px-4 py-3">PO no · date</th>
                  <th scope="col" className="px-4 py-3">Party · qualities</th>
                  <th scope="col" className="w-[12%] px-3 py-3 text-right">Ordered</th>
                  <th scope="col" className="w-[15%] px-3 py-3 text-right">Received</th>
                  <th scope="col" className="w-[12%] px-3 py-3 text-right">Pending</th>
                  <th scope="col" className="w-[15%] px-3 py-3">Status</th>
                  {showAmount && <th scope="col" className="hidden w-[13%] px-4 py-3 text-right lg:table-cell">Amount</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((po) => (
                  <tr
                    key={po.id}
                    tabIndex={0}
                    onClick={() => open(po)}
                    onKeyDown={(e) => e.key === 'Enter' && open(po)}
                    className="cursor-pointer border-t border-border align-top transition-colors hover:bg-slate-50 focus-visible:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <p className="font-bold tabular-nums text-slate-900">PO {po.poNo}</p>
                      <p className="text-xs text-slate-500">{formatDate(po.poDate)}</p>
                    </td>
                    <td className="min-w-0 px-4 py-3">
                      <p className="truncate font-semibold text-slate-800">{po.party.name}</p>
                      <p className="flex min-w-0 text-xs text-slate-500">
                        <Qualities names={po.qualities} />
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Kg g={po.orderedG} className="font-semibold text-slate-800" />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Kg g={po.receivedG} className="font-semibold text-slate-800" />
                      <ProgressBar value={po.orderedG ? po.receivedG / po.orderedG : 0} className="ml-auto mt-1.5 max-w-24" />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Kg g={po.pendingG} className={po.pendingG ? 'font-semibold text-amber-700' : 'text-slate-400'} />
                    </td>
                    <td className="px-3 py-3">
                      <YarnPoStatusBadge status={po.status} />
                      {showAmount && <p className="mt-1 text-xs font-semibold text-slate-600 lg:hidden">{money(po.amountPaise)}</p>}
                    </td>
                    {showAmount && <td className="hidden px-4 py-3 text-right font-semibold tabular-nums text-slate-700 lg:table-cell">{money(po.amountPaise)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone cards */}
          <ul className="space-y-2.5 md:hidden">
            {items.map((po) => (
              <li key={po.id}>
                <PoCard po={po} onOpen={() => open(po)} showAmount={showAmount} />
              </li>
            ))}
          </ul>
          <LoadMore hasNextPage={!!hasNextPage} isFetchingNextPage={isFetchingNextPage} fetchNextPage={() => void fetchNextPage()} shown={items.length} total={total} noun="POs" />
        </>
      )}

      {canManage && <Fab onClick={() => navigate('/yarn-po/new')} label="New PO" />}
      <YarnPoFiltersDialog open={filtersOpen} onOpenChange={setFiltersOpen} value={filters} onApply={(d) => setFilters(d)} />
    </div>
  );
}
