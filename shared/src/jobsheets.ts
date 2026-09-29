/**
 * Jobsheet calculations — the single source of truth.
 * Used by the server (the real write) and by the client (live previews). Pure functions only.
 */
import { SECTIONS_PER_BEAM } from './production';

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
  frames: number;
}

export interface AdjustInput {
  /** All ACTIVE jobsheets of the order (any order). */
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
  /** New jobsheets to create (numbers come from the counter); they copy the last jobsheet's picks + machines. */
  created: { frames: number }[];
  /** Jobsheets to soft-delete. */
  removed: { id: number; jobsheetNo: number; frames: number }[];
  editedIsLast: boolean;
  /** Last active jobsheet before the edit. */
  last: AdjustJobsheet;
  totalFramesBefore: number;
  totalFramesAfter: number;
}

export function planFramesEdit({ jobsheets, editedId, newFrames, framesPerJobsheet }: AdjustInput): AdjustPlan {
  if (!isPositiveInt(newFrames)) throw new RangeError('Frames must be a whole number of at least 1');
  const sorted = [...jobsheets].sort((a, b) => a.jobsheetNo - b.jobsheetNo);
  const edited = sorted.find((j) => j.id === editedId);
  if (!edited) throw new RangeError('Jobsheet is not active');
  const last = sorted[sorted.length - 1];
  const totalFramesBefore = sorted.reduce((s, j) => s + j.frames, 0);
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
  /** `order.jobsheet_pieces` */
  jobsheetPieces: number;
  /** `order.target_frames` */
  targetFrames: number;
  /** Sum of the active jobsheets' frames. */
  totalFrames: number;
  jobsheetCount: number;
}

export type CoverageWarningKind = 'pieces_less' | 'pieces_more' | 'frames_short' | 'frames_over';

export interface CoverageWarning {
  kind: CoverageWarningKind;
  message: string;
}

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Amber, non-blocking warnings. Nothing to warn about while an order has no jobsheets. */
export function coverageWarnings(c: Coverage): CoverageWarning[] {
  if (c.jobsheetCount === 0) return [];
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
  } else if (c.totalFrames > c.targetFrames) {
    out.push({
      kind: 'frames_over',
      message: `Jobsheets cover ${fmt(c.totalFrames)} frames, which is ${fmt(c.totalFrames - c.targetFrames)} more than the ${fmt(c.targetFrames)} needed.`,
    });
  }
  return out;
}

/** Live warning in the create forms: what the jobsheet quantity becomes after adding `addPieces`. */
export function jobsheetQuantityWarning(orderedPieces: number, jobsheetPieces: number, addPieces: number): string | null {
  if (!isPositiveInt(addPieces)) return null;
  const after = jobsheetPieces + addPieces;
  if (after === orderedPieces) return null;
  const diff = Math.abs(after - orderedPieces);
  return `This makes the jobsheet quantity ${fmt(after)} pcs — ${fmt(diff)} ${after < orderedPieces ? 'less' : 'more'} than the order (${fmt(orderedPieces)} pcs).`;
}

/** Pieces to prefill on a new multi-jobsheet run: the order quantity first, then whatever is left (if any). */
export function remainingPieces(orderedPieces: number, jobsheetPieces: number): number | null {
  const left = Math.floor(orderedPieces - jobsheetPieces);
  return left > 0 ? left : null;
}
