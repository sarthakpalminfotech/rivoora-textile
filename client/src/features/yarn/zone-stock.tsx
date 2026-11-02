import { Boxes, Package2, Spool } from 'lucide-react';
import { formatKg, NO_LOT_LABEL, type YarnZoneData } from '@rivoora/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { Kg } from './parts';

/**
 * Sprint 20 — a zone's Stock tab: raw yarn by quality → lot (with what pending work reserves), twisted boxes, and
 * "No box" twisted yarn. Cards only (no dense tables): 1 column on phones, 2 on tablets, 3 on wide screens.
 */

function Block({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        {title}
        {count !== undefined && <span className="ml-1.5 font-semibold text-slate-400">({count})</span>}
      </h3>
      {children}
    </section>
  );
}

export function ZoneStockView({ data }: { data: YarnZoneData }) {
  const byQuality = new Map<number, { name: string; rows: YarnZoneData['rawLots'] }>();
  for (const r of data.rawLots) {
    const q = byQuality.get(r.quality.id) ?? { name: r.quality.name, rows: [] };
    q.rows.push(r);
    byQuality.set(r.quality.id, q);
  }
  const qualities = [...byQuality.entries()];
  // Sprint 20b: boxes of the same (warping) quality are listed under that quality.
  const boxGroups: { id: number; name: string; boxes: YarnZoneData['boxes'] }[] = [];
  for (const b of data.boxes) {
    const g = boxGroups.find((x) => x.id === b.warpingQuality.id);
    if (g) g.boxes.push(b);
    else boxGroups.push({ id: b.warpingQuality.id, name: b.warpingQuality.name, boxes: [b] });
  }
  boxGroups.sort((x, y) => x.name.localeCompare(y.name));
  const empty = !qualities.length && !data.boxes.length && !data.noBox.length;
  if (empty) return <EmptyState icon={Spool} title="No yarn in this zone" description="Receive a challan here, or transfer yarn in from another zone." className="py-10" />;

  return (
    <div className="grid gap-6">
      {qualities.length > 0 && (
        <Block title="Raw yarn by lot" count={data.rawLots.length}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]">
            {qualities.map(([id, q]) => {
              const total = q.rows.reduce((s, r) => s + r.balanceG, 0);
              return (
                <div key={id} className="min-w-0 rounded-xl border border-border bg-white">
                  <div className="flex items-baseline gap-2 border-b border-border px-3 py-2.5">
                    <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">{q.name}</p>
                    <Kg g={total} className="font-bold text-slate-900" />
                  </div>
                  <ul className="divide-y divide-border">
                    {q.rows.map((r) => (
                      <li key={r.lot?.id ?? 0} className="flex items-baseline gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-slate-800">{r.lot ? `Lot ${r.lot.lotNo}` : NO_LOT_LABEL}</span>
                          {r.lot && <span className="text-slate-500"> · {r.lot.partyName}</span>}
                        </span>
                        <span className="text-right">
                          <Kg g={r.balanceG} className="font-semibold text-slate-800" />
                          {r.reservedG > 0 && (
                            <span className="block text-xs font-medium text-amber-700">
                              reserved <Kg g={r.reservedG} />
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Block>
      )}

      {data.boxes.length > 0 && (
        <Block title="Twisted yarn — boxes by quality" count={data.boxes.length}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]">
            {boxGroups.map((g) => (
              <div key={g.id} className="min-w-0 rounded-xl border border-border bg-white">
                <div className="flex items-baseline gap-2 border-b border-border px-3 py-2.5">
                  <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">{g.name}</p>
                  <span className="shrink-0 text-xs text-slate-500">
                    {g.boxes.length} box{g.boxes.length === 1 ? '' : 'es'}
                  </span>
                  <Kg g={g.boxes.reduce((s, b) => s + b.remainingG, 0)} className="font-bold text-slate-900" />
                </div>
                <ul className="divide-y divide-border">
                  {g.boxes.map((b) => (
                    <li key={b.id} className="flex items-baseline gap-2 px-3 py-2 text-sm">
                      <Package2 className="size-4 shrink-0 self-center text-slate-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold tabular-nums text-slate-800">Box {b.boxNo}</span>
                        <span className="text-slate-500">
                          {' '}
                          · {b.rolls} rolls · {b.lot ? `lot ${b.lot.lotNo}` : NO_LOT_LABEL}
                        </span>
                      </span>
                      <span className="text-right">
                        <Kg g={b.remainingG} className="font-semibold text-slate-800" />
                        {b.reservedG > 0 && <span className="block text-xs font-medium text-amber-700">reserved {formatKg(b.reservedG)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Block>
      )}

      {data.noBox.length > 0 && (
        <Block title="Twisted yarn — no box" count={data.noBox.length}>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.noBox.map((n) => (
              <li key={`${n.qualityId}-${n.warpingQualityId}`} className="flex items-center gap-3 rounded-xl border border-border bg-white px-3 py-2.5">
                <Boxes className="size-5 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{n.name}</span>
                <span className="text-right">
                  <Kg g={n.availableG + n.reservedG} className="font-semibold text-slate-900" />
                  {n.reservedG > 0 && (
                    <span className="block text-xs font-medium text-amber-700">
                      reserved <Kg g={n.reservedG} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}
