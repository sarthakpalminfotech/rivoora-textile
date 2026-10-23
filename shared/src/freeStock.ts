/**
 * Sprint 13 — free stock, blouse option, damage type + where it was recorded. Pure rules shared by server and client.
 *
 * FREE STOCK = takas that belong to no order. `takas.order_id` stays the ORIGIN order; `is_free_stock` takes the taka
 * out of every order-level figure, and `allocated_order_id` puts it into another order again.
 */
import type { TakaStage } from './pipeline';
import { compareTakaNo, MAX_SPLIT_PARTS, splitMeters, takaActualPcs } from './takas';

/* ------------------------------------------------------------------ */
/* Blouse option                                                        */
/* ------------------------------------------------------------------ */

export const BLOUSE_OPTIONS = ['with_blouse', 'without_blouse'] as const;
export type BlouseOption = (typeof BLOUSE_OPTIONS)[number];

export const BLOUSE_LABEL: Record<BlouseOption, string> = {
  with_blouse: 'With blouse',
  without_blouse: 'Without blouse',
};
/** Hindi labels for the bilingual screens (Taka entry, QC). */
export const BLOUSE_LABEL_HI: Record<BlouseOption, string> = {
  with_blouse: 'ब्लाउज़ के साथ',
  without_blouse: 'बिना ब्लाउज़',
};
/** Upper case line printed on the jobsheet. */
export const BLOUSE_PRINT_LABEL: Record<BlouseOption, string> = {
  with_blouse: 'WITH BLOUSE',
  without_blouse: 'WITHOUT BLOUSE',
};

export function isBlouseOption(value: unknown): value is BlouseOption {
  return typeof value === 'string' && (BLOUSE_OPTIONS as readonly string[]).includes(value);
}

/** Inventory blouse filter: everything, one of the options, or orders with no blouse option set. */
export const BLOUSE_FILTERS = ['all', 'with_blouse', 'without_blouse', 'not_set'] as const;
export type BlouseFilter = (typeof BLOUSE_FILTERS)[number];
export const BLOUSE_FILTER_LABEL: Record<BlouseFilter, string> = {
  all: 'All',
  with_blouse: 'With blouse',
  without_blouse: 'Without blouse',
  not_set: 'Not set',
};

export function isBlouseFilter(value: unknown): value is BlouseFilter {
  return typeof value === 'string' && (BLOUSE_FILTERS as readonly string[]).includes(value);
}

/** Does a row with this blouse option pass the filter? */
export function matchesBlouse(filter: BlouseFilter | null | undefined, option: BlouseOption | null | undefined): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'not_set') return !option;
  return option === filter;
}

/** The bucket a blouse option falls in (for the per-option pcs counts). */
export const blouseBucket = (option: BlouseOption | null | undefined): Exclude<BlouseFilter, 'all'> => option ?? 'not_set';

/** pcs per bucket → the options worth showing in the toggle: "All" always, the others only when they have pcs. */
export function blouseFilterOptions(counts: Partial<Record<Exclude<BlouseFilter, 'all'>, number>>): { key: BlouseFilter; label: string; pcs: number }[] {
  const total = Object.values(counts).reduce<number>((s, n) => s + (n ?? 0), 0);
  const out: { key: BlouseFilter; label: string; pcs: number }[] = [{ key: 'all', label: BLOUSE_FILTER_LABEL.all, pcs: total }];
  for (const key of ['with_blouse', 'without_blouse', 'not_set'] as const) {
    const pcs = counts[key] ?? 0;
    if (pcs > 0) out.push({ key, label: BLOUSE_FILTER_LABEL[key], pcs });
  }
  return out;
}

/** "With blouse 120 · Without 80 · Not set 40" (zero buckets left out). */
export function blouseBreakdownText(counts: Partial<Record<Exclude<BlouseFilter, 'all'>, number>>): string {
  const parts: string[] = [];
  if (counts.with_blouse) parts.push(`With blouse ${counts.with_blouse}`);
  if (counts.without_blouse) parts.push(`Without ${counts.without_blouse}`);
  if (counts.not_set) parts.push(`Not set ${counts.not_set}`);
  return parts.join(' · ');
}

/** The small amber note on a free taka whose blouse option differs from the order's ("Without blouse"), else null. */
export function blouseMismatchNote(takaOption: BlouseOption | null | undefined, orderOption: BlouseOption | null | undefined): string | null {
  if (!takaOption || !orderOption || takaOption === orderOption) return null;
  return BLOUSE_LABEL[takaOption];
}

/* ------------------------------------------------------------------ */
/* Free stock                                                           */
/* ------------------------------------------------------------------ */

// Sprint 16: `order_closed` = the order was closed and the taka was with us (or came back after the close).
export const FREE_STOCK_REASONS = ['moved', 'goods_return', 'order_closed'] as const;
export type FreeStockReason = (typeof FREE_STOCK_REASONS)[number];
export const FREE_STOCK_REASON_LABEL: Record<FreeStockReason, string> = { moved: 'Moved', goods_return: 'Returned', order_closed: 'Order closed' };

/** The columns of a taka that decide which order it counts for. */
export interface TakaOwnership {
  /** The ORIGIN order (`takas.order_id`). */
  orderId: number;
  isFreeStock: boolean;
  allocatedOrderId: number | null;
}

/**
 * The ONE rule: the order a taka counts for — null while it is free stock, else the order it was allocated to, else
 * its origin order. Exactly one order, or free stock. (The SQL twin is `takaInOrderSql` in the server's free-stock.ts.)
 */
export function effectiveOrderId(t: TakaOwnership): number | null {
  if (t.isFreeStock) return null;
  return t.allocatedOrderId ?? t.orderId;
}

export const takaCountsForOrder = (t: TakaOwnership, orderId: number) => effectiveOrderId(t) === orderId;

/** Stages whose takas can go to inventory: everything that is physically with us. */
export const MOVE_TO_INVENTORY_STAGES: readonly TakaStage[] = [
  'entered',
  'rework_butta',
  'waiting_mill',
  'butta_qc',
  'mill_qc',
  'refinish',
  'final',
  'ready_dispatch',
];

export interface MoveToInventorySelectable {
  selectable: boolean;
  /** Why it is greyed out. */
  reason: string | null;
}

export function moveToInventorySelectable(stage: string, isFreeStock = false): MoveToInventorySelectable {
  if (isFreeStock) return { selectable: false, reason: 'Already free stock.' };
  if ((MOVE_TO_INVENTORY_STAGES as readonly string[]).includes(stage)) return { selectable: true, reason: null };
  if (stage === 'at_butta') return { selectable: false, reason: 'At butta cutting right now — receive it first.' };
  if (stage === 'at_mill') return { selectable: false, reason: 'At the mill right now — receive it first.' };
  if (stage === 'dispatched') return { selectable: false, reason: 'Dispatched — it can come back only through GR (goods return).' };
  return { selectable: false, reason: 'Not available.' };
}

/** An order can receive free stock unless it is not in production yet, fully dispatched / returned, or closed. */
export const canReceiveFreeStock = (orderStatus: string) => !['pending_production', 'dispatched', 'returned', 'closed'].includes(orderStatus);

/** The stage a taka has once it is free stock: a ticked `ready_dispatch` taka goes back to `final`, the rest keep theirs. */
export const freeStockStage = (stage: string): string => (stage === 'ready_dispatch' ? 'final' : stage);

/** Free stock in the godown (usable now) — `final`; every other stage is "in making". */
export const isFreeReady = (stage: string) => stage === 'final';

/** A taka offered to the pcs-to-pcs move: its stage and actual pcs. */
export interface PcsMoveCandidate {
  id: number;
  takaNo: string;
  stage: string;
  pcs: number | null;
  actualPcs: number | null;
}

export interface PcsMovePlan {
  /** Takas moved whole. */
  whole: number[];
  /** The one taka needed only partly: `movePcs` leave, `keepPcs` stay. */
  partial: { id: number; keepPcs: number; movePcs: number } | null;
  /** Pcs that will leave the order (equals the request when it fits). */
  movedPcs: number;
  /** Pcs that were asked for but are not available. */
  shortBy: number;
}

/** `final` first, then `ready_dispatch`; larger takas first; the taka number breaks ties. */
export function pcsMoveOrder(a: PcsMoveCandidate, b: PcsMoveCandidate): number {
  const rank = (s: string) => (s === 'final' ? 0 : 1);
  return (
    rank(a.stage) - rank(b.stage) ||
    (takaActualPcs(b) ?? 0) - (takaActualPcs(a) ?? 0) ||
    compareTakaNo(a.takaNo, b.takaNo)
  );
}

/** Pcs available for a pcs-to-pcs move: the order's `final` + `ready_dispatch` takas. */
export function pcsMoveAvailable(candidates: readonly PcsMoveCandidate[]): number {
  return candidates
    .filter((c) => c.stage === 'final' || c.stage === 'ready_dispatch')
    .reduce((s, c) => s + (takaActualPcs(c) ?? 0), 0);
}

/**
 * Picks the takas for "move N pcs to inventory": whole takas while they fit (final first, then ready_dispatch, largest
 * first); a taka needed only partly is split — its kept part stays on the order, the moved part becomes free stock.
 * Takas without pcs are never picked.
 */
export function planPcsMove(candidates: readonly PcsMoveCandidate[], pcs: number): PcsMovePlan {
  const pool = candidates
    .filter((c) => (c.stage === 'final' || c.stage === 'ready_dispatch') && (takaActualPcs(c) ?? 0) > 0)
    .sort(pcsMoveOrder);
  const whole: number[] = [];
  let partial: PcsMovePlan['partial'] = null;
  let left = Math.max(0, Math.floor(pcs));
  for (const c of pool) {
    if (left <= 0) break;
    const have = takaActualPcs(c) ?? 0;
    if (have <= left) {
      whole.push(c.id);
      left -= have;
    } else {
      // Needed only partly: split it.
      partial = { id: c.id, keepPcs: have - left, movePcs: left };
      left = 0;
    }
  }
  const movedPcs = Math.max(0, Math.floor(pcs)) - left;
  return { whole, partial, movedPcs, shortBy: left };
}

/** Meters of the moved part and the kept part of a partial move (same maths as a godown split). */
export function partialMoveMeters(meters: number | null, keepPcs: number, movePcs: number): { keep: number | null; move: number | null } {
  const [keep, move] = splitMeters(meters, [keepPcs, movePcs]);
  return { keep: keep ?? null, move: move ?? null };
}

export { MAX_SPLIT_PARTS };

/** "40 pcs will leave Order #31 and become free stock". */
export function movePcsConfirmText(pcs: number, orderNo: number): string {
  return `${pcs} pcs will leave Order #${orderNo} and become free stock`;
}

/* ------------------------------------------------------------------ */
/* Has been to the mill (re-butta fix)                                  */
/* ------------------------------------------------------------------ */

/** True if the taka or any ancestor (walking `parentOf`) has been to the mill. */
export function hasBeenToMillThroughAncestors(
  id: number,
  byId: ReadonlyMap<number, { hasBeenToMill: boolean; parentTakaId: number | null }>,
): boolean {
  const seen = new Set<number>();
  let cur: number | null = id;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const t = byId.get(cur);
    if (!t) return false;
    if (t.hasBeenToMill) return true;
    cur = t.parentTakaId;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Damage: type chosen with a radio + where it was recorded             */
/* ------------------------------------------------------------------ */

/** The types the person marking a damage can choose (Sprint 16: + Weaver damage for takas bought / made outside). */
export const CHOOSABLE_DAMAGE_TYPES = ['machine', 'butta', 'mill', 'weaver'] as const;
export type ChoosableDamageType = (typeof CHOOSABLE_DAMAGE_TYPES)[number];

/** Stored in `taka_damages.found_at` when nothing was chosen (goods return only). Shown as "Damage type not marked". */
export const DAMAGE_NOT_MARKED = 'unmarked';

export const CHOOSABLE_DAMAGE_LABEL: Record<ChoosableDamageType, { en: string; hi: string }> = {
  machine: { en: 'Machine damage', hi: 'मशीन खराबी' },
  butta: { en: 'Butta cutting damage', hi: 'बुट्टा खराबी' },
  mill: { en: 'Mill damage', hi: 'मिल खराबी' },
  weaver: { en: 'Weaver damage', hi: 'बुनकर खराबी' },
};

export function isChoosableDamageType(value: unknown): value is ChoosableDamageType {
  return typeof value === 'string' && (CHOOSABLE_DAMAGE_TYPES as readonly string[]).includes(value);
}

/** Where a taka came from (`takas.source`). */
export const TAKA_SOURCES = ['production', 'outside_po', 'fg_purchase'] as const;
export type TakaSource = (typeof TAKA_SOURCES)[number];

/** What `damageTypeOptions` needs to know about a taka and its order. */
export interface DamageTypeFacts {
  /** `takas.source` (null / missing = our production). */
  source?: TakaSource | null;
  /** The order's steps (missing = all ticked, the old behaviour). */
  hasButta?: boolean;
  hasMill?: boolean;
  /** The taka has been to butta cutting (rework) / to the mill (rework, refinish). */
  beenToButta?: boolean;
  beenToMill?: boolean;
}

/**
 * Sprint 16: the damage types that apply to a taka — Machine for our production, Weaver for outside / FG takas, Butta
 * cutting when the order has Butta ticked or the taka has been there, Mill likewise. Always at least one type.
 * The radio pre-selects it when only one applies.
 */
export function damageTypeOptions(f: DamageTypeFacts = {}): ChoosableDamageType[] {
  const outside = f.source === 'outside_po' || f.source === 'fg_purchase';
  const out: ChoosableDamageType[] = [outside ? 'weaver' : 'machine'];
  if ((f.hasButta ?? true) || f.beenToButta) out.push('butta');
  if ((f.hasMill ?? true) || f.beenToMill) out.push('mill');
  return out;
}

/** "Weaver damage" reads "Weaver / supplier damage" for an FG purchase. */
export function damageTypeLabelFor(type: ChoosableDamageType, source?: TakaSource | null): { en: string; hi: string } {
  if (type === 'weaver' && source === 'fg_purchase') return { en: 'Weaver / supplier damage', hi: 'बुनकर / सप्लायर खराबी' };
  return CHOOSABLE_DAMAGE_LABEL[type];
}

export const DAMAGE_RECORDED_AT = ['taka_entry', 'edit_takas', 'butta_qc', 'mill_qc', 'godown', 'goods_return', 'split', 'inventory', 'outside_receipt', 'fg_receipt'] as const;
export type DamageRecordedAt = (typeof DAMAGE_RECORDED_AT)[number];

export const DAMAGE_RECORDED_AT_LABEL: Record<DamageRecordedAt, string> = {
  taka_entry: 'Taka entry',
  edit_takas: 'Edit takas',
  butta_qc: 'Butta QC',
  mill_qc: 'Mill QC',
  godown: 'Godown',
  goods_return: 'Goods return',
  split: 'Split',
  inventory: 'Inventory',
  outside_receipt: 'Receipt from weaver',
  fg_receipt: 'FG receipt',
};

export function isDamageRecordedAt(value: unknown): value is DamageRecordedAt {
  return typeof value === 'string' && (DAMAGE_RECORDED_AT as readonly string[]).includes(value);
}

/**
 * Validates the type of a damage write. A type is REQUIRED everywhere except goods return (`allowUnmarked`), where
 * nothing chosen = `unmarked`. Returns the value to store, or null when it is missing and not allowed.
 */
export function resolveDamageType(type: string | null | undefined, allowUnmarked: boolean): ChoosableDamageType | typeof DAMAGE_NOT_MARKED | null {
  if (isChoosableDamageType(type)) return type;
  return allowUnmarked ? DAMAGE_NOT_MARKED : null;
}

/** "Mill damage · Hole · 2 pcs" (parts that are missing are left out). */
export function damageTypeLine(typeLabel: string, name: string | null | undefined, pcs: number | null | undefined): string {
  return [typeLabel, name || null, pcs ? `${pcs} pcs` : null].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------------ */
/* Goods return → Returned status                                       */
/* ------------------------------------------------------------------ */

/** "Dispatched · 3 takas / 120 pcs returned to stock" (lump) or "Dispatched · 40 pcs returned to stock". */
export function returnedSummary(takaCount: number, pcs: number): string {
  const bits = [takaCount > 0 ? `${takaCount} taka${takaCount === 1 ? '' : 's'}` : null, `${pcs} pcs`].filter(Boolean).join(' / ');
  return `Dispatched · ${bits} returned to stock`;
}
