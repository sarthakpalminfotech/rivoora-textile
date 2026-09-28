import { Skeleton } from '@/components/ui/skeleton';

export function PageSkeleton() {
  return (
    <div className="page-container space-y-4 py-5" aria-busy="true" aria-label="Loading">
      <div className="flex gap-2">
        <Skeleton className="h-11 flex-1 rounded-[10px]" />
        <Skeleton className="size-11 rounded-[10px]" />
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-white p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
