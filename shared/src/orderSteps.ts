/**
 * Sprint 16 — which of the three main steps (Production · Butta cutting · Mill) happen in OUR system for an order.
 * The order's ticks decide everything; the design's "Goes for butta cutting" only pre-fills the Butta tick.
 * After the last ticked step every order ends with Dhruvil's part (final takas → ready → dispatch).
 */

export interface OrderSteps {
  hasProduction: boolean;
  hasButta: boolean;
  hasMill: boolean;
}

export const ALL_STEPS: OrderSteps = { hasProduction: true, hasButta: true, hasMill: true };

export const ORDER_KINDS = ['in_house', 'outside_production', 'fg_purchase'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export const ORDER_KIND_LABEL: Record<OrderKind, string> = {
  in_house: 'In-house',
  outside_production: 'Outside production',
  fg_purchase: 'FG purchase',
};

export function isOrderKind(value: unknown): value is OrderKind {
  return typeof value === 'string' && (ORDER_KINDS as readonly string[]).includes(value);
}

/** in_house = Production ticked · outside_production = Butta and/or Mill without Production · fg_purchase = nothing ticked. */
export function orderKind(order: OrderSteps): OrderKind {
  if (order.hasProduction) return 'in_house';
  if (order.hasButta || order.hasMill) return 'outside_production';
  return 'fg_purchase';
}

export type StepKey = 'production' | 'butta' | 'mill';
export const STEP_KEYS: readonly StepKey[] = ['production', 'butta', 'mill'];
export const STEP_LABEL: Record<StepKey, string> = { production: 'Production', butta: 'Butta cutting', mill: 'Mill' };
/** One letter per step for the compact "P · B · M" tag. */
export const STEP_LETTER: Record<StepKey, string> = { production: 'P', butta: 'B', mill: 'M' };

export const stepOn = (s: OrderSteps, key: StepKey): boolean =>
  key === 'production' ? s.hasProduction : key === 'butta' ? s.hasButta : s.hasMill;

export const withStep = (s: OrderSteps, key: StepKey, on: boolean): OrderSteps =>
  key === 'production' ? { ...s, hasProduction: on } : key === 'butta' ? { ...s, hasButta: on } : { ...s, hasMill: on };

/** The helper line under the step pills on Add / Edit order. */
export function stepsHelperText(s: OrderSteps): string {
  const kind = orderKind(s);
  if (kind === 'fg_purchase') return 'Direct FG purchase: goods will be received ready, then dispatched';
  if (kind === 'outside_production') return "You'll create POs to outside weavers from the order";
  return ['Jobsheets', 'taka entry', s.hasButta ? 'Butta' : null, s.hasMill ? 'Mill' : null, 'Dispatch'].filter(Boolean).join(' → ');
}

/** "Steps changed: Butta removed" / "Steps changed: Mill added, Production removed" — the History entry. Null when equal. */
export function stepsChangeNote(before: OrderSteps, after: OrderSteps): string | null {
  const parts: string[] = [];
  for (const key of STEP_KEYS) {
    const a = stepOn(before, key);
    const b = stepOn(after, key);
    if (a !== b) parts.push(`${STEP_LABEL[key].replace(' cutting', '')} ${b ? 'added' : 'removed'}`);
  }
  return parts.length ? `Steps changed: ${parts.join(', ')}` : null;
}

export const sameSteps = (a: OrderSteps, b: OrderSteps) => a.hasProduction === b.hasProduction && a.hasButta === b.hasButta && a.hasMill === b.hasMill;

/** Why a step can't be unticked any more (null = it can). The server decides with the same facts. */
export interface StepLockFacts {
  /** Active (real) jobsheets of the order. */
  jobsheets: number;
  /** Takas of the order that have been to butta cutting (a butta challan row) or are there / in QC / sent back. */
  buttaTakas: number;
  /** Takas that have been to the mill (a mill challan row, at the mill, in Mill QC). */
  millTakas: number;
  /** Outside POs of the order that are not cancelled. */
  outsidePos: number;
}

export type StepLocks = Record<StepKey, string | null>;

export function stepUntickLocks(f: StepLockFacts): StepLocks {
  return {
    production: f.jobsheets > 0 ? `This order already has ${f.jobsheets} jobsheet${f.jobsheets === 1 ? '' : 's'}` : null,
    butta: f.buttaTakas > 0 ? `${f.buttaTakas} taka${f.buttaTakas === 1 ? ' has' : 's have'} already been to butta cutting` : null,
    mill: f.millTakas > 0 ? `${f.millTakas} taka${f.millTakas === 1 ? ' has' : 's have'} already been to the mill` : null,
  };
}

/**
 * Validates a change of steps: every newly UNticked step must be unlocked, and an order with outside POs can't become a
 * direct FG purchase (the POs need Butta or Mill — or Production for a partly-outside order). Returns the first problem.
 */
export function stepsChangeError(before: OrderSteps, after: OrderSteps, f: StepLockFacts): { step: StepKey | null; message: string } | null {
  const locks = stepUntickLocks(f);
  for (const key of STEP_KEYS) {
    if (stepOn(before, key) && !stepOn(after, key) && locks[key]) return { step: key, message: `${STEP_LABEL[key]} can't be removed: ${locks[key]}.` };
  }
  if (orderKind(after) === 'fg_purchase' && f.outsidePos > 0) {
    return { step: null, message: 'This order has outside POs, so at least one step must stay ticked. Cancel or close the POs first.' };
  }
  return null;
}
