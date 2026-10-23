import type { OrderStatusKey } from './statuses';
import { ALL_STEPS, type OrderSteps } from './orderSteps';

/**
 * The main steps of an order, in order (Order details → History → Overview). ONE definition: the step list, which
 * order status marks each step in the detailed history, and the duration maths between consecutive steps.
 * Sprint 16: the steps follow the order's ticks (production / butta / mill steps only when ticked), plus the outside
 * steps (PO placed, Received from weaver) and Goods received for an FG purchase.
 */
export const MILESTONE_KEYS = [
  'created',
  'in_production',
  'po_placed',
  'received_weaver',
  'goods_received',
  'butta_sent',
  'butta_received',
  'mill_sent',
  'mill_received',
  'dispatched',
] as const;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];

export const MILESTONE_LABEL: Record<MilestoneKey, string> = {
  created: 'Order created',
  in_production: 'In production',
  po_placed: 'PO placed',
  received_weaver: 'Received from weaver',
  goods_received: 'Goods received',
  butta_sent: 'Sent to butta cutting',
  butta_received: 'Received from butta cutting',
  mill_sent: 'Sent to mill',
  mill_received: 'Received from mill',
  dispatched: 'Dispatched',
};

/** A step that happened in lots (challans): the first and the last time something happened in that lot. */
export interface MilestoneLot {
  first: string;
  last: string;
}

/** What GET /orders/:id/milestones returns: raw times, no maths (the maths is `orderMilestones`). */
export interface OrderMilestoneInput {
  createdAt: string;
  /** The first jobsheet started on a loom (null = not yet). */
  productionStartedAt: string | null;
  /** The order's design goes for butta cutting (a design without one skips both butta steps). */
  buttaApplies: boolean;
  /** One entry per active butta challan of the order. */
  buttaSent: MilestoneLot[];
  /** One entry per butta challan that had takas of this order received. */
  buttaReceived: MilestoneLot[];
  millSent: MilestoneLot[];
  millReceived: MilestoneLot[];
  /** One entry per original dispatch challan (revisions are not new lots). */
  dispatched: MilestoneLot[];
  /** Sprint 16: the order's steps (missing = all ticked). */
  steps?: OrderSteps;
  /** Sprint 16: one entry per outside PO (not cancelled) — when it was placed. */
  poPlaced?: MilestoneLot[];
  /** Sprint 16: one entry per receipt against an outside PO. */
  receivedOutside?: MilestoneLot[];
  /** Sprint 16: one entry per FG purchase receipt. */
  goodsReceived?: MilestoneLot[];
}

export type MilestoneState = 'done' | 'pending' | 'skipped';

export interface Milestone {
  key: MilestoneKey;
  label: string;
  state: MilestoneState;
  /** When the step first happened. */
  at: string | null;
  /** In how many lots it happened (0 when not reached). */
  lots: number;
  /** When it last happened (differs from `at` only for several lots). */
  lastAt: string | null;
  /** Time since the previous reached step, e.g. "Butta cutting took 4 days 6 h" / "2 d 3 h". */
  sincePrevious: { ms: number; text: string } | null;
}

/** "4 days 6 h" (`long`) / "4 d 6 h" · "5 h 20 min" · "45 min" · "under a minute". */
export function formatSpan(ms: number, long = false): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) {
    const unit = long ? (d === 1 ? ' day' : ' days') : ' d';
    return h > 0 ? `${d}${unit} ${h} h` : `${d}${unit}`;
  }
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return mins < 1 ? 'under a minute' : `${m} min`;
}

const time = (iso: string) => new Date(iso).getTime();

/** Sent / received steps whose duration reads as "<Place> took …" (measured from the matching "sent" step). */
const TOOK: Partial<Record<MilestoneKey, { from: MilestoneKey; place: string }>> = {
  butta_received: { from: 'butta_sent', place: 'Butta cutting' },
  mill_received: { from: 'mill_sent', place: 'Mill' },
  received_weaver: { from: 'po_placed', place: 'The weaver' },
};

/**
 * Sprint 16: the steps that apply to an order. Production / butta / mill steps only when ticked (or when something did
 * happen there — rework), the outside steps when the order has no Production or has POs, Goods received for an FG
 * purchase.
 */
function appliesTo(key: MilestoneKey, input: OrderMilestoneInput, happened: boolean): boolean {
  const steps = input.steps ?? ALL_STEPS;
  const fg = !steps.hasProduction && !steps.hasButta && !steps.hasMill;
  switch (key) {
    case 'created':
    case 'dispatched':
      return true;
    case 'in_production':
      return steps.hasProduction;
    case 'po_placed':
    case 'received_weaver':
      return (!steps.hasProduction && !fg) || (input.poPlaced?.length ?? 0) > 0;
    case 'goods_received':
      return fg || happened;
    case 'butta_sent':
    case 'butta_received':
      return steps.hasButta || happened;
    case 'mill_sent':
    case 'mill_received':
      return steps.hasMill || happened;
  }
}

/**
 * The seven main steps with their date, lots and the time taken since the previous reached step.
 * - not reached → `pending`; the butta steps of a design without butta cutting → `skipped` (unless something did happen).
 * - `sincePrevious` is measured from the last reached step before it (skipped / pending steps in between are ignored)
 *   and left out when it would be negative.
 */
export function orderMilestones(input: OrderMilestoneInput): Milestone[] {
  const lotsOf: Record<MilestoneKey, MilestoneLot[]> = {
    created: [{ first: input.createdAt, last: input.createdAt }],
    in_production: input.productionStartedAt ? [{ first: input.productionStartedAt, last: input.productionStartedAt }] : [],
    po_placed: input.poPlaced ?? [],
    received_weaver: input.receivedOutside ?? [],
    goods_received: input.goodsReceived ?? [],
    butta_sent: input.buttaSent,
    butta_received: input.buttaReceived,
    mill_sent: input.millSent,
    mill_received: input.millReceived,
    dispatched: input.dispatched,
  };
  const skippable = (key: MilestoneKey) => (key === 'butta_sent' || key === 'butta_received') && !input.buttaApplies;

  const out: Milestone[] = [];
  let prev: Milestone | null = null;
  for (const key of MILESTONE_KEYS) {
    const lots = lotsOf[key];
    // Sprint 16: steps the order does not have are left out (not "Skipped").
    if (!appliesTo(key, input, lots.length > 0)) continue;
    if (lots.length === 0) {
      out.push({ key, label: MILESTONE_LABEL[key], state: skippable(key) ? 'skipped' : 'pending', at: null, lots: 0, lastAt: null, sincePrevious: null });
      continue;
    }
    const at = lots.reduce((m, l) => (time(l.first) < time(m) ? l.first : m), lots[0].first);
    const lastAt = lots.reduce((m, l) => (time(l.last) > time(m) ? l.last : m), lots[0].last);
    let sincePrevious: Milestone['sincePrevious'] = null;
    if (prev?.at) {
      const ms = time(at) - time(prev.at);
      if (ms >= 0) {
        const took = TOOK[key];
        sincePrevious = took && prev.key === took.from ? { ms, text: `${took.place} took ${formatSpan(ms, true)}` } : { ms, text: formatSpan(ms) };
      }
    }
    const step: Milestone = { key, label: MILESTONE_LABEL[key], state: 'done', at, lots: lots.length, lastAt, sincePrevious };
    out.push(step);
    prev = step;
  }
  return out;
}

/** The order status whose FIRST occurrence in the status history marks each main step (detailed view). */
const STEP_OF_STATUS: Partial<Record<OrderStatusKey, MilestoneKey>> = {
  pending_production: 'created',
  in_production: 'in_production',
  outside_production: 'po_placed',
  in_butta_cutting: 'butta_sent',
  ready_for_mill: 'butta_received',
  in_mill: 'mill_sent',
  received_from_mill: 'mill_received',
  partly_dispatched: 'dispatched',
  dispatched: 'dispatched',
};

/**
 * Which status-history entries are main steps: the first entry per step, oldest first. `history` in any order;
 * returns entry id → step key.
 */
export function mainStepsOfHistory(history: readonly { id: number; toStatus: OrderStatusKey; changedAt: string }[]): Map<number, MilestoneKey> {
  const seen = new Set<MilestoneKey>();
  const out = new Map<number, MilestoneKey>();
  for (const h of [...history].sort((a, b) => time(a.changedAt) - time(b.changedAt) || a.id - b.id)) {
    const step = STEP_OF_STATUS[h.toStatus];
    if (!step || seen.has(step)) continue;
    seen.add(step);
    out.set(h.id, step);
  }
  return out;
}
