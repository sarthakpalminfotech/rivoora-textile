import { CheckCircle2, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DAMAGE_TYPE_LABEL, damageOpenPcs, formatPcs, isDamageType, takaActualPcs, takaStageLabel, type DamagedTaka, type DamageType, type GodownDamageState } from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useGodownDamages, useResolveGodownDamage } from './api';

type OpenDamage = DamagedTaka['damages'][number];

const STATES: { key: GodownDamageState; label: string; badge: string }[] = [
  { key: 'final', label: 'In godown', badge: 'bg-slate-100 text-slate-700' },
  { key: 'ready_dispatch', label: 'Ready for dispatch', badge: 'bg-emerald-100 text-emerald-800' },
  { key: 'refinish', label: 'Refinish', badge: 'bg-amber-100 text-amber-800' },
];
const isState = (v: string | null): v is GodownDamageState => STATES.some((s) => s.key === v);
const TYPE_SHORT: Record<DamageType, string> = { machine: 'Machine', butta: 'Butta', mill: 'Mill', godown: 'Supervisor', customer_return: 'Customer return' };

/** The taka's state, as a small soft badge with bold text (never a full-card colour). */
function StateBadge({ stage }: { stage: string }) {
  const s = STATES.find((x) => x.key === stage);
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-4', s?.badge ?? 'bg-slate-100 text-slate-600')}>
      {s?.label ?? takaStageLabel(stage as never)}
    </span>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40',
        active ? 'border-primary/40 bg-primary-soft/50 font-semibold text-primary' : 'border-border bg-white font-medium text-slate-600 hover:border-slate-300',
      )}
    >
      {label} <span className="tabular-nums text-slate-400">({count})</span>
    </button>
  );
}

/**
 * Godown → Damage tab. One card per taka that still has damage; inside it one row per damage:
 * what it is, where it was found, how many pcs, photos, and a "Mark resolved" button (final takas only).
 */
export function GodownDamagesTab({ orderId }: { orderId: number }) {
  const query = useGodownDamages(orderId);
  const resolve = useResolveGodownDamage();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const rawState = params.get('state');
  const rawType = params.get('dtype');
  const stateFilter = isState(rawState) ? rawState : null;
  const typeFilter: DamageType | null = isDamageType(rawType) ? rawType : null;
  // One state filter and one type filter combine; tapping the active chip again clears it. Kept in the URL.
  const setFilter = (key: 'state' | 'dtype', value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const [target, setTarget] = useState<{ taka: DamagedTaka; damage: OpenDamage } | null>(null);

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  const data = query.data;
  const items = data.items.filter((t) => (!stateFilter || t.stage === stateFilter) && (!typeFilter || t.damages.some((d) => d.foundAt === typeFilter)));
  const openPcs = items.reduce((s, t) => s + t.damages.reduce((n, d) => n + (damageOpenPcs(d) ?? 0), 0), 0);
  const stateChips = data.stateCounts.filter((c) => c.count > 0);
  const typeChips = data.typeCounts.filter((c) => c.count > 0);
  const details = (takaId: number) => navigate(`/godown/orders/${orderId}/takas/${takaId}/damages`, { state: { from: `${location.pathname}${location.search}` } });

  if (data.items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        <EmptyState icon={CheckCircle2} title="No damaged takas" description="Every taka of this order is fresh." className="py-10" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-600">
        <b className="text-slate-900">{items.length}</b> damaged {items.length === 1 ? 'taka' : 'takas'}
        {openPcs > 0 && (
          <>
            {' · '}
            <b className="text-red-600">{formatPcs(openPcs)}</b> damaged
          </>
        )}
      </p>

      {(stateChips.length > 0 || typeChips.length > 0) && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter damaged takas">
          <FilterChip label="All" count={data.items.length} active={!stateFilter && !typeFilter} onClick={() => setParams((prev) => { const n = new URLSearchParams(prev); n.delete('state'); n.delete('dtype'); return n; }, { replace: true })} />
          {stateChips.map((c) => (
            <FilterChip key={c.state} label={STATES.find((s) => s.key === c.state)!.label} count={c.count} active={stateFilter === c.state} onClick={() => setFilter('state', stateFilter === c.state ? null : c.state)} />
          ))}
          {typeChips.map((c) => (
            <FilterChip key={c.type} label={TYPE_SHORT[c.type]} count={c.count} active={typeFilter === c.type} onClick={() => setFilter('dtype', typeFilter === c.type ? null : c.type)} />
          ))}
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={CheckCircle2} title="No takas match these filters" description="Tap All to see every damaged taka." className="py-10" />
        </div>
      )}

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {items.map((t) => {
          const canResolve = t.stage === 'final';
          return (
            <li key={t.id} className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-slate-50 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold tabular-nums text-slate-900">
                    Taka {t.takaNo}
                    <StateBadge stage={t.stage} />
                  </p>
                  {takaActualPcs(t) != null && <p className="text-xs font-medium text-slate-500">{formatPcs(takaActualPcs(t)!)}</p>}
                </div>
                <Button variant="ghost" size="sm" className="h-10 shrink-0 text-slate-600" onClick={() => details(t.id)}>
                  Details <ChevronRight />
                </Button>
              </div>
              <ul className="divide-y divide-border">
                {t.damages.map((d) => {
                  const open = damageOpenPcs(d);
                  return (
                    <li key={d.id} className="space-y-2.5 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-bold text-slate-900">{d.damageName ?? 'Damage'}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{DAMAGE_TYPE_LABEL[d.foundAt]}</span>
                            {open != null && <span className="font-semibold tabular-nums text-red-600">{formatPcs(open)}</span>}
                          </p>
                        </div>
                        {canResolve && (
                          <Button variant="secondary" size="sm" className="h-11 shrink-0 border-green-200 text-green-700 hover:bg-green-50" onClick={() => setTarget({ taka: t, damage: d })}>
                            <CheckCircle2 /> Mark resolved
                          </Button>
                        )}
                      </div>
                      {!!d.images?.length && (
                        <div className="flex flex-wrap gap-1.5">
                          {d.images.map((img) => (
                            <ImageThumb key={img.id} thumbUrl={img.thumbUrl} fullUrl={img.url} alt={`${d.damageName ?? 'Damage'} photo`} className="size-14" rounded="rounded-lg" />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!canResolve && <p className="border-t border-border bg-slate-50/60 px-4 py-2 text-xs text-slate-500">Can be resolved once the taka is a final taka.</p>}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target ? `Mark ${target.damage.damageName ?? 'damage'} resolved?` : 'Mark resolved?'}
        description={target ? `Taka ${target.taka.takaNo}: this damage is marked fully resolved.` : undefined}
        confirmLabel="Mark resolved"
        loading={resolve.isPending}
        onConfirm={() =>
          resolve.mutate(
            { id: target!.taka.id, takaDamageId: target!.damage.id },
            {
              onSuccess: () => {
                setTarget(null);
                toast.success('Marked resolved');
              },
              onError: (err) => {
                setTarget(null);
                toast.error(errorMessage(err));
              },
            },
          )
        }
      />
    </div>
  );
}
