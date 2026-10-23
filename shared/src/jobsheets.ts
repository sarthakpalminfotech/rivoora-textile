/**
 * Jobsheet calculations — the single source of truth.
 * Used by the server (the real write) and by the client (live previews). Pure functions only.
 */
import { SECTIONS_PER_BEAM } from './production';
import { JOBSHEET_STATUS, type JobsheetStatusKey } from './statuses';

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;

/* ------------------------------------------------------------------ */
/* 7.1 Multi-jobsheet generation                                        */
/* ------------------------------------------------------------------ */

export interface JobsheetPlan {
  pieces: number;
  framesPerJobsheet: number;
  /** pieces ÷ sections, before rounding (e.g. 101.33). */
  exactFrames: number;
  /** Always rounded up. */
  totalFrames: number;
  jobsheetCount: number;
  /** Frames of each jobsheet, in order. Only the last one can be smaller. */
  frames: number[];
}

/** Frames needed for a number of pieces (always rounded up). */
export function framesForPieces(pieces: number): number {
  return Math.ceil(pieces / SECTIONS_PER_BEAM);
}

/** Default pieces for a number of frames (one piece per beam section). */
export function piecesForFrames(frames: number): number {
  return frames * SECTIONS_PER_BEAM;
}

/** Splits a total number of frames into jobsheets of `framesPerJobsheet`; the last one gets the remainder. */
export function splitFrames(totalFrames: number, framesPerJobsheet: number): number[] {
  if (totalFrames <= 0) return [];
  const count = Math.ceil(totalFrames / framesPerJobsheet);
  const frames = Array.from({ length: count }, () => framesPerJobsheet);
  frames[count - 1] = totalFrames - framesPerJobsheet * (count - 1);
  return frames;
}

/** Plans a multi-jobsheet run. Returns null when the inputs aren't positive integers. */
export function planJobsheets(pieces: number, framesPerJobsheet: number): JobsheetPlan | null {
  if (!isPositiveInt(pieces) || !isPositiveInt(framesPerJobsheet)) return null;
  const totalFrames = framesForPieces(pieces);
  const frames = splitFrames(totalFrames, framesPerJobsheet);
  return {
    pieces,
    framesPerJobsheet,
    exactFrames: pieces / SECTIONS_PER_BEAM,
    totalFrames,
    jobsheetCount: frames.length,
    frames,
  };
}

/** Consecutive equal values grouped: [10,10,2] → [{count:2,frames:10},{count:1,frames:2}]. */
export function groupFrames(frames: number[]): { count: number; frames: number }[] {
  const groups: { count: number; frames: number }[] = [];
  for (const f of frames) {
    const last = groups[groups.length - 1];
    if (last && last.frames === f) last.count++;
    else groups.push({ count: 1, frames: f });
  }
  return groups;
}

/** "10 × 10 frames + 1 × 2 frames" */
export function describeFrameGroups(frames: number[]): string {
  return groupFrames(frames)
    .map((g) => `${g.count} × ${g.frames} frame${g.frames === 1 ? '' : 's'}`)
    .join(' + ');
}

/** 101.333 → "101.33", 100 → "100" */
export function formatExactFrames(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/* ------------------------------------------------------------------ */
/* 7.4 Auto-adjust when a jobsheet's frames are edited                  */
/* ------------------------------------------------------------------ */

export interface AdjustJobsheet {
  id: number;
  jobsheetNo: number;
  /** Assigned frames. */
  frames: number;
  /** Defaults to Pending. Only Pending jobsheets are ever changed by the auto-adjust. */
  status?: JobsheetStatusKey;
  /** Actual frames made (Completed jobsheets only). */
  completedFrames?: number | null;
}

/** Frames a jobsheet counts for in the coverage: the actual frames once Completed, otherwise the assigned frames. */
export function effectiveFrames(j: Pick<AdjustJobsheet, 'frames' | 'status' | 'completedFrames'>): number {
  return j.status === JOBSHEET_STATUS.COMPLETED && j.completedFrames !== null && j.completedFrames !== undefined
    ? j.completedFrames
    : j.frames;
}

/** Sum of the effective frames. */
export function coverageFrames(list: Pick<AdjustJobsheet, 'frames' | 'status' | 'completedFrames'>[]): number {
  return list.reduce((s, j) => s + effectiveFrames(j), 0);
}

const isPendingSheet = (j: AdjustJobsheet) => (j.status ?? JOBSHEET_STATUS.PENDING) === JOBSHEET_STATUS.PENDING;

export interface AdjustInput {
  /** All ACTIVE jobsheets of the order (any order, any status). */
  jobsheets: AdjustJobsheet[];
  editedId: number;
  newFrames: number;
  /** `order.frames_per_jobsheet` — may be null. */
  framesPerJobsheet: number | null;
}

export interface AdjustChange {
  id: number;
  jobsheetNo: number;
  from: number;
  to: number;
  /** The jobsheet the user edited (otherwise it's the auto-adjusted last one). */
  edited: boolean;
}

export interface AdjustPlan {
  /** Frame changes to existing jobsheets (the edited one first). */
  updated: AdjustChange[];
  /** New jobsheets to create (numbers come from the counter); they copy the last jobsheet's machines. */
  created: { frames: number }[];
  /** Jobsheets to soft-delete. */
  removed: { id: number; jobsheetNo: number; frames: number }[];
  /** The edited jobsheet is the last (or only) Pending one — nothing else changes. */
  editedIsLast: boolean;
  /** Highest-numbered Pending jobsheet before the edit (the one that absorbs the change). */
  last: AdjustJobsheet;
  totalFramesBefore: number;
  totalFramesAfter: number;
}

export function planFramesEdit({ jobsheets, editedId, newFrames, framesPerJobsheet }: AdjustInput): AdjustPlan {
  if (!isPositiveInt(newFrames)) throw new RangeError('Frames must be a whole number of at least 1');
  const sorted = [...jobsheets].sort((a, b) => a.jobsheetNo - b.jobsheetNo);
  const edited = sorted.find((j) => j.id === editedId);
  if (!edited) throw new RangeError('Jobsheet is not active');
  if (!isPendingSheet(edited)) throw new RangeError('Only Pending jobsheets can be edited');
  // Sent / Ongoing / Completed jobsheets are never changed, split or removed.
  const pending = sorted.filter(isPendingSheet);
  const last = pending[pending.length - 1];
  const totalFramesBefore = coverageFrames(sorted);
  const delta = newFrames - edited.frames;
  const editedIsLast = edited.id === last.id;

  const plan: AdjustPlan = {
    updated: [],
    created: [],
    removed: [],
    editedIsLast,
    last,
    totalFramesBefore,
    totalFramesAfter: totalFramesBefore,
  };
  if (delta === 0) return plan;
  plan.updated.push({ id: edited.id, jobsheetNo: edited.jobsheetNo, from: edited.frames, to: newFrames, edited: true });

  if (editedIsLast) {
    // B. Editing the last jobsheet never changes any other jobsheet.
    plan.totalFramesAfter = totalFramesBefore + delta;
    return plan;
  }

  // A. The last jobsheet absorbs the opposite of the change.
  const lastNew = last.frames - delta;
  const F = framesPerJobsheet !== null && isPositiveInt(framesPerJobsheet) ? framesPerJobsheet : null;

  if (lastNew <= 0) {
    // Only the last one is removed; frames are never taken from other jobsheets.
    plan.removed.push({ id: last.id, jobsheetNo: last.jobsheetNo, frames: last.frames });
  } else if (F !== null && lastNew > F) {
    if (last.frames !== F) plan.updated.push({ id: last.id, jobsheetNo: last.jobsheetNo, from: last.frames, to: F, edited: false });
    plan.created = splitFrames(lastNew - F, F).map((frames) => ({ frames }));
  } else {
    plan.updated.push({ id: last.id, jobsheetNo: last.jobsheetNo, from: last.frames, to: lastNew, edited: false });
  }

  const removedFrames = plan.removed.reduce((s, r) => s + r.frames, 0);
  const createdFrames = plan.created.reduce((s, c) => s + c.frames, 0);
  const updatedDelta = plan.updated.reduce((s, u) => s + (u.to - u.from), 0);
  plan.totalFramesAfter = totalFramesBefore + updatedDelta + createdFrames - removedFrames;
  return plan;
}

/* ------------------------------------------------------------------ */
/* 7.5 Coverage summary and warnings                                   */
/* ------------------------------------------------------------------ */

export interface Coverage {
  orderedPieces: number;
  /** Live: frames in the active jobsheets × SECTIONS_PER_BEAM (see `orderJobsheetPlan`). */
  jobsheetPieces: number;
  /** Live: frames the order needs = ceil(ordered pieces ÷ SECTIONS_PER_BEAM). */
  targetFrames: number;
  /** Sum of the active jobsheets' frames (actual frames for Completed ones — see `coverageFrames`). */
  totalFrames: number;
  jobsheetCount: number;
}

/**
 * The order's jobsheet figures, computed LIVE from its active jobsheets (never from stored counters, which used to
 * go stale on delete / edit). Frames needed = ceil(pieces ÷ 3); frames in jobsheets = `coverageFrames`;
 * jobsheet quantity = frames in jobsheets × 3.
 */
export function orderJobsheetPlan(
  orderedPieces: number,
  list: Pick<AdjustJobsheet, 'frames' | 'status' | 'completedFrames'>[],
): Coverage {
  const totalFrames = coverageFrames(list);
  return {
    orderedPieces,
    jobsheetPieces: piecesForFrames(totalFrames),
    targetFrames: framesForPieces(orderedPieces),
    totalFrames,
    jobsheetCount: list.length,
  };
}

export type CoverageWarningKind = 'pieces_less' | 'pieces_more' | 'frames_short' | 'frames_over';

export interface CoverageWarning {
  kind: CoverageWarningKind;
  message: string;
}

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * Amber, non-blocking warnings. Nothing to warn about while an order has no jobsheets, and nothing when the frames
 * match the frames needed (the jobsheet quantity is frames × 3, so a 200 pcs order with 67 frames is on target).
 */
export function coverageWarnings(c: Coverage): CoverageWarning[] {
  if (c.jobsheetCount === 0 || c.totalFrames === c.targetFrames) return [];
  const out: CoverageWarning[] = [];
  if (c.jobsheetPieces < c.orderedPieces) {
    out.push({
      kind: 'pieces_less',
      message: `Jobsheet quantity (${fmt(c.jobsheetPieces)} pcs) is less than the order (${fmt(c.orderedPieces)} pcs).`,
    });
  } else if (c.jobsheetPieces > c.orderedPieces) {
    out.push({
      kind: 'pieces_more',
      message: `Jobsheet quantity (${fmt(c.jobsheetPieces)} pcs) is more than the order (${fmt(c.orderedPieces)} pcs).`,
    });
  }
  if (c.totalFrames < c.targetFrames) {
    out.push({
      kind: 'frames_short',
      message: `Jobsheets cover ${fmt(c.totalFrames)} frames, but ${fmt(c.targetFrames)} frames are needed (${fmt(c.targetFrames - c.totalFrames)} short).`,
    });
  } else {
    out.push({
      kind: 'frames_over',
      message: `Jobsheets cover ${fmt(c.totalFrames)} frames, which is ${fmt(c.totalFrames - c.targetFrames)} more than the ${fmt(c.targetFrames)} needed.`,
    });
  }
  return out;
}

/**
 * Live warning in the create forms: what the jobsheet quantity becomes after adding `addFrames` frames to the
 * `currentFrames` already in the active jobsheets. Null when the frames then match what the order needs.
 */
export function jobsheetQuantityWarning(orderedPieces: number, currentFrames: number, addFrames: number): string | null {
  if (!isPositiveInt(addFrames)) return null;
  const framesAfter = currentFrames + addFrames;
  if (framesAfter === framesForPieces(orderedPieces)) return null;
  const after = piecesForFrames(framesAfter);
  const diff = Math.abs(after - orderedPieces);
  if (diff === 0) return null;
  return `This makes the jobsheet quantity ${fmt(after)} pcs — ${fmt(diff)} ${after < orderedPieces ? 'less' : 'more'} than the order (${fmt(orderedPieces)} pcs).`;
}

/** Pieces to prefill on a new multi-jobsheet run: the order quantity first, then whatever is left (if any). */
export function remainingPieces(orderedPieces: number, jobsheetPieces: number): number | null {
  const left = Math.floor(orderedPieces - jobsheetPieces);
  return left > 0 ? left : null;
}

/* ------------------------------------------------------------------ */
/* Change machine (supervisor)                                          */
/* ------------------------------------------------------------------ */

/** Upper end of the "Frames to make next" dropdown (the assigned frames are used when larger). */
export const MAX_FRAMES_PICK = 100;

/** Options of the "Frames to make next" dropdown: 1 … max(MAX_FRAMES_PICK, assigned). */
export function nextFramesMax(assigned: number): number {
  return Math.max(MAX_FRAMES_PICK, assigned);
}

/** Frames left after `completed` of `assigned` — at least 1, because a new jobsheet needs a frame. */
export function remainingFrames(assigned: number, completed: number): number {
  return Math.max(1, assigned - completed);
}

/**
 * "Frames to make next" after "Frames completed" changes: follows the remaining frames until the user has
 * picked a value themselves (`touched`).
 */
export function nextFramesAfterCompletedChange(p: {
  assigned: number;
  completed: number;
  current: number;
  touched: boolean;
}): number {
  return p.touched ? p.current : remainingFrames(p.assigned, p.completed);
}

/** Live summary line of the Change machine dialog. */
export function changeMachineSummary(p: {
  orderNo: number;
  jobsheetNo: number;
  completed: number;
  next: number;
  newMachineNo: number | null;
}): string {
  const fr = (n: number) => `${n} frame${n === 1 ? '' : 's'}`;
  const target = p.newMachineNo !== null ? ` for Machine ${p.newMachineNo}` : '';
  return `${jobsheetRef(p.orderNo, p.jobsheetNo)} will be completed with ${fr(p.completed)}. A new jobsheet with ${fr(p.next)} will be created${target}.`;
}

/** "Assigned 10 — you're recording 8 (2 fewer)." or null when equal. */
export function completedFramesNote(assigned: number, completed: number): string | null {
  if (completed === assigned) return null;
  const diff = Math.abs(assigned - completed);
  return `Assigned ${assigned} — you're recording ${completed} (${diff} ${completed < assigned ? 'fewer' : 'more'}).`;
}

/* ------------------------------------------------------------------ */
/* Order-number-first references                                        */
/* ------------------------------------------------------------------ */

/*
 * The factory talks about orders, so the ORDER number is the main number wherever a jobsheet appears and the
 * jobsheet number follows in brackets. `jobsheet_no` itself is unchanged (global, never reused, used by the QR).
 */

/**
 * Sprint 16: the hidden EXTERNAL jobsheet of an order (outside / FG takas point to it) has a NEGATIVE number
 * (`-orders.id`): unique, never in the counter's range, never scannable, never shown — references to it read "Order #26".
 */
export const isExternalJobsheetNo = (jobsheetNo: number | null | undefined): boolean => typeof jobsheetNo === 'number' && jobsheetNo <= 0;
export const externalJobsheetNo = (orderId: number): number => -orderId;

/** "Order #26 (319)" ("Order #26" for the hidden external jobsheet). */
export function jobsheetRef(orderNo: number, jobsheetNo: number): string {
  return isExternalJobsheetNo(jobsheetNo) ? `Order #${orderNo}` : `Order #${orderNo} (${jobsheetNo})`;
}

/** "#26 (319)" — chips, tiles, toasts and other tight spots ("#26" for the external jobsheet). */
export function jobsheetRefShort(orderNo: number, jobsheetNo: number): string {
  return isExternalJobsheetNo(jobsheetNo) ? `#${orderNo}` : `#${orderNo} (${jobsheetNo})`;
}

/**
 * Sprint 16: pcs of an order given to outside weavers on pcs POs, which the jobsheets don't need to cover: an open /
 * received PO counts its quantity (or what came, if more), a closed one what was received, a cancelled one nothing.
 */
export function outsidePoCommittedPcs(pos: readonly { unit: string; quantity: number; receivedQty: number; status: string }[]): number {
  return Math.round(
    pos
      .filter((p) => p.unit === 'pcs' && p.status !== 'cancelled')
      .reduce((s, p) => s + (p.status === 'closed' ? p.receivedQty : Math.max(p.quantity, p.receivedQty)), 0),
  );
}
