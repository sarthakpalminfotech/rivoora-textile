import { AlertTriangle, ArrowDown, ArrowLeft, Plus, RotateCcw, SearchX, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  cleanPcs,
  cleanTakaNo,
  formatMeters,
  formatPcs,
  MAX_SPLIT_PARTS,
  nextSplitNumber,
  SPLIT_ERROR_TEXT,
  splitMeters,
  takaActualPcs,
  TAKA_NO_MAX_LENGTH,
  validateSplit,
  type GodownOrder,
  type GodownTaka,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DamageDialog, entryLabel, entryPayload, nextEntryKey, type DamageEntry } from '../takas/damage-dialog';
import { useUsedTakaNumbers } from '../takas/taka-check';
import { useGodownDamages, useGodownOrder, useSplitTaka } from './api';

interface Part {
  key: number;
  takaNo: string;
  pcs: string;
  damages: DamageEntry[];
  refinish: boolean;
}

let partKey = 0;
const newPart = (takaNo: string): Part => ({ key: ++partKey, takaNo, pcs: '', damages: [], refinish: false });

const inputClass = (invalid: boolean) =>
  cn(
    'h-12 w-full rounded-xl border bg-white px-3 text-lg font-bold tabular-nums text-slate-900 focus:outline-none focus:ring-2',
    invalid ? 'border-destructive focus:ring-destructive/20' : 'border-input focus:border-primary focus:ring-primary/15',
  );

function SplitForm({ order, taka }: { order: GodownOrder; taka: GodownTaka }) {
  const navigate = useNavigate();
  const split = useSplitTaka(taka.id);
  const actual = takaActualPcs(taka) ?? 0;
  const [parts, setParts] = useState<Part[]>(() => [newPart(taka.takaNo), newPart(nextSplitNumber(taka.takaNo, order.orderTakaNos) ?? '')]);
  const [damageFor, setDamageFor] = useState<number | null>(null);
  // The original taka's open damage names: pre-selected in the Damage popup (one) or listed first (several).
  const originalDamages = useGodownDamages(order.orderId, taka.isDamaged);
  const suggestedNames = useMemo(() => {
    const seen = new Set<number>();
    const names: { damageId: number; name: string }[] = [];
    const row = originalDamages.data?.items.find((t) => t.id === taka.id);
    for (const d of row?.damages ?? []) {
      if (d.status !== 'open' || d.damageId === null || d.damageName === null || seen.has(d.damageId)) continue;
      seen.add(d.damageId);
      names.push({ damageId: d.damageId, name: d.damageName });
    }
    return names;
  }, [originalDamages.data, taka.id]);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Live uniqueness check (numbers are unique across the whole system); the taka's own number is not "used by someone else".
  const used = useUsedTakaNumbers(
    parts.map((p) => p.takaNo),
    new Set([taka.takaNo]),
  );
  const check = validateSplit(
    parts.map((p) => ({ takaNo: p.takaNo, pcs: /^\d+$/.test(p.pcs) ? Number(p.pcs) : null })),
    actual,
    new Set(used.keys()),
  );
  // The first part keeps the original row; a renamed first part must be free too.
  const firstUsed = parts[0].takaNo.trim() !== taka.takaNo && used.has(parts[0].takaNo.trim());
  const rowError = (i: number) => (i === 0 && firstUsed ? 'already_used' : check.rows[i]);
  const numberErrors = parts.map((_, i) => rowError(i));
  const canSave = check.ok && !firstUsed;
  const meters = useMemo(
    () => splitMeters(taka.meters, parts.map((p) => (/^\d+$/.test(p.pcs) ? Number(p.pcs) : 0))),
    [taka.meters, parts],
  );

  const update = (key: number, patch: Partial<Part>) => setParts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const addPart = () =>
    setParts((prev) => {
      const next = nextSplitNumber(taka.takaNo, [...order.orderTakaNos, ...prev.map((p) => p.takaNo)]);
      return next ? [...prev, newPart(next)] : prev;
    });
  const diff = check.diff;

  const save = () => {
    setShowErrors(true);
    if (!canSave) return;
    setServerError(null);
    split.mutate(
      {
        parts: parts.map((p) => ({
          takaNo: p.takaNo.trim(),
          pcs: Number(p.pcs),
          damages: p.damages.map((e) => ({ ...entryPayload(e), images: [] })),
          refinish: p.refinish,
        })),
      },
      {
        onSuccess: (res) => {
          toast.success(`Split into ${res.parts.map((x) => x.takaNo).join(', ')}`);
          navigate(`/godown/orders/${order.orderId}`, { replace: true });
        },
        onError: (err) => setServerError(errorMessage(err)),
      },
    );
  };

  const damagePart = parts.find((p) => p.key === damageFor);

  return (
    <div className="page-container max-w-2xl space-y-4 pb-6 pt-3 md:pt-5">
      <button type="button" onClick={() => navigate(`/godown/orders/${order.orderId}`)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> Order {order.orderNo}
      </button>

      {/* 1 — the source taka */}
      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">Split taka</p>
        <h1 className="break-all text-5xl font-extrabold leading-none tracking-tight text-slate-900">{taka.takaNo}</h1>
        <p className="mt-2 text-lg font-bold tabular-nums text-slate-700">
          {formatPcs(actual)}
          {taka.meters != null && <span className="ml-2 text-base font-semibold text-slate-500">· {formatMeters(taka.meters)}</span>}
        </p>
      </section>

      {taka.isDamaged && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          This taka is marked damaged. After the split, only the parts you mark as damaged below stay damaged; the old damage is cleared.
        </p>
      )}

      {/* 2 — the arrow */}
      <div className="flex justify-center text-slate-300" aria-hidden>
        <ArrowDown className="size-7" />
      </div>

      {/* 3 — the parts */}
      <ul className="space-y-3">
        {parts.map((p, i) => {
          const numErr = p.takaNo.trim() && numberErrors[i] !== 'pcs_required' ? numberErrors[i] : null;
          const pcsErr = showErrors && check.rows[i] === 'pcs_required';
          return (
            <li key={p.key} className="rounded-2xl border border-border bg-white p-3.5 shadow-soft">
              <div className="grid grid-cols-[1fr_6.5rem] gap-3">
                <div>
                  <label htmlFor={`sp-no-${p.key}`} className="mb-1 block text-[12px] font-semibold text-slate-500">
                    {i === 0 ? 'Taka no (original)' : 'Taka no'}
                  </label>
                  <input
                    id={`sp-no-${p.key}`}
                    value={p.takaNo}
                    onChange={(e) => update(p.key, { takaNo: cleanTakaNo(e.target.value) })}
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={TAKA_NO_MAX_LENGTH}
                    aria-invalid={!!numErr || undefined}
                    className={inputClass(!!numErr)}
                  />
                </div>
                <div>
                  <label htmlFor={`sp-pcs-${p.key}`} className="mb-1 block text-[12px] font-semibold text-slate-500">
                    Pcs
                  </label>
                  <input
                    id={`sp-pcs-${p.key}`}
                    value={p.pcs}
                    onChange={(e) => update(p.key, { pcs: cleanPcs(e.target.value) })}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0"
                    aria-invalid={pcsErr || undefined}
                    className={cn(inputClass(pcsErr), 'text-center')}
                  />
                </div>
              </div>
              {numErr && (
                <p role="alert" className="mt-1.5 text-sm font-semibold text-destructive">
                  {numErr === 'already_used' ? `Taka ${p.takaNo.trim()} is already used${used.get(p.takaNo.trim()) ? ` (Order ${used.get(p.takaNo.trim())})` : ''}` : SPLIT_ERROR_TEXT[numErr]}
                </p>
              )}
              {pcsErr && (
                <p role="alert" className="mt-1.5 text-sm font-semibold text-destructive">
                  {SPLIT_ERROR_TEXT.pcs_required}
                </p>
              )}

              {(p.damages.length > 0 || p.refinish) && (
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {p.damages.map((e) => (
                    <li key={e.key} className="inline-flex items-center gap-1 rounded-full bg-red-50 py-0.5 pl-2.5 pr-1 text-[13px] font-semibold text-red-700">
                      <AlertTriangle className="size-3.5" aria-hidden />
                      {entryLabel(e)}
                      <button type="button" className="rounded-full p-1 hover:bg-red-100" aria-label="Remove damage" onClick={() => update(p.key, { damages: p.damages.filter((x) => x.key !== e.key) })}>
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                  {p.refinish && (
                    <li className="inline-flex items-center gap-1 rounded-full bg-pink-50 py-0.5 pl-2.5 pr-1 text-[13px] font-semibold text-pink-700">
                      <RotateCcw className="size-3.5" aria-hidden />
                      Refinish
                      <button type="button" className="rounded-full p-1 hover:bg-pink-100" aria-label="Remove refinish" onClick={() => update(p.key, { refinish: false })}>
                        <X className="size-3.5" />
                      </button>
                    </li>
                  )}
                </ul>
              )}

              <div className="mt-3 flex items-center gap-2">
                <Button variant="secondary" size="sm" className="h-11" onClick={() => setDamageFor(p.key)} disabled={!/^\d+$/.test(p.pcs) || Number(p.pcs) < 1}>
                  <AlertTriangle /> Damage
                </Button>
                {meters[i] != null && /^\d+$/.test(p.pcs) && Number(p.pcs) > 0 && <span className="text-xs font-medium tabular-nums text-slate-400">≈ {formatMeters(meters[i]!)}</span>}
                {i > 1 && (
                  <Button variant="ghost" size="sm" className="ml-auto h-11 text-destructive hover:bg-destructive-soft" onClick={() => setParts((prev) => prev.filter((x) => x.key !== p.key))}>
                    <Trash2 /> Remove
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Button variant="secondary" size="lg" className="h-12 w-full border-dashed" onClick={addPart} disabled={parts.length >= MAX_SPLIT_PARTS}>
        <Plus /> Add part
      </Button>

      {/* 4 — the total */}
      <p
        className={cn(
          'rounded-xl border px-4 py-3 text-center text-lg font-bold tabular-nums',
          diff === 0 ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-800',
        )}
        role="status"
      >
        Total {check.total} / {actual} pcs
        {diff !== 0 && <span className="ml-2 text-sm font-semibold">{diff > 0 ? `${diff} to add` : `${-diff} too many`}</span>}
      </p>

      {serverError && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-semibold text-red-700">
          {serverError}
        </p>
      )}

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-t-2xl md:border-x">
        <Button size="lg" className="h-14 w-full text-base" onClick={save} disabled={!canSave} loading={split.isPending}>
          Save split
        </Button>
      </div>

      <DamageDialog
        open={damagePart !== undefined}
        onOpenChange={(o) => !o && setDamageFor(null)}
        takaLabel={damagePart ? `Taka ${damagePart.takaNo || '—'}` : ''}
        suggestedNames={suggestedNames}
        takaPcs={damagePart && /^\d+$/.test(damagePart.pcs) ? Number(damagePart.pcs) : null}
        value={null}
        onConfirm={(v) => {
          const key = damageFor!;
          setParts((prev) => prev.map((p) => (p.key === key ? { ...p, damages: [...p.damages, { key: nextEntryKey(), foundAt: v.type, choice: v.choice, pcs: v.pcs }] } : p)));
        }}
        onRefinish={() => {
          const key = damageFor;
          if (key !== null) update(key, { refinish: true });
        }}
      />
    </div>
  );
}

/** `/godown/orders/:orderId/split/:takaId` — split one final taka into parts (full screen). */
export default function SplitPage() {
  const params = useParams();
  const orderId = Number(params.orderId);
  const takaId = Number(params.takaId);
  const navigate = useNavigate();
  const query = useGodownOrder(orderId);
  usePageTitle('Split taka');
  const taka = query.data?.takas.find((t) => t.id === takaId);

  if (query.isPending) {
    return (
      <div className="page-container max-w-2xl space-y-4 py-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="page-container max-w-2xl py-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (!taka || taka.stage !== 'final' || takaActualPcs(taka) === null || (takaActualPcs(taka) ?? 0) < 2) {
    return (
      <div className="page-container max-w-2xl space-y-3 py-4">
        <button type="button" onClick={() => navigate(`/godown/orders/${orderId}`)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
          <ArrowLeft className="size-4" /> Order
        </button>
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <EmptyState icon={SearchX} title="This taka can't be split" description="Only final takas with at least 2 pcs can be split." />
        </div>
      </div>
    );
  }
  return <SplitForm key={taka.id} order={query.data} taka={taka} />;
}

