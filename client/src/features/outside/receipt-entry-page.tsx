import { AlertTriangle, ArrowLeft, Plus, SearchX } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  cleanMeters,
  cleanPcs,
  cleanWeaverTakaNo,
  damageTypeOptions,
  METERS_ERROR_TEXT,
  MAX_TAKAS_PER_SUBMIT,
  OUTSIDE_ROW_ERROR_TEXT,
  validateWeaverTakaNos,
  parseMeters,
  parsePcs,
  PCS_ERROR_TEXT,
  totalMeters,
  totalPcs,
  type ReceiptFormData,
  type TakaSource,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { formatOrderNo, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { qcEntryPayload, TakaDamageControl, type DamageEntry } from '../takas/damage-dialog';
import { BlouseTag } from '../free-stock/blouse';
import { useCreateFgReceipt, useCreateOutsideReceipt, useFgReceiptForm, useOutsideReceiptForm } from './api';

interface Row {
  key: number;
  weaverNo: string;
  ourNo: string;
  pcs: string;
  meters: string;
  damages: DamageEntry[];
  weaverTouched: boolean;
  /** The user left the PRIMARY quantity field (pcs for a pcs order, meters for a meter order). */
  pcsTouched: boolean;
}

let rowKey = 0;
const emptyRows = (n: number): Row[] =>
  Array.from({ length: n }, () => ({ key: ++rowKey, weaverNo: '', ourNo: '', pcs: '', meters: '', damages: [], weaverTouched: false, pcsTouched: false }));

const isUsed = (r: Row) => r.weaverNo !== '' || r.pcs !== '' || r.meters !== '' || r.ourNo !== '' || r.damages.length > 0;

const fieldBox = (invalid: boolean) =>
  cn(
    'h-12 w-full rounded-xl border bg-white tabular-nums text-slate-900 transition-colors placeholder:text-slate-300 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60',
    invalid ? 'border-destructive focus:ring-destructive/20' : 'border-input focus:border-primary focus:ring-primary/15',
  );

/**
 * Sprint 21 (CR-07) — OUR taka number is automatic (shown as "Auto"); the weaver's / supplier's own number is optional,
 * but a typed one must be numeric and unique in the form (the server also checks it per weaver).
 */
function useRowErrors(rows: Row[]) {
  const filled = rows.filter(isUsed);
  return useMemo(
    () => validateWeaverTakaNos(filled.map((r) => ({ weaverTakaNo: r.weaverNo }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filled.map((r) => r.weaverNo).join(',')],
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5">
      <h2 className="mb-3 text-[15px] font-bold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

function IdentityCard({ form, headerLabel }: { form: ReceiptFormData; headerLabel: string }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft">
      <div className="flex items-start gap-4">
        <ImageThumb thumbUrl={form.thumbUrl} alt={form.designCode ? `Design ${form.designCode}` : 'No design'} className="size-20 shrink-0" rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">{headerLabel}</p>
          <h2 className="text-3xl font-extrabold leading-none tracking-tight text-slate-900">{formatOrderNo(form.orderNo)}</h2>
          <p className="mt-1.5 truncate text-lg font-bold text-primary">{form.designCode ?? 'No design'}</p>
          <BlouseTag option={form.blouseOption} className="mt-1" />
        </div>
      </div>
      <p className="mt-3 border-t border-border pt-3 text-sm text-slate-600">
        {form.quality}
        {form.po && (
          <>
            {' · '}
            {form.po.label} · {form.po.weaver.name}
          </>
        )}
      </p>
    </section>
  );
}

/** One receipt (challan) form, shared by outside-PO receive and a direct FG purchase's lump receive. */
export function ReceiptEntryPage({ kind, id }: { kind: 'outside_po' | 'fg'; id: number }) {
  const navigate = useNavigate();
  const outsideForm = useOutsideReceiptForm(id, kind === 'outside_po');
  const fgForm = useFgReceiptForm(id, kind === 'fg');
  const formQuery = kind === 'outside_po' ? outsideForm : fgForm;
  const createOutside = useCreateOutsideReceipt(kind === 'outside_po' ? id : 0, formQuery.data?.orderId ?? 0);
  const createFg = useCreateFgReceipt(kind === 'fg' ? id : 0);
  const submitMutation = kind === 'outside_po' ? createOutside : createFg;

  const [challanNo, setChallanNo] = useState('');
  const [date, setDate] = useState(toApiDate(new Date()));
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>(() => emptyRows(3));
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [serverError, setServerError] = useState<{ key: number; field: string; message: string } | null>(null);
  const weaverInputs = useRef(new Map<number, HTMLInputElement>());
  const pcsInputs = useRef(new Map<number, HTMLInputElement>());
  const meterInputs = useRef(new Map<number, HTMLInputElement>());

  usePageTitle(kind === 'outside_po' ? 'Receive challan' : 'Receive goods');

  const rowErrors = useRowErrors(rows);
  const filled = rows.filter(isUsed);
  // Sprint 19: the ORDER's unit decides — a meter order's rows carry metres only (pcs hidden, never required).
  const meterOrder = formQuery.data?.unit === 'meters';
  const meterErrors = filled.map((r) => parseMeters(r.meters).error);
  const metersRequiredErrors = filled.map((r) => meterOrder && parseMeters(r.meters).error === null && r.meters.trim() === '');
  const pcsErrors = filled.map((r) => (meterOrder ? null : parsePcs(r.pcs).error));
  const canSubmit =
    filled.length > 0 &&
    filled.length <= MAX_TAKAS_PER_SUBMIT &&
    rowErrors.every((e) => e === null) &&
    meterErrors.every((e) => e === null) &&
    !metersRequiredErrors.some(Boolean) &&
    pcsErrors.every((e) => e === null) &&
    challanNo.trim() !== '' &&
    (kind === 'outside_po' || supplierName.trim() !== '');

  if (formQuery.isPending) {
    return (
      <div className="page-container max-w-2xl space-y-4 py-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (formQuery.isError || !formQuery.data) {
    const notFound = formQuery.error instanceof ApiError && formQuery.error.status === 404;
    return (
      <div className="page-container max-w-2xl py-4">
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive-soft text-destructive">
            {notFound ? <SearchX className="size-7" aria-hidden /> : <AlertTriangle className="size-7" aria-hidden />}
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{notFound ? 'Not found' : "Couldn't load this"}</h2>
          {!notFound && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{errorMessage(formQuery.error)}</p>}
          <Button asChild size="lg" className="mt-5">
            <Link to="/receive-goods">Back to Receive goods</Link>
          </Button>
        </div>
      </div>
    );
  }

  const form = formQuery.data;
  const damageTypes = damageTypeOptions({ source: (kind === 'outside_po' ? 'outside_po' : 'fg_purchase') as TakaSource, hasButta: form.orderSteps.hasButta, hasMill: form.orderSteps.hasMill });
  const noun = kind === 'outside_po' ? 'Weaver taka no' : 'Supplier taka no';

  const back = (
    <button type="button" onClick={() => navigate(-1)} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
      <ArrowLeft className="size-4" /> Back
    </button>
  );

  const setRow = (key: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (serverError?.key === key) setServerError(null);
  };
  const addRow = () => {
    const [row] = emptyRows(1);
    setRows((prev) => [...prev, row]);
    window.setTimeout(() => weaverInputs.current.get(row.key)?.focus(), 0);
  };

  const submit = () => {
    const rowPayload = filled.map((r) => ({
      weaverTakaNo: cleanWeaverTakaNo(r.weaverNo),
      pcs: meterOrder ? undefined : parsePcs(r.pcs).pcs!,
      meters: parseMeters(r.meters).meters,
      damages: r.damages.map((e) => qcEntryPayload(e, meterOrder)),
    }));
    const base = { challanNo: challanNo.trim(), date, notes: notes.trim() || null };
    const payload = kind === 'outside_po' ? { ...base, rows: rowPayload } : { ...base, supplierName: supplierName.trim(), rows: rowPayload };
    submitMutation.mutate(payload as never, {
      onSuccess: (res) => {
        const nos = res.takas.map((t) => t.takaNo);
        const range = nos.length > 1 ? `Takas ${nos[0]}–${nos[nos.length - 1]} created` : nos.length === 1 ? `Taka ${nos[0]} created` : '';
        toast.success(`${range ? `${range} · ` : ''}${res.takas.length} taka${res.takas.length === 1 ? '' : 's'} received · ${res.pcs.toLocaleString('en-IN')} pcs`);
        navigate(kind === 'outside_po' ? `/orders/${res.orderId}?tab=outside` : `/orders/${res.orderId}?tab=takas`);
      },
      onError: (err) => {
        const m = err instanceof ApiError && err.field ? /^rows\.(\d+)\.(\w+)/.exec(err.field) : null;
        const row = m ? filled[Number(m[1])] : undefined;
        if (row) {
          setServerError({ key: row.key, field: m![2], message: err.message });
          if (m![2] === 'weaverTakaNo') weaverInputs.current.get(row.key)?.focus();
          else if (m![2] === 'meters') meterInputs.current.get(row.key)?.focus();
          else pcsInputs.current.get(row.key)?.focus();
        } else {
          toast.error(errorMessage(err));
        }
      },
    });
  };

  const totalsLine = (() => {
    const m = totalMeters(filled.map((r) => ({ meters: parseMeters(r.meters).meters })));
    const p = totalPcs(filled.map((r) => ({ pcs: parsePcs(r.pcs).pcs })));
    return [m !== null && `${m.toLocaleString('en-IN')} m`, p !== null && `${p.toLocaleString('en-IN')} pcs`].filter(Boolean).join(' · ');
  })();

  return (
    <div className="page-container max-w-2xl space-y-4 pt-3 pb-24 md:max-w-4xl md:pt-5">
      {back}
      <IdentityCard form={form} headerLabel={kind === 'outside_po' ? 'Receiving against a PO · Order' : 'Receiving goods · Order'} />

      <Section title="Challan">
        <div className="grid gap-4 sm:grid-cols-2">
          {kind === 'fg' && (
            <div className="sm:col-span-2">
              <label htmlFor="r-supplier" className="mb-1.5 block text-sm font-semibold text-slate-600">
                Supplier name<span className="text-destructive">*</span>
              </label>
              <Input id="r-supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} autoComplete="off" className="h-12 text-base" />
            </div>
          )}
          <div>
            <label htmlFor="r-challan" className="mb-1.5 block text-sm font-semibold text-slate-600">
              Challan no<span className="text-destructive">*</span>
            </label>
            <Input id="r-challan" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} autoComplete="off" className="h-12 text-base" maxLength={40} />
          </div>
          <div>
            <label htmlFor="r-date" className="mb-1.5 block text-sm font-semibold text-slate-600">
              Date<span className="text-destructive">*</span>
            </label>
            <DatePicker id="r-date" value={date} onChange={setDate} />
          </div>
        </div>
      </Section>

      <Section
        title={
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>Takas</span>
            {filled.length > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-bold text-slate-600">{filled.length}{totalsLine && ` · ${totalsLine}`}</span>}
          </span>
        }
      >
        <p className="mb-3 text-sm text-slate-500">
          Our taka numbers are given automatically when you submit. The {kind === 'outside_po' ? "weaver's" : "supplier's"} own number is optional.
        </p>
        <ol className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-1 lg:gap-0 lg:space-y-3">
          {rows.map((r, i) => {
            const filledIndex = filled.indexOf(r);
            const rowErr = filledIndex >= 0 ? rowErrors[filledIndex] : null;
            const meterErr = filledIndex >= 0 ? meterErrors[filledIndex] : null;
            const meterRequiredErr = filledIndex >= 0 ? metersRequiredErrors[filledIndex] : false;
            const pcsErr = filledIndex >= 0 ? pcsErrors[filledIndex] : null;
            const metersFieldMessage = serverError?.key === r.key && serverError.field === 'meters' ? serverError.message : null;
            const server = serverError?.key === r.key && serverError.field !== 'meters' ? serverError : null;
            const weaverFieldErr = rowErr && rowErr.startsWith('weaver') ? OUTSIDE_ROW_ERROR_TEXT[rowErr] : server?.field === 'weaverTakaNo' ? server.message : null;
            const showWeaverErr = !!weaverFieldErr && (r.weaverTouched || showAllErrors);
            const showPcsErr = !!pcsErr && (r.pcsTouched || showAllErrors);
            const showMeterRequiredErr = meterRequiredErr && (r.pcsTouched || showAllErrors);
            const metersInvalid = !!meterErr || showMeterRequiredErr || !!metersFieldMessage;
            return (
              <li key={r.key} className={cn('-mx-2 rounded-xl px-2 py-1.5 transition-colors', r.damages.length > 0 && 'bg-red-50 ring-1 ring-red-200')}>
                {/* Flex-wrap, not a fixed grid: the weaver / our-number fields grow and shrink, and reflow onto their
                    own line on narrow tablets instead of squeezing every field into one cramped row. */}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[8.5rem] flex-1 basis-[8.5rem]">
                    <label htmlFor={`r-${r.key}-w`} className="text-sm font-semibold text-slate-600">
                      {noun} <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      ref={(el) => {
                        if (el) weaverInputs.current.set(r.key, el);
                        else weaverInputs.current.delete(r.key);
                      }}
                      id={`r-${r.key}-w`}
                      value={r.weaverNo}
                      onChange={(e) => setRow(r.key, { weaverNo: cleanWeaverTakaNo(e.target.value) })}
                      onBlur={() => isUsed(r) && !r.weaverTouched && setRow(r.key, { weaverTouched: true })}
                      inputMode="tel"
                      autoComplete="off"
                      placeholder="e.g. 1101"
                      aria-invalid={showWeaverErr || undefined}
                      className={cn(fieldBox(showWeaverErr), 'mt-1 w-full px-3 text-base font-bold')}
                    />
                  </div>
                  <div className="w-[4.5rem] shrink-0">
                    <span className="text-sm font-semibold text-slate-600">Our no</span>
                    <div className="mt-1 flex h-12 items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-400">Auto</div>
                  </div>
                  {!meterOrder && (
                    <div className="w-[5.5rem] shrink-0">
                      <label htmlFor={`r-${r.key}-p`} className="text-sm font-semibold text-slate-600">
                        Pcs<span className="text-destructive">*</span>
                      </label>
                      <input
                        ref={(el) => {
                          if (el) pcsInputs.current.set(r.key, el);
                          else pcsInputs.current.delete(r.key);
                        }}
                        id={`r-${r.key}-p`}
                        value={r.pcs}
                        onChange={(e) => setRow(r.key, { pcs: cleanPcs(e.target.value) })}
                        onBlur={() => isUsed(r) && !r.pcsTouched && setRow(r.key, { pcsTouched: true })}
                        inputMode="numeric"
                        autoComplete="off"
                        aria-invalid={showPcsErr || undefined}
                        className={cn(fieldBox(showPcsErr), 'mt-1 w-full px-3 text-base font-bold')}
                        placeholder="0"
                      />
                    </div>
                  )}
                  <div className={cn('relative shrink-0', meterOrder ? 'w-24' : 'w-[6.5rem]')}>
                    <label htmlFor={`r-${r.key}-m`} className="text-sm font-semibold text-slate-600">
                      Meters{meterOrder && <span className="text-destructive">*</span>}
                    </label>
                    <input
                      ref={(el) => {
                        if (el) meterInputs.current.set(r.key, el);
                        else meterInputs.current.delete(r.key);
                      }}
                      id={`r-${r.key}-m`}
                      value={r.meters}
                      onChange={(e) => setRow(r.key, { meters: cleanMeters(e.target.value) })}
                      onBlur={() => meterOrder && isUsed(r) && !r.pcsTouched && setRow(r.key, { pcsTouched: true })}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-invalid={metersInvalid || undefined}
                      className={cn(fieldBox(metersInvalid), 'mt-1 w-full px-3 pr-7 text-base font-bold')}
                      placeholder="0.0"
                    />
                    <span className="pointer-events-none absolute bottom-[13px] right-3 text-sm font-semibold text-slate-400">m</span>
                  </div>
                  <TakaDamageControl
                    entries={r.damages}
                    onChange={(damages) => setRow(r.key, { damages })}
                    takaLabel={`Taka ${r.weaverNo || i + 1}`}
                    takaPcs={parsePcs(r.pcs).pcs}
                    meterOrder={meterOrder}
                    takaMeters={parseMeters(r.meters).meters}
                    disabled={meterOrder ? parseMeters(r.meters).meters === null : parsePcs(r.pcs).error !== null}
                    types={damageTypes}
                    source={(kind === 'outside_po' ? 'outside_po' : 'fg_purchase') as TakaSource}
                    allowImages
                    size="sm"
                    className="shrink-0"
                  />
                </div>
                {showWeaverErr && <p className="mt-1 text-sm font-semibold text-destructive">{weaverFieldErr}</p>}
                {metersFieldMessage && <p className="mt-1 text-sm font-semibold text-destructive">{metersFieldMessage}</p>}
                {!metersFieldMessage && meterErr && <p className="mt-1 text-sm font-semibold text-destructive">{METERS_ERROR_TEXT[meterErr].en}</p>}
                {!metersFieldMessage && !meterErr && showMeterRequiredErr && <p className="mt-1 text-sm font-semibold text-destructive">Enter the metres</p>}
                {showPcsErr && <p className="mt-1 text-sm font-semibold text-destructive">{PCS_ERROR_TEXT[pcsErr!].en}</p>}
              </li>
            );
          })}
        </ol>
        <Button variant="secondary" size="lg" className="mt-4 h-12 w-full border-dashed" onClick={addRow}>
          <Plus /> Add row
        </Button>
      </Section>

      <Section title="Note">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Note (optional)" className="min-h-[88px] text-base" />
      </Section>

      <div className="kb-bar sticky bottom-0 z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-t-2xl md:border-x">
        <Button
          size="lg"
          className="h-14 w-full text-lg"
          disabled={!canSubmit || submitMutation.isPending}
          loading={submitMutation.isPending}
          onClick={() => {
            if (!canSubmit) {
              setShowAllErrors(true);
              return;
            }
            submit();
          }}
        >
          {filled.length ? `Submit (${filled.length})` : 'Submit'}
        </Button>
      </div>
    </div>
  );
}

export default ReceiptEntryPage;
