import { PO_STATUS_CONFIG, type PoStatus } from '@rivoora/shared';
import { cn } from '@/lib/utils';

/** Small status pill for an outside PO (Open / Partly received / Received / Closed / Cancelled). */
export function PoStatusPill({ status, className }: { status: PoStatus; className?: string }) {
  const cfg = PO_STATUS_CONFIG[status];
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold', className)}
      style={{ backgroundColor: cfg.badge.bg, color: cfg.badge.text }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: cfg.badge.dot }} aria-hidden />
      {cfg.label}
    </span>
  );
}
