import { ArrowLeftRight, Cylinder, SlidersHorizontal, Spool } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isYarnZone, YARN_ZONE_CONFIG, type Beam, type YarnZone } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useYarnZone } from './api';
import { ManualStockDialog } from './manual-stock';
import { MovementsSection } from './movements';
import { BackLink, Kg, Section, ZONE_ICON } from './parts';
import { TfoProgramsSection } from './tfo-board';
import { WarpingJobsSection } from './warping';
import { ZoneActionDialogs, zoneMainAction, type ZoneAction } from './zone-actions';

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

/**
 * Sprint 17 — a zone screen (`/yarn/direct | tfo | warping`): header + the zone's two actions; TFO shows the machine
 * board first, Warping its jobs; then stock by quality (and beams), and the zone's movements.
 */
export default function YarnZonePage() {
  const param = useParams().zone ?? '';
  const zone: YarnZone | null = isYarnZone(param) ? param : null;
  const c = zone ? YARN_ZONE_CONFIG[zone] : null;
  usePageTitle(c ? c.label : 'Yarn inventory');
  const { data, isPending, isError, error, refetch } = useYarnZone(zone ?? 'direct', !!zone);
  const [action, setAction] = useState<ZoneAction | null>(null);
  const { can } = useRole();
  const [manual, setManual] = useState(false);
  if (!zone || !c) return <Navigate to="/yarn" replace />;
  // TFO / Warping: "New programs" / "New job" sit on their sections.
  const main = zone === 'direct' ? zoneMainAction(zone, can) : null;
  const Icon = ZONE_ICON[zone];

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
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" className={main ? 'bg-white' : 'col-span-2 bg-white'} onClick={() => setAction({ kind: 'transfer', zone })}>
              <ArrowLeftRight /> Transfer
            </Button>
            {main && (
              <Button className="text-white hover:opacity-90" style={{ backgroundColor: c.accent.solid }} onClick={() => setAction({ kind: main, zone })}>
                {c.actionLabel}
              </Button>
            )}
            {can('canAdjustYarnStock') && (
              <Button variant="secondary" className="col-span-2 bg-white" onClick={() => setManual(true)}>
                <SlidersHorizontal /> Add / remove
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border border-t md:grid-cols-3" style={{ borderColor: c.accent.border }}>
          <div className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Raw yarn</p>
            <p className="text-xl font-bold">{data ? <Kg g={data.stock.rawG} /> : '—'}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Twisted yarn</p>
            <p className="text-xl font-bold">{data ? <Kg g={data.stock.twistedG} /> : '—'}</p>
          </div>
          {c.hasBeams && (
            <div className="col-span-2 border-t px-4 py-3 md:col-span-1 md:border-t-0" style={{ borderColor: c.accent.border }}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Beams</p>
              <p className="text-xl font-bold tabular-nums">{data ? data.stock.beams : '—'}</p>
            </div>
          )}
        </div>
      </section>

      {zone === 'tfo' && <TfoProgramsSection />}
      {zone === 'warping' && <WarpingJobsSection />}

      {isPending ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : isError || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className={c.hasBeams ? 'grid gap-4 xl:grid-cols-2' : ''}>
          <Section title="Stock by quality">
            {data.qualities.length ? (
              <table className="w-full table-fixed text-sm">
                <thead className="border-b border-border text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 text-left">Quality</th>
                    <th className="w-[28%] py-2 text-right">Raw</th>
                    <th className="w-[28%] py-2 text-right">Twisted</th>
                  </tr>
                </thead>
                <tbody>
                  {data.qualities.map((q) => (
                    <tr key={q.quality.id} className="border-b border-border last:border-0">
                      <td className="py-2.5">
                        <p className="truncate font-semibold text-slate-900">{q.quality.name}</p>
                        {(q.quality.denier || q.quality.filament) && (
                          <p className="truncate text-xs text-slate-500">{[q.quality.denier && `D ${q.quality.denier}`, q.quality.filament && `F ${q.quality.filament}`].filter(Boolean).join(' · ')}</p>
                        )}
                      </td>
                      <td className="py-2.5 text-right">{q.rawG ? <Kg g={q.rawG} className="font-semibold" /> : <span className="text-slate-300">—</span>}</td>
                      <td className="py-2.5 text-right">{q.twistedG ? <Kg g={q.twistedG} className="font-semibold" /> : <span className="text-slate-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !data.warpingQualities.length ? (
              <EmptyState icon={Spool} title="No yarn in this zone" description="Receive a challan here, or transfer yarn in from another zone." className="py-8" />
            ) : null}
            {data.warpingQualities.length > 0 && (
              <table className={cn('w-full table-fixed text-sm', data.qualities.length > 0 && 'mt-4')}>
                <thead className="border-b border-border text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 text-left">Warping quality (twisted)</th>
                    <th className="w-[22%] py-2 text-right">Boxes</th>
                    <th className="w-[28%] py-2 text-right">Twisted</th>
                  </tr>
                </thead>
                <tbody>
                  {data.warpingQualities.map((w) => (
                    <tr key={w.quality.id} className="border-b border-border last:border-0">
                      <td className="truncate py-2.5 font-semibold text-slate-900">{w.quality.name}</td>
                      <td className="py-2.5 text-right tabular-nums">{w.boxes || <span className="text-slate-300">—</span>}</td>
                      <td className="py-2.5 text-right">
                        <Kg g={w.twistedG} className="font-semibold" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          {c.hasBeams && (
            <Section title={`Beams in stock (${data.beams.length})`}>
              <BeamsList beams={data.beams} />
            </Section>
          )}
        </div>
      )}

      <MovementsSection zone={zone} />
      <ZoneActionDialogs action={action} onClose={() => setAction(null)} />
      <ManualStockDialog open={manual} onOpenChange={setManual} zone={zone} />
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
