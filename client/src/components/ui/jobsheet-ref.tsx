import { jobsheetRef } from '@rivoora/shared';
import { cn } from '@/lib/utils';

interface JobsheetRefProps {
  orderNo: number;
  jobsheetNo: number;
  /** `full` = "Order #26 (319)", `short` = "#26 (319)". */
  variant?: 'full' | 'short';
  className?: string;
  /** Classes for the bracketed jobsheet number (smaller + muted by default). */
  bracketClassName?: string;
}

/**
 * The order number first — large / bold, inherits the surrounding text style — with the jobsheet number in brackets,
 * smaller and muted: "Order #26 (319)". The plain-text form is `jobsheetRef()` / `jobsheetRefShort()` in shared.
 */
export function JobsheetRef({ orderNo, jobsheetNo, variant = 'full', className, bracketClassName }: JobsheetRefProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-baseline gap-[0.3em]', className)} aria-label={jobsheetRef(orderNo, jobsheetNo)}>
      <span aria-hidden className="truncate">
        {variant === 'full' ? 'Order ' : ''}#{orderNo}
      </span>
      <span aria-hidden className={cn('shrink-0 text-[0.7em] font-semibold text-slate-400', bracketClassName)}>
        ({jobsheetNo})
      </span>
    </span>
  );
}
