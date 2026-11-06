import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import {
  alertCounts,
  buildOverdueAlerts,
  challanLabel,
  type AlertChallanInput,
  type AlertJobsheetInput,
  type AlertOrderInput,
  type AlertType,
  type OverdueAlert,
  type RoleKey,
} from '@rivoora/shared';
import { db } from '../db/client';
import { challans, challanTakas, designs, jobsheets, machines, orders, takas } from '../db/schema';
import { realJobsheet } from './external';
import { takaInOrderRaw } from './free-stock';

/**
 * Sprint 21 (CR-11 + C5) — GET /alerts. Computed on request from the live rows (no stored alerts): jobsheets on the loom,
 * pending takas on butta / mill challans, the order's age since its first jobsheet started, and orders sent short. Held
 * and closed orders are left out of the clocks (a held order is paused). The rules are the pure `buildOverdueAlerts`.
 */
export interface AlertsResult {
  items: OverdueAlert[];
  counts: Record<AlertType, number>;
  total: number;
}

export async function listAlerts(role: RoleKey, type?: AlertType): Promise<AlertsResult> {
  const designCode = sql<string | null>`${designs.code}`;
  const notPaused = and(eq(orders.isOnHold, false), eq(orders.isClosed, false));

  const [onLoom, onChallans, orderRows] = await Promise.all([
    db
      .select({
        jobsheetId: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        orderId: orders.id,
        orderNo: orders.orderNo,
        designCode,
        startedAt: jobsheets.startedAt,
        machineNo: machines.machineNo,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(machines, eq(machines.id, jobsheets.runningMachineId))
      .where(and(eq(jobsheets.status, 'ongoing'), eq(jobsheets.isDeleted, false), realJobsheet, isNotNull(jobsheets.startedAt), notPaused)),
    db
      .select({
        kind: challans.kind,
        challanId: challans.id,
        challanNo: challans.challanNo,
        challanDate: challans.challanDate,
        orderId: orders.id,
        orderNo: orders.orderNo,
        designCode,
        pendingTakas: sql<number>`COUNT(*)`,
      })
      .from(challanTakas)
      .innerJoin(challans, eq(challans.id, challanTakas.challanId))
      .innerJoin(takas, eq(takas.id, challanTakas.takaId))
      .innerJoin(orders, eq(orders.id, challanTakas.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .where(
        and(
          eq(challans.status, 'active'),
          eq(challanTakas.isActive, true),
          sql`${challanTakas.receivedAt} IS NULL AND ${challanTakas.lostAt} IS NULL`,
          sql`${takas.stage} = CASE WHEN ${challans.kind} = 'butta' THEN 'at_butta' ELSE 'at_mill' END`,
          notPaused,
        ),
      )
      .groupBy(challans.id, orders.id),
    db
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        designCode,
        status: orders.status,
        unit: orders.unit,
        ordered: orders.quantity,
        firstStartedAt: sql<string | null>`(SELECT MIN(j.started_at) FROM jobsheets j WHERE j.order_id = "orders"."id" AND j.is_deleted = 0 AND j.is_external = 0 AND j.started_at IS NOT NULL)`,
        dispatched: sql<number>`COALESCE((SELECT SUM(CASE WHEN "orders"."unit" = 'meters' THEN COALESCE(t.actual_meters, t.meters, 0) ELSE COALESCE(t.actual_pcs, t.pcs, 0) END) FROM takas t WHERE ${takaInOrderRaw('t', '"orders"."id"')} AND t.is_deleted = 0 AND t.stage = 'dispatched'), 0)`,
      })
      .from(orders)
      .leftJoin(designs, eq(designs.id, orders.designId))
      .where(
        and(
          eq(orders.isOnHold, false),
          or(
            sql`${orders.status} IN ('dispatched', 'closed')`,
            and(sql`${orders.status} NOT IN ('pending_production', 'dispatched', 'returned', 'closed')`, eq(orders.isClosed, false)),
          ),
        ),
      ),
  ]);

  const input = {
    jobsheets: onLoom.map((j): AlertJobsheetInput => ({ ...j, startedAt: j.startedAt! })),
    challans: onChallans.map((c): AlertChallanInput => ({ ...c, kind: c.kind as 'butta' | 'mill', label: challanLabel(c.challanNo, c.kind as 'butta' | 'mill'), pendingTakas: Number(c.pendingTakas) })),
    orders: orderRows.map((o): AlertOrderInput => ({ ...o, ordered: Number(o.ordered), dispatched: Number(o.dispatched) })),
  };
  const all = buildOverdueAlerts(input, role, new Date());
  const items = type ? all.filter((a) => a.type === type) : all;
  return { items, counts: alertCounts(all), total: all.length };
}
