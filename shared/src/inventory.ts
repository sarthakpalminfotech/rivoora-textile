import { jobsheetPcs } from './jobsheets';
import type { JobsheetStatusKey } from './statuses';

/**
 * Inventory (Sprint 10): design-wise pcs. An inventory item = a design (orders without a design go into one "Without
 * design" item; Sprint 18: variations are gone). Only pcs-unit orders count. Everything is pcs, using the ACTUAL pcs of takas.
 *
 * `orderInventoryPcs` is the ONE definition of the figures; the server loads aggregate rows per order and calls it, so
 * the Inventory screens, the item details and the order dashboard bar always agree (see inventory.test.ts).
 */

/** Takas in these stages are "in making" (everything before the godown). */
export const MAKING_STAGES: readonly string[] = ['entered', 'rework_butta', 'at_butta', 'butta_qc', 'waiting_mill', 'at_mill', 'mill_qc'];
/** Damaged stock that is physically in the godown. */
export const DAMAGED_STOCK_STAGES: readonly string[] = ['final', 'ready_dispatch'];

export interface InventoryOrderInput {
  unit: string;
  /** Ordered pcs. */
  quantity: number;
}

export interface InventoryJobsheetInput {
  id: number;
  status: string;
  frames: number;
  completedFrames: number | null;
  /** Sprint 18: sections per beam of the jobsheet (default 3). */
  sections?: number | null;
}

/** Active takas — one row per taka or aggregated rows (`count`, default 1), per jobsheet and stage. */
export interface InventoryTakaInput {
  jobsheetId: number;
  stage: string;
  count?: number;
  /** Actual pcs (sum). Null when none of the takas has pcs. */
  pcs?: number | null;
  /** How many of the takas have no pcs (default: all of them when `pcs` is null, else none). */
  withoutPcs?: number;
  /** OPEN damaged pcs (`pcs − resolved_pcs`) on these takas. Counted only for final / ready_dispatch takas. */
  damagedPcs?: number | null;
}

export interface InventoryPcs {
  ordered: number;
  /** Everything still being made, before the godown. */
  inMaking: number;
  /** Final takas (Mill QC done, not yet ready for dispatch). */
  inGodown: number;
  readyDispatch: number;
  inRefinish: number;
  /** Open damaged pcs in the godown. */
  damaged: number;
}

export const EMPTY_INVENTORY_PCS: InventoryPcs = { ordered: 0, inMaking: 0, inGodown: 0, readyDispatch: 0, inRefinish: 0, damaged: 0 };

/** Finished stock on hand = ready for dispatch + in godown. */
export const totalInGodown = (p: Pick<InventoryPcs, 'inGodown' | 'readyDispatch'>) => p.inGodown + p.readyDispatch;

export function addInventoryPcs(a: InventoryPcs, b: InventoryPcs): InventoryPcs {
  return {
    ordered: a.ordered + b.ordered,
    inMaking: a.inMaking + b.inMaking,
    inGodown: a.inGodown + b.inGodown,
    readyDispatch: a.readyDispatch + b.readyDispatch,
    inRefinish: a.inRefinish + b.inRefinish,
    damaged: a.damaged + b.damaged,
  };
}

/**
 * The pcs figures of ONE order, or `null` when the order is not in pcs (left out of the inventory).
 * Pcs not yet turned into takas count as "in making": Pending / Sent / Ongoing jobsheets count frames × sections per
 * beam, Completed ones their actual frames; a taka without pcs gets its share of its jobsheet's frames × sections
 * (the same rule as the order dashboard bar).
 */
export function orderInventoryPcs(
  order: InventoryOrderInput,
  jobsheets: readonly InventoryJobsheetInput[],
  takas: readonly InventoryTakaInput[],
  /** Sprint 16: pcs still to come on the order's open pcs POs ("at outside weaver") — counted as In making. */
  pendingOutsidePcs = 0,
): InventoryPcs | null {
  if (order.unit !== 'pcs') return null;

  const takaCount = new Map<number, number>();
  for (const t of takas) {
    const n = t.count ?? 1;
    if (n > 0) takaCount.set(t.jobsheetId, (takaCount.get(t.jobsheetId) ?? 0) + n);
  }
  const framePcs = new Map<number, number>();
  let inMaking = Math.max(0, pendingOutsidePcs);
  for (const j of jobsheets) {
    const pcs = jobsheetPcs({ frames: j.frames, status: j.status as JobsheetStatusKey, completedFrames: j.completedFrames, sections: j.sections });
    if ((takaCount.get(j.id) ?? 0) === 0) inMaking += pcs;
    else framePcs.set(j.id, pcs / takaCount.get(j.id)!);
  }

  let inGodown = 0;
  let readyDispatch = 0;
  let inRefinish = 0;
  let damaged = 0;
  for (const t of takas) {
    const n = t.count ?? 1;
    if (n <= 0) continue;
    const without = Math.min(n, t.withoutPcs ?? (t.pcs == null ? n : 0));
    const pcs = (t.pcs ?? 0) + without * (framePcs.get(t.jobsheetId) ?? 0);
    if (MAKING_STAGES.includes(t.stage)) inMaking += pcs;
    else if (t.stage === 'final') inGodown += pcs;
    else if (t.stage === 'ready_dispatch') readyDispatch += pcs;
    else if (t.stage === 'refinish') inRefinish += pcs;
    if (DAMAGED_STOCK_STAGES.includes(t.stage)) damaged += t.damagedPcs ?? 0;
  }
  return {
    ordered: order.quantity,
    inMaking: Math.round(inMaking),
    inGodown: Math.round(inGodown),
    readyDispatch: Math.round(readyDispatch),
    inRefinish: Math.round(inRefinish),
    damaged: Math.round(damaged),
  };
}

/* ------------------------------------------------------------------ */
/* item keys                                                            */
/* ------------------------------------------------------------------ */

export const NO_DESIGN_KEY = 'none';

/** `d-<designId>` | `none` (Sprint 18: designs only — variations became designs). */
export function inventoryKey(o: { designId: number | null }): string {
  return o.designId != null ? `d-${o.designId}` : NO_DESIGN_KEY;
}

/**
 * `legacy_variation` = an old `v-<variationId>` link (bookmarks from before Sprint 18): the server maps it to the design
 * the variation became (`design_variation_map`) and the screen redirects there.
 */
export type InventoryKeyParts = { kind: 'design' | 'legacy_variation'; id: number } | { kind: 'none' };

export function parseInventoryKey(key: string): InventoryKeyParts | null {
  if (key === NO_DESIGN_KEY) return { kind: 'none' };
  const m = /^([dv])-(\d{1,9})$/.exec(key);
  if (!m) return null;
  return { kind: m[1] === 'v' ? 'legacy_variation' : 'design', id: Number(m[2]) };
}

/** Cards: the items with the most In making + Ready first, then by code; "Without design" always last. */
export function compareInventoryItems(
  a: { key: string; code: string | null; inMaking: number; ready: number },
  b: { key: string; code: string | null; inMaking: number; ready: number },
): number {
  if ((a.key === NO_DESIGN_KEY) !== (b.key === NO_DESIGN_KEY)) return a.key === NO_DESIGN_KEY ? 1 : -1;
  return b.inMaking + b.ready - (a.inMaking + a.ready) || (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true });
}

/** Ready (green) and In making (soft blue) as 0–100 shares of Ordered; together never above 100. */
export function inventoryBarShares(p: Pick<InventoryPcs, 'ordered' | 'inMaking' | 'readyDispatch'>): { ready: number; making: number } {
  if (p.ordered <= 0) return { ready: 0, making: 0 };
  const ready = Math.min(100, (p.readyDispatch / p.ordered) * 100);
  const making = Math.min(100 - ready, (p.inMaking / p.ordered) * 100);
  return { ready: Math.round(ready * 10) / 10, making: Math.round(making * 10) / 10 };
}

/* ------------------------------------------------------------------ */
/* Damaged stock                                                        */
/* ------------------------------------------------------------------ */

/**
 * The one demo "Last stock clearance" entry on the damaged item details. Becomes real data when the wipe-out flow is
 * built (a later sprint) — until then it is shown with a grey "Demo" tag.
 */
export const DEMO_STOCK_CLEARANCE = {
  date: '2026-09-12',
  pcs: 120,
  party: 'Shree Textiles',
  ratePerPcs: 180,
} as const;
