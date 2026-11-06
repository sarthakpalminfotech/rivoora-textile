import { CheckCircle2, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BLOUSE_LABEL, BLOUSE_OPTIONS, dualText, lineDamageError, lineDamagedQty, returnOrganised, type BlouseOption, type PartyReturnDetail } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Input } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BackLink } from '../inventory/parts';
import { useCompletePartyReturn, usePartyReturn, useSavePartyReturnLines, useUpdatePartyReturn } from './api';
import { emptyReturnHeader, headerErrors, headerOf, headerPayload, ReturnHeaderForm, type ReturnHeaderValue } from './goods-return-form-page';
import { damageRowPayload, DamageRowFields, emptyDamageRow, QualityDesignFields, type DamageRowDraft } from './parts';

interface LineDraft {
  key: number;
  takaId: number | null;
  takaNo: string | null;
  fixedLabel: string | null;
  materialId: number | null;
  designId: number | null;
  qty: string;
  blouse: BlouseOption | null;
  damages: DamageRowDraft[];
}
let lineKey = 0;
const blankLine = (): LineDraft => ({ key: ++lineKey, takaId: null, takaNo: null, fixedLabel: null, materialId: null, designId: null, qty: '', blouse: null, damages: [] });

function draftsOf(d: PartyReturnDetail): LineDraft[] {
  return d.lines.map((l) => ({
    key: ++lineKey,
    takaId: l.takaId,
    takaNo: l.takaNo,
    fixedLabel: l.takaId ? `${l.designCode ?? '—'} · ${l.quality}` : null,
    materialId: l.materialId,
    designId: l.designId,
    qty: String(l.qty),
    blouse: l.blouseOption,
    damages: l.damages.map((x) => ({ type: x.type as DamageRowDraft['type'], damageId: x.damageId ?? -1, otherName: x.damageId === null ? (x.otherName ?? x.name) : '', qty: String(x.qty) })),
  }));
}

/** Goods return → one GR: received summary, design lines (organise), Complete. Phone stacked · tablet 2-column cards · desktop split. */
export default function GoodsReturnOrganisePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const q = usePartyReturn(id);
  const d = q.data;
  usePageTitle(d ? d.label : 'Goods return');
  const save = useSavePartyReturnLines(id);
  const complete = useCompletePartyReturn(id);
  const update = useUpdatePartyReturn(id);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [header, setHeader] = useState<ReturnHeaderValue>(emptyReturnHeader());
  const [headerErr, setHeaderErr] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!d) return;
    const sig = `${d.id}:${d.status}:${d.lines.map((l) => `${l.id}`).join(',')}`;
    if (sig === loadedFor) return;
    setLoadedFor(sig);
    setLines(draftsOf(d));
  }, [d, loadedFor]);

  const pending = d?.status === 'pending';
  const takasMode = d?.receivedAs === 'takas';
  const unit = d?.unit ?? 'pcs';
  const nums = lines.map((l) => ({ qty: Number(l.qty) || 0 }));
  const org = d ? returnOrganised(d.receivedQty, nums) : { organised: 0, left: 0, complete: false };
  const setLine = (key: number, patch: Partial<LineDraft>) => setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const problems = useMemo(() => {
    const out: Record<number, string> = {};
    lines.forEach((l) => {
      if (!takasMode && (!l.materialId || !l.designId)) out[l.key] = 'Pick the quality and design';
      else if (!(Number(l.qty) > 0)) out[l.key] = 'Enter the quantity';
      else if (l.damages.some((x) => !damageRowPayload(x))) out[l.key] = 'Fill in every damage row (type, name, quantity)';
      else {
        const err = lineDamageError(Number(l.qty), l.damages.map((x) => ({ qty: Number(x.qty) || 0 })));
        if (err) out[l.key] = err;
      }
    });
    return out;
  }, [lines, takasMode]);
  const hasProblems = Object.keys(problems).length > 0;

  const payload = () => ({
    lines: lines.map((l) => ({
      takaId: l.takaId,
      materialId: l.materialId!,
      designId: l.designId!,
      qty: Number(l.qty),
      blouseOption: unit === 'pcs' ? l.blouse : null,
      damages: l.damages.map((x) => damageRowPayload(x)!),
    })),
  });

  const saveLines = (then?: () => void) => {
    setError(null);
    setFieldErrors(problems);
    if (hasProblems) return;
    save.mutate(payload(), {
      onSuccess: () => {
        toast.success('Lines saved');
        then?.();
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : errorMessage(err)),
    });
  };

  const doComplete = () => {
    setConfirm(false);
    save.mutate(payload(), {
      onSuccess: () =>
        complete.mutate(undefined, {
          onSuccess: (r) => {
            toast.success(`${r.label} completed · ${r.freshTakas} fresh + ${r.damagedTakas} damaged takas in free stock`);
            navigate('/goods-return?tab=completed');
          },
          onError: (err) => setError(errorMessage(err)),
        }),
      onError: (err) => setError(err instanceof ApiError ? err.message : errorMessage(err)),
    });
  };

  const openEdit = () => {
    if (!d) return;
    setHeader(headerOf(d, d.lines.flatMap((l) => (l.takaId ? [l.takaId] : []))));
    setHeaderErr({});
    setEditOpen(true);
  };
  const saveHeader = () => {
    const e = headerErrors(header);
    setHeaderErr(e);
    if (Object.keys(e).length) return;
    update.mutate(headerPayload(header), {
      onSuccess: () => {
        toast.success('Received details updated');
        setEditOpen(false);
        setLoadedFor(null);
      },
      onError: (err) => setHeaderErr({ _: err instanceof ApiError ? err.message : errorMessage(err) }),
    });
  };

  if (q.isPending) return <div className="page-container space-y-3 py-4"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  if (q.isError || !d) return <div className="page-container py-4"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>;

  const summaryText = `Received ${d.receivedQty.toLocaleString('en-IN')} ${unit === 'pcs' ? 'pcs' : 'm'} · organised ${org.organised.toLocaleString('en-IN')} ${unit === 'pcs' ? 'pcs' : 'm'} · left ${org.left.toLocaleString('en-IN')} ${unit === 'pcs' ? 'pcs' : 'm'}`;
  const share = d.receivedQty > 0 ? Math.min(100, (org.organised / d.receivedQty) * 100) : 0;

  return (
    <div className="page-container space-y-4 pb-36 pt-2 md:py-4">
      <BackLink fallback="/goods-return" label="Goods return" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-start">
        {/* received summary + photos */}
        <aside className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-soft lg:sticky lg:top-20">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">{d.label}</h1>
              <p className="font-semibold text-slate-700">{d.customer.name}</p>
              <p className="text-sm text-slate-500">{formatDate(d.receivedDate)} · received as {d.receivedAs}</p>
            </div>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', pending ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800')}>{pending ? 'Pending' : 'Completed'}</span>
          </div>
          <div>
            <p className="text-sm font-semibold tabular-nums text-slate-800">{summaryText}</p>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className={cn('h-full rounded-full', org.left === 0 ? 'bg-green-500' : 'bg-amber-500')} style={{ width: `${share}%` }} />
            </div>
          </div>
          {d.note && <p className="text-sm text-slate-600">{d.note}</p>}
          {d.images.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {d.images.map((i, n) => (
                <li key={i.url}><ImageThumb thumbUrl={i.thumbUrl} fullUrl={i.url} alt={`Photo ${n + 1}`} className="size-16" /></li>
              ))}
            </ul>
          )}
          {pending ? (
            <Button variant="secondary" size="sm" onClick={openEdit}><Pencil /> Edit received details</Button>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-slate-500"><Lock className="size-4" /> Completed — read only</p>
          )}
        </aside>

        {/* design lines */}
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-slate-900">{takasMode ? 'Returned takas' : 'Design lines'}</h2>
            {pending && !takasMode && (
              <Button size="sm" onClick={() => setLines((p) => [...p, blankLine()])}><Plus /> Add design</Button>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-slate-500">{pending ? 'Add a design line for the goods that came back.' : 'No lines.'}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {lines.map((l, i) => {
                const damaged = lineDamagedQty(l.damages.map((x) => ({ qty: Number(x.qty) || 0 })));
                const err = fieldErrors[l.key];
                return (
                  <li key={l.key} className={cn('space-y-3 rounded-xl border bg-white p-4 shadow-soft', err ? 'border-destructive/50' : 'border-border')}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-slate-900">{takasMode ? `Taka ${l.takaNo}` : `Line ${i + 1}`}{takasMode && <span className="ml-2 text-sm font-medium text-slate-500">{l.fixedLabel}</span>}</p>
                      {pending && !takasMode && (
                        <button type="button" aria-label={`Remove line ${i + 1}`} className="flex size-10 items-center justify-center rounded-lg text-slate-400 hover:bg-destructive-soft hover:text-destructive" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
                          <Trash2 className="size-5" />
                        </button>
                      )}
                    </div>
                    {!takasMode && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {pending ? (
                          <QualityDesignFields materialId={l.materialId} designId={l.designId} onChange={(v) => setLine(l.key, { materialId: v.materialId, designId: v.designId })} />
                        ) : (
                          <p className="text-sm text-slate-600 sm:col-span-2">{d.lines[i]?.designCode} · {d.lines[i]?.quality}</p>
                        )}
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={unit === 'pcs' ? 'Quantity (pcs)' : 'Quantity (metres)'} htmlFor={`ln-qty-${l.key}`} required>
                        <Input
                          id={`ln-qty-${l.key}`}
                          value={l.qty}
                          disabled={!pending || takasMode}
                          onChange={(e) => setLine(l.key, { qty: unit === 'pcs' ? e.target.value.replace(/[^\d]/g, '') : e.target.value.replace(/[^\d.]/g, '') })}
                          inputMode={unit === 'pcs' ? 'numeric' : 'decimal'}
                          autoComplete="off"
                          className="h-12 text-lg font-bold"
                        />
                      </Field>
                      {unit === 'pcs' && !takasMode && (
                        <Field label="Blouse" hint="Optional">
                          <div className="flex flex-wrap gap-2">
                            {BLOUSE_OPTIONS.map((b) => (
                              <button key={b} type="button" disabled={!pending} aria-pressed={l.blouse === b} onClick={() => setLine(l.key, { blouse: l.blouse === b ? null : b })} className={cn('min-h-11 rounded-full border px-3.5 text-sm font-medium', l.blouse === b ? 'border-primary bg-primary-soft text-primary' : 'border-input bg-white text-slate-700')}>
                                {BLOUSE_LABEL[b]}
                              </button>
                            ))}
                          </div>
                        </Field>
                      )}
                    </div>
                    <div className="space-y-3 rounded-lg bg-red-50/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-red-900">Damaged <span className="font-normal text-red-700">· {damaged.toLocaleString('en-IN')} of {Number(l.qty) || 0}</span></p>
                        {pending && (
                          <Button size="sm" variant="secondary" onClick={() => setLine(l.key, { damages: [...l.damages, emptyDamageRow()] })}><Plus /> Add damage</Button>
                        )}
                      </div>
                      {l.damages.map((x, n) => (
                        <div key={n} className="relative rounded-lg border border-red-100 bg-white p-3">
                          {pending && (
                            <button type="button" aria-label="Remove damage" className="absolute right-2 top-2 flex size-8 items-center justify-center rounded text-slate-400 hover:text-destructive" onClick={() => setLine(l.key, { damages: l.damages.filter((_, k) => k !== n) })}>
                              <X className="size-4" />
                            </button>
                          )}
                          <fieldset disabled={!pending} className="min-w-0">
                            <DamageRowFields row={x} unit={unit} idPrefix={`ln-${l.key}-${n}`} onChange={(r) => setLine(l.key, { damages: l.damages.map((y, k) => (k === n ? r : y)) })} />
                          </fieldset>
                        </div>
                      ))}
                    </div>
                    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
        </section>
      </div>

      {pending && (
        <div className="kb-bar fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-white/95 px-4 py-3 shadow-pop backdrop-blur lg:bottom-0 lg:left-64">
          <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-2">
            <p className={cn('mr-auto text-sm font-semibold tabular-nums', org.left === 0 && lines.length ? 'text-green-700' : 'text-amber-700')}>
              {org.left > 0 ? `Left to organise: ${org.left.toLocaleString('en-IN')} ${unit === 'pcs' ? 'pcs' : 'm'}` : org.left < 0 ? `Over by ${Math.abs(org.left)} — correct the received quantity` : lines.length ? 'Everything is organised' : 'Add a design line'}
            </p>
            {!takasMode && (
              <Button variant="secondary" size="lg" className="h-12" onClick={() => saveLines()} loading={save.isPending && !complete.isPending} disabled={lines.length === 0}>
                Save
              </Button>
            )}
            {takasMode && (
              <Button variant="secondary" size="lg" className="h-12" onClick={() => saveLines()} loading={save.isPending && !complete.isPending}>
                Save damage marks
              </Button>
            )}
            <Button size="lg" className="h-12 bg-green-600 hover:bg-green-700" disabled={!org.complete || hasProblems} onClick={() => setConfirm(true)}>
              <CheckCircle2 /> Complete
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Complete ${d.label}?`}
        description={`Each design line becomes free stock (fresh and damaged parts as separate takas with dummy numbers${takasMode ? '; the returned takas go back to free stock' : ''}). ${dualText(unit === 'pcs' ? d.receivedQty : 0, unit === 'meters' ? d.receivedQty : 0)} in total. A completed return can't be changed.`}
        confirmLabel="Complete"
        loading={complete.isPending || save.isPending}
        onConfirm={doComplete}
      />

      <ResponsiveModal
        open={editOpen}
        onOpenChange={(o) => !update.isPending && setEditOpen(o)}
        title={`Edit ${d.label} · received details`}
        size="lg"
        footer={
          <div className="kb-bar grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" size="lg" onClick={() => setEditOpen(false)} disabled={update.isPending}>Cancel</Button>
            <Button size="lg" onClick={saveHeader} loading={update.isPending}>Save</Button>
          </div>
        }
      >
        <ReturnHeaderForm value={header} onChange={setHeader} errors={headerErr} lockAs />
        {headerErr._ && <p role="alert" className="mt-3 text-sm font-medium text-destructive">{headerErr._}</p>}
      </ResponsiveModal>
    </div>
  );
}
