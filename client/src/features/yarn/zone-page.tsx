import { ArrowLeftRight, Boxes, ChevronRight, LayoutGrid, PackageMinus, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { isYarnZone, YARN_ZONE_CONFIG, type YarnZone, type YarnZoneData } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';
import { useYarnSummary, useYarnZone } from './api';
import { ManualStockDialog } from './manual-stock';
import { MovementsSection } from './movements';
import { BackLink, Kg, ZONE_ICON } from './parts';
import { MachineViewDialog, TfoProgramsSection } from './tfo-board';
import { WarpingJobsSection } from './warping';
import { ZoneActionDialogs, zoneHasExtraWithdraw, zoneMainAction, type ZoneAction } from './zone-actions';

type ZoneTab = 'running' | 'pending' | 'in_process' | 'done';

/**
 * The tabs of each zone screen: TFO Running | Pending · Warping In process | Pending | Done · Direct none. Sprint 20c:
 * Stock (and Beams) moved to their own screen, `/yarn/:zone/stock`, opened from the Stock card.
 */
const ZONE_TABS: Record<YarnZone, { key: ZoneTab; label: string }[]> = {
  tfo: [
    { key: 'running', label: 'Running' },
    { key: 'pending', label: 'Pending' },
  ],
  warping: [
    { key: 'in_process', label: 'In process' },
    { key: 'pending', label: 'Pending' },
    { key: 'done', label: 'Done' },
  ],
  direct: [],
};

/** Sprint 20c — the zone's stock at a glance; the whole card opens the stock screen. */
function StockCard({ zone, data }: { zone: YarnZone; data: YarnZoneData | undefined }) {
  const c = YARN_ZONE_CONFIG[zone];
  const Item = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="min-w-0">
      <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-lg font-bold tabular-nums text-slate-900">{children}</p>
    </div>
  );
  return (
    <Link
      to={`/yarn/${zone}/stock`}
      className="group block rounded-2xl border border-border bg-white p-4 shadow-soft transition-colors hover:bg-slate-50/70 md:p-5"
      aria-label={`Open ${c.label} stock`}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: c.accent.soft, color: c.accent.solid }}>
          <Boxes className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold text-slate-900">Stock</h2>
          <p className="truncate text-sm text-slate-500">{c.hasBeams ? 'Yarn, boxes and beams — search and filter' : 'Raw yarn and boxes by program — search and filter'}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold" style={{ color: c.accent.text }}>
          <span className="hidden sm:inline">Open stock</span> <ChevronRight className="size-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
      <div className={cn('mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3', c.hasBeams ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        <Item label="Raw yarn">{data ? <Kg g={data.stock.rawG} /> : '—'}</Item>
        <Item label="Twisted yarn">{data ? <Kg g={data.stock.twistedG} /> : '—'}</Item>
        <Item label="Boxes">{data ? data.stock.boxes : '—'}</Item>
        {c.hasBeams && <Item label="Beams">{data ? data.stock.beams : '—'}</Item>}
      </div>
    </Link>
  );
}

function Figure({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 px-4 py-3', className)}>
      <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-xl font-bold tabular-nums">{children}</p>
    </div>
  );
}

/**
 * Sprint 17 → 20 — a zone screen (`/yarn/direct | tfo | warping`): header with the headline figures and actions, then
 * tabs (in the URL, `?tab=`) — TFO: Running | Pending | Stock (+ the full-screen Machine view); Warping: In process |
 * Pending | Stock | Beams | Done; Direct: Stock | Beams — and the zone's movements.
 */
export default function YarnZonePage() {
  const param = useParams().zone ?? '';
  const zone: YarnZone | null = isYarnZone(param) ? param : null;
  const c = zone ? YARN_ZONE_CONFIG[zone] : null;
  usePageTitle(c ? c.label : 'Yarn inventory');
  const { data, isError, error, refetch } = useYarnZone(zone ?? 'direct', !!zone);
  const summary = useYarnSummary();
  const [params, setParams] = useSearchParams();
  const [action, setAction] = useState<ZoneAction | null>(null);
  const { can } = useRole();
  const [manual, setManual] = useState(false);
  const [machineView, setMachineView] = useState(false);
  if (!zone || !c) return <Navigate to="/yarn" replace />;
  // Old links to the Stock / Beams tabs open the stock screen.
  const oldTab = params.get('tab');
  if (oldTab === 'stock' || oldTab === 'beams') return <Navigate to={`/yarn/${zone}/stock${oldTab === 'beams' && c.hasBeams ? '?view=beams' : ''}`} replace />;
  const tabs = ZONE_TABS[zone];
  const tab = (tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]?.key) as ZoneTab | undefined;
  const setTab = (t: ZoneTab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (t === tabs[0]?.key) n.delete('tab');
        else n.set('tab', t);
        return n;
      },
      { replace: true },
    );
  const main = zoneMainAction(zone, can);
  const Icon = ZONE_ICON[zone];
  const sum = summary.data;
  const counts: Partial<Record<ZoneTab, number | undefined>> = {
    running: zone === 'tfo' ? sum?.tfo.runningSections : undefined,
    pending: zone === 'tfo' ? sum?.tfo.pending : zone === 'warping' ? sum?.warping.pending : undefined,
    in_process: sum?.warping.inProcess,
  };

  return (
    <div className="page-container space-y-4 pb-24 pt-3 lg:pb-6">
      <BackLink to="/yarn" label="Yarn inventory" />
      <section className="overflow-hidden rounded-2xl border bg-white shadow-soft" style={{ borderColor: c.accent.border }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 md:p-5" style={{ backgroundColor: c.accent.soft }}>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white" style={{ color: c.accent.solid }}>
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-extrabold tracking-tight text-slate-900">{c.label}</h2>
            <p className="truncate text-sm text-slate-600">{c.description}</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:w-auto xl:justify-end [&>*:last-child:nth-child(odd)]:col-span-2">
            <Button variant="secondary" className="bg-white" onClick={() => setAction({ kind: 'transfer', zone })}>
              <ArrowLeftRight /> Transfer
            </Button>
            {zoneHasExtraWithdraw(zone) && (
              <Button variant="secondary" className="bg-white" onClick={() => setAction({ kind: 'withdraw', zone })}>
                <PackageMinus /> Withdraw
              </Button>
            )}
            {zone === 'tfo' && (
              <Button variant="secondary" className="bg-white" onClick={() => setMachineView(true)}>
                <LayoutGrid /> Machine view
              </Button>
            )}
            {can('canAdjustYarnStock') && (
              <Button variant="secondary" className="bg-white" onClick={() => setManual(true)}>
                <SlidersHorizontal /> Add / remove
              </Button>
            )}
            {main && (
              <Button className="text-white hover:opacity-90" style={{ backgroundColor: c.accent.solid }} onClick={() => setAction({ kind: main, zone })}>
                {zone !== 'direct' && <Plus />} {c.actionLabel}
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border border-t md:grid-cols-4" style={{ borderColor: c.accent.border }}>
          <Figure label="Raw yarn">{data ? <Kg g={data.stock.rawG} /> : '—'}</Figure>
          <Figure label="Twisted yarn">
            {data ? <Kg g={data.stock.twistedG} /> : '—'}
            {data && data.stock.boxes > 0 && <span className="ml-1.5 text-sm font-semibold text-slate-500">· {data.stock.boxes} box{data.stock.boxes === 1 ? '' : 'es'}</span>}
          </Figure>
          {zone === 'tfo' ? (
            <>
              <Figure label="Running" className="border-t md:border-t-0">
                {sum ? `${sum.tfo.runningSections} / ${sum.tfo.activeMachines * 2}` : '—'}
              </Figure>
              <Figure label="Pending programs" className="border-t md:border-t-0">
                {sum?.tfo.pending ?? '—'}
              </Figure>
            </>
          ) : (
            <>
              <Figure label="Beams" className="border-t md:border-t-0">
                {data ? data.stock.beams : '—'}
              </Figure>
              <Figure label={zone === 'warping' ? 'In process · pending' : 'Boxes'} className="border-t md:border-t-0">
                {zone === 'warping' ? (sum ? `${sum.warping.inProcess} · ${sum.warping.pending}` : '—') : data ? data.stock.boxes : '—'}
              </Figure>
            </>
          )}
        </div>
      </section>

      <StockCard zone={zone} data={data} />
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {tab && (
        <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
          <div role="tablist" aria-label={`${c.label} sections`} className="-mx-1 mb-4 flex flex-wrap gap-2 px-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors',
                  tab === t.key ? 'border-transparent text-white' : 'border-input bg-white text-slate-700 hover:bg-muted',
                )}
                style={tab === t.key ? { backgroundColor: c.accent.solid } : undefined}
              >
                {t.label}
                {counts[t.key] !== undefined && <span className={cn('ml-1.5 tabular-nums', tab === t.key ? 'text-white/80' : 'text-slate-400')}>{counts[t.key]}</span>}
              </button>
            ))}
          </div>
          {zone === 'tfo' && (tab === 'running' || tab === 'pending') ? (
            <TfoProgramsSection tab={tab} />
          ) : zone === 'warping' && (tab === 'in_process' || tab === 'pending' || tab === 'done') ? (
            <WarpingJobsSection tab={tab} onTab={setTab} />
          ) : null}
        </section>
      )}

      <MovementsSection zone={zone} />
      <ZoneActionDialogs action={action} onClose={() => setAction(null)} />
      <ManualStockDialog open={manual} onOpenChange={setManual} zone={zone} />
      {zone === 'tfo' && <MachineViewDialog open={machineView} onOpenChange={setMachineView} onCreate={can('canPlanYarn') ? () => setAction({ kind: 'program', zone }) : undefined} />}
    </div>
  );
}

/** `/yarn/movements` — every zone's movements, with a zone filter. */
export function YarnMovementsPage() {
  usePageTitle('Yarn movements');
  return (
    <div className="page-container space-y-4 pb-24 pt-3 lg:pb-6">
      <BackLink to="/yarn" label="Yarn inventory" />
      <MovementsSection title="All movements" />
    </div>
  );
}
