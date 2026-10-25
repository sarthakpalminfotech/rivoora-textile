import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { formatKg, overReceiptText, parseKgText, YARN_ZONE_CONFIG, type YarnZone } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useReceiveYarn, useYarnPo } from './api';
import { FormHeader, Kg, KgInput, Section, YarnPoStatusBadge, ZoneChoice } from './parts';

/**
 * Sprint 17 — Receive challan (full screen). Challan no · Date share a row on tablets, the zone is three big options,
 * and every PO line is one table row from 768px (quality · ordered · pending · received kg · boxes). More than pending
 * is allowed with an amber warning. Saving adds raw yarn to the chosen zone in the ledger.
 */
export default function YarnReceivePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data: po, isPending, isError, error, refetch } = useYarnPo(id);
  const receive = useReceiveYarn(id);
  usePageTitle(po ? `Receive · PO ${po.poNo}` : 'Receive challan');

  const [challanNo, setChallanNo] = useState('');
  const [date, setDate] = useState(toApiDate(new Date()));
  const [zone, setZone] = useState<YarnZone | null>(null);
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [boxes, setBoxes] = useState<Record<number, string>>({});
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);

  const close = () => navigate(`/yarn-po/${id}`);
  const lines = po?.lines ?? [];
  const entered = useMemo(() => lines.map((l) => ({ line: l, g: parseKgText(qty[l.id] ?? '') ?? 0, bad: (qty[l.id] ?? '') !== '' && parseKgText(qty[l.id] ?? '') === null })), [lines, qty]);
  const totalG = entered.reduce((s, e) => s + e.g, 0);
  const over = overReceiptText(entered.map((e) => ({ qualityName: e.line.quality.name, pendingG: e.line.pendingG, qtyG: e.g })));
  const errors = {
    challanNo: !challanNo.trim() ? 'Enter the challan number' : undefined,
    date: !date ? 'Pick the date' : undefined,
    zone: !zone ? 'Pick the zone the yarn goes to' : undefined,
    lines: totalG <= 0 ? 'Enter the received kg on at least one line' : entered.some((e) => e.bad) ? 'Use a number with at most 3 decimals' : undefined,
  };

  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (Object.values(errors).some(Boolean)) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    receive.mutate(
      {
        challanNo: challanNo.trim(),
        date,
        zone: zone!,
        notes: notes.trim() || null,
        lines: entered.map((e) => ({ poLineId: e.line.id, qtyKg: e.g / 1000, boxes: boxes[e.line.id] ? Number(boxes[e.line.id]) : null })),
      },
      {
        onSuccess: (r) => {
          toast.success(`${formatKg(r.totalG)} received into ${YARN_ZONE_CONFIG[r.zone].label}`);
          navigate(`/yarn-po/${id}`, { replace: true });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
          toast.error(errorMessage(err));
        },
      },
    );
  };

  if (isPending || isError || !po) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <FormHeader title="Receive challan" onClose={close} />
        <div className="mx-auto w-full max-w-6xl px-4 py-6">{isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : <Skeleton className="h-72 w-full rounded-2xl" />}</div>
      </div>
    );
  }
  if (!po.canReceive) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <FormHeader title={`Receive · PO ${po.poNo}`} onClose={close} />
        <div className="mx-auto w-full max-w-xl px-4 py-12 text-center">
          <p className="font-semibold text-slate-900">This PO can’t receive yarn now.</p>
          <p className="mt-1 text-sm text-slate-500">It is {po.status.replace('_', ' ')}.</p>
          <Button className="mt-4" variant="secondary" onClick={close}>
            Back to the PO
          </Button>
        </div>
      </div>
    );
  }

  const show = (m?: string) => (tried ? m : undefined);
  const qtyField = (lineId: number, i: number, label?: string) => (
    <KgInput
      value={qty[lineId] ?? ''}
      onValueChange={(v) => setQty((q) => ({ ...q, [lineId]: v }))}
      invalid={(tried && !!errors.lines && totalG <= 0) || serverErr?.field === `lines.${i}.qtyKg`}
      aria-label={label ?? 'Received kg'}
      className="text-base font-semibold"
    />
  );
  const boxesField = (lineId: number) => (
    <Input
      inputMode="numeric"
      autoComplete="off"
      value={boxes[lineId] ?? ''}
      onChange={(e) => setBoxes((b) => ({ ...b, [lineId]: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
      className="text-right tabular-nums"
      aria-label="Boxes / cones"
    />
  );

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <FormHeader
        title={`Receive · PO ${po.poNo}`}
        onClose={close}
        action={
          <Button className="hidden md:inline-flex" onClick={submit} loading={receive.isPending}>
            Save challan
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-white px-4 py-3 shadow-soft">
          <span className="font-bold text-slate-900">PO {po.poNo}</span>
          <YarnPoStatusBadge status={po.status} />
          <span className="text-sm text-slate-500">{formatDate(po.poDate)}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 sm:text-right">{po.party.name}</span>
        </div>

        <Section title="Challan">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[14rem_12rem_minmax(0,1fr)]">
            <Field label="Challan no." htmlFor="rc-no" required error={show(errors.challanNo) ?? (serverErr?.field === 'challanNo' ? serverErr.message : undefined)}>
              <Input id="rc-no" autoFocus autoComplete="off" maxLength={40} value={challanNo} onChange={(e) => setChallanNo(e.target.value)} invalid={tried && !!errors.challanNo} className="font-semibold" />
            </Field>
            <Field label="Date" htmlFor="rc-date" required error={show(errors.date)}>
              <DatePicker id="rc-date" value={date} onChange={setDate} invalid={tried && !!errors.date} />
            </Field>
            <Field label="Notes" htmlFor="rc-notes" className="md:col-span-2 lg:col-span-1">
              <Textarea id="rc-notes" rows={1} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-11 py-2.5" />
            </Field>
          </div>
          <Field label="Zone — where the yarn goes" required error={show(errors.zone)} className="mt-4">
            <ZoneChoice value={zone} onChange={setZone} invalid={tried && !!errors.zone} />
          </Field>
        </Section>

        <Section title="Received yarn">
          {tried && errors.lines && <p className="mb-2 text-sm font-medium text-destructive">{errors.lines}</p>}
          {serverErr?.field.startsWith('lines') && <p className="mb-2 text-sm font-medium text-destructive">{serverErr.message}</p>}
          {/* Tablet / desktop: one row per PO line */}
          <div className="hidden md:block">
            <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_10rem_8rem] gap-x-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Quality</span>
              <span className="text-right">Ordered</span>
              <span className="text-right">Pending</span>
              <span className="text-right">Received kg</span>
              <span className="text-right">Boxes / cones</span>
            </div>
            {entered.map((e, i) => (
              <div key={e.line.id} className={cn('grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_10rem_8rem] items-center gap-x-3 border-b border-border py-2.5 last:border-0', e.g > e.line.pendingG && 'bg-amber-50/60')}>
                <span className="truncate font-semibold text-slate-900">{e.line.quality.name}</span>
                <Kg g={e.line.qtyG} className="text-right text-sm text-slate-600" />
                <Kg g={e.line.pendingG} className="text-right text-sm font-semibold text-amber-700" />
                {qtyField(e.line.id, i, `Received kg ${e.line.quality.name}`)}
                {boxesField(e.line.id)}
              </div>
            ))}
          </div>
          {/* Phones */}
          <ul className="space-y-3 md:hidden">
            {entered.map((e, i) => (
              <li key={e.line.id} className={cn('rounded-xl border border-border p-3', e.g > e.line.pendingG && 'border-amber-300 bg-amber-50/60')}>
                <p className="font-semibold text-slate-900">{e.line.quality.name}</p>
                <p className="text-sm text-slate-500">
                  Ordered <Kg g={e.line.qtyG} /> · Pending <Kg g={e.line.pendingG} className="font-semibold text-amber-700" />
                </p>
                <div className="mt-2 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
                  <Field label="Received kg">{qtyField(e.line.id, i)}</Field>
                  <Field label="Boxes / cones">{boxesField(e.line.id)}</Field>
                </div>
              </li>
            ))}
          </ul>
          {over && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <b>More than pending:</b> {over}. You can still save.
              </span>
            </p>
          )}
        </Section>

        <div className="kb-bar sticky bottom-0 z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-t-2xl md:border-x">
          <div className="flex items-center gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">This challan</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">
                {formatKg(totalG)}
                {zone && <span className="ml-2 text-sm font-semibold text-slate-500">→ {YARN_ZONE_CONFIG[zone].label}</span>}
              </p>
            </div>
            <Button type="submit" size="lg" className="ml-auto min-w-40" loading={receive.isPending}>
              Save challan
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
