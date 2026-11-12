import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  amountPaise,
  availableText,
  boxGroupKey,
  boxNoWithFy,
  checkTake,
  formatKg,
  isBeamZone,
  PALTI_LABEL,
  parseKgText,
  ratePaise,
  TAKE_ERROR_TEXT,
  tfoProgramLabel,
  transferTargets,
  WITHDRAW_PURPOSE_LABEL,
  YARN_STOCK_WHAT_LABEL,
  YARN_ZONE_CONFIG,
  type Beam,
  type WithdrawPurpose,
  type YarnBox,
  type YarnBoxProgram,
  type YarnStockWhat,
  type WithdrawZone,
  type YarnZone, kgText, gramsToKg,
  withdrawWholeBoxes,
} from '@rivoora/shared';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoxStock, useNoBoxStock, useTransfer, useWithdraw, useYarnZone } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { cleanDecimal, Kg, KgInput, LotSelect, money, numOrNull, QualitySelect, Toggle2, ZoneChoice, ZoneTag } from './parts';

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
                    Taar {b.taar} · Panna {b.panna} · {b.meters.toLocaleString('en-IN')} m{b.remark ? ` · ${b.remark}` : ''} · {formatDate(b.createdAt)}
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

/** What can still be taken from a box: its remaining kg minus what pending warping jobs reserve. */
export const boxFreeG = (b: YarnBox) => Math.max(0, b.remainingG - b.reservedG);

/** Sprint 24 (CR-19): how the box pickers group boxes — remembered per user (browser) in localStorage. */
export type BoxGroupMode = 'program' | 'quality';
const BOX_GROUP_KEY = 'rivoora.yarn.boxGroup';
export function useBoxGroupMode(): [BoxGroupMode, (m: BoxGroupMode) => void] {
  const [mode, setMode] = useState<BoxGroupMode>(() => {
    try {
      return window.localStorage.getItem(BOX_GROUP_KEY) === 'quality' ? 'quality' : 'program';
    } catch {
      return 'program';
    }
  });
  const set = (m: BoxGroupMode) => {
    setMode(m);
    try {
      window.localStorage.setItem(BOX_GROUP_KEY, m);
    } catch {
      /* private window / blocked storage: the choice just isn't remembered */
    }
  };
  return [mode, set];
}

export interface BoxGroup {
  key: string;
  title: string;
  line: string | null;
  boxes: YarnBox[];
}

/**
 * Sprint 24 (CR-19) — boxes grouped by their TFO program (header: P-12 · output quality, stop date; "Remaining" rows of a
 * program sit under it; Palti boxes under "Palti"), or by warping quality. Programs newest first, Palti last.
 */
export function groupBoxes(boxes: YarnBox[], programs: YarnBoxProgram[], mode: BoxGroupMode): BoxGroup[] {
  const byId = new Map(programs.map((p) => [p.id, p]));
  const out = new Map<string, BoxGroup>();
  for (const b of boxes) {
    const key = mode === 'quality' ? `w-${b.warpingQuality.id}` : boxGroupKey(b);
    let g = out.get(key);
    if (!g) {
      if (mode === 'quality') g = { key, title: b.warpingQuality.name, line: null, boxes: [] };
      else if (key === 'palti') g = { key, title: PALTI_LABEL, line: 'Leftover yarn re-wound into new boxes', boxes: [] };
      else {
        const p = byId.get(b.programId);
        g = {
          key,
          title: tfoProgramLabel(b.programId),
          line: p ? [p.sectionsLabel, p.rawQuality, p.stoppedAt ? `stopped ${formatDate(p.stoppedAt)}` : `started ${formatDate(p.startedAt)}`].filter(Boolean).join(' · ') : null,
          boxes: [],
        };
      }
      out.set(key, g);
    }
    g.boxes.push(b);
  }
  const groups = [...out.values()];
  if (mode === 'program') {
    for (const g of groups) {
      if (g.key === 'palti') continue;
      const qualities = [...new Set(g.boxes.map((b) => b.warpingQuality.name))];
      g.title = `${g.title} · ${qualities.join(', ')}`;
    }
    return groups.sort((a, b) => (a.key === 'palti' ? 1 : b.key === 'palti' ? -1 : Number(b.key.slice(2)) - Number(a.key.slice(2))));
  }
  return groups.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Sprint 20 → 24 — tick in-stock boxes, grouped By program | By quality (CR-19; tick a whole group at once). `partial`:
 * Withdraw in Direct consumption shows a kg field per ticked box (≤ remaining); everywhere else the whole box goes.
 * Tablet / desktop: groups left, the selected boxes + totals right; phones: one column with a sticky "N boxes · X kg" bar.
 */
function BoxChecklist({
  boxes,
  programs,
  selected,
  onChange,
  partial,
  boxKg,
  onKgChange,
  invalid,
}: {
  boxes: YarnBox[];
  programs: YarnBoxProgram[];
  selected: number[];
  onChange: (ids: number[]) => void;
  partial?: boolean;
  boxKg?: Record<number, string>;
  onKgChange?: (boxId: number, kg: string) => void;
  invalid?: boolean;
}) {
  const [mode, setMode] = useBoxGroupMode();
  const groups = useMemo(() => groupBoxes(boxes, programs, mode), [boxes, programs, mode]);
  if (!boxes.length) return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-slate-500">No boxes in this zone.</p>;
  // A box with a reservation (pending warping job) can't move as a whole; part of it can still be taken.
  const pickable = (b: YarnBox) => boxFreeG(b) > 0 && (partial || b.reservedG === 0);
  const kgOf = (b: YarnBox) => (partial ? (parseKgText(boxKg?.[b.id] ?? '') ?? 0) : b.remainingG);
  const chosen = boxes.filter((b) => selected.includes(b.id));
  const chosenG = chosen.reduce((s, b) => s + kgOf(b), 0);
  const toggleGroup = (g: BoxGroup, on: boolean) => {
    const ids = g.boxes.filter(pickable).map((b) => b.id);
    onChange(on ? [...new Set([...selected, ...ids])] : selected.filter((id) => !g.boxes.some((b) => b.id === id)));
  };
  const totals = (
    <span className="tabular-nums">
      {chosen.length} box{chosen.length === 1 ? '' : 'es'} · <Kg g={chosenG} className="font-bold" />
    </span>
  );

  return (
    <div className="grid gap-3">
      <Segmented
        size="md"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'program', label: 'By program' },
          { value: 'quality', label: 'By quality' },
        ]}
        aria-label="Group boxes"
        className="md:max-w-xs"
      />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem] md:items-start">
        <ul className={cn('grid max-h-[26rem] gap-2 overflow-y-auto rounded-xl md:max-h-[30rem]', invalid && 'ring-2 ring-destructive/40')}>
          {groups.map((g) => {
            const own = g.boxes.filter((b) => selected.includes(b.id));
            const open = g.boxes.filter(pickable);
            const all = open.length > 0 && open.every((b) => selected.includes(b.id));
            return (
              <li key={g.key} className="overflow-hidden rounded-xl border border-border bg-white">
                <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-border bg-slate-50 px-3 py-2">
                  <TickBox size="lg" checked={all} partial={own.length > 0 && !all} disabled={!open.length} onCheckedChange={(c) => toggleGroup(g, c)} aria-label={`Select all of ${g.title}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800">{g.title}</span>
                    {g.line && <span className="block truncate text-xs text-slate-500">{g.line}</span>}
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-500">
                    <Kg g={g.boxes.reduce((s, b) => s + b.remainingG, 0)} className="block text-sm font-bold text-slate-800" />
                    {g.boxes.length} box{g.boxes.length === 1 ? '' : 'es'}
                  </span>
                </label>
                <ul className="divide-y divide-border">
                  {g.boxes.map((b) => {
                    const on = selected.includes(b.id);
                    const free = boxFreeG(b);
                    const kgErr = on && partial ? (() => {
                      const g2 = parseKgText(boxKg?.[b.id] ?? '');
                      return g2 === null || g2 <= 0 ? 'Enter the kg' : g2 > free ? `Only ${formatKg(free)} free` : null;
                    })() : null;
                    return (
                      <li key={b.id} className={cn('px-3 py-1.5', on && 'bg-primary-soft/50')}>
                        <label className="flex min-h-12 cursor-pointer items-center gap-3">
                          <TickBox size="lg" checked={on} disabled={!pickable(b) && !on} onCheckedChange={(c) => onChange(c ? [...selected, b.id] : selected.filter((x) => x !== b.id))} aria-label={`Box ${boxNoWithFy(b.boxNo, b.fy)}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span className="font-bold tabular-nums text-slate-900">{boxNoWithFy(b.boxNo, b.fy)}</span>
                              {b.kind === 'remaining' && <span className="rounded bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800">Remaining</span>}
                              {mode === 'program' ? null : <span className="truncate text-xs text-slate-500">{b.kind === 'palti' ? PALTI_LABEL : tfoProgramLabel(b.programId)}</span>}
                            </span>
                            <span className="block truncate text-xs text-slate-500">
                              {b.rolls ? `${b.rolls} rolls · ` : ''}
                              {formatKg(b.remainingG)}
                              {b.remainingG !== b.netG ? ` left of ${formatKg(b.netG)}` : ' net'}
                              {mode === 'program' ? ` · ${b.warpingQuality.name}` : ''}
                              {b.lot ? ` · lot ${b.lot.lotNo}` : ''}
                              {b.reservedG > 0 ? ` · reserved ${formatKg(b.reservedG)}` : ''}
                            </span>
                          </span>
                        </label>
                        {on && partial && (
                          <div className="mb-1 ml-9 flex flex-wrap items-center gap-2">
                            <KgInput value={boxKg?.[b.id] ?? ''} onValueChange={(v) => onKgChange?.(b.id, v)} invalid={!!kgErr} className="max-w-36" aria-label={`Kg from box ${b.boxNo}`} />
                            <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onKgChange?.(b.id, kgText(free))}>
                              Use all
                            </button>
                            {kgErr && <span className="text-xs font-medium text-destructive">{kgErr}</span>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
        {/* Tablet / desktop: what is selected, with totals. */}
        <aside className="hidden rounded-xl border border-border bg-slate-50 p-3 md:sticky md:top-0 md:block" aria-label="Selected boxes">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected</p>
          <p className="mt-0.5 text-sm text-slate-800">{totals}</p>
          {chosen.length > 0 && (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
              {chosen.map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold tabular-nums text-slate-700">{boxNoWithFy(b.boxNo, b.fy)}</span>
                  <Kg g={kgOf(b)} className="text-slate-600" />
                </li>
              ))}
            </ul>
          )}
          {chosen.length > 0 && (
            <button type="button" className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => onChange([])}>
              Clear selection
            </button>
          )}
        </aside>
      </div>
      {/* Phones: a sticky totals bar under the list. */}
      {chosen.length > 0 && <p className="sticky bottom-0 z-10 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white md:hidden">{totals}</p>}
    </div>
  );
}

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
    return t === 'w' ? { warpingQualityId: Number(id), qtyKg: gramsToKg(grams!) } : { qualityId: Number(id), qtyKg: gramsToKg(grams!) };
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
                programs={pick.zoneData.data?.programs ?? []}
                selected={pick.boxIds}
                onChange={(ids) => {
                  // Sprint 20c: a newly ticked box starts with its whole free kg (change it to take part of it).
                  if (partialBoxes) for (const id of ids) if (!pick.boxIds.includes(id)) {
                    const box = pick.boxes.find((b) => b.id === id);
                    if (box && !pick.boxKg[id]) pick.setBoxKgOne(id, kgText(boxFreeG(box)));
                  }
                  pick.setBoxIds(ids);
                }}
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
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => pick.setKg(kgText(pick.available))}>
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
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => pick.setKg(kgText(pick.available))}>
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
          : { what: 'raw' as const, from, to: to!, qualityId: pick.qualityId!, lotId: pick.lotId || null, qtyKg: gramsToKg(pick.grams!), note: pick.note.trim() || null };
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

/** The kg a withdraw takes (for the Sell amount): yarn kg, or the ticked boxes (whole, or the kg typed per box). */
function withdrawGrams(pick: ReturnType<typeof useStockPick>, whole: boolean): number | null {
  if (pick.what === 'beams') return null;
  if (pick.what === 'twisted' && pick.twistedMode === 'boxes') {
    return pick.boxIds.reduce((s, id) => {
      const b = pick.boxes.find((x) => x.id === id);
      return s + (!b ? 0 : whole ? b.remainingG : (parseKgText(pick.boxKg[id] ?? '') ?? 0));
    }, 0);
  }
  return pick.grams;
}

/**
 * Withdraw — Sprint 20c → 24: every zone. Direct consumption: yarn (part of a box allowed) or beams consumed (marked
 * Consumed; no loom link); TFO: raw yarn or WHOLE boxes; Warping: raw yarn, WHOLE boxes or beams. CR-17: a required
 * Purpose — Sell (party, optional rate per kg → amount) or Use in-house (note).
 */
export function WithdrawDialog({ open, onOpenChange, zone = 'direct' }: { open: boolean; onOpenChange: (o: boolean) => void; zone?: WithdrawZone }) {
  const pick = useStockPick(zone, open);
  const whole = withdrawWholeBoxes(zone);
  const [purpose, setPurpose] = useState<WithdrawPurpose | null>(null);
  const [party, setParty] = useState('');
  const [rate, setRate] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  const withdraw = useWithdraw();
  useEffect(() => {
    if (open) {
      setPurpose(null);
      setParty('');
      setRate('');
      setTried(false);
      setServerErr(null);
    }
  }, [open]);
  const twistedOk = pick.twistedMode === 'boxes' ? boxesValid(pick, !whole) : !pick.yarnError;
  const purposeErr = !purpose || (purpose === 'sell' && !party.trim());
  const invalid = purposeErr || (pick.what === 'beams' ? !pick.beamIds.length : pick.what === 'twisted' ? !twistedOk : !!pick.yarnError);
  const rateNum = numOrNull(rate);
  const grams = withdrawGrams(pick, whole);
  const amount = purpose === 'sell' && rateNum !== null && grams ? amountPaise(grams, ratePaise(rateNum)) : null;
  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (invalid || !purpose) return;
    const why = { purpose, partyName: purpose === 'sell' ? party.trim() : null, rate: purpose === 'sell' ? rateNum : null };
    const body =
      pick.what === 'beams'
        ? { what: 'beams' as const, zone: zone as 'direct' | 'warping', beamIds: pick.beamIds, note: pick.note.trim() || null, ...why }
        : pick.what === 'twisted'
          ? {
              what: 'twisted' as const,
              zone,
              boxes: pick.twistedMode === 'boxes' ? pick.boxIds.map((id) => ({ boxId: id, qtyKg: whole ? null : gramsToKg(parseKgText(pick.boxKg[id] ?? '')!) })) : [],
              noBox: pick.twistedMode === 'no_box' ? pick.noBoxBody() : null,
              note: pick.note.trim() || null,
              ...why,
            }
          : { what: 'raw' as const, zone, qualityId: pick.qualityId!, lotId: pick.lotId || null, qtyKg: gramsToKg(pick.grams!), note: pick.note.trim() || null, ...why };
    withdraw.mutate(body, {
      onSuccess: () => {
        const done = purpose === 'sell' ? 'sold' : pick.what === 'beams' ? 'consumed' : 'withdrawn';
        const label =
          pick.what === 'beams'
            ? `${pick.beamIds.length} beam${pick.beamIds.length === 1 ? '' : 's'} ${done}`
            : pick.what === 'twisted' && pick.twistedMode === 'boxes'
              ? `${pick.boxIds.length} box${pick.boxIds.length === 1 ? '' : 'es'} ${done}`
              : `${formatKg(pick.grams ?? 0)} ${done}`;
        toast.success(purpose === 'sell' ? `${label} to ${party.trim()}` : label);
        onOpenChange(false);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
        toast.error(errorMessage(err));
      },
    });
  };
  const label = YARN_ZONE_CONFIG[zone].label;
  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      title={zone === 'direct' ? 'Withdraw' : `Withdraw from ${label}`}
      description={
        zone === 'direct'
          ? 'Yarn or beams taken out of Direct consumption — sold, or used in-house.'
          : zone === 'tfo'
            ? 'Raw yarn, or whole twisted boxes, taken out of TFO — sold, or used in-house.'
            : 'Raw yarn, whole twisted boxes or beams taken out of Warping — sold, or used in-house.'
      }
      busy={withdraw.isPending}
      dirty={!!pick.kg || pick.beamIds.length > 0 || pick.boxIds.length > 0 || !!party}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={withdraw.isPending} label={purpose === 'sell' ? 'Withdraw · Sell' : pick.what === 'beams' ? 'Mark consumed' : 'Withdraw'} form="yarn-withdraw-form" />}
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
        <Field label="Purpose" required error={tried && !purpose ? 'Pick Sell or Use in-house' : serverErr?.field === 'purpose' ? serverErr.message : undefined}>
          <Segmented
            size="lg"
            value={purpose}
            onChange={setPurpose}
            invalid={tried && !purpose}
            options={(['sell', 'in_house'] as const).map((p) => ({ value: p, label: WITHDRAW_PURPOSE_LABEL[p] }))}
            aria-label="Purpose"
          />
        </Field>
        {purpose === 'sell' && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Party" htmlFor="wd-party" required error={(tried && !party.trim() ? 'Enter the party' : undefined) ?? (serverErr?.field === 'partyName' ? serverErr.message : undefined)}>
              <Input id="wd-party" autoComplete="off" maxLength={120} value={party} onChange={(e) => setParty(e.target.value)} invalid={tried && !party.trim()} placeholder="Who is buying" />
            </Field>
            <Field label="Rate ₹ / kg" htmlFor="wd-rate" hint={amount !== null ? `Amount ${money(amount)}` : 'Optional'} error={serverErr?.field === 'rate' ? serverErr.message : undefined}>
              <Input id="wd-rate" inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(cleanDecimal(e.target.value, 2, 7))} className="text-right tabular-nums" />
            </Field>
          </div>
        )}
        <Field label="What" required>
          <WhatPicker zone={zone} value={pick.what} onChange={pick.setWhat} />
        </Field>
        <StockFields pick={pick} tried={tried} serverErr={serverErr} zone={zone} partialBoxes={!whole} />
        <Field label="Note" htmlFor="wd-note" hint={pick.what === 'beams' && purpose !== 'sell' ? 'e.g. which loom it went to' : undefined}>
          <Textarea id="wd-note" rows={2} maxLength={1000} value={pick.note} onChange={(e) => pick.setNote(e.target.value)} className="min-h-[72px]" />
        </Field>
      </form>
    </YarnDialog>
  );
}
