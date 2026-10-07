import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  cleanPcs,
  DAMAGE_NAME_MAX_LENGTH,
  DAMAGE_TYPE_LABEL,
  damageLabel,
  damagePcsErrorText,
  parseDamagePcs,
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
  /** Damaged pcs; null only on an older damage that never had a count. */
  pcs: number | null;
  /** Photos (Butta QC new damages only). */
  images?: DamageImageInput[];
}

let entryKey = 0;
export const nextEntryKey = () => ++entryKey;

/** The damage name shown on a row ("Hole"), or null for an older damage without a name. */
export const entryName = (e: Pick<DamageEntry, 'choice'>) => (e.choice.kind !== 'legacy' ? e.choice.name : null);

/** "Machine damage · Hole · 2 pcs" */
export const entryLabel = (e: DamageEntry) => damageLabel(e.foundAt, entryName(e), e.pcs);

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
    }));
}

/** Compare key of an entry (to tell whether a damage changed). */
export const entrySignature = (e: DamageEntry) =>
  `${e.id ?? 'new'}|${e.choice.kind === 'master' ? `#${e.choice.damageId}` : e.choice.kind === 'other' ? `~${e.choice.name.trim().toLowerCase()}` : 'legacy'}|${e.pcs ?? ''}`;

/** What Taka entry sends for one damage (pcs is required). */
export function entryPayload(e: DamageEntry): { damageId: number; pcs: number } | { otherName: string; pcs: number } {
  const pcs = e.pcs ?? 0;
  if (e.choice.kind === 'master') return { damageId: e.choice.damageId, pcs };
  return { otherName: e.choice.kind === 'other' ? e.choice.name.trim() : '', pcs };
}

/** What Butta QC sends for a NEW damage: like Taka entry + its photos. */
export function qcEntryPayload(e: DamageEntry) {
  return { ...entryPayload(e), images: e.images ?? [] };
}

/** What Edit takas sends: existing open damages keep their `id`; an older nameless / pcs-less one stays as it is. */
export function editEntryPayload(
  e: DamageEntry,
): { id?: number; damageId: number | null; pcs: number | null } | { id?: number; otherName: string; pcs: number } {
  const id = e.id !== undefined ? { id: e.id } : {};
  if (e.choice.kind === 'master') return { ...id, damageId: e.choice.damageId, pcs: e.pcs };
  if (e.choice.kind === 'other') return { ...id, otherName: e.choice.name.trim(), pcs: e.pcs ?? 0 };
  return { ...id, damageId: null, pcs: e.pcs };
}

const OTHER = -1;

interface DamageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Taka 6245" — shown under the title. */
  takaLabel: string;
  /** Where this damage is found: machine (taka entry, Edit takas) or butta (Butta QC). */
  foundAt: DamageType;
  /** The taka's pcs: the damaged pcs may not be more. Null = unknown (older taka without pcs). */
  takaPcs: number | null;
  /** The damage being changed (opening an existing damage offers Change / Remove). */
  value: DamageEntry | null;
  onConfirm: (value: { choice: DamageChoice; pcs: number; images: DamageImageInput[] }) => void;
  onRemove?: () => void;
  /** Butta QC / Mill QC: a new damage can carry photos (Camera / Attach image). */
  allowImages?: boolean;
  /** Mill QC / godown: a secondary "Send to refinish" button at the bottom (the parent opens its own confirmation). */
  onRefinish?: () => void;
}

/**
 * Damage popup (Taka entry, Edit takas and Butta QC): pick the damage name from the Damage master, or "Other" and
 * type it, and give the damaged pcs. A centred modal on md+, a bottom sheet on phones; bilingual for the Taka entry
 * and Butta QC roles.
 */
export function DamageDialog({ open, onOpenChange, takaLabel, foundAt, takaPcs, value, onConfirm, onRemove, allowImages, onRefinish }: DamageDialogProps) {
  const [images, setImages] = useState<DamageImageInput[]>([]);
  const [uploading, setUploading] = useState(false);
  const where = DAMAGE_TYPE_LABEL[foundAt];
  const bilingual = useBilingual();
  const t = (en: string, hi: string) => (bilingual ? `${en} / ${hi}` : en);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedName, setSelectedName] = useState<string | undefined>();
  const [otherName, setOtherName] = useState('');
  const [pcsText, setPcsText] = useState('');
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
    const choice = value?.choice;
    if (choice?.kind === 'master') {
      setSelected(choice.damageId);
      setSelectedName(choice.name);
      setOtherName('');
    } else if (choice?.kind === 'other') {
      setSelected(OTHER);
      setSelectedName(undefined);
      setOtherName(choice.name);
    } else {
      setSelected(null);
      setSelectedName(undefined);
      setOtherName('');
    }
  }, [open, value]);

  const options = useMemo(
    () => [...(lookup.data ?? []).map((d) => ({ value: d.id, label: d.name })), { value: OTHER, label: t('Other', 'अन्य') }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookup.data, bilingual],
  );

  const confirm = () => {
    if (selected === null) {
      setError({ field: 'name', message: t('Pick the damage name', 'खराबी का नाम चुनें') });
      return;
    }
    const name = otherName.trim();
    if (selected === OTHER && !name) {
      setError({ field: 'name', message: t('Write the damage name', 'खराबी का नाम लिखें') });
      return;
    }
    const parsed = parseDamagePcs(pcsText, takaPcs);
    if (parsed.error) {
      const m = damagePcsErrorText(parsed.error, takaPcs);
      setError({ field: 'pcs', message: bilingual ? `${m.en} / ${m.hi}` : m.en });
      return;
    }
    const choice: DamageChoice =
      selected === OTHER
        ? { kind: 'other', name }
        : { kind: 'master', damageId: selected, name: selectedName ?? options.find((o) => o.value === selected)?.label ?? '' };
    onConfirm({ choice, pcs: parsed.pcs!, images });
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
          <Button size="lg" className="h-12 bg-red-600 hover:bg-red-700" onClick={confirm} disabled={uploading}>
            <AlertTriangle /> {existing ? label('Save damage', 'खराबी सेव करें') : label('Mark damaged', 'खराबी लगाएं')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        <p className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-[13px] font-semibold text-red-700">
          {bilingual && foundAt === 'butta' ? 'Butta cutting damage / बुट्टा कटिंग की खराबी' : bilingual && foundAt === 'mill' ? 'Mill damage / मिल की खराबी' : where}
        </p>
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
  /** Where NEW damages are found (machine at taka entry / Edit takas). */
  foundAt?: DamageType;
  /** "Taka 6245" */
  takaLabel: string;
  takaPcs: number | null;
  /** The taka needs its number and pcs first. */
  disabled?: boolean;
  /** `lg` = the big bilingual Taka entry button, `sm` = the compact Edit takas button. */
  size?: 'lg' | 'sm';
  className?: string;
}

/**
 * The Damage button of a taka row. No damage yet: tapping adds one. With damages it shows the first one
 * ("Damage · Hole · 2 pcs") and offers Change / Remove / Add another damage.
 */
export function TakaDamageControl({
  entries,
  onChange,
  foundAt = 'machine',
  takaLabel,
  takaPcs,
  disabled,
  size = 'lg',
  className,
}: TakaDamageControlProps) {
  const bilingual = useBilingual();
  const t = (en: string, hi: string) => (bilingual ? `${en} / ${hi}` : en);
  const [mode, setMode] = useState<Mode>(null);
  const editing = mode?.type === 'edit' ? entries.find((e) => e.key === mode.key) : undefined;
  const first = entries[0];
  const firstName = first ? entryName(first) : null;
  const text = first
    ? `Damage${firstName ? ` · ${firstName}` : ''}${first.pcs != null ? ` · ${first.pcs} pcs` : ''}${entries.length > 1 ? ` +${entries.length - 1}` : ''}`
    : 'Damage';

  const confirm = (v: { choice: DamageChoice; pcs: number }) => {
    if (mode?.type === 'edit') {
      onChange(entries.map((e) => (e.key === mode.key ? { ...e, choice: v.choice, pcs: v.pcs } : e)));
    } else {
      onChange([...entries, { key: nextEntryKey(), foundAt, choice: v.choice, pcs: v.pcs }]);
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
        title={disabled ? t('Enter the taka number and pcs first', 'पहले टाका नंबर और पीस लिखें') : undefined}
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
        foundAt={editing?.foundAt ?? foundAt}
        takaPcs={takaPcs}
        value={editing ?? null}
        onConfirm={confirm}
        onRemove={editing ? () => onChange(entries.filter((e) => e.key !== editing.key)) : undefined}
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
