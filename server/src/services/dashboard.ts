import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildOrderDashboard,
  canRoleSeeStatus,
  compareTakaNo,
  DAMAGE_TYPE_CONFIG,
  DAMAGE_TYPES,
  getSubStage,
  isDamageType,
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
import { jobsheets, orders, takas } from '../db/schema';
import { notFound } from '../lib/errors';
import { activeTakaCount, machinesJson, parseMachinesJson, runningMachine, runningMachineColumns, toMachineRef } from './jobsheets';
import { sortTakas, takaColumns, takaDamageName } from './taka-shared';

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
  const [orderRows, sheetRows, takaRows] = await db.batch([
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
        damageType: takas.damageType,
        count: sql<number>`COUNT(*)`,
        pcs: sql<number | null>`SUM(${takas.pcs})`,
      })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(activeTakasOf(orderId))
      .groupBy(takas.jobsheetId, takas.stage, takas.isDamaged, takas.damageType),
  ]);
  const order = assertVisible(role, orderRows[0]);
  const data = buildOrderDashboard(
    {
      order,
      jobsheets: sheetRows,
      takas: takaRows.map((t) => ({ ...t, count: Number(t.count), pcs: t.pcs === null ? null : Number(t.pcs) })),
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
    g.takas.push(t as Taka);
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
});

/** GET /orders/:id/damages?type= — every damaged active taka, counts per damage type. */
export async function getOrderDamages(role: RoleKey, orderId: number, query: unknown): Promise<OrderDamages> {
  const { type } = damagesQuerySchema.parse(query);
  const [orderRows, rows] = await db.batch([
    db.select(orderColumns).from(orders).where(eq(orders.id, orderId)),
    db
      .select({
        id: takas.id,
        takaNo: takas.takaNo,
        meters: takas.meters,
        pcs: takas.pcs,
        damageType: takas.damageType,
        damageId: takas.damageId,
        damageName: takaDamageName,
        stage: takas.stage,
        createdAt: takas.createdAt,
        jobsheetId: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        jobsheetStatus: jobsheets.status,
        note: jobsheets.takaNote,
      })
      .from(takas)
      .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
      .where(and(activeTakasOf(orderId), eq(takas.isDamaged, true)))
      .orderBy(asc(jobsheets.jobsheetNo), asc(takas.id)),
  ]);
  const order = assertVisible(role, orderRows[0]);
  const all: DamagedTaka[] = rows.map((r) => ({
    ...r,
    orderNo: order.orderNo,
    // Damage recorded before types existed counts as machine damage.
    damageType: isDamageType(r.damageType) ? r.damageType : 'machine',
  }));
  const counts = DAMAGE_TYPE_CONFIG.map((d) => ({ type: d.key, count: all.filter((t) => t.damageType === d.key).length }));
  const byNo = (a: DamagedTaka, b: DamagedTaka) => a.jobsheetNo - b.jobsheetNo || compareTakaNo(a.takaNo, b.takaNo);
  return {
    orderId: order.id,
    counts,
    total: all.length,
    items: (type ? all.filter((t) => t.damageType === (type as DamageType)) : all).sort(byNo),
  };
}
