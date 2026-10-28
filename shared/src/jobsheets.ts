/**
 * Jobsheet calculations — the single source of truth.
 * Used by the server (the real write) and by the client (live previews). Pure functions only.
 */
import { MAX_SECTIONS_PER_BEAM, METERS_ON_TARGET_SLACK, SECTIONS_PER_BEAM } from './production';
import { JOBSHEET_STATUS, type JobsheetStatusKey } from './statuses';
import { formatQty } from './orderUnit';

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;

/* ------------------------------------------------------------------ */
/* 7.1 Multi-jobsheet generation                                        */
/* ------------------------------------------------------------------ */

export interface JobsheetPlan {
  pieces: number;
  framesPerJobsheet: number;
  /** Sections per beam of the run (one frame = this many pcs). */
  sections: number;
  /** pieces ÷ sections, before rounding (e.g. 101.33). */
  exactFrames: number;
  /** Always rounded up. */
  totalFrames: number;
  jobsheetCount: number;
  /** Frames of each jobsheet, in order. Only the last one can be smaller. */
  frames: number[];
}

/** Sprint 18: a valid sections-per-beam value (whole number 1–12). */
export function isValidSections(n: unknown): n is number {
  return isPositiveInt(n) && n <= MAX_SECTIONS_PER_BEAM;
}

/** The sections of a jobsheet (older rows / inputs without one = the default 3). */
export function sectionsOf(j: { sections?: number | null }): number {
  return isValidSections(j.sections) ? j.sections : SECTIONS_PER_BEAM;
}

/** Frames needed for a number of pieces (always rounded up) at `sections` per beam. */
export function framesForPieces(pieces: number, sections: number = SECTIONS_PER_BEAM): number {
  return Math.ceil(pieces / sections);
}

/** Pieces of a number of frames (one piece per beam section). */
export function piecesForFrames(frames: number, sections: number = SECTIONS_PER_BEAM): number {
  return frames * sections;
}

/** Splits a total number of frames into jobsheets of `framesPerJobsheet`; the last one gets the remainder. */
export function splitFrames(totalFrames: number, framesPerJobsheet: number): number[] {
  if (totalFrames <= 0) return [];
  const count = Math.ceil(totalFrames / framesPerJobsheet);
  const frames = Array.from({ length: count }, () => framesPerJobsheet);
  frames[count - 1] = totalFrames - framesPerJobsheet * (count - 1);
  return frames;
}

/** Plans a multi-jobsheet run. Returns null when the inputs aren't positive integers (sections: 1–12). */
export function planJobsheets(pieces: number, framesPerJobsheet: number, sections: number = SECTIONS_PER_BEAM): JobsheetPlan | null {
  if (!isPositiveInt(pieces) || !isPositiveInt(framesPerJobsheet) || !isValidSections(sections)) return null;
  const totalFrames = framesForPieces(pieces, sections);
  const frames = splitFrames(totalFrames, framesPerJobsheet);
  return {
    pieces,
    framesPerJobsheet,
    sections,
    exactFrames: pieces / sections,
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
  /** Sprint 18: sections per beam of this jobsheet (default 3). */
  sections?: number | null;
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

/** Sprint 18: pcs of one jobsheet = its effective frames × its own sections. */
export function jobsheetPcs(j: Pick<AdjustJobsheet, 'frames' | 'status' | 'completedFrames' | 'sections'>): number {
  return effectiveFrames(j) * sectionsOf(j);
}

/** Sprint 18: pcs of the jobsheets = Σ effective frames × each jobsheet's sections. */
export function coveragePieces(list: readonly Pick<AdjustJobsheet, 'frames' | 'status' | 'completedFrames' | 'sections'>[]): number {
  return list.reduce((s, j) => s + jobsheetPcs(j), 0);
}

/**
 * Sprint 18: the sections of the latest run — the highest-numbered jobsheet's (the last one in the list when there are
 * no numbers), or the default 3 when there are no jobsheets. "Frames needed" is counted with it.
 */
export function latestSections(list: readonly { sections?: number | null; jobsheetNo?: number }[]): number {
  if (list.length === 0) return SECTIONS_PER_BEAM;
  let latest = list[list.length - 1];
  for (const j of list) if ((j.jobsheetNo ?? -Infinity) > (latest.jobsheetNo ?? -Infinity)) latest = j;
  return sectionsOf(latest);
}

const isPendingSheet = (j: { status?: JobsheetStatusKey }) => (j.status ?? JOBSHEET_STATUS.PENDING) === JOBSHEET_STATUS.PENDING;

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
  /** Live: Σ frames in the active jobsheets × each jobsheet's sections (see `orderJobsheetPlan`). */
  jobsheetPieces: number;
  /** Live: frames the order needs = ceil(ordered pieces ÷ `sections`). */
  targetFrames: number;
  /** Sprint 18: the sections per beam "Frames needed" is counted with — the latest run's, or the default 3. */
  sections: number;
  /** Sum of the active jobsheets' frames (actual frames for Completed ones — see `coverageFrames`). */
  totalFrames: number;
  jobsheetCount: number;
}

/**
 * The order's jobsheet figures, computed LIVE from its active jobsheets (never from stored counters, which used to
 * go stale on delete / edit). Sprint 18: jobsheet quantity = Σ effective frames × each jobsheet's own sections; frames
 * needed = ceil(pieces ÷ the latest run's sections) (3 when there are no jobsheets); frames in jobsheets =
 * `coverageFrames`.
 */
export function orderJobsheetPlan(
  orderedPieces: number,
  list: readonly (Pick<AdjustJobsheet, 'frames' | 'status' | 'completedFrames' | 'sections'> & { jobsheetNo?: number })[],
): Coverage {
  const sections = latestSections(list);
  return {
    orderedPieces,
    jobsheetPieces: coveragePieces(list),
    targetFrames: framesForPieces(orderedPieces, sections),
    sections,
    totalFrames: coverageFrames([...list]),
    jobsheetCount: list.length,
  };
}

/**
 * Sprint 18: the jobsheets are "on target" when their pcs cover the order by less than one frame (of the latest run's
 * sections). With one sections value for every jobsheet this is exactly "frames = frames needed".
 */
function onTarget(c: Coverage): boolean {
  const s = sectionsOf(c);
  return c.jobsheetPieces >= c.orderedPieces && c.jobsheetPieces - c.orderedPieces < s;
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
  if (c.jobsheetCount === 0 || onTarget(c)) return [];
  const s = sectionsOf(c);
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
  // Frames short / over at the latest run's sections (with one sections value: frames in jobsheets vs frames needed).
  if (c.jobsheetPieces < c.orderedPieces) {
    const short = Math.ceil((c.orderedPieces - c.jobsheetPieces) / s);
    out.push({
      kind: 'frames_short',
      message: `Jobsheets cover ${fmt(c.totalFrames)} frames, but ${fmt(c.totalFrames + short)} frames are needed (${fmt(short)} short).`,
    });
  } else {
    const over = Math.floor((c.jobsheetPieces - c.orderedPieces) / s);
    out.push({
      kind: 'frames_over',
      message: `Jobsheets cover ${fmt(c.totalFrames)} frames, which is ${fmt(over)} more than the ${fmt(c.totalFrames - over)} needed.`,
    });
  }
  return out;
}

/**
 * Live warning in the create forms: what the jobsheet quantity becomes after adding `addFrames` frames at `sections`
 * per beam to the `currentPieces` already in the active jobsheets (Sprint 18: pcs, because jobsheets may differ in
 * sections). Null when the pcs then cover the order by less than one frame.
 */
export function jobsheetQuantityWarning(
  orderedPieces: number,
  currentPieces: number,
  addFrames: number,
  sections: number = SECTIONS_PER_BEAM,
): string | null {
  if (!isPositiveInt(addFrames) || !isValidSections(sections)) return null;
  const after = currentPieces + piecesForFrames(addFrames, sections);
  if (after >= orderedPieces && after - orderedPieces < sections) return null;
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

/**
 * Sprint 19: meters given outside on meter POs, which the loom doesn't need to cover (the meters twin of
 * `outsidePoCommittedPcs`, rounded to 2 decimals instead of a whole number).
 */
export function outsidePoCommittedMeters(pos: readonly { unit: string; quantity: number; receivedQty: number; status: string }[]): number {
  return (
    Math.round(
      pos
        .filter((p) => p.unit === 'meters' && p.status !== 'cancelled')
        .reduce((s, p) => s + (p.status === 'closed' ? p.receivedQty : Math.max(p.quantity, p.receivedQty)), 0) * 100,
    ) / 100
  );
}

/* ====================================================================== */
/* Sprint 19 — meter (all-over) orders: the same jobsheet maths generalised */
/* ====================================================================== */

export type JobsheetUnit = 'pcs' | 'meters';

const round = (n: number, unit: JobsheetUnit): number => (unit === 'meters' ? Math.round(n * 100) / 100 : Math.round(n));

/**
 * Units of loom work needed for `quantity` of output at `sections` per beam: pcs round UP to whole frames (a
 * frame can't be partly woven); meters round UP to 2 decimals (loom metres are continuous, no "whole frame").
 * `allocUnits(pieces, sections, 'pcs')` is exactly the old `framesForPieces`.
 */
export function allocUnits(quantity: number, sections: number = SECTIONS_PER_BEAM, unit: JobsheetUnit = 'pcs'): number {
  return unit === 'meters' ? Math.ceil((quantity / sections) * 100) / 100 : Math.ceil(quantity / sections);
}

/** Output of `units` of loom work (frames or loom metres) at `sections` per beam — `quantityForUnits(frames, sections, 'pcs')` is the old `piecesForFrames`. */
export function quantityForUnits(units: number, sections: number = SECTIONS_PER_BEAM, unit: JobsheetUnit = 'pcs'): number {
  return unit === 'meters' ? Math.round(units * sections * 100) / 100 : units * sections;
}

/** Splits `total` units into jobsheets of `perJobsheet`; the last one gets the remainder — the generic `splitFrames`. */
export function splitQuantity(total: number, perJobsheet: number, unit: JobsheetUnit = 'pcs'): number[] {
  if (total <= 0) return [];
  const count = Math.ceil(total / perJobsheet);
  const out = Array.from({ length: count }, () => perJobsheet);
  out[count - 1] = round(total - perJobsheet * (count - 1), unit);
  return out;
}

/* ---- meters plan (the sibling of 7.1 `planJobsheets`) ---- */

export interface JobsheetMetersPlan {
  meters: number;
  metersPerJobsheet: number;
  sections: number;
  /** meters ÷ sections, before rounding up. */
  exactLoomMeters: number;
  /** Always rounded UP to 2 decimals. */
  totalLoomMeters: number;
  jobsheetCount: number;
  /** Loom metres of each jobsheet, in order. Only the last one can be smaller. */
  loomMeters: number[];
}

/** Plans a multi-jobsheet meter run. Null when the inputs aren't positive (sections 1–12). */
export function planJobsheetsMeters(meters: number, metersPerJobsheet: number, sections: number = SECTIONS_PER_BEAM): JobsheetMetersPlan | null {
  if (!(meters > 0) || !(metersPerJobsheet > 0) || !isValidSections(sections)) return null;
  const totalLoomMeters = allocUnits(meters, sections, 'meters');
  const loomMeters = splitQuantity(totalLoomMeters, metersPerJobsheet, 'meters');
  return { meters, metersPerJobsheet, sections, exactLoomMeters: meters / sections, totalLoomMeters, jobsheetCount: loomMeters.length, loomMeters };
}

/* ---- effective / coverage meters (the sibling of effectiveFrames / coverageFrames / jobsheetPcs / coveragePieces) ---- */

export interface AdjustMetersJobsheet {
  id: number;
  jobsheetNo: number;
  /** Assigned loom metres (null only because the DB column is nullable for a pcs jobsheet — never null in practice here). */
  meters: number | null;
  status?: JobsheetStatusKey;
  /** Actual loom metres made (Completed jobsheets only). */
  completedMeters?: number | null;
  sections?: number | null;
}

/** Loom metres a jobsheet counts for: the actual metres once Completed, otherwise the assigned metres. */
export function effectiveMeters(j: Pick<AdjustMetersJobsheet, 'meters' | 'status' | 'completedMeters'>): number {
  return j.status === JOBSHEET_STATUS.COMPLETED && j.completedMeters !== null && j.completedMeters !== undefined ? j.completedMeters : (j.meters ?? 0);
}

/** Sum of the effective loom metres. */
export function coverageMeters(list: readonly Pick<AdjustMetersJobsheet, 'meters' | 'status' | 'completedMeters'>[]): number {
  return Math.round(list.reduce((s, j) => s + effectiveMeters(j), 0) * 100) / 100;
}

/** Cloth metres of one jobsheet = its effective loom metres × its own sections (the meters twin of `jobsheetPcs`). */
export function jobsheetMeters(j: Pick<AdjustMetersJobsheet, 'meters' | 'status' | 'completedMeters' | 'sections'>): number {
  return Math.round(effectiveMeters(j) * sectionsOf(j) * 100) / 100;
}

/** Cloth metres of the jobsheets = Σ effective loom metres × each jobsheet's own sections (the meters twin of `coveragePieces`). */
export function coverageClothMeters(list: readonly Pick<AdjustMetersJobsheet, 'meters' | 'status' | 'completedMeters' | 'sections'>[]): number {
  return Math.round(list.reduce((s, j) => s + jobsheetMeters(j), 0) * 100) / 100;
}

/* ---- auto-adjust in meters (the sibling of 7.4 `planFramesEdit`) ---- */

export interface AdjustMetersInput {
  /** All ACTIVE jobsheets of the order (any order, any status). */
  jobsheets: AdjustMetersJobsheet[];
  editedId: number;
  newMeters: number;
  /** `order.meters_per_jobsheet` — may be null. */
  metersPerJobsheet: number | null;
}

export interface AdjustMetersChange {
  id: number;
  jobsheetNo: number;
  from: number;
  to: number;
  edited: boolean;
}

export interface AdjustMetersPlan {
  updated: AdjustMetersChange[];
  created: { meters: number }[];
  removed: { id: number; jobsheetNo: number; meters: number }[];
  editedIsLast: boolean;
  last: AdjustMetersJobsheet;
  totalMetersBefore: number;
  totalMetersAfter: number;
}

export function planMetersEdit({ jobsheets, editedId, newMeters, metersPerJobsheet }: AdjustMetersInput): AdjustMetersPlan {
  if (!(newMeters > 0)) throw new RangeError('Meters must be more than 0');
  const sorted = [...jobsheets].sort((a, b) => a.jobsheetNo - b.jobsheetNo);
  const edited = sorted.find((j) => j.id === editedId);
  if (!edited) throw new RangeError('Jobsheet is not active');
  if (!isPendingSheet(edited)) throw new RangeError('Only Pending jobsheets can be edited');
  const pending = sorted.filter(isPendingSheet);
  const last = pending[pending.length - 1];
  const totalMetersBefore = coverageMeters(sorted);
  const editedMeters = edited.meters ?? 0;
  const lastMeters = last.meters ?? 0;
  const newMetersRounded = Math.round(newMeters * 100) / 100;
  const delta = Math.round((newMetersRounded - editedMeters) * 100) / 100;
  const editedIsLast = edited.id === last.id;

  const plan: AdjustMetersPlan = {
    updated: [],
    created: [],
    removed: [],
    editedIsLast,
    last,
    totalMetersBefore,
    totalMetersAfter: totalMetersBefore,
  };
  if (delta === 0) return plan;
  plan.updated.push({ id: edited.id, jobsheetNo: edited.jobsheetNo, from: editedMeters, to: newMetersRounded, edited: true });

  if (editedIsLast) {
    plan.totalMetersAfter = Math.round((totalMetersBefore + delta) * 100) / 100;
    return plan;
  }

  const lastNew = Math.round((lastMeters - delta) * 100) / 100;
  const F = metersPerJobsheet !== null && metersPerJobsheet > 0 ? Math.round(metersPerJobsheet * 100) / 100 : null;

  if (lastNew <= 0) {
    plan.removed.push({ id: last.id, jobsheetNo: last.jobsheetNo, meters: lastMeters });
  } else if (F !== null && lastNew > F) {
    if (lastMeters !== F) plan.updated.push({ id: last.id, jobsheetNo: last.jobsheetNo, from: lastMeters, to: F, edited: false });
    plan.created = splitQuantity(Math.round((lastNew - F) * 100) / 100, F, 'meters').map((meters) => ({ meters }));
  } else {
    plan.updated.push({ id: last.id, jobsheetNo: last.jobsheetNo, from: lastMeters, to: lastNew, edited: false });
  }

  const removedMeters = plan.removed.reduce((s, r) => s + r.meters, 0);
  const createdMeters = plan.created.reduce((s, c) => s + c.meters, 0);
  const updatedDelta = plan.updated.reduce((s, u) => s + (u.to - u.from), 0);
  plan.totalMetersAfter = Math.round((totalMetersBefore + updatedDelta + createdMeters - removedMeters) * 100) / 100;
  return plan;
}

/* ---- coverage summary + warnings in meters (the sibling of 7.5) ---- */

export interface MetersCoverage {
  orderedMeters: number;
  /** Meters already given outside on meter POs — subtracted before the loom's target is worked out. */
  outsideMeters: number;
  /** Meters still needed from the loom after outside POs (never below 0). */
  neededMeters: number;
  /** Live: Σ effective loom metres in the active jobsheets × each jobsheet's own sections. */
  jobsheetClothMeters: number;
  /** Live: loom metres the order needs = ceil(needed metres ÷ `sections`, 2dp). */
  targetLoomMeters: number;
  /** The sections per beam "loom metres needed" is counted with — the latest run's, or the default 3. */
  sections: number;
  /** Sum of the active jobsheets' loom metres (actual once Completed — see `coverageMeters`). */
  totalLoomMeters: number;
  jobsheetCount: number;
}

export function orderJobsheetMetersPlan(
  orderedMeters: number,
  outsideMeters: number,
  list: readonly (Pick<AdjustMetersJobsheet, 'meters' | 'status' | 'completedMeters' | 'sections'> & { jobsheetNo?: number })[],
): MetersCoverage {
  const sections = latestSections(list);
  const neededMeters = Math.max(0, Math.round((orderedMeters - outsideMeters) * 100) / 100);
  return {
    orderedMeters,
    outsideMeters,
    neededMeters,
    jobsheetClothMeters: coverageClothMeters(list),
    targetLoomMeters: allocUnits(neededMeters, sections, 'meters'),
    sections,
    totalLoomMeters: coverageMeters([...list]),
    jobsheetCount: list.length,
  };
}

function onTargetMeters(c: MetersCoverage): boolean {
  return c.jobsheetClothMeters >= c.neededMeters && c.jobsheetClothMeters - c.neededMeters < METERS_ON_TARGET_SLACK;
}

const fmtLoomMeters = (n: number) => `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} loom meters`;
const fmtNum = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * Amber, non-blocking warnings for a meter order — same shape and wording pattern as the pcs `coverageWarnings`
 * (only the first one or two numbers of each sentence carry the unit word, exactly like "frames" there), with the
 * 0.05 m slack from `onTargetMeters` instead of "within 1 section".
 */
export function coverageWarningsMeters(c: MetersCoverage): CoverageWarning[] {
  if (c.jobsheetCount === 0 || onTargetMeters(c)) return [];
  const out: CoverageWarning[] = [];
  if (c.jobsheetClothMeters < c.neededMeters) {
    out.push({
      kind: 'pieces_less',
      message: `Jobsheet quantity (${formatQty(c.jobsheetClothMeters, 'meters')}) is less than the order (${formatQty(c.neededMeters, 'meters')}).`,
    });
    const short = Math.round(((c.neededMeters - c.jobsheetClothMeters) / c.sections) * 100) / 100;
    out.push({
      kind: 'frames_short',
      message: `Jobsheets cover ${fmtLoomMeters(c.totalLoomMeters)}, but ${fmtLoomMeters(c.totalLoomMeters + short)} are needed (${fmtNum(short)} short).`,
    });
  } else {
    out.push({
      kind: 'pieces_more',
      message: `Jobsheet quantity (${formatQty(c.jobsheetClothMeters, 'meters')}) is more than the order (${formatQty(c.neededMeters, 'meters')}).`,
    });
    const over = Math.round(((c.jobsheetClothMeters - c.neededMeters) / c.sections) * 100) / 100;
    out.push({
      kind: 'frames_over',
      message: `Jobsheets cover ${fmtLoomMeters(c.totalLoomMeters)}, which is ${fmtNum(over)} more than the ${fmtNum(c.totalLoomMeters - over)} needed.`,
    });
  }
  return out;
}

/** Live preview warning (meters) for the create/add forms — the sibling of `jobsheetQuantityWarning`. */
export function jobsheetQuantityWarningMeters(orderedMeters: number, currentClothMeters: number, addLoomMeters: number, sections: number = SECTIONS_PER_BEAM): string | null {
  if (!(addLoomMeters > 0) || !isValidSections(sections)) return null;
  const after = Math.round((currentClothMeters + quantityForUnits(addLoomMeters, sections, 'meters')) * 100) / 100;
  if (after >= orderedMeters && after - orderedMeters < METERS_ON_TARGET_SLACK) return null;
  const diff = Math.round(Math.abs(after - orderedMeters) * 100) / 100;
  if (diff === 0) return null;
  return `This makes the jobsheet quantity ${formatQty(after, 'meters')} — ${formatQty(diff, 'meters')} ${after < orderedMeters ? 'less' : 'more'} than the order (${formatQty(orderedMeters, 'meters')}).`;
}

/** Meters to prefill on a new multi-jobsheet meter run: the sibling of `remainingPieces`. */
export function remainingMeters(orderedMeters: number, jobsheetClothMeters: number): number | null {
  const left = Math.round((orderedMeters - jobsheetClothMeters) * 100) / 100;
  return left > 0 ? left : null;
}

/* ---- Change machine in meters (the sibling of the frames helpers) ---- */

/**
 * "Metres to make next" after "Metres completed" changes: follows the remaining metres (at least 0.01, since a
 * new jobsheet needs some loom meters) until the user has picked a value themselves (`touched`).
 */
export function nextMetersAfterCompletedChange(p: { assigned: number; completed: number; current: number; touched: boolean }): number {
  return p.touched ? p.current : Math.max(0.01, Math.round((p.assigned - p.completed) * 100) / 100);
}

/** "Assigned 50 m — you're recording 48 m (2 m fewer)." or null when equal. */
export function completedMetersNote(assigned: number, completed: number): string | null {
  if (assigned === completed) return null;
  const diff = Math.round(Math.abs(assigned - completed) * 100) / 100;
  return `Assigned ${formatQty(assigned, 'meters')} — you're recording ${formatQty(completed, 'meters')} (${formatQty(diff, 'meters')} ${completed < assigned ? 'fewer' : 'more'}).`;
}
