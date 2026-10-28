/**
 * Sprint 19 — the ONE place screens/services ask "which unit is this order". Meter ("all-over") orders flow
 * through the same pipeline as pcs orders; every quantity is meters instead of pcs/frames. Never scatter
 * `unit === 'meters'` checks elsewhere — use these helpers.
 */

export const isMeterOrder = (order: { unit: string }): boolean => order.unit === 'meters';

/** "m" / "pcs" — the short unit word shown after a number. */
export const qtyLabel = (unit: string): string => (unit === 'meters' ? 'm' : 'pcs');

export interface TakaQtyLike {
  meters: number | null;
  actualMeters?: number | null;
  pcs: number | null;
  actualPcs?: number | null;
}

/** The taka's current quantity in its order's unit: the godown-corrected value when set, else the entered one. */
export function takaQty(t: TakaQtyLike, unit: string): number | null {
  if (unit === 'meters') return t.actualMeters ?? t.meters ?? null;
  return t.actualPcs ?? t.pcs ?? null;
}

/** "1,250.5 m" / "1,250 pcs". */
export function formatQty(n: number, unit: string): string {
  const decimals = unit === 'meters' ? 2 : 3;
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: decimals })} ${qtyLabel(unit)}`;
}

/* ------------------------------------------------------------------ */
/* Sprint 19 §10: manual stock — hidden "stock-holder" orders            */
/* ------------------------------------------------------------------ */

/** Shown wherever a stock-holder order's number would otherwise leak into the UI. */
export const MANUAL_STOCK_LABEL = 'Manual stock';

/** Stock-holder orders get a negative order number — never collides with the real `MAX(order_no)+1` sequence. */
export const isManualStockOrderNo = (orderNo: number): boolean => orderNo < 0;

/** "#26" for a real order, "Manual stock" for a hidden stock-holder order. */
export function orderRefText(orderNo: number): string {
  return isManualStockOrderNo(orderNo) ? MANUAL_STOCK_LABEL : `#${orderNo}`;
}
