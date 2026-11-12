import { Check, LayoutDashboard, LayoutGrid, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DASHBOARD_KEYS,
  DASHBOARD_LABEL,
  DASHBOARD_PERMISSION,
  DASHBOARDS,
  DEFAULT_PERIOD,
  homeDashboard,
  isDashboardKey,
  isPeriodKey,
  PERIOD_KEYS,
  PERIOD_SHORT,
  type CardDef,
  type CardWidth,
  type DashboardKey,
  type DashboardLayout,
  type Drawer,
  type PeriodKey,
  packRows,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/hooks/useNow';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDashboardCards, useDashboardLayout, useResetLayout, useSaveLayout } from './api';
import { canMove, dropCard, moveCard, patchCard, renameSection, sameLayout } from './arrange';
import { DetailSheet } from './detail-sheet';
import { InsightCard, StripCard, type CardActions } from './insight-card';
import { useDashboardMode, type DashboardMode } from './layout-mode';

/**
 * Sprint 25 (C11 / C12) — the three insight dashboards (`/dashboard/owner | partner | supervisor`).
 * Page: top bar (name, greeting + date, period selector, refresh "updated 2 min ago", Arrange, the dashboard switch) →
 * Today strip → Needs attention (owner) → sections of cards. Desktop: 12-column grid, all sections in one scroll, right
 * drawer, drag & drop Arrange. Tablet: 2 / 3-column grid, sticky section tabs (Overview first), bottom sheet, big ↑ ↓ +
 * handles, sticky Done bar, pull to refresh. Phone: one column, the strip 2 × 3, section tabs, no Arrange.
 */

/** Columns asked for per layout mode (desktop and tablet are their own designs, not one grid reflowing). */
const SPAN: Record<DashboardMode, Record<CardWidth, number>> = {
  desktop: { small: 3, normal: 4, wide: 6, full: 12 },
  tablet3: { small: 1, normal: 1, wide: 2, full: 3 },
  tablet2: { small: 1, normal: 1, wide: 2, full: 2 },
  phone: { small: 1, normal: 1, wide: 1, full: 1 },
};
const COLS: Record<DashboardMode, number> = { desktop: 12, tablet3: 3, tablet2: 2, phone: 1 };
const GRID: Record<DashboardMode, string> = {
  desktop: 'grid grid-cols-12 gap-5',
  tablet3: 'grid grid-cols-3 gap-4',
  tablet2: 'grid grid-cols-2 gap-4',
  phone: 'grid grid-cols-1 gap-3',
};
/**
 * Sprint 26 follow-up — desktop / tablet sections are a MEASURED masonry: every card keeps its own (natural) height and
 * spans that many 4 px grid rows, and `dense` lets the next cards move up into the space. Equal-height rows stretched a
 * one-figure card to the height of a 10-row table beside it (up to 560 px of empty card). Columns still come from
 * `packRows`, so every row of cards reaches the right edge.
 */
const ROW_UNIT = 4;
const ROW_GAP: Record<DashboardMode, number> = { desktop: 20, tablet3: 16, tablet2: 16, phone: 12 };
const MASONRY: Record<DashboardMode, string> = {
  desktop: 'grid grid-cols-12 gap-x-5',
  tablet3: 'grid grid-cols-3 gap-x-4',
  tablet2: 'grid grid-cols-2 gap-x-4',
  phone: 'grid grid-cols-1 gap-3',
};
const STRIP_GRID: Record<DashboardMode, string> = {
  desktop: 'grid grid-cols-5 gap-4',
  tablet3: 'grid grid-cols-5 gap-3',
  tablet2: 'grid grid-cols-3 gap-3',
  phone: 'grid grid-cols-2 gap-3',
};

function greeting(name: string | undefined, now: number): string {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(now));
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const day = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now);
  return `${part}${name ? `, ${name}` : ''} · ${day}`;
}

function updatedText(at: number, now: number): string {
  if (!at) return 'Loading…';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'Updated just now';
  const m = Math.round(s / 60);
  return m < 60 ? `Updated ${m} min ago` : `Updated ${Math.floor(m / 60)} h ago`;
}

/** `/dashboard` → the role's own dashboard (Jenish: owner, Gaurang: partner, supervisor: supervisor). */
export function DashboardHome() {
  const { role, can } = useRole();
  const home = homeDashboard(role);
  const key = home && can(DASHBOARD_PERMISSION[home]) ? home : DASHBOARD_KEYS.find((k) => can(DASHBOARD_PERMISSION[k]));
  return key ? <Navigate to={`/dashboard/${key}`} replace /> : <Navigate to="/" replace />;
}

export default function DashboardPage() {
  const param = useParams().key ?? '';
  const { can } = useRole();
  if (!isDashboardKey(param) || !can(DASHBOARD_PERMISSION[param])) return <Navigate to="/dashboard" replace />;
  return <Dashboard key={param} dashboard={param} />;
}

function Dashboard({ dashboard }: { dashboard: DashboardKey }) {
  const def = DASHBOARDS[dashboard];
  usePageTitle('Dashboard');
  const navigate = useNavigate();
  const { can, user } = useRole();
  const mode = useDashboardMode();
  const touch = mode !== 'desktop';
  const now = useNow(30_000);
  const [params, setParams] = useSearchParams();
  const period: PeriodKey = isPeriodKey(params.get('period')) ? (params.get('period') as PeriodKey) : DEFAULT_PERIOD;
  const setParam = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v === null) n.delete(k);
        else n.set(k, v);
        return n;
      },
      { replace: true },
    );

  const layoutQ = useDashboardLayout(dashboard);
  const save = useSaveLayout(dashboard);
  const reset = useResetLayout(dashboard);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const arranging = draft !== null;
  const canArrange = can('canArrangeDashboards') && mode !== 'phone';
  const flags = layoutQ.data?.flags ?? [];
  const defs = useMemo(() => new Map(def.cards.map((c) => [c.id, c])), [def]);
  const allowed = useCallback((c: CardDef | undefined) => !!c && (!c.flag || flags.includes(c.flag)), [flags]);
  const layout = draft ?? layoutQ.data?.layout ?? null;
  const pinned = def.cards.filter((c) => c.pinned);

  // One batch for the screen: the strip, the pinned panel and every visible card.
  const ids = useMemo(() => {
    if (!layout) return [];
    const cards = layout.sections.flatMap((s) => s.cards.filter((c) => !c.hidden && allowed(defs.get(c.id))).map((c) => c.id));
    return [...def.strip.map((s) => s.id), ...pinned.map((p) => p.id), ...cards];
  }, [layout, def, pinned, defs, allowed]);
  const cardsQ = useDashboardCards(dashboard, ids, period, !arranging || !!layoutQ.data);
  const cards = cardsQ.data?.cards ?? {};

  /* ---------- section tabs (tablet / phone) ---------- */
  const tabs = useMemo(() => (layout ? [{ key: '__overview', title: 'Overview' }, ...layout.sections.slice(1).filter((s) => s.cards.some((c) => arranging || (!c.hidden && allowed(defs.get(c.id))))).map((s) => ({ key: s.key, title: s.title }))] : []), [layout, arranging, allowed, defs]);
  const tab = touch ? (tabs.find((t) => t.key === params.get('section'))?.key ?? '__overview') : null;

  /* ---------- actions ---------- */
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const periodRef = useRef<HTMLDivElement>(null);
  const actions: CardActions = useMemo(
    () => ({
      openDrawer: setDrawer,
      go: (href: string) => {
        setDrawer(null);
        if (href.startsWith('#')) document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else navigate(href);
      },
      focusPeriod: () => periodRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(),
    }),
    [navigate],
  );
  const refresh = () => void cardsQ.refetch();

  /* ---------- pull to refresh (touch) ---------- */
  const [pull, setPull] = useState(0);
  const pullStart = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (!touch || arranging) return;
    pullStart.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStart.current === null) return;
    setPull(Math.max(0, Math.min(90, e.touches[0].clientY - pullStart.current)));
  };
  const onTouchEnd = () => {
    if (pull > 64) refresh();
    pullStart.current = null;
    setPull(0);
  };

  /* ---------- arrange ---------- */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const cardEls = useRef(new Map<string, HTMLElement>());
  // masonry: the natural height of every card (ResizeObserver — it re-measures when a card's content changes)
  const [heights, setHeights] = useState<Record<string, number>>({});
  const sizer = useRef<ResizeObserver | null>(null);
  const idOfEl = useRef(new WeakMap<Element, string>());
  useEffect(() => () => sizer.current?.disconnect(), []);
  const measureCard = (id: string, el: HTMLElement | null) => {
    if (!sizer.current)
      sizer.current = new ResizeObserver((entries) =>
        setHeights((h) => {
          let next = h;
          for (const e of entries) {
            const key = idOfEl.current.get(e.target);
            const v = Math.ceil((e.target as HTMLElement).offsetHeight);
            if (key && h[key] !== v) {
              if (next === h) next = { ...h };
              next[key] = v;
            }
          }
          return next;
        }),
      );
    const old = cardEls.current.get(id);
    if (old && old !== el) sizer.current.unobserve(old);
    if (el) {
      idOfEl.current.set(el, id);
      sizer.current.observe(el);
    }
  };
  const startArrange = () => layoutQ.data && setDraft(layoutQ.data.layout);
  const cancelArrange = () => setDraft(null);
  const saveArrange = () => {
    if (!draft) return;
    if (draft.sections.some((s) => !s.title.trim())) {
      toast.error('Every section needs a name');
      return;
    }
    if (sameLayout(draft, layoutQ.data?.layout)) {
      setDraft(null);
      return;
    }
    save.mutate(draft, {
      onSuccess: () => {
        toast.success(`${def.title} saved — everyone now sees this layout`);
        setDraft(null);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };
  const doReset = () =>
    reset.mutate(undefined, {
      onSuccess: () => {
        toast.success('Layout reset to the default');
        setConfirmReset(false);
        setDraft(null);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  // Esc leaves Arrange without saving.
  useEffect(() => {
    if (!arranging) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !drawer && setDraft(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arranging, drawer]);

  const orderedIds = layout ? layout.sections.flatMap((s) => s.cards.map((c) => c.id)) : [];
  const onCardKey = (id: string) => (e: KeyboardEvent) => {
    if (!draft) return;
    const k = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    e.preventDefault();
    const dir = k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1;
    if (e.shiftKey || e.altKey) {
      // Shift + arrow moves the card; focus follows it.
      if (canMove(draft, id, dir)) {
        setDraft(moveCard(draft, id, dir));
        requestAnimationFrame(() => cardEls.current.get(id)?.focus());
      }
      return;
    }
    const idx = orderedIds.indexOf(id);
    cardEls.current.get(orderedIds[idx + dir])?.focus();
  };

  /* ---------- render ---------- */
  const name = user?.name?.split(' ')[0];
  const canSwitchDash = DASHBOARD_KEYS.filter((k) => can(DASHBOARD_PERMISSION[k]));
  const anyLoading = cardsQ.isPending || cardsQ.isFetching;

  const renderSection = (sectionKey: string) => {
    const s = layout?.sections.find((x) => x.key === sectionKey);
    if (!s) return null;
    const list = s.cards.filter((c) => allowed(defs.get(c.id)) && (arranging || !c.hidden));
    if (!list.length && !arranging) return null;
    const sdef = def.sections.find((x) => x.key === s.key);
    const masonry = !arranging && mode !== 'phone';
    return (
      <section
        key={s.key}
        aria-label={s.title}
        className="space-y-3"
        onDragOver={(e) => {
          if (dragId) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!draft || !dragId) return;
          e.preventDefault();
          setDraft(dropCard(draft, dragId, { beforeId: null, sectionKey: s.key }));
          setDragId(null);
          setOverId(null);
        }}
      >
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          {arranging ? (
            <label className="flex min-w-0 items-center gap-2">
              <span className="sr-only">Section name</span>
              <Input
                value={s.title}
                maxLength={60}
                onChange={(e) => setDraft(renameSection(draft!, s.key, e.target.value))}
                className="h-10 w-64 max-w-full font-semibold"
                invalid={!s.title.trim()}
                aria-label={`Rename ${sdef?.title ?? s.title}`}
              />
            </label>
          ) : (
            <h2 className="text-[15px] font-semibold text-slate-900">{s.title}</h2>
          )}
          <p className="text-xs text-slate-500">{sdef?.line}</p>
        </div>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-slate-400">Drop a card here, or move one with ↑ ↓</p>
        ) : (
          <div className={masonry ? MASONRY[mode] : GRID[mode]} style={masonry ? { gridAutoRows: `${ROW_UNIT}px`, gridAutoFlow: 'row dense' } : undefined}>
            {/* rows without holes: Arrange order, a later card may move up to fill a row, short rows are stretched */}
            {(arranging ? list.map((_, index) => ({ index, span: SPAN[mode][list[index].width] })) : packRows(list.map((c) => SPAN[mode][c.width]), COLS[mode]).flat()).map(({ index, span }) => {
              const c = list[index];
              const cdef = defs.get(c.id)!;
              const cols = arranging ? Math.min(span, COLS[mode]) : span;
              const h = heights[c.id];
              return (
                <InsightCard
                  key={c.id}
                  ref={(el) => {
                    if (masonry || !el) measureCard(c.id, el);
                    if (el) cardEls.current.set(c.id, el);
                    else cardEls.current.delete(c.id);
                  }}
                  dashboard={dashboard}
                  def={cdef}
                  payload={cards[c.id]}
                  loading={cardsQ.isPending}
                  mode={mode}
                  actions={actions}
                  onRetry={refresh}
                  style={{
                    gridColumn: `span ${cols} / span ${cols}`,
                    // height auto: the card's own h-full would follow the grid area and grow with every measurement
                    ...(masonry ? { alignSelf: 'start', height: 'auto', gridRow: h ? `span ${Math.ceil((h + ROW_GAP[mode]) / ROW_UNIT)}` : 'span 60' } : {}),
                  }}
                  arrange={
                    draft
                      ? {
                          hidden: c.hidden,
                          wide: c.width === 'wide' || c.width === 'full',
                          canUp: canMove(draft, c.id, -1),
                          canDown: canMove(draft, c.id, 1),
                          onUp: () => setDraft(moveCard(draft, c.id, -1)),
                          onDown: () => setDraft(moveCard(draft, c.id, 1)),
                          onToggleHidden: () => setDraft(patchCard(draft, c.id, { hidden: !c.hidden })),
                          onToggleWide: () => setDraft(patchCard(draft, c.id, { width: c.width === 'wide' || c.width === 'full' ? 'normal' : 'wide' })),
                          draggable: mode !== 'phone',
                          dragging: dragId === c.id,
                          dropTarget: overId === c.id && dragId !== c.id,
                          onDragStart: (e: DragEvent) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', c.id);
                            setDragId(c.id);
                          },
                          onDragEnd: () => {
                            setDragId(null);
                            setOverId(null);
                          },
                          onDragOver: (e: DragEvent) => {
                            if (!dragId) return;
                            e.preventDefault();
                            setOverId(c.id);
                          },
                          onDrop: (e: DragEvent) => {
                            if (!dragId) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setDraft(dropCard(draft, dragId, { beforeId: c.id, sectionKey: s.key }));
                            setDragId(null);
                            setOverId(null);
                          },
                          onKeyDown: onCardKey(c.id),
                        }
                      : null
                  }
                />
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const strip = (
    <section aria-label="Today" className={STRIP_GRID[mode]}>
      {def.strip.map((s) => (
        <StripCard key={s.id} label={s.label} payload={cards[s.id]} loading={cardsQ.isPending} actions={actions} mode={mode} />
      ))}
    </section>
  );
  const attention = pinned.map((p) => (
    <InsightCard key={p.id} dashboard={dashboard} def={p} payload={cards[p.id]} loading={cardsQ.isPending} mode={mode} actions={actions} onRetry={refresh} panel />
  ));

  return (
    <div
      data-dashboard-mode={mode}
      className={cn('page-container pb-28 pt-3 lg:pb-8', mode === 'desktop' && 'mx-auto !max-w-[1440px] lg:!px-4 xl:!px-6')}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {pull > 0 && (
        <div className="flex items-center justify-center text-xs font-medium text-slate-500 transition-[height]" style={{ height: pull }} aria-hidden>
          <RefreshCw className={cn('mr-1.5 size-4', pull > 64 && 'text-primary')} style={{ transform: `rotate(${pull * 3}deg)` }} />
          {pull > 64 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}

      {/* ---------- top bar ---------- */}
      <header className="mb-5 space-y-3 lg:mb-6">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
              <LayoutDashboard className="size-5 shrink-0 text-primary" aria-hidden />
              {def.title}
            </h1>
            <p className="mt-0.5 truncate text-sm text-slate-500">{greeting(name, now)}</p>
          </div>
          <div className="flex items-center gap-2">
            {!arranging && (
              <button
                type="button"
                onClick={refresh}
                className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-800', touch ? 'min-h-11 min-w-11 justify-center' : 'min-h-9')}
                aria-label="Refresh the dashboard"
              >
                {cardsQ.isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                <span className="hidden sm:inline">{updatedText(cardsQ.dataUpdatedAt, now)}</span>
              </button>
            )}
            {canArrange && !arranging && (
              <Button variant="secondary" size={touch ? 'md' : 'sm'} onClick={startArrange} disabled={!layoutQ.data}>
                <LayoutGrid /> Arrange
              </Button>
            )}
            {arranging && !touch && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                  <RotateCcw /> Reset to default
                </Button>
                <Button variant="secondary" size="sm" onClick={cancelArrange}>
                  <X /> Cancel
                </Button>
                <Button size="sm" onClick={saveArrange} loading={save.isPending}>
                  <Check /> Save layout
                </Button>
              </>
            )}
          </div>
        </div>
        {!arranging && (
          <div className={cn('flex flex-col gap-2', mode === 'desktop' && 'flex-row flex-wrap items-center justify-between')}>
            {canSwitchDash.length > 1 && (
              <Segmented
                fit
                size={touch ? 'lg' : 'md'}
                value={dashboard}
                onChange={(k) => navigate(`/dashboard/${k}${period !== DEFAULT_PERIOD ? `?period=${period}` : ''}`)}
                options={canSwitchDash.map((k) => ({ value: k, label: DASHBOARD_LABEL[k] }))}
                aria-label="Dashboard"
                className={cn(mode === 'desktop' ? 'w-auto' : 'w-full md:max-w-xl')}
              />
            )}
            <div ref={periodRef} className={cn(mode === 'desktop' ? 'ml-auto' : 'scrollbar-none -mx-1 overflow-x-auto px-1')}>
              <Segmented
                fit
                size={touch ? 'lg' : 'md'}
                value={period}
                onChange={(p) => setParam('period', p === DEFAULT_PERIOD ? null : p)}
                options={PERIOD_KEYS.map((k) => ({ value: k, label: PERIOD_SHORT[k] }))}
                aria-label="Period"
                className={cn(mode === 'desktop' ? 'w-auto' : 'w-full min-w-max')}
              />
            </div>
          </div>
        )}
        {arranging && (
          <p className="rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-slate-700">
            <b className="text-primary">Arrange {def.title.toLowerCase()}</b> — {touch ? 'use ↑ ↓ to move cards (also into the next section),' : 'drag cards (or focus one and press Shift + ↑ ↓),'} hide cards, make them wide and rename sections. The saved
            layout applies to everyone who opens this dashboard.
          </p>
        )}
      </header>

      {layoutQ.isError ? (
        <ErrorState error={layoutQ.error} onRetry={() => void layoutQ.refetch()} />
      ) : !layout ? (
        <div className="space-y-4" aria-busy>
          <div className={STRIP_GRID[mode]}>
            {def.strip.map((s) => (
              <Skeleton key={s.id} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : touch ? (
        <>
          {/* Section tabs (sticky, swipeable) — the strip + Needs attention live on Overview. */}
          <nav aria-label="Sections" className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 backdrop-blur md:-mx-6 md:px-6">
            <div role="tablist" className="scrollbar-none -mb-px flex snap-x gap-1 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.key}
                  onClick={() => setParam('section', t.key === '__overview' ? null : t.key)}
                  className={cn('min-h-12 shrink-0 snap-start whitespace-nowrap border-b-2 px-3.5 text-sm font-semibold transition-colors', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800')}
                >
                  {t.title}
                </button>
              ))}
            </div>
          </nav>
          <div className="space-y-6">
            {tab === '__overview' ? (
              <>
                {!arranging && strip}
                {!arranging && attention}
                {renderSection(layout.sections[0].key)}
              </>
            ) : (
              renderSection(tab!)
            )}
          </div>
        </>
      ) : (
        <div className="space-y-8">
          {!arranging && (
            <div className="space-y-5">
              {strip}
              {attention}
            </div>
          )}
          {layout.sections.map((s) => renderSection(s.key))}
        </div>
      )}

      {/* Tablet Arrange: sticky Done bar. */}
      {arranging && touch && (
        <div className="kb-bar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <Button variant="ghost" onClick={() => setConfirmReset(true)}>
              <RotateCcw /> Reset
            </Button>
            <Button variant="secondary" className="ml-auto" onClick={cancelArrange}>
              Cancel
            </Button>
            <Button className="min-w-32" onClick={saveArrange} loading={save.isPending}>
              <Check /> Done
            </Button>
          </div>
        </div>
      )}

      <DetailSheet drawer={drawer} mode={mode} onClose={() => setDrawer(null)} go={actions.go} />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset this dashboard to the default?"
        description={`Every card of the ${def.title.toLowerCase()} comes back in the original order and width, hidden cards are shown again and section names return to the default — for everyone.`}
        confirmLabel="Reset layout"
        destructive
        loading={reset.isPending}
        onConfirm={doReset}
      />
      {anyLoading && cardsQ.data && <span className="sr-only">Refreshing</span>}
    </div>
  );
}
