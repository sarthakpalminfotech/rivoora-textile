import { sql } from 'drizzle-orm';
import type { OrderStatusKey, Unit } from '@rivoora/shared';
import { rows, type InsightCtx } from './context';

/**
 * Sprint 25 — row loaders shared by the cards (memoised per request on the context). Every order-level read leaves out the
 * hidden stock-holder orders; every jobsheet read leaves out the hidden external jobsheets (`is_external = 0`).
 */

export interface OrderRow {
  id: number;
  orderNo: number;
  status: OrderStatusKey;
  unit: Unit;
  quantity: number;
  rate: number | null;
  orderDate: string;
  promisedDate: string | null;
  createdAt: string;
  customerId: number;
  customerName: string;
  brokerId: number | null;
  brokerName: string | null;
  materialId: number;
  materialName: string;
  designId: number | null;
  designCode: string | null;
  isClosed: number;
  closedAt: string | null;
  isOnHold: number;
  heldAt: string | null;
  hasProduction: number;
  hasButta: number;
  hasMill: number;
  sentToProductionAt: string | null;
}

/** Order statuses that are finished (no more work): dispatched, returned, closed. */
export const DONE_STATUSES: readonly string[] = ['dispatched', 'returned', 'closed'];
export const isOpenOrder = (o: Pick<OrderRow, 'status' | 'isClosed'>) => !o.isClosed && !DONE_STATUSES.includes(o.status);

/** Statuses counted as "in production" (jobsheets made, on the loom, outside weaver, FG awaited). */
export const IN_PRODUCTION: readonly string[] = ['jobsheet_created', 'in_production', 'production_completed', 'outside_production', 'awaiting_goods'];

export function loadOrders(ctx: InsightCtx): Promise<OrderRow[]> {
  return ctx.memo('orders', () =>
    rows<OrderRow>(sql`
      SELECT o.id, o.order_no AS orderNo, o.status, o.unit, o.quantity, o.rate, o.order_date AS orderDate,
             o.promised_date AS promisedDate, o.created_at AS createdAt,
             o.customer_id AS customerId, c.name AS customerName, o.broker_id AS brokerId, b.name AS brokerName,
             o.material_id AS materialId, m.name AS materialName, o.design_id AS designId, d.code AS designCode,
             o.is_closed AS isClosed, o.closed_at AS closedAt, o.is_on_hold AS isOnHold, o.held_at AS heldAt,
             o.has_production AS hasProduction, o.has_butta AS hasButta, o.has_mill AS hasMill,
             o.sent_to_production_at AS sentToProductionAt
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN materials m ON m.id = o.material_id
      LEFT JOIN customer_brokers b ON b.id = o.broker_id
      LEFT JOIN designs d ON d.id = o.design_id
      WHERE o.is_stock_holder = 0`),
  );
}

export interface DispatchRow {
  id: number;
  challanNo: number;
  orderId: number;
  challanDate: string;
  createdAt: string;
  createdByUserId: number | null;
  pcs: number;
  meters: number;
}

/** Every dispatch that happened: the original revision of each delivery challan, not cancelled (a GR revision is not a new dispatch). */
export function loadDispatches(ctx: InsightCtx): Promise<DispatchRow[]> {
  return ctx.memo('dispatches', () =>
    rows<DispatchRow>(sql`
      SELECT dc.id, dc.challan_no AS challanNo, dc.order_id AS orderId, dc.challan_date AS challanDate, dc.created_at AS createdAt,
             dc.created_by_user_id AS createdByUserId,
             COALESCE(SUM(dct.pcs), 0) AS pcs, COALESCE(SUM(dct.meters), 0) AS meters
      FROM dispatch_challans dc
      LEFT JOIN dispatch_challan_takas dct ON dct.challan_id = dc.id
      WHERE dc.revision = 0 AND dc.status <> 'cancelled'
      GROUP BY dc.id`),
  );
}

/** The date each order was last dispatched (its final delivery for Dispatched / Returned orders). */
export async function lastDispatchDay(ctx: InsightCtx): Promise<Map<number, string>> {
  const list = await loadDispatches(ctx);
  const out = new Map<number, string>();
  for (const d of list) if (!out.has(d.orderId) || out.get(d.orderId)! < d.challanDate) out.set(d.orderId, d.challanDate);
  return out;
}

/**
 * "Entered" takas for pcs / m totals: first pieces only — not split parts (their pcs are the original's), not goods-return
 * lots, not manual stock adds; takas removed later still count (they were made).
 */
export const ENTERED_TAKA = sql.raw(`t.parent_taka_id IS NULL AND t.is_return_lot = 0 AND COALESCE(t.free_stock_reason, '') <> 'manual_add' AND (t.is_deleted = 0 OR t.removed_at IS NOT NULL)`);

/** A taka's quantity in its order's unit. */
export const TAKA_PCS = sql.raw(`COALESCE(t.actual_pcs, t.pcs, 0)`);
export const TAKA_M = sql.raw(`COALESCE(t.actual_meters, t.meters, 0)`);

export interface MachineRow {
  id: number;
  machineNo: number;
}
export function loadMachines(ctx: InsightCtx): Promise<MachineRow[]> {
  return ctx.memo('machines', () => rows<MachineRow>(sql`SELECT id, machine_no AS machineNo FROM machines WHERE is_deleted = 0 AND is_active = 1 ORDER BY machine_no`));
}

export interface LoomRunRow {
  jobsheetId: number;
  jobsheetNo: number;
  machineId: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}
/** On-loom intervals of real jobsheets (start → completion, or now while ongoing). */
export function loadLoomRuns(ctx: InsightCtx): Promise<LoomRunRow[]> {
  return ctx.memo('loom-runs', () =>
    rows<LoomRunRow>(sql`
      SELECT j.id AS jobsheetId, j.jobsheet_no AS jobsheetNo, j.running_machine_id AS machineId, j.status, j.started_at AS startedAt,
             j.completed_at AS completedAt, j.updated_at AS updatedAt
      FROM jobsheets j
      WHERE j.is_deleted = 0 AND j.is_external = 0 AND j.started_at IS NOT NULL AND j.running_machine_id IS NOT NULL
        AND j.status IN ('ongoing', 'completed')`),
  );
}
/** The end of a loom run: its completion, or now while it is on the loom. */
export const runEnd = (r: LoomRunRow, now: Date) => (r.status === 'ongoing' ? now.toISOString() : (r.completedAt ?? r.updatedAt));

/** Status label + sequence helpers for "where is it" lines. */
export const qtyText = (pcs: number, m: number) => [pcs ? `${Math.round(pcs).toLocaleString('en-IN')} pcs` : null, m ? `${Number(m.toFixed(2)).toLocaleString('en-IN')} m` : null].filter(Boolean).join(' · ') || '—';
