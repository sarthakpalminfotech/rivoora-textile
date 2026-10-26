import { cn } from '@/lib/utils';

/**
 * Sprint 18: "Outside order · <party>" — the order is made for another party. Violet on purpose: Sprint 16's
 * "Outside production" (POs to outside weavers) is a sky tag. Renders nothing for a normal order or when the party name
 * is hidden (roles that can't see the client get no name, so no tag).
 */
export function OutsideOrderTag({ order, className }: { order: { isOutsideOrder: boolean; outsidePartyName: string | null }; className?: string }) {
  if (!order.isOutsideOrder || !order.outsidePartyName) return null;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full shrink items-center gap-1 whitespace-nowrap rounded-md border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800',
        className,
      )}
      title={`Outside order — made for ${order.outsidePartyName}`}
    >
      <span className="shrink-0 uppercase tracking-wide">Outside order</span>
      <span className="truncate font-medium normal-case">· {order.outsidePartyName}</span>
    </span>
  );
}
