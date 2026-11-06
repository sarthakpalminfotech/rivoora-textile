import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { dualText, STOCK_REMOVE_REASON_LABEL, STOCK_REMOVE_REASONS, type StockRemoveReason } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BackLink } from '../inventory/parts';
import { useRemovableTakas, useRemoveStock } from './api';
import { QualityDesignFields } from './parts';

/**
 * Inventory → Remove stock (Jenish, Gaurang): FREE stock only. Tick whole takas, or (pcs stock) enter a pcs amount and the
 * system picks takas (largest first) and splits one if needed. A reason is required (Other needs a note).
 */
export default function RemoveStockPage() {
  usePageTitle('Remove stock');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const n = (k: string) => (/^\d+$/.test(params.get(k) ?? '') ? Number(params.get(k)) : null);
  const [materialId, setMaterialId] = useState<number | null>(n('materialId') ?? n('qualityId'));
  const [designId, setDesignId] = useState<number | null>(n('designId'));
  const [mode, setMode] = useState<'takas' | 'pcs'>('takas');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pcsText, setPcsText] = useState('');
  const [reason, setReason] = useState<StockRemoveReason | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const takas = useRemovableTakas(designId, materialId);
  const remove = useRemoveStock();
  const list = takas.data ?? [];
  const pickedRows = list.filter((t) => picked.has(t.id));
  const totalPcs = pickedRows.reduce((s, t) => s + (t.pcs ?? 0), 0);
  const totalM = pickedRows.reduce((s, t) => s + (t.unit === 'meters' ? (t.meters ?? 0) : 0), 0);
  const readyPcs = useMemo(() => list.filter((t) => t.unit === 'pcs' && t.stage === 'final').reduce((s, t) => s + (t.pcs ?? 0), 0), [list]);
  const pcs = /^\d+$/.test(pcsText) ? Number(pcsText) : 0;

  const ready = !!designId && !!materialId && !!reason && (reason !== 'other' || note.trim() !== '') && (mode === 'takas' ? picked.size > 0 : pcs > 0);
  const summary =
    mode === 'takas'
      ? `Remove ${picked.size} ${picked.size === 1 ? 'taka' : 'takas'} · ${dualText(totalPcs, Math.round(totalM * 100) / 100)}`
      : `Remove ${pcs.toLocaleString('en-IN')} pcs (takas picked by the system, one may be split)`;

  const submit = () => {
    setError(null);
    remove.mutate(
      mode === 'takas' ? { takaIds: [...picked], reason: reason!, note: note.trim() || null } : { designId: designId!, materialId: materialId!, pcs, reason: reason!, note: note.trim() || null },
      {
        onSuccess: (r) => {
          toast.success(`Stock removed · ${r.takas} ${r.takas === 1 ? 'taka' : 'takas'} · ${dualText(r.pcs, r.meters)} · ${r.reasonText}`);
          setConfirm(false);
          navigate(designId ? `/inventory/items/d-${designId}` : '/inventory');
        },
        onError: (err) => {
          setConfirm(false);
          setError(err instanceof ApiError ? err.message : errorMessage(err));
        },
      },
    );
  };

  return (
    <div className="page-container max-w-5xl space-y-4 pb-28 pt-2 md:py-4">
      <BackLink />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Remove stock</h1>
        <p className="text-sm text-slate-500">Free stock only — it leaves every stock figure. The reason is kept in Stock adjustments.</p>
      </div>
      <section className="space-y-5 rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <QualityDesignFields
            materialId={materialId}
            designId={designId}
            onChange={(v) => {
              setMaterialId(v.materialId);
              setDesignId(v.designId);
              setPicked(new Set());
            }}
          />
          <Field label="Remove by" required>
            <Segmented<'takas' | 'pcs'> aria-label="Remove by" size="lg" value={mode} onChange={setMode} options={[{ value: 'takas', label: 'Tick takas' }, { value: 'pcs', label: 'Pcs amount' }]} />
          </Field>
        </div>

        {designId && materialId && (
          <>
            {mode === 'takas' ? (
              takas.isPending ? (
                <Skeleton className="h-32 rounded-xl" />
              ) : list.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-slate-500">There is no free stock of this design and quality.</p>
              ) : (
                <ul className="grid gap-2 md:grid-cols-2">
                  {list.map((t) => (
                    <li key={t.id}>
                      <label className={cn('flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2', picked.has(t.id) ? 'border-primary/50 bg-primary-soft/40' : 'border-border bg-white')}>
                        <TickBox
                          size="lg"
                          checked={picked.has(t.id)}
                          onCheckedChange={(on) =>
                            setPicked((p) => {
                              const next = new Set(p);
                              if (on) next.add(t.id);
                              else next.delete(t.id);
                              return next;
                            })
                          }
                          aria-label={`Remove taka ${t.takaNo}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-lg font-bold tabular-nums text-slate-900">{t.takaNo}</span>
                          <span className="ml-2 text-sm text-slate-500">{t.unit === 'meters' ? `${t.meters ?? 0} m` : `${t.pcs ?? 0} pcs`}</span>
                          {t.isDamaged && <span className="ml-2 text-xs font-semibold text-red-600">damaged</span>}
                          <span className="block text-xs text-slate-400">{t.isManual ? 'Manual stock' : `From Order #${t.fromOrderNo}`}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <Field label="Pcs to remove" htmlFor="rm-pcs" required hint={`Ready free pcs: ${readyPcs.toLocaleString('en-IN')} · largest takas first, one may be split`}>
                <Input id="rm-pcs" value={pcsText} onChange={(e) => setPcsText(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" autoComplete="off" className="h-12 max-w-xs text-lg font-bold" />
              </Field>
            )}
          </>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Reason" htmlFor="rm-reason" required>
            <Select<StockRemoveReason> id="rm-reason" value={reason} onChange={setReason} options={STOCK_REMOVE_REASONS.map((r) => ({ value: r, label: STOCK_REMOVE_REASON_LABEL[r] }))} placeholder="Select reason" />
          </Field>
          <Field label="Note" htmlFor="rm-note" required={reason === 'other'} hint={reason === 'other' ? 'Required for Other' : 'Optional'}>
            <Textarea id="rm-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
          </Field>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </section>
      <div className="kb-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-t-2xl lg:border-x">
        <p className="mr-auto text-sm font-semibold text-slate-700">{ready ? summary : 'Pick the stock and the reason'}</p>
        <Button variant="secondary" size="lg" className="h-12" onClick={() => navigate(-1)} disabled={remove.isPending}>
          Cancel
        </Button>
        <Button variant="destructive" size="lg" className="h-12" disabled={!ready} onClick={() => setConfirm(true)}>
          Remove stock
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove this stock?"
        description={`${summary} · reason ${reason ? STOCK_REMOVE_REASON_LABEL[reason] : ''}${note.trim() ? ` (${note.trim()})` : ''}. It leaves the inventory and this can't be undone.`}
        confirmLabel="Remove stock"
        destructive
        loading={remove.isPending}
        onConfirm={submit}
      />
    </div>
  );
}
