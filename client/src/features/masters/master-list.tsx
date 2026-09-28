import type { LucideIcon } from 'lucide-react';
import { Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorState, Fab, FetchingIndicator, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { useInfiniteList } from '@/hooks/useInfiniteList';
import { cn } from '@/lib/utils';

interface ToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  addLabel: string;
  onAdd?: () => void;
  fetching?: boolean;
}

export function MasterToolbar({ search, onSearch, placeholder, addLabel, onAdd, fetching }: ToolbarProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <SearchBar value={search} onChange={onSearch} placeholder={placeholder} />
        <FetchingIndicator show={!!fetching} />
        {onAdd && (
          <Button onClick={onAdd} className="hidden md:inline-flex">
            <Plus /> {addLabel}
          </Button>
        )}
      </div>
      {onAdd && <Fab onClick={onAdd} label={addLabel} />}
    </>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface MasterListProps<T extends { id: number }> {
  query: ReturnType<typeof useInfiniteList<T>>;
  columns: Column<T>[];
  card: (row: T) => ReactNode;
  onOpen: (row: T) => void;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  searching: boolean;
  noun: string;
  empty: { icon: LucideIcon; title: string; description?: string; action?: ReactNode };
  onClearSearch: () => void;
}

function RowActions<T>({ row, onEdit, onDelete }: { row: T; onEdit?: (r: T) => void; onDelete?: (r: T) => void }) {
  if (!onEdit && !onDelete) return null;
  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {onEdit && (
        <Button variant="ghost" size="icon-sm" onClick={() => onEdit(row)} aria-label="Edit">
          <Pencil />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-slate-500 hover:bg-destructive-soft hover:text-destructive"
          onClick={() => onDelete(row)}
          aria-label="Delete"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

export function MasterList<T extends { id: number }>({
  query,
  columns,
  card,
  onOpen,
  onEdit,
  onDelete,
  searching,
  noun,
  empty,
  onClearSearch,
}: MasterListProps<T>) {
  const { items, total, isPending, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const hasActions = !!(onEdit || onDelete);

  if (isPending) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-0">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="hidden h-4 w-1/5 md:block" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        {searching ? (
          <EmptyState
            icon={SearchX}
            title={`No ${noun} match your search`}
            action={
              <Button variant="secondary" onClick={onClearSearch}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState {...empty} />
        )}
      </div>
    );
  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-clip rounded-xl border border-border bg-white shadow-soft md:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="sticky top-16 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((c) => (
                <th key={c.header} scope="col" className={cn('px-4 py-3', c.className)}>
                  {c.header}
                </th>
              ))}
              {hasActions && (
                <th scope="col" className="w-28 px-4 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => onOpen(row)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(row)}
                className="cursor-pointer border-t border-border transition-colors hover:bg-slate-50 focus-visible:bg-slate-50"
              >
                {columns.map((c) => (
                  <td key={c.header} className={cn('truncate px-4 py-3.5 text-slate-700', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {hasActions && (
                  <td className="px-3 py-2">
                    <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2.5 md:hidden">
        {items.map((row) => (
          <li key={row.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpen(row)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(row)}
              className="flex items-start gap-2 rounded-xl border border-border bg-white p-4 shadow-soft active:bg-slate-50"
            >
              <div className="min-w-0 flex-1">{card(row)}</div>
              <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
            </div>
          </li>
        ))}
      </ul>

      <LoadMore
        hasNextPage={!!hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={() => void fetchNextPage()}
        shown={items.length}
        total={total}
        noun={noun}
      />
    </>
  );
}
