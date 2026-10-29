import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  availableText,
  checkTake,
  formatKg,
  isBeamZone,
  parseKgText,
  TAKE_ERROR_TEXT,
  transferTargets,
  YARN_STOCK_WHAT_LABEL,
  YARN_ZONE_CONFIG,
  type Beam,
  type YarnBox,
  type YarnStockWhat,
  type YarnZone,
} from '@rivoora/shared';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoxStock, useNoBoxStock, useTransfer, useWithdraw, useYarnZone } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { KgInput, LotSelect, QualitySelect, Toggle2, ZoneChoice, ZoneTag } from './parts';

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
                <TickBox size="lg" checked={on} onCheckedChange={(c) => onChange(c ? [...selected, b.id] : selected.filter((x) => x !== b.id))} aria-label={b.beamCode} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-bold tabular-nums text-slate-900">{b.beamCode}</span>
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

/**
 * Sprint 20 — tick in-stock boxes. `partial`: Withdraw shows a kg field per ticked box (≤ remaining); Transfer moves
 * whole boxes (no kg field, the full remaining amount goes).
 */
function BoxChecklist({
  boxes,
  selected,
  onChange,
  partial,
  boxKg,
  onKgChange,
  invalid,
}: {
  boxes: YarnBox[];
  selected: number[];
  onChange: (ids: number[]) => void;
  partial?: boolean;
  boxKg?: Record<number, string>;
  onKgChange?: (boxId: number, kg: string) => void;
  invalid?: boolean;
}) {
  if (!boxes.length) return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-slate-500">No boxes in this zone.</p>;
  const all = selected.length === boxes.length;
  return (
    <div className={cn('overflow-hidden rounded-xl border', invalid ? 'border-destructive' : 'border-border')}>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-border bg-slate-50 px-3">
        <TickBox size="lg" checked={all} partial={selected.length > 0 && !all} onCheckedChange={(c) => onChange(c ? boxes.filter((b) => boxFreeG(b) > 0 && (partial || b.reservedG === 0)).map((b) => b.id) : [])} aria-label="Select all boxes" />
        <span className="text-sm font-semibold text-slate-700">{selected.length ? `${selected.length} of ${boxes.length} selected` : `Select all (${boxes.length})`}</span>
      </label>
      <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto">
        {boxes.map((b) => {
          const on = selected.includes(b.id);
          const free = boxFreeG(b);
          // A box with a reservation (pending warping job) can't move as a whole; part of it can still be taken.
          const locked = free <= 0 || (!partial && b.reservedG > 0);
          const kgErr = on && partial ? (() => {
            const g = parseKgText(boxKg?.[b.id] ?? '');
            return g === null || g <= 0 ? 'Enter the kg' : g > free ? `Only ${formatKg(free)} free` : null;
          })() : null;
          return (
            <li key={b.id} className={cn('px-3 py-2', on && 'bg-primary-soft/50')}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3">
                <TickBox size="lg" checked={on} disabled={locked && !on} onCheckedChange={(c) => onChange(c ? [...selected, b.id] : selected.filter((x) => x !== b.id))} aria-label={b.boxNo} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-bold tabular-nums text-slate-900">{b.boxNo}</span>
                    <span className="truncate text-sm font-medium text-slate-700">{b.warpingQuality.name}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {b.rolls} rolls · {formatKg(b.remainingG)} left of {formatKg(b.netG)} · {b.lot ? b.lot.lotNo : 'No lot'}
                    {b.reservedG > 0 ? ` · reserved ${formatKg(b.reservedG)}` : ''}
                  </span>
                </span>
              </label>
              {on && partial && (
                <div className="mt-2 ml-9 flex items-center gap-2">
                  <KgInput value={boxKg?.[b.id] ?? ''} onValueChange={(v) => onKgChange?.(b.id, v)} invalid={!!kgErr} className="max-w-36" aria-label={`Kg from ${b.boxNo}`} />
                  <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onKgChange?.(b.id, String(free / 1000))}>
                    Use all
                  </button>
                  {kgErr && <span className="text-xs font-medium text-destructive">{kgErr}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What can still be taken from a box: its remaining kg minus what pending warping jobs reserve. */
const boxFreeG = (b: YarnBox) => Math.max(0, b.remainingG - b.reservedG);

type What = YarnStockWhat;
type TwistedMode = 'boxes' | 'no_box';

/** The stock part shared by Transfer and Withdraw: What → (raw: quality + lot + kg) / (twisted: boxes or "No box" quality + kg) / beams. */
export function useStockPick(zone: YarnZone, open: boolean) {
  const zoneData = useYarnZone(zone, open);
  const [what, setWhat] = useState<What>('raw');
  const [qualityId, setQualityId] = useState<number | null>(null);
  /** raw only: null = not picked yet, 0 = "No lot" */
  const [lotId, setLotId] = useState<number | null>(null);
  const [lotAvailableG, setLotAvailableG] = useState(0);
  /** twisted "No box": `q-<yarn quality>` / `w-<warping quality>` */
  const [noBoxKey, setNoBoxKey] = useState<string | null>(null);
  const [kg, setKg] = useState('');
  const [twistedMode, setTwistedMode] = useState<TwistedMode>('boxes');
  const [boxIds, setBoxIds] = useState<number[]>([]);
  const [boxKg, setBoxKg] = useState<Record<number, string>>({});
  const [beamIds, setBeamIds] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const boxesQuery = useBoxStock(zone, open && what === 'twisted' && twistedMode === 'boxes');
  const noBoxQuery = useNoBoxStock(zone, open && what === 'twisted' && twistedMode === 'no_box');

  useEffect(() => {
    if (open) {
      setWhat('raw');
      setQualityId(null);
      setLotId(null);
      setNoBoxKey(null);
      setKg('');
      setTwistedMode('boxes');
      setBoxIds([]);
      setBoxKg({});
      setBeamIds([]);
      setNote('');
    }
  }, [open]);
  useEffect(() => {
    setLotId(null);
    setLotAvailableG(0);
  }, [qualityId, zone]);
  useEffect(() => {
    setBoxIds([]);
    setBeamIds([]);
    setNoBoxKey(null);
  }, [zone]);

  const stock = useMemo(
    () => (zoneData.data?.qualities ?? []).map((q) => ({ id: q.quality.id, name: q.quality.name, availableG: q.rawG })).filter((q) => q.availableG > 0),
    [zoneData.data],
  );
  const noBoxOptions = useMemo(
    () =>
      (noBoxQuery.data ?? []).map((n) => ({
        value: n.warpingQualityId ? `w-${n.warpingQualityId}` : `q-${n.qualityId}`,
        label: n.name,
        description: availableText(n.availableG, n.reservedG),
        disabled: n.availableG <= 0,
        availableG: n.availableG,
      })),
    [noBoxQuery.data],
  );
  const available = what === 'twisted' ? (noBoxOptions.find((o) => o.value === noBoxKey)?.availableG ?? 0) : lotAvailableG;
  const grams = parseKgText(kg);
  const picked = what === 'twisted' ? !!noBoxKey : !!qualityId && lotId !== null;
  const yarnError =
    what === 'twisted' && !noBoxKey
      ? 'Select the quality'
      : what === 'raw' && !qualityId
        ? 'Select the quality'
        : what === 'raw' && lotId === null
          ? 'Pick the lot (or No lot)'
          : grams === null
            ? 'Enter the kg'
            : checkTake(available, grams)
              ? TAKE_ERROR_TEXT[checkTake(available, grams)!]
              : null;
  /** The "No box" part of a request body. */
  const noBoxBody = () => {
    const [t, id] = (noBoxKey ?? '').split('-');
    return t === 'w' ? { warpingQualityId: Number(id), qtyKg: grams! / 1000 } : { qualityId: Number(id), qtyKg: grams! / 1000 };
  };

  const boxes = boxesQuery.data ?? [];
  const setBoxKgOne = (boxId: number, v: string) => setBoxKg((m) => ({ ...m, [boxId]: v }));

  return {
    zoneData,
    what,
    setWhat,
    qualityId,
    setQualityId,
    lotId,
    setLotId,
    setLotAvailableG,
    noBoxKey,
    setNoBoxKey,
    noBoxQuery,
    noBoxOptions,
    noBoxBody,
    kg,
    setKg,
    twistedMode,
    setTwistedMode,
    boxesQuery,
    boxes,
    boxIds,
    setBoxIds,
    boxKg,
    setBoxKgOne,
    beamIds,
    setBeamIds,
    note,
    setNote,
    stock,
    available,
    picked,
    grams,
    yarnError,
  };
}

export function WhatPicker({ zone, value, onChange }: { zone: YarnZone; value: What; onChange: (w: What) => void }) {
  const options = (isBeamZone(zone) ? (['raw', 'twisted', 'beams'] as const) : (['raw', 'twisted'] as const)).map((w) => ({ value: w, label: YARN_STOCK_WHAT_LABEL[w] }));
  return <Toggle2 value={value} onChange={onChange} options={options} />;
}

/** True once the twisted-box selection (whole for transfer, partial-kg for withdraw) is complete and valid. */
export function boxesValid(pick: ReturnType<typeof useStockPick>, partial: boolean): boolean {
  if (!pick.boxIds.length) return false;
  if (!partial) return pick.boxIds.every((id) => pick.boxes.find((b) => b.id === id)?.reservedG === 0);
  return pick.boxIds.every((id) => {
    const box = pick.boxes.find((b) => b.id === id);
    const g = parseKgText(pick.boxKg[id] ?? '');
    return box && g !== null && g > 0 && g <= boxFreeG(box);
  });
}

export function StockFields({
  pick,
  tried,
  serverErr,
  zone,
  partialBoxes,
}: {
  pick: ReturnType<typeof useStockPick>;
  tried: boolean;
  serverErr: { field: string; message: string } | null;
  zone: YarnZone;
  /** Withdraw lets kg per box be less than the remaining; Transfer always moves the whole box. */
  partialBoxes: boolean;
}) {
  if (pick.what === 'beams') {
    if (pick.zoneData.isPending) return <Skeleton className="h-24 w-full rounded-xl" />;
    return (
      <Field label="Beams" required error={(tried && !pick.beamIds.length ? 'Select at least one beam' : undefined) ?? (serverErr?.field === 'beamIds' ? serverErr.message : undefined)}>
        <BeamChecklist beams={pick.zoneData.data?.beams ?? []} selected={pick.beamIds} onChange={pick.setBeamIds} invalid={tried && !pick.beamIds.length} />
      </Field>
    );
  }
  if (pick.what === 'twisted') {
    return (
      <div className="grid gap-4">
        <Toggle2 value={pick.twistedMode} onChange={pick.setTwistedMode} options={[{ value: 'boxes', label: 'Boxes' }, { value: 'no_box', label: 'No box' }]} />
        {pick.twistedMode === 'boxes' ? (
          pick.boxesQuery.isPending ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : (
            <Field label="Boxes" required error={(tried && !boxesValid(pick, partialBoxes) ? 'Pick boxes with a valid kg' : undefined) ?? (serverErr?.field === 'boxIds' || serverErr?.field === 'boxes' ? serverErr.message : undefined)}>
              <BoxChecklist
                boxes={pick.boxes}
                selected={pick.boxIds}
                onChange={pick.setBoxIds}
                partial={partialBoxes}
                boxKg={pick.boxKg}
                onKgChange={pick.setBoxKgOne}
                invalid={tried && !boxesValid(pick, partialBoxes)}
              />
            </Field>
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem]">
            <Field label="Quality (No box)" required error={tried && !pick.noBoxKey ? 'Select the quality' : undefined}>
              <Select
                value={pick.noBoxKey}
                onChange={pick.setNoBoxKey}
                options={pick.noBoxOptions}
                placeholder={pick.noBoxOptions.length ? 'Select quality' : `No “No box” twisted yarn in ${YARN_ZONE_CONFIG[zone].label}`}
                searchable
                loading={pick.noBoxQuery.isPending}
                emptyText="Nothing here"
                invalid={tried && !pick.noBoxKey}
                panelClassName="min-w-[min(300px,calc(100vw-24px))]"
                aria-label="No box quality"
              />
            </Field>
            <Field
              label="Kg"
              required
              error={(tried && pick.noBoxKey && pick.yarnError ? pick.yarnError : undefined) ?? (serverErr?.field === 'qtyKg' ? serverErr.message : undefined)}
              hint={
                pick.noBoxKey ? (
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => pick.setKg(String(pick.available / 1000))}>
                    Use all {formatKg(pick.available)}
                  </button>
                ) : undefined
              }
            >
              <KgInput value={pick.kg} onValueChange={pick.setKg} invalid={tried && !!pick.noBoxKey && !!pick.yarnError} />
            </Field>
          </div>
        )}
      </div>
    );
  }
  // raw
  if (pick.zoneData.isPending) return <Skeleton className="h-24 w-full rounded-xl" />;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Quality" required error={tried && !pick.qualityId ? 'Select the quality' : undefined}>
          <QualitySelect
            value={pick.qualityId}
            onChange={(id) => pick.setQualityId(id)}
            only={pick.stock}
            invalid={tried && !pick.qualityId}
            placeholder={pick.stock.length ? 'Select quality' : `No raw yarn in ${YARN_ZONE_CONFIG[zone].label}`}
          />
        </Field>
        <Field label="Lot" required error={tried && pick.qualityId && pick.lotId === null ? 'Pick the lot (or No lot)' : undefined}>
          <LotSelect
            zone={zone}
            qualityId={pick.qualityId}
            value={pick.lotId ?? -1}
            onChange={(lotId, availableG) => {
              pick.setLotId(lotId);
              pick.setLotAvailableG(availableG);
            }}
            invalid={tried && !!pick.qualityId && pick.lotId === null}
          />
        </Field>
      </div>
      <Field
        label="Kg"
        required
        error={(tried && pick.picked && pick.yarnError ? pick.yarnError : undefined) ?? (serverErr?.field === 'qtyKg' ? serverErr.message : undefined)}
        hint={
          pick.picked ? (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => pick.setKg(String(pick.available / 1000))}>
              Use all {formatKg(pick.available)}
            </button>
          ) : undefined
        }
      >
        <KgInput value={pick.kg} onValueChange={pick.setKg} invalid={tried && !!pick.picked && !!pick.yarnError} />
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

  const twistedOk = pick.twistedMode === 'boxes' ? boxesValid(pick, false) : !pick.yarnError;
  const invalid = !to || (pick.what === 'beams' ? !pick.beamIds.length : pick.what === 'twisted' ? !twistedOk : !!pick.yarnError);
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (invalid) return;
    const body =
      pick.what === 'beams'
        ? { what: 'beams' as const, from: from as 'direct' | 'warping', to: to as 'direct' | 'warping', beamIds: pick.beamIds, note: pick.note.trim() || null }
        : pick.what === 'twisted'
          ? {
              what: 'twisted' as const,
              from,
              to: to!,
              boxIds: pick.twistedMode === 'boxes' ? pick.boxIds : [],
              noBox: pick.twistedMode === 'no_box' ? pick.noBoxBody() : null,
              note: pick.note.trim() || null,
            }
          : { what: 'raw' as const, from, to: to!, qualityId: pick.qualityId!, lotId: pick.lotId || null, qtyKg: pick.grams! / 1000, note: pick.note.trim() || null };
    transfer.mutate(body, {
      onSuccess: () => {
        const moved =
          pick.what === 'beams'
            ? `${pick.beamIds.length} beam${pick.beamIds.length === 1 ? '' : 's'}`
            : pick.what === 'twisted' && pick.twistedMode === 'boxes'
              ? `${pick.boxIds.length} box${pick.boxIds.length === 1 ? '' : 'es'}`
              : formatKg(pick.grams ?? 0);
        toast.success(`${moved} moved to ${YARN_ZONE_CONFIG[to!].label}`);
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
      dirty={!!pick.kg || pick.beamIds.length > 0 || pick.boxIds.length > 0}
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
        <StockFields pick={pick} tried={tried} serverErr={serverErr} zone={from} partialBoxes={false} />
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
  const twistedOk = pick.twistedMode === 'boxes' ? boxesValid(pick, true) : !pick.yarnError;
  const invalid = pick.what === 'beams' ? !pick.beamIds.length : pick.what === 'twisted' ? !twistedOk : !!pick.yarnError;
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (invalid) return;
    const body =
      pick.what === 'beams'
        ? { what: 'beams' as const, zone: 'direct' as const, beamIds: pick.beamIds, note: pick.note.trim() || null }
        : pick.what === 'twisted'
          ? {
              what: 'twisted' as const,
              zone: 'direct' as const,
              boxes: pick.twistedMode === 'boxes' ? pick.boxIds.map((id) => ({ boxId: id, qtyKg: parseKgText(pick.boxKg[id] ?? '')! / 1000 })) : [],
              noBox: pick.twistedMode === 'no_box' ? pick.noBoxBody() : null,
              note: pick.note.trim() || null,
            }
          : { what: 'raw' as const, zone: 'direct' as const, qualityId: pick.qualityId!, lotId: pick.lotId || null, qtyKg: pick.grams! / 1000, note: pick.note.trim() || null };
    withdraw.mutate(body, {
      onSuccess: () => {
        const label =
          pick.what === 'beams'
            ? `${pick.beamIds.length} beam${pick.beamIds.length === 1 ? '' : 's'} consumed`
            : pick.what === 'twisted' && pick.twistedMode === 'boxes'
              ? `${pick.boxIds.length} box${pick.boxIds.length === 1 ? '' : 'es'} withdrawn`
              : `${formatKg(pick.grams ?? 0)} withdrawn`;
        toast.success(label);
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
      dirty={!!pick.kg || pick.beamIds.length > 0 || pick.boxIds.length > 0}
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
        <StockFields pick={pick} tried={tried} serverErr={serverErr} zone="direct" partialBoxes />
        <Field label="Note" htmlFor="wd-note" hint={pick.what === 'beams' ? 'e.g. which loom it went to' : undefined}>
          <Textarea id="wd-note" rows={2} maxLength={1000} value={pick.note} onChange={(e) => pick.setNote(e.target.value)} className="min-h-[72px]" />
        </Field>
      </form>
    </YarnDialog>
  );
}
