import { AlertTriangle, ArrowLeft, SearchX } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cleanPcs, damageTypeOptions, parsePcs, type ReceiptFormData, type TakaSource } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { formatOrderNo, toApiDate } from '@/lib/format';
import { TakaDamageControl, qcEntryPayload, type DamageEntry } from '../takas/damage-dialog';
import { BlouseTag } from '../free-stock/blouse';
import { useCreateFgReceipt, useFgReceiptForm } from './api';

function IdentityCard({ form }: { form: ReceiptFormData }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft">
      <div className="flex items-start gap-4">
        <ImageThumb thumbUrl={form.thumbUrl} alt={form.designCode ? `Design ${form.designCode}` : 'No design'} className="size-20 shrink-0" rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">Receiving goods · Order</p>
          <h2 className="text-3xl font-extrabold leading-none tracking-tight text-slate-900">{formatOrderNo(form.orderNo)}</h2>
          <p className="mt-1.5 truncate text-lg font-bold text-primary">{form.designCode ?? 'No design'}</p>
          <BlouseTag option={form.blouseOption} className="mt-1" />
        </div>
      </div>
      <p className="mt-3 border-t border-border pt-3 text-sm text-slate-600">{form.quality} · pcs to pcs</p>
    </section>
  );
}

/** A direct FG purchase, pcs-to-pcs order: only the received pcs (+ optional damaged pcs) — one "Received lot" taka. */
export function FgPcsReceiptPage({ orderId }: { orderId: number }) {
  const navigate = useNavigate();
  const formQuery = useFgReceiptForm(orderId);
  const create = useCreateFgReceipt(orderId);
  usePageTitle('Receive goods');

  const [supplierName, setSupplierName] = useState('');
  const [challanNo, setChallanNo] = useState('');
  const [date, setDate] = useState(toApiDate(new Date()));
  const [pcs, setPcs] = useState('');
  const [damagedPcs, setDamagedPcs] = useState('');
  const [damage, setDamage] = useState<DamageEntry | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (formQuery.isPending) {
    return (
      <div className="page-container max-w-xl space-y-4 py-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (formQuery.isError || !formQuery.data) {
    const notFound = formQuery.error instanceof ApiError && formQuery.error.status === 404;
    return (
      <div className="page-container max-w-xl py-4">
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive-soft text-destructive">
            {notFound ? <SearchX className="size-7" aria-hidden /> : <AlertTriangle className="size-7" aria-hidden />}
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{notFound ? 'Not found' : "Couldn't load this"}</h2>
          <Button asChild size="lg" className="mt-5">
            <Link to="/receive-goods">Back to Receive goods</Link>
          </Button>
        </div>
      </div>
    );
  }
  const form = formQuery.data;
  const receivedPcs = parsePcs(pcs).pcs;
  const damagedN = damagedPcs ? Number(damagedPcs) : 0;
  const canSubmit = !!receivedPcs && receivedPcs > 0 && challanNo.trim() !== '' && supplierName.trim() !== '' && (damagedN === 0 || !!damage);

  const submit = () => {
    setError(null);
    create.mutate(
      {
        challanNo: challanNo.trim(),
        date,
        supplierName: supplierName.trim(),
        pcs: receivedPcs!,
        damagedPcs: damagedN,
        damage: damage ? qcEntryPayload(damage) : undefined,
        notes: notes.trim() || null,
      },
      {
        onSuccess: (res) => {
          toast.success(`Received lot · ${res.pcs.toLocaleString('en-IN')} pcs`);
          navigate(`/orders/${res.orderId}?tab=takas`);
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <div className="page-container max-w-xl space-y-4 pt-3 pb-24 md:pt-5">
      <button type="button" onClick={() => navigate(-1)} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> Back
      </button>
      <IdentityCard form={form} />

      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <h2 className="mb-3 text-[15px] font-bold text-slate-800">Challan</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="fg-supplier" className="mb-1.5 block text-sm font-semibold text-slate-600">
              Supplier name<span className="text-destructive">*</span>
            </label>
            <Input id="fg-supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} autoComplete="off" className="h-12 text-base" />
          </div>
          <div>
            <label htmlFor="fg-challan" className="mb-1.5 block text-sm font-semibold text-slate-600">
              Challan no<span className="text-destructive">*</span>
            </label>
            <Input id="fg-challan" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} autoComplete="off" className="h-12 text-base" maxLength={40} />
          </div>
          <div>
            <label htmlFor="fg-date" className="mb-1.5 block text-sm font-semibold text-slate-600">
              Date<span className="text-destructive">*</span>
            </label>
            <DatePicker id="fg-date" value={date} onChange={setDate} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <h2 className="mb-3 text-[15px] font-bold text-slate-800">Received</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fg-pcs" className="mb-1.5 block text-sm font-semibold text-slate-600">
              Received pcs<span className="text-destructive">*</span>
            </label>
            <input
              id="fg-pcs"
              value={pcs}
              onChange={(e) => setPcs(cleanPcs(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              className="h-12 w-full rounded-xl border border-input bg-white px-3 text-lg font-bold tabular-nums text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <div>
            <label htmlFor="fg-damaged" className="mb-1.5 block text-sm font-semibold text-slate-600">
              Damaged pcs
            </label>
            <input
              id="fg-damaged"
              value={damagedPcs}
              onChange={(e) => setDamagedPcs(cleanPcs(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              className="h-12 w-full rounded-xl border border-input bg-white px-3 text-lg font-bold tabular-nums text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </div>
        </div>
        <TakaDamageControl
          entries={damage ? [damage] : []}
          onChange={(entries) => setDamage(entries[entries.length - 1] ?? null)}
          takaLabel="Received lot"
          takaPcs={receivedPcs ?? damagedN}
          disabled={damagedN === 0}
          types={damageTypeOptions({ source: 'fg_purchase' as TakaSource, hasButta: form.orderSteps.hasButta, hasMill: form.orderSteps.hasMill })}
          source={'fg_purchase' as TakaSource}
          allowImages
          className="mt-3"
        />
      </section>

      <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
        <h2 className="mb-3 text-[15px] font-bold text-slate-800">Note</h2>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Note (optional)" className="min-h-[88px] text-base" />
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="kb-bar sticky bottom-0 z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-t-2xl md:border-x">
        <Button size="lg" className="h-14 w-full text-lg" disabled={!canSubmit} loading={create.isPending} onClick={submit}>
          Submit
        </Button>
      </div>
    </div>
  );
}

export default FgPcsReceiptPage;
