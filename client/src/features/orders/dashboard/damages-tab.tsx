import { AlertTriangle, Pencil, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DAMAGE_TYPE_CONFIG,
  DAMAGE_TYPE_LABEL,
  formatMeters,
  formatPcs,
  takaStageLabel,
  type DamageType,
  type OrderDetail,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOrderTakas } from '../../takas/api';
import { EditTakasDialog, type EditTakasTarget } from '../../takas/edit-takas-dialog';
import { toTarget } from '../../takas/takas-card';
import { useOrderDamages } from './api';
import { ComingSoon } from './dashboard-tab';
import type { OrderView } from './view-state';

const FILTERS: { key: DamageType | null; label: string }[] = [
  { key: null, label: 'All' },
  ...DAMAGE_TYPE_CONFIG.map((d) => ({ key: d.key, label: d.label.replace(/ damage$/, '') })),
];

/** Order details → Damages tab: counts per damage type, filter pills (in the URL) and the damaged takas. */
export function DamagesTab({ order, view }: { order: OrderDetail; view: OrderView }) {
  const { can } = useRole();
  const type = view.damageType;
  const query = useOrderDamages(order.id, type);
  const canEdit = can('canEditTakas');
  // The existing Edit takas flow needs the jobsheet's full taka list.
  const takas = useOrderTakas(order.id, canEdit && order.jobsheetCount > 0);
  const [editing, setEditing] = useState<EditTakasTarget | null>(null);
  const data = query.data;

  const editJobsheet = (jobsheetId: number) => {
    const g = takas.data?.groups.find((x) => x.jobsheetId === jobsheetId);
    if (g) setEditing(toTarget(g));
  };

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3" aria-label="Damage counts">
        {DAMAGE_TYPE_CONFIG.map((d) => {
          const n = data?.counts.find((c) => c.type === d.key)?.count ?? 0;
          return (
            <li
              key={d.key}
              className={cn(
                'min-w-0 rounded-xl border border-border bg-white p-3.5 shadow-soft',
                n > 0 ? 'border-red-200 bg-red-50/60' : !d.connected && 'bg-slate-50/70',
              )}
            >
              <p className="text-[13px] font-medium text-slate-600">{d.label}</p>
              <p className="mt-0.5 flex items-center gap-2">
                <span className={cn('text-2xl font-bold tabular-nums', n > 0 ? 'text-red-600' : d.connected ? 'text-slate-900' : 'text-slate-400')}>
                  {data ? n : '–'}
                </span>
                {!d.connected && <ComingSoon />}
              </p>
            </li>
          );
        })}
        <li className="min-w-0 rounded-xl border border-border bg-white p-3.5 shadow-soft">
          <p className="text-[13px] font-medium text-slate-600">Total damaged</p>
          <p className={cn('mt-0.5 text-2xl font-bold tabular-nums', data && data.total > 0 ? 'text-red-600' : 'text-slate-900')}>{data ? data.total : '–'}</p>
        </li>
      </ul>

      <section className="rounded-xl border border-border bg-white p-4 shadow-soft md:p-5" aria-labelledby="damages-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="damages-title" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Damaged takas
          </h2>
          <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 scrollbar-none" role="group" aria-label="Filter by damage type">
            {FILTERS.map((f) => (
              <button
                key={f.key ?? 'all'}
                type="button"
                onClick={() => view.setDamageType(f.key)}
                aria-pressed={type === f.key}
                className={cn(
                  'min-h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                  type === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-white text-slate-600 hover:bg-muted',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {query.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : query.isError || !data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No damaged takas" className="py-10" />
        ) : (
          <ul className={cn('grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]', query.isPlaceholderData && 'opacity-60')}>
            {data.items.map((t) => (
              <li key={t.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-red-200 bg-red-50/40 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-2xl font-bold leading-tight tabular-nums text-slate-900">
                    <span className="sr-only">Taka </span>
                    {t.takaNo}
                    <span className="ml-2 text-base font-semibold text-slate-500">
                      {[t.meters != null && formatMeters(t.meters), t.pcs != null ? formatPcs(t.pcs) : '— pcs'].filter(Boolean).join(' · ')}
                    </span>
                  </p>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                    <AlertTriangle className="size-3.5" aria-hidden />
                    {DAMAGE_TYPE_LABEL[t.damageType]}
                  </span>
                </div>
                {/* WHAT the damage is — the main fact of the card (older damage has no name). */}
                <p className={cn('truncate text-lg font-bold', t.damageName ? 'text-red-700' : 'text-slate-400')} title={t.damageName ?? undefined}>
                  {t.damageName ?? 'No damage name'}
                </p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted-foreground">Order (jobsheet)</dt>
                    <dd>
                      <Link to={`/jobsheets/${t.jobsheetId}`} className="rounded font-semibold text-primary hover:underline">
                        <JobsheetRef orderNo={t.orderNo} jobsheetNo={t.jobsheetNo} variant="short" bracketClassName="text-primary/60" />
                      </Link>
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted-foreground">Stage</dt>
                    <dd className="truncate font-medium text-slate-800" title={takaStageLabel(t.stage)}>
                      {takaStageLabel(t.stage)}
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-[12px] text-muted-foreground">Recorded</dt>
                    <dd className="font-medium text-slate-800">{formatDateTime(t.createdAt)}</dd>
                  </div>
                </dl>
                {t.note && (
                  <p className="whitespace-pre-line rounded-lg bg-white/80 px-3 py-2 text-sm text-slate-700">
                    <span className="font-semibold text-slate-500">Note: </span>
                    {t.note}
                  </p>
                )}
                {canEdit && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-auto self-start"
                    disabled={!takas.data}
                    onClick={() => editJobsheet(t.jobsheetId)}
                  >
                    <Pencil /> Edit takas
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit && <EditTakasDialog target={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
