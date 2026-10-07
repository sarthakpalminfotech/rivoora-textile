import { CheckCircle2, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DAMAGE_TYPE_LABEL, damageOpenPcs, formatPcs, takaActualPcs, takaStageLabel, type DamagedTaka } from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { useGodownDamages, useResolveGodownDamage } from './api';

type OpenDamage = DamagedTaka['damages'][number];

/**
 * Godown → Damage tab. One card per taka that still has damage; inside it one row per damage:
 * what it is, where it was found, how many pcs, photos, and a "Mark resolved" button (final takas only).
 */
export function GodownDamagesTab({ orderId }: { orderId: number }) {
  const query = useGodownDamages(orderId);
  const resolve = useResolveGodownDamage();
  const navigate = useNavigate();
  const location = useLocation();
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
  const openPcs = data.counts.reduce((s, c) => s + (c.pcs ?? 0), 0);
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
        <b className="text-slate-900">{data.items.length}</b> damaged {data.items.length === 1 ? 'taka' : 'takas'}
        {openPcs > 0 && (
          <>
            {' · '}
            <b className="text-red-600">{formatPcs(openPcs)}</b> damaged
          </>
        )}
      </p>

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {data.items.map((t) => {
          const canResolve = t.stage === 'final';
          return (
            <li key={t.id} className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-slate-50 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-xl font-bold tabular-nums text-slate-900">Taka {t.takaNo}</p>
                  <p className="text-xs font-medium text-slate-500">
                    {takaStageLabel(t.stage)}
                    {takaActualPcs(t) != null && ` · ${formatPcs(takaActualPcs(t)!)}`}
                  </p>
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
