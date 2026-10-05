import { and, asc, eq, sql } from 'drizzle-orm';
import { JOBSHEET_STATUS, type MachineViewData, type MachineViewJobsheet, type MachineViewMachine } from '@rivoora/shared';
import { db } from '../db/client';
import { designVariations, designs, jobsheets, machines, orders } from '../db/schema';

/** The machine floor board: every machine with its ongoing jobsheets, in one round trip (two queries). */
export async function getMachineView(): Promise<MachineViewData> {
  const [machineRows, ongoingRows] = await db.batch([
    db
      .select({
        id: machines.id,
        machineNo: machines.machineNo,
        name: machines.name,
        isActive: machines.isActive,
        // Outer column written explicitly (see the Drizzle gotcha in CLAUDE.md).
        lastCompletedAt: sql<string | null>`(SELECT MAX(j.completed_at) FROM jobsheets j WHERE j.running_machine_id = "machines"."id" AND j.is_deleted = 0)`,
      })
      .from(machines)
      .where(eq(machines.isDeleted, false))
      .orderBy(asc(machines.machineNo)),
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        orderNo: orders.orderNo,
        frames: jobsheets.frames,
        machineId: jobsheets.runningMachineId,
        startedAt: jobsheets.startedAt,
        designCode: sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`,
        thumbUrl: sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.thumbUrl} ELSE ${designs.thumbUrl} END`,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(eq(jobsheets.status, JOBSHEET_STATUS.ONGOING), eq(jobsheets.isDeleted, false)))
      .orderBy(asc(jobsheets.startedAt), asc(jobsheets.jobsheetNo)),
  ]);

  const ongoing = new Map<number, MachineViewJobsheet[]>();
  for (const { machineId, ...j } of ongoingRows) {
    if (machineId === null) continue;
    const list = ongoing.get(machineId);
    if (list) list.push(j);
    else ongoing.set(machineId, [j]);
  }

  const all: MachineViewMachine[] = machineRows.map((m) => ({ ...m, ongoing: ongoing.get(m.id) ?? [] }));
  return {
    machines: all.filter((m) => m.isActive),
    inactive: all.filter((m) => !m.isActive),
    generatedAt: new Date().toISOString(),
  };
}
