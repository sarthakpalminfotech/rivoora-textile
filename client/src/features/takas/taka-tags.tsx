import { reButtaTag, REMILL_TAG } from '@rivoora/shared';
import { cn } from '@/lib/utils';

/** Small soft tags for Sprint 12 taka states (rework, return lot, moved from another order). One look, many screens. */
function Tag({ children, className, title }: { children: React.ReactNode; className: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-bold', className)}>
      {children}
    </span>
  );
}

/** "Re-butta" / "Re-butta ×2": the owner sent the taka back to butta cutting. */
export function ReButtaTag({ count, className }: { count: number; className?: string }) {
  return <Tag className={cn('bg-orange-100 text-orange-800', className)}>{reButtaTag(count)}</Tag>;
}

/** "Re-mill": the owner sent the taka back to the mill ("Sent back by owner"). */
export function ReMillTag({ className }: { className?: string }) {
  return (
    <Tag className={cn('bg-violet-100 text-violet-800', className)} title="Sent back by owner">
      {REMILL_TAG}
    </Tag>
  );
}

/** "Return lot": the taka made for a pcs-to-pcs goods return. */
export function ReturnLotTag({ className }: { className?: string }) {
  return <Tag className={cn('bg-sky-100 text-sky-800', className)}>Return lot</Tag>;
}

/** "Returned": the taka came back from a customer (GR). */
export function ReturnedTag({ className }: { className?: string }) {
  return <Tag className={cn('bg-sky-100 text-sky-800', className)}>Returned</Tag>;
}

/** "from Order #26": the taka was moved here from another order. */
export function FromOrderTag({ orderNo, className }: { orderNo: number; className?: string }) {
  return <Tag className={cn('bg-slate-100 text-slate-600', className)}>from Order #{orderNo}</Tag>;
}
