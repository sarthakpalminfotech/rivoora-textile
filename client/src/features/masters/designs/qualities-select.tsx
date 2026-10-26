import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DesignQuality } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';
import { useMaterialLookup } from '../api';
import { MaterialFormDialog } from '../materials/materials-page';

interface QualitiesSelectProps {
  id?: string;
  /** The picked qualities (id + name, so the chips can show names that aren't in the current search results). */
  value: DesignQuality[];
  onChange: (qualities: DesignQuality[]) => void;
  invalid?: boolean;
  placeholder?: string;
  /** Show the picked qualities as removable chips under the dropdown (default on). */
  chips?: boolean;
  className?: string;
  /** Compact trigger for the Upload many tiles. */
  compact?: boolean;
}

/**
 * Sprint 18: the Qualities (Material master) multi-select of the design form and Upload many — server search, chips,
 * and a quick-add "+" for roles that may add materials.
 */
export function QualitiesSelect({ id, value, onChange, invalid, placeholder = 'Select qualities', chips = true, className, compact }: QualitiesSelectProps) {
  const { can } = useRole();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const lookup = useMaterialLookup(useDebounce(search.trim(), 300));
  const options = useMemo(() => {
    const seen = new Set<number>();
    const out: { value: number; label: string; description?: string | null }[] = [];
    // The picked ones first, so their names always show in the trigger, then the search results.
    for (const q of value) if (!seen.has(q.id)) (seen.add(q.id), out.push({ value: q.id, label: q.name }));
    for (const m of lookup.data ?? []) if (!seen.has(m.id)) (seen.add(m.id), out.push({ value: m.id, label: m.name, description: m.code }));
    return out;
  }, [value, lookup.data]);
  const names = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);

  return (
    <div className={cn('space-y-2', className)}>
      <MultiSelect<number>
        id={id}
        value={value.map((q) => q.id)}
        onChange={(ids) => onChange(ids.map((qid) => ({ id: qid, name: names.get(qid) ?? value.find((q) => q.id === qid)?.name ?? '' })))}
        options={options}
        placeholder={placeholder}
        searchable
        searchPlaceholder="Search qualities…"
        onSearchChange={setSearch}
        loading={lookup.isFetching}
        emptyText="No qualities found"
        invalid={invalid}
        triggerClassName={compact ? 'h-10 text-sm' : undefined}
        action={
          can('canManageMasters') ? (
            <Button
              variant="secondary"
              size="icon"
              className={cn('shrink-0', compact && 'size-10')}
              onClick={() => setAddOpen(true)}
              aria-label="Add a new quality"
              title="Add a new quality"
            >
              <Plus className="!size-5" />
            </Button>
          ) : undefined
        }
      />
      {chips && value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected qualities">
          {value.map((q) => (
            <li key={q.id} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-0.5 pl-2.5 pr-1 text-xs font-semibold text-primary">
              {q.name}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.id !== q.id))}
                className="flex size-5 items-center justify-center rounded-full hover:bg-primary/15"
                aria-label={`Remove ${q.name}`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {can('canManageMasters') && (
        <MaterialFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          material={null}
          readOnly={false}
          onSaved={(m) => onChange([...value, { id: m.id, name: m.name }])}
        />
      )}
    </div>
  );
}
