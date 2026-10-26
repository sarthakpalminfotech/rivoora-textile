import { ArrowLeft, ImagePlus, Images, Layers, Palette, Plus, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  NO_QUALITY_LABEL,
  NO_QUALITY_PARAM,
  otherQualitiesHint,
  parseQualityParam,
  QUALITY_CARD_THUMBS,
  type DesignListItem,
  type DesignQualityGroup,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState, Fab, FetchingIndicator, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';
import { useDesignQualityGroups, useDesigns } from '../api';
import { DesignFormDialog } from './design-form';

/** Small "Butta" tag: the design goes for butta cutting. */
export function ButtaTag({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-800 ${className ?? ''}`}
      title="Goes for butta cutting"
    >
      Butta
    </span>
  );
}

/**
 * One design tile (code, name). Under a quality group (`groupMaterialId`) a design that is in more qualities shows
 * "+2 qualities"; elsewhere (`showQualities`) its qualities are listed.
 */
export function DesignCard({
  design,
  onClick,
  groupMaterialId,
  showQualities,
  selected,
}: {
  design: DesignListItem;
  onClick: () => void;
  groupMaterialId?: number | null;
  showQualities?: boolean;
  selected?: boolean;
}) {
  const hint = groupMaterialId !== undefined ? otherQualitiesHint(design.qualities, groupMaterialId) : null;
  const qualities = showQualities ? design.qualities.map((q) => q.name).join(', ') || NO_QUALITY_LABEL : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'group flex w-full flex-col overflow-hidden rounded-xl border bg-white text-left shadow-soft transition hover:border-primary/40 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
      )}
    >
      <ImageThumb thumbUrl={design.thumbUrl} alt={design.code} preview={false} rounded="rounded-none" className="aspect-square w-full" />
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-bold text-slate-900">
            <span className="truncate">{design.code}</span>
            {design.buttaCutting && <ButtaTag />}
          </p>
          <p className="truncate text-xs text-slate-500">{[design.name, qualities].filter(Boolean).join(' · ') || ' '}</p>
        </div>
        {hint && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-foreground"
            title={design.qualities.map((q) => q.name).join(', ')}
          >
            <Layers className="size-3" aria-hidden />
            {hint}
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

/** Sprint 18: one quality of the library — its name, how many designs, and a strip of its newest thumbnails. */
export function QualityCard({ group, onClick }: { group: DesignQualityGroup; onClick: () => void }) {
  const noQuality = group.materialId === null;
  const thumbs = group.designs.slice(0, QUALITY_CARD_THUMBS);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-3 rounded-xl border bg-white p-3 text-left shadow-soft transition hover:border-primary/40 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40',
        noQuality ? 'border-dashed border-amber-300 bg-amber-50/40' : 'border-border',
      )}
    >
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: QUALITY_CARD_THUMBS }, (_, i) =>
          thumbs[i] ? (
            <ImageThumb key={thumbs[i].id} thumbUrl={thumbs[i].thumbUrl} alt={thumbs[i].code} preview={false} rounded="rounded-md" className="aspect-square w-full" />
          ) : (
            <span key={i} className="aspect-square w-full rounded-md bg-slate-100" aria-hidden />
          ),
        )}
      </div>
      <div className="flex min-w-0 items-baseline gap-2 px-0.5">
        <p className={cn('min-w-0 flex-1 truncate text-[15px] font-bold', noQuality ? 'text-amber-900' : 'text-slate-900')}>{group.name}</p>
        <span className="shrink-0 text-sm font-semibold text-slate-500">
          {group.designCount} {group.designCount === 1 ? 'design' : 'designs'}
        </span>
      </div>
      {noQuality && <p className="-mt-2 px-0.5 text-xs text-amber-800">Older designs — edit them to add a quality</p>}
    </button>
  );
}

function QualityGridSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border bg-white p-3">
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: 4 }, (_, j) => (
              <Skeleton key={j} className="aspect-square w-full rounded-md" />
            ))}
          </div>
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </>
  );
}

const QUALITY_GRID = 'grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:gap-4 lg:grid-cols-3 2xl:grid-cols-4';
const DESIGN_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';

/**
 * The Design library (`/designs`). Sprint 18: first level = one card per quality (+ "No quality"); `?quality=<id|none>`
 * = that quality's designs. Searching on the first level shows the matching designs (code / name) above the matching
 * qualities. Jenish / Gaurang manage designs (Add, Upload many); Dhruvil only views.
 */
export default function DesignsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRole();
  const canManage = can('canManageDesigns');
  const [params, setParams] = useSearchParams();
  const quality = parseQualityParam(params.get('quality'));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounce(search.trim(), 300);
  const [formOpen, setFormOpen] = useState(false);
  // Moving between the levels (links, Back) brings the search box in line with the URL.
  useEffect(() => {
    setSearch(params.get('q') ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  const groupsQuery = useDesignQualityGroups({ qualitySearch: quality === null ? debounced || undefined : undefined });
  const allGroups = useDesignQualityGroups({ designs: 0 });
  const current = quality === null ? null : (allGroups.data ?? []).find((g) => (quality === 'none' ? g.materialId === null : g.materialId === quality));
  const title = quality === null ? 'Design library' : quality === 'none' ? NO_QUALITY_LABEL : (current?.name ?? 'Quality');
  usePageTitle(quality === null ? 'Designs' : `Designs · ${title}`);

  // Level 2 (a quality's designs) and the first level's design search share the paged list.
  const designsQuery = useDesigns(debounced, quality !== null || !!debounced, quality);
  const initialQualities = useMemo(
    () => (typeof quality === 'number' && current ? [{ id: quality, name: current.name }] : undefined),
    [quality, current],
  );

  const setSearchText = (v: string) => {
    setSearch(v);
    const next = new URLSearchParams(params);
    if (v.trim()) next.set('q', v);
    else next.delete('q');
    setParams(next, { replace: true });
  };
  const openQuality = (g: DesignQualityGroup) => {
    setSearch('');
    navigate(`/designs?quality=${g.materialId ?? NO_QUALITY_PARAM}`);
  };
  const openDesign = (d: DesignListItem) => navigate(`/designs/${d.id}`, { state: { from: `${location.pathname}${location.search}` } });
  const uploadUrl = `/designs/upload${typeof quality === 'number' ? `?quality=${quality}` : ''}`;

  const fetching =
    (groupsQuery.isFetching && !groupsQuery.isPending) || (designsQuery.isFetching && !designsQuery.isPending && !designsQuery.isFetchingNextPage);

  const toolbar = (
    <div className="flex items-center gap-2">
      <SearchBar
        value={search}
        onChange={setSearchText}
        placeholder={quality === null ? 'Search a quality or a design code…' : `Search designs in ${title}…`}
      />
      <FetchingIndicator show={fetching} />
      {canManage && (
        <>
          <Button variant="secondary" onClick={() => navigate(uploadUrl)} aria-label="Upload many designs" className="shrink-0 max-md:size-11 max-md:px-0">
            <Images /> <span className="hidden md:inline">Upload many</span>
          </Button>
          <Button onClick={() => setFormOpen(true)} className="hidden md:inline-flex">
            <Plus /> Add design
          </Button>
        </>
      )}
    </div>
  );

  const designGrid = (
    <>
      <div className={DESIGN_GRID}>
        {designsQuery.isPending ? (
          <DesignGridSkeleton />
        ) : (
          designsQuery.items.map((d) => (
            <DesignCard
              key={d.id}
              design={d}
              onClick={() => openDesign(d)}
              groupMaterialId={typeof quality === 'number' ? quality : undefined}
              showQualities={quality === null}
            />
          ))
        )}
      </div>
      {!designsQuery.isPending && (
        <LoadMore
          hasNextPage={!!designsQuery.hasNextPage}
          isFetchingNextPage={designsQuery.isFetchingNextPage}
          fetchNextPage={() => void designsQuery.fetchNextPage()}
          shown={designsQuery.items.length}
          total={designsQuery.total}
          noun="designs"
        />
      )}
    </>
  );

  let body: React.ReactNode;
  if (quality !== null) {
    // Level 2: the designs of one quality.
    body = designsQuery.isError ? (
      <ErrorState error={designsQuery.error} onRetry={() => void designsQuery.refetch()} />
    ) : !designsQuery.isPending && designsQuery.items.length === 0 ? (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        {debounced ? (
          <EmptyState
            icon={SearchX}
            title={`No designs in ${title} match your search`}
            action={
              <Button variant="secondary" onClick={() => setSearchText('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Palette} title={`No designs in ${title} yet`} />
        )}
      </div>
    ) : (
      designGrid
    );
  } else {
    // Level 1: quality cards (and, while searching, the matching designs first).
    const groups = groupsQuery.data ?? [];
    const designHits = debounced ? designsQuery.items : [];
    const nothing = !groupsQuery.isPending && groups.length === 0 && (!debounced || (!designsQuery.isPending && designHits.length === 0));
    body = groupsQuery.isError ? (
      <ErrorState error={groupsQuery.error} onRetry={() => void groupsQuery.refetch()} />
    ) : nothing ? (
      <div className="rounded-xl border border-border bg-white shadow-soft">
        {debounced ? (
          <EmptyState
            icon={SearchX}
            title="No qualities or designs match your search"
            action={
              <Button variant="secondary" onClick={() => setSearchText('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Palette}
            title="No designs yet"
            description="Add designs here (one by one or many at once). Designs uploaded while adding an order appear here too."
            action={
              canManage ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={() => navigate(uploadUrl)}>
                    <ImagePlus /> Upload many
                  </Button>
                  <Button onClick={() => setFormOpen(true)}>
                    <Plus /> Add design
                  </Button>
                </div>
              ) : undefined
            }
          />
        )}
      </div>
    ) : (
      <div className="space-y-6">
        {debounced && (designsQuery.isPending || designHits.length > 0) && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Designs {designsQuery.total !== undefined && <span className="font-normal normal-case">({designsQuery.total})</span>}
            </h2>
            {designGrid}
          </section>
        )}
        {(groupsQuery.isPending || groups.length > 0) && (
          <section className="space-y-3">
            {debounced && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Qualities</h2>}
            <div className={QUALITY_GRID}>
              {groupsQuery.isPending ? <QualityGridSkeleton /> : groups.map((g) => <QualityCard key={g.materialId ?? 'none'} group={g} onClick={() => openQuality(g)} />)}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      {quality !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link to="/designs" className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-primary">
            <ArrowLeft className="size-4" /> All qualities
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-slate-900">
            {title}
            {current && <span className="ml-2 text-sm font-semibold text-slate-500">{current.designCount} designs</span>}
          </h1>
        </div>
      )}
      {toolbar}
      {body}
      {canManage && <Fab onClick={() => setFormOpen(true)} label="Add design" />}
      {canManage && (
        <DesignFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          initialQualities={initialQualities}
          onSaved={(d) => navigate(`/designs/${d.id}`, { state: { from: `${location.pathname}${location.search}` } })}
        />
      )}
    </div>
  );
}
