import { getJobsheetStatus, jobsheetStatusLabel } from '@rivoora/shared';
import { getStatus } from '@/config/statuses';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';

/**
 * Status pill; colours and label come from the status config (order statuses by default).
 * Jobsheet labels depend on the role (the supervisor sees "Sent" as "Pending").
 */
export function StatusBadge({
  status,
  kind = 'order',
  className,
}: {
  status: string;
  kind?: 'order' | 'jobsheet';
  className?: string;
}) {
  const { role } = useRole();
  const s = kind === 'jobsheet' ? getJobsheetStatus(status) : getStatus(status);
  const label = kind === 'jobsheet' ? jobsheetStatusLabel(status, role) : s.label;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
        className,
      )}
      style={{ backgroundColor: s.badge.bg, color: s.badge.text }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.badge.dot }} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
