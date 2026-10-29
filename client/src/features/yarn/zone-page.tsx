import { ArrowLeftRight, Cylinder, LayoutGrid, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { isYarnZone, YARN_ZONE_CONFIG, type Beam, type YarnZone } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useYarnSummary, useYarnZone } from './api';
import { ManualStockDialog } from './manual-stock';
import { MovementsSection } from './movements';
import { BackLink, Kg, ZONE_ICON } from './parts';
import { MachineViewDialog, TfoProgramsSection } from './tfo-board';
import { WarpingJobsSection } from './warping';
import { ZoneActionDialogs, zoneMainAction, type ZoneAction } from './zone-actions';
import { ZoneStockView } from './zone-stock';

function BeamsList({ beams }: { beams: Beam[] }) {
  if (!beams.length) return <EmptyState icon={Cylinder} title="No beams here" description="Beams come from finished warping jobs." className="py-8" />;
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed text-sm">
          <thead className="border-b border-border text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-[16%] py-2 text-left">Beam</th>
              <th className="py-2 text-left">Quality</th>
              <th className="w-[11%] py-2 text-right">Taar</th>
              <th className="w-[11%] py-2 text-right">Panna</th>
              <th className="w-[14%] py-2 text-right">Meters</th>
              <th className="w-[19%] py-2 pl-3 text-left">Made on</th>
            </tr>
          </thead>
          <tbody>
            {beams.map((b) => (
              <tr key={b.id} className="border-b border-border last:border-0">
                <td className="py-2.5 font-bold tabular-nums text-slate-900">{b.beamCode}</td>
                <td className="truncate py-2.5 font-medium text-slate-800">{b.quality.name}</td>
                <td className="py-2.5 text-right tabular-nums">{b.taar}</td>
                <td className="py-2.5 text-right tabular-nums">{b.panna}</td>
                <td className="py-2.5 text-right tabular-nums">{b.meters.toLocaleString('en-IN')}</td>
                <td className="py-2.5 pl-3 text-slate-500">
                  {formatDate(b.createdAt)}
                  {b.warpingJobNo ? <span className="ml-1 text-xs text-slate-400">WJ-{b.warpingJobNo}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden">
        {beams.map((b) => (
          <li key={b.id} className="py-2.5">
            <p className="flex items-baseline gap-2">
              <span className="font-bold tabular-nums text-slate-900">{b.beamCode}</span>
              <span className="truncate text-sm font-medium text-slate-700">{b.quality.name}</span>
            </p>
            <p className="text-xs text-slate-500">
              Taar {b.taar} · Panna {b.panna} · {b.meters.toLocaleString('en-IN')} m · {formatDate(b.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

type ZoneTab = 'running' | 'pending' | 'in_process' | 'done' | 'stock' | 'beams';

/** The tabs of each zone screen (§9): TFO Running | Pending | Stock · Warping In process | Pending | Stock | Beams | Done · Direct Stock | Beams. */
const ZONE_TABS: Record<YarnZone, { key: ZoneTab; label: string }[]> = {
  tfo: [
    { key: 'running', label: 'Running' },
    { key: 'pending', label: 'Pending' },
    { key: 'stock', label: 'Stock' },
  ],
  warping: [
    { key: 'in_process', label: 'In process' },
    { key: 'pending', label: 'Pending' },
    { key: 'stock', label: 'Stock' },
    { key: 'beams', label: 'Beams' },
    { key: 'done', label: 'Done' },
  ],
  direct: [
    { key: 'stock', label: 'Stock' },
    { key: 'beams', label: 'Beams' },
  ],
};

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
  const { data, isPending, isError, error, refetch } = useYarnZone(zone ?? 'direct', !!zone);
  const summary = useYarnSummary();
  const [params, setParams] = useSearchParams();
  const [action, setAction] = useState<ZoneAction | null>(null);
  const { can } = useRole();
  const [manual, setManual] = useState(false);
  const [machineView, setMachineView] = useState(false);
  if (!zone || !c) return <Navigate to="/yarn" replace />;
  const tabs = ZONE_TABS[zone];
  const tab = (tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0].key) as ZoneTab;
  const setTab = (t: ZoneTab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (t === tabs[0].key) n.delete('tab');
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
    beams: data?.stock.beams,
    stock: undefined,
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
        ) : isPending ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : isError || !data ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : tab === 'beams' ? (
          <BeamsList beams={data.beams} />
        ) : (
          <ZoneStockView data={data} />
        )}
      </section>

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
