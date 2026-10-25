import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isYarnPoStatus, YARN_PO_STATUS_CONFIG, YARN_PO_STATUSES, type YarnPoStatus } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { ResponsiveModal } from '@/components/ui/modal';
import { MultiSelect } from '@/components/ui/select';
import { formatDate } from '@/lib/format';
import { useYarnPartyLookup, useYarnQualityLookup, type YarnPoListParams } from './api';
import { Pill } from './parts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ids = (v: string | null) => (v ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);

/** Yarn PO list filters live in the URL (`q status party quality from to`), like the Orders list. */
export function useYarnPoFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<YarnPoListParams>(() => {
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    return {
      search: params.get('q') ?? '',
      status: (params.get('status') ?? '').split(',').filter(isYarnPoStatus),
      party: ids(params.get('party')),
      quality: ids(params.get('quality')),
      from: DATE_RE.test(from) ? from : undefined,
      to: DATE_RE.test(to) ? to : undefined,
    };
  }, [params]);
  const setFilters = useCallback(
    (patch: Partial<YarnPoListParams>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const set = (k: string, v: string | undefined) => (v ? next.set(k, v) : next.delete(k));
          if ('search' in patch) set('q', patch.search?.trim());
          if ('status' in patch) set('status', patch.status?.join(','));
          if ('party' in patch) set('party', patch.party?.join(','));
          if ('quality' in patch) set('quality', patch.quality?.join(','));
          if ('from' in patch) set('from', patch.from);
          if ('to' in patch) set('to', patch.to);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const activeCount = filters.status.length + filters.party.length + filters.quality.length + (filters.from || filters.to ? 1 : 0);
  return { filters, setFilters, activeCount };
}

type Draft = Omit<YarnPoListParams, 'search'>;

/** Names seen in the lookups, so chips keep their labels. */
const partyNames = new Map<number, string>();
const qualityNames = new Map<number, string>();

export function YarnPoFiltersDialog({ open, onOpenChange, value, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; value: YarnPoListParams; onApply: (d: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(value);
  const parties = useYarnPartyLookup('', open);
  const qualities = useYarnQualityLookup('', open);
  parties.data?.forEach((p) => partyNames.set(p.id, p.name));
  qualities.data?.forEach((q) => qualityNames.set(q.id, q.name));

  useEffect(() => {
    if (open) setDraft({ status: value.status, party: value.party, quality: value.quality, from: value.from, to: value.to });
  }, [open, value]);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Filter Yarn POs"
      size="lg"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={() => setDraft({ status: [], party: [], quality: [], from: undefined, to: undefined })}>
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
      <div className="grid gap-5 pb-2 md:grid-cols-2">
        <Field label="Status" className="md:col-span-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
            {YARN_PO_STATUSES.map((s) => {
              const on = draft.status.includes(s);
              return (
                <Pill key={s} on={on} onClick={() => setDraft((d) => ({ ...d, status: on ? d.status.filter((x) => x !== s) : [...d.status, s] }))}>
                  {YARN_PO_STATUS_CONFIG[s].label}
                </Pill>
              );
            })}
          </div>
        </Field>
        <Field label="Party">
          <MultiSelect
            options={(parties.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            value={draft.party}
            onChange={(party) => setDraft((d) => ({ ...d, party }))}
            placeholder="All parties"
            searchable
            loading={parties.isPending}
            aria-label="Party"
          />
        </Field>
        <Field label="Yarn quality">
          <MultiSelect
            options={(qualities.data ?? []).map((q) => ({ value: q.id, label: q.name }))}
            value={draft.quality}
            onChange={(quality) => setDraft((d) => ({ ...d, quality }))}
            placeholder="All qualities"
            searchable
            loading={qualities.isPending}
            aria-label="Yarn quality"
          />
        </Field>
        <Field label="PO date" className="md:col-span-2 md:max-w-md">
          <DateRangePicker value={{ from: draft.from, to: draft.to }} onChange={(r) => setDraft((d) => ({ ...d, from: r.from, to: r.to }))} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

export function YarnPoFilterChips({ filters, onChange }: { filters: YarnPoListParams; onChange: (p: Partial<YarnPoListParams>) => void }) {
  // Fill the name caches for chips restored from the URL.
  const parties = useYarnPartyLookup('', filters.party.length > 0);
  const qualities = useYarnQualityLookup('', filters.quality.length > 0);
  parties.data?.forEach((p) => partyNames.set(p.id, p.name));
  qualities.data?.forEach((q) => qualityNames.set(q.id, q.name));
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...filters.status.map((s: YarnPoStatus) => ({ key: `s-${s}`, label: YARN_PO_STATUS_CONFIG[s].label, remove: () => onChange({ status: filters.status.filter((x) => x !== s) }) })),
    ...filters.party.map((id) => ({ key: `p-${id}`, label: partyNames.get(id) ?? `Party #${id}`, remove: () => onChange({ party: filters.party.filter((x) => x !== id) }) })),
    ...filters.quality.map((id) => ({ key: `q-${id}`, label: qualityNames.get(id) ?? `Quality #${id}`, remove: () => onChange({ quality: filters.quality.filter((x) => x !== id) }) })),
  ];
  if (filters.from || filters.to) {
    chips.push({
      key: 'date',
      label: filters.from === filters.to ? formatDate(filters.from) : `${filters.from ? formatDate(filters.from) : '…'} – ${filters.to ? formatDate(filters.to) : '…'}`,
      remove: () => onChange({ from: undefined, to: undefined }),
    });
  }
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary-soft py-1 pl-3 pr-1 text-sm font-medium text-primary">
          <span className="truncate">{c.label}</span>
          <button type="button" onClick={c.remove} className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-primary/10" aria-label={`Remove filter ${c.label}`}>
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="min-h-8 rounded-full px-2 text-sm font-semibold text-slate-500 hover:text-slate-800"
        onClick={() => onChange({ status: [], party: [], quality: [], from: undefined, to: undefined })}
      >
        Clear all
      </button>
    </div>
  );
}
