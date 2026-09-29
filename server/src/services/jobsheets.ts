import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  canRoleSeeStatus,
  coverageWarnings,
  isReadyOrLater,
  jobsheetGenerateSchema,
  jobsheetSingleSchema,
  jobsheetUpdateSchema,
  MAX_JOBSHEETS_PER_RUN,
  planFramesEdit,
  planJobsheets,
  STATUS,
  type Coverage,
  type JobsheetCreateResult,
  type JobsheetDeleteResult,
  type JobsheetDetail,
  type JobsheetListItem,
  type JobsheetMachine,
  type JobsheetPrintItem,
  type JobsheetRef,
  type JobsheetUpdateResult,
  type OrderJobsheets,
  type OrderStatusKey,
  type RoleKey,
  type Unit,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  counters,
  customers,
  designVariations,
  designs,
  jobsheetMachines,
  jobsheets,
  machines,
  materials,
  orderStatusHistory,
  orders,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';

const JOBSHEET_COUNTER = 'jobsheet_no';

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

interface OrderPlanRow {
  id: number;
  orderNo: number;
  status: OrderStatusKey;
  unit: Unit;
  quantity: number;
  jobsheetPieces: number;
  targetFrames: number;
  framesPerJobsheet: number | null;
}

const orderPlanColumns = {
  id: orders.id,
  orderNo: orders.orderNo,
  status: orders.status,
  unit: orders.unit,
  quantity: orders.quantity,
  jobsheetPieces: orders.jobsheetPieces,
  targetFrames: orders.targetFrames,
  framesPerJobsheet: orders.framesPerJobsheet,
};

/** The order, or 404 if it doesn't exist or its status isn't visible for the role. */
async function loadVisibleOrder(tx: DbOrTx, role: RoleKey, orderId: number): Promise<OrderPlanRow> {
  const [order] = await tx.select(orderPlanColumns).from(orders).where(eq(orders.id, orderId));
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');
  return order;
}

function assertJobsheetsAllowed(order: OrderPlanRow) {
  if (order.unit !== 'pcs') {
    throw conflict('Jobsheets are only available for orders in pcs for now (kg / g / meter orders are coming soon).');
  }
  if (!isReadyOrLater(order.status)) {
    throw conflict('Jobsheets can only be created once the order is Ready for production.');
  }
}

/** Every machine must exist, not be deleted, and be active (unless it is already assigned — `keep`). */
async function assertMachines(tx: DbOrTx, ids: number[], keep: number[] = []) {
  const rows = await tx
    .select({ id: machines.id, machineNo: machines.machineNo, isActive: machines.isActive, isDeleted: machines.isDeleted })
    .from(machines)
    .where(inArray(machines.id, ids));
  const byId = new Map(rows.map((m) => [m.id, m]));
  for (const id of ids) {
    const m = byId.get(id);
    if (!m || m.isDeleted) throw conflict('A selected machine no longer exists. Refresh and pick again.', 'machineIds');
    if (!m.isActive && !keep.includes(id)) {
      throw conflict(`Machine ${m.machineNo} is inactive. Pick an active machine.`, 'machineIds');
    }
  }
}

/** Reserves `n` jobsheet numbers inside the transaction. Numbers are never handed out twice. */
async function allocateJobsheetNumbers(tx: Tx, n: number): Promise<number[]> {
  const [row] = await tx
    .insert(counters)
    .values({ name: JOBSHEET_COUNTER, value: n })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + ${n}` } })
    .returning({ value: counters.value });
  const first = row.value - n + 1;
  return Array.from({ length: n }, (_, i) => first + i);
}

async function insertJobsheets(
  tx: Tx,
  role: RoleKey,
  orderId: number,
  frames: number[],
  picks: string | null,
  machineIds: number[],
): Promise<JobsheetRef[]> {
  if (frames.length === 0) return [];
  const numbers = await allocateJobsheetNumbers(tx, frames.length);
  const created = await tx
    .insert(jobsheets)
    .values(frames.map((f, i) => ({ jobsheetNo: numbers[i], orderId, frames: f, picks, createdBy: role })))
    .returning({ id: jobsheets.id, jobsheetNo: jobsheets.jobsheetNo, frames: jobsheets.frames });
  if (machineIds.length) {
    await tx
      .insert(jobsheetMachines)
      .values(created.flatMap((j) => machineIds.map((machineId) => ({ jobsheetId: j.id, machineId }))));
  }
  return created.sort((a, b) => a.jobsheetNo - b.jobsheetNo);
}

async function writeStatus(tx: Tx, role: RoleKey, orderId: number, from: OrderStatusKey, to: OrderStatusKey) {
  const updated = await tx
    .update(orders)
    .set({ status: to })
    .where(and(eq(orders.id, orderId), eq(orders.status, from)))
    .returning({ id: orders.id });
  if (updated.length) {
    await tx.insert(orderStatusHistory).values({ orderId, fromStatus: from, toStatus: to, role, changedAt: new Date().toISOString() });
  }
  return updated.length > 0;
}

async function activeJobsheets(tx: DbOrTx, orderId: number) {
  return tx
    .select({ id: jobsheets.id, jobsheetNo: jobsheets.jobsheetNo, frames: jobsheets.frames, picks: jobsheets.picks })
    .from(jobsheets)
    .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false)))
    .orderBy(asc(jobsheets.jobsheetNo));
}

function coverageOf(order: Pick<OrderPlanRow, 'quantity' | 'jobsheetPieces' | 'targetFrames'>, frames: number[]): Coverage {
  return {
    orderedPieces: order.quantity,
    jobsheetPieces: order.jobsheetPieces,
    targetFrames: order.targetFrames,
    totalFrames: frames.reduce((s, f) => s + f, 0),
    jobsheetCount: frames.length,
  };
}

/** Rows of (jobsheet, machine) → machines per jobsheet id. */
function groupMachines(rows: { jobsheetId: number; machine: JobsheetMachine }[]) {
  const map = new Map<number, JobsheetMachine[]>();
  for (const r of rows) {
    const list = map.get(r.jobsheetId);
    if (list) list.push(r.machine);
    else map.set(r.jobsheetId, [r.machine]);
  }
  return map;
}

const machineColumns = {
  jobsheetId: jobsheetMachines.jobsheetId,
  machine: { id: machines.id, machineNo: machines.machineNo, name: machines.name, isActive: machines.isActive },
};

/* ------------------------------------------------------------------ */
/* create                                                               */
/* ------------------------------------------------------------------ */

/** 7.1 — a whole multi-jobsheet run in one transaction. */
export async function generateJobsheets(role: RoleKey, orderId: number, input: unknown): Promise<JobsheetCreateResult> {
  const data = jobsheetGenerateSchema.parse(input);
  const plan = planJobsheets(data.pieces, data.framesPerJobsheet);
  if (!plan) throw badRequest('Enter whole numbers of at least 1');
  if (plan.jobsheetCount > MAX_JOBSHEETS_PER_RUN) {
    throw badRequest(
      `This would create ${plan.jobsheetCount} jobsheets (max ${MAX_JOBSHEETS_PER_RUN}). Increase the frames per jobsheet.`,
      'framesPerJobsheet',
    );
  }

  return db.transaction(async (tx) => {
    const order = await loadVisibleOrder(tx, role, orderId);
    assertJobsheetsAllowed(order);
    await assertMachines(tx, data.machineIds);
    const created = await insertJobsheets(tx, role, orderId, plan.frames, data.picks, data.machineIds);
    await tx
      .update(orders)
      .set({
        jobsheetPieces: sql`${orders.jobsheetPieces} + ${data.pieces}`,
        targetFrames: sql`${orders.targetFrames} + ${plan.totalFrames}`,
        framesPerJobsheet: data.framesPerJobsheet,
      })
      .where(eq(orders.id, orderId));
    const statusChanged =
      order.status === STATUS.READY_PRODUCTION &&
      (await writeStatus(tx, role, orderId, STATUS.READY_PRODUCTION, STATUS.JOBSHEET_CREATED));
    return { created, statusChanged };
  });
}

/** 7.2 — exactly one jobsheet. */
export async function addSingleJobsheet(role: RoleKey, orderId: number, input: unknown): Promise<JobsheetCreateResult> {
  const data = jobsheetSingleSchema.parse(input);
  return db.transaction(async (tx) => {
    const order = await loadVisibleOrder(tx, role, orderId);
    assertJobsheetsAllowed(order);
    await assertMachines(tx, data.machineIds);
    const created = await insertJobsheets(tx, role, orderId, [data.frames], data.picks, data.machineIds);
    await tx
      .update(orders)
      .set({
        jobsheetPieces: sql`${orders.jobsheetPieces} + ${data.pieces}`,
        targetFrames: sql`${orders.targetFrames} + ${data.frames}`,
      })
      .where(eq(orders.id, orderId));
    const statusChanged =
      order.status === STATUS.READY_PRODUCTION &&
      (await writeStatus(tx, role, orderId, STATUS.READY_PRODUCTION, STATUS.JOBSHEET_CREATED));
    return { created, statusChanged };
  });
}

/* ------------------------------------------------------------------ */
/* read                                                                 */
/* ------------------------------------------------------------------ */

export async function listOrderJobsheets(role: RoleKey, orderId: number): Promise<OrderJobsheets> {
  const [orderRows, rows] = await db.batch([
    db.select(orderPlanColumns).from(orders).where(eq(orders.id, orderId)),
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        frames: jobsheets.frames,
        picks: jobsheets.picks,
        createdAt: jobsheets.createdAt,
        machineId: machines.id,
        machineNo: machines.machineNo,
        machineName: machines.name,
        machineActive: machines.isActive,
      })
      .from(jobsheets)
      .leftJoin(jobsheetMachines, eq(jobsheetMachines.jobsheetId, jobsheets.id))
      .leftJoin(machines, eq(machines.id, jobsheetMachines.machineId))
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false)))
      .orderBy(asc(jobsheets.jobsheetNo), asc(machines.machineNo)),
  ]);
  const order = orderRows[0];
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');

  const list: JobsheetListItem[] = [];
  for (const r of rows) {
    let item = list[list.length - 1];
    if (!item || item.id !== r.id) {
      item = { id: r.id, jobsheetNo: r.jobsheetNo, frames: r.frames, picks: r.picks, createdAt: r.createdAt, machines: [] };
      list.push(item);
    }
    if (r.machineId !== null && r.machineNo !== null) {
      item.machines.push({ id: r.machineId, machineNo: r.machineNo, name: r.machineName, isActive: r.machineActive ?? true });
    }
  }
  const coverage = coverageOf(order, list.map((j) => j.frames));
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    unit: order.unit,
    status: order.status,
    framesPerJobsheet: order.framesPerJobsheet,
    jobsheets: list,
    coverage,
    warnings: coverageWarnings(coverage),
  };
}

export async function getJobsheet(role: RoleKey, id: number): Promise<JobsheetDetail> {
  const [rows, machineRows, siblings] = await db.batch([
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        frames: jobsheets.frames,
        picks: jobsheets.picks,
        createdBy: jobsheets.createdBy,
        isDeleted: jobsheets.isDeleted,
        createdAt: jobsheets.createdAt,
        updatedAt: jobsheets.updatedAt,
        order: orderPlanColumns,
        customer: { id: customers.id, name: customers.name, city: customers.city },
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
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(eq(jobsheets.id, id)),
    db
      .select(machineColumns)
      .from(jobsheetMachines)
      .innerJoin(machines, eq(machines.id, jobsheetMachines.machineId))
      .where(eq(jobsheetMachines.jobsheetId, id))
      .orderBy(asc(machines.machineNo)),
    db
      .select({ id: jobsheets.id, jobsheetNo: jobsheets.jobsheetNo, frames: jobsheets.frames })
      .from(jobsheets)
      .where(
        and(
          // Outer column written explicitly (see the Drizzle gotcha in CLAUDE.md).
          sql`"jobsheets"."order_id" = (SELECT j2.order_id FROM jobsheets j2 WHERE j2.id = ${id})`,
          eq(jobsheets.isDeleted, false),
        ),
      )
      .orderBy(asc(jobsheets.jobsheetNo)),
  ]);

  const r = rows[0];
  if (!r || r.isDeleted || !canRoleSeeStatus(role, r.order.status)) throw notFound('Jobsheet');
  const coverage = coverageOf(r.order, siblings.map((s) => s.frames));
  return {
    id: r.id,
    jobsheetNo: r.jobsheetNo,
    frames: r.frames,
    picks: r.picks,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    machines: machineRows.map((m) => m.machine),
    order: {
      ...r.order,
      customer: r.customer,
      material: r.material,
      design:
        r.designId !== null && r.designCode !== null
          ? { id: r.designId, code: r.designCode, name: r.designName, imageUrl: r.designImageUrl, thumbUrl: r.designThumbUrl }
          : null,
      variation:
        r.variationId !== null && r.variationCode !== null
          ? { id: r.variationId, code: r.variationCode, imageUrl: r.variationImageUrl, thumbUrl: r.variationThumbUrl }
          : null,
    },
    siblings,
    coverage,
    warnings: coverageWarnings(coverage),
  };
}

/** Everything the print route needs, in the order the ids were given. */
export async function printJobsheets(role: RoleKey, ids: number[]): Promise<JobsheetPrintItem[]> {
  const [rows, machineRows] = await db.batch([
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        frames: jobsheets.frames,
        picks: jobsheets.picks,
        orderNo: orders.orderNo,
        status: orders.status,
        jobsheetPieces: orders.jobsheetPieces,
        designCode: sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`,
        imageUrl: sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.imageUrl} ELSE ${designs.imageUrl} END`,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(inArray(jobsheets.id, ids), eq(jobsheets.isDeleted, false))),
    db
      .select(machineColumns)
      .from(jobsheetMachines)
      .innerJoin(machines, eq(machines.id, jobsheetMachines.machineId))
      .where(inArray(jobsheetMachines.jobsheetId, ids))
      .orderBy(asc(machines.machineNo)),
  ]);
  const machinesById = groupMachines(machineRows);
  const byId = new Map(rows.filter((r) => canRoleSeeStatus(role, r.status)).map((r) => [r.id, r]));
  const items: JobsheetPrintItem[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    items.push({
      id: r.id,
      jobsheetNo: r.jobsheetNo,
      orderNo: r.orderNo,
      frames: r.frames,
      picks: r.picks,
      machineNos: (machinesById.get(r.id) ?? []).map((m) => m.machineNo),
      jobsheetPieces: r.jobsheetPieces,
      designCode: r.designCode,
      imageUrl: r.imageUrl,
    });
  }
  if (items.length === 0) throw notFound('Jobsheets');
  return items;
}

/* ------------------------------------------------------------------ */
/* edit + auto-adjust (7.4)                                             */
/* ------------------------------------------------------------------ */

async function loadJobsheetForWrite(tx: Tx, role: RoleKey, id: number) {
  const [js] = await tx
    .select({ id: jobsheets.id, orderId: jobsheets.orderId, isDeleted: jobsheets.isDeleted })
    .from(jobsheets)
    .where(eq(jobsheets.id, id));
  if (!js || js.isDeleted) throw notFound('Jobsheet');
  const order = await loadVisibleOrder(tx, role, js.orderId).catch(() => {
    throw notFound('Jobsheet');
  });
  return { orderId: js.orderId, order };
}

export async function updateJobsheet(role: RoleKey, id: number, input: unknown): Promise<JobsheetUpdateResult> {
  const data = jobsheetUpdateSchema.parse(input);

  return db.transaction(async (tx) => {
    const { orderId, order } = await loadJobsheetForWrite(tx, role, id);
    const active = await activeJobsheets(tx, orderId);
    const current = active.find((j) => j.id === id)!;
    const currentMachines = await tx
      .select({ machineId: jobsheetMachines.machineId })
      .from(jobsheetMachines)
      .where(eq(jobsheetMachines.jobsheetId, id));
    const currentIds = currentMachines.map((m) => m.machineId);
    // Machines that are already on this jobsheet may stay even if they are inactive now.
    await assertMachines(tx, data.machineIds, currentIds);

    const plan = planFramesEdit({
      jobsheets: active,
      editedId: id,
      newFrames: data.frames,
      framesPerJobsheet: order.framesPerJobsheet,
    });

    // The edited jobsheet: frames + picks + machines.
    const sameMachines =
      currentIds.length === data.machineIds.length && currentIds.every((m) => data.machineIds.includes(m));
    const detailsChanged = (current.picks ?? null) !== data.picks || !sameMachines;
    if (detailsChanged || plan.updated.some((u) => u.id === id)) {
      await tx.update(jobsheets).set({ frames: data.frames, picks: data.picks }).where(eq(jobsheets.id, id));
    }
    if (!sameMachines) {
      await tx.delete(jobsheetMachines).where(eq(jobsheetMachines.jobsheetId, id));
      await tx.insert(jobsheetMachines).values(data.machineIds.map((machineId) => ({ jobsheetId: id, machineId })));
    }

    // Auto-adjust of the last jobsheet.
    for (const u of plan.updated) {
      if (u.id !== id) await tx.update(jobsheets).set({ frames: u.to }).where(eq(jobsheets.id, u.id));
    }
    if (plan.removed.length) {
      await tx
        .update(jobsheets)
        .set({ isDeleted: true })
        .where(inArray(jobsheets.id, plan.removed.map((r) => r.id)));
    }
    let created: JobsheetRef[] = [];
    if (plan.created.length) {
      // New jobsheets copy the picks and machines of the last jobsheet (after this edit).
      const last = plan.last;
      const lastPicks = last.id === id ? data.picks : (active.find((j) => j.id === last.id)?.picks ?? null);
      const lastMachines =
        last.id === id
          ? data.machineIds
          : (
              await tx
                .select({ machineId: jobsheetMachines.machineId })
                .from(jobsheetMachines)
                .where(eq(jobsheetMachines.jobsheetId, last.id))
            ).map((m) => m.machineId);
      created = await insertJobsheets(
        tx,
        role,
        orderId,
        plan.created.map((c) => c.frames),
        lastPicks,
        lastMachines,
      );
    }

    const after = await activeJobsheets(tx, orderId);
    const coverage = coverageOf(order, after.map((j) => j.frames));
    return {
      updated: plan.updated,
      created,
      removed: plan.removed.map((r) => ({ id: r.id, jobsheetNo: r.jobsheetNo, frames: r.frames })),
      detailsChanged,
      coverage,
      warnings: coverageWarnings(coverage),
    };
  });
}

/* ------------------------------------------------------------------ */
/* delete (7.6)                                                         */
/* ------------------------------------------------------------------ */

export async function deleteJobsheet(role: RoleKey, id: number): Promise<JobsheetDeleteResult> {
  return db.transaction(async (tx) => {
    const { orderId, order } = await loadJobsheetForWrite(tx, role, id);
    await tx.update(jobsheets).set({ isDeleted: true }).where(eq(jobsheets.id, id));
    const remaining = await activeJobsheets(tx, orderId);
    if (remaining.length > 0) return { orderId, orderReset: false };

    // That was the last one: reset the jobsheet plan and move the order back.
    await tx
      .update(orders)
      .set({ jobsheetPieces: 0, targetFrames: 0, framesPerJobsheet: null })
      .where(eq(orders.id, orderId));
    if (order.status === STATUS.JOBSHEET_CREATED) {
      await writeStatus(tx, role, orderId, STATUS.JOBSHEET_CREATED, STATUS.READY_PRODUCTION);
    }
    return { orderId, orderReset: true };
  });
}

/** Active jobsheet count of an order (used by the undo-send-for-production rule). */
export async function countActiveJobsheets(tx: DbOrTx, orderId: number): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`COUNT(*)` })
    .from(jobsheets)
    .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false)));
  return Number(row?.n ?? 0);
}
