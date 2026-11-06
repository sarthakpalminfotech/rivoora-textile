import { Boxes, ClipboardList, History, MinusCircle, PackagePlus, SearchX, Trash2, Truck } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { dualText, FG_TYPE_LABEL, FG_TYPES, type FgType, type QualityCard } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';
import { ExpandingSearch } from '../inventory/parts';
import { useEffect, useState } from 'react';
import { useQualities } from './api';

const AllDesignsPage = lazy(() => import('../inventory/inventory-page'));

/** A figure with a label, in both units, never added together. */
export function DualFigure({ label, pcs, meters, dot, danger }: { label: string; pcs: number; meters: number; dot: string; danger?: boolean }) {
  const none = pcs === 0 && meters === 0;
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
        {label}
      </p>
      <p className={cn('mt-0.5 text-[15px] font-bold tabular-nums leading-snug', danger && !none ? 'text-red-600' : none ? 'text-slate-300' : 'text-slate-900')}>{none ? '—' : dualText(pcs, meters)}</p>
    </div>
  );
}

function QualityTile({ q, onOpen }: { q: QualityCard; onOpen: () => void }) {
  const { pcs, meters } = q.dual;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[44px] w-full flex-col gap-3 rounded-xl border border-border bg-white p-4 text-left shadow-soft outline-none transition hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40 md:p-5"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-lg font-bold text-slate-900">{q.name}</span>
          <span className="text-sm text-slate-500">{q.designs} {q.designs === 1 ? 'design' : 'designs'}</span>
        </span>
        {(pcs.free > 0 || meters.free > 0) && <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700">Free {dualText(pcs.free, meters.free)}</span>}
      </span>
      <span className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border pt-3">
        <DualFigure label="Ordered" pcs={pcs.ordered} meters={meters.ordered} dot="#94A3B8" />
        <DualFigure label="In making" pcs={pcs.inMaking} meters={meters.inMaking} dot="#38BDF8" />
        <DualFigure label="Ready" pcs={pcs.ready} meters={meters.ready} dot="#10B981" />
        <DualFigure label="Damaged" pcs={pcs.damaged} meters={meters.damaged} dot="#EF4444" danger />
      </span>
      <QualityBar pcs={pcs} meters={meters} />
    </button>
  );
}

/** A small bar: ready (green) and in making (blue) as a share of ordered, for whichever unit has an order. */
function QualityBar({ pcs, meters }: { pcs: QualityCard['dual']['pcs']; meters: QualityCard['dual']['meters'] }) {
  const u = pcs.ordered >= meters.ordered ? pcs : meters;
  if (u.ordered <= 0) return null;
  const ready = Math.min(100, (u.ready / u.ordered) * 100);
  const making = Math.min(100 - ready, (u.inMaking / u.ordered) * 100);
  return (
    <span className="flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
      <span className="h-full bg-emerald-500" style={{ width: `${ready}%` }} />
      <span className="h-full bg-sky-300" style={{ width: `${making}%` }} />
    </span>
  );
}

/**
 * Inventory home (Sprint 22, CR-15): one card per QUALITY with its stock in pcs and metres. Tap a quality → its designs →
 * design details. Old links keep working: `?section=damaged` and `?view=designs` show the earlier all-designs screen.
 */
export default function InventoryHomePage() {
  const [params, setParams] = useSearchParams();
  if (params.get('section') === 'damaged' || params.get('view') === 'designs') {
    return (
      <Suspense fallback={<Skeleton className="m-4 h-64 rounded-xl" />}>
        <AllDesignsPage />
      </Suspense>
    );
  }
  return <QualitiesHome params={params} setParams={setParams} />;
}

function QualitiesHome({ params, setParams }: { params: URLSearchParams; setParams: ReturnType<typeof useSearchParams>[1] }) {
  usePageTitle('Inventory');
  const { can } = useRole();
  const navigate = useNavigate();
  const [text, setText] = useState(params.get('q') ?? '');
  const search = useDebounce(text, 300).trim();
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
  const flag = params.get('flag') === 'free' || params.get('flag') === 'damaged' ? (params.get('flag') as 'free' | 'damaged') : undefined;
  const fg = params.get('fg') === 'saree' || params.get('fg') === 'suit' ? (params.get('fg') as FgType) : undefined;
  const set = (key: string, value: string | undefined) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const q = useQualities({ search, flag, fgType: fg });

  const chip = (on: boolean) => cn('min-h-10 rounded-full border px-3.5 text-sm font-medium transition-colors', on ? 'border-primary bg-primary-soft text-primary' : 'border-input bg-white text-slate-700 hover:bg-muted');

  return (
    <div className="page-container space-y-4 py-3 md:py-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold text-slate-900">Inventory</h1>
        {can('canAdjustFinishedStock') && (
          <>
            <Button asChild size="sm">
              <Link to="/inventory/stock/add">
                <PackagePlus /> Add stock
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link to="/inventory/stock/remove">
                <MinusCircle /> Remove stock
              </Link>
            </Button>
          </>
        )}
        <Button asChild variant="secondary" size="sm">
          <Link to="/inventory/stock-adjustments">
            <ClipboardList /> Stock adjustments
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link to="/inventory?section=damaged">
            <Trash2 /> Damaged
          </Link>
        </Button>
        {can('canDispatch') && (
          <Button asChild variant="secondary" size="sm">
            <Link to="/dispatched">
              <History /> History
            </Link>
          </Button>
        )}
        <Button asChild variant="ghost" size="sm">
          <Link to="/inventory?view=designs">
            <Boxes /> All designs
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ExpandingSearch value={text} onChange={setText} placeholder="Search quality or design code…" className="min-w-0 flex-1 sm:max-w-sm" />
        <button type="button" className={chip(flag === 'free')} aria-pressed={flag === 'free'} onClick={() => set('flag', flag === 'free' ? undefined : 'free')}>
          Has free stock
        </button>
        <button type="button" className={chip(flag === 'damaged')} aria-pressed={flag === 'damaged'} onClick={() => set('flag', flag === 'damaged' ? undefined : 'damaged')}>
          Has damaged
        </button>
        {FG_TYPES.map((t) => (
          <button key={t} type="button" className={chip(fg === t)} aria-pressed={fg === t} onClick={() => set('fg', fg === t ? undefined : t)}>
            {FG_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={search || flag || fg ? SearchX : Truck} title={search || flag || fg ? 'No quality matches' : 'No stock yet'} description={search || flag || fg ? 'Try clearing the filters.' : 'Qualities with orders or stock appear here.'} className="py-14" />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {q.data.map((c) => (
            <li key={c.materialId} className="min-w-0">
              <QualityTile q={c} onOpen={() => navigate(`/inventory/quality/${c.materialId}${params.get('fg') ? `?fg=${params.get('fg')}` : ''}`)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
