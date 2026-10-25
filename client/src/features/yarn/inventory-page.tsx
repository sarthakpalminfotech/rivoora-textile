import { ArrowLeftRight, ChevronRight, Cylinder, History, RotateCw, Spool, Waves } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  runningSectionsText,
  YARN_ZONE_CONFIG,
  YARN_ZONES,
  type YarnSummary,
  type YarnZoneStock,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useYarnSummary } from './api';
import { MovementList } from './movements';
import { Kg, ZONE_ICON } from './parts';
import { ZoneActionDialogs, type ZoneAction } from './zone-actions';

function KpiTile({ label, value, icon: Icon, tone }: { label: string; value: React.ReactNode; icon: typeof Spool; tone?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-white p-3 shadow-soft md:px-3 md:py-2.5 lg:p-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 md:hidden lg:flex" style={tone ? { color: tone } : undefined}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400 md:text-[11px] lg:text-xs">{label}</p>
        <p className="truncate text-lg font-bold tabular-nums text-slate-900 md:text-base lg:text-xl">{value}</p>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5">
      <span className="truncate text-sm text-slate-500">{label}</span>
      <span className="whitespace-nowrap text-base font-bold tabular-nums text-slate-900 lg:text-lg">{children}</span>
    </div>
  );
}

/** One zone: its own accent + icon, the stock, and Transfer + the zone's second action. The body opens the zone. */
function ZonePanel({ stock, summary, onAction }: { stock: YarnZoneStock; summary: YarnSummary; onAction: (a: ZoneAction) => void }) {
  const z = stock.zone;
  const c = YARN_ZONE_CONFIG[z];
  const Icon = ZONE_ICON[z];
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white shadow-soft" style={{ borderColor: c.accent.border }}>
      <Link to={`/yarn/${z}`} className="group flex-1 p-4 transition-colors hover:bg-slate-50/60 md:p-3.5 lg:p-5" aria-label={`Open ${c.label}`}>
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl md:size-9 lg:size-12" style={{ backgroundColor: c.accent.soft, color: c.accent.solid }}>
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold leading-tight text-slate-900 md:whitespace-normal md:text-base lg:text-xl">{c.label}</h2>
            <p className="truncate text-xs text-slate-500 md:hidden lg:block">{c.description}</p>
          </div>
          <ChevronRight className="size-5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500 md:hidden lg:block" aria-hidden />
        </div>
        <div className="mt-3 divide-y divide-border">
          <Stat label="Raw yarn">
            <Kg g={stock.rawG} />
          </Stat>
          <Stat label="Twisted yarn">
            <Kg g={stock.twistedG} />
          </Stat>
          {c.hasBeams && <Stat label="Beams">{stock.beams}</Stat>}
          {z === 'tfo' && <Stat label="Sections">{runningSectionsText(summary.tfo.runningSections, summary.tfo.activeMachines)}</Stat>}
          {z === 'warping' && <Stat label="Jobs in process">{summary.warping.inProcess}</Stat>}
        </div>
      </Link>
      <div className="grid grid-cols-2 gap-2 border-t p-3 md:grid-cols-1 lg:grid-cols-2" style={{ borderColor: c.accent.border, backgroundColor: c.accent.soft }}>
        <Button variant="secondary" className="bg-white" onClick={() => onAction({ kind: 'transfer', zone: z })}>
          <ArrowLeftRight /> Transfer
        </Button>
        <Button
          className="text-white hover:opacity-90"
          style={{ backgroundColor: c.accent.solid }}
          onClick={() => onAction({ kind: z === 'direct' ? 'withdraw' : z === 'tfo' ? 'program' : 'warping', zone: z })}
        >
          {c.actionLabel}
        </Button>
      </div>
    </section>
  );
}

/**
 * Sprint 17 — Yarn inventory (`/yarn`): KPIs, the three zones as large separated panels (3 across from 768px, compact
 * on tablets; stacked on phones), and the last 10 movements.
 */
export default function YarnInventoryPage() {
  usePageTitle('Yarn inventory');
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useYarnSummary();
  const [action, setAction] = useState<ZoneAction | null>(null);

  if (isPending) {
    return (
      <div className="page-container space-y-4 pb-24 pt-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {YARN_ZONES.map((z) => (
            <Skeleton key={z} className="h-64 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (isError || !data) return <div className="page-container pt-5">{<ErrorState error={error} onRetry={() => void refetch()} />}</div>;

  return (
    <div className="page-container space-y-5 pb-24 pt-5 lg:pb-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile label="Raw yarn" value={<Kg g={data.totals.rawG} />} icon={Spool} />
        <KpiTile label="Twisted yarn" value={<Kg g={data.totals.twistedG} />} icon={RotateCw} />
        <KpiTile label="Beams" value={data.totals.beams} icon={Cylinder} />
        <KpiTile label="TFO running" value={data.tfo.runningSections} icon={RotateCw} tone={YARN_ZONE_CONFIG.tfo.accent.solid} />
        <div className="col-span-2 md:col-span-1">
          <KpiTile label="Warping jobs" value={data.warping.inProcess} icon={Waves} tone={YARN_ZONE_CONFIG.warping.accent.solid} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 md:gap-3 lg:gap-5">
        {data.zones.map((z) => (
          <ZonePanel key={z.zone} stock={z} summary={data} onAction={setAction} />
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-800">Recent movements</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/yarn/movements')}>
            View all <ChevronRight />
          </Button>
        </div>
        {data.recent.length ? (
          <MovementList items={data.recent} />
        ) : (
          <EmptyState icon={History} title="No movements yet" description="Receive a Yarn PO challan into a zone to start." className="py-8" />
        )}
      </section>

      <ZoneActionDialogs action={action} onClose={() => setAction(null)} />
    </div>
  );
}

