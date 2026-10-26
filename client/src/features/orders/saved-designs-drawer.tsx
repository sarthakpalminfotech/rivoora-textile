import { ArrowLeft, Check, ChevronRight, History, Palette, SearchX, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  normalizeCode,
  orderQualityGroups,
  type DesignListItem,
  type DesignQuality,
  type DesignQualityGroup,
} from '@rivoora/shared';
import { ErrorState, LoadMore, SearchBar } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Modal } from '@/components/ui/modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { formatDate, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDesignQualityGroups, useDesigns } from '../masters/api';
import { DesignCard, DesignGridSkeleton } from '../masters/designs/designs-page';
import { usePreviousDesigns } from './api';

export interface SavedDesignPick {
  designId: number;
  code: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  /** Sprint 18: the design's qualities — one fills in the order's quality, several make the user choose. */
  qualities: DesignQuality[];
  /** Sprint 16: the design's "Goes for butta cutting" — pre-fills the order's Butta step until the user taps it themselves.
   * Undefined for a pick from "Previous orders" (not loaded there). */
  buttaCutting?: boolean;
}

interface SavedDesignsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: number | null;
  customerName?: string;
  onPick: (pick: SavedDesignPick) => void;
  /** Currently attached design, highlighted in the lists. */
  current?: { designId: number } | null;
  /** Sprint 18: the order's quality (if already picked) — its group comes first in the library. */
  materialId?: number | null;
}

/** Tiles shown per quality before "Show all". */
const PER_GROUP = 6;
const TILE_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3';

const pickOf = (d: DesignListItem): SavedDesignPick => ({
  designId: d.id,
  code: d.code,
  imageUrl: d.imageUrl,
  thumbUrl: d.thumbUrl,
  qualities: d.qualities,
  buttaCutting: d.buttaCutting,
});

function PickTile({
  thumbUrl,
  code,
  sub,
  note,
  selected,
  onClick,
}: {
  thumbUrl: string | null;
  code: string;
  sub?: React.ReactNode;
  /** Shown below `sub` (e.g. the previous order's notes), up to 3 lines. */
  note?: string | null;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'relative flex w-full flex-col overflow-hidden rounded-xl border bg-white text-left shadow-soft transition hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
      )}
    >
      <ImageThumb thumbUrl={thumbUrl} alt={code} preview={false} rounded="rounded-none" className="aspect-square w-full" />
      <div className="min-w-0 px-3 py-2">
        <p className="truncate text-sm font-bold text-slate-900">{code}</p>
        {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
        {note && (
          <p className="mt-1.5 line-clamp-3 whitespace-pre-line rounded-md bg-amber-50 px-2 py-1 text-xs leading-snug text-amber-900" title={note}>
            {note}
          </p>
        )}
      </div>
      {selected && (
        <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-white shadow">
          <Check className="size-4" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function TileSkeletons() {
  return (
    <div className={TILE_GRID}>
      <DesignGridSkeleton count={6} />
    </div>
  );
}

function PreviousOrdersTab({
  customerId,
  customerName,
  search,
  onPick,
  current,
}: Pick<SavedDesignsDrawerProps, 'customerId' | 'customerName' | 'onPick' | 'current'> & { search: string }) {
  const { data, isPending, isError, error, refetch } = usePreviousDesigns(customerId);
  const items = useMemo(() => {
    const q = normalizeCode(search);
    return (data ?? []).filter((d) => !q || d.code.includes(q));
  }, [data, search]);

  if (!customerId) {
    return <EmptyState icon={UserRound} title="Select a client to see their previous designs" />;
  }
  if (isPending) return <TileSkeletons />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data.length) {
    return (
      <EmptyState
        icon={History}
        title="No previous designs"
        description={`${customerName ?? 'This client'} has no earlier orders with a design. Pick one from the design library.`}
      />
    );
  }
  if (!items.length) return <EmptyState icon={SearchX} title="No previous designs match your search" />;

  return (
    <div className={TILE_GRID}>
      {items.map((d) => (
        <PickTile
          key={d.key}
          thumbUrl={d.thumbUrl}
          code={d.code}
          selected={current?.designId === d.designId}
          sub={
            <>
              {formatOrderNo(d.orderNo)} · {formatDate(d.orderDate)}
              {d.timesUsed > 1 && <span className="ml-1 font-semibold text-accent-foreground">· {d.timesUsed}×</span>}
            </>
          }
          note={d.notes}
          onClick={() => onPick({ designId: d.designId, code: d.code, imageUrl: d.imageUrl, thumbUrl: d.thumbUrl, qualities: d.qualities })}
        />
      ))}
    </div>
  );
}

/** Every design of one quality ("Show all"), paged. */
function QualityDesignsView({
  group,
  search,
  onBack,
  onPick,
  current,
}: {
  group: DesignQualityGroup;
  search: string;
  onBack: () => void;
  onPick: (p: SavedDesignPick) => void;
  current: SavedDesignsDrawerProps['current'];
}) {
  const query = useDesigns(search, true, group.materialId ?? 'none');
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-primary">
        <ArrowLeft className="size-4" /> All qualities
      </button>
      <h3 className="text-lg font-bold text-slate-900">
        {group.name} <span className="text-sm font-semibold text-slate-500">· {query.total ?? group.designCount} designs</span>
      </h3>
      {query.isPending ? (
        <TileSkeletons />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className={TILE_GRID}>
            {query.items.map((d) => (
              <DesignCard key={d.id} design={d} groupMaterialId={group.materialId} selected={current?.designId === d.id} onClick={() => onPick(pickOf(d))} />
            ))}
          </div>
          <LoadMore
            hasNextPage={!!query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={() => void query.fetchNextPage()}
            shown={query.items.length}
            total={query.total}
            noun="designs"
          />
        </>
      )}
    </div>
  );
}

/**
 * Sprint 18: the design library grouped by quality — the order's quality first, then the others by name, "No quality"
 * last. A search (code or name) runs across all of them. Picking a design is one tap (no base design / variations).
 */
function LibraryTab({
  search,
  active,
  onPick,
  current,
  materialId,
}: {
  search: string;
  active: boolean;
  onPick: (p: SavedDesignPick) => void;
  current: SavedDesignsDrawerProps['current'];
  materialId?: number | null;
}) {
  const [openGroup, setOpenGroup] = useState<DesignQualityGroup | null>(null);
  const query = useDesignQualityGroups({ search: search || undefined, designs: search ? 24 : PER_GROUP }, active);
  const groups = useMemo(() => orderQualityGroups(query.data ?? [], materialId), [query.data, materialId]);

  useEffect(() => setOpenGroup(null), [search]);

  if (openGroup) {
    return <QualityDesignsView group={openGroup} search={search} onBack={() => setOpenGroup(null)} onPick={onPick} current={current} />;
  }
  if (query.isPending) return <TileSkeletons />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!groups.length) {
    return search ? (
      <EmptyState icon={SearchX} title="No designs match your search" />
    ) : (
      <EmptyState icon={Palette} title="The design library is empty" description="Upload a design image instead." />
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const first = materialId != null && g.materialId === materialId;
        return (
          <section key={g.materialId ?? 'none'} className="space-y-2.5" aria-label={g.name}>
            <div className="flex items-center gap-2">
              <h3 className={cn('min-w-0 truncate text-[15px] font-bold', g.materialId === null ? 'text-amber-900' : 'text-slate-900')}>{g.name}</h3>
              <span className="shrink-0 text-xs font-semibold text-slate-500">{g.designCount}</span>
              {first && <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">Order's quality</span>}
              {g.designCount > g.designs.length && (
                <button
                  type="button"
                  onClick={() => setOpenGroup(g)}
                  className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-0.5 text-sm font-semibold text-primary"
                >
                  Show all {g.designCount} <ChevronRight className="size-4" />
                </button>
              )}
            </div>
            <div className={TILE_GRID}>
              {g.designs.map((d) => (
                <DesignCard key={d.id} design={d} groupMaterialId={g.materialId} selected={current?.designId === d.id} onClick={() => onPick(pickOf(d))} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function SavedDesignsDrawer({ open, onOpenChange, customerId, customerName, onPick, current, materialId }: SavedDesignsDrawerProps) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'previous' | 'library'>(customerId ? 'previous' : 'library');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTab(customerId ? 'previous' : 'library');
    }
  }, [open, customerId]);

  const pick = (p: SavedDesignPick) => {
    onPick(p);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Saved designs"
      variant={isMobile ? 'fullscreen' : 'right'}
      bodyClassName="p-0 md:p-0"
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex h-full flex-col">
        <div className="shrink-0 space-y-3 border-b border-border px-4 pb-3 pt-3 md:px-5">
          <SearchBar value={search} onChange={setSearch} placeholder="Search design code or name…" />
          <TabsList>
            <TabsTrigger value="previous">Previous orders</TabsTrigger>
            <TabsTrigger value="library">Design library</TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5">
          <TabsContent value="previous" className="mt-0">
            {customerName && customerId && (
              <p className="mb-3 text-sm text-muted-foreground">
                Designs from earlier orders of <span className="font-semibold text-slate-700">{customerName}</span>, most recent first.
              </p>
            )}
            <PreviousOrdersTab customerId={customerId} customerName={customerName} search={debounced} onPick={pick} current={current} />
          </TabsContent>
          <TabsContent value="library" className="mt-0">
            <LibraryTab search={debounced} active={open && tab === 'library'} onPick={pick} current={current} materialId={materialId} />
          </TabsContent>
        </div>
      </Tabs>
    </Modal>
  );
}

/** Sprint 18: "Which quality?" — shown when the picked design is in several qualities (only its qualities are listed). */
export function QualityChooser({
  open,
  designCode,
  options,
  onChoose,
  onCancel,
}: {
  open: boolean;
  designCode: string;
  options: DesignQuality[];
  onChoose: (q: DesignQuality) => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title="Which quality?"
      description={`Design ${designCode} is made in ${options.length} qualities. Pick the one for this order (you can still change it).`}
      variant="center"
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {options.map((q) => (
          <li key={q.id}>
            <button
              type="button"
              onClick={() => onChoose(q)}
              className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-border bg-white px-4 text-left text-[15px] font-semibold text-slate-900 shadow-soft transition hover:border-primary/50 hover:bg-primary-soft/40 focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {q.name}
              <ChevronRight className="size-4 text-slate-400" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Closing this keeps the order's quality as it is.</p>
    </Modal>
  );
}
