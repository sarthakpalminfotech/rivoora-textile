import { ORDER_TYPE_LABEL, type OrderType } from '@rivoora/shared';
import { cn } from '@/lib/utils';

/** Small neutral tag with the order type ("Lump" / "Pcs to pcs") — order cards, header, details. */
export function OrderTypeTag({ type, className }: { type: OrderType; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-foreground',
        className,
      )}
      title="Order type"
    >
      {ORDER_TYPE_LABEL[type]}
    </span>
  );
}
