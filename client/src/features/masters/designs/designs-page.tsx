import { Layers, Palette, Plus, SearchX } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DesignListItem } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, LoadMore } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { useDesigns } from '../api';
import { MasterToolbar } from '../master-list';
import { DesignFormDialog } from './design-form';

export function DesignCard({ design, onClick }: { design: DesignListItem; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-white text-left shadow-soft transition hover:border-primary/40 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <ImageThumb thumbUrl={design.thumbUrl} alt={design.code} preview={false} rounded="rounded-none" className="aspect-square w-full" />
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">{design.code}</p>
          <p className="truncate text-xs text-slate-500">{design.name ?? ' '}</p>
        </div>
        {design.variationCount > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-foreground"
            title={`${design.variationCount} variations`}
          >
            <Layers className="size-3" aria-hidden />
            {design.variationCount}
          </span>
        )}
      </div>
    </button>
  );
}

export function DesignGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border bg-white">
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="space-y-1.5 p-3">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </>
  );
}

export default function DesignsPage() {
  usePageTitle('Designs');
  const navigate = useNavigate();
  const { can } = useRole();
  const canManage = can('canManageMasters');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useDesigns(debounced);
  const [formOpen, setFormOpen] = useState(false);
  const { items, total, isPending, isError, error, refetch } = query;

  return (
    <div className="page-container space-y-4 pb-24 pt-5 md:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search by design or variation code…"
        addLabel="Add Design"
        onAdd={canManage ? () => setFormOpen(true) : undefined}
        fetching={query.isFetching && !isPending && !query.isFetchingNextPage}
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !isPending && items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {debounced ? (
            <EmptyState
              icon={SearchX}
              title="No designs match your search"
              action={
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Palette}
              title="No designs yet"
              description="Upload design images here. Designs uploaded while adding an order appear here too."
              action={
                canManage ? (
                  <Button onClick={() => setFormOpen(true)}>
                    <Plus /> Add Design
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {isPending ? (
              <DesignGridSkeleton />
            ) : (
              items.map((d) => <DesignCard key={d.id} design={d} onClick={() => navigate(`/designs/${d.id}`)} />)
            )}
          </div>
          {!isPending && (
            <LoadMore
              hasNextPage={!!query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              fetchNextPage={() => void query.fetchNextPage()}
              shown={items.length}
              total={total}
              noun="designs"
            />
          )}
        </>
      )}

      <DesignFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={(d) => navigate(`/designs/${d.id}`)} />
    </div>
  );
}
