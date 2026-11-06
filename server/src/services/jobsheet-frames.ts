import { and, eq, sql } from 'drizzle-orm';
import { framesFromTakaPcs, isMeterOrder, JOBSHEET_STATUS, metersFromTakaMeters } from '@rivoora/shared';
import type { Tx } from '../db/client';
import { jobsheets, orders, takas } from '../db/schema';

/**
 * Sprint 21 (CR-05) — the supervisor completes a jobsheet without entering frames; the frames (or loom metres of a
 * meter order) come from the taka entry: Σ pcs of the jobsheet's active takas ÷ its sections (round half up), or
 * Σ taka metres ÷ sections. Called in the same transaction after every taka write on the jobsheet (entry, edit,
 * the taka-entry person's own edit). A Completed jobsheet with no takas keeps whatever it has (assigned counts).
 */
export async function syncCompletedFromTakas(tx: Tx, jobsheetId: number): Promise<{ frames: number | null; meters: number | null; pcs: number } | null> {
  const [js] = await tx
    .select({ id: jobsheets.id, status: jobsheets.status, sections: jobsheets.sections, unit: orders.unit })
    .from(jobsheets)
    .innerJoin(orders, eq(orders.id, jobsheets.orderId))
    .where(eq(jobsheets.id, jobsheetId));
  if (!js || js.status !== JOBSHEET_STATUS.COMPLETED) return null;
  const [sum] = await tx
    .select({
      n: sql<number>`COUNT(*)`,
      pcs: sql<number>`COALESCE(SUM(${takas.pcs}), 0)`,
      meters: sql<number>`COALESCE(SUM(${takas.meters}), 0)`,
    })
    .from(takas)
    .where(and(eq(takas.jobsheetId, jobsheetId), eq(takas.isDeleted, false)));
  if (!sum || Number(sum.n) === 0) return null;
  const pcs = Number(sum.pcs);
  if (isMeterOrder(js)) {
    const meters = metersFromTakaMeters(Number(sum.meters), js.sections);
    await tx.update(jobsheets).set({ completedMeters: meters }).where(eq(jobsheets.id, jobsheetId));
    return { frames: null, meters, pcs };
  }
  if (pcs <= 0) return null; // older takas without pcs: keep the assigned frames
  const frames = framesFromTakaPcs(pcs, js.sections);
  await tx.update(jobsheets).set({ completedFrames: frames }).where(eq(jobsheets.id, jobsheetId));
  return { frames, meters: null, pcs };
}
