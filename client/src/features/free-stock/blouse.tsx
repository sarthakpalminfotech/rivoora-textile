import { Shirt } from 'lucide-react';
import { BLOUSE_FILTER_LABEL, BLOUSE_LABEL, BLOUSE_LABEL_HI, blouseFilterOptions, type BlouseCounts, type BlouseFilter, type BlouseOption } from '@rivoora/shared';
import { cn } from '@/lib/utils';

/**
 * A small soft badge for the order's blouse option ("With blouse" / "Without blouse"), with a tiny icon. Renders
 * nothing when the option is not set — so it can be dropped next to any order label. `hindi` adds the Hindi text for
 * the bilingual screens (Taka entry, QC).
 */
export function BlouseTag({ option, hindi, className }: { option: BlouseOption | null | undefined; hindi?: boolean; className?: string }) {
  if (!option) return null;
  const with_ = option === 'with_blouse';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold',
        with_ ? 'bg-fuchsia-50 text-fuchsia-800' : 'bg-slate-100 text-slate-600',
        className,
      )}
    >
      <Shirt className="size-3 shrink-0" aria-hidden />
      {BLOUSE_LABEL[option]}
      {hindi && (
        <span lang="hi" className="font-medium opacity-80">
          · {BLOUSE_LABEL_HI[option]}
        </span>
      )}
    </span>
  );
}

/**
 * Inventory item details: All · With blouse · Without blouse · Not set, each with its pcs. Only the options that have
 * data are shown (All always).
 */
export function BlouseToggle({
  value,
  onChange,
  counts,
  className,
}: {
  value: BlouseFilter;
  onChange: (v: BlouseFilter) => void;
  counts: BlouseCounts;
  className?: string;
}) {
  const options = blouseFilterOptions(counts);
  // Only "All" has data → nothing to choose between.
  if (options.length <= 2 && value === 'all') return null;
  return (
    <div role="radiogroup" aria-label="Blouse" className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-[10px] bg-muted p-1', className)}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'min-h-9 rounded-lg px-3 text-[13px] font-semibold text-muted-foreground transition-colors',
            value === o.key && 'bg-white text-primary shadow-soft',
          )}
        >
          {BLOUSE_FILTER_LABEL[o.key]} <span className="tabular-nums opacity-70">{o.pcs.toLocaleString('en-IN')}</span>
        </button>
      ))}
    </div>
  );
}
