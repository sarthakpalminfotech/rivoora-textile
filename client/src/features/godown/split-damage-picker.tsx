import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Info, Plus } from 'lucide-react';
import {
  cleanMeters,
  DAMAGE_RECORDED_AT_LABEL,
  DAMAGE_TYPE_LABEL,
  formatMarkedDate,
  formatMeters,
  isDamageType,
  movedDamageMetersCheck,
  movedDamagePcsCheck,
  splitDamageLabel,
  type SplitDamageOption,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ResponsiveModal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

/**
 * Split screen (Sprint 15): a part marked "Damage" first asks "Which damage is this?" — one of the order's earlier open
 * damages (the split taka's own first), or "Other (new damage)". Choosing an earlier one shows its details read-only
 * and a prefilled, editable damaged-pcs field; the damage is MOVED to the part when the split is saved.
 */
export function SplitDamagePicker({
  open,
  onOpenChange,
  partLabel,
  partPcs,
  options,
  onPickExisting,
  onPickOther,
  meterOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partLabel: string;
  partPcs: number | null;
  /** Already ordered and without the damages picked for other parts (shared `splitPickerOptions`). */
  options: SplitDamageOption[];
  onPickExisting: (option: SplitDamageOption, qty: number) => void;
  onPickOther: () => void;
  /** Sprint 19: `partPcs` carries metres instead, and the quantity field is decimal. */
  meterOrder?: boolean;
}) {
  const [chosen, setChosen] = useState<SplitDamageOption | null>(null);
  const [pcsText, setPcsText] = useState('');

  useEffect(() => {
    if (open) {
      setChosen(null);
      setPcsText('');
    }
  }, [open]);

  const entered = meterOrder ? (Number(pcsText) > 0 ? Math.round(Number(pcsText) * 100) / 100 : null) : /^\d+$/.test(pcsText) ? Number(pcsText) : null;
  const check = chosen
    ? meterOrder
      ? movedDamageMetersCheck({ originalOpenMeters: chosen.openMeters ?? 0, entered, partMeters: partPcs })
      : movedDamagePcsCheck({ originalOpenPcs: chosen.openPcs, entered, partPcs })
    : null;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={chosen ? 'This damage' : 'Which damage is this?'}
      description={partLabel}
      size="sm"
      footer={
        chosen ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" size="lg" onClick={() => setChosen(null)}>
              Back
            </Button>
            <Button
              size="lg"
              disabled={!!check?.error}
              onClick={() => {
                if (entered !== null) onPickExisting(chosen, entered);
                onOpenChange(false);
              }}
            >
              Use this damage
            </Button>
          </div>
        ) : undefined
      }
    >
      {chosen ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-3.5 text-sm">
            <Item label="Type">{DAMAGE_TYPE_LABEL[isDamageType(chosen.foundAt) ? chosen.foundAt : 'machine']}</Item>
            <Item label="Name">{chosen.damageName ?? '—'}</Item>
            <Item label="Marked on">{formatMarkedDate(chosen.markedAt)}</Item>
            <Item label="Recorded at">
              {chosen.recordedAt && chosen.recordedAt in DAMAGE_RECORDED_AT_LABEL
                ? DAMAGE_RECORDED_AT_LABEL[chosen.recordedAt as keyof typeof DAMAGE_RECORDED_AT_LABEL]
                : '—'}
            </Item>
            <Item label="On taka">{chosen.takaNo}</Item>
            <Item label={meterOrder ? 'Open metres' : 'Open pcs'}>{meterOrder ? formatMeters(chosen.openMeters ?? 0) : chosen.openPcs}</Item>
          </dl>
          {chosen.images.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Photos">
              {chosen.images.map((img) => (
                <li key={img.id}>
                  <img src={img.thumbUrl} alt="" className="size-16 rounded-lg border border-border object-cover" />
                </li>
              ))}
            </ul>
          )}
          <Field label={meterOrder ? 'Damaged metres' : 'Damaged pcs'} htmlFor="sd-pcs" required error={check?.error ?? undefined}>
            <input
              id="sd-pcs"
              value={pcsText}
              onChange={(e) => setPcsText(meterOrder ? cleanMeters(e.target.value) : e.target.value.replace(/[^\d]/g, ''))}
              inputMode={meterOrder ? 'decimal' : 'numeric'}
              autoComplete="off"
              className="h-12 w-full rounded-xl border border-input bg-white px-3 text-lg font-bold tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </Field>
          {check?.mismatch && (
            <p role="status" className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              {check.mismatch}
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  setChosen(o);
                  const open = meterOrder ? o.openMeters ?? 0 : o.openPcs;
                  setPcsText(String(Math.min(open, partPcs ?? open)));
                }}
                className="flex min-h-14 w-full items-center gap-2 rounded-xl border border-red-200 bg-red-50/60 px-3.5 py-2.5 text-left text-[14px] font-semibold text-red-800 hover:bg-red-50"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{splitDamageLabel(o)}</span>
                <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onPickOther();
              }}
              className={cn('flex min-h-14 w-full items-center gap-2 rounded-xl border border-dashed border-border bg-white px-3.5 py-2.5 text-left text-[15px] font-semibold text-slate-700 hover:bg-slate-50')}
            >
              <Plus className="size-4 shrink-0" aria-hidden /> Other (new damage)
            </button>
          </li>
        </ul>
      )}
    </ResponsiveModal>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="break-words font-semibold text-slate-900">{children}</dd>
    </div>
  );
}
