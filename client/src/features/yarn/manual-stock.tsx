import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  formatKg,
  parseKgText,
  YARN_ZONE_CONFIG,
  type YarnManualAddInput,
  type YarnManualRemoveInput,
  type YarnZone,
} from '@rivoora/shared';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { ApiError, errorMessage } from '@/lib/api';
import { useManualAdd, useManualRemove } from './api';
import { DialogButtons, YarnDialog } from './dialog';
import { KgInput, QualitySelect, Toggle2, WarpingQualitySelect, ZoneChoice } from './parts';
import { boxesValid, StockFields, useStockPick, WhatPicker } from './stock-dialogs';

/**
 * Sprint 20 — manual add / remove of yarn stock (Jenish, Gaurang: `canAdjustYarnStock`). Side sheet on landscape
 * tablets / desktop, centred on portrait tablets, full screen on phones; 2 columns, the remark full width.
 * - Add: zone · Raw / Twisted · quality (yarn quality / warping quality) · kg · remark — goes in as "No lot" / "No box".
 * - Remove: zone · Raw / Twisted / Beams · the same pickers as Withdraw · remark (required).
 */

type Mode = 'add' | 'remove';
const MODE_OPTIONS = [
  { value: 'add' as const, label: 'Add stock' },
  { value: 'remove' as const, label: 'Remove stock' },
];
const ITEM_OPTIONS = [
  { value: 'raw' as const, label: 'Raw yarn' },
  { value: 'twisted' as const, label: 'Twisted yarn' },
];

export function ManualStockDialog({ open, onOpenChange, zone: initialZone }: { open: boolean; onOpenChange: (o: boolean) => void; zone?: YarnZone }) {
  const [mode, setMode] = useState<Mode>('add');
  const [zone, setZone] = useState<YarnZone | null>(initialZone ?? null);
  // add
  const [item, setItem] = useState<'raw' | 'twisted'>('raw');
  const [qualityId, setQualityId] = useState<number | null>(null);
  const [wq, setWq] = useState<{ id: number; name: string } | null>(null);
  const [kg, setKg] = useState('');
  const [remark, setRemark] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ field: string; message: string } | null>(null);
  // remove: the Withdraw pickers on the chosen zone
  const pick = useStockPick(zone ?? 'direct', open && mode === 'remove' && !!zone);
  const add = useManualAdd();
  const remove = useManualRemove();
  const busy = add.isPending || remove.isPending;

  useEffect(() => {
    if (!open) return;
    setMode('add');
    setZone(initialZone ?? null);
    setItem('raw');
    setQualityId(null);
    setWq(null);
    setKg('');
    setRemark('');
    setTried(false);
    setServerErr(null);
  }, [open, initialZone]);
  useEffect(() => {
    setTried(false);
    setServerErr(null);
  }, [mode]);
  const { what, setWhat } = pick;
  useEffect(() => {
    if (zone === 'tfo' && what === 'beams') setWhat('raw');
  }, [zone, what, setWhat]);

  const grams = parseKgText(kg);
  const addErrors = {
    zone: !zone ? 'Pick the zone' : undefined,
    quality: item === 'raw' ? (!qualityId ? 'Select the yarn quality' : undefined) : !wq ? 'Select the warping quality' : undefined,
    kg: grams === null || grams <= 0 ? 'Enter the kg' : undefined,
  };
  const removeInvalid =
    !zone ||
    !remark.trim() ||
    (pick.what === 'beams' ? !pick.beamIds.length : pick.what === 'twisted' ? (pick.twistedMode === 'boxes' ? !boxesValid(pick, true) : !!pick.yarnError) : !!pick.yarnError);
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.field) setServerErr({ field: err.field, message: err.message });
    toast.error(errorMessage(err));
  };

  const submit = () => {
    setTried(true);
    setServerErr(null);
    if (mode === 'add') {
      if (Object.values(addErrors).some(Boolean)) return;
      const body: YarnManualAddInput = { zone: zone!, item, qualityId: item === 'raw' ? qualityId : null, warpingQualityId: item === 'twisted' ? wq!.id : null, qtyKg: grams! / 1000, remark: remark.trim() || null };
      add.mutate(body, {
        onSuccess: () => {
          toast.success(`${formatKg(grams!)} added to ${YARN_ZONE_CONFIG[zone!].label}`);
          onOpenChange(false);
        },
        onError,
      });
      return;
    }
    if (removeInvalid) return;
    const r = remark.trim();
    const body: YarnManualRemoveInput =
      pick.what === 'beams'
        ? { what: 'beams', zone: zone as 'direct' | 'warping', beamIds: pick.beamIds, remark: r }
        : pick.what === 'twisted'
          ? {
              what: 'twisted',
              zone: zone!,
              boxes: pick.twistedMode === 'boxes' ? pick.boxIds.map((id) => ({ boxId: id, qtyKg: parseKgText(pick.boxKg[id] ?? '')! / 1000 })) : [],
              noBox: pick.twistedMode === 'no_box' ? pick.noBoxBody() : null,
              remark: r,
            }
          : { what: 'raw', zone: zone!, qualityId: pick.qualityId!, lotId: pick.lotId || null, qtyKg: pick.grams! / 1000, remark: r };
    remove.mutate(body, {
      onSuccess: () => {
        toast.success(`Removed from ${YARN_ZONE_CONFIG[zone!].label}`);
        onOpenChange(false);
      },
      onError,
    });
  };

  return (
    <YarnDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add / remove stock"
      description="Manual corrections — they show in Movements as “Added / Removed manually” with your name and the remark."
      busy={busy}
      dirty={!!kg || !!remark || pick.boxIds.length > 0 || pick.beamIds.length > 0}
      footer={<DialogButtons onCancel={() => onOpenChange(false)} busy={busy} label={mode === 'add' ? 'Add stock' : 'Remove stock'} form="yarn-manual-form" />}
    >
      <form
        id="yarn-manual-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5"
      >
        <Toggle2 value={mode} onChange={setMode} options={MODE_OPTIONS} />
        {serverErr && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{serverErr.message}</p>}
        <Field label="Zone" required error={tried && !zone ? 'Pick the zone' : undefined}>
          <ZoneChoice value={zone} onChange={setZone} invalid={tried && !zone} compact />
        </Field>

        {mode === 'add' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Item" required>
              <Toggle2
                value={item}
                onChange={(v) => {
                  setItem(v);
                  setQualityId(null);
                  setWq(null);
                }}
                options={ITEM_OPTIONS}
              />
            </Field>
            <Field
              label={item === 'raw' ? 'Yarn quality' : 'Warping quality'}
              required
              error={tried ? (addErrors.quality ?? (serverErr?.field === 'qualityId' || serverErr?.field === 'warpingQualityId' ? serverErr.message : undefined)) : undefined}
              hint={item === 'raw' ? 'Goes in as “No lot”' : 'Goes in as “No box”'}
            >
              {item === 'raw' ? (
                <QualitySelect value={qualityId} onChange={(id) => setQualityId(id)} invalid={tried && !!addErrors.quality} />
              ) : (
                <WarpingQualitySelect value={wq?.id ?? null} selectedLabel={wq?.name} onChange={(id, name) => setWq({ id, name })} invalid={tried && !!addErrors.quality} />
              )}
            </Field>
            <Field label="Kg" required error={tried ? addErrors.kg : undefined}>
              <KgInput value={kg} onValueChange={setKg} invalid={tried && !!addErrors.kg} />
            </Field>
          </div>
        ) : zone ? (
          <div className="grid gap-4">
            <Field label="What" required>
              <WhatPicker zone={zone} value={pick.what} onChange={pick.setWhat} />
            </Field>
            <StockFields pick={pick} tried={tried} serverErr={serverErr} zone={zone} partialBoxes />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-slate-500">Pick the zone to remove stock from.</p>
        )}

        <Field label="Remark" htmlFor="manual-remark" required={mode === 'remove'} error={tried && mode === 'remove' && !remark.trim() ? 'Enter the remark' : undefined}>
          <Textarea id="manual-remark" rows={2} maxLength={1000} value={remark} onChange={(e) => setRemark(e.target.value)} className="min-h-[72px]" placeholder={mode === 'remove' ? 'Why is it removed?' : 'Optional'} />
        </Field>
      </form>
    </YarnDialog>
  );
}
