import { SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { dualText, type StockDesignCard } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { BackLink, ExpandingSearch } from '../inventory/parts';
import { useQualityDesigns } from './api';
import { DualFigure } from './inventory-home-page';

function DesignTile({ d, onOpen }: { d: StockDesignCard; onOpen: () => void }) {
  const { pcs, meters } = d.dual;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[44px] w-full flex-col gap-3 rounded-xl border border-border bg-white p-3.5 text-left shadow-soft outline-none transition hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40 md:p-4"
    >
      <span className="flex items-center gap-3">
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          <ImageThumb thumbUrl={d.thumbUrl} fullUrl={d.imageUrl} alt={d.code ? `Design ${d.code}` : 'Without design'} className="size-16" rounded="rounded-lg" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-bold text-slate-900">{d.code ?? 'Without design'}</span>
          {d.name && <span className="block truncate text-sm text-slate-500">{d.name}</span>}
          {(pcs.free > 0 || meters.free > 0) && <span className="mt-1 inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">Free {dualText(pcs.free, meters.free)}</span>}
        </span>
      </span>
      <span className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border pt-3">
        <DualFigure label="Ordered" pcs={pcs.ordered} meters={meters.ordered} dot="#94A3B8" />
        <DualFigure label="In making" pcs={pcs.inMaking} meters={meters.inMaking} dot="#38BDF8" />
        <DualFigure label="Ready" pcs={pcs.ready} meters={meters.ready} dot="#10B981" />
        <DualFigure label="Damaged" pcs={pcs.damaged} meters={meters.damaged} dot="#EF4444" danger />
      </span>
    </button>
  );
}

/** Inventory → one quality → its design cards (free stock first, or by code). Tap a design → the design details. */
export default function QualityDesignsPage() {
  const materialId = Number(useParams().materialId);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const search = useDebounce(text, 300).trim();
  const sort = params.get('sort') === 'code' ? 'code' : 'free';
  const fg = params.get('fg') ?? undefined;
  useEffect(() => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (search) next.set('q', search);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [search, setParams]);
  const q = useQualityDesigns(materialId, { search, sort, fgType: fg });
  usePageTitle(q.data?.quality ?? 'Inventory');
  const here = `/inventory/quality/${materialId}${params.toString() ? `?${params.toString()}` : ''}`;

  return (
    <div className="page-container space-y-4 pb-24 pt-2 md:py-4">
      <BackLink />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold text-slate-900">{q.data?.quality ?? <Skeleton className="inline-block h-7 w-40" />}</h1>
        <ExpandingSearch value={text} onChange={setText} placeholder="Search design code…" className="min-w-0 flex-1 sm:max-w-xs sm:flex-none" />
        <Segmented<'free' | 'code'>
          aria-label="Sort"
          size="lg"
          value={sort}
          onChange={(v) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'free') n.delete('sort'); else n.set('sort', v); return n; }, { replace: true })}
          options={[
            { value: 'free', label: 'Free stock first' },
            { value: 'code', label: 'Design code' },
          ]}
        />
      </div>
      {q.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={SearchX} title={search ? 'No design matches' : 'No designs with stock or orders'} className="py-14" />
        </div>
      ) : (
        <ul className={cn('grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5')}>
          {q.data.items.map((d) => (
            <li key={d.key} className="min-w-0">
              <DesignTile d={d} onOpen={() => navigate(`/inventory/items/${d.key}`, { state: { from: here } })} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
