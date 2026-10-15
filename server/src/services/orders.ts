import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { currentUserId } from '../lib/request-context';
import { z } from 'zod';
import {
  can,
  canRoleSeeStatus,
  isOrderType,
  isStatusKey,
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
  designVariations,
  designs,
  materials,
  orderNoteImages,
  orderStatusHistory,
  orders,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { csv, likePattern, paginationSchema } from '../lib/http';
import { insertDesign } from './designs';
import { countActiveJobsheets } from './jobsheets';
import { getOrderReturnSummary } from './dispatch';

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
  from: dateString,
  to: dateString,
});
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

  const conditions: (SQL | undefined)[] = [inArray(orders.status, statuses)];
  if (q.from) conditions.push(gte(orders.orderDate, q.from));
  if (q.to) conditions.push(lte(orders.orderDate, q.to));
  if (q.material.length) conditions.push(inArray(orders.materialId, q.material));
  if (q.type.length) conditions.push(inArray(orders.orderType, q.type));
  if (q.party.length && can(role, 'canSeeClient')) conditions.push(inArray(orders.customerId, q.party));
  if (q.search) {
    const term = q.search.replace(/^#/, '').trim();
    const p = likePattern(term);
    const codeP = likePattern(normalizeCode(term));
    const seesClient = can(role, 'canSeeClient');
    const parts: (SQL | undefined)[] = [
      seesClient ? sql`${customers.name} LIKE ${p} ESCAPE '\\'` : undefined,
      seesClient ? sql`${customerBrokers.name} LIKE ${p} ESCAPE '\\'` : undefined,
      sql`${materials.name} LIKE ${p} ESCAPE '\\'`,
      sql`${designs.code} LIKE ${codeP} ESCAPE '\\'`,
      sql`${designVariations.code} LIKE ${codeP} ESCAPE '\\'`,
    ];
    if (/^\d+(\.\d+)?$/.test(term)) {
      if (/^\d+$/.test(term)) parts.push(eq(orders.orderNo, Number(term)));
      parts.push(sql`CAST(${orders.quantity} AS TEXT) LIKE ${likePattern(term, 'prefix')} ESCAPE '\\'`);
    }
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
        orderDate: orders.orderDate,
        designCode: sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`,
        designThumbUrl: sql<string | null>`COALESCE(${designVariations.thumbUrl}, ${designs.thumbUrl})`,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(customerBrokers, eq(customerBrokers.id, orders.brokerId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
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
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(where),
  ]);
  // Roles without `canSeeClient` (the supervisor) never get client or broker names.
  const hideClient = !can(role, 'canSeeClient');
  const shown = hideClient ? items.map((i) => ({ ...i, customerName: '', brokerName: null })) : items;
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
        jobsheetCount: sql<number>`(SELECT COUNT(*) FROM jobsheets j WHERE j.order_id = "orders"."id" AND j.is_deleted = 0)`,
        jobsheetPieces: orders.jobsheetPieces,
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
        variationId: designVariations.id,
        variationCode: designVariations.code,
        variationImageUrl: designVariations.imageUrl,
        variationThumbUrl: designVariations.thumbUrl,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      // The broker stays on the order even after it was removed from the customer.
      .leftJoin(customerBrokers, eq(customerBrokers.id, orders.brokerId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
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
    jobsheetPieces: r.jobsheetPieces,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    customer: can(role, 'canSeeClient') ? r.customer : { id: r.customer.id, name: '', phone: null, city: null },
    broker: can(role, 'canSeeClient') && r.brokerId !== null && r.brokerName !== null ? { id: r.brokerId, name: r.brokerName } : null,
    material: r.material,
    design:
      r.designId !== null && r.designCode !== null
        ? { id: r.designId, code: r.designCode, name: r.designName, imageUrl: r.designImageUrl, thumbUrl: r.designThumbUrl }
        : null,
    variation:
      r.variationId !== null && r.variationCode !== null
        ? { id: r.variationId, code: r.variationCode, imageUrl: r.variationImageUrl, thumbUrl: r.variationThumbUrl }
        : null,
    noteImages,
    history,
    // Sprint 13: what came back from the customer (only orders that ended up Returned need it).
    returned: r.status === 'returned' ? await getOrderReturnSummary(r.id) : null,
  };
  if (can(role, 'canSeeRate')) detail.rate = r.rate;
  return detail;
}

type OrderData = z.infer<typeof orderCreateSchema>;

/**
 * Checks the client / broker / material / design references of an order form and returns the design + variation
 * ids (a design uploaded from the form is saved into the Design Master here). Shared by create and update.
 * `keepBrokerId` = the order's current broker, which may stay even if it was removed from the customer since.
 */
async function resolveOrderRefs(
  tx: Tx,
  data: OrderData,
  keepBrokerId: number | null = null,
): Promise<{ designId: number | null; variationId: number | null }> {
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
  let variationId = data.variationId;
  if (designId) {
    const [design] = await tx
      .select({ id: designs.id })
      .from(designs)
      .where(and(eq(designs.id, designId), eq(designs.isDeleted, false)));
    if (!design) throw badRequest('Selected design no longer exists', 'designId');
    if (variationId) {
      const [variation] = await tx
        .select({ id: designVariations.id })
        .from(designVariations)
        .where(and(eq(designVariations.id, variationId), eq(designVariations.designId, designId)));
      if (!variation) throw badRequest('Selected variation no longer exists', 'variationId');
    }
  } else if (data.newDesign) {
    // A design uploaded from the order form is saved into the Design Master.
    const created = await insertDesign(
      tx,
      {
        code: data.newDesign.code,
        imageUrl: data.newDesign.imageUrl,
        thumbUrl: data.newDesign.thumbUrl,
        buttaCutting: data.newDesign.buttaCutting,
      },
      'designCode',
    );
    designId = created.id;
    variationId = null;
  }
  return { designId, variationId };
}

export async function createOrder(role: RoleKey, input: unknown): Promise<{ id: number; orderNo: number }> {
  const data = orderCreateSchema.parse(input);

  return db.transaction(async (tx) => {
    const { designId, variationId } = await resolveOrderRefs(tx, data);

    // Order number is assigned inside the write transaction, never by the client.
    const [order] = await tx
      .insert(orders)
      .values({
        orderNo: sql`(SELECT COALESCE(MAX(${orders.orderNo}), 0) + 1 FROM ${orders})`,
        customerId: data.customerId,
        brokerId: data.brokerId,
        orderType: data.orderType,
        blouseOption: data.blouseOption,
        materialId: data.materialId,
        designId,
        variationId,
        quantity: data.quantity,
        unit: data.unit,
        rate: data.rate,
        orderDate: data.orderDate,
        notes: data.notes,
        status: STATUS.PENDING_PRODUCTION,
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
 * Edits an order the role can see (status unchanged). The unit is locked once the order has jobsheets;
 * note images are replaced by the submitted set; a role without `canSeeRate` keeps the stored rate.
 */
export async function updateOrder(role: RoleKey, id: number, input: unknown): Promise<OrderDetail> {
  const data = orderUpdateSchema.parse(input);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: orders.status, unit: orders.unit, rate: orders.rate, brokerId: orders.brokerId })
      .from(orders)
      .where(eq(orders.id, id));
    if (!current || !canRoleSeeStatus(role, current.status)) throw notFound('Order');
    if (data.unit !== current.unit && (await countActiveJobsheets(tx, id)) > 0) {
      throw badRequest('The unit cannot change once the order has jobsheets', 'unit');
    }

    const { designId, variationId } = await resolveOrderRefs(tx, data, current.brokerId);
    await tx
      .update(orders)
      .set({
        customerId: data.customerId,
        brokerId: data.brokerId,
        orderType: data.orderType,
        blouseOption: data.blouseOption,
        materialId: data.materialId,
        designId,
        variationId,
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

/** Only orders that are currently Pending for production are affected. */
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
  return { updated: updated.length, orderIds: updated };
}

export async function undoSendToProduction(role: RoleKey, id: number): Promise<void> {
  const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id));
  if (!order) throw notFound('Order');
  if (order.status !== STATUS.READY_PRODUCTION) {
    throw conflict('Only orders in Jobsheet pending can be moved back.');
  }
  if ((await countActiveJobsheets(db, id)) > 0) {
    throw conflict('This order already has jobsheets. Delete its jobsheets before moving it back to Pending.');
  }
  const updated = await changeStatus(role, [id], STATUS.READY_PRODUCTION, STATUS.PENDING_PRODUCTION, null);
  if (updated.length === 0) throw conflict('This order was changed by someone else. Refresh and try again.');
}

/** Distinct design / variation combinations used in a client's earlier orders, most recent first. */
export async function previousDesigns(customerId: number): Promise<PreviousDesign[]> {
  const rows = await db
    .select({
      designId: designs.id,
      variationId: designVariations.id,
      designCode: designs.code,
      variationCode: designVariations.code,
      designImageUrl: designs.imageUrl,
      designThumbUrl: designs.thumbUrl,
      variationImageUrl: designVariations.imageUrl,
      variationThumbUrl: designVariations.thumbUrl,
      orderId: orders.id,
      orderNo: orders.orderNo,
      orderDate: orders.orderDate,
      notes: orders.notes,
      materialId: materials.id,
      materialName: materials.name,
      timesUsed: sql<number>`(SELECT COUNT(*) FROM ${orders} o3 WHERE o3.customer_id = ${orders.customerId} AND o3.design_id = ${orders.designId} AND o3.variation_id IS ${orders.variationId})`,
    })
    .from(orders)
    .innerJoin(designs, and(eq(designs.id, orders.designId), eq(designs.isDeleted, false)))
    .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
    .leftJoin(materials, and(eq(materials.id, designs.materialId), eq(materials.isDeleted, false)))
    .where(
      and(
        eq(orders.customerId, customerId),
        // keep only the latest order for each design/variation pair
        sql`${orders.orderNo} = (SELECT MAX(o2.order_no) FROM ${orders} o2 WHERE o2.customer_id = ${orders.customerId} AND o2.design_id = ${orders.designId} AND o2.variation_id IS ${orders.variationId})`,
      ),
    )
    .orderBy(desc(orders.orderNo))
    .limit(60);

  return rows.map((r) => ({
    key: `${r.designId}-${r.variationId ?? 0}`,
    designId: r.designId,
    variationId: r.variationId,
    code: r.variationCode ?? r.designCode,
    imageUrl: r.variationImageUrl ?? r.designImageUrl,
    thumbUrl: r.variationThumbUrl ?? r.designThumbUrl,
    orderId: r.orderId,
    orderNo: r.orderNo,
    orderDate: r.orderDate,
    notes: r.notes,
    timesUsed: Number(r.timesUsed),
    material: r.materialId !== null && r.materialName !== null ? { id: r.materialId, name: r.materialName } : null,
  }));
}
