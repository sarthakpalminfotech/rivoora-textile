import { orderStatusForJobsheets } from '@rivoora/shared';
import type { SimJs, SimOrder } from './model';
import { stageAt } from './production';

/**
 * Sprint 26 — the demo order statuses come from the SAME rule as the app (`orderStatusForJobsheets`), evaluated at every
 * moment something changed, so the status history (and "Where the days go") is what the app would have written.
 */

function jsStatusAt(j: SimJs, x: number): string | null {
  if (j.createdX > x || (j.deletedX !== null && j.deletedX <= x)) return null;
  if (j.endX !== null && j.endX <= x) return 'completed';
  if (j.startX !== null && j.startX <= x) return 'ongoing';
  if (j.sentX !== null && j.sentX <= x) return 'sent';
  return 'pending';
}

export function statusAt(o: SimOrder, x: number): string {
  if (o.closeX !== null && o.closeX <= x) return 'closed';
  if (o.sentX === null || o.sentX > x) return 'pending_production';
  const takaCount = (j: SimJs) => j.takas.filter((t) => t.createdX <= x && (t.deletedX === null || t.deletedX > x)).length;
  const jobsheets = o.jobsheets
    .filter((j) => !j.external)
    .flatMap((j) => {
      const s = jsStatusAt(j, x);
      return s ? [{ status: s, takaCount: takaCount(j) }] : [];
    });
  const stages = o.takas.flatMap((t) => {
    if (t.createdX > x || (t.freeX !== null && t.freeX <= x) || (t.deletedX !== null && t.deletedX <= x)) return [];
    const s = stageAt(t, x);
    return s && s !== 'lost' ? [s] : [];
  });
  return orderStatusForJobsheets(jobsheets, stages, o.grX !== null && o.grX <= x, { steps: { hasProduction: o.hasProduction, hasButta: o.hasButta, hasMill: o.hasMill } });
}

/** Fills `o.status` and `o.history` (one row per change, at the moment it happened). */
export function computeStatus(o: SimOrder, H: number) {
  const points = new Set<number>([o.createdX]);
  const add = (x: number | null | undefined) => {
    if (x !== null && x !== undefined && x <= H) points.add(x);
  };
  add(o.sentX);
  add(o.closeX);
  add(o.grX);
  for (const j of o.jobsheets) [j.createdX, j.sentX, j.startX, j.endX, j.deletedX].forEach(add);
  for (const t of o.takas) {
    add(t.createdX);
    add(t.freeX);
    add(t.deletedX);
    for (const m of t.moves) add(m.x);
  }
  const sorted = [...points].sort((a, b) => a - b);
  o.history = [{ x: o.createdX, from: null, to: 'pending_production' }];
  let cur = 'pending_production';
  for (const x of sorted) {
    const next = statusAt(o, x);
    if (next !== cur) {
      o.history.push({ x, from: cur, to: next });
      cur = next;
    }
  }
  o.status = cur;
}
