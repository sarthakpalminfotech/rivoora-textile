import { SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BLOUSE_FILTER_KEYS,
  BLOUSE_FILTER_LABEL,
  EMPTY_WORK_FILTERS,
  ORDER_TYPE_LABEL,
  ORDER_TYPES,
  parseWorkFilters,
  WORK_FILTER_PARAM_KEYS,
  workFilterCount,
  workFilterParams,
  type ChallanKind,
  type WorkFilters,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { ResponsiveModal } from '@/components/ui/modal';
import { MultiSelect } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMachineLookup, useMaterialLookup, usePartyLookup } from '../masters/api';
import { DATE_PRESETS } from '../orders/filters';

/**
 * The Filters modal of the production supervisor (Jobsheets) and the godown supervisor (Butta cutting / Mill):
 * Loom · Quality · Order type · Blouse · Party · Date — each screen picks the fields that make sense for it.
 * Filters live in the URL (`loom=3,7&quality=2 …`), so opening a card and coming back keeps them.
 */

export type WorkFilterField = 'loom' | 'quality' | 'type' | 'blouse' | 'party' | 'date';

/** Filters in the URL + a setter that replaces all of them (other params such as `tab` / `q` are kept). */
export function useWorkFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseWorkFilters((k) => params.get(k)), [params]);
  const setFilters = useCallback(
    (next: WorkFilters) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const k of WORK_FILTER_PARAM_KEYS) p.delete(k);
          for (const [k, v] of Object.entries(workFilterParams(next))) if (v) p.set(k, v);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { filters, setFilters, count: workFilterCount(filters), query: workFilterParams(filters) };
}

/** The filters as a `?loom=…` string (to carry them to another screen). */
export function workFilterSearch(f: WorkFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(workFilterParams(f))) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The Filters icon button with the number of active filters. */
export function FiltersButton({ count, onClick, className }: { count: number; onClick: () => void; className?: string }) {
  return (
    <Button
      variant="secondary"
      size="icon"
      className={cn('relative size-12 shrink-0 bg-white', className)}
      onClick={onClick}
      aria-label={count ? `Filters (${count} active)` : 'Filters'}
      title="Filters"
    >
      <SlidersHorizontal className="!size-5" />
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white ring-2 ring-background">
          {count}
        </span>
      )}
    </Button>
  );
}

/** A tappable on/off pill (48px tall on tablets). */
function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-full border px-4 text-[15px] font-medium transition-colors',
        on ? 'border-primary bg-primary-soft text-primary' : 'border-input bg-white text-slate-700 hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Names of quality / party ids seen in lookups, so chips keep their labels (module cache, survives the dialog). */
const qualityNames = new Map<number, string>();
const partyNames = new Map<string, string>();

interface WorkFiltersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: WorkFilters;
  onApply: (next: WorkFilters) => void;
  fields: readonly WorkFilterField[];
  title?: string;
  /** Butta / mill parties for the Party field. */
  partyKind?: ChallanKind;
  /** What the date range applies to, e.g. "Sent date" or "Challan date". */
  dateLabel?: string;
}

export function WorkFiltersDialog({ open, onOpenChange, value, onApply, fields, title = 'Filters', partyKind, dateLabel = 'Date' }: WorkFiltersDialogProps) {
  const [draft, setDraft] = useState<WorkFilters>(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const has = (f: WorkFilterField) => fields.includes(f);

  const machines = useMachineLookup();
  const [qualitySearch, setQualitySearch] = useState('');
  const materials = useMaterialLookup(useDebounce(qualitySearch.trim(), 300));
  materials.data?.forEach((m) => qualityNames.set(m.id, m.name));
  const [partySearch, setPartySearch] = useState('');
  const parties = usePartyLookup(partyKind ?? 'butta', useDebounce(partySearch.trim(), 300), has('party') && !!partyKind && open);
  parties.data?.forEach((p) => partyNames.set(`${partyKind}-${p.id}`, p.name));

  const qualityOptions = useMemo(() => {
    const opts = (materials.data ?? []).map((m) => ({ value: m.id, label: m.name, description: m.code }));
    draft.qualities.forEach((id) => {
      if (!opts.some((o) => o.value === id)) opts.unshift({ value: id, label: qualityNames.get(id) ?? `Quality #${id}`, description: null });
    });
    return opts;
  }, [materials.data, draft.qualities]);
  const partyOptions = useMemo(() => {
    const opts = (parties.data ?? []).map((p) => ({ value: p.id, label: p.name, description: p.code }));
    draft.parties.forEach((id) => {
      if (!opts.some((o) => o.value === id)) opts.unshift({ value: id, label: partyNames.get(`${partyKind}-${id}`) ?? `Party #${id}`, description: null });
    });
    return opts;
  }, [parties.data, draft.parties, partyKind]);

  const activePreset = DATE_PRESETS.find((p) => {
    const r = p.range();
    return r.from === draft.from && r.to === draft.to;
  })?.key;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" onClick={() => setDraft(EMPTY_WORK_FILTERS)}>
            Clear all
          </Button>
          <Button
            size="lg"
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
      <div className="grid gap-6 pb-2">
        {has('loom') && (
          <Field label="Loom">
            {machines.isPending ? (
              <p className="text-sm text-slate-500">Loading looms…</p>
            ) : (machines.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No looms in the machine master.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8" role="group" aria-label="Loom">
                {(machines.data ?? []).map((m) => {
                  const on = draft.looms.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      title={m.name ?? undefined}
                      onClick={() => setDraft((d) => ({ ...d, looms: toggle(d.looms, m.id) }))}
                      className={cn(
                        'flex h-12 items-center justify-center rounded-xl border text-lg font-bold tabular-nums transition-colors',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-white text-slate-800 hover:bg-muted',
                      )}
                    >
                      {m.machineNo}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        )}
        {has('quality') && (
          <Field label="Quality">
            <MultiSelect
              options={qualityOptions}
              value={draft.qualities}
              onChange={(qualities) => setDraft((d) => ({ ...d, qualities }))}
              placeholder="All qualities"
              searchable
              searchPlaceholder="Search qualities…"
              onSearchChange={setQualitySearch}
              loading={materials.isFetching}
              aria-label="Quality"
            />
          </Field>
        )}
        {has('party') && partyKind && (
          <Field label={partyKind === 'butta' ? 'Butta party' : 'Mill'}>
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
        {has('type') && (
          <Field label="Order type">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Order type">
              {ORDER_TYPES.map((t) => (
                <Pill key={t} on={draft.types.includes(t)} onClick={() => setDraft((d) => ({ ...d, types: toggle(d.types, t) }))}>
                  {ORDER_TYPE_LABEL[t]}
                </Pill>
              ))}
            </div>
          </Field>
        )}
        {has('blouse') && (
          <Field label="Blouse">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Blouse">
              {BLOUSE_FILTER_KEYS.map((b) => (
                <Pill key={b} on={draft.blouse.includes(b)} onClick={() => setDraft((d) => ({ ...d, blouse: toggle(d.blouse, b) }))}>
                  {BLOUSE_FILTER_LABEL[b]}
                </Pill>
              ))}
            </div>
          </Field>
        )}
        {has('date') && (
          <Field label={dateLabel}>
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-2">
                {DATE_PRESETS.map((p) => (
                  <Pill key={p.key} on={activePreset === p.key} onClick={() => setDraft((d) => ({ ...d, ...p.range() }))}>
                    {p.label}
                  </Pill>
                ))}
              </div>
              <DateRangePicker value={{ from: draft.from, to: draft.to }} onChange={(r) => setDraft((d) => ({ ...d, ...r }))} />
            </div>
          </Field>
        )}
      </div>
    </ResponsiveModal>
  );
}

/** The active filters as removable chips under the toolbar (+ Clear all). */
export function WorkFilterChips({ value, onChange, partyKind }: { value: WorkFilters; onChange: (next: WorkFilters) => void; partyKind?: ChallanKind }) {
  const machines = useMachineLookup();
  const machineNo = new Map((machines.data ?? []).map((m) => [m.id, m.machineNo]));
  // Fills the name caches so filters restored from the URL show their names.
  useMaterialLookup('').data?.forEach((m) => qualityNames.set(m.id, m.name));
  usePartyLookup(partyKind ?? 'butta', '', !!partyKind && value.parties.length > 0).data?.forEach((p) => partyNames.set(`${partyKind}-${p.id}`, p.name));

  const chips: { key: string; label: string; next: WorkFilters }[] = [
    ...value.looms.map((id) => ({ key: `l-${id}`, label: `Loom ${machineNo.get(id) ?? `#${id}`}`, next: { ...value, looms: value.looms.filter((x) => x !== id) } })),
    ...value.qualities.map((id) => ({ key: `q-${id}`, label: qualityNames.get(id) ?? `Quality #${id}`, next: { ...value, qualities: value.qualities.filter((x) => x !== id) } })),
    ...value.parties.map((id) => ({ key: `p-${id}`, label: partyNames.get(`${partyKind}-${id}`) ?? `Party #${id}`, next: { ...value, parties: value.parties.filter((x) => x !== id) } })),
    ...value.types.map((t) => ({ key: `t-${t}`, label: ORDER_TYPE_LABEL[t], next: { ...value, types: value.types.filter((x) => x !== t) } })),
    ...value.blouse.map((b) => ({ key: `b-${b}`, label: `Blouse: ${BLOUSE_FILTER_LABEL[b]}`, next: { ...value, blouse: value.blouse.filter((x) => x !== b) } })),
  ];
  if (value.from || value.to) {
    chips.push({
      key: 'date',
      label: value.from === value.to ? formatDate(value.from) : `${value.from ? formatDate(value.from) : '…'} – ${value.to ? formatDate(value.to) : '…'}`,
      next: { ...value, from: undefined, to: undefined },
    });
  }
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary-soft py-1 pl-3 pr-1 text-sm font-medium text-primary">
          <span className="truncate">{c.label}</span>
          <button
            type="button"
            onClick={() => onChange(c.next)}
            className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-primary/10"
            aria-label={`Remove filter ${c.label}`}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <button type="button" onClick={() => onChange(EMPTY_WORK_FILTERS)} className="px-2 py-1 text-sm font-semibold text-slate-500 hover:text-primary">
        Clear all
      </button>
    </div>
  );
}
