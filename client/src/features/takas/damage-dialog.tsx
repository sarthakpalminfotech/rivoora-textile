import { AlertTriangle, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DAMAGE_NAME_MAX_LENGTH, type TakaDamageInput } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { Bi, useBilingual } from '@/lib/bilingual';
import { useDamageLookup } from '../masters/api';

/**
 * The damage of a taka row in a form: a Damage master name, a typed "Other" name (found or added to the master by
 * the server), or `legacy` = an older damage saved without a name (Edit takas only; kept as it is).
 */
export type DamageChoice =
  | { kind: 'master'; damageId: number; name: string }
  | { kind: 'other'; name: string }
  | { kind: 'legacy' };

/** What the API takes for a row's damage. */
export function damagePayload(d: DamageChoice | null): TakaDamageInput | { damageId: null } {
  if (!d) return null;
  if (d.kind === 'master') return { damageId: d.damageId };
  if (d.kind === 'other') return { otherName: d.name.trim() };
  return { damageId: null };
}

/** The damage name shown on a row ("Hole"), or null for an older damage without a name. */
export const damageChoiceName = (d: DamageChoice | null) => (d && d.kind !== 'legacy' ? d.name : null);

/** A saved taka's damage as a form value. */
export function damageChoiceOf(t: { isDamaged: boolean; damageId: number | null; damageName: string | null }): DamageChoice | null {
  if (!t.isDamaged) return null;
  return t.damageId !== null && t.damageName !== null ? { kind: 'master', damageId: t.damageId, name: t.damageName } : { kind: 'legacy' };
}

const OTHER = -1;

interface DamageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Taka 6245" — shown under the title. */
  takaLabel: string;
  /** The row's current damage (opening a damaged row offers Change / Remove). */
  value: DamageChoice | null;
  onConfirm: (value: DamageChoice) => void;
  onRemove: () => void;
}

/**
 * Damage popup (Taka entry screen and Edit takas): pick the damage name from the Damage master, or "Other" and type
 * it. A centred modal on md+, a bottom sheet on phones; bilingual for the Taka entry role.
 */
export function DamageDialog({ open, onOpenChange, takaLabel, value, onConfirm, onRemove }: DamageDialogProps) {
  const bilingual = useBilingual();
  const t = (en: string, hi: string) => (bilingual ? `${en} / ${hi}` : en);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedName, setSelectedName] = useState<string | undefined>();
  const [otherName, setOtherName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const lookup = useDamageLookup(useDebounce(search.trim(), 250), open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearch('');
    if (value?.kind === 'master') {
      setSelected(value.damageId);
      setSelectedName(value.name);
      setOtherName('');
    } else if (value?.kind === 'other') {
      setSelected(OTHER);
      setSelectedName(undefined);
      setOtherName(value.name);
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
      setError(t('Pick the damage name', 'खराबी का नाम चुनें'));
      return;
    }
    if (selected === OTHER) {
      const name = otherName.trim();
      if (!name) {
        setError(t('Write the damage name', 'खराबी का नाम लिखें'));
        return;
      }
      onConfirm({ kind: 'other', name });
    } else {
      onConfirm({ kind: 'master', damageId: selected, name: selectedName ?? options.find((o) => o.value === selected)?.label ?? '' });
    }
    onOpenChange(false);
  };

  const damaged = !!value;
  const label = (en: string, hi: string) => (bilingual ? <Bi en={en} hi={hi} className="items-center" /> : en);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={damaged ? t('Change damage', 'खराबी बदलें') : t('Mark damage', 'खराबी लगाएं')}
      description={takaLabel}
      desktopVariant="center"
      mobileVariant="bottom"
      size="md"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          {damaged && (
            <Button variant="ghost" size="lg" className="col-span-2 h-12 text-destructive hover:bg-destructive-soft sm:mr-auto" onClick={() => {
              onRemove();
              onOpenChange(false);
            }}>
              <Trash2 /> {label('Remove damage', 'खराबी हटाएं')}
            </Button>
          )}
          <Button variant="secondary" size="lg" className="h-12" onClick={() => onOpenChange(false)}>
            {label('Cancel', 'रद्द करें')}
          </Button>
          <Button size="lg" className="h-12 bg-red-600 hover:bg-red-700" onClick={confirm}>
            <AlertTriangle /> {damaged ? label('Save damage', 'खराबी सेव करें') : label('Mark damaged', 'खराबी लगाएं')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        {value?.kind === 'legacy' && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">
            Saved as Machine damage without a name. Pick a name to add one, or keep it as it is (Cancel).
          </p>
        )}
        <Field label={t('Damage name', 'खराबी का नाम')} htmlFor="damage-name" required error={selected !== OTHER ? (error ?? undefined) : undefined}>
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
            invalid={!!error && selected !== OTHER}
            triggerClassName="h-12 text-base"
          />
        </Field>
        {selected === OTHER && (
          <Field label={t('Write damage name', 'खराबी का नाम लिखें')} htmlFor="damage-other" required error={error ?? undefined}>
            <Input
              id="damage-other"
              autoFocus
              autoComplete="off"
              maxLength={DAMAGE_NAME_MAX_LENGTH}
              value={otherName}
              invalid={!!error}
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
      </div>
    </ResponsiveModal>
  );
}
