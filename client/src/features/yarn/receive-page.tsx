import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { formatKg, overReceiptText, parseKgText, YARN_ZONES, type YarnZone } from '@rivoora/shared';
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
import { formatDate, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCheckLotNo, useReceiveYarn, useYarnPo } from './api';
import { FormHeader, KgInput, Section, YarnPoStatusBadge, ZoneChoice } from './parts';

interface AllocationRow {
  key: number;
  zone: YarnZone | null;
  kg: string;
}
interface LotRow {
  key: number;
  poLineId: number | null;
  lotNo: string;
  kg: string;
  boxes: string;
  allocations: AllocationRow[];
}

let rowKey = 0;
const newAllocation = (): AllocationRow => ({ key: ++rowKey, zone: null, kg: '' });
const newLot = (): LotRow => ({ key: ++rowKey, poLineId: null, lotNo: '', kg: '', boxes: '', allocations: [] });

/** The live "lot no. is free" check — debounced, shown as a status icon beside the field. */
function LotNoCheck({ partyId, lotNo }: { partyId: number; lotNo: string }) {
  const debounced = useDebounce(lotNo.trim(), 300);
  const check = useCheckLotNo(partyId, debounced);
  if (!debounced) return null;
  if (check.isFetching || debounced !== lotNo.trim()) return <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Checking" />;
  if (check.data?.available) return <CheckCircle2 className="size-5 text-emerald-600" aria-label="Available" />;
  if (check.data) return <XCircle className="size-5 text-destructive" aria-label="Already used" />;
  return null;
}

/** `parseKgText` already returns grams — no further scaling needed anywhere these figures are used. */
function lotFigures(lot: LotRow) {
  const kgG = parseKgText(lot.kg) ?? 0;
  const allocG = lot.allocations.reduce((s, a) => s + (parseKgText(a.kg) ?? 0), 0);
  const unplacedG = Math.max(0, kgG - allocG);
  const overAllocated = allocG > kgG + 1e-9;
  return { kgG, allocG, unplacedG, overAllocated };
}

/**
 * Sprint 20 — Receive challan: one or more lots (PO line/quality, lot no, kg, boxes), each split across zones
 * (unallocated kg goes to Direct consumption automatically). Full screen; lot cards stack, a compact grid from
 * 768px. A tablet-specific layout pass is a follow-up (spec §10).
 */
export default function YarnReceivePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data: po, isPending, isError, error, refetch } = useYarnPo(id);
  const receive = useReceiveYarn(id);
  usePageTitle(po ? `Receive · PO ${po.poNo}` : 'Receive challan');

  const [challanNo, setChallanNo] = useState('');
  const [date, setDate] = useState(toApiDate(new Date()));
  const [notes, setNotes] = useState('');
  const [lots, setLots] = useState<LotRow[]>(() => [newLot()]);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);

  const close = () => navigate(`/yarn-po/${id}`);
  const poLines = po?.lines ?? [];

  const setLot = (key: number, patch: Partial<LotRow>) => setLots((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setAllocation = (lotKey: number, allocKey: number, patch: Partial<AllocationRow>) =>
    setLots((ls) => ls.map((l) => (l.key === lotKey ? { ...l, allocations: l.allocations.map((a) => (a.key === allocKey ? { ...a, ...patch } : a)) } : l)));

  const lotErrors = (lot: LotRow) => {
    const f = lotFigures(lot);
    return {
      poLineId: !lot.poLineId ? 'Select the PO line' : undefined,
      lotNo: !lot.lotNo.trim() ? 'Enter the lot no.' : undefined,
      kg: f.kgG <= 0 ? 'Enter the kg' : undefined,
      allocations: f.overAllocated ? "Allocations can't exceed the lot's kg" : undefined,
    };
  };
  const allErrors = useMemo(() => lots.map(lotErrors), [lots]);
  const headerErrors = {
    challanNo: !challanNo.trim() ? 'Enter the challan number' : undefined,
    date: !date ? 'Pick the date' : undefined,
  };
  const duplicateLotNoIdx = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<number>();
    lots.forEach((l, i) => {
      const key = l.lotNo.trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) dupes.add(i);
      seen.add(key);
    });
    return dupes;
  }, [lots]);

  const totalG = lots.reduce((s, l) => s + (parseKgText(l.kg) ?? 0), 0);
  const zoneTotalsG = useMemo(() => {
    const m = new Map<YarnZone, number>();
    for (const l of lots) {
      const f = lotFigures(l);
      for (const a of l.allocations) {
        const g = parseKgText(a.kg) ?? 0;
        if (a.zone && g > 0) m.set(a.zone, (m.get(a.zone) ?? 0) + g);
      }
      if (f.unplacedG > 0) m.set('direct', (m.get('direct') ?? 0) + f.unplacedG);
    }
    return m;
  }, [lots]);
  const receivedByLineG = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of lots) if (l.poLineId) m.set(l.poLineId, (m.get(l.poLineId) ?? 0) + (parseKgText(l.kg) ?? 0));
    return m;
  }, [lots]);
  const over = overReceiptText(poLines.map((l) => ({ qualityName: l.quality.name, pendingG: l.pendingG, qtyG: receivedByLineG.get(l.id) ?? 0 })));

  const formInvalid = Object.values(headerErrors).some(Boolean) || allErrors.some((e) => Object.values(e).some(Boolean)) || duplicateLotNoIdx.size > 0;

  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (formInvalid) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    receive.mutate(
      {
        challanNo: challanNo.trim(),
        date,
        notes: notes.trim() || null,
        lots: lots.map((l) => ({
          poLineId: l.poLineId!,
          lotNo: l.lotNo.trim(),
          qtyKg: parseKgText(l.kg)! / 1000,
          boxes: l.boxes ? Number(l.boxes) : null,
          allocations: l.allocations.filter((a) => a.zone && (parseKgText(a.kg) ?? 0) > 0).map((a) => ({ zone: a.zone!, qtyKg: parseKgText(a.kg)! / 1000 })),
        })),
      },
      {
        onSuccess: (r) => {
          toast.success(`${formatKg(r.totalG)} received`);
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
  const poLineOptions = poLines.map((l) => ({ value: l.id, label: l.quality.name, description: `Ordered ${formatKg(l.qtyG)} · Pending ${formatKg(l.pendingG)}` }));

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
            <Field label="Challan no." htmlFor="rc-no" required error={show(headerErrors.challanNo) ?? (serverErr?.field === 'challanNo' ? serverErr.message : undefined)}>
              <Input id="rc-no" autoFocus autoComplete="off" maxLength={40} value={challanNo} onChange={(e) => setChallanNo(e.target.value)} invalid={tried && !!headerErrors.challanNo} className="font-semibold" />
            </Field>
            <Field label="Date" htmlFor="rc-date" required error={show(headerErrors.date)}>
              <DatePicker id="rc-date" value={date} onChange={setDate} invalid={tried && !!headerErrors.date} />
            </Field>
            <Field label="Notes" htmlFor="rc-notes" className="md:col-span-2 lg:col-span-1">
              <Textarea id="rc-notes" rows={1} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-11 py-2.5" />
            </Field>
          </div>
        </Section>

        <Section
          title={`Lots (${lots.length})`}
          action={
            <Button variant="secondary" size="sm" onClick={() => setLots((ls) => [...ls, newLot()])}>
              <Plus /> Add lot
            </Button>
          }
        >
          {serverErr?.field.startsWith('lots') && <p className="mb-3 text-sm font-medium text-destructive">{serverErr.message}</p>}
          <ol className="space-y-4">
            {lots.map((lot, i) => {
              const e = allErrors[i];
              const f = lotFigures(lot);
              const dup = duplicateLotNoIdx.has(i);
              const usedZones = lot.allocations.map((a) => a.zone).filter((z): z is YarnZone => !!z);
              return (
                <li key={lot.key} className="rounded-2xl border border-border p-3 md:p-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem_7rem_2.75rem] md:items-start">
                    <Field label="PO line / quality" required error={tried ? e.poLineId : undefined}>
                      <Select value={lot.poLineId} onChange={(v) => setLot(lot.key, { poLineId: v })} options={poLineOptions} placeholder="Select line" invalid={tried && !!e.poLineId} aria-label="PO line" />
                    </Field>
                    <Field label="Lot no." required error={(tried ? e.lotNo : undefined) ?? (dup ? 'This lot no. is used twice' : undefined)}>
                      <Input
                        autoComplete="off"
                        maxLength={40}
                        value={lot.lotNo}
                        onChange={(ev) => setLot(lot.key, { lotNo: ev.target.value })}
                        invalid={(tried && !!e.lotNo) || dup}
                        suffix={po.party.id ? <LotNoCheck partyId={po.party.id} lotNo={lot.lotNo} /> : undefined}
                        aria-label="Lot no."
                      />
                    </Field>
                    <Field label="Kg" required error={tried ? e.kg : undefined}>
                      <KgInput value={lot.kg} onValueChange={(v) => setLot(lot.key, { kg: v })} invalid={tried && !!e.kg} aria-label="Lot kg" />
                    </Field>
                    <Field label="Boxes">
                      <Input
                        inputMode="numeric"
                        autoComplete="off"
                        value={lot.boxes}
                        onChange={(ev) => setLot(lot.key, { boxes: ev.target.value.replace(/\D/g, '').slice(0, 6) })}
                        className="text-right tabular-nums"
                        aria-label="Boxes / cones"
                      />
                    </Field>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-6 text-slate-400 hover:bg-destructive-soft hover:text-destructive md:mt-0"
                      disabled={lots.length === 1}
                      onClick={() => setLots((ls) => ls.filter((x) => x.key !== lot.key))}
                      aria-label={`Remove lot ${i + 1}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <div className="mt-3 rounded-xl bg-muted/40 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Where this lot goes</p>
                    {lot.allocations.length === 0 && <p className="text-sm text-slate-500">All of it → Direct consumption (nothing allocated).</p>}
                    <ul className="space-y-2">
                      {lot.allocations.map((a) => (
                        <li key={a.key} className="flex flex-wrap items-center gap-2">
                          <ZoneChoice value={a.zone} onChange={(z) => setAllocation(lot.key, a.key, { zone: z })} zones={YARN_ZONES.filter((z) => z === a.zone || !usedZones.includes(z))} compact />
                          <KgInput value={a.kg} onValueChange={(v) => setAllocation(lot.key, a.key, { kg: v })} className="max-w-32" aria-label="Allocation kg" />
                          <Button variant="ghost" size="icon-sm" className="text-slate-400" onClick={() => setLot(lot.key, { allocations: lot.allocations.filter((x) => x.key !== a.key) })} aria-label="Remove allocation">
                            <Trash2 />
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      {lot.allocations.length < YARN_ZONES.length && (
                        <Button type="button" variant="secondary" size="sm" onClick={() => setLot(lot.key, { allocations: [...lot.allocations, newAllocation()] })}>
                          <Plus /> Add allocation
                        </Button>
                      )}
                      {f.unplacedG > 0 && lot.allocations.length > 0 && <p className="text-sm text-slate-600">{formatKg(f.unplacedG)} not placed → Direct consumption</p>}
                      {f.overAllocated && <p className="text-sm font-medium text-destructive">{e.allocations}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {over && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <b>More than pending:</b> {over}. You can still save.
              </span>
            </p>
          )}
        </Section>

        <Section title="Summary">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Challan total</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{formatKg(totalG)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">By zone</p>
              <p className={cn('text-sm font-semibold text-slate-700', zoneTotalsG.size === 0 && 'text-slate-400')}>
                {zoneTotalsG.size ? [...zoneTotalsG.entries()].map(([z, g]) => `${z} ${formatKg(g)}`).join(' · ') : '—'}
              </p>
            </div>
          </div>
        </Section>

        <div className="kb-bar sticky bottom-0 z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-t-2xl md:border-x">
          <div className="flex items-center gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">This challan</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{formatKg(totalG)}</p>
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
