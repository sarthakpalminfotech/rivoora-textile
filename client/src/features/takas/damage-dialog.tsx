import { AlertTriangle, Cog, Droplets, Pencil, Plus, Scissors, Trash2, Truck, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  CHOOSABLE_DAMAGE_TYPES,
  damageTypeLabelFor,
  damageTypeOptions,
  type TakaSource,
  cleanMeters,
  cleanPcs,
  DAMAGE_NAME_MAX_LENGTH,
  DAMAGE_NOT_MARKED,
  damageMetersErrorText,
  isChoosableDamageType,
  damageLabel,
  damagePcsErrorText,
  formatMeters,
  parseDamageMeters,
  parseDamagePcs,
  type ChoosableDamageType,
  type DamageImageInput,
  type DamageType,
  type TakaDamage,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { Bi, useBilingual } from '@/lib/bilingual';
import { cn } from '@/lib/utils';
import { useDamageLookup } from '../masters/api';
import { DamageImagePicker } from './damage-images';

/**
 * One damage name in a form: a Damage master name, a typed "Other" name (found or added to the master by the
 * server), or `legacy` = an older damage saved without a name (Edit takas only; kept as it is).
 */
export type DamageChoice =
  | { kind: 'master'; damageId: number; name: string }
  | { kind: 'other'; name: string }
  | { kind: 'legacy' };

/** One damage of a taka row in a form (a taka can carry several). `id` = an existing open damage (Edit takas). */
export interface DamageEntry {
  key: number;
  id?: number;
  foundAt: DamageType;
  choice: DamageChoice;
  /** Damaged pcs; null only on an older damage that never had a count, or on a meter order's damage. */
  pcs: number | null;
  /** Sprint 19: damaged metres — set instead of `pcs` for a meter order's damage. */
  meters?: number | null;
  /** Photos (Butta QC new damages only). */
  images?: DamageImageInput[];
}

let entryKey = 0;
export const nextEntryKey = () => ++entryKey;

/** The damage name shown on a row ("Hole"), or null for an older damage without a name. */
export const entryName = (e: Pick<DamageEntry, 'choice'>) => (e.choice.kind !== 'legacy' ? e.choice.name : null);

/** "Machine damage · Hole · 2 pcs" / "Machine damage · Hole · 5.5 m" (meter order) */
export const entryLabel = (e: DamageEntry) => damageLabel(e.foundAt, entryName(e), e.pcs, e.meters);

/** The open damages of a saved taka as form entries. */
export function entriesOfTaka(t: { damages: TakaDamage[] }): DamageEntry[] {
  return t.damages
    .filter((d) => d.status === 'open')
    .map((d) => ({
      key: nextEntryKey(),
      id: d.id,
      foundAt: d.foundAt,
      choice: d.damageId !== null && d.damageName !== null ? { kind: 'master', damageId: d.damageId, name: d.damageName } : { kind: 'legacy' },
      pcs: d.pcs,
      meters: d.meters,
    }));
}

/** Compare key of an entry (to tell whether a damage changed). */
export const entrySignature = (e: DamageEntry) =>
  `${e.id ?? 'new'}|${e.choice.kind === 'master' ? `#${e.choice.damageId}` : e.choice.kind === 'other' ? `~${e.choice.name.trim().toLowerCase()}` : 'legacy'}|${e.pcs ?? ''}|${e.meters ?? ''}`;

/** The type chosen with the radio (Machine / Butta cutting / Mill) — what every damage write sends as `type`. */
const choosableType = (e: Pick<DamageEntry, 'foundAt'>): ChoosableDamageType => (isChoosableDamageType(e.foundAt) ? e.foundAt : 'machine');

/**
 * What Taka entry sends for one damage: pcs for a pcs order, metres for a meter order (`meterOrder`) — type +
 * exactly that quantity are required.
 */
export function entryPayload(
  e: DamageEntry,
  meterOrder = false,
): { type: ChoosableDamageType; damageId: number; pcs: number } | { type: ChoosableDamageType; otherName: string; pcs: number }
  | { type: ChoosableDamageType; damageId: number; meters: number } | { type: ChoosableDamageType; otherName: string; meters: number } {
  const type = choosableType(e);
  if (meterOrder) {
    const meters = e.meters ?? 0;
    if (e.choice.kind === 'master') return { type, damageId: e.choice.damageId, meters };
    return { type, otherName: e.choice.kind === 'other' ? e.choice.name.trim() : '', meters };
  }
  const pcs = e.pcs ?? 0;
  if (e.choice.kind === 'master') return { type, damageId: e.choice.damageId, pcs };
  return { type, otherName: e.choice.kind === 'other' ? e.choice.name.trim() : '', pcs };
}

/** What Butta QC / Mill QC / the godown send for a NEW damage: like Taka entry + its photos. */
export function qcEntryPayload(e: DamageEntry, meterOrder = false) {
  return { ...entryPayload(e, meterOrder), images: e.images ?? [] };
}

/** Goods return: the type is optional — "not marked" is sent as `null`. */
export function grEntryPayload(e: DamageEntry, meterOrder = false) {
  const base = entryPayload(e, meterOrder);
  return { ...base, type: isChoosableDamageType(e.foundAt) ? e.foundAt : null, images: e.images ?? [] };
}

/** What Edit takas sends: existing open damages keep their `id`; an older nameless / qty-less one stays as it is. */
export function editEntryPayload(
  e: DamageEntry,
  meterOrder = false,
):
  | { id?: number; type?: ChoosableDamageType; damageId: number | null; pcs: number | null }
  | { id?: number; type?: ChoosableDamageType; otherName: string; pcs: number }
  | { id?: number; type?: ChoosableDamageType; damageId: number | null; meters: number | null }
  | { id?: number; type?: ChoosableDamageType; otherName: string; meters: number } {
  const id = e.id !== undefined ? { id: e.id } : {};
  // New rows always carry the chosen type; an existing damage keeps its (possibly older) type unless it was changed.
  const type = isChoosableDamageType(e.foundAt) ? { type: e.foundAt } : {};
  if (meterOrder) {
    if (e.choice.kind === 'master') return { ...id, ...type, damageId: e.choice.damageId, meters: e.meters ?? null };
    if (e.choice.kind === 'other') return { ...id, ...type, otherName: e.choice.name.trim(), meters: e.meters ?? 0 };
    return { ...id, ...type, damageId: null, meters: e.meters ?? null };
  }
  if (e.choice.kind === 'master') return { ...id, ...type, damageId: e.choice.damageId, pcs: e.pcs };
  if (e.choice.kind === 'other') return { ...id, ...type, otherName: e.choice.name.trim(), pcs: e.pcs ?? 0 };
  return { ...id, ...type, damageId: null, pcs: e.pcs };
}

const TYPE_ICON: Record<ChoosableDamageType, LucideIcon> = { machine: Cog, butta: Scissors, mill: Droplets, weaver: Truck };

/** Sprint 16: the damage types of a taka from its details (QC screens, godown, split). */
export function takaDamageTypes(t: {
  source?: TakaSource | null;
  orderSteps?: { hasButta: boolean; hasMill: boolean } | null;
  beenToButta?: boolean;
  hasBeenToMill?: boolean;
}): ChoosableDamageType[] {
  return damageTypeOptions({ source: t.source, hasButta: t.orderSteps?.hasButta, hasMill: t.orderSteps?.hasMill, beenToButta: t.beenToButta, beenToMill: t.hasBeenToMill });
}

/** The old three types (callers that don't know the taka's source / steps). */
const DEFAULT_TYPES: readonly ChoosableDamageType[] = CHOOSABLE_DAMAGE_TYPES.filter((t) => t !== 'weaver');

interface DamageTypeRadioProps {
  value: ChoosableDamageType | null;
  onChange: (type: ChoosableDamageType | null) => void;
  /** Goods return: nothing chosen is fine (tapping the chosen card again clears it). */
  optional?: boolean;
  /** Show the Hindi line too (Taka entry / QC screens). */
  bilingual?: boolean;
  /** Sprint 16: the types that apply to the taka (`damageTypeOptions`); default Machine / Butta / Mill. */
  types?: readonly ChoosableDamageType[];
  /** Sprint 16: an FG purchase reads "Weaver / supplier damage". */
  source?: TakaSource | null;
}

/** The "Damage type" radio: large tappable cards, nothing pre-selected (unless only one type applies). */
export function DamageTypeRadio({ value, onChange, optional, bilingual, types = DEFAULT_TYPES, source }: DamageTypeRadioProps) {
  return (
    <div role="radiogroup" aria-label={bilingual ? 'Damage type / खराबी का प्रकार' : 'Damage type'} className="space-y-2">
      <p className="text-sm font-semibold text-slate-800">
        {bilingual ? <Bi en="Damage type" hi="खराबी का प्रकार" layout="inline" /> : 'Damage type'}
        {!optional && <span className="ml-0.5 text-destructive">*</span>}
        {optional && <span className="ml-1.5 text-xs font-normal text-slate-500">{bilingual ? 'Optional / वैकल्पिक' : 'Optional'}</span>}
      </p>
      <div className={cn('grid gap-2', types.length === 1 ? 'grid-cols-1' : types.length === 2 || types.length === 4 ? 'grid-cols-2' : 'grid-cols-3')}>
        {types.map((type) => {
          const Icon = TYPE_ICON[type];
          const on = value === type;
          const label = damageTypeLabelFor(type, source);
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on && optional ? null : type)}
              className={cn(
                'flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1.5 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                on ? 'border-red-600 bg-red-50 text-red-700 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-red-300',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="text-[13px] font-bold leading-tight">{label.en}</span>
              {bilingual && (
                <span lang="hi" className="text-[12px] leading-tight">
                  {label.hi}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const OTHER = -1;

interface DamageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Taka 6245" — shown under the title. */
  takaLabel: string;
  /** Goods return: the damage type is optional (nothing chosen is saved as "Damage type not marked"). */
  typeOptional?: boolean;
  /** The taka's pcs: the damaged pcs may not be more. Null = unknown (older taka without pcs). */
  takaPcs: number | null;
  /** Sprint 19: the taka is a meter order's — show "Damaged metres" instead of "Damaged pcs". */
  meterOrder?: boolean;
  /** The taka's metres (meter order only): the damaged metres may not be more. */
  takaMeters?: number | null;
  /** The damage being changed (opening an existing damage offers Change / Remove). */
  value: DamageEntry | null;
  onConfirm: (value: { type: DamageType; choice: DamageChoice; pcs: number | null; meters: number | null; images: DamageImageInput[] }) => void;
  onRemove?: () => void;
  /** Butta QC / Mill QC: a new damage can carry photos (Camera / Attach image). */
  allowImages?: boolean;
  /** Mill QC / godown: a secondary "Send to refinish" button at the bottom (the parent opens its own confirmation). */
  onRefinish?: () => void;
  /**
   * Damage names already on the taka (the godown split: the original taka's open damages). They head the name
   * dropdown; exactly one is pre-selected when a NEW damage is opened.
   */
  suggestedNames?: { damageId: number; name: string }[];
  /** Sprint 16: the damage types that apply to this taka (`damageTypeOptions`); one type is pre-selected. */
  types?: readonly ChoosableDamageType[];
  /** Sprint 16: where the taka came from ("Weaver / supplier damage" for an FG purchase). */
  source?: TakaSource | null;
}

/**
 * Damage popup (Taka entry, Edit takas and Butta QC): pick the damage name from the Damage master, or "Other" and
 * type it, and give the damaged pcs. A centred modal on md+, a bottom sheet on phones; bilingual for the Taka entry
 * and Butta QC roles.
 */
export function DamageDialog({ open, onOpenChange, takaLabel, typeOptional, takaPcs, meterOrder, takaMeters, value, onConfirm, onRemove, allowImages, onRefinish, suggestedNames, types, source }: DamageDialogProps) {
  const [images, setImages] = useState<DamageImageInput[]>([]);
  const [uploading, setUploading] = useState(false);
  const bilingual = useBilingual();
  const [type, setType] = useState<ChoosableDamageType | null>(null);
  const t = (en: string, hi: string) => (bilingual ? `${en} / ${hi}` : en);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedName, setSelectedName] = useState<string | undefined>();
  const [otherName, setOtherName] = useState('');
  const [pcsText, setPcsText] = useState('');
  const [metersText, setMetersText] = useState('');
  const [error, setError] = useState<{ field: 'name' | 'pcs'; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const lookup = useDamageLookup(useDebounce(search.trim(), 250), open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearch('');
    setImages(value?.images ?? []);
    setUploading(false);
    setPcsText(value?.pcs != null ? String(value.pcs) : '');
    setMetersText(value?.meters != null ? String(value.meters) : '');
    // Nothing is pre-selected on a new damage (unless only one type applies); an existing one shows its saved type.
    setType(value && isChoosableDamageType(value.foundAt) ? value.foundAt : !value && !typeOptional && types?.length === 1 ? types[0] : null);
    const choice = value?.choice;
    if (choice?.kind === 'master') {
      setSelected(choice.damageId);
      setSelectedName(choice.name);
      setOtherName('');
    } else if (choice?.kind === 'other') {
      setSelected(OTHER);
      setSelectedName(undefined);
      setOtherName(choice.name);
    } else if (suggestedNames?.length === 1) {
      setSelected(suggestedNames[0].damageId);
      setSelectedName(suggestedNames[0].name);
      setOtherName('');
    } else {
      setSelected(null);
      setSelectedName(undefined);
      setOtherName('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  const options = useMemo(() => {
    const suggested = (suggestedNames ?? []).map((d) => ({ value: d.damageId, label: d.name, description: 'On this taka' as string | null }));
    const ids = new Set(suggested.map((d) => d.value));
    const q = search.trim().toLowerCase();
    const head = q ? suggested.filter((d) => d.label.toLowerCase().includes(q)) : suggested;
    const rest = (lookup.data ?? []).filter((d) => !ids.has(d.id)).map((d) => ({ value: d.id, label: d.name, description: null as string | null }));
    return [...head, ...rest, { value: OTHER, label: t('Other', 'अन्य'), description: null as string | null }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup.data, bilingual, suggestedNames, search]);

  // An older damage with a legacy type (Supervisor marked, …) may be saved without choosing a new one.
  const legacyType = !!value && !isChoosableDamageType(value.foundAt) && value.foundAt !== DAMAGE_NOT_MARKED;
  const typeReady = !!typeOptional || type !== null || legacyType;

  const confirm = () => {
    if (!typeReady) return;
    if (selected === null) {
      setError({ field: 'name', message: t('Pick the damage name', 'खराबी का नाम चुनें') });
      return;
    }
    const name = otherName.trim();
    if (selected === OTHER && !name) {
      setError({ field: 'name', message: t('Write the damage name', 'खराबी का नाम लिखें') });
      return;
    }
    const pcsParsed = meterOrder ? null : parseDamagePcs(pcsText, takaPcs);
    if (pcsParsed?.error) {
      const m = damagePcsErrorText(pcsParsed.error, takaPcs);
      setError({ field: 'pcs', message: bilingual ? `${m.en} / ${m.hi}` : m.en });
      return;
    }
    const metersParsed = meterOrder ? parseDamageMeters(metersText, takaMeters ?? null) : null;
    if (metersParsed?.error) {
      const m = damageMetersErrorText(metersParsed.error, takaMeters ?? null);
      setError({ field: 'pcs', message: bilingual ? `${m.en} / ${m.hi}` : m.en });
      return;
    }
    const choice: DamageChoice =
      selected === OTHER
        ? { kind: 'other', name }
        : { kind: 'master', damageId: selected, name: selectedName ?? options.find((o) => o.value === selected)?.label ?? '' };
    onConfirm({
      type: type ?? (legacyType ? value!.foundAt : DAMAGE_NOT_MARKED),
      choice,
      pcs: meterOrder ? null : pcsParsed!.pcs!,
      meters: meterOrder ? metersParsed!.meters! : null,
      images,
    });
    onOpenChange(false);
  };

  const existing = !!value;
  const label = (en: string, hi: string) => (bilingual ? <Bi en={en} hi={hi} className="items-center" /> : en);
  const nameError = error?.field === 'name' ? error.message : undefined;
  const pcsError = error?.field === 'pcs' ? error.message : undefined;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? t('Change damage', 'खराबी बदलें') : t('Mark damage', 'खराबी लगाएं')}
      description={takaLabel}
      desktopVariant="center"
      mobileVariant="bottom"
      size="md"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          {existing && onRemove && (
            <Button
              variant="ghost"
              size="lg"
              className="col-span-2 h-12 text-destructive hover:bg-destructive-soft sm:mr-auto"
              onClick={() => {
                onRemove();
                onOpenChange(false);
              }}
            >
              <Trash2 /> {label('Remove damage', 'खराबी हटाएं')}
            </Button>
          )}
          <Button variant="secondary" size="lg" className="h-12" onClick={() => onOpenChange(false)}>
            {label('Cancel', 'रद्द करें')}
          </Button>
          <Button size="lg" className="h-12 bg-red-600 hover:bg-red-700" onClick={confirm} disabled={uploading || !typeReady}>
            <AlertTriangle /> {existing ? label('Save damage', 'खराबी सेव करें') : label('Mark damaged', 'खराबी लगाएं')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        <div>
          <DamageTypeRadio value={type} onChange={setType} optional={typeOptional} bilingual={bilingual} types={types} source={source} />
          {!typeReady && (
            <p className="mt-1.5 text-[13px] font-medium text-red-600">{t('Choose the damage type', 'खराबी का प्रकार चुनें')}</p>
          )}
        </div>
        {value?.choice.kind === 'legacy' && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">
            Saved as Machine damage without a name. Pick a name and the damaged pcs to complete it, or keep it as it is (Cancel).
          </p>
        )}
        <Field label={t('Damage name', 'खराबी का नाम')} htmlFor="damage-name" required error={selected !== OTHER ? nameError : undefined}>
          <Select
            id="damage-name"
            value={selected}
            onChange={(id, opt) => {
              setSelected(id);
              setSelectedName(id === OTHER ? undefined : opt.label);
              setError(null);
            }}
            selectedLabel={selected === OTHER ? t('Other', 'अन्य') : selectedName}
            options={options}
            placeholder={t('Select damage', 'खराबी चुनें')}
            searchable
            searchPlaceholder={t('Search damage…', 'खराबी खोजें…')}
            onSearchChange={setSearch}
            loading={lookup.isFetching}
            emptyText={t('No damage names yet', 'अभी कोई नाम नहीं')}
            invalid={!!nameError && selected !== OTHER}
            triggerClassName="h-12 text-base"
          />
        </Field>
        {selected === OTHER && (
          <Field label={t('Write damage name', 'खराबी का नाम लिखें')} htmlFor="damage-other" required error={nameError}>
            <Input
              id="damage-other"
              autoFocus
              autoComplete="off"
              maxLength={DAMAGE_NAME_MAX_LENGTH}
              value={otherName}
              invalid={!!nameError}
              className="h-12 text-base"
              onChange={(e) => {
                setOtherName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirm();
                }
              }}
            />
          </Field>
        )}
        {meterOrder ? (
          <Field
            label={t('Damaged metres', 'खराब मीटर')}
            htmlFor="damage-meters"
            required
            error={pcsError}
            hint={takaMeters != null ? t(`Up to ${takaMeters} m (the taka's metres)`, `ज़्यादा से ज़्यादा ${takaMeters} मीटर`) : undefined}
          >
            <Input
              id="damage-meters"
              inputMode="decimal"
              autoComplete="off"
              value={metersText}
              invalid={!!pcsError}
              className="h-12 text-lg font-bold tabular-nums"
              placeholder="0.0"
              onChange={(e) => {
                setMetersText(cleanMeters(e.target.value));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirm();
                }
              }}
            />
          </Field>
        ) : (
          <Field
            label={t('Damaged pcs', 'खराब पीस')}
            htmlFor="damage-pcs"
            required
            error={pcsError}
            hint={takaPcs !== null ? t(`1 to ${takaPcs} (the taka's pcs)`, `1 से ${takaPcs} (टाका के पीस)`) : undefined}
          >
            <Input
              id="damage-pcs"
              inputMode="numeric"
              autoComplete="off"
              value={pcsText}
              invalid={!!pcsError}
              className="h-12 text-lg font-bold tabular-nums"
              placeholder="0"
              onChange={(e) => {
                setPcsText(cleanPcs(e.target.value));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirm();
                }
              }}
            />
          </Field>
        )}
        {allowImages && (
          <Field label={t('Images', 'फोटो')} hint={t('Optional · up to 10', 'वैकल्पिक · 10 तक')}>
            <DamageImagePicker key={String(open)} value={images} onChange={setImages} onBusyChange={setUploading} />
          </Field>
        )}
        {onRefinish && !existing && (
          <div className="border-t border-border pt-4">
            <Button
              variant="secondary"
              size="lg"
              className="h-12 w-full border-pink-200 text-pink-700 hover:bg-pink-50"
              onClick={() => {
                onOpenChange(false);
                onRefinish();
              }}
              disabled={uploading}
            >
              {label('Send to refinish', 'रीफिनिश भेजें')}
            </Button>
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
}

type Mode = { type: 'add' } | { type: 'edit'; key: number } | { type: 'menu' } | null;

interface TakaDamageControlProps {
  entries: DamageEntry[];
  onChange: (entries: DamageEntry[]) => void;
  /** "Taka 6245" */
  takaLabel: string;
  takaPcs: number | null;
  /** Sprint 19: the taka is a meter order's — the damage dialog shows "Damaged metres" instead. */
  meterOrder?: boolean;
  takaMeters?: number | null;
  /** The taka needs its number and pcs (or metres) first. */
  disabled?: boolean;
  /** `lg` = the big bilingual Taka entry button, `sm` = the compact Edit takas button. */
  size?: 'lg' | 'sm';
  className?: string;
  /** Sprint 16: the damage types that apply (see `DamageDialog`). */
  types?: readonly ChoosableDamageType[];
  source?: TakaSource | null;
  /** Sprint 16 (receipts): a new damage can carry photos. */
  allowImages?: boolean;
}

/**
 * The Damage button of a taka row. No damage yet: tapping adds one. With damages it shows the first one
 * ("Damage · Hole · 2 pcs") and offers Change / Remove / Add another damage.
 */
export function TakaDamageControl({
  entries,
  onChange,
  takaLabel,
  takaPcs,
  meterOrder,
  takaMeters,
  disabled,
  size = 'lg',
  className,
  types,
  source,
  allowImages,
}: TakaDamageControlProps) {
  const bilingual = useBilingual();
  const t = (en: string, hi: string) => (bilingual ? `${en} / ${hi}` : en);
  const [mode, setMode] = useState<Mode>(null);
  const editing = mode?.type === 'edit' ? entries.find((e) => e.key === mode.key) : undefined;
  const first = entries[0];
  const firstName = first ? entryName(first) : null;
  const firstQty = first ? (first.pcs != null ? `${first.pcs} pcs` : first.meters != null ? formatMeters(first.meters) : null) : null;
  const text = first ? `Damage${firstName ? ` · ${firstName}` : ''}${firstQty ? ` · ${firstQty}` : ''}${entries.length > 1 ? ` +${entries.length - 1}` : ''}` : 'Damage';

  const confirm = (v: { type: DamageType; choice: DamageChoice; pcs: number | null; meters: number | null; images: DamageImageInput[] }) => {
    if (mode?.type === 'edit') {
      onChange(entries.map((e) => (e.key === mode.key ? { ...e, foundAt: v.type, choice: v.choice, pcs: v.pcs, meters: v.meters, images: v.images } : e)));
    } else {
      onChange([...entries, { key: nextEntryKey(), foundAt: v.type, choice: v.choice, pcs: v.pcs, meters: v.meters, images: v.images }]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setMode(entries.length ? { type: 'menu' } : { type: 'add' })}
        disabled={disabled}
        aria-pressed={entries.length > 0}
        aria-label={entries.length ? t(`Damages on ${takaLabel}`, `${takaLabel} की खराबी`) : t(`Damage on ${takaLabel}`, `${takaLabel} में खराबी`)}
        title={disabled ? (meterOrder ? t('Enter the taka number and metres first', 'पहले टाका नंबर और मीटर लिखें') : t('Enter the taka number and pcs first', 'पहले टाका नंबर और पीस लिखें')) : undefined}
        className={cn(
          size === 'lg'
            ? 'flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border-2 px-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 md:h-14 md:self-start'
            : 'inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[10px] border px-2.5 text-[13px] font-semibold transition-colors disabled:opacity-40',
          entries.length
            ? size === 'lg'
              ? 'border-red-600 bg-red-600 text-white shadow-sm'
              : 'border-red-600 bg-red-600 text-white'
            : size === 'lg'
              ? 'border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:text-red-600'
              : 'border-input bg-white text-slate-600 hover:text-red-600',
          className,
        )}
      >
        <AlertTriangle className={size === 'lg' ? 'size-5 shrink-0' : 'size-4 shrink-0'} aria-hidden />
        {size === 'lg' && bilingual ? (
          <span className="flex min-w-0 flex-col text-left leading-tight">
            <span className="truncate">{text}</span>
            <span lang="hi" className="text-[13px]">
              खराबी
            </span>
          </span>
        ) : (
          <span className="truncate">{text}</span>
        )}
      </button>

      <DamageDialog
        open={mode?.type === 'add' || (mode?.type === 'edit' && !!editing)}
        onOpenChange={(o) => !o && setMode(entries.length > 1 && mode?.type === 'edit' ? { type: 'menu' } : null)}
        takaLabel={takaLabel}
        takaPcs={takaPcs}
        meterOrder={meterOrder}
        takaMeters={takaMeters}
        value={editing ?? null}
        onConfirm={confirm}
        onRemove={editing ? () => onChange(entries.filter((e) => e.key !== editing.key)) : undefined}
        types={types}
        source={source}
        allowImages={allowImages}
      />

      <ResponsiveModal
        open={mode?.type === 'menu' && entries.length > 0}
        onOpenChange={(o) => !o && setMode(null)}
        title={t('Damages', 'खराबियाँ')}
        description={takaLabel}
        desktopVariant="center"
        mobileVariant="bottom"
        size="md"
        footer={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" size="lg" className="h-12" onClick={() => setMode(null)}>
              {bilingual ? <Bi en="Done" hi="ठीक है" className="items-center" /> : 'Done'}
            </Button>
            <Button size="lg" className="h-12 bg-red-600 hover:bg-red-700" onClick={() => setMode({ type: 'add' })}>
              <Plus /> {bilingual ? <Bi en="Add another damage" hi="और खराबी जोड़ें" className="items-center" /> : 'Add another damage'}
            </Button>
          </div>
        }
      >
        <ul className="space-y-2 pb-1">
          {entries.map((e) => (
            <li key={e.key} className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <span className="min-w-0 flex-1 text-[15px] font-semibold text-red-700">{entryLabel(e)}</span>
              <Button variant="secondary" size="sm" className="h-10" onClick={() => setMode({ type: 'edit', key: e.key })}>
                <Pencil /> {bilingual ? <Bi en="Change" hi="बदलें" layout="inline" /> : 'Change'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 text-destructive hover:bg-destructive-soft"
                onClick={() => {
                  const rest = entries.filter((x) => x.key !== e.key);
                  onChange(rest);
                  if (!rest.length) setMode(null);
                }}
                aria-label={t('Remove damage', 'खराबी हटाएं')}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </ResponsiveModal>
    </>
  );
}
