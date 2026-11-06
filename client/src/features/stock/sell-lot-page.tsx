import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { dualText, STOCK_DAMAGE_TYPE_LABEL, STOCK_DAMAGE_TYPES, type StockDamageType } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { DatePicker } from '@/components/ui/date-picker';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { ApiError, errorMessage } from '@/lib/api';
import { useRole } from '@/hooks/useRole';
import { toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BackLink } from '../inventory/parts';
import { useDamagedFreeTakas, useSellDamagedLot } from './api';
import { QualityDesignFields } from './parts';

/** Inventory → Damaged → Sell as lot (Jenish, Gaurang): tick damaged free-stock takas, one lump-sum amount (₹, optional). */
export default function SellLotPage() {
  usePageTitle('Sell damaged stock as a lot');
  const navigate = useNavigate();
  const { can } = useRole();
  const [materialId, setMaterialId] = useState<number | null>(null);
  const [designId, setDesignId] = useState<number | null>(null);
  const [type, setType] = useState<StockDamageType | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [date, setDate] = useState(toApiDate(new Date()));
  const [buyer, setBuyer] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const takas = useDamagedFreeTakas({ materialId: materialId ?? undefined, designId: designId ?? undefined, type: type ?? undefined });
  const sell = useSellDamagedLot();
  const list = takas.data ?? [];
  const sel = list.filter((t) => picked.has(t.id));
  const totalPcs = sel.reduce((s, t) => s + (t.unit === 'pcs' ? (t.pcs ?? 0) : 0), 0);
  const totalM = Math.round(sel.reduce((s, t) => s + (t.unit === 'meters' ? (t.meters ?? 0) : 0), 0) * 100) / 100;
  const chip = (on: boolean) => cn('min-h-10 rounded-full border px-3.5 text-sm font-medium', on ? 'border-primary bg-primary-soft text-primary' : 'border-input bg-white text-slate-700 hover:bg-muted');

  const submit = () => {
    setError(null);
    const amt = amount.trim() === '' ? null : Number(amount);
    if (amt !== null && !(amt >= 0)) return setError('Enter a valid amount');
    sell.mutate(
      { takaIds: [...picked], lotDate: date, buyer: buyer.trim() || null, amount: amt, note: note.trim() || null },
      {
        onSuccess: (r) => {
          toast.success(`${r.label} sold · ${r.takas} takas · ${dualText(r.pcs, r.meters)}`);
          navigate('/inventory/damaged/lots');
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : errorMessage(err)),
      },
    );
  };

  return (
    <div className="page-container max-w-5xl space-y-4 pb-28 pt-2 md:py-4">
      <BackLink fallback="/inventory?section=damaged" label="Damaged" />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold text-slate-900">Sell damaged stock as a lot</h1>
        <Button asChild variant="secondary" size="sm">
          <Link to="/inventory/damaged/lots">Damaged lots sold</Link>
        </Button>
      </div>
      <section className="space-y-4 rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <QualityDesignFields materialId={materialId} designId={designId} onChange={(v) => { setMaterialId(v.materialId); setDesignId(v.designId); setPicked(new Set()); }} />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Damage type">
          <button type="button" className={chip(type === null)} onClick={() => setType(null)}>All types</button>
          {STOCK_DAMAGE_TYPES.map((t) => (
            <button key={t} type="button" className={chip(type === t)} aria-pressed={type === t} onClick={() => setType(type === t ? null : t)}>
              {STOCK_DAMAGE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        {takas.isPending ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-slate-500">No damaged free stock matches.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {list.map((t) => (
              <li key={t.id}>
                <label className={cn('flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2', picked.has(t.id) ? 'border-primary/50 bg-primary-soft/40' : 'border-border bg-white')}>
                  <TickBox
                    size="lg"
                    checked={picked.has(t.id)}
                    onCheckedChange={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(t.id); else n.delete(t.id); return n; })}
                    aria-label={`Sell taka ${t.takaNo}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-lg font-bold tabular-nums">{t.takaNo}</span>
                    <span className="ml-2 text-sm text-slate-500">{t.unit === 'meters' ? `${t.meters ?? 0} m` : `${t.pcs ?? 0} pcs`}</span>
                    <span className="block text-xs text-slate-500">{t.quality} · {t.designCode ?? '—'}</span>
                    <span className="block text-xs font-semibold text-red-600">{t.damages.map((d) => d.label).join(' · ')}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-4 rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
        <p className="text-sm font-semibold text-slate-700">Lot · {sel.length} {sel.length === 1 ? 'taka' : 'takas'} · {dualText(totalPcs, totalM)}</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Date" htmlFor="lot-date" required><DatePicker id="lot-date" value={date} onChange={setDate} /></Field>
          <Field label="Buyer" htmlFor="lot-buyer" hint="Optional"><Input id="lot-buyer" value={buyer} onChange={(e) => setBuyer(e.target.value)} maxLength={120} autoComplete="off" /></Field>
          {can('canSeeRate') && (
            <Field label="Lump-sum amount (₹)" htmlFor="lot-amount" hint="Optional">
              <Input id="lot-amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" autoComplete="off" />
            </Field>
          )}
        </div>
        <Field label="Note" htmlFor="lot-note" hint="Optional"><Textarea id="lot-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} /></Field>
        {error && <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
      </section>
      <div className="kb-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex gap-2 border-t border-border bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-t-2xl lg:border-x">
        <Button variant="secondary" size="lg" className="h-12 flex-1 sm:flex-none" onClick={() => navigate(-1)} disabled={sell.isPending}>Cancel</Button>
        <Button size="lg" className="h-12 flex-1 sm:flex-none" disabled={picked.size === 0} loading={sell.isPending} onClick={submit}>Sell as lot ({picked.size})</Button>
      </div>
    </div>
  );
}

void useMemo;
