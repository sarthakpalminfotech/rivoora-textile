import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { STOCK_DAMAGE_TYPE_LABEL, STOCK_DAMAGE_TYPES, type DesignListItem, type Paginated, type StockDamageType } from '@rivoora/shared';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';
import { useDamageLookup, useDesignQualityGroups } from '../masters/api';

const OTHER = -1;

/** Designs of one quality (searchable) for the pickers. */
export function useDesignsOfQuality(materialId: number | null, search: string) {
  return useQuery({
    queryKey: ['designs', 'of-quality', materialId, search] as const,
    queryFn: ({ signal }) => api.get<Paginated<DesignListItem>>('/designs', { quality: materialId, search, limit: 40 }, signal),
    enabled: !!materialId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Quality, then Design (filtered by the quality) — the standard stock pickers. */
export function QualityDesignFields({
  materialId,
  designId,
  onChange,
  qualityError,
  designError,
  disabled,
}: {
  materialId: number | null;
  designId: number | null;
  onChange: (next: { materialId: number | null; designId: number | null }) => void;
  qualityError?: string;
  designError?: string;
  disabled?: boolean;
}) {
  const [qSearch, setQSearch] = useState('');
  const [dSearch, setDSearch] = useState('');
  const [qLabel, setQLabel] = useState<string | null>(null);
  const [dLabel, setDLabel] = useState<string | null>(null);
  const groups = useDesignQualityGroups({ qualitySearch: useDebounce(qSearch.trim(), 250), designs: 0 });
  const designs = useDesignsOfQuality(materialId, useDebounce(dSearch.trim(), 250));
  const qualities = (groups.data ?? []).filter((g) => g.materialId !== null).map((g) => ({ value: g.materialId as number, label: g.name }));
  return (
    <>
      <Field label="Quality" htmlFor="stock-quality" required error={qualityError}>
        <Select<number>
          id="stock-quality"
          value={materialId}
          selectedLabel={qLabel ?? undefined}
          onChange={(id, opt) => {
            setQLabel(opt.label);
            setDLabel(null);
            onChange({ materialId: id, designId: null });
          }}
          options={qualities}
          placeholder="Select quality"
          searchable
          searchPlaceholder="Search quality…"
          onSearchChange={setQSearch}
          loading={groups.isFetching}
          disabled={disabled}
        />
      </Field>
      <Field label="Design" htmlFor="stock-design" required error={designError}>
        <Select<number>
          id="stock-design"
          value={designId}
          selectedLabel={dLabel ?? undefined}
          onChange={(id, opt) => {
            setDLabel(opt.label);
            onChange({ materialId, designId: id });
          }}
          options={(designs.data?.items ?? []).map((d) => ({ value: d.id, label: d.code }))}
          placeholder={materialId ? 'Select design' : 'Pick the quality first'}
          searchable
          searchPlaceholder="Search design code…"
          onSearchChange={setDSearch}
          loading={designs.isFetching}
          disabled={disabled || !materialId}
          emptyText="No designs in this quality"
        />
      </Field>
    </>
  );
}

export interface DamageRowDraft {
  type: StockDamageType | null;
  /** A damage master id, or OTHER (-1) with `otherName` typed. */
  damageId: number | null;
  otherName: string;
  qty: string;
}
export const emptyDamageRow = (): DamageRowDraft => ({ type: null, damageId: null, otherName: '', qty: '' });

/** The API shape of a draft row, or null while it is incomplete. */
export function damageRowPayload(r: DamageRowDraft): ({ type: StockDamageType; qty: number } & ({ damageId: number } | { otherName: string })) | null {
  const qty = Number(r.qty);
  if (!r.type || !Number.isFinite(qty) || qty <= 0) return null;
  if (r.damageId === OTHER) return r.otherName.trim() ? { type: r.type, qty, otherName: r.otherName.trim() } : null;
  return r.damageId ? { type: r.type, qty, damageId: r.damageId } : null;
}

/** One damage row: type (all four) · name (master or Other) · quantity. */
export function DamageRowFields({ row, onChange, unit, idPrefix, error }: { row: DamageRowDraft; onChange: (r: DamageRowDraft) => void; unit: 'pcs' | 'meters'; idPrefix: string; error?: string }) {
  const [search, setSearch] = useState('');
  const names = useDamageLookup(useDebounce(search.trim(), 250));
  const options = [...(names.data ?? []).map((n) => ({ value: n.id, label: n.name })), { value: OTHER, label: 'Other…' }];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Damage type" htmlFor={`${idPrefix}-type`} required>
        <Select<StockDamageType>
          id={`${idPrefix}-type`}
          value={row.type}
          onChange={(type) => onChange({ ...row, type })}
          options={STOCK_DAMAGE_TYPES.map((t) => ({ value: t, label: STOCK_DAMAGE_TYPE_LABEL[t] }))}
          placeholder="Select type"
        />
      </Field>
      <Field label="Damage name" htmlFor={`${idPrefix}-name`} required>
        <Select<number>
          id={`${idPrefix}-name`}
          value={row.damageId}
          onChange={(damageId) => onChange({ ...row, damageId })}
          options={options}
          placeholder="Select damage"
          searchable
          searchPlaceholder="Search damage…"
          onSearchChange={setSearch}
          loading={names.isFetching}
        />
      </Field>
      {row.damageId === OTHER ? (
        <Field label="Other damage name" htmlFor={`${idPrefix}-other`} required>
          <Input id={`${idPrefix}-other`} value={row.otherName} onChange={(e) => onChange({ ...row, otherName: e.target.value })} maxLength={60} autoComplete="off" />
        </Field>
      ) : (
        <div className="hidden lg:block" />
      )}
      <Field label={unit === 'pcs' ? 'Damaged pcs' : 'Damaged metres'} htmlFor={`${idPrefix}-qty`} required error={error}>
        <Input
          id={`${idPrefix}-qty`}
          value={row.qty}
          onChange={(e) => onChange({ ...row, qty: unit === 'pcs' ? e.target.value.replace(/[^\d]/g, '') : e.target.value.replace(/[^\d.]/g, '') })}
          inputMode={unit === 'pcs' ? 'numeric' : 'decimal'}
          autoComplete="off"
        />
      </Field>
    </div>
  );
}
