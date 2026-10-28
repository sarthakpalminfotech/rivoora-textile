import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { currentUserId } from '../lib/request-context';
import { z } from 'zod';
import {
  can,
  canRoleSeeStatus,
  isOrderKind,
  isOrderType,
  isOutsideOrderFilter,
  isStatusKey,
  orderKind,
  parsePoNo,
  type OrderEventEntry,
  type OrderKind,
  normalizeCode,
  parseIdList,
  parseKeyList,
  orderCreateSchema,
  orderUpdateSchema,
  STATUS,
  visibleStatusKeys,
  type OrderDetail,
  type OrderListItem,
  type OrderStatusKey,
  type Paginated,
  type PreviousDesign,
  type RoleKey,
  type SendToProductionResult,
} from '@rivoora/shared';
import { db, type Tx } from '../db/client';
import {
  customerBrokers,
  customers,
  designs,
  materials,
  orderEvents,
  orderNoteImages,
  orderStatusHistory,
  orders,
  outsidePos,
  takas,
  users,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { csv, likePattern, paginationSchema } from '../lib/http';
import { designQualitiesJson, insertDesignFromOrder, parseQualities } from './designs';
import { countActiveJobsheets, recomputeOrderStatus } from './jobsheets';
import { applyStepsChange, stepLocksOf } from './order-steps';
import { liveJobsheetClothMeters, liveJobsheetPieces } from './jobsheet-live';
import { getOrderReturnSummary } from './dispatch';
import { assertOrderVisibleFor, orderNotHeldFor } from './hold';
import { listHoldEvents } from './hold-order';
import { isGodownOrdersOnly, orderHasGodownTakas } from './godown-scope';

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal('').transform(() => undefined));

export const orderListQuerySchema = paginationSchema.extend({
  status: z.string().optional().transform(csv),
  material: z.string().optional().transform((v) => parseIdList(v)),
  /** Party (client) filter: `party=3,7` — only honoured for roles that see the client. */
  party: z.string().optional().transform((v) => parseIdList(v)),
  /** Order type filter: `type=lump,pcs_to_pcs`. */
  type: z.string().optional().transform((v) => parseKeyList(v, isOrderType)),
  /** Sprint 16: order kind filter: `kind=in_house,outside_production,fg_purchase`. */
  kind: z.string().optional().transform((v) => parseKeyList(v, isOrderKind)),
  /** Sprint 18: Outside order filter: `outside=yes` / `outside=no` (only honoured for roles that see the client). */
  outside: z.string().optional().transform((v) => parseKeyList(v, isOutsideOrderFilter)),
  from: dateString,
  to: dateString,
});

/** Sprint 16: SQL of an order kind (from the three step columns). */
function kindSql(kind: OrderKind): SQL {
  if (kind === 'in_house') return eq(orders.hasProduction, true);
  if (kind === 'outside_production') return and(eq(orders.hasProduction, false), or(eq(orders.hasButta, true), eq(orders.hasMill, true)))!;
  return and(eq(orders.hasProduction, false), eq(orders.hasButta, false), eq(orders.hasMill, false))!;
}

/** The supervisor's Orders (production only): orders without the Production step never appear for him. */
const productionOnly = (role: RoleKey) => can(role, 'canViewProductionOrders') && !can(role, 'canViewOrders');
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

function emptyPage<T>(page: number, limit: number): Paginated<T> {
  return { items: [], page, limit, total: 0, hasMore: false };
}

/** List: lean columns only, role-filtered, customer + material joined in one query. */
export async function listOrders(role: RoleKey, q: OrderListQuery): Promise<Paginated<OrderListItem>> {
  const visible = visibleStatusKeys(role);
  const requested = q.status.filter(isStatusKey);
  const statuses = requested.length ? requested.filter((s) => visible.includes(s)) : visible;
  if (statuses.length === 0) return emptyPage(q.page, q.limit);

  // Sprint 15: a held order is visible to Jenish / Gaurang only.
  // Sprint 15: the godown supervisor only lists orders that have takas at the butta stage or later.
  const conditions: (SQL | undefined)[] = [
    inArray(orders.status, statuses),
    orderNotHeldFor(role),
    isGodownOrdersOnly(role) ? orderHasGodownTakas : undefined,
    productionOnly(role) ? eq(orders.hasProduction, true) : undefined,
  ];
  if (q.kind.length) conditions.push(or(...q.kind.map(kindSql)));
  if (q.from) conditions.push(gte(orders.orderDate, q.from));
  if (q.to) conditions.push(lte(orders.orderDate, q.to));
  if (q.material.length) conditions.push(inArray(orders.materialId, q.material));
  if (q.type.length) conditions.push(inArray(orders.orderType, q.type));
  if (q.party.length && can(role, 'canSeeClient')) conditions.push(inArray(orders.customerId, q.party));
  if (q.outside.length === 1 && can(role, 'canSeeClient')) conditions.push(eq(orders.isOutsideOrder, q.outside[0] === 'yes'));
  if (q.search) {
    const term = q.search.replace(/^#/, '').trim();
    const p = likePattern(term);
    const codeP = likePattern(normalizeCode(term));
    const seesClient = can(role, 'canSeeClient');
    const parts: (SQL | undefined)[] = [
      seesClient ? sql`${customers.name} LIKE ${p} ESCAPE '\\'` : undefined,
      seesClient ? sql`${customerBrokers.name} LIKE ${p} ESCAPE '\\'` : undefined,
      // Sprint 18: the outside order's party name.
      seesClient ? sql`${orders.outsidePartyName} LIKE ${p} ESCAPE '\\'` : undefined,
      sql`${materials.name} LIKE ${p} ESCAPE '\\'`,
      sql`${designs.code} LIKE ${codeP} ESCAPE '\\'`,
    ];
    if (/^\d+(\.\d+)?$/.test(term)) {
      if (/^\d+$/.test(term)) parts.push(eq(orders.orderNo, Number(term)));
      parts.push(sql`CAST(${orders.quantity} AS TEXT) LIKE ${likePattern(term, 'prefix')} ESCAPE '\\'`);
    }
    // Sprint 16: a weaver's taka number (the physical taka may carry only that) and PO numbers.
    if (/^\d+([-/]\d+)*[A-Z]?$/i.test(term)) {
      parts.push(sql`EXISTS (SELECT 1 FROM takas wt WHERE wt.is_deleted = 0 AND COALESCE(wt.allocated_order_id, wt.order_id) = "orders"."id" AND wt.weaver_taka_no = ${term.toUpperCase()})`);
    } else if (/^[A-Z]{1,4}\d+([-/]\d+)*[A-Z]?$/i.test(term)) {
      // "S1101": an outside taka's system number (weaver code + number).
      parts.push(sql`EXISTS (SELECT 1 FROM takas wt WHERE wt.is_deleted = 0 AND COALESCE(wt.allocated_order_id, wt.order_id) = "orders"."id" AND wt.taka_no = ${term.toUpperCase()})`);
    }
    const poNo = parsePoNo(term);
    if (poNo !== null && /^po/i.test(term)) parts.push(sql`EXISTS (SELECT 1 FROM outside_pos op WHERE op.order_id = "orders"."id" AND op.po_no = ${poNo})`);
    conditions.push(or(...parts));
  }
  const where = and(...conditions);

  const [items, [{ total }]] = await db.batch([
    db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        customerName: customers.name,
        materialName: materials.name,
        quantity: orders.quantity,
        unit: orders.unit,
        orderType: orders.orderType,
        blouseOption: orders.blouseOption,
        brokerName: customerBrokers.name,
        status: orders.status,
        isOnHold: orders.isOnHold,
        orderDate: orders.orderDate,
        designCode: designs.code,
        designThumbUrl: designs.thumbUrl,
        isOutsideOrder: orders.isOutsideOrder,
        outsidePartyName: orders.outsidePartyName,
        hasProduction: orders.hasProduction,
        hasButta: orders.hasButta,
        hasMill: orders.hasMill,
        isClosed: orders.isClosed,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(customerBrokers, eq(customerBrokers.id, orders.brokerId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .where(where)
      .orderBy(desc(orders.orderNo))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db
      .select({ total: count() })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(customerBrokers, eq(customerBrokers.id, orders.brokerId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .where(where),
  ]);
  // Roles without `canSeeClient` (the supervisor) never get client, broker or outside party names.
  const hideClient = !can(role, 'canSeeClient');
  const shown = hideClient ? items.map((i) => ({ ...i, customerName: '', brokerName: null, outsidePartyName: null })) : items;
  return { items: shown, page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

export async function getOrder(role: RoleKey, id: number): Promise<OrderDetail> {
  const [rows, noteImages, history] = await db.batch([
    db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        status: orders.status,
        orderType: orders.orderType,
        blouseOption: orders.blouseOption,
        quantity: orders.quantity,
        unit: orders.unit,
        rate: orders.rate,
        orderDate: orders.orderDate,
        notes: orders.notes,
        sentToProductionAt: orders.sentToProductionAt,
        jobsheetCount: sql<number>`(SELECT COUNT(*) FROM jobsheets j WHERE j.order_id = "orders"."id" AND j.is_deleted = 0 AND j.is_external = 0)`,
        jobsheetPieces: liveJobsheetPieces,
        jobsheetMeters: liveJobsheetClothMeters,
        isOnHold: orders.isOnHold,
        heldAt: orders.heldAt,
        holdNote: orders.holdNote,
        hasProduction: orders.hasProduction,
        hasButta: orders.hasButta,
        hasMill: orders.hasMill,
        isClosed: orders.isClosed,
        closedAt: orders.closedAt,
        closeNote: orders.closeNote,
        outsidePoCount: sql<number>`(SELECT COUNT(*) FROM outside_pos p WHERE p.order_id = "orders"."id" AND p.status <> 'cancelled')`,
        receiptCount: sql<number>`(SELECT COUNT(*) FROM outside_receipts r WHERE r.order_id = "orders"."id")`,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customer: { id: customers.id, name: customers.name, phone: customers.phone, city: customers.city },
        brokerId: customerBrokers.id,
        brokerName: customerBrokers.name,
        material: { id: materials.id, name: materials.name, code: materials.code },
        designId: designs.id,
        designCode: designs.code,
        designName: designs.name,
        designImageUrl: designs.imageUrl,
        designThumbUrl: designs.thumbUrl,
        isOutsideOrder: orders.isOutsideOrder,
        outsidePartyName: orders.outsidePartyName,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      // The broker stays on the order even after it was removed from the customer.
      .leftJoin(customerBrokers, eq(customerBrokers.id, orders.brokerId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .where(eq(orders.id, id)),
    db
      .select({ id: orderNoteImages.id, imageUrl: orderNoteImages.imageUrl, thumbUrl: orderNoteImages.thumbUrl })
      .from(orderNoteImages)
      .where(eq(orderNoteImages.orderId, id))
      .orderBy(asc(orderNoteImages.id)),
    db
      .select({
        id: orderStatusHistory.id,
        fromStatus: orderStatusHistory.fromStatus,
        toStatus: orderStatusHistory.toStatus,
        role: orderStatusHistory.role,
        changedAt: orderStatusHistory.changedAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, id))
      .orderBy(asc(orderStatusHistory.changedAt), asc(orderStatusHistory.id)),
  ]);

  const r = rows[0];
  // Orders in statuses the role can't see behave as if they don't exist.
  if (!r || !canRoleSeeStatus(role, r.status)) throw notFound('Order');
  assertOrderVisibleFor(role, r);
  // Sprint 16: the supervisor's Orders are production orders only.
  if (productionOnly(role) && !r.hasProduction) throw notFound('Order');
  const steps = { hasProduction: r.hasProduction, hasButta: r.hasButta, hasMill: r.hasMill };

  const detail: OrderDetail = {
    id: r.id,
    orderNo: r.orderNo,
    status: r.status,
    orderType: r.orderType,
    blouseOption: r.blouseOption,
    quantity: r.quantity,
    unit: r.unit,
    orderDate: r.orderDate,
    notes: r.notes,
    sentToProductionAt: r.sentToProductionAt,
    jobsheetCount: Number(r.jobsheetCount),
    jobsheetPieces: Number(r.jobsheetPieces),
    jobsheetMeters: Number(r.jobsheetMeters),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    customer: can(role, 'canSeeClient') ? r.customer : { id: r.customer.id, name: '', phone: null, city: null },
    broker: can(role, 'canSeeClient') && r.brokerId !== null && r.brokerName !== null ? { id: r.brokerId, name: r.brokerName } : null,
    material: r.material,
    design:
      r.designId !== null && r.designCode !== null
        ? { id: r.designId, code: r.designCode, name: r.designName, imageUrl: r.designImageUrl, thumbUrl: r.designThumbUrl }
        : null,
    isOutsideOrder: r.isOutsideOrder,
    outsidePartyName: can(role, 'canSeeClient') ? r.outsidePartyName : null,
    noteImages,
    history,
    isOnHold: r.isOnHold,
    heldAt: r.heldAt,
    holdNote: r.holdNote,
    holdEvents: await listHoldEvents(r.id),
    // Sprint 13: what came back from the customer (only orders that ended up Returned need it).
    returned: r.status === 'returned' ? await getOrderReturnSummary(r.id) : null,
    ...steps,
    kind: orderKind(steps),
    stepLocks: can(role, 'canEditOrderSteps') ? await stepLocksOf(db, r.id) : { production: null, butta: null, mill: null },
    outsidePoCount: Number(r.outsidePoCount),
    receiptCount: Number(r.receiptCount),
    isClosed: r.isClosed,
    closedAt: r.closedAt,
    closeNote: r.closeNote,
    orderEvents: await listOrderEvents(r.id),
  };
  if (can(role, 'canSeeRate')) detail.rate = r.rate;
  return detail;
}

/** Sprint 16: the "Steps changed" / "Order closed" History entries, oldest first. */
async function listOrderEvents(orderId: number): Promise<OrderEventEntry[]> {
  return db
    .select({ id: orderEvents.id, event: orderEvents.event, note: orderEvents.note, role: orderEvents.role, userName: users.name, createdAt: orderEvents.createdAt })
    .from(orderEvents)
    .leftJoin(users, eq(users.id, orderEvents.userId))
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
}

type OrderData = Pick<z.infer<typeof orderCreateSchema>, 'customerId' | 'brokerId' | 'materialId' | 'designId' | 'newDesign'>;

/**
 * Checks the client / broker / material / design references of an order form and returns the design id (a design
 * uploaded from the form is saved into the Design Master here, in the order's quality). Shared by create and update.
 * `keepBrokerId` = the order's current broker, which may stay even if it was removed from the customer since.
 */
async function resolveOrderRefs(tx: Tx, data: OrderData, keepBrokerId: number | null = null): Promise<{ designId: number | null }> {
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, data.customerId), eq(customers.isDeleted, false)));
  const [material] = await tx
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.id, data.materialId), eq(materials.isDeleted, false)));
  if (!customer) throw badRequest('Selected client no longer exists', 'customerId');
  if (!material) throw badRequest('Selected material no longer exists', 'materialId');
  if (data.brokerId) {
    // The broker must be one of this client's brokers (an already-saved, since removed broker may stay).
    const [broker] = await tx
      .select({ id: customerBrokers.id, isDeleted: customerBrokers.isDeleted })
      .from(customerBrokers)
      .where(and(eq(customerBrokers.id, data.brokerId), eq(customerBrokers.customerId, data.customerId)));
    if (!broker || (broker.isDeleted && broker.id !== keepBrokerId)) {
      throw badRequest('Pick one of this client’s brokers', 'brokerId');
    }
  }

  let designId = data.designId;
  if (designId) {
    const [design] = await tx
      .select({ id: designs.id })
      .from(designs)
      .where(and(eq(designs.id, designId), eq(designs.isDeleted, false)));
    if (!design) throw badRequest('Selected design no longer exists', 'designId');
  } else if (data.newDesign) {
    // A design uploaded from the order form is saved into the Design Master, in the order's quality.
    const created = await insertDesignFromOrder(tx, data.newDesign, data.materialId);
    designId = created.id;
  }
  return { designId };
}

export async function createOrder(role: RoleKey, input: unknown): Promise<{ id: number; orderNo: number }> {
  const data = orderCreateSchema.parse(input);

  return db.transaction(async (tx) => {
    const { designId } = await resolveOrderRefs(tx, data);

    // Order number is assigned inside the write transaction, never by the client.
    const [order] = await tx
      .insert(orders)
      .values({
        orderNo: sql`(SELECT COALESCE(MAX(${orders.orderNo}), 0) + 1 FROM ${orders})`,
        customerId: data.customerId,
        brokerId: data.brokerId,
        orderType: data.orderType,
        blouseOption: data.blouseOption,
        isOutsideOrder: data.isOutsideOrder,
        outsidePartyName: data.isOutsideOrder ? data.outsidePartyName : null,
        materialId: data.materialId,
        designId,
        quantity: data.quantity,
        unit: data.unit,
        rate: data.rate,
        orderDate: data.orderDate,
        notes: data.notes,
        status: STATUS.PENDING_PRODUCTION,
        // Sprint 16: the steps that happen in our system (all three on a new order unless unticked).
        hasProduction: data.hasProduction,
        hasButta: data.hasButta,
        hasMill: data.hasMill,
      })
      .returning({ id: orders.id, orderNo: orders.orderNo });

    if (data.noteImages.length) {
      await tx
        .insert(orderNoteImages)
        .values(data.noteImages.map((img) => ({ orderId: order.id, imageUrl: img.url, thumbUrl: img.thumbUrl })));
    }
    await tx
      .insert(orderStatusHistory)
      .values({ orderId: order.id, fromStatus: null, toStatus: STATUS.PENDING_PRODUCTION, role, userId: currentUserId() });
    return order;
  });
}

/**
 * Sprint 19: the unit is locked once the order has jobsheets, takas, or outside POs — extends the old
 * "jobsheets only" rule (kg/g orders could otherwise flip units after a PO or an FG receipt gave them takas).
 */
async function hasUnitLockingHistory(tx: Tx, orderId: number): Promise<boolean> {
  if ((await countActiveJobsheets(tx, orderId)) > 0) return true;
  const [takaRow] = await tx
    .select({ id: takas.id })
    .from(takas)
    .where(and(eq(takas.orderId, orderId), eq(takas.isDeleted, false)))
    .limit(1);
  if (takaRow) return true;
  const [poRow] = await tx.select({ id: outsidePos.id }).from(outsidePos).where(eq(outsidePos.orderId, orderId)).limit(1);
  return !!poRow;
}

/**
 * Edits an order the role can see (status unchanged). The unit is locked once the order has jobsheets, takas or
 * outside POs; note images are replaced by the submitted set; a role without `canSeeRate` keeps the stored rate.
 */
export async function updateOrder(role: RoleKey, id: number, input: unknown): Promise<OrderDetail> {
  const data = orderUpdateSchema.parse(input);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        status: orders.status,
        unit: orders.unit,
        rate: orders.rate,
        brokerId: orders.brokerId,
        hasProduction: orders.hasProduction,
        hasButta: orders.hasButta,
        hasMill: orders.hasMill,
      })
      .from(orders)
      .where(eq(orders.id, id));
    if (!current || !canRoleSeeStatus(role, current.status)) throw notFound('Order');
    // Sprint 16: the steps change only when they are sent, and only for a role that may change them.
    if (can(role, 'canEditOrderSteps') && (data.hasProduction !== undefined || data.hasButta !== undefined || data.hasMill !== undefined)) {
      await applyStepsChange(tx, role, id, current, {
        hasProduction: data.hasProduction ?? current.hasProduction,
        hasButta: data.hasButta ?? current.hasButta,
        hasMill: data.hasMill ?? current.hasMill,
      });
    }
    if (data.unit !== current.unit && (await hasUnitLockingHistory(tx, id))) {
      throw badRequest('The unit cannot change once the order has jobsheets, takas or outside POs', 'unit');
    }

    const { designId } = await resolveOrderRefs(tx, data, current.brokerId);
    await tx
      .update(orders)
      .set({
        customerId: data.customerId,
        brokerId: data.brokerId,
        orderType: data.orderType,
        blouseOption: data.blouseOption,
        isOutsideOrder: data.isOutsideOrder,
        outsidePartyName: data.isOutsideOrder ? data.outsidePartyName : null,
        materialId: data.materialId,
        designId,
        // DEPRECATED column: always NULL since Sprint 18.
        variationId: null,
        quantity: data.quantity,
        unit: data.unit,
        rate: can(role, 'canSeeRate') ? data.rate : current.rate,
        orderDate: data.orderDate,
        notes: data.notes,
      })
      .where(eq(orders.id, id));

    await tx.delete(orderNoteImages).where(eq(orderNoteImages.orderId, id));
    if (data.noteImages.length) {
      await tx
        .insert(orderNoteImages)
        .values(data.noteImages.map((img) => ({ orderId: id, imageUrl: img.url, thumbUrl: img.thumbUrl })));
    }
  });
  return getOrder(role, id);
}

async function changeStatus(
  role: RoleKey,
  orderIds: number[],
  from: OrderStatusKey,
  to: OrderStatusKey,
  sentToProductionAt: string | null,
): Promise<number[]> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({ status: to, sentToProductionAt })
      .where(and(inArray(orders.id, orderIds), eq(orders.status, from)))
      .returning({ id: orders.id });
    if (updated.length) {
      const changedAt = new Date().toISOString();
      await tx
        .insert(orderStatusHistory)
        .values(updated.map((o) => ({ orderId: o.id, fromStatus: from, toStatus: to, role, userId: currentUserId(), changedAt })));
    }
    return updated.map((o) => o.id);
  });
}

/**
 * Only orders that are currently Pending for production are affected. Sprint 16: an order without Production then moves
 * straight on to its own first status (At outside weaver / Awaiting goods) — the same recompute as every other write.
 */
export async function sendToProduction(role: RoleKey, orderIds: number[]): Promise<SendToProductionResult> {
  const ids = [...new Set(orderIds)];
  const updated = await changeStatus(
    role,
    ids,
    STATUS.PENDING_PRODUCTION,
    STATUS.READY_PRODUCTION,
    new Date().toISOString(),
  );
  if (updated.length === 0) {
    throw conflict('None of the selected orders are pending for production any more. Refresh and try again.');
  }
  await db.transaction(async (tx) => {
    for (const id of updated) await recomputeOrderStatus(id, role, tx);
  });
  return { updated: updated.length, orderIds: updated };
}

/** Sprint 16: the first status after "sent for production", by kind — where Undo send for production is possible. */
const UNDOABLE: readonly OrderStatusKey[] = [STATUS.READY_PRODUCTION, STATUS.OUTSIDE_PRODUCTION, STATUS.AWAITING_GOODS];

export async function undoSendToProduction(role: RoleKey, id: number): Promise<void> {
  const [order] = await db
    .select({
      status: orders.status,
      pos: sql<number>`(SELECT COUNT(*) FROM outside_pos p WHERE p.order_id = "orders"."id" AND p.status <> 'cancelled')`,
      takas: sql<number>`(SELECT COUNT(*) FROM takas t WHERE t.is_deleted = 0 AND (t.order_id = "orders"."id" OR t.allocated_order_id = "orders"."id"))`,
    })
    .from(orders)
    .where(eq(orders.id, id));
  if (!order) throw notFound('Order');
  if (!UNDOABLE.includes(order.status)) {
    throw conflict('Only orders in Jobsheet pending (or waiting for outside goods with nothing placed yet) can be moved back.');
  }
  if ((await countActiveJobsheets(db, id)) > 0) {
    throw conflict('This order already has jobsheets. Delete its jobsheets before moving it back to Pending.');
  }
  if (Number(order.pos) > 0) throw conflict('This order already has outside POs. Cancel them before moving it back to Pending.');
  // (Jobsheet pending keeps the old rule; an outside / FG order with goods already received can't go back.)
  if (order.status !== STATUS.READY_PRODUCTION && Number(order.takas) > 0) throw conflict('This order already has takas, so it can no longer be moved back to Pending.');
  const updated = await changeStatus(role, [id], order.status, STATUS.PENDING_PRODUCTION, null);
  if (updated.length === 0) throw conflict('This order was changed by someone else. Refresh and try again.');
}

/** Distinct designs used in a client's earlier orders (the latest order of each), most recent first. */
export async function previousDesigns(customerId: number): Promise<PreviousDesign[]> {
  const rows = await db
    .select({
      designId: designs.id,
      code: designs.code,
      imageUrl: designs.imageUrl,
      thumbUrl: designs.thumbUrl,
      orderId: orders.id,
      orderNo: orders.orderNo,
      orderDate: orders.orderDate,
      notes: orders.notes,
      qualitiesJson: designQualitiesJson,
      timesUsed: sql<number>`(SELECT COUNT(*) FROM ${orders} o3 WHERE o3.customer_id = ${orders.customerId} AND o3.design_id = ${orders.designId})`,
    })
    .from(orders)
    .innerJoin(designs, and(eq(designs.id, orders.designId), eq(designs.isDeleted, false)))
    .where(
      and(
        eq(orders.customerId, customerId),
        // keep only the latest order for each design
        sql`${orders.orderNo} = (SELECT MAX(o2.order_no) FROM ${orders} o2 WHERE o2.customer_id = ${orders.customerId} AND o2.design_id = ${orders.designId})`,
      ),
    )
    .orderBy(desc(orders.orderNo))
    .limit(60);

  return rows.map(({ qualitiesJson, ...r }) => ({
    ...r,
    key: String(r.designId),
    timesUsed: Number(r.timesUsed),
    qualities: parseQualities(qualitiesJson),
  }));
}
