import { PackageOpen, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { inventoryBarShares, type DamagedItemCard, type InventoryItemCard } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore, SearchBar } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { useDamagedItems, useInventoryItems, useInventorySummary } from './api';
import { CardThumb, ExpandingSearch, KpiSkeleton, KpiTile, pcsText } from './parts';

type Section = 'all' | 'damaged';

const KPI_DOT = { godown: '#10B981', ready: '#14B8A6', making: '#38BDF8', damaged: '#EF4444', refinish: '#F59E0B' } as const;

/* ------------------------------------------------------------------ */
/* KPI row                                                              */
/* ------------------------------------------------------------------ */

type KpiKey = 'godown' | 'ready' | 'making' | 'damaged' | 'refinish';

function Kpis({ selected, onToggle }: { selected: KpiKey[]; onToggle: (k: KpiKey) => void }) {
  const tile = (k: KpiKey) => ({ onClick: () => onToggle(k), active: selected.includes(k) });
  const query = useInventorySummary();
  const grid = 'grid grid-cols-2 gap-2.5 md:grid-cols-5';
  if (query.isPending) {
    return (
      <div className={grid}>
        <KpiSkeleton count={5} />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  const { totals, totalInGodown, excludedOrders } = query.data;
  return (
    <div className="space-y-2">
      <div className={grid}>
        <KpiTile label="Total in godown" value={pcsText(totalInGodown)} dot={KPI_DOT.godown} {...tile('godown')} />
        <KpiTile label="Ready for dispatch" value={pcsText(totals.readyDispatch)} dot={KPI_DOT.ready} {...tile('ready')} />
        <KpiTile label="In making" value={pcsText(totals.inMaking)} dot={KPI_DOT.making} {...tile('making')} />
        <KpiTile label="Damaged pcs" value={pcsText(totals.damaged)} dot={KPI_DOT.damaged} tone={totals.damaged > 0 ? 'danger' : undefined} {...tile('damaged')} />
        <KpiTile label="In refinish" value={pcsText(totals.inRefinish)} dot={KPI_DOT.refinish} {...tile('refinish')} className="col-span-2 md:col-span-1" />
      </div>
      {excludedOrders > 0 && (
        <p className="px-1 text-xs text-slate-400">
          {excludedOrders} {excludedOrders === 1 ? 'order' : 'orders'} in meters / kg are not included
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* underline tabs                                                       */
/* ------------------------------------------------------------------ */

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'all', label: 'All designs' },
  { key: 'damaged', label: 'Damaged' },
];

function SectionTabs({ value, onChange }: { value: Section; onChange: (s: Section) => void }) {
  return (
    <div role="tablist" aria-label="Inventory section" className="flex shrink-0 gap-6">
      {SECTIONS.map((s) => {
        const active = s.key === value;
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(s.key)}
            className={cn(
              'relative -mb-px h-11 text-[15px] outline-none transition-colors focus-visible:text-primary',
              active ? 'font-semibold text-slate-900' : 'font-medium text-slate-400 hover:text-slate-600',
            )}
          >
            {s.label}
            <span className={cn('absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary transition-opacity', active ? 'opacity-100' : 'opacity-0')} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* cards                                                                */
/* ------------------------------------------------------------------ */

const CARD =
  'flex h-full flex-col gap-3 rounded-xl border border-border bg-white p-3.5 outline-none transition duration-150 hover:border-primary/30 hover:shadow-soft focus-visible:ring-2 focus-visible:ring-primary/40';

/** Card that opens the details on click / Enter; the image inside opens the zoom instead. */
function CardLink({ to, from, label, children }: { to: string; from: string; label: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const open = () => navigate(to, { state: { from } });
  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={label}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          open();
        }
      }}
      className={cn(CARD, 'cursor-pointer')}
    >
      {children}
    </article>
  );
}

function Figure({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-[17px] font-bold leading-none tabular-nums text-slate-900', className)}>{pcsText(value)}</p>
    </div>
  );
}

function ItemCard({ item, from }: { item: InventoryItemCard; from: string }) {
  const { pcs } = item;
  const bar = inventoryBarShares(pcs);
  return (
    <li>
      <CardLink to={`/inventory/items/${item.key}`} from={from} label={`Open ${item.code ?? 'items without design'}`}>
        <div className="flex items-center gap-3">
          <CardThumb item={item} />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold leading-tight text-slate-900">{item.code ?? 'Without design'}</p>
            <p className="truncate text-[13px] text-slate-500">{item.variationOf ? `Variation of ${item.variationOf}` : (item.name ?? ' ')}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Figure label="Ordered" value={pcs.ordered} />
          <Figure label="In making" value={pcs.inMaking} />
          <Figure label="Ready" value={pcs.readyDispatch} />
        </div>
        <div className="mt-auto flex h-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${pcsText(pcs.readyDispatch)} ready and ${pcsText(pcs.inMaking)} in making of ${pcsText(pcs.ordered)} ordered`}>
          <span className="h-full bg-emerald-500" style={{ width: `${bar.ready}%` }} />
          <span className="h-full bg-sky-300" style={{ width: `${bar.making}%` }} />
        </div>
      </CardLink>
    </li>
  );
}

function DamagedCard({ item, from }: { item: DamagedItemCard; from: string }) {
  return (
    <li>
      <CardLink to={`/inventory/damaged/${item.key}`} from={from} label={`Open damaged stock of ${item.code ?? 'items without design'}`}>
        <div className="flex items-center gap-3">
          <CardThumb item={item} />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold leading-tight text-slate-900">{item.code ?? 'Without design'}</p>
            <p className="truncate text-[13px] text-slate-500">{item.variationOf ? `Variation of ${item.variationOf}` : (item.name ?? ' ')}</p>
          </div>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">Damaged pcs</p>
            <p className="mt-0.5 text-[26px] font-bold leading-none tabular-nums text-red-600">{pcsText(item.damaged)}</p>
          </div>
          {item.inRefinish > 0 && (
            <p className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold tabular-nums text-amber-700">{pcsText(item.inRefinish)} in refinish</p>
          )}
        </div>
        <p className="mt-auto text-xs text-slate-400">Last cleared: {item.lastClearedAt ?? 'Never'}</p>
      </CardLink>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* lists                                                                */
/* ------------------------------------------------------------------ */

const GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]';

function GridSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-[140px] rounded-xl" />
      ))}
    </div>
  );
}

function EmptyBlock({ searching, title, description }: { searching: boolean; title: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-white shadow-soft">
      <EmptyState icon={searching ? SearchX : PackageOpen} title={searching ? 'Nothing matches your search' : title} description={searching ? undefined : description} />
    </div>
  );
}

function AllDesigns({ search, kpi, from }: { search: string; kpi: string; from: string }) {
  const query = useInventoryItems(search, kpi);
  if (query.isPending) return <GridSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.items.length === 0) return <EmptyBlock searching={!!search || !!kpi} title="No designs ordered yet" description="Designs appear here once an order is placed on them." />;
  return (
    <>
      <ul className={cn(GRID, query.isPlaceholderData && 'opacity-60')}>
        {query.items.map((i) => (
          <ItemCard key={i.key} item={i} from={from} />
        ))}
      </ul>
      <LoadMore hasNextPage={!!query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} fetchNextPage={() => void query.fetchNextPage()} shown={query.items.length} total={query.total} noun="designs" />
    </>
  );
}

function DamagedItems({ search, from }: { search: string; from: string }) {
  const query = useDamagedItems(search);
  if (query.isPending) return <GridSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.items.length === 0) return <EmptyBlock searching={!!search} title="No damaged stock" description="Designs with damaged or refinish pcs show up here." />;
  return (
    <>
      <ul className={cn(GRID, query.isPlaceholderData && 'opacity-60')}>
        {query.items.map((i) => (
          <DamagedCard key={i.key} item={i} from={from} />
        ))}
      </ul>
      <LoadMore hasNextPage={!!query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} fetchNextPage={() => void query.fetchNextPage()} shown={query.items.length} total={query.total} noun="designs" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                 */
/* ------------------------------------------------------------------ */

/** Inventory (Jemish / Gaurang): design-wise pcs. Section and search live in the URL (`?section=damaged&q=D101`). */
export default function InventoryPage() {
  usePageTitle('Inventory');
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const section: Section = params.get('section') === 'damaged' ? 'damaged' : 'all';
  const KPI_KEYS: KpiKey[] = ['godown', 'ready', 'making', 'damaged', 'refinish'];
  const kpis = (params.get('kpi') ?? '').split(',').filter((k): k is KpiKey => (KPI_KEYS as string[]).includes(k));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounce(search, 300).trim();

  // Keep the URL in step with the (debounced) search so Back from a details screen returns to the same list.
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

  const setSection = (s: Section) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (s === 'damaged') next.set('section', 'damaged');
        else next.delete('section');
        return next;
      },
      { replace: true },
    );
  // KPI tiles filter the All designs grid (none selected = everything); several selected = designs with any of them.
  const toggleKpi = (k: KpiKey) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const list = kpis.includes(k) ? kpis.filter((x) => x !== k) : [...kpis, k];
        if (list.length) next.set('kpi', list.join(','));
        else next.delete('kpi');
        next.delete('section');
        return next;
      },
      { replace: true },
    );
  const from = `${location.pathname}${location.search}`;

  return (
    <div className="page-container space-y-5 pb-28 pt-4 md:py-5">
      <Kpis selected={kpis} onToggle={toggleKpi} />

      <div className="flex items-center justify-between gap-3 border-b border-border">
        <SectionTabs value={section} onChange={setSection} />
        <div className="-mb-px flex min-w-0 flex-1 justify-end pb-0.5">
          <div className="hidden w-72 md:block">
            <SearchBar value={search} onChange={setSearch} placeholder="Search design or code…" className="[&_input]:h-10" />
          </div>
          <div className="flex min-w-0 flex-1 justify-end md:hidden">
            <ExpandingSearch value={search} onChange={setSearch} placeholder="Search design or code…" />
          </div>
        </div>
      </div>

      {section === 'all' ? <AllDesigns search={debounced} kpi={kpis.join(',')} from={from} /> : <DamagedItems search={debounced} from={from} />}
    </div>
  );
}
