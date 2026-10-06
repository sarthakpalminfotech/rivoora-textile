import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildOrderDashboard,
  canRoleSeeStatus,
  compareTakaNo,
  damageOpenPcs,
  DAMAGE_TYPE_CONFIG,
  DAMAGE_TYPES,
  getSubStage,
  jobsheetSubStage,
  SUB_STAGE_KEYS,
  type DamagedTaka,
  type DamageType,
  type DashboardItems,
  type DashboardJobsheetItem,
  type DashboardTakaGroup,
  type OrderDamages,
  type OrderDashboard,
  type RoleKey,
  type Taka,
} from '@rivoora/shared';
import { db } from '../db/client';
import { challanTakas, jobsheets, orders, takaDamages, takas } from '../db/schema';
import { notFound } from '../lib/errors';
import { activeTakaCount, machinesJson, parseMachinesJson, runningMachine, runningMachineColumns, toMachineRef } from './jobsheets';
import { mapTaka, parseDamagesJson, sortTakas, takaColumns, takaDamagesJson } from './taka-shared';

/**
 * Order dashboard (Jemish / Gaurang): counts, the items of one sub-stage, and the damaged takas.
 * Same visibility rule as `GET /orders/:id` (404 when the role can't see the order's status).
 */

const orderColumns = {
  id: orders.id,
  orderNo: orders.orderNo,
  status: orders.status,
  unit: orders.unit,
  quantity: orders.quantity,
  jobsheetPieces: orders.jobsheetPieces,
  targetFrames: orders.targetFrames,
};

const activeJobsheetOf = (orderId: number) => and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false));
/** Active takas of the order whose jobsheet is active too. */
const activeTakasOf = (orderId: number) => and(eq(takas.orderId, orderId), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false));

function assertVisible<T extends { status: string }>(role: RoleKey, order: T | undefined): T {
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');
  return order;
}

/** GET /orders/:id/dashboard — one round trip: the order, its jobsheets, and the takas aggregated by stage. */
export async function getOrderDashboard(role: RoleKey, orderId: number): Promise<OrderDashboard> {
  const [orderRows, sheetRows, takaRows, damageRows, buttaRows] = await db.batch([
    db.select(orderColumns).from(orders).where(eq(orders.id, orderId)),
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
        sentAt: jobsheets.sentAt,
        startedAt: jobsheets.startedAt,
        completedAt: jobsheets.completedAt,
        runningMachineId: jobsheets.runningMachineId,
      })
      .from(jobsheets)
      .where(activeJobsheetOf(orderId)),
    db
      .select({
        jobsheetId: takas.jobsheetId,
        stage: takas.stage,
        isDamaged: takas.isDamaged,
        count: sql<number>`COUNT(*)`,
        pcs: sql<number | null>`SUM(${takas.pcs})`,
        withoutPcs: sql<number>`SUM(CASE WHEN ${takas.pcs} IS NULL THEN 1 ELSE 0 END)`,
      })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(activeTakasOf(orderId))
      .groupBy(takas.jobsheetId, takas.stage, takas.isDamaged),
    // OPEN damages by where they were found (the damage tiles).
    db
      .select({
        foundAt: takaDamages.foundAt,
        count: sql<number>`COUNT(*)`,
        // Damaged pcs still OPEN (a partly resolved damage counts only what is left).
        pcs: sql<number | null>`SUM(${takaDamages.pcs} - ${takaDamages.resolvedPcs})`,
      })
      .from(takaDamages)
      .innerJoin(takas, eq(takas.id, takaDamages.takaId))
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(activeTakasOf(orderId), eq(takaDamages.status, 'open'), eq(takaDamages.isDeleted, false)))
      .groupBy(takaDamages.foundAt),
    // Takas of the order that went through butta cutting (an active butta challan row) — 0 = the order skipped it.
    db
      .select({ n: sql<number>`COUNT(DISTINCT ${challanTakas.takaId})` })
      .from(challanTakas)
      .innerJoin(takas, eq(takas.id, challanTakas.takaId))
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(activeTakasOf(orderId), eq(challanTakas.kind, 'butta'), eq(challanTakas.isActive, true))),
  ]);
  const order = assertVisible(role, orderRows[0]);
  const data = buildOrderDashboard(
    {
      order,
      jobsheets: sheetRows,
      takas: takaRows.map((t) => ({ ...t, count: Number(t.count), pcs: t.pcs === null ? null : Number(t.pcs), withoutPcs: Number(t.withoutPcs) })),
      damages: damageRows.map((d) => ({ foundAt: d.foundAt, count: Number(d.count), pcs: d.pcs === null ? null : Number(d.pcs) })),
      buttaTakas: Number(buttaRows[0]?.n ?? 0),
    },
    new Date(),
  );
  return { ...data, orderId: order.id, orderNo: order.orderNo, status: order.status, generatedAt: new Date().toISOString() };
}

export const dashboardItemsQuerySchema = z.object({ sub: z.enum(SUB_STAGE_KEYS) });

/** Number of the jobsheet this one continues (outer column written explicitly — see the Drizzle gotcha). */
const parentJobsheetNo = sql<number | null>`(SELECT p.jobsheet_no FROM jobsheets p WHERE p.id = "jobsheets"."parent_jobsheet_id")`;

/** GET /orders/:id/dashboard/items?sub= — the jobsheets or takas (grouped by jobsheet) in one sub-stage. */
export async function getDashboardItems(role: RoleKey, orderId: number, query: unknown): Promise<DashboardItems> {
  const { sub } = dashboardItemsQuerySchema.parse(query);
  const config = getSubStage(sub);

  if (config.unit === 'jobsheets') {
    const [orderRows, rows] = await db.batch([
      db.select(orderColumns).from(orders).where(eq(orders.id, orderId)),
      db
        .select({
          id: jobsheets.id,
          jobsheetNo: jobsheets.jobsheetNo,
          status: jobsheets.status,
          frames: jobsheets.frames,
          completedFrames: jobsheets.completedFrames,
          picks: jobsheets.picks,
          createdAt: jobsheets.createdAt,
          sentAt: jobsheets.sentAt,
          startedAt: jobsheets.startedAt,
          completedAt: jobsheets.completedAt,
          parentJobsheetNo,
          machinesJson,
          ...runningMachineColumns,
          takaCount: activeTakaCount,
        })
        .from(jobsheets)
        .leftJoin(runningMachine, eq(runningMachine.id, jobsheets.runningMachineId))
        .where(activeJobsheetOf(orderId))
        .orderBy(asc(jobsheets.jobsheetNo)),
    ]);
    const order = assertVisible(role, orderRows[0]);
    const items: DashboardJobsheetItem[] = rows
      .filter((r) => jobsheetSubStage(r.status, Number(r.takaCount)) === sub)
      .map((r) => ({
        id: r.id,
        jobsheetNo: r.jobsheetNo,
        orderNo: order.orderNo,
        status: r.status,
        frames: r.frames,
        completedFrames: r.completedFrames,
        picks: r.picks,
        machines: parseMachinesJson(r.machinesJson),
        runningMachine: toMachineRef(r),
        parentJobsheetNo: r.parentJobsheetNo,
        createdAt: r.createdAt,
        sentAt: r.sentAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      }));
    return { sub, kind: 'jobsheets', connected: config.connected, jobsheets: items };
  }

  const stages = config.takaStages ?? [];
  const [orderRows, rows] = await db.batch([
    db.select(orderColumns).from(orders).where(eq(orders.id, orderId)),
    db
      .select({
        ...takaColumns,
        jobsheetId: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        jobsheetStatus: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
      })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(activeTakasOf(orderId), inArray(takas.stage, [...stages])))
      .orderBy(asc(jobsheets.jobsheetNo)),
  ]);
  const order = assertVisible(role, orderRows[0]);
  const groups: DashboardTakaGroup[] = [];
  for (const { jobsheetId, jobsheetNo, jobsheetStatus, frames, completedFrames, ...t } of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.jobsheetId !== jobsheetId) {
      g = { jobsheetId, jobsheetNo, orderNo: order.orderNo, status: jobsheetStatus, frames, completedFrames, takas: [] };
      groups.push(g);
    }
    g.takas.push(mapTaka(t) as Taka);
  }
  for (const g of groups) g.takas = sortTakas(g.takas);
  return { sub, kind: 'takas', connected: config.connected, groups };
}

export const damagesQuerySchema = z.object({
  type: z
    .enum(DAMAGE_TYPES)
    .or(z.literal(''))
    .optional()
    .transform((v) => v || undefined),
  /** "Show resolved" — also list resolved damages (off by default). */
  resolved: z
    .enum(['1', 'true', '0', 'false', ''])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

/**
 * GET /orders/:id/damages?type=&resolved= — the damaged takas of the order. Counts are OPEN damages by where they
 * were found (with damaged pcs); resolved damages are listed only with `resolved=1`.
 */
export async function getOrderDamages(role: RoleKey, orderId: number, query: unknown): Promise<OrderDamages> {
  const { type, resolved } = damagesQuerySchema.parse(query);
  const [orderRows, rows] = await db.batch([
    db.select(orderColumns).from(orders).where(eq(orders.id, orderId)),
    db
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        meters: takas.meters,
        pcs: takas.pcs,
        stage: takas.stage,
        createdAt: takas.createdAt,
        jobsheetId: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        jobsheetStatus: jobsheets.status,
        note: jobsheets.takaNote,
        damagesJson: takaDamagesJson,
      })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(
        and(
          activeTakasOf(orderId),
          sql`EXISTS (SELECT 1 FROM taka_damages d WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0)`,
        ),
      )
      .orderBy(asc(jobsheets.jobsheetNo), asc(takas.id)),
  ]);
  const order = assertVisible(role, orderRows[0]);

  const counts = new Map<DamageType, { count: number; pcs: number | null }>(DAMAGE_TYPES.map((t) => [t, { count: 0, pcs: null }]));
  let resolvedTotal = 0;
  const items: DamagedTaka[] = [];
  for (const { damagesJson, ...r } of rows) {
    const all = parseDamagesJson(damagesJson);
    for (const d of all) {
      if (d.status === 'open') {
        const c = counts.get(d.foundAt)!;
        c.count += 1;
        const open = damageOpenPcs(d);
        if (open !== null) c.pcs = (c.pcs ?? 0) + open;
      } else resolvedTotal += 1;
    }
    const shown = all.filter((d) => (resolved || d.status === 'open') && (!type || d.foundAt === type));
    if (shown.length) items.push({ ...r, orderNo: order.orderNo, damages: shown });
  }
  const byNo = (a: DamagedTaka, b: DamagedTaka) => a.jobsheetNo - b.jobsheetNo || compareTakaNo(a.takaNo, b.takaNo);
  return {
    orderId: order.id,
    counts: DAMAGE_TYPE_CONFIG.map((d) => ({ type: d.key, count: counts.get(d.key)!.count, pcs: counts.get(d.key)!.pcs })),
    total: [...counts.values()].reduce((n, c) => n + c.count, 0),
    resolvedTotal,
    items: items.sort(byNo),
  };
}
