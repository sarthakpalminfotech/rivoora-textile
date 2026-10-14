import { ChevronRight, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { damageLabelOf, DAMAGE_TYPE_LABEL, DEMO_STOCK_CLEARANCE, isDamageType, type DamagedTakaRow, type DamageType } from '@rivoora/shared';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { useTakaDetail } from '../takas/api';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate, formatMoney, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDamagedItem, useDamagedTakas, useMarkFresh } from './api';
import { BackLink, DAMAGE_DOT, ExpandingSearch, ItemHeader, KpiSkeleton, KpiTile, pcsText } from './parts';

function Chip({ label, count, dot, active, onClick }: { label: string; count: number; dot?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40',
        active ? 'border-primary/40 bg-primary-soft/50 font-semibold text-primary' : 'border-border bg-white font-medium text-slate-600 hover:border-slate-300',
      )}
    >
      {dot && <span className="size-2 rounded-full" style={{ backgroundColor: dot }} aria-hidden />}
      {label}
      <span className="tabular-nums text-slate-400">({count})</span>
    </button>
  );
}

/** Mark as fresh: lists the taka's open damages, then resolves all of them (Jemish, Gaurang). */
function MarkFreshDialog({ taka, onClose }: { taka: DamagedTakaRow | null; onClose: () => void }) {
  const detail = useTakaDetail(taka?.id ?? 0);
  const mark = useMarkFresh();
  const open = detail.data?.damages.filter((d) => d.status === 'open') ?? [];
  return (
    <ConfirmDialog
      open={taka !== null}
      onOpenChange={(o) => !o && onClose()}
      title={taka ? `Mark taka ${taka.takaNo} as fresh?` : 'Mark as fresh'}
      confirmLabel="Mark as fresh"
      loading={mark.isPending}
      onConfirm={() =>
        taka &&
        mark.mutate(taka.id, {
          onSuccess: () => {
            toast.success(`Taka ${taka.takaNo} marked fresh`);
            onClose();
          },
          onError: (err) => toast.error(errorMessage(err)),
        })
      }
      description={
        <div className="space-y-2">
          <p>These open damages will be resolved:</p>
          {detail.isPending ? (
            <Skeleton className="h-10 rounded-lg" />
          ) : (
            <ul className="space-y-1">
              {(open.length ? open : []).map((d) => (
                <li key={d.id} className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700">
                  {damageLabelOf(d)}
                </li>
              ))}
              {open.length === 0 && taka && <li className="text-sm text-slate-500">{taka.names.join(', ') || 'No open damage'}</li>}
            </ul>
          )}
        </div>
      }
    />
  );
}

function TakaRow({ taka, from, onFresh }: { taka: DamagedTakaRow; from: string; onFresh?: (t: DamagedTakaRow) => void }) {
  return (
    <li className="flex items-center">
      <Link
        to={`/orders/${taka.orderId}/takas/${taka.id}/damages`}
        state={{ from }}
        className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 px-4 py-2.5 outline-none transition hover:bg-slate-50 focus-visible:bg-slate-50"
        aria-label={`Taka ${taka.takaNo}, order ${formatOrderNo(taka.orderNo)}`}
      >
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-[17px] font-bold tabular-nums leading-tight text-slate-900">
            {taka.takaNo}
            {taka.isRefinish && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">Refinish</span>}
          </p>
          <p className="text-[13px] text-slate-500">
            Order {formatOrderNo(taka.orderNo)} · {formatDate(taka.recordedAt)}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1" aria-label={taka.types.map((t) => DAMAGE_TYPE_LABEL[t]).join(', ')}>
          {taka.types.map((t) => (
            <span key={t} className="size-2 rounded-full" style={{ backgroundColor: DAMAGE_DOT[t] }} title={DAMAGE_TYPE_LABEL[t]} />
          ))}
        </span>
        <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden />
      </Link>
      {onFresh && (
        <Button variant="secondary" size="sm" className="mr-3 shrink-0" onClick={() => onFresh(taka)}>
          Mark as fresh
        </Button>
      )}
    </li>
  );
}

/** A quiet card with ONE demo entry until the stock wipe-out flow exists (values in `DEMO_STOCK_CLEARANCE`). */
function LastClearance() {
  const d = DEMO_STOCK_CLEARANCE;
  return (
    <section className="rounded-xl border border-border bg-slate-50/60 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-slate-600">Last stock clearance</h2>
        <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">Demo</span>
      </div>
      <p className="mt-1.5 text-sm tabular-nums text-slate-600">
        Sold on {formatDate(d.date)} · {pcsText(d.pcs)} pcs · to {d.party} · {formatMoney(d.ratePerPcs).replace(/\.00$/, '')} / pc
      </p>
    </section>
  );
}

/** Inventory → Damaged item details: damaged + refinish pcs, filters by damage type, the taka list, last clearance (demo). */
export default function DamagedDetailsPage() {
  const { key = '' } = useParams<{ key: string }>();
  const { can } = useRole();
  const [fresh, setFresh] = useState<DamagedTakaRow | null>(null);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const rawType = params.get('type');
  const type: DamageType | null = isDamageType(rawType) ? rawType : null;
  const refinish = params.get('refinish') === '1';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounce(search, 300).trim();

  const patch = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) patch({ q: debounced || null });
    // only react to the debounced text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const item = useDamagedItem(key);
  const takas = useDamagedTakas(key, type, refinish, debounced);
  usePageTitle(item.data?.code ? `${item.data.code} · Damaged` : 'Damaged stock');
  const from = `${location.pathname}${location.search}`;
  const back = '/inventory?section=damaged';

  const data = item.data;
  const visibleTypes = data?.typeCounts.filter((t) => t.count > 0) ?? [];
  const allActive = !type && !refinish;

  return (
    <div className="page-container space-y-4 pb-28 pt-2 md:py-4">
      <BackLink fallback={back} />

      {item.isError ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <ErrorState error={item.error} onRetry={() => void item.refetch()} />
        </div>
      ) : (
        <>
          {data ? <ItemHeader item={data} /> : <Skeleton className="h-28 rounded-2xl" />}
          <div className="grid grid-cols-2 gap-2.5 md:max-w-xl">
            {data ? (
              <>
                <KpiTile label="Total damaged pcs" value={pcsText(data.damaged)} dot="#EF4444" tone={data.damaged > 0 ? 'danger' : undefined} />
                <KpiTile
                  label="In refinish"
                  value={pcsText(data.inRefinish)}
                  dot="#F59E0B"
                  active={refinish}
                  onClick={data.refinishTakas > 0 ? () => patch({ refinish: refinish ? null : '1', type: null }) : undefined}
                />
              </>
            ) : (
              <KpiSkeleton count={2} />
            )}
          </div>

          <section className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
              <h2 className={cn('text-[15px] font-semibold text-slate-900', search && 'hidden sm:block')}>
                Takas {takas.data && <span className="font-medium text-slate-400">· {takas.data.length}</span>}
              </h2>
              <ExpandingSearch value={search} onChange={setSearch} placeholder="Search taka, order or damage…" className={search ? 'flex-1 sm:flex-none' : undefined} />
            </div>

            {data && (visibleTypes.length > 0 || data.refinishTakas > 0) && (
              <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2.5" role="group" aria-label="Filter by damage type">
                <Chip label="All" count={data.totalTakas} active={allActive} onClick={() => patch({ type: null, refinish: null })} />
                {visibleTypes.map((t) => (
                  <Chip
                    key={t.type}
                    label={DAMAGE_TYPE_LABEL[t.type]}
                    count={t.count}
                    dot={DAMAGE_DOT[t.type]}
                    active={type === t.type}
                    // Tapping the active chip again goes back to All.
                    onClick={() => patch({ type: type === t.type ? null : t.type, refinish: null })}
                  />
                ))}
              </div>
            )}

            {takas.isPending ? (
              <div className="space-y-px p-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            ) : takas.isError ? (
              <ErrorState error={takas.error} onRetry={() => void takas.refetch()} />
            ) : takas.data.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title={debounced || type || refinish ? 'No takas match' : 'No damaged takas'}
                description={debounced || type || refinish ? 'Try another filter or search.' : 'Nothing is damaged or in refinish for this design.'}
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-border">
                {takas.data.map((t) => (
                  <TakaRow key={t.id} taka={t} from={from} onFresh={can('canMarkFresh') && t.names.length > 0 ? setFresh : undefined} />
                ))}
              </ul>
            )}
          </section>

          <LastClearance />
          {can('canMarkFresh') && <MarkFreshDialog taka={fresh} onClose={() => setFresh(null)} />}
        </>
      )}
    </div>
  );
}
