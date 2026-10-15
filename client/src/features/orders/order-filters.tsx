import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ORDER_TYPE_LABEL, ORDER_TYPES, type LookupItem, type OrderStatusKey } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { ResponsiveModal } from '@/components/ui/modal';
import { MultiSelect } from '@/components/ui/select';
import { getStatus, statusesForRole } from '@/config/statuses';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCustomerLookup, useMaterialLookup } from '../masters/api';
import { DATE_PRESETS, type OrderFilters } from './filters';

type Draft = Omit<OrderFilters, 'search'>;
const EMPTY_DRAFT: Draft = { statuses: [], materials: [], parties: [], types: [], from: undefined, to: undefined };

/** Remembers names seen in lookups (materials / parties), so chips / selections keep their labels. */
function useLookupNames(items: LookupItem[] | undefined) {
  const cache = useRef(new Map<number, string>());
  items?.forEach((m) => cache.current.set(m.id, m.name));
  return cache.current;
}

/** Party names live in a module cache so the chips know a party picked in the dialog after it closes. */
const partyNameCache = new Map<number, string>();

interface OrderFiltersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: OrderFilters;
  onApply: (draft: Draft) => void;
}

export function OrderFiltersDialog({ open, onOpenChange, value, onApply }: OrderFiltersDialogProps) {
  const { role, can } = useRole();
  const [draft, setDraft] = useState<Draft>(value);
  const [materialSearch, setMaterialSearch] = useState('');
  const debouncedMaterial = useDebounce(materialSearch.trim(), 300);
  const materials = useMaterialLookup(debouncedMaterial);
  const names = useLookupNames(materials.data);
  const canParty = can('canSeeClient');
  const [partySearch, setPartySearch] = useState('');
  const debouncedParty = useDebounce(partySearch.trim(), 300);
  const parties = useCustomerLookup(debouncedParty, canParty);
  parties.data?.forEach((c) => partyNameCache.set(c.id, c.name));

  useEffect(() => {
    if (open) setDraft({ statuses: value.statuses, materials: value.materials, parties: value.parties, types: value.types, from: value.from, to: value.to });
  }, [open, value]);

  const statusOptions = useMemo(() => statusesForRole(role).map((s) => ({ value: s.key as OrderStatusKey, label: s.label })), [role]);
  const materialOptions = useMemo(() => {
    const opts = (materials.data ?? []).map((m) => ({ value: m.id, label: m.name, description: m.code }));
    // Keep already-selected materials in the list while searching.
    draft.materials.forEach((id) => {
      if (!opts.some((o) => o.value === id)) opts.unshift({ value: id, label: names.get(id) ?? `Material #${id}`, description: null });
    });
    return opts;
  }, [materials.data, draft.materials, names]);

  const partyOptions = useMemo(() => {
    const opts = (parties.data ?? []).map((c) => ({ value: c.id, label: c.name, description: c.code }));
    draft.parties.forEach((id) => {
      if (!opts.some((o) => o.value === id)) opts.unshift({ value: id, label: partyNameCache.get(id) ?? `Party #${id}`, description: null });
    });
    return opts;
  }, [parties.data, draft.parties]);

  const activePreset = DATE_PRESETS.find((p) => {
    const r = p.range();
    return r.from === draft.from && r.to === draft.to;
  })?.key;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Filter orders"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={() => setDraft(EMPTY_DRAFT)}>
            Clear all
          </Button>
          <Button
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 pb-2">
        {statusOptions.length > 1 && (
          <Field label="Status">
            <MultiSelect
              options={statusOptions}
              value={draft.statuses}
              onChange={(statuses) => setDraft((d) => ({ ...d, statuses }))}
              placeholder="All statuses"
              aria-label="Status"
            />
          </Field>
        )}
        {canParty && (
          <Field label="Party (client)">
            <MultiSelect
              options={partyOptions}
              value={draft.parties}
              onChange={(ids) => setDraft((d) => ({ ...d, parties: ids }))}
              placeholder="All parties"
              searchable
              searchPlaceholder="Search parties…"
              onSearchChange={setPartySearch}
              loading={parties.isFetching}
              aria-label="Party"
            />
          </Field>
        )}
        <Field label="Order type">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Order type">
            {ORDER_TYPES.map((t) => {
              const on = draft.types.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft((d) => ({ ...d, types: on ? d.types.filter((x) => x !== t) : [...d.types, t] }))}
                  className={cn(
                    'min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    on ? 'border-primary bg-primary-soft text-primary' : 'border-input bg-white text-slate-700 hover:bg-muted',
                  )}
                >
                  {ORDER_TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Order date">
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-2">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, ...p.range() }))}
                  className={cn(
                    'min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    activePreset === p.key
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-input bg-white text-slate-700 hover:bg-muted',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <DateRangePicker value={{ from: draft.from, to: draft.to }} onChange={(r) => setDraft((d) => ({ ...d, ...r }))} />
          </div>
        </Field>
        <Field label="Material">
          <MultiSelect
            options={materialOptions}
            value={draft.materials}
            onChange={(ids) => setDraft((d) => ({ ...d, materials: ids }))}
            placeholder="All materials"
            searchable
            searchPlaceholder="Search materials…"
            onSearchChange={setMaterialSearch}
            loading={materials.isFetching}
            aria-label="Material"
          />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

interface FilterChipsProps {
  filters: OrderFilters;
  onChange: (patch: Partial<OrderFilters>) => void;
}

export function FilterChips({ filters, onChange }: FilterChipsProps) {
  const materials = useMaterialLookup('');
  const names = useLookupNames(materials.data);
  const { can } = useRole();
  // Fills the name cache so a party restored from the URL shows its name on the chip.
  const partyLookup = useCustomerLookup('', can('canSeeClient'));
  partyLookup.data?.forEach((c) => partyNameCache.set(c.id, c.name));
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...filters.statuses.map((s) => ({
      key: `s-${s}`,
      label: getStatus(s).label,
      remove: () => onChange({ statuses: filters.statuses.filter((x) => x !== s) }),
    })),
    ...filters.materials.map((id) => ({
      key: `m-${id}`,
      label: names.get(id) ?? `Material #${id}`,
      remove: () => onChange({ materials: filters.materials.filter((x) => x !== id) }),
    })),
    ...filters.parties.map((id) => ({
      key: `p-${id}`,
      label: partyNameCache.get(id) ?? `Party #${id}`,
      remove: () => onChange({ parties: filters.parties.filter((x) => x !== id) }),
    })),
    ...filters.types.map((t) => ({
      key: `t-${t}`,
      label: ORDER_TYPE_LABEL[t],
      remove: () => onChange({ types: filters.types.filter((x) => x !== t) }),
    })),
  ];
  if (filters.from || filters.to) {
    chips.push({
      key: 'date',
      label:
        filters.from === filters.to
          ? formatDate(filters.from)
          : `${filters.from ? formatDate(filters.from) : '…'} – ${filters.to ? formatDate(filters.to) : '…'}`,
      remove: () => onChange({ from: undefined, to: undefined }),
    });
  }
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary-soft py-1 pl-3 pr-1 text-sm font-medium text-primary"
        >
          <span className="truncate">{c.label}</span>
          <button
            type="button"
            onClick={c.remove}
            className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-primary/10"
            aria-label={`Remove filter ${c.label}`}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onChange(EMPTY_DRAFT)}
        className="px-2 py-1 text-sm font-semibold text-slate-500 hover:text-primary"
      >
        Clear all
      </button>
    </div>
  );
}
