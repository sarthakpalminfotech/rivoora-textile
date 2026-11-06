import { PackageX, Plus, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { dualText, type PartyReturnCard } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { usePartyReturns } from './api';

function ReturnCard({ r, onOpen }: { r: PartyReturnCard; onOpen: () => void }) {
  const unit = r.unit === 'meters' ? 0 : 1;
  const left = Math.round((r.receivedQty - r.organised) * 100) / 100;
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-xl border border-border bg-white p-4 text-left shadow-soft outline-none transition hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/40">
      <span className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-slate-900">{r.label}</span>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', r.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800')}>{r.status === 'pending' ? 'Pending' : 'Completed'}</span>
      </span>
      <span className="block truncate text-[15px] font-semibold text-slate-700">{r.customerName}</span>
      <span className="mt-1 block text-sm text-slate-500">
        {formatDate(r.receivedDate)} · received {r.receivedAs === 'takas' ? 'as takas · ' : ''}
        {dualText(unit ? r.receivedQty : 0, unit ? 0 : r.receivedQty)}
      </span>
      {r.status === 'pending' && <span className="mt-2 block text-sm font-semibold tabular-nums text-slate-800">Organised {r.organised.toLocaleString('en-IN')} · left {left.toLocaleString('en-IN')}</span>}
    </button>
  );
}

/** Goods return home (Dhruvil, Jenish, Gaurang): Pending · Completed, and Mark goods received. */
export default function GoodsReturnListPage() {
  usePageTitle('Goods return');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'completed' ? 'completed' : 'pending';
  const [text, setText] = useState(params.get('q') ?? '');
  const search = useDebounce(text, 300).trim();
  useEffect(() => {
    setParams((p) => { const n = new URLSearchParams(p); if (search) n.set('q', search); else n.delete('q'); return n; }, { replace: true });
  }, [search, setParams]);
  const q = usePartyReturns(tab, search);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;

  return (
    <div className="page-container space-y-4 pb-24 pt-3 md:py-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold text-slate-900">Goods return</h1>
        <Button asChild size="lg" className="h-12">
          <Link to="/goods-return/new">
            <Plus /> Mark goods received
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'pending') n.delete('tab'); else n.set('tab', v); return n; }, { replace: true })}>
          <TabsList>
            <TabsTrigger value="pending">Pending{q.counts ? ` (${q.counts.pending})` : ''}</TabsTrigger>
            <TabsTrigger value="completed">Completed{q.counts ? ` (${q.counts.completed})` : ''}</TabsTrigger>
          </TabsList>
        </Tabs>
        <SearchBar value={text} onChange={setText} placeholder="Search party or GR number…" className="min-w-0 flex-1 sm:max-w-sm" />
      </div>
      {q.isPending ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={search ? SearchX : PackageX} title={search ? 'No goods return matches' : tab === 'pending' ? 'Nothing pending' : 'No completed returns yet'} description={tab === 'pending' && !search ? 'Mark goods received when a party sends something back.' : undefined} className="py-14" />
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => (
              <li key={r.id}>
                <ReturnCard r={r} onOpen={() => navigate(`/goods-return/${r.id}`)} />
              </li>
            ))}
          </ul>
          <LoadMore hasNextPage={!!q.hasNextPage} isFetchingNextPage={q.isFetchingNextPage} fetchNextPage={() => void q.fetchNextPage()} shown={items.length} total={total} noun="returns" />
        </>
      )}
    </div>
  );
}
