import { ArrowLeft, Check, History, Palette, SearchX, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { normalizeCode, type Design } from '@rivoora/shared';
import { ErrorState, LoadMore, SearchBar } from '@/components/list-parts';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Modal } from '@/components/ui/modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { formatDate, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDesign, useDesigns } from '../masters/api';
import { DesignCard, DesignGridSkeleton } from '../masters/designs/designs-page';
import { usePreviousDesigns } from './api';

export interface SavedDesignPick {
  designId: number;
  variationId: number | null;
  code: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  /** The design's fixed material — pre-selected on the order. */
  material: { id: number; name: string } | null;
}

interface SavedDesignsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: number | null;
  customerName?: string;
  onPick: (pick: SavedDesignPick) => void;
  /** Currently attached design, highlighted in the lists. */
  current?: { designId: number; variationId: number | null } | null;
}

function PickTile({
  thumbUrl,
  code,
  sub,
  selected,
  onClick,
}: {
  thumbUrl: string | null;
  code: string;
  sub?: React.ReactNode;
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((d) => (
        <PickTile
          key={d.key}
          thumbUrl={d.thumbUrl}
          code={d.code}
          selected={current?.designId === d.designId && current.variationId === d.variationId}
          sub={
            <>
              {formatOrderNo(d.orderNo)} · {formatDate(d.orderDate)}
              {d.timesUsed > 1 && <span className="ml-1 font-semibold text-accent-foreground">· {d.timesUsed}×</span>}
            </>
          }
          onClick={() =>
            onPick({
              designId: d.designId,
              variationId: d.variationId,
              code: d.code,
              imageUrl: d.imageUrl,
              thumbUrl: d.thumbUrl,
              material: d.material,
            })
          }
        />
      ))}
    </div>
  );
}

function DesignVariationsView({
  designId,
  onBack,
  onPick,
  current,
}: {
  designId: number;
  onBack: () => void;
  onPick: (p: SavedDesignPick) => void;
  current: SavedDesignsDrawerProps['current'];
}) {
  const { data: design, isPending, isError, error, refetch } = useDesign(designId);
  const pickBase = (d: Design) =>
    onPick({ designId: d.id, variationId: null, code: d.code, imageUrl: d.imageUrl, thumbUrl: d.thumbUrl, material: d.material });

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-primary">
        <ArrowLeft className="size-4" /> All designs
      </button>
      {isPending ? (
        <TileSkeletons />
      ) : isError || !design ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div>
            <h3 className="text-lg font-bold text-slate-900">{design.code}</h3>
            {design.name && <p className="text-sm text-slate-500">{design.name}</p>}
            {design.material && <p className="text-sm text-slate-500">Material: {design.material.name}</p>}
            <p className="mt-1 text-sm text-muted-foreground">Choose the base design or one of its variations.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <PickTile
              thumbUrl={design.thumbUrl}
              code={design.code}
              sub="Base design"
              selected={current?.designId === design.id && current.variationId === null}
              onClick={() => pickBase(design)}
            />
            {design.variations.map((v) => (
              <PickTile
                key={v.id}
                thumbUrl={v.thumbUrl}
                code={v.code}
                sub={`Variation ${v.variationNo}`}
                selected={current?.variationId === v.id}
                onClick={() =>
                  onPick({
                    designId: design.id,
                    variationId: v.id,
                    code: v.code,
                    imageUrl: v.imageUrl,
                    thumbUrl: v.thumbUrl,
                    material: design.material,
                  })
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LibraryTab({
  search,
  active,
  onPick,
  current,
}: {
  search: string;
  active: boolean;
  onPick: (p: SavedDesignPick) => void;
  current: SavedDesignsDrawerProps['current'];
}) {
  const [openDesign, setOpenDesign] = useState<number | null>(null);
  const query = useDesigns(search, active);

  useEffect(() => setOpenDesign(null), [search]);

  if (openDesign) {
    return <DesignVariationsView designId={openDesign} onBack={() => setOpenDesign(null)} onPick={onPick} current={current} />;
  }
  if (query.isPending) return <TileSkeletons />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.items.length) {
    return search ? (
      <EmptyState icon={SearchX} title="No designs match your search" />
    ) : (
      <EmptyState icon={Palette} title="The design library is empty" description="Upload a design image instead." />
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {query.items.map((d) => (
          <DesignCard key={d.id} design={d} onClick={() => setOpenDesign(d.id)} />
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
  );
}

export function SavedDesignsDrawer({ open, onOpenChange, customerId, customerName, onPick, current }: SavedDesignsDrawerProps) {
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
          <SearchBar value={search} onChange={setSearch} placeholder="Search design or variation code…" />
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
            <LibraryTab search={debounced} active={open && tab === 'library'} onPick={pick} current={current} />
          </TabsContent>
        </div>
      </Tabs>
    </Modal>
  );
}
