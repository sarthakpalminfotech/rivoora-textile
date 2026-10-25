import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  beamLabel,
  isMoveFilter,
  isYarnZone,
  MOVE_FILTER_LABEL,
  MOVE_FILTERS,
  MOVE_KIND_LABEL,
  YARN_ITEM_LABEL,
  YARN_ZONE_CONFIG,
  YARN_ZONES,
  type MoveFilter,
  type YarnMove,
  type YarnZone,
} from '@rivoora/shared';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { DateRangePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { MultiSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useYarnMoves, useYarnQualityLookup, type MovesParams } from './api';
import { actorText, Kg, Pill, ZoneTag } from './parts';

/** "Raw yarn · 75D" / "2 beams · BM-3, BM-4" */
function whatLine(m: YarnMove) {
  if (m.source === 'beam') {
    const n = Math.abs(m.beams ?? 0);
    return `${n} beam${n === 1 ? '' : 's'}${m.quality ? ` · ${m.quality.name}` : ''}`;
  }
  return `${m.item ? YARN_ITEM_LABEL[m.item] : ''}${m.quality ? ` · ${m.quality.name}` : ''}`;
}

function Qty({ m, className }: { m: YarnMove; className?: string }) {
  if (m.source === 'beam') {
    const n = m.beams ?? 0;
    return (
      <span className={cn('whitespace-nowrap font-semibold tabular-nums', n < 0 ? 'text-rose-700' : 'text-emerald-700', className)}>
        {n < 0 ? '−' : '+'}
        {Math.abs(n)} beam{Math.abs(n) === 1 ? '' : 's'}
      </span>
    );
  }
  return <Kg g={m.qtyG ?? 0} signed className={cn('font-semibold', className)} />;
}

function KindIcon({ m }: { m: YarnMove }) {
  const out = m.source === 'beam' ? (m.beams ?? 0) < 0 : (m.qtyG ?? 0) < 0;
  const Icon = out ? ArrowUpRight : ArrowDownLeft;
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', out ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600')}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

/** A movements list: a table from 768px (time · zone · what · quantity · by), cards on phones. */
export function MovementList({ items, showZone = true }: { items: YarnMove[]; showZone?: boolean }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed text-sm">
          <thead className="border-b border-border text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-[17%] py-2 pr-3 text-left">Time</th>
              {showZone && <th className="w-[16%] py-2 pr-3 text-left">Zone</th>}
              <th className="py-2 pr-3 text-left">What</th>
              <th className="w-[15%] py-2 pr-3 text-right">Qty</th>
              <th className="hidden w-[13%] py-2 text-left lg:table-cell">By</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.key} className="border-b border-border align-top last:border-0">
                <td className="py-2.5 pr-3 text-slate-500">{formatDateTime(m.createdAt)}</td>
                {showZone && (
                  <td className="py-2.5 pr-3">
                    <ZoneTag zone={m.zone} short />
                  </td>
                )}
                <td className="min-w-0 py-2.5 pr-3">
                  <p className="truncate font-semibold text-slate-800">
                    {MOVE_KIND_LABEL[m.kind]} <span className="font-normal text-slate-600">· {whatLine(m)}</span>
                  </p>
                  {(m.context || m.note) && <p className="truncate text-xs text-slate-500">{[m.context, m.note].filter(Boolean).join(' · ')}</p>}
                  <p className="truncate text-xs text-slate-400 lg:hidden">{actorText(m)}</p>
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <Qty m={m} />
                </td>
                <td className="hidden truncate py-2.5 text-slate-500 lg:table-cell">{actorText(m) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden">
        {items.map((m) => (
          <li key={m.key} className="flex items-start gap-3 py-3">
            <KindIcon m={m} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold text-slate-800">{MOVE_KIND_LABEL[m.kind]}</p>
                <Qty m={m} className="text-sm" />
              </div>
              <p className="truncate text-sm text-slate-600">{whatLine(m)}</p>
              {(m.context || m.note) && <p className="truncate text-xs text-slate-500">{[m.context, m.note].filter(Boolean).join(' · ')}</p>}
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {showZone ? `${YARN_ZONE_CONFIG[m.zone].label} · ` : ''}
                {formatDateTime(m.createdAt)}
                {actorText(m) ? ` · ${actorText(m)}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Movement filters in the URL: `mz` (zone, only when no fixed zone), `mtype`, `mq`, `mfrom`, `mto`. */
function useMoveFilters(fixedZone?: YarnZone) {
  const [params, setParams] = useSearchParams();
  const value = useMemo<MovesParams>(() => {
    const mz = params.get('mz') ?? '';
    const from = params.get('mfrom') ?? '';
    const to = params.get('mto') ?? '';
    return {
      zone: fixedZone ?? (isYarnZone(mz) ? mz : undefined),
      kind: (params.get('mtype') ?? '').split(',').filter(isMoveFilter),
      quality: (params.get('mq') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0),
      from: DATE_RE.test(from) ? from : undefined,
      to: DATE_RE.test(to) ? to : undefined,
    };
  }, [params, fixedZone]);
  const set = (patch: Partial<MovesParams>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const put = (k: string, v: string | undefined) => (v ? next.set(k, v) : next.delete(k));
        if ('zone' in patch) put('mz', patch.zone);
        if ('kind' in patch) put('mtype', patch.kind?.join(','));
        if ('quality' in patch) put('mq', patch.quality?.join(','));
        if ('from' in patch) put('mfrom', patch.from);
        if ('to' in patch) put('mto', patch.to);
        return next;
      },
      { replace: true },
    );
  return { value, set };
}

/** The movements ledger with its filters (type, quality, date; zone when not fixed), paginated. */
export function MovementsSection({ zone, title = 'Movements' }: { zone?: YarnZone; title?: string }) {
  const { value, set } = useMoveFilters(zone);
  const query = useYarnMoves(value);
  const qualities = useYarnQualityLookup('');
  const toggleKind = (k: MoveFilter) => set({ kind: value.kind.includes(k) ? value.kind.filter((x) => x !== k) : [...value.kind, k] });
  const filtered = value.kind.length > 0 || value.quality.length > 0 || !!value.from || !!value.to || (!zone && !!value.zone);

  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-800">{title}</h2>
        {query.total !== undefined && <span className="text-sm text-slate-500">{query.total} entries</span>}
      </div>
      <div className="mb-3 space-y-3">
        {!zone && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Zone">
            <Pill on={!value.zone} onClick={() => set({ zone: undefined })}>
              All zones
            </Pill>
            {YARN_ZONES.map((z) => (
              <Pill key={z} on={value.zone === z} onClick={() => set({ zone: z })}>
                {YARN_ZONE_CONFIG[z].label}
              </Pill>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
          {MOVE_FILTERS.filter((f) => !zone || zone === 'tfo' || f !== 'tfo')
            .filter((f) => !zone || zone === 'warping' || f !== 'warping')
            .map((f) => (
              <Pill key={f} on={value.kind.includes(f)} onClick={() => toggleKind(f)}>
                {MOVE_FILTER_LABEL[f]}
              </Pill>
            ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:max-w-3xl">
          <MultiSelect
            options={(qualities.data ?? []).map((q) => ({ value: q.id, label: q.name }))}
            value={value.quality}
            onChange={(quality) => set({ quality })}
            placeholder="All qualities"
            searchable
            loading={qualities.isPending}
            aria-label="Quality"
          />
          <DateRangePicker value={{ from: value.from, to: value.to }} onChange={(r) => set({ from: r.from, to: r.to })} />
        </div>
      </div>
      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.items.length === 0 ? (
        <EmptyState icon={History} title={filtered ? 'No movements match' : 'No movements yet'} description={filtered ? undefined : 'Receipts, transfers, withdrawals, TFO programs and warping show here.'} className="py-8" />
      ) : (
        <>
          <MovementList items={query.items} showZone={!zone} />
          <LoadMore
            hasNextPage={!!query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={() => void query.fetchNextPage()}
            shown={query.items.length}
            total={query.total}
            noun="movements"
          />
        </>
      )}
    </section>
  );
}

/** Beam numbers for small lists ("BM-3, BM-4 +2"). */
export const beamNos = (nos: number[], max = 4) => nos.slice(0, max).map(beamLabel).join(', ') + (nos.length > max ? ` +${nos.length - max}` : '');
