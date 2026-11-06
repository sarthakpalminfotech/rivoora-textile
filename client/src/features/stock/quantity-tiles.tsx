import { FilePlus2, MinusCircle, PackagePlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dualText, parseInventoryKey, type DualStock } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';
import { useDesign } from '../masters/api';
import { useDesignQuantities } from './api';

/** One big tile: a label and the quantity in BOTH units ("1,240 pcs · 860.50 m"), never added together. */
export function QtyTile({ label, pcs, meters, dot, danger }: { label: string; pcs: number; meters: number; dot: string; danger?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-white px-4 py-4">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
        {label}
      </p>
      <p className={cn('mt-2 text-[22px] font-bold leading-tight tabular-nums tracking-tight md:text-[26px]', danger ? 'text-red-600' : 'text-slate-900')}>
        {pcs > 0 || meters <= 0 ? <span className="block">{pcs.toLocaleString('en-IN')} <span className="text-[14px] font-semibold text-slate-400">pcs</span></span> : null}
        {meters > 0 && <span className="block">{meters.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[14px] font-semibold text-slate-400">m</span></span>}
      </p>
    </div>
  );
}

/** The current quantity of a design: Free stock · Ready · In making · Damaged (tablet: a 2×2 grid, desktop: one row). */
export function DesignQuantityTiles({ dual }: { dual: DualStock | undefined }) {
  if (!dual) return <Skeleton className="h-24 rounded-xl" />;
  const { pcs, meters } = dual;
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Current quantity">
      <QtyTile label="Free stock" pcs={pcs.free} meters={meters.free} dot="#6366F1" />
      <QtyTile label="Ready" pcs={pcs.ready} meters={meters.ready} dot="#10B981" />
      <QtyTile label="In making" pcs={pcs.inMaking} meters={meters.inMaking} dot="#38BDF8" />
      <QtyTile label="Damaged" pcs={pcs.damaged} meters={meters.damaged} dot="#EF4444" danger={pcs.damaged > 0 || meters.damaged > 0} />
    </div>
  );
}

/** Create order · Add stock · Remove stock for this design (Assign to order lives in the Free stock section). */
export function DesignStockActions({ itemKey }: { itemKey: string }) {
  const { can } = useRole();
  const parts = parseInventoryKey(itemKey);
  const designId = parts && parts.kind === 'design' ? parts.id : null;
  const qty = useDesignQuantities(itemKey);
  const design = useDesign(designId);
  if (!designId) return null;
  // The design's quality: the one it has stock / orders in, else its first quality.
  const materialId = qty.data?.byQuality[0]?.materialId ?? design.data?.qualities?.[0]?.id ?? null;
  const q = new URLSearchParams({ designId: String(designId), ...(materialId ? { qualityId: String(materialId), materialId: String(materialId) } : {}) });
  const createQ = new URLSearchParams({ designId: String(designId), ...(materialId ? { qualityId: String(materialId) } : {}) });
  if (!can('canAddOrder') && !can('canAdjustFinishedStock')) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {can('canAddOrder') && (
        <Button asChild size="sm">
          <Link to={`/orders/new?${createQ.toString()}`}>
            <FilePlus2 /> Create order
          </Link>
        </Button>
      )}
      {can('canAdjustFinishedStock') && (
        <>
          <Button asChild variant="secondary" size="sm">
            <Link to={`/inventory/stock/add?${q.toString()}`}>
              <PackagePlus /> Add stock
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link to={`/inventory/stock/remove?${q.toString()}`}>
              <MinusCircle /> Remove stock
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}

export { dualText };
