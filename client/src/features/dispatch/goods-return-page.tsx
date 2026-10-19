import { ArrowLeft, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cleanPcs, GR_ERROR_TEXT, validatePcsGr, type DispatchChallanDetail, type GoodsReturnInput } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { ApiError, errorMessage } from '@/lib/api';
import { formatOrderNo, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DamageDialog, entryLabel, grEntryPayload, nextEntryKey, type DamageEntry } from '../takas/damage-dialog';
import { useDispatchChallan, useGoodsReturn } from './api';

/** Where the damage popup was opened from: a lump taka, or the one damage of a pcs-to-pcs return. */
type DamageTarget = { type: 'taka'; takaId: number; takaNo: string; pcs: number | null } | { type: 'pcs' } | null;

function TakaDamageChips({ entries, onRemove }: { entries: DamageEntry[]; onRemove: (key: number) => void }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {entries.map((e) => (
        <li key={e.key} className="inline-flex items-center gap-1 rounded-full bg-red-50 py-0.5 pl-2.5 pr-1 text-[12px] font-semibold text-red-700">
          {entryLabel(e)}
          {e.images && e.images.length > 0 && <span className="text-red-400">· {e.images.length} 📷</span>}
          <button type="button" onClick={() => onRemove(e.key)} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-red-100" aria-label="Remove damage">
            <X className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Form({ challan }: { challan: DispatchChallanDetail }) {
  const navigate = useNavigate();
  const save = useGoodsReturn(challan.id);
  const lump = challan.order.orderType === 'lump';
  const [returned, setReturned] = useState<Set<number>>(new Set());
  const [damages, setDamages] = useState<Record<number, DamageEntry[]>>({});
  const [returnedPcs, setReturnedPcs] = useState('');
  const [damagedPcs, setDamagedPcs] = useState('0');
  const [pcsDamage, setPcsDamage] = useState<DamageEntry | null>(null);
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<DamageTarget>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const challanPcs = challan.totals.pcs;
  const rp = returnedPcs === '' ? 0 : Number(returnedPcs);
  const dp = damagedPcs === '' ? 0 : Number(damagedPcs);
  const pcsError = useMemo(() => {
    if (lump || (returnedPcs === '' && damagedPcs === '0')) return null;
    const e = validatePcsGr({ challanPcs, returnedPcs: rp, damagedPcs: dp, hasDamageName: dp === 0 || pcsDamage !== null });
    return e === 'damage_missing' ? null : e; // the damage name is asked for in the confirm step button state
  }, [lump, returnedPcs, damagedPcs, challanPcs, rp, dp, pcsDamage]);

  const lumpDamagedPcs = [...returned].reduce((n, id) => n + (damages[id] ?? []).reduce((m, e) => m + (e.pcs ?? 0), 0), 0);
  const lumpReturnedPcs = challan.takas.filter((t) => returned.has(t.takaId)).reduce((n, t) => n + (t.pcs ?? 0), 0);

  const toggle = (takaId: number, on: boolean) => {
    setReturned((prev) => {
      const next = new Set(prev);
      if (on) next.add(takaId);
      else next.delete(takaId);
      return next;
    });
    if (!on) setDamages((d) => ({ ...d, [takaId]: [] }));
  };

  const needDamage = !lump && dp > 0 && pcsDamage === null;
  const canContinue = lump ? returned.size > 0 : returnedPcs !== '' && !pcsError && !needDamage && rp >= 1;

  const body = (): GoodsReturnInput =>
    lump
      ? { returns: [...returned].map((takaId) => ({ takaId, damages: (damages[takaId] ?? []).map(grEntryPayload) })), date, note }
      : { returnedPcs: rp, damagedPcs: dp, ...(dp > 0 && pcsDamage ? { damage: grEntryPayload(pcsDamage) } : {}), date, note };

  const submit = () => {
    setError(null);
    save.mutate(body(), {
      onSuccess: (res) => {
        setConfirmOpen(false);
        toast.success(`${res.label} created`);
        navigate(`/dispatched/${challan.order.orderId}`, { replace: true });
      },
      onError: (err) => {
        setConfirmOpen(false);
        setError(errorMessage(err));
        toast.error(errorMessage(err));
      },
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <section className="rounded-xl border border-border bg-white p-4 shadow-soft">
        <p className="text-sm text-slate-500">
          Order {formatOrderNo(challan.order.orderNo)} · {challan.customer.name}
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Goods return · {challan.label}</h1>
        <p className="mt-0.5 text-sm tabular-nums text-slate-500">
          {challan.totals.takas} {challan.totals.takas === 1 ? 'taka' : 'takas'} · {challanPcs.toLocaleString('en-IN')} pcs on the challan
        </p>
      </section>

      {lump ? (
        <section className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
          <h2 className="border-b border-border bg-slate-50 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Tick the returned takas</h2>
          <ul className="divide-y divide-border">
            {challan.takas.map((t) => {
              const on = returned.has(t.takaId);
              const entries = damages[t.takaId] ?? [];
              return (
                <li key={t.takaId} className={cn('px-4 py-3', on && 'bg-sky-50/50')}>
                  <div className="flex items-center gap-3">
                    <TickBox size="lg" checked={on} onCheckedChange={(c) => toggle(t.takaId, c)} aria-label={`Taka ${t.takaNo} returned`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xl font-bold tabular-nums text-slate-900">{t.takaNo}</p>
                      <p className="text-xs tabular-nums text-slate-500">
                        {t.meters != null ? `${t.meters.toFixed(2)} m · ` : ''}
                        {t.pcs ?? '—'} pcs
                      </p>
                    </div>
                    {on && (
                      <Button variant="secondary" className="h-11" onClick={() => setTarget({ type: 'taka', takaId: t.takaId, takaNo: t.takaNo, pcs: t.pcs })}>
                        <TriangleAlert className="text-red-600" /> Damaged
                      </Button>
                    )}
                  </div>
                  {entries.length > 0 && <TakaDamageChips entries={entries} onRemove={(key) => setDamages((d) => ({ ...d, [t.takaId]: (d[t.takaId] ?? []).filter((e) => e.key !== key) }))} />}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="space-y-4 rounded-xl border border-border bg-white p-4 shadow-soft">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Returned pcs" htmlFor="gr-returned" required hint={`1 to ${challanPcs.toLocaleString('en-IN')}`} error={pcsError === 'returned_range' ? GR_ERROR_TEXT.returned_range : undefined}>
              <Input id="gr-returned" inputMode="numeric" autoComplete="off" value={returnedPcs} onChange={(e) => setReturnedPcs(cleanPcs(e.target.value))} invalid={pcsError === 'returned_range'} className="tabular-nums" />
            </Field>
            <Field label="Damaged pcs" htmlFor="gr-damaged" hint="0 up to the returned pcs" error={pcsError === 'damaged_range' ? GR_ERROR_TEXT.damaged_range : undefined}>
              <Input
                id="gr-damaged"
                inputMode="numeric"
                autoComplete="off"
                value={damagedPcs}
                onChange={(e) => {
                  setDamagedPcs(cleanPcs(e.target.value));
                  if (Number(e.target.value) === 0) setPcsDamage(null);
                }}
                invalid={pcsError === 'damaged_range'}
                className="tabular-nums"
              />
            </Field>
          </div>
          {dp > 0 && !pcsError && (
            <div>
              <Button variant={pcsDamage ? 'secondary' : 'primary'} className="h-11" onClick={() => setTarget({ type: 'pcs' })}>
                <TriangleAlert /> {pcsDamage ? 'Change damage' : 'Pick the damage name'}
              </Button>
              {pcsDamage && <TakaDamageChips entries={[pcsDamage]} onRemove={() => setPcsDamage(null)} />}
            </div>
          )}
        </section>
      )}

      <section className="grid gap-4 rounded-xl border border-border bg-white p-4 shadow-soft sm:grid-cols-2">
        <Field label="GR date" htmlFor="gr-date" required>
          <DatePicker id="gr-date" value={date} onChange={setDate} />
        </Field>
        <Field label="Note" htmlFor="gr-note" className="sm:col-span-2">
          <Textarea id="gr-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
        </Field>
      </section>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-t-2xl lg:border-x">
        <Button size="lg" className="h-14 w-full text-base" disabled={!canContinue || !date} onClick={() => setConfirmOpen(true)}>
          Review goods return
        </Button>
      </div>

      <DamageDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        takaLabel={target?.type === 'taka' ? `Taka ${target.takaNo}` : `${challan.label} return`}
        typeOptional
        takaPcs={target?.type === 'taka' ? target.pcs : dp > 0 ? dp : null}
        value={null}
        allowImages
        onConfirm={(v) => {
          const entry: DamageEntry = { key: nextEntryKey(), foundAt: v.type, choice: v.choice, pcs: target?.type === 'pcs' ? dp : v.pcs, images: v.images };
          if (target?.type === 'taka') setDamages((d) => ({ ...d, [target.takaId]: [...(d[target.takaId] ?? []), entry] }));
          else setPcsDamage(entry);
        }}
      />

      <ResponsiveModal
        open={confirmOpen}
        onOpenChange={(o) => !save.isPending && setConfirmOpen(o)}
        title={`Confirm goods return on ${challan.label}`}
        desktopVariant="center"
        mobileVariant="bottom"
        size="md"
        dismissible={!save.isPending}
        footer={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" size="lg" className="h-12" onClick={() => setConfirmOpen(false)} disabled={save.isPending}>
              Back
            </Button>
            <Button size="lg" className="h-12" onClick={submit} loading={save.isPending}>
              Save goods return
            </Button>
          </div>
        }
      >
        <div className="space-y-3 pb-1">
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
            <div>
              <dt className="text-[12px] text-muted-foreground">{lump ? 'Takas' : 'Lot'}</dt>
              <dd className="text-2xl font-bold tabular-nums text-slate-900">{lump ? returned.size : 1}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted-foreground">Returned pcs</dt>
              <dd className="text-2xl font-bold tabular-nums text-slate-900">{lump ? lumpReturnedPcs : rp}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted-foreground">Damaged pcs</dt>
              <dd className={cn('text-2xl font-bold tabular-nums', (lump ? lumpDamagedPcs : dp) > 0 ? 'text-red-600' : 'text-slate-900')}>{lump ? lumpDamagedPcs : dp}</dd>
            </div>
          </dl>
          <p className="text-sm text-slate-600">
            A new revision <span className="font-semibold">{challan.label} R{challan.revision + 1}</span> is created without the returned goods, and the returned goods go back into the godown.
          </p>
        </div>
      </ResponsiveModal>
    </div>
  );
}

/** `/dispatched/:orderId/challans/:challanId/gr` — goods return form (lump: tick takas; pcs to pcs: returned / damaged pcs). */
export default function GoodsReturnPage() {
  const { orderId, challanId } = useParams();
  const navigate = useNavigate();
  const query = useDispatchChallan(Number(challanId));
  usePageTitle(query.data ? `GR · ${query.data.label}` : 'Goods return');
  const challan = query.data;

  return (
    <div className="page-container space-y-4 pb-6 pt-3 md:pt-5">
      <button type="button" onClick={() => navigate(`/dispatched/${orderId}`)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> Dispatch challans
      </button>
      {query.isPending ? (
        <Skeleton className="mx-auto h-64 max-w-3xl rounded-xl" />
      ) : query.isError || !challan ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <ErrorState error={query.error instanceof ApiError ? query.error : query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : challan.status !== 'active' ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-border bg-white p-6 text-center shadow-soft">
          <p className="font-semibold text-slate-900">{challan.label} was already revised</p>
          <p className="mt-1 text-sm text-slate-500">Open the latest revision to return goods.</p>
        </div>
      ) : (
        <Form challan={challan} />
      )}
    </div>
  );
}
