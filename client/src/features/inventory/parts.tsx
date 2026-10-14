import { ArrowLeft, Search, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type DamageType, type InventoryItemHeader } from '@rivoora/shared';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export const pcsText = (n: number) => n.toLocaleString('en-IN');

/** Dot colour per damage type (the small marker on taka rows and the filter chips). */
export const DAMAGE_DOT: Record<DamageType, string> = {
  machine: '#EF4444',
  butta: '#F59E0B',
  mill: '#8B5CF6',
  godown: '#64748B',
  customer_return: '#0EA5E9',
};

/** One calm tile: one big number, a small label and a tiny coloured dot. Becomes a button when `onClick` is given. */
export function KpiTile({
  label,
  value,
  dot,
  tone,
  onClick,
  active,
  className,
}: {
  label: string;
  value: ReactNode;
  dot?: string;
  tone?: 'danger';
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        {dot && <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('mt-1.5 block text-[26px] font-bold leading-none tabular-nums tracking-tight', tone === 'danger' ? 'text-red-600' : 'text-slate-900')}>{value}</span>
    </>
  );
  const base = 'min-w-0 rounded-xl border bg-white px-4 py-3.5 text-left';
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(base, 'min-h-[44px] outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40', active ? 'border-primary/40 bg-primary-soft/40' : 'border-border hover:border-slate-300', className)}
      >
        {body}
      </button>
    );
  }
  return <div className={cn(base, 'border-border', className)}>{body}</div>;
}

/** Skeleton row of tiles; wrap in the same grid classes as the real row. */
export function KpiSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[78px] rounded-xl" />
      ))}
    </>
  );
}

/** A search icon that expands into a field; the ✕ closes it and clears the text. */
export function ExpandingSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [open, setOpen] = useState(value !== '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value !== '') setOpen(true);
  }, [value]);
  useEffect(() => {
    if (open && value === '') ref.current?.focus();
    // focus only when it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-500 outline-none transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-primary/40', className)}
        aria-label={placeholder}
      >
        <Search className="size-5" aria-hidden />
      </button>
    );
  }
  return (
    <div
      className={cn(
        'flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-white pl-3 pr-1 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 sm:max-w-xs sm:flex-none sm:basis-72',
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-slate-400" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="button"
        onClick={() => {
          onChange('');
          setOpen(false);
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Close search"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Image + code + name — the header of both details screens. */
export function ItemHeader({ item }: { item: InventoryItemHeader }) {
  return (
    <section className="flex items-center gap-4 rounded-2xl border border-border bg-white p-4 shadow-soft">
      <ImageThumb
        thumbUrl={item.thumbUrl}
        fullUrl={item.imageUrl}
        alt={item.code ? `Design ${item.code}` : 'No design'}
        className="size-20 shrink-0 md:size-24"
        rounded="rounded-xl"
      />
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-extrabold leading-tight tracking-tight text-slate-900">{item.code ?? 'Without design'}</h1>
        {(item.name || item.variationOf) && (
          <p className="truncate text-[15px] font-medium text-slate-600">
            {item.name}
            {item.variationOf && (
              <span className="text-slate-500">
                {item.name ? ' · ' : ''}Variation of {item.variationOf}
              </span>
            )}
          </p>
        )}
        {item.quality && <p className="truncate text-sm text-slate-500">{item.quality}</p>}
      </div>
    </section>
  );
}

/** Round 56px item image for the cards (tap to zoom; the rest of the card opens the details). */
export function CardThumb({ item }: { item: InventoryItemHeader }) {
  return <ImageThumb thumbUrl={item.thumbUrl} fullUrl={item.imageUrl} alt={item.code ? `Design ${item.code}` : 'No design'} className="size-14 shrink-0" rounded="rounded-xl" />;
}

/** "← Inventory" — returns to the list the user came from (section + search kept), else to the Inventory home. */
export function BackLink({ fallback = '/inventory' }: { fallback?: string }) {
  const from = (useLocation().state as { from?: string } | null)?.from;
  return (
    <Link to={from ?? fallback} className="inline-flex h-11 items-center gap-1.5 rounded-lg pr-3 text-sm font-semibold text-slate-600 outline-none hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-primary/40">
      <ArrowLeft className="size-4" aria-hidden /> Inventory
    </Link>
  );
}
