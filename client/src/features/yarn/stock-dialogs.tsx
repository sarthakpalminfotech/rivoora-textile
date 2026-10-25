import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  beamLabel,
  checkTake,
  formatKg,
  isBeamZone,
  parseKgText,
  TAKE_ERROR_TEXT,
  transferTargets,
  YARN_STOCK_WHAT_LABEL,
  YARN_ZONE_CONFIG,
  type Beam,
  type YarnStockWhat,
  type YarnZone,
} from '@rivoora/shared';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTransfer, useWithdraw, useYarnZone } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { KgInput, QualitySelect, Toggle2, ZoneChoice, ZoneTag } from './parts';

/** Tick in-stock beams of a zone (beam no · quality · taar / panna / meters). */
export function BeamChecklist({ beams, selected, onChange, invalid }: { beams: Beam[]; selected: number[]; onChange: (ids: number[]) => void; invalid?: boolean }) {
  if (!beams.length) return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-slate-500">No beams in this zone.</p>;
  const all = selected.length === beams.length;
  return (
    <div className={cn('overflow-hidden rounded-xl border', invalid ? 'border-destructive' : 'border-border')}>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-border bg-slate-50 px-3">
        <TickBox size="lg" checked={all} partial={selected.length > 0 && !all} onCheckedChange={(c) => onChange(c ? beams.map((b) => b.id) : [])} aria-label="Select all beams" />
        <span className="text-sm font-semibold text-slate-700">
          {selected.length ? `${selected.length} of ${beams.length} selected` : `Select all (${beams.length})`}
        </span>
      </label>
      <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto">
        {beams.map((b) => {
          const on = selected.includes(b.id);
          return (
            <li key={b.id}>
              <label className={cn('flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2', on && 'bg-primary-soft/50')}>
                <TickBox size="lg" checked={on} onCheckedChange={(c) => onChange(c ? [...selected, b.id] : selected.filter((x) => x !== b.id))} aria-label={beamLabel(b.beamNo)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-bold tabular-nums text-slate-900">{beamLabel(b.beamNo)}</span>
                    <span className="truncate text-sm font-medium text-slate-700">{b.quality.name}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    Taar {b.taar} · Panna {b.panna} · {b.meters.toLocaleString('en-IN')} m · {formatDate(b.createdAt)}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type What = YarnStockWhat;

/** The stock part shared by Transfer and Withdraw: What → quality + kg, or beams. */
function useStockPick(zone: YarnZone, open: boolean) {
  const zoneData = useYarnZone(zone, open);
  const [what, setWhat] = useState<What>('raw');
  const [qualityId, setQualityId] = useState<number | null>(null);
  const [kg, setKg] = useState('');
  const [beamIds, setBeamIds] = useState<number[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setWhat('raw');
      setQualityId(null);
      setKg('');
      setBeamIds([]);
      setNote('');
    }
  }, [open]);
  const stock = useMemo(
    () =>
      (zoneData.data?.qualities ?? [])
        .map((q) => ({ id: q.quality.id, name: q.quality.name, availableG: what === 'twisted' ? q.twistedG : q.rawG }))
        .filter((q) => q.availableG > 0),
    [zoneData.data, what],
  );
  const available = stock.find((q) => q.id === qualityId)?.availableG ?? 0;
  const grams = parseKgText(kg);
  const yarnError = !qualityId ? 'Select the quality' : grams === null ? 'Enter the kg' : checkTake(available, grams) ? TAKE_ERROR_TEXT[checkTake(available, grams)!] : null;
  return { zoneData, what, setWhat, qualityId, setQualityId, kg, setKg, beamIds, setBeamIds, note, setNote, stock, available, grams, yarnError };
}

function WhatPicker({ zone, value, onChange }: { zone: YarnZone; value: What; onChange: (w: What) => void }) {
  const options = (isBeamZone(zone) ? (['raw', 'twisted', 'beams'] as const) : (['raw', 'twisted'] as const)).map((w) => ({ value: w, label: YARN_STOCK_WHAT_LABEL[w] }));
  return <Toggle2 value={value} onChange={onChange} options={options} />;
}

function StockFields({ pick, tried, serverErr, zone }: { pick: ReturnType<typeof useStockPick>; tried: boolean; serverErr: { field: string; message: string } | null; zone: YarnZone }) {
  if (pick.zoneData.isPending) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (pick.what === 'beams') {
    return (
      <Field label="Beams" required error={(tried && !pick.beamIds.length ? 'Select at least one beam' : undefined) ?? (serverErr?.field === 'beamIds' ? serverErr.message : undefined)}>
        <BeamChecklist beams={pick.zoneData.data?.beams ?? []} selected={pick.beamIds} onChange={pick.setBeamIds} invalid={tried && !pick.beamIds.length} />
      </Field>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem]">
      <Field label="Quality" required error={tried && !pick.qualityId ? 'Select the quality' : undefined}>
        <QualitySelect
          value={pick.qualityId}
          onChange={(id) => pick.setQualityId(id)}
          only={pick.stock}
          invalid={tried && !pick.qualityId}
          placeholder={pick.stock.length ? 'Select quality' : `No ${pick.what} yarn in ${YARN_ZONE_CONFIG[zone].label}`}
        />
      </Field>
      <Field
        label="Kg"
        required
        error={(tried && pick.qualityId && pick.yarnError ? pick.yarnError : undefined) ?? (serverErr?.field === 'qtyKg' ? serverErr.message : undefined)}
        hint={
          pick.qualityId ? (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => pick.setKg(String(pick.available / 1000))}>
              Use all {formatKg(pick.available)}
            </button>
          ) : undefined
        }
      >
        <KgInput value={pick.kg} onValueChange={pick.setKg} invalid={tried && !!pick.qualityId && !!pick.yarnError} />
      </Field>
    </div>
  );
}

/** Transfer — From (this zone) → To (the other two; beams only Direct consumption ↔ Warping). */
export function TransferDialog({ open, onOpenChange, from }: { open: boolean; onOpenChange: (o: boolean) => void; from: YarnZone }) {
  const pick = useStockPick(from, open);
  const [to, setTo] = useState<YarnZone | null>(null);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  const transfer = useTransfer();
  const targets = transferTargets(from, pick.what);
  useEffect(() => {
    if (open) {
      setTo(null);
      setTried(false);
      setServerErr(null);
    }
  }, [open]);
  useEffect(() => {
    if (to && !targets.includes(to)) setTo(null);
  }, [targets, to]);

  const invalid = !to || (pick.what === 'beams' ? !pick.beamIds.length : !!pick.yarnError);
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (invalid) return;
    const body =
      pick.what === 'beams'
        ? { what: 'beams' as const, from: from as 'direct' | 'warping', to: to as 'direct' | 'warping', beamIds: pick.beamIds, note: pick.note.trim() || null }
        : { what: pick.what, from, to: to!, qualityId: pick.qualityId!, qtyKg: pick.grams! / 1000, note: pick.note.trim() || null };
    transfer.mutate(body, {
      onSuccess: () => {
        toast.success(
          `${pick.what === 'beams' ? `${pick.beamIds.length} beam${pick.beamIds.length === 1 ? '' : 's'}` : formatKg(pick.grams!)} moved to ${YARN_ZONE_CONFIG[to!].label}`,
        );
        onOpenChange(false);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
        toast.error(errorMessage(err));
      },
    });
  };

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Transfer"
      description={<>Move stock from {YARN_ZONE_CONFIG[from].label} to another zone.</>}
      busy={transfer.isPending}
      dirty={!!pick.kg || pick.beamIds.length > 0}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={transfer.isPending} label="Transfer" form="yarn-transfer-form" />}
    >
      <form
        id="yarn-transfer-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5"
      >
        <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
          <Field label="From">
            <div className="flex h-11 items-center">
              <ZoneTag zone={from} className="py-1.5 text-sm" />
            </div>
          </Field>
          <Field label="What" required>
            <WhatPicker zone={from} value={pick.what} onChange={pick.setWhat} />
          </Field>
        </div>
        <Field label="To" required error={tried && !to ? 'Pick the zone to move to' : serverErr?.field === 'to' ? serverErr.message : undefined}>
          <ZoneChoice value={to} onChange={setTo} zones={targets} invalid={tried && !to} compact aria-label="To zone" />
          {pick.what === 'beams' && <p className="mt-1.5 text-xs text-slate-500">Beams move only between Direct consumption and Warping.</p>}
        </Field>
        <StockFields pick={pick} tried={tried} serverErr={serverErr} zone={from} />
        <Field label="Note" htmlFor="tr-note">
          <Textarea id="tr-note" rows={2} maxLength={1000} value={pick.note} onChange={(e) => pick.setNote(e.target.value)} className="min-h-[72px]" />
        </Field>
      </form>
    </YarnDialog>
  );
}

/** Withdraw (Direct consumption): yarn used directly, or beams consumed (marked Consumed; no loom link). */
export function WithdrawDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const pick = useStockPick('direct', open);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  const withdraw = useWithdraw();
  useEffect(() => {
    if (open) {
      setTried(false);
      setServerErr(null);
    }
  }, [open]);
  const invalid = pick.what === 'beams' ? !pick.beamIds.length : !!pick.yarnError;
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (invalid) return;
    const body =
      pick.what === 'beams'
        ? { what: 'beams' as const, zone: 'direct' as const, beamIds: pick.beamIds, note: pick.note.trim() || null }
        : { what: pick.what, zone: 'direct' as const, qualityId: pick.qualityId!, qtyKg: pick.grams! / 1000, note: pick.note.trim() || null };
    withdraw.mutate(body, {
      onSuccess: () => {
        toast.success(pick.what === 'beams' ? `${pick.beamIds.length} beam${pick.beamIds.length === 1 ? '' : 's'} consumed` : `${formatKg(pick.grams!)} withdrawn`);
        onOpenChange(false);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
        toast.error(errorMessage(err));
      },
    });
  };
  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Withdraw"
      description="Yarn or beams used directly from Direct consumption."
      busy={withdraw.isPending}
      dirty={!!pick.kg || pick.beamIds.length > 0}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={withdraw.isPending} label={pick.what === 'beams' ? 'Mark consumed' : 'Withdraw'} form="yarn-withdraw-form" />}
    >
      <form
        id="yarn-withdraw-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5"
      >
        <Field label="What" required>
          <WhatPicker zone="direct" value={pick.what} onChange={pick.setWhat} />
        </Field>
        <StockFields pick={pick} tried={tried} serverErr={serverErr} zone="direct" />
        <Field label="Note" htmlFor="wd-note" hint={pick.what === 'beams' ? 'e.g. which loom it went to' : undefined}>
          <Textarea id="wd-note" rows={2} maxLength={1000} value={pick.note} onChange={(e) => pick.setNote(e.target.value)} className="min-h-[72px]" />
        </Field>
      </form>
    </YarnDialog>
  );
}
