/**
 * Hold order (Sprint 15). Jenish can put an order on hold: work on it stops and it is hidden from production, QC,
 * godown and dispatch until he releases it. Jenish and Gaurang still see it (with an "On hold" badge).
 */
import { can, ROLES, type RoleKey } from './roles';

export const ORDER_ON_HOLD_HI = 'यह ऑर्डर होल्ड पर है';
export const ORDER_ON_HOLD_EN = 'This order is on hold';

/** "Order #26 is on hold" — the 409 text of every write on a held order. Bilingual roles also get the Hindi line. */
export function orderOnHoldMessage(orderNo: number, role?: RoleKey): string {
  const en = `Order #${orderNo} is on hold`;
  return role && ROLES[role].bilingual ? `${en} / ${ORDER_ON_HOLD_HI}` : en;
}

/** Sprint 16: "Order #26 is closed" — the 409 text of every write on a closed order (except receiving). */
export const ORDER_CLOSED_HI = 'यह ऑर्डर बंद है';
export function orderClosedMessage(orderNo: number, role?: RoleKey): string {
  const en = `Order #${orderNo} is closed`;
  return role && ROLES[role].bilingual ? `${en} / ${ORDER_CLOSED_HI}` : en;
}

/** Roles that still see a held order. Everyone else has it hidden from lists and blocked on details. */
export const seesHeldOrders = (role: RoleKey): boolean => can(role, 'canSeeHeldOrders');

/** One ongoing jobsheet of the order and what the owner entered as "Frames completed". */
export interface HoldJobsheetEntry {
  jobsheetId: number;
  completedFrames: number;
}

export interface HoldCompletion {
  jobsheetId: number;
  completedFrames: number;
  /** Frames left to make = assigned − completed. A new Pending jobsheet is created for them when > 0. */
  remainingFrames: number;
}

export interface HoldPlanError {
  jobsheetId: number | null;
  message: string;
}

/**
 * What putting an order on hold does to its ONGOING jobsheets: each one is completed with the frames entered (0 …
 * assigned), and the frames that remain become a new Pending jobsheet. Every ongoing jobsheet needs an entry, and an
 * entry must belong to one of them.
 */
export function planHold(
  ongoing: readonly { id: number; frames: number }[],
  entries: readonly HoldJobsheetEntry[],
): { completions: HoldCompletion[]; errors: HoldPlanError[] } {
  const errors: HoldPlanError[] = [];
  const byId = new Map(entries.map((e) => [e.jobsheetId, e]));
  const ids = new Set(ongoing.map((j) => j.id));
  for (const e of entries) {
    if (!ids.has(e.jobsheetId)) errors.push({ jobsheetId: e.jobsheetId, message: 'This jobsheet is no longer on the loom. Refresh and try again.' });
  }
  const completions: HoldCompletion[] = [];
  for (const j of ongoing) {
    const e = byId.get(j.id);
    if (!e) {
      errors.push({ jobsheetId: j.id, message: 'Enter the frames completed.' });
      continue;
    }
    if (!Number.isInteger(e.completedFrames) || e.completedFrames < 0) {
      errors.push({ jobsheetId: j.id, message: 'Frames completed must be a whole number, 0 or more.' });
      continue;
    }
    if (e.completedFrames > j.frames) {
      errors.push({ jobsheetId: j.id, message: `Can't be more than the ${j.frames} frames assigned.` });
      continue;
    }
    completions.push({ jobsheetId: j.id, completedFrames: e.completedFrames, remainingFrames: j.frames - e.completedFrames });
  }
  return { completions, errors };
}

/** Sprint 19: the meter twin of `HoldJobsheetEntry`/`HoldCompletion`. */
export interface HoldMetersJobsheetEntry {
  jobsheetId: number;
  completedMeters: number;
}

export interface HoldMetersCompletion {
  jobsheetId: number;
  completedMeters: number;
  /** Metres left to make = assigned − completed. A new Pending jobsheet is created for them when > 0. */
  remainingMeters: number;
}

/** Sprint 19: the meter twin of `planHold`. */
export function planHoldMeters(
  ongoing: readonly { id: number; meters: number }[],
  entries: readonly HoldMetersJobsheetEntry[],
): { completions: HoldMetersCompletion[]; errors: HoldPlanError[] } {
  const errors: HoldPlanError[] = [];
  const byId = new Map(entries.map((e) => [e.jobsheetId, e]));
  const ids = new Set(ongoing.map((j) => j.id));
  for (const e of entries) {
    if (!ids.has(e.jobsheetId)) errors.push({ jobsheetId: e.jobsheetId, message: 'This jobsheet is no longer on the loom. Refresh and try again.' });
  }
  const completions: HoldMetersCompletion[] = [];
  for (const j of ongoing) {
    const e = byId.get(j.id);
    if (!e) {
      errors.push({ jobsheetId: j.id, message: 'Enter the metres completed.' });
      continue;
    }
    if (!(e.completedMeters >= 0)) {
      errors.push({ jobsheetId: j.id, message: 'Metres completed must be 0 or more.' });
      continue;
    }
    if (e.completedMeters > j.meters) {
      errors.push({ jobsheetId: j.id, message: `Can't be more than the ${j.meters} metres assigned.` });
      continue;
    }
    const completedMeters = Math.round(e.completedMeters * 100) / 100;
    completions.push({ jobsheetId: j.id, completedMeters, remainingMeters: Math.round((j.meters - completedMeters) * 100) / 100 });
  }
  return { completions, errors };
}

/** The "Put on hold" / "Released from hold" timeline label. */
export const HOLD_EVENT_LABEL = { held: 'Put on hold', released: 'Released from hold' } as const;
export type HoldEventKind = keyof typeof HOLD_EVENT_LABEL;
