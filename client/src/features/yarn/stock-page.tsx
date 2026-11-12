import { Boxes, ChevronDown, Cylinder, FilterX, Package2, Printer, Search, Spool } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  boxGroupKey,
  boxNoWithFy,
  isYarnZone,
  NO_LOT_LABEL,
  PALTI_LABEL,
  tfoProgramLabel,
  TWIST_DIRECTION_LABEL,
  YARN_ZONE_CONFIG,
  type Beam,
  type NoBoxStock,
  type YarnBox,
  type YarnBoxProgram,
  type YarnZone,
  type YarnZoneData,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { MultiSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useYarnZone } from './api';
import { BackLink, Kg, ZONE_ICON } from './parts';

/**
 * Sprint 20c — a zone's stock on its own screen (`/yarn/:zone/stock`, opened from the zone screen). Search + filters
 * (type, quality) in the URL. Yarn: raw yarn by quality → lot, twisted boxes grouped BY PROGRAM (collapsible; the
 * default in TFO) or BY QUALITY, and "No box" twisted yarn. Zones with beams (Direct consumption, Warping) have a
 * Yarn | Beams toggle at the top; beams show their remark after the meters.
 */

type View = 'yarn' | 'beams';
type TypeFilter = 'all' | 'raw' | 'twisted';
type Group = 'program' | 'quality';

const qKey = (kind: 'r' | 'w', id: number) => `${kind}-${id}`;
const boxQualityKey = (b: YarnBox) => qKey('w', b.warpingQuality.id);
const noBoxKey = (n: NoBoxStock) => (n.warpingQualityId ? qKey('w', n.warpingQualityId) : qKey('r', n.qualityId ?? 0));
const beamKey = (b: Beam) => (b.warpingQuality ? qKey('w', b.warpingQuality.id) : qKey('r', b.quality.id));

const has = (text: string | null | undefined, q: string) => !!text && text.toLowerCase().includes(q);

function programTitle(p: YarnBoxProgram | undefined, id: number) {
  return p ? `${tfoProgramLabel(id)} · ${p.sectionsLabel || 'Program'} · ${p.rawQuality}` : tfoProgramLabel(id);
}
function programLine(p: YarnBoxProgram | undefined) {
  if (!p) return '';
  return [
    p.lot ? `Lot ${p.lot}` : NO_LOT_LABEL,
    p.denierFilament,
    `TPM ${p.tpm}`,
    TWIST_DIRECTION_LABEL[p.direction],
    p.rolls !== null ? `${p.rolls} rolls` : null,
    p.stoppedAt ? `stopped ${formatDate(p.stoppedAt)}` : `started ${formatDate(p.startedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Section({ title, count, right, children }: { title: string; count?: number; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <h3 className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-slate-500">
          {title}
          {count !== undefined && <span className="ml-1.5 font-semibold text-slate-400">({count})</span>}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

const GRID = 'grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]';

/** A collapsible card: header (title, sub line, count + kg) and the boxes inside. */
function BoxGroup({
  title,
  line,
  boxes,
  open,
  onToggle,
  showQuality,
  selected,
  onSelect,
}: {
  title: string;
  line?: string;
  boxes: YarnBox[];
  open: boolean;
  onToggle: () => void;
  showQuality: boolean;
  /** Sprint 24 (CR-18): ticked boxes → "Print stickers". */
  selected: Set<number>;
  onSelect: (ids: number[], on: boolean) => void;
}) {
  const total = boxes.reduce((s, b) => s + b.remainingG, 0);
  const all = boxes.every((b) => selected.has(b.id));
  const some = boxes.some((b) => selected.has(b.id));
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50">
        <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-slate-400 transition-transform', !open && '-rotate-90')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-900">{title}</span>
          {line && <span className="block text-xs leading-snug text-slate-500">{line}</span>}
        </span>
        <span className="shrink-0 text-right">
          <Kg g={total} className="block font-bold text-slate-900" />
          <span className="text-xs text-slate-500">
            {boxes.length} box{boxes.length === 1 ? '' : 'es'}
          </span>
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          <li className="flex min-h-11 items-center gap-2 bg-slate-50 px-3 text-xs font-semibold text-slate-600">
            <TickBox checked={all} partial={some && !all} onCheckedChange={(c) => onSelect(boxes.map((b) => b.id), c)} aria-label={`Select all of ${title}`} />
            Select for stickers
          </li>
          {boxes.map((b) => (
            <li key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <TickBox checked={selected.has(b.id)} onCheckedChange={(c) => onSelect([b.id], c)} aria-label={`Select box ${boxNoWithFy(b.boxNo, b.fy)}`} />
              <Package2 className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  <span className="font-semibold tabular-nums text-slate-800">Box {boxNoWithFy(b.boxNo, b.fy)}</span>
                  {b.kind === 'remaining' && <span className="ml-1 rounded bg-amber-50 px-1 text-[11px] font-semibold text-amber-800">Remaining</span>}
                  <span className="text-slate-500">
                    {' '}
                    · {b.rolls ? `${b.rolls} rolls · ` : ''}
                    {b.lot ? `lot ${b.lot.lotNo}` : b.kind === 'palti' ? PALTI_LABEL : NO_LOT_LABEL}
                  </span>
                </span>
                {showQuality && <span className="block truncate text-xs text-slate-500">{b.warpingQuality.name}</span>}
              </span>
              <span className="shrink-0 text-right">
                <Kg g={b.remainingG} className="font-semibold text-slate-800" />
                {b.remainingG !== b.netG && (
                  <span className="block text-xs text-slate-400">
                    of <Kg g={b.netG} />
                  </span>
                )}
                {b.reservedG > 0 && (
                  <span className="block text-xs font-medium text-amber-700">
                    reserved <Kg g={b.reservedG} />
                  </span>
                )}
              </span>
              <Link
                to={`/print/yarn-boxes?ids=${b.id}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label={`Print sticker of box ${boxNoWithFy(b.boxNo, b.fy)}`}
                title="Print sticker"
              >
                <Printer className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function YarnStock({ data, type, quality, q, group, onGroup }: { data: YarnZoneData; type: TypeFilter; quality: string[]; q: string; group: Group; onGroup: (g: Group) => void }) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const navigate = useNavigate();
  const onSelect = (ids: number[], on: boolean) =>
    setSelected((cur) => {
      const n = new Set(cur);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const qOk = (key: string) => !quality.length || quality.includes(key);
  const programById = useMemo(() => new Map(data.programs.map((p) => [p.id, p])), [data.programs]);

  const rawLots = type === 'twisted' ? [] : data.rawLots.filter((r) => qOk(qKey('r', r.quality.id)) && (!q || has(r.quality.name, q) || has(r.lot?.lotNo, q) || has(r.lot?.partyName, q) || (!r.lot && has(NO_LOT_LABEL, q))));
  const boxes =
    type === 'raw'
      ? []
      : data.boxes.filter((b) => {
          if (!qOk(boxQualityKey(b))) return false;
          if (!q) return true;
          const p = programById.get(b.programId);
          return (
            has(`box ${b.boxNo}`, q) ||
            has(b.boxNo, q) ||
            has(b.warpingQuality.name, q) ||
            has(b.lot?.lotNo, q) ||
            has(p?.sectionsLabel, q) ||
            has(p?.rawQuality, q) ||
            (b.kind === 'palti' ? has(PALTI_LABEL, q) : has(tfoProgramLabel(b.programId), q))
          );
        });
  const noBox = type === 'raw' ? [] : data.noBox.filter((n) => qOk(noBoxKey(n)) && (!q || has(n.name, q)));

  const rawByQuality = new Map<number, { name: string; rows: YarnZoneData['rawLots'] }>();
  for (const r of rawLots) {
    const g = rawByQuality.get(r.quality.id) ?? { name: r.quality.name, rows: [] };
    g.rows.push(r);
    rawByQuality.set(r.quality.id, g);
  }

  const groups = useMemo(() => {
    const out: { key: string; title: string; line?: string; boxes: YarnBox[] }[] = [];
    for (const b of boxes) {
      // Sprint 24: Palti boxes in their own "Palti" group; warping "remaining" rows under their program.
      const key = group === 'program' ? boxGroupKey(b) : boxQualityKey(b);
      let g = out.find((x) => x.key === key);
      if (!g) {
        const p = programById.get(b.programId);
        g =
          group === 'program'
            ? key === 'palti'
              ? { key, title: PALTI_LABEL, line: 'Leftover yarn re-wound into new boxes', boxes: [] }
              : { key, title: programTitle(p, b.programId), line: programLine(p), boxes: [] }
            : { key, title: b.warpingQuality.name, boxes: [] };
        out.push(g);
      }
      g.boxes.push(b);
    }
    if (group === 'program') out.sort((a, b) => (a.key === 'palti' ? 1 : b.key === 'palti' ? -1 : Number(b.key.slice(2)) - Number(a.key.slice(2))));
    else out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }, [boxes, group, programById]);

  // While searching, every matching group is open.
  const isOpen = (key: string) => !!q || openKeys.has(key);
  const toggle = (key: string) =>
    setOpenKeys((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allOpen = groups.length > 0 && groups.every((g) => isOpen(g.key));

  if (!rawLots.length && !boxes.length && !noBox.length) {
    return <EmptyState icon={Spool} title="Nothing matches" description="Change the search or the filters." className="py-10" />;
  }

  return (
    <div className="grid gap-6">
      {rawLots.length > 0 && (
        <Section title="Raw yarn by lot" count={rawLots.length}>
          <div className={GRID}>
            {[...rawByQuality.entries()].map(([id, g]) => (
              <div key={id} className="min-w-0 rounded-xl border border-border bg-white">
                <div className="flex items-baseline gap-2 border-b border-border px-3 py-2.5">
                  <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">{g.name}</p>
                  <Kg g={g.rows.reduce((s, r) => s + r.balanceG, 0)} className="font-bold text-slate-900" />
                </div>
                <ul className="divide-y divide-border">
                  {g.rows.map((r) => (
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
            ))}
          </div>
        </Section>
      )}

      {boxes.length > 0 && (
        <Section
          title={group === 'program' ? 'Twisted yarn — boxes by program' : 'Twisted yarn — boxes by quality'}
          count={boxes.length}
          right={
            <div className="flex items-center gap-2">
              <Segmented
                size="md"
                className="w-auto min-w-[14rem]"
                value={group}
                onChange={onGroup}
                options={[
                  { value: 'program', label: 'By program' },
                  { value: 'quality', label: 'By quality' },
                ]}
                aria-label="Group boxes"
              />
              {!q && (
                <Button variant="ghost" size="sm" onClick={() => setOpenKeys(allOpen ? new Set() : new Set(groups.map((g) => g.key)))}>
                  {allOpen ? 'Collapse all' : 'Expand all'}
                </Button>
              )}
            </div>
          }
        >
          <div className={cn(GRID, 'items-start')}>
            {groups.map((g) => (
              <BoxGroup
                key={g.key}
                title={g.title}
                line={g.line}
                boxes={g.boxes}
                open={isOpen(g.key)}
                onToggle={() => toggle(g.key)}
                showQuality={group === 'program'}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </div>
          {selected.size > 0 && (
            <div className="kb-bar sticky bottom-20 z-20 mt-3 flex items-center gap-3 rounded-2xl border border-border bg-white/95 p-3 shadow-soft backdrop-blur lg:bottom-3">
              <p className="min-w-0 flex-1 text-sm font-semibold text-slate-800">
                {selected.size} box{selected.size === 1 ? '' : 'es'} selected
              </p>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button className="min-h-11" onClick={() => navigate(`/print/yarn-boxes?ids=${[...selected].join(',')}`)}>
                <Printer /> Print stickers
              </Button>
            </div>
          )}
        </Section>
      )}

      {noBox.length > 0 && (
        <Section title="Twisted yarn — no box" count={noBox.length}>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {noBox.map((n) => (
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
        </Section>
      )}
    </div>
  );
}

function BeamStock({ beams }: { beams: Beam[] }) {
  if (!beams.length) return <EmptyState icon={Cylinder} title="No beams match" description="Beams come from finished warping jobs." className="py-10" />;
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed text-sm">
          <thead className="border-b border-border text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-[11%] py-2 text-left">Beam</th>
              <th className="w-[22%] py-2 text-left">Quality</th>
              <th className="w-[9%] py-2 text-right">Taar</th>
              <th className="w-[9%] py-2 text-right">Panna</th>
              <th className="w-[11%] py-2 text-right">Meters</th>
              <th className="py-2 pl-4 text-left">Remark</th>
              <th className="w-[15%] py-2 pl-3 text-left">Made on</th>
            </tr>
          </thead>
          <tbody>
            {beams.map((b) => (
              <tr key={b.id} className="border-b border-border align-top last:border-0">
                <td className="py-2.5 font-bold tabular-nums text-slate-900">{b.beamCode}</td>
                <td className="break-words py-2.5 pr-2 font-medium text-slate-800">{b.quality.name}</td>
                <td className="py-2.5 text-right tabular-nums">{b.taar}</td>
                <td className="py-2.5 text-right tabular-nums">{b.panna}</td>
                <td className="py-2.5 text-right tabular-nums">{b.meters.toLocaleString('en-IN')}</td>
                <td className="break-words py-2.5 pl-4 text-slate-600">{b.remark ?? <span className="text-slate-300">—</span>}</td>
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
              Taar {b.taar} · Panna {b.panna} · {b.meters.toLocaleString('en-IN')} m{b.remark ? ` · ${b.remark}` : ''}
            </p>
            <p className="text-xs text-slate-400">
              {formatDate(b.createdAt)}
              {b.warpingJobNo ? ` · WJ-${b.warpingJobNo}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function YarnStockPage() {
  const param = useParams().zone ?? '';
  const zone: YarnZone | null = isYarnZone(param) ? param : null;
  const c = zone ? YARN_ZONE_CONFIG[zone] : null;
  usePageTitle(c ? `${c.label} · Stock` : 'Yarn stock');
  const { data, isPending, isError, error, refetch } = useYarnZone(zone ?? 'direct', !!zone);
  const [params, setParams] = useSearchParams();
  if (!zone || !c) return <Navigate to="/yarn" replace />;

  const view: View = c.hasBeams && params.get('view') === 'beams' ? 'beams' : 'yarn';
  const type: TypeFilter = params.get('type') === 'raw' ? 'raw' : params.get('type') === 'twisted' ? 'twisted' : 'all';
  const quality = (params.get('quality') ?? '').split(',').filter(Boolean);
  const qText = params.get('q') ?? '';
  const q = qText.trim().toLowerCase();
  const defaultGroup: Group = zone === 'tfo' ? 'program' : 'quality';
  const group: Group = params.get('group') === 'program' ? 'program' : params.get('group') === 'quality' ? 'quality' : defaultGroup;
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') n.delete(k);
          else n.set(k, v);
        }
        return n;
      },
      { replace: true },
    );

  const Icon = ZONE_ICON[zone];
  const qualityOptions = (() => {
    if (!data) return [];
    const m = new Map<string, string>();
    if (view === 'beams') for (const b of data.beams) m.set(beamKey(b), b.quality.name);
    else {
      if (type !== 'twisted') for (const r of data.rawLots) m.set(qKey('r', r.quality.id), r.quality.name);
      if (type !== 'raw') {
        for (const b of data.boxes) m.set(boxQualityKey(b), b.warpingQuality.name);
        for (const n of data.noBox) m.set(noBoxKey(n), n.name);
      }
    }
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  })();
  const filtered = !!q || quality.length > 0 || (view === 'yarn' && type !== 'all');
  const beams = (data?.beams ?? []).filter((b) => (!quality.length || quality.includes(beamKey(b))) && (!q || has(b.beamCode, q) || has(b.quality.name, q) || has(b.remark, q) || has(b.warpingJobNo ? `wj-${b.warpingJobNo}` : null, q)));

  return (
    <div className="page-container space-y-4 pb-24 pt-3 lg:pb-6">
      <BackLink to={`/yarn/${zone}`} label={c.label} />
      <section className="overflow-hidden rounded-2xl border bg-white shadow-soft" style={{ borderColor: c.accent.border }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 md:p-5" style={{ backgroundColor: c.accent.soft }}>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white" style={{ color: c.accent.solid }}>
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-extrabold tracking-tight text-slate-900 md:text-2xl">{c.label} · Stock</h2>
            <p className="truncate text-sm text-slate-600">
              {data ? (
                <>
                  Raw <Kg g={data.stock.rawG} /> · Twisted <Kg g={data.stock.twistedG} />
                  {data.stock.boxes > 0 && ` · ${data.stock.boxes} box${data.stock.boxes === 1 ? '' : 'es'}`}
                  {c.hasBeams && ` · ${data.stock.beams} beam${data.stock.beams === 1 ? '' : 's'}`}
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>
          {c.hasBeams && (
            <Segmented
              size="lg"
              value={view}
              onChange={(v) => set({ view: v === 'yarn' ? null : v, quality: null, type: null })}
              options={[
                { value: 'yarn', label: 'Yarn' },
                { value: 'beams', label: `Beams${data ? ` · ${data.stock.beams}` : ''}` },
              ]}
              aria-label="Show"
              className="w-full sm:w-auto sm:min-w-[15rem]"
            />
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(12rem,16rem)_auto] md:items-center">
          <Input
            value={qText}
            onChange={(e) => set({ q: e.target.value })}
            placeholder={view === 'beams' ? 'Search beam no., quality, remark…' : 'Search quality, lot, box no., machine…'}
            prefix={<Search className="size-4 text-slate-400" aria-hidden />}
            aria-label="Search stock"
          />
          {view === 'yarn' ? (
            <Segmented
              size="md"
              value={type}
              onChange={(t) => set({ type: t === 'all' ? null : t, quality: null })}
              options={[
                { value: 'all', label: 'All' },
                { value: 'raw', label: 'Raw' },
                { value: 'twisted', label: 'Twisted' },
              ]}
              aria-label="Type"
              className="min-w-[16rem]"
            />
          ) : (
            <span className="hidden lg:block" />
          )}
          <MultiSelect
            value={quality}
            onChange={(v) => set({ quality: v.join(',') })}
            options={qualityOptions}
            placeholder="All qualities"
            searchable
            emptyText="No qualities"
            panelClassName="min-w-[min(320px,calc(100vw-24px))]"
            aria-label="Quality"
          />
          {filtered ? (
            <Button variant="ghost" onClick={() => set({ q: null, quality: null, type: null })}>
              <FilterX /> Clear
            </Button>
          ) : (
            <span className="hidden lg:block" />
          )}
        </div>
        {isPending ? (
          <Skeleton className="h-48 w-full rounded-2xl" />
        ) : isError || !data ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : view === 'beams' ? (
          <BeamStock beams={beams} />
        ) : !data.rawLots.length && !data.boxes.length && !data.noBox.length ? (
          <EmptyState icon={Spool} title="No yarn in this zone" description="Receive a challan here, or transfer yarn in from another zone." className="py-10" />
        ) : (
          <YarnStock data={data} type={type} quality={quality} q={q} group={group} onGroup={(g) => set({ group: g === defaultGroup ? null : g })} />
        )}
      </section>
    </div>
  );
}
