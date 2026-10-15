/**
 * Dispatch (Sprint 12): dispatch challans (DC-n, with revisions DC-n R1…), goods return (GR) maths, moving fresh
 * stock to another order. Pure — server, client and tests share it.
 */
import type { OrderType } from './orderTypes';
import { takaActualPcs } from './takas';

export const DISPATCH_PREFIX = 'DC';
export const DISPATCH_COUNTER = 'dispatch_challan_no';

/** `DC-12`, or `DC-12 R1` for a revision (revision 0 = the original). */
export function dispatchChallanLabel(challanNo: number, revision = 0): string {
  return revision > 0 ? `${DISPATCH_PREFIX}-${challanNo} R${revision}` : `${DISPATCH_PREFIX}-${challanNo}`;
}

/** "12", "DC-12", "dc 12", "DC-12 R1" → { no: 12, revision: 1 | null } (else null). */
export function parseDispatchChallanNo(text: string): { no: number; revision: number | null } | null {
  const m = /^(?:DC[\s-]*)?(\d{1,9})(?:\s*R(\d{1,3}))?$/i.exec(text.trim());
  if (!m) return null;
  const no = Number(m[1]);
  return no > 0 ? { no, revision: m[2] ? Number(m[2]) : null } : null;
}

export type DispatchChallanState = 'active' | 'revised';

/* ------------------------------------------------------------------ */
/* Dispatch                                                             */
/* ------------------------------------------------------------------ */

export interface DispatchTakaLike {
  id: number;
  takaNo: string;
  meters: number | null;
  /** Pcs on the challan (actual pcs at dispatch). */
  pcs: number | null;
}

export function dispatchTotals(takas: readonly Pick<DispatchTakaLike, 'meters' | 'pcs'>[]): { takas: number; pcs: number; meters: number } {
  return {
    takas: takas.length,
    pcs: takas.reduce((n, t) => n + (t.pcs ?? 0), 0),
    meters: Math.round(takas.reduce((n, t) => n + (t.meters ?? 0), 0) * 100) / 100,
  };
}

/** Pcs a dispatch takes from a ready taka: its actual pcs. */
export const dispatchPcsOf = (t: { pcs: number | null; actualPcs: number | null }) => takaActualPcs(t) ?? 0;

/**
 * Pcs-to-pcs challans carry no taka numbers: one line per quality + design with the pcs added up.
 * Lines keep the order the groups first appear in.
 */
export interface DispatchLine {
  quality: string;
  design: string;
  pcs: number;
}
export function dispatchLines(rows: readonly { quality: string; design: string | null; pcs: number | null }[]): DispatchLine[] {
  const map = new Map<string, DispatchLine>();
  for (const r of rows) {
    const design = r.design ?? '';
    const key = `${r.quality}\u0000${design}`;
    const cur = map.get(key);
    if (cur) cur.pcs += r.pcs ?? 0;
    else map.set(key, { quality: r.quality, design, pcs: r.pcs ?? 0 });
  }
  return [...map.values()];
}

/* ------------------------------------------------------------------ */
/* Goods return (GR)                                                    */
/* ------------------------------------------------------------------ */

/** Lump order: the next revision holds everything except the returned takas. */
export function lumpRevisionTakas<T extends { id: number }>(challanTakas: readonly T[], returnedIds: readonly number[]): T[] {
  const gone = new Set(returnedIds);
  return challanTakas.filter((t) => !gone.has(t.id));
}

/** Pcs-to-pcs order: the next revision has the challan's pcs reduced by the returned pcs. */
export const pcsToPcsRemaining = (challanPcs: number, returnedPcs: number) => Math.max(0, challanPcs - returnedPcs);

export type GrError = 'nothing_returned' | 'returned_range' | 'damaged_range' | 'damage_pcs' | 'damage_missing';

/** Pcs-to-pcs GR: returned 1…challan pcs, damaged 0…returned (damage name needed when damaged > 0). */
export function validatePcsGr(input: { challanPcs: number; returnedPcs: number; damagedPcs: number; hasDamageName: boolean }): GrError | null {
  const { challanPcs, returnedPcs, damagedPcs } = input;
  if (!Number.isInteger(returnedPcs) || returnedPcs < 1 || returnedPcs > challanPcs) return 'returned_range';
  if (!Number.isInteger(damagedPcs) || damagedPcs < 0 || damagedPcs > returnedPcs) return 'damaged_range';
  if (damagedPcs > 0 && !input.hasDamageName) return 'damage_missing';
  return null;
}

export const GR_ERROR_TEXT: Record<GrError, string> = {
  nothing_returned: 'Tick at least one returned taka.',
  returned_range: 'Returned pcs must be between 1 and the pcs on the challan.',
  damaged_range: 'Damaged pcs can be 0 up to the returned pcs.',
  damage_pcs: 'A damage needs pcs (1 up to the taka pcs).',
  damage_missing: 'Pick the damage name for the damaged pcs.',
};

/** The "return lot" taka made for a pcs-to-pcs GR: pcs = returned pcs, meters empty, plus an optional damage. */
export function returnLot(returnedPcs: number, damagedPcs: number) {
  return { pcs: returnedPcs, meters: null as number | null, damagedPcs, freshPcs: returnedPcs - damagedPcs };
}

/** Lump GR: the damaged pcs of a returned taka can't exceed its pcs. */
export function lumpGrDamagePcsOk(takaPcs: number | null, damagePcs: number): boolean {
  return Number.isInteger(damagePcs) && damagePcs >= 1 && (takaPcs === null || damagePcs <= takaPcs);
}

export function orderTypeUsesTakaNumbers(orderType: OrderType): boolean {
  return orderType === 'lump';
}

/**
 * Pcs-to-pcs GR: the returned pcs are taken off the challan's rows from the LAST row backwards (a row emptied to 0 drops
 * off the revision). Returns the new pcs of every row, in the same order.
 */
export function reducePcsAcrossRows<T extends { id: number; pcs: number | null }>(rows: readonly T[], returnedPcs: number): { id: number; before: number; after: number }[] {
  let left = returnedPcs;
  const out = rows.map((r) => ({ id: r.id, before: r.pcs ?? 0, after: r.pcs ?? 0 }));
  for (let i = out.length - 1; i >= 0 && left > 0; i -= 1) {
    const take = Math.min(left, out[i].after);
    out[i].after -= take;
    left -= take;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Move to inventory / Add from free stock (totals for the confirm dialog) */
/* ------------------------------------------------------------------ */

/** Totals of the takas that move (count + pcs) — the confirm dialog. */
export function moveTotals(takas: readonly { pcs: number | null; actualPcs: number | null }[]): { takas: number; pcs: number } {
  return { takas: takas.length, pcs: takas.reduce((n, t) => n + (takaActualPcs(t) ?? 0), 0) };
}

/* ------------------------------------------------------------------ */
/* Mark as fresh                                                        */
/* ------------------------------------------------------------------ */

/** Mark as fresh resolves EVERY open damage in full: the open pcs of each damage drop to 0. */
export function markFreshResult(damages: readonly { pcs: number | null; resolvedPcs: number; status: string }[]): { resolved: number; openPcsBefore: number; openPcsAfter: number } {
  const open = damages.filter((d) => d.status === 'open');
  return {
    resolved: open.length,
    openPcsBefore: open.reduce((n, d) => n + Math.max((d.pcs ?? 0) - d.resolvedPcs, 0), 0),
    openPcsAfter: 0,
  };
}
