import { getStatus } from '@/config/statuses';
import { cn } from '@/lib/utils';

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = getStatus(status);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
        className,
      )}
      style={{ backgroundColor: s.badge.bg, color: s.badge.text }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.badge.dot }} aria-hidden />
      <span className="truncate">{s.label}</span>
    </span>
  );
}
