import { CheckCircle2, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { amountPaise, formatKg, MAX_PO_LINES, parseKgText, ratePaise } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { ApiError, errorMessage } from '@/lib/api';
import { toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { YarnPartyFormDialog } from '../masters/yarn/yarn-party-form';
import { YarnQualityFormDialog } from '../masters/yarn/yarn-quality-form';
import { useCreateYarnPo, usePoNoCheck, useUpdateYarnPo, useYarnPartyLookup, useYarnPo } from './api';
import { cleanDecimal, FormHeader, KgInput, money, numOrNull, QualitySelect, Section } from './parts';

interface Line {
  key: number;
  qualityId: number | null;
  qualityName?: string;
  qty: string;
  rate: string;
}

let lineKey = 0;
const newLine = (): Line => ({ key: ++lineKey, qualityId: null, qty: '', rate: '' });

type LineErrors = Partial<Record<'qualityId' | 'qty' | 'rate', string>>;

function lineErrors(l: Line, all: Line[]): LineErrors {
  const e: LineErrors = {};
  if (!l.qualityId) e.qualityId = 'Select the yarn quality';
  else if (all.some((o) => o.key !== l.key && o.qualityId === l.qualityId && all.indexOf(o) < all.indexOf(l))) e.qualityId = 'This quality is already on the PO';
  const g = parseKgText(l.qty);
  if (g === null || g <= 0) e.qty = 'Enter the kg';
  const r = numOrNull(l.rate);
  if (r === null || r < 0) e.rate = 'Enter the rate';
  return e;
}

/**
 * Sprint 17 — Create / Edit Yarn PO (full screen). Header fields sit in a grid (2 columns on tablet portrait, 3 from
 * 1024px: Date · PO no · Party), the remark spans the row; lines are a real table row each from 768px (quality wide,
 * kg / rate / amount narrow) and stacked cards on phones. After yarn was received only the remark can change.
 */
export default function YarnPoFormPage() {
  const params = useParams();
  const editId = params.id ? Number(params.id) : 0;
  const isEdit = editId > 0;
  const navigate = useNavigate();
  const existing = useYarnPo(editId);
  const create = useCreateYarnPo();
  const update = useUpdateYarnPo(editId);
  const saving = create.isPending || update.isPending;

  const [poDate, setPoDate] = useState(toApiDate(new Date()));
  const [poNo, setPoNo] = useState('');
  const [partyId, setPartyId] = useState<number | null>(null);
  const [partyName, setPartyName] = useState<string | undefined>();
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  const [partyFormOpen, setPartyFormOpen] = useState(false);
  const [qualityFormFor, setQualityFormFor] = useState<number | null>(null);
  const loaded = useRef(false);

  const remarkOnly = isEdit && !!existing.data && !existing.data.canEditAll;
  usePageTitle(isEdit ? (existing.data ? `Edit PO ${existing.data.poNo}` : 'Edit PO') : 'New Yarn PO');

  useEffect(() => {
    const po = existing.data;
    if (!po || loaded.current) return;
    loaded.current = true;
    setPoDate(po.poDate);
    setPoNo(String(po.poNo));
    setPartyId(po.party.id);
    setPartyName(po.party.name);
    setRemark(po.remark ?? '');
    setLines(
      po.lines.map((l) => ({
        key: ++lineKey,
        qualityId: l.quality.id,
        qualityName: l.quality.name,
        qty: String(l.qtyG / 1000),
        rate: l.ratePaise === null ? '' : String(l.ratePaise / 100),
      })),
    );
  }, [existing.data]);

  const parties = useYarnPartyLookup('');
  const poNoNum = /^\d+$/.test(poNo) ? Number(poNo) : null;
  const debouncedNo = useDebounce(poNoNum, 300);
  const noCheck = usePoNoCheck(remarkOnly ? null : debouncedNo, isEdit ? editId : undefined);
  const noTaken = noCheck.data && debouncedNo === poNoNum && !noCheck.data.available;

  const errs = useMemo(() => lines.map((l) => lineErrors(l, lines)), [lines]);
  const headerErrors = {
    poDate: !poDate ? 'Pick the PO date' : undefined,
    poNo: !poNoNum || poNoNum < 1 ? 'Enter the PO number' : noTaken ? `PO no. ${poNoNum} is already used` : undefined,
    partyId: !partyId ? 'Select the party' : undefined,
  };
  const totals = useMemo(() => {
    let g = 0;
    let paise = 0;
    for (const l of lines) {
      const lg = parseKgText(l.qty) ?? 0;
      const r = numOrNull(l.rate) ?? 0;
      g += lg;
      paise += amountPaise(lg, ratePaise(r));
    }
    return { g, paise };
  }, [lines]);

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const show = (msg: string | undefined) => (tried ? msg : undefined);
  const serverFor = (field: string) => (serverErr?.field === field ? serverErr.message : undefined);

  const close = () => navigate(isEdit ? `/yarn-po/${editId}` : '/yarn-po');

  const submit = () => {
    setTried(true);
    setServerErr(null);
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
      toast.error(errorMessage(err));
    };
    if (remarkOnly) {
      update.mutate({ remark: remark.trim() || null }, { onSuccess: () => (toast.success('Remark saved'), navigate(`/yarn-po/${editId}`)), onError });
      return;
    }
    if (Object.values(headerErrors).some(Boolean) || errs.some((e) => Object.keys(e).length)) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    const body = {
      poNo: poNoNum!,
      poDate,
      partyId: partyId!,
      remark: remark.trim() || null,
      lines: lines.map((l) => ({ qualityId: l.qualityId!, qtyKg: parseKgText(l.qty)! / 1000, rate: Number(l.rate) })),
    };
    if (isEdit) update.mutate(body, { onSuccess: (r) => (toast.success(`PO ${r.poNo} saved`), navigate(`/yarn-po/${r.id}`)), onError });
    else create.mutate(body, { onSuccess: (r) => (toast.success(`PO ${r.poNo} created`), navigate(`/yarn-po/${r.id}`, { replace: true })), onError });
  };

  if (isEdit && (existing.isPending || existing.isError)) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <FormHeader title="Edit PO" onClose={close} />
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">
          {existing.isError ? <ErrorState error={existing.error} onRetry={() => void existing.refetch()} /> : <Skeleton className="h-64 w-full rounded-2xl" />}
        </div>
      </div>
    );
  }

  const partyOptions = (parties.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const noStatus =
    remarkOnly || !poNoNum ? null : noCheck.isFetching || debouncedNo !== poNoNum ? (
      <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Checking" />
    ) : noCheck.data?.available ? (
      <CheckCircle2 className="size-5 text-emerald-600" aria-label="Available" />
    ) : noCheck.data ? (
      <XCircle className="size-5 text-destructive" aria-label="Taken" />
    ) : null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <FormHeader
        title={isEdit ? `Edit PO ${existing.data?.poNo ?? ''}` : 'New Yarn PO'}
        onClose={close}
        action={
          <Button className="hidden md:inline-flex" onClick={submit} loading={saving}>
            {remarkOnly ? 'Save remark' : isEdit ? 'Save changes' : 'Save PO'}
          </Button>
        }
      />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-4 md:py-6"
      >
        {remarkOnly && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Yarn has been received on this PO — only the remark can change now.
          </p>
        )}
        <Section title="PO details">
          <fieldset disabled={remarkOnly} className="grid gap-4 md:grid-cols-2 lg:grid-cols-[12rem_12rem_minmax(0,1fr)]">
            <Field label="Date" htmlFor="po-date" required error={show(headerErrors.poDate)}>
              <DatePicker id="po-date" value={poDate} onChange={setPoDate} invalid={tried && !!headerErrors.poDate} />
            </Field>
            <Field label="PO no." htmlFor="po-no" required error={show(headerErrors.poNo) ?? (noTaken ? headerErrors.poNo : undefined) ?? serverFor('poNo')}>
              <Input
                id="po-no"
                inputMode="numeric"
                autoComplete="off"
                autoFocus={!isEdit}
                value={poNo}
                onChange={(e) => setPoNo(e.target.value.replace(/\D/g, '').slice(0, 9))}
                invalid={(tried && !!headerErrors.poNo) || !!noTaken}
                className="text-base font-semibold tabular-nums"
                suffix={noStatus}
              />
            </Field>
            <Field label="Party" htmlFor="po-party" required error={show(headerErrors.partyId) ?? serverFor('partyId')} className="md:col-span-2 lg:col-span-1">
              <Select
                id="po-party"
                value={partyId}
                onChange={(v, o) => {
                  setPartyId(v);
                  setPartyName(o.label);
                }}
                options={partyOptions}
                selectedLabel={partyName}
                placeholder="Select party"
                searchable
                searchPlaceholder="Search parties…"
                loading={parties.isPending}
                emptyText="No parties yet"
                invalid={tried && !!headerErrors.partyId}
                action={
                  !remarkOnly && (
                    <Button variant="secondary" size="icon" className="shrink-0" onClick={() => setPartyFormOpen(true)} aria-label="Add new yarn party" title="Add new yarn party">
                      <Plus className="!size-5" />
                    </Button>
                  )
                }
              />
            </Field>
          </fieldset>
          <Field label="Remark" htmlFor="po-remark" className="mt-4">
            <Textarea id="po-remark" rows={2} maxLength={2000} value={remark} onChange={(e) => setRemark(e.target.value)} className="min-h-[72px]" />
          </Field>
        </Section>

        <Section
          title={`Yarn lines (${lines.length})`}
          action={
            !remarkOnly &&
            lines.length < MAX_PO_LINES && (
              <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                <Plus /> Add line
              </Button>
            )
          }
        >
          {serverErr?.field.startsWith('lines') && <p className="mb-3 text-sm font-medium text-destructive">{serverErr.message}</p>}
          {/* Tablet / desktop: one table row per line */}
          <div className="hidden md:block">
            <div className="grid grid-cols-[minmax(0,1fr)_8rem_7.5rem_6.5rem_2.75rem] lg:grid-cols-[2rem_minmax(0,1fr)_9.5rem_9rem_8.5rem_2.75rem] gap-x-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className="hidden lg:block">#</span>
              <span>Yarn quality *</span>
              <span className="text-right">Qty (kg) *</span>
              <span className="text-right">Rate (₹/kg) *</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            <ol>
              {lines.map((l, i) => {
                const e = errs[i];
                const g = parseKgText(l.qty) ?? 0;
                return (
                  <li key={l.key} className="grid grid-cols-[minmax(0,1fr)_8rem_7.5rem_6.5rem_2.75rem] lg:grid-cols-[2rem_minmax(0,1fr)_9.5rem_9rem_8.5rem_2.75rem] items-start gap-x-3 border-b border-border py-2.5 last:border-0">
                    <span className="hidden pt-3 text-sm font-semibold tabular-nums text-slate-400 lg:block">{i + 1}</span>
                    <div>
                      <QualitySelect
                        value={l.qualityId}
                        selectedLabel={l.qualityName}
                        onChange={(id, q) => setLine(l.key, { qualityId: id, qualityName: q?.name })}
                        taken={lines.filter((o) => o.key !== l.key && o.qualityId).map((o) => o.qualityId!)}
                        invalid={tried && !!e.qualityId}
                        disabled={remarkOnly}
                        onAdd={remarkOnly ? undefined : () => setQualityFormFor(l.key)}
                      />
                      {tried && e.qualityId && <p className="mt-1 text-[13px] font-medium text-destructive">{e.qualityId}</p>}
                    </div>
                    <div>
                      <KgInput value={l.qty} onValueChange={(v) => setLine(l.key, { qty: v })} invalid={tried && !!e.qty} disabled={remarkOnly} aria-label={`Quantity line ${i + 1}`} />
                      {tried && e.qty && <p className="mt-1 text-right text-[13px] font-medium text-destructive">{e.qty}</p>}
                    </div>
                    <div>
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        value={l.rate}
                        onChange={(ev) => setLine(l.key, { rate: cleanDecimal(ev.target.value, 2, 7) })}
                        invalid={tried && !!e.rate}
                        disabled={remarkOnly}
                        prefix={<span className="text-sm">₹</span>}
                        className="text-right tabular-nums"
                        aria-label={`Rate line ${i + 1}`}
                      />
                      {tried && e.rate && <p className="mt-1 text-right text-[13px] font-medium text-destructive">{e.rate}</p>}
                    </div>
                    <span className="pt-3 text-right text-sm font-semibold tabular-nums text-slate-800">{money(amountPaise(g, ratePaise(numOrNull(l.rate) ?? 0)))}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-slate-400 hover:bg-destructive-soft hover:text-destructive"
                      disabled={remarkOnly || lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ol>
          </div>
          {/* Phones: one card per line */}
          <ol className="space-y-3 md:hidden">
            {lines.map((l, i) => {
              const e = errs[i];
              const g = parseKgText(l.qty) ?? 0;
              return (
                <li key={l.key} className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-500">Line {i + 1}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-slate-400"
                      disabled={remarkOnly || lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Field label="Yarn quality" required error={tried ? e.qualityId : undefined}>
                    <QualitySelect
                      value={l.qualityId}
                      selectedLabel={l.qualityName}
                      onChange={(id, q) => setLine(l.key, { qualityId: id, qualityName: q?.name })}
                      taken={lines.filter((o) => o.key !== l.key && o.qualityId).map((o) => o.qualityId!)}
                      invalid={tried && !!e.qualityId}
                      disabled={remarkOnly}
                      onAdd={remarkOnly ? undefined : () => setQualityFormFor(l.key)}
                    />
                  </Field>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Quantity (kg)" required error={tried ? e.qty : undefined}>
                      <KgInput value={l.qty} onValueChange={(v) => setLine(l.key, { qty: v })} invalid={tried && !!e.qty} disabled={remarkOnly} />
                    </Field>
                    <Field label="Rate (₹/kg)" required error={tried ? e.rate : undefined}>
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        value={l.rate}
                        onChange={(ev) => setLine(l.key, { rate: cleanDecimal(ev.target.value, 2, 7) })}
                        invalid={tried && !!e.rate}
                        disabled={remarkOnly}
                        className="text-right tabular-nums"
                      />
                    </Field>
                  </div>
                  <p className="mt-2 text-right text-sm text-slate-500">
                    Amount <span className="font-semibold tabular-nums text-slate-800">{money(amountPaise(g, ratePaise(numOrNull(l.rate) ?? 0)))}</span>
                  </p>
                </li>
              );
            })}
          </ol>
        </Section>

        {/* Footer: totals + Save (lifted above the keyboard) */}
        <div className="kb-bar sticky bottom-0 z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-t-2xl md:border-x">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{formatKg(totals.g)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Amount</p>
              <p className={cn('text-lg font-bold tabular-nums text-slate-900', remarkOnly && 'text-slate-500')}>{money(totals.paise)}</p>
            </div>
            <Button type="submit" size="lg" className="ml-auto min-w-40" loading={saving}>
              {remarkOnly ? 'Save remark' : isEdit ? 'Save changes' : 'Save PO'}
            </Button>
          </div>
        </div>
      </form>

      <YarnPartyFormDialog
        open={partyFormOpen}
        onOpenChange={setPartyFormOpen}
        onSaved={(p) => {
          setPartyId(p.id);
          setPartyName(p.name);
        }}
      />
      <YarnQualityFormDialog
        open={qualityFormFor !== null}
        onOpenChange={(o) => !o && setQualityFormFor(null)}
        onSaved={(q) => {
          if (qualityFormFor !== null) setLine(qualityFormFor, { qualityId: q.id, qualityName: q.name });
        }}
      />
    </div>
  );
}
