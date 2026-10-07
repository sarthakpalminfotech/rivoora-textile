import { ArrowLeft, Check, CheckCircle2, Loader2, MoreHorizontal, Scissors, SearchX, TriangleAlert, Truck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  actualVsExpectedLine,
  checkedPcsBar,
  cleanPcs,
  formatMeters,
  formatPcsDiff,
  takaActualPcs,
  type GodownOrder,
  type GodownTaka,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { ResponsiveModal } from '@/components/ui/modal';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { ApiError, errorMessage } from '@/lib/api';
import { formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DamageDialog } from '../takas/damage-dialog';
import { entryPayload, nextEntryKey } from '../takas/damage-dialog';
import { useGodownDamages, useGodownOrder, useGodownRefinish, useMarkGodownDamage, usePatchGodownTaka, useReadyDispatch, useResolveGodownDamage } from './api';
import { GodownDamagesTab } from './godown-damages-tab';

type Tab = 'takas' | 'damage';

/* ------------------------------------------------------------------ */
/* header                                                               */
/* ------------------------------------------------------------------ */

function Header({ order }: { order: GodownOrder }) {
  return (
    <section className="flex items-center gap-4 rounded-2xl border border-border bg-white p-4 shadow-soft">
      <ImageThumb
        thumbUrl={order.thumbUrl}
        fullUrl={order.imageUrl}
        alt={order.designCode ? `Design ${order.designCode}` : 'No design'}
        className="size-20 shrink-0 md:size-24"
        rounded="rounded-xl"
      />
      <div className="min-w-0">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900">Order {formatOrderNo(order.orderNo)}</h1>
        <p className="truncate text-[15px] font-semibold text-slate-600">
          {order.designCode ? `Design ${order.designCode}` : 'No design'}
          {order.quality && <span className="font-medium text-slate-500"> · {order.quality}</span>}
        </p>
        <p className="text-sm font-medium tabular-nums text-slate-500">{order.orderedPcs.toLocaleString('en-IN')} pcs ordered</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* KPIs + pcs bar                                                       */
/* ------------------------------------------------------------------ */

function Kpi({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <li className={cn('min-w-0 rounded-xl border border-border bg-white px-3.5 py-3 shadow-soft', className)}>
      <p className="text-[12px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums leading-tight text-slate-900">{children}</p>
    </li>
  );
}

function Summary({ order }: { order: GodownOrder }) {
  const k = order.kpis;
  const p = order.pcsKpis;
  const bar = checkedPcsBar(k.checkedPcs, order.orderedPcs);
  const line = actualVsExpectedLine(k.actualPcs, k.expectedPcs);
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Cleared by Mill QC">
          {k.cleared} <span className="text-slate-400">/ {k.total}</span> <span className="text-sm font-semibold text-slate-500">takas</span>
        </Kpi>
        <Kpi label="Checked">
          {k.checkedTakas} <span className="text-sm font-semibold text-slate-500">{k.checkedTakas === 1 ? 'taka' : 'takas'} · {k.checkedPcs.toLocaleString('en-IN')} pcs</span>
        </Kpi>
        <Kpi label="Ready for dispatch">
          {p.readyDispatchPcs.toLocaleString('en-IN')} <span className="text-sm font-semibold text-slate-500">pcs</span>
        </Kpi>
        <Kpi label="In refinish">
          {p.refinishPcs.toLocaleString('en-IN')} <span className="text-sm font-semibold text-slate-500">pcs · {p.refinishTakas} {p.refinishTakas === 1 ? 'taka' : 'takas'}</span>
        </Kpi>
        <Kpi label="Damaged" className="col-span-2 sm:col-span-1">
          <span className={p.damagedPcs > 0 ? 'text-red-600' : undefined}>{p.damagedPcs.toLocaleString('en-IN')}</span> <span className="text-sm font-semibold text-slate-500">pcs</span>
        </Kpi>
      </ul>
      <div className="rounded-xl border border-border bg-white px-4 py-3 shadow-soft">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold tabular-nums text-slate-800">{bar.text}</p>
          {bar.over && <span className="text-xs font-semibold text-amber-700">more than ordered</span>}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bar.fillPercent)} aria-label={bar.text}>
          <div className={cn('h-full rounded-full transition-all duration-300', bar.over ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${bar.fillPercent}%` }} />
        </div>
        <p className={cn('mt-2 text-[13px] tabular-nums', line.differs ? 'font-semibold text-amber-700' : 'text-slate-500')}>{line.text}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* taka row                                                             */
/* ------------------------------------------------------------------ */

function TakaRow({
  taka,
  disabled,
  onPatch,
  onSplit,
  onDamage,
  onRefinish,
  onResolve,
}: {
  taka: GodownTaka;
  disabled?: boolean;
  onPatch: (patch: { checked?: boolean; actualPcs?: number }) => Promise<unknown>;
  onSplit: () => void;
  onDamage: () => void;
  onRefinish: () => void;
  onResolve: () => void;
}) {
  const actual = takaActualPcs(taka);
  const [text, setText] = useState(actual != null ? String(actual) : '');
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Follow the server value (after a split, a refresh, or a failed save).
  useEffect(() => {
    setText(actual != null ? String(actual) : '');
  }, [actual]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = async () => {
    const n = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!Number.isFinite(n) || n < 1) {
      setText(actual != null ? String(actual) : '');
      return;
    }
    if (n === actual) return;
    try {
      await onPatch({ actualPcs: n });
      setSaved(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 1600);
    } catch {
      setText(actual != null ? String(actual) : '');
    }
  };

  const typed = /^\d+$/.test(text) ? Number(text) : actual;
  const diff = taka.pcs != null && typed != null ? typed - taka.pcs : 0;

  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 md:flex-nowrap', disabled && 'bg-slate-50/70')}>
      <div className="flex min-w-0 flex-1 items-center gap-3 md:basis-1/3">
        <TickBox
          size="lg"
          checked={taka.checked || taka.stage === 'ready_dispatch'}
          disabled={disabled}
          onCheckedChange={(c) => void onPatch({ checked: c }).catch(() => undefined)}
          aria-label={`I have checked taka ${taka.takaNo} and it's okay`}
          className="before:absolute before:-inset-2.5 before:content-[''] relative"
        />
        <div className="min-w-0">
          <p className={cn('flex flex-wrap items-center gap-x-2 text-xl font-bold tabular-nums', disabled ? 'text-slate-500' : 'text-slate-900')}>
            {taka.takaNo}
            {taka.isDamaged && (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-red-600 text-[11px] font-extrabold leading-none text-white" title="Open damage" aria-label="Open damage">
                D
              </span>
            )}
          </p>
          {(taka.parentTakaNo || taka.refinishCount > 0 || taka.meters != null) && (
            <p className="text-xs font-medium text-slate-400">
              {taka.parentTakaNo && <span>from {taka.parentTakaNo}</span>}
              {taka.parentTakaNo && (taka.refinishCount > 0 || taka.meters != null) && ' · '}
              {taka.refinishCount > 0 && <span>refinished ×{taka.refinishCount}</span>}
              {taka.refinishCount > 0 && taka.meters != null && ' · '}
              {taka.meters != null && <span>{formatMeters(taka.meters)}</span>}
            </p>
          )}
        </div>
      </div>

      <div className="flex w-full items-center justify-between gap-3 pl-10 md:w-auto md:flex-1 md:justify-end md:pl-0">
        <div className="text-center md:w-24">
          <p className="text-[11px] font-medium text-slate-400 md:hidden">Expected</p>
          <p className="text-lg font-semibold tabular-nums text-slate-600">{taka.pcs ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2 md:w-[16.5rem]">
          <div className="relative">
            <p className="text-[11px] font-medium text-slate-400 md:hidden">Actual</p>
            <input
              value={text}
              onChange={(e) => setText(cleanPcs(e.target.value))}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              inputMode="numeric"
              autoComplete="off"
              disabled={disabled}
              aria-label={`Actual pcs of taka ${taka.takaNo}`}
              className="h-12 w-24 rounded-xl border border-input bg-white px-3 text-center text-lg font-bold tabular-nums text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:bg-transparent disabled:text-slate-500"
            />
            
          </div>
          {saved && diff === 0 && <Check className="size-4 text-emerald-600" aria-label="Saved" />}
          {diff !== 0 && <span className="w-9 text-sm font-bold tabular-nums text-amber-600">{formatPcsDiff(diff)}</span>}
          {diff !== 0 && !disabled && (typed ?? 0) >= 2 && (
            <Button variant="secondary" size="sm" className="h-12 px-3.5" onClick={onSplit}>
              <Scissors /> Split
            </Button>
          )}
        </div>
        {!disabled ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-12 shrink-0" aria-label={`More actions for taka ${taka.takaNo}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(typed ?? 0) >= 2 && (
                <DropdownMenuItem onSelect={onSplit}>
                  <Scissors className="size-4 text-slate-600" /> Split
                </DropdownMenuItem>
              )}
              {taka.isDamaged && (
                <DropdownMenuItem onSelect={onResolve}>
                  <CheckCircle2 className="size-4 text-green-600" /> Mark resolved
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onDamage}>
                <TriangleAlert className="size-4 text-red-600" /> Mark damage
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRefinish}>
                <Scissors className="size-4 text-pink-600" /> Send to refinish
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800">
            <CheckCircle2 className="size-3.5" aria-hidden /> Ready for dispatch
          </span>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Final takas tab                                                      */
/* ------------------------------------------------------------------ */

function FinalTakasTab({ order }: { order: GodownOrder }) {
  const navigate = useNavigate();
  const patch = usePatchGodownTaka(order.orderId);
  const dispatch = useReadyDispatch(order.orderId);
  const markDamage = useMarkGodownDamage();
  const refinish = useGodownRefinish();
  const resolve = useResolveGodownDamage();
  const [resolveFor, setResolveFor] = useState<GodownTaka | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [damageFor, setDamageFor] = useState<GodownTaka | null>(null);
  const [refinishFor, setRefinishFor] = useState<GodownTaka | null>(null);

  const finals = order.takas.filter((t) => t.stage === 'final');
  const ready = order.takas.filter((t) => t.stage === 'ready_dispatch');
  const k = order.kpis;

  const onPatch = (id: number) => (body: { checked?: boolean; actualPcs?: number }) => patch.mutateAsync({ id, ...body });

  const confirmDispatch = () => {
    const ids = finals.filter((t) => t.checked).map((t) => t.id);
    dispatch.mutate(ids, {
      onSuccess: (res) => {
        setDispatchOpen(false);
        toast.success(`${res.confirmed} ${res.confirmed === 1 ? 'taka' : 'takas'} · ${res.pcs.toLocaleString('en-IN')} pcs are ready to dispatch`);
      },
      onError: (err) => {
        setDispatchOpen(false);
        toast.error(errorMessage(err));
      },
    });
  };

  return (
    <div className="space-y-4">
      <Summary order={order} />

      {finals.length === 0 && ready.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={CheckCircle2} title="No final takas yet" description="Takas appear here after they pass the Mill QC." className="py-10" />
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
          <div className="hidden items-center gap-3 border-b border-border bg-slate-50 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500 md:flex">
            <span className="basis-1/3">Taka</span>
            <span className="flex flex-1 items-center justify-end gap-3">
              <span className="w-24 text-center">Expected pcs</span>
              <span className="w-[16.5rem] text-left">Actual pcs</span>
              <span className="w-12" />
            </span>
          </div>
          {finals.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">All final takas are ready to dispatch.</p>
          ) : (
            <ul className="divide-y divide-border">
              {finals.map((t) => (
                <TakaRow
                  key={t.id}
                  taka={t}
                  onPatch={onPatch(t.id)}
                  onSplit={() => navigate(`/godown/orders/${order.orderId}/split/${t.id}`)}
                  onDamage={() => setDamageFor(t)}
                  onRefinish={() => setRefinishFor(t)}
                  onResolve={() => setResolveFor(t)}
                />
              ))}
            </ul>
          )}
          {ready.length > 0 && (
            <>
              <p className="border-y border-border bg-slate-50 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Ready for dispatch ({ready.length})</p>
              <ul className="divide-y divide-border">
                {ready.map((t) => (
                  <TakaRow key={t.id} taka={t} disabled onPatch={async () => undefined} onSplit={() => undefined} onDamage={() => undefined} onRefinish={() => undefined} onResolve={() => undefined} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* Sticky action: above the phone bottom nav, at the bottom of the window on md+. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-t-2xl md:border-x">
        <Button size="lg" className="h-14 w-full text-base" disabled={k.readyCount === 0} onClick={() => setDispatchOpen(true)}>
          <Truck /> Ready to dispatch ({k.readyCount})
        </Button>
      </div>

      <ResponsiveModal
        open={dispatchOpen}
        onOpenChange={(o) => !dispatch.isPending && setDispatchOpen(o)}
        title="Ready to dispatch?"
        desktopVariant="center"
        mobileVariant="bottom"
        size="md"
        dismissible={!dispatch.isPending}
        footer={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" size="lg" className="h-12" onClick={() => setDispatchOpen(false)} disabled={dispatch.isPending}>
              Cancel
            </Button>
            <Button size="lg" className="h-12" onClick={confirmDispatch} loading={dispatch.isPending}>
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-3 pb-1">
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-center">
            <div>
              <dt className="text-[12px] text-muted-foreground">Total takas</dt>
              <dd className="text-3xl font-bold tabular-nums text-slate-900">{k.readyCount}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted-foreground">Total pcs</dt>
              <dd className="text-3xl font-bold tabular-nums text-slate-900">{k.readyPcs.toLocaleString('en-IN')}</dd>
            </div>
          </dl>
          {k.uncheckedCount > 0 && (
            <p className="text-sm text-slate-500">
              {k.uncheckedCount} unchecked {k.uncheckedCount === 1 ? 'taka stays' : 'takas stay'} in the godown.
            </p>
          )}
        </div>
      </ResponsiveModal>

      <DamageDialog
        open={damageFor !== null}
        onOpenChange={(o) => !o && setDamageFor(null)}
        takaLabel={damageFor ? `Taka ${damageFor.takaNo}` : ''}
        foundAt="godown"
        takaPcs={damageFor ? takaActualPcs(damageFor) : null}
        value={null}
        onConfirm={(v) => {
          const id = damageFor!.id;
          markDamage.mutate(
            { id, damage: { ...entryPayload({ key: nextEntryKey(), foundAt: 'godown', choice: v.choice, pcs: v.pcs }), images: [] } },
            {
              onSuccess: () => toast.success('Damage marked'),
              onError: (err) => toast.error(errorMessage(err)),
            },
          );
        }}
      />

      <ConfirmDialog
        open={resolveFor !== null}
        onOpenChange={(o) => !o && setResolveFor(null)}
        title={resolveFor ? `Mark taka ${resolveFor.takaNo} resolved?` : 'Mark resolved?'}
        description="All open damage on this taka is marked resolved and the taka becomes fresh."
        confirmLabel="Mark resolved"
        loading={resolve.isPending}
        onConfirm={() =>
          resolve.mutate(
            { id: resolveFor!.id },
            {
              onSuccess: () => {
                setResolveFor(null);
                toast.success('Marked resolved');
              },
              onError: (err) => {
                setResolveFor(null);
                toast.error(errorMessage(err));
              },
            },
          )
        }
      />

      <ConfirmDialog
        open={refinishFor !== null}
        onOpenChange={(o) => !o && setRefinishFor(null)}
        title={refinishFor ? `Send taka ${refinishFor.takaNo} to refinish?` : 'Send to refinish?'}
        description="It leaves the final takas and waits to go back to the mill."
        confirmLabel="Send to refinish"
        loading={refinish.isPending}
        onConfirm={() =>
          refinish.mutate(
            { id: refinishFor!.id },
            {
              onSuccess: () => {
                setRefinishFor(null);
                toast.success('Sent to refinish');
              },
              onError: (err) => {
                setRefinishFor(null);
                toast.error(errorMessage(err));
              },
            },
          )
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                 */
/* ------------------------------------------------------------------ */

/** `/godown/orders/:orderId` — header, then Final takas | Damage. */
export default function GodownOrderPage() {
  const orderId = Number(useParams().orderId);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'damage' ? 'damage' : 'takas';
  const query = useGodownOrder(orderId);
  const damages = useGodownDamages(orderId);
  usePageTitle(query.data ? `Order ${formatOrderNo(query.data.orderNo)}` : 'Order');
  const damageCount = damages.data?.total;

  const options = useMemo(
    () => [
      { value: 'takas' as const, label: 'Final takas' },
      {
        value: 'damage' as const,
        label: (
          <>
            Damage
            {damageCount ? <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-red-100 px-1.5 text-xs font-bold tabular-nums text-red-700">{damageCount}</span> : null}
          </>
        ),
      },
    ],
    [damageCount],
  );

  return (
    <div className="page-container space-y-4 pb-6 pt-3 md:pt-5">
      <button type="button" onClick={() => navigate('/godown/orders')} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> Orders
      </button>
      {query.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : query.isError || !query.data ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {query.error instanceof ApiError && query.error.status === 404 ? (
            <EmptyState icon={SearchX} title="Order not found" />
          ) : (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          )}
        </div>
      ) : (
        <>
          <Header order={query.data} />
          <Segmented
            options={options}
            value={tab}
            onChange={(t) =>
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  if (t === 'takas') next.delete('tab');
                  else next.set('tab', t);
                  return next;
                },
                { replace: true },
              )
            }
            size="lg"
            aria-label="Order sections"
            className="w-full md:max-w-md"
          />
          {tab === 'takas' ? <FinalTakasTab order={query.data} /> : <GodownDamagesTab orderId={orderId} />}
        </>
      )}
      {query.isFetching && !query.isPending && (
        <span className="sr-only" aria-live="polite">
          <Loader2 className="size-3 animate-spin" /> Updating
        </span>
      )}
    </div>
  );
}
