import { AlertTriangle, Loader2, Plus, Search, X } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(({ value, onChange, placeholder, className }, ref) => (
  <Input
    ref={ref}
    type="search"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    aria-label={placeholder}
    enterKeyHint="search"
    wrapperClassName={cn('min-w-0 flex-1', className)}
    className="bg-white [&::-webkit-search-cancel-button]:hidden"
    prefix={<Search />}
    suffix={
      value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-muted hover:text-slate-700"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      ) : null
    }
  />
));
SearchBar.displayName = 'SearchBar';

interface LoadMoreProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  shown: number;
  total?: number;
  noun?: string;
  /** English + Hindi button (Taka entry screens). */
  bilingual?: boolean;
}

/** Infinite-scroll sentinel with a "Load more" fallback button. */
export function LoadMore({ hasNextPage, isFetchingNextPage, fetchNextPage, shown, total, noun = 'items', bilingual }: LoadMoreProps) {
  const ref = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, hasNextPage);

  return (
    <div ref={ref} className="flex flex-col items-center gap-2 py-5">
      {hasNextPage ? (
        <Button variant="secondary" size="sm" onClick={fetchNextPage} loading={isFetchingNextPage}>
          {isFetchingNextPage ? (bilingual ? 'Loading… / लोड हो रहा है…' : 'Loading…') : bilingual ? 'Load more / और देखें' : 'Load more'}
        </Button>
      ) : null}
      {total !== undefined && total > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {shown} of {total} {noun}
        </p>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive-soft text-destructive">
        <AlertTriangle className="size-7" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-slate-900">Couldn't load this</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Floating action button for mobile, sits above the bottom navigation. */
export function Fab({ onClick, label, icon }: { onClick: () => void; label: string; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="kb-hide-on-keyboard fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-pop transition hover:bg-primary-hover active:scale-95 md:hidden"
    >
      {icon ?? <Plus className="size-6" />}
    </button>
  );
}

export function FetchingIndicator({ show }: { show: boolean }) {
  if (!show) return null;
  return <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Updating" />;
}
