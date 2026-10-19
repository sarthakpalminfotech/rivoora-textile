import { and, asc, count, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { currentUserId } from '../lib/request-context';
import { alias } from 'drizzle-orm/sqlite-core';
import {
  can,
  canRoleSeeJobsheetStatus,
  canRoleSeeStatus,
  coverageFrames,
  coverageWarnings,
  isReadyOrLater,
  JOBSHEET_STATUS,
  jobsheetChangeMachineSchema,
  jobsheetCompleteSchema,
  jobsheetGenerateSchema,
  jobsheetRef,
  jobsheetRefShort,
  jobsheetSendSchema,
  jobsheetSingleSchema,
  jobsheetStartSchema,
  jobsheetStatusesForRole,
  jobsheetUpdateSchema,
  MAX_JOBSHEETS_PER_RUN,
  normalizeCode,
  orderStatusForJobsheets,
  planFramesEdit,
  planJobsheets,
  type Coverage,
  type JobsheetActionResult,
  type JobsheetByNo,
  type JobsheetChangeMachineResult,
  type JobsheetCreateResult,
  type JobsheetDeleteResult,
  type JobsheetDetail,
  type JobsheetEventKind,
  type JobsheetListItem,
  type JobsheetListQuery,
  type JobsheetMachine,
  type JobsheetPrintItem,
  type JobsheetRef,
  type JobsheetSendResult,
  type JobsheetStatusKey,
  type JobsheetTabCounts,
  type JobsheetUpdateResult,
  type MachineRef,
  type OrderJobsheets,
  type OrderStatusKey,
  type RoleKey,
  type SupervisorJobsheetItem,
  type SupervisorJobsheetPage,
  type SupervisorOrderHeader,
  type SupervisorOrderListQuery,
  type SupervisorOrderPage,
  type Unit,
  workFiltersOf,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  counters,
  customers,
  dispatchChallans,
  goodsReturns,
  designVariations,
  designs,
  jobsheetEvents,
  jobsheetMachines,
  jobsheets,
  machines,
  materials,
  orderStatusHistory,
  orders,
  takas,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern } from '../lib/http';
import { mapTaka, sortTakas, TAKA_EVENTS, takaColumns } from './taka-shared';
import { takaInOrder } from './free-stock';
import { rowFilters } from './work-filters';

const JOBSHEET_COUNTER = 'jobsheet_no';
export const now = () => new Date().toISOString();

/** The machine a jobsheet runs on (second join of `machines`). */
export const runningMachine = alias(machines, 'running_machine');

/**
 * Roles without order access (the supervisor) get the restricted jobsheet view: no Pending jobsheets,
 * no client / order details — only the order number.
 */
export const isRestricted = (role: RoleKey) => !can(role, 'canViewOrders');

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
    throw conflict('Jobsheets can only be created once the order has been sent for production.');
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

interface EventInput {
  jobsheetId: number;
  event: JobsheetEventKind;
  machineId?: number | null;
  frames?: number | null;
  note?: string | null;
}

export async function writeEvents(tx: Tx, role: RoleKey, events: EventInput[]) {
  if (events.length === 0) return;
  const at = now();
  await tx.insert(jobsheetEvents).values(
    events.map((e) => ({
      jobsheetId: e.jobsheetId,
      event: e.event,
      machineId: e.machineId ?? null,
      frames: e.frames ?? null,
      note: e.note ?? null,
      role,
      userId: currentUserId(),
      createdAt: at,
      updatedAt: at,
    })),
  );
}

interface InsertOptions {
  /** Default Pending. `sent` also writes a "sent" event. */
  status?: JobsheetStatusKey;
  parentJobsheetId?: number;
  suggestedMachineId?: number;
  /** Note on the "created" event. */
  note?: string;
}

async function insertJobsheets(
  tx: Tx,
  role: RoleKey,
  orderId: number,
  frames: number[],
  picks: string | null,
  machineIds: number[],
  opts: InsertOptions = {},
): Promise<JobsheetRef[]> {
  if (frames.length === 0) return [];
  const numbers = await allocateJobsheetNumbers(tx, frames.length);
  const status = opts.status ?? JOBSHEET_STATUS.PENDING;
  const sentAt = status === JOBSHEET_STATUS.SENT ? now() : null;
  const created = await tx
    .insert(jobsheets)
    .values(
      frames.map((f, i) => ({
        jobsheetNo: numbers[i],
        orderId,
        frames: f,
        picks,
        createdBy: role,
        status,
        sentAt,
        parentJobsheetId: opts.parentJobsheetId ?? null,
        suggestedMachineId: opts.suggestedMachineId ?? null,
      })),
    )
    .returning({ id: jobsheets.id, jobsheetNo: jobsheets.jobsheetNo, frames: jobsheets.frames });
  if (machineIds.length) {
    await tx
      .insert(jobsheetMachines)
      .values(created.flatMap((j) => machineIds.map((machineId) => ({ jobsheetId: j.id, machineId }))));
  }
  await writeEvents(
    tx,
    role,
    created.flatMap((j) => [
      { jobsheetId: j.id, event: 'created' as const, frames: j.frames, note: opts.note },
      ...(status === JOBSHEET_STATUS.SENT ? [{ jobsheetId: j.id, event: 'sent' as const }] : []),
    ]),
  );
  return created.sort((a, b) => a.jobsheetNo - b.jobsheetNo);
}

async function writeStatus(tx: Tx, role: RoleKey, orderId: number, from: OrderStatusKey, to: OrderStatusKey) {
  const updated = await tx
    .update(orders)
    .set({ status: to })
    .where(and(eq(orders.id, orderId), eq(orders.status, from)))
    .returning({ id: orders.id });
  if (updated.length) {
    await tx.insert(orderStatusHistory).values({ orderId, fromStatus: from, toStatus: to, role, userId: currentUserId(), changedAt: now() });
  }
  return updated.length > 0;
}

/** Active takas of a jobsheet (outer column written explicitly — see the Drizzle gotcha). */
export const activeTakaCount = sql<number>`(SELECT COUNT(*) FROM takas t WHERE t.jobsheet_id = "jobsheets"."id" AND t.is_deleted = 0)`;

/**
 * Moves the order to the status that follows from its active jobsheets (see `orderStatusForJobsheets`).
 * Call at the end of EVERY jobsheet write, inside the same transaction. History is only written when the status
 * actually changes, and an order that is still Pending for production is never moved.
 */
export async function recomputeOrderStatus(orderId: number, role: RoleKey, tx: Tx): Promise<boolean> {
  const [order] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  if (!order || !isReadyOrLater(order.status)) return false;
  const rows = await tx
    .select({ status: jobsheets.status, takaCount: activeTakaCount })
    .from(jobsheets)
    .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false)));
  // The stage of every active taka (butta cutting / waiting for the mill drive the later order statuses).
  const stageRows = await tx
    .select({ stage: takas.stage })
    .from(takas)
    .innerJoin(jobsheets, eq(jobsheets.id, takas.jobsheetId))
    .where(and(takaInOrder(orderId), eq(takas.isDeleted, false), eq(jobsheets.isDeleted, false)));
  // Sprint 13: an order that had a goods return ends as Returned (not Dispatched) once its remaining takas are dispatched.
  const [gr] = await tx
    .select({ n: sql<number>`COUNT(*)` })
    .from(goodsReturns)
    .innerJoin(dispatchChallans, eq(dispatchChallans.id, goodsReturns.challanId))
    .where(eq(dispatchChallans.orderId, orderId));
  const next = orderStatusForJobsheets(
    rows,
    stageRows.map((r) => r.stage),
    Number(gr?.n ?? 0) > 0,
  );
  if (next === order.status) return false;
  return writeStatus(tx, role, orderId, order.status, next);
}

async function activeJobsheets(tx: DbOrTx, orderId: number) {
  return tx
    .select({
      id: jobsheets.id,
      jobsheetNo: jobsheets.jobsheetNo,
      frames: jobsheets.frames,
      picks: jobsheets.picks,
      status: jobsheets.status,
      completedFrames: jobsheets.completedFrames,
    })
    .from(jobsheets)
    .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false)))
    .orderBy(asc(jobsheets.jobsheetNo));
}

type CoverageSheet = Parameters<typeof coverageFrames>[0][number];

function coverageOf(order: Pick<OrderPlanRow, 'quantity' | 'jobsheetPieces' | 'targetFrames'>, list: CoverageSheet[]): Coverage {
  return {
    orderedPieces: order.quantity,
    jobsheetPieces: order.jobsheetPieces,
    targetFrames: order.targetFrames,
    totalFrames: coverageFrames(list),
    jobsheetCount: list.length,
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

export const machineColumns = {
  jobsheetId: jobsheetMachines.jobsheetId,
  machine: { id: machines.id, machineNo: machines.machineNo, name: machines.name, isActive: machines.isActive },
};

export const runningMachineColumns = {
  runningMachineId: runningMachine.id,
  runningMachineNo: runningMachine.machineNo,
  runningMachineName: runningMachine.name,
};

export function toMachineRef(r: { runningMachineId: number | null; runningMachineNo: number | null; runningMachineName: string | null }): MachineRef | null {
  return r.runningMachineId !== null && r.runningMachineNo !== null
    ? { id: r.runningMachineId, machineNo: r.runningMachineNo, name: r.runningMachineName }
    : null;
}

/** Number of the jobsheet this one continues (outer column written explicitly — see the Drizzle gotcha). */
const parentJobsheetNo = sql<number | null>`(SELECT p.jobsheet_no FROM jobsheets p WHERE p.id = "jobsheets"."parent_jobsheet_id")`;

/** Machines of a jobsheet as a JSON array (one query for a whole list page). */
export const machinesJson = sql<string | null>`(SELECT json_group_array(json_object('id', m.id, 'machineNo', m.machine_no, 'name', m.name, 'isActive', m.is_active)) FROM jobsheet_machines jm JOIN machines m ON m.id = jm.machine_id WHERE jm.jobsheet_id = "jobsheets"."id")`;

export function parseMachinesJson(raw: string | null): JobsheetMachine[] {
  if (!raw) return [];
  const list = JSON.parse(raw) as { id: number; machineNo: number; name: string | null; isActive: number | boolean }[];
  return list
    .filter((m) => m.id !== null)
    .map((m) => ({ id: m.id, machineNo: m.machineNo, name: m.name, isActive: Boolean(m.isActive) }))
    .sort((a, b) => a.machineNo - b.machineNo);
}

/** 409 unless the jobsheet is Pending (only Pending jobsheets can be edited or deleted). */
function assertPending(status: JobsheetStatusKey) {
  if (status === JOBSHEET_STATUS.SENT) throw conflict('This jobsheet is with the supervisor. Pull it back from the supervisor first.');
  if (status !== JOBSHEET_STATUS.PENDING) {
    throw conflict('This jobsheet is already in production and can no longer be changed.');
  }
}

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
    const statusChanged = await recomputeOrderStatus(orderId, role, tx);
    return { orderNo: order.orderNo, created, statusChanged };
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
    const statusChanged = await recomputeOrderStatus(orderId, role, tx);
    return { orderNo: order.orderNo, created, statusChanged };
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
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
        picks: jobsheets.picks,
        sentAt: jobsheets.sentAt,
        startedAt: jobsheets.startedAt,
        completedAt: jobsheets.completedAt,
        createdAt: jobsheets.createdAt,
        parentJobsheetNo,
        ...runningMachineColumns,
        machineId: machines.id,
        machineNo: machines.machineNo,
        machineName: machines.name,
        machineActive: machines.isActive,
      })
      .from(jobsheets)
      .leftJoin(jobsheetMachines, eq(jobsheetMachines.jobsheetId, jobsheets.id))
      .leftJoin(machines, eq(machines.id, jobsheetMachines.machineId))
      .leftJoin(runningMachine, eq(runningMachine.id, jobsheets.runningMachineId))
      .where(and(eq(jobsheets.orderId, orderId), eq(jobsheets.isDeleted, false)))
      .orderBy(asc(jobsheets.jobsheetNo), asc(machines.machineNo)),
  ]);
  const order = orderRows[0];
  if (!order || !canRoleSeeStatus(role, order.status)) throw notFound('Order');

  const list: JobsheetListItem[] = [];
  for (const r of rows) {
    let item = list[list.length - 1];
    if (!item || item.id !== r.id) {
      item = {
        id: r.id,
        jobsheetNo: r.jobsheetNo,
        orderNo: order.orderNo,
        status: r.status,
        frames: r.frames,
        completedFrames: r.completedFrames,
        picks: r.picks,
        machines: [],
        runningMachine: toMachineRef(r),
        parentJobsheetNo: r.parentJobsheetNo,
        sentAt: r.sentAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        createdAt: r.createdAt,
      };
      list.push(item);
    }
    if (r.machineId !== null && r.machineNo !== null) {
      item.machines.push({ id: r.machineId, machineNo: r.machineNo, name: r.machineName, isActive: r.machineActive ?? true });
    }
  }
  const coverage = coverageOf(order, list);
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    unit: order.unit,
    status: order.status,
    framesPerJobsheet: order.framesPerJobsheet,
    jobsheets: list,
    completedCount: list.filter((j) => j.status === JOBSHEET_STATUS.COMPLETED).length,
    coverage,
    warnings: coverageWarnings(coverage),
  };
}

export async function getJobsheet(role: RoleKey, id: number): Promise<JobsheetDetail> {
  const [rows, machineRows, siblings, events, children, takaRows] = await db.batch([
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
        picks: jobsheets.picks,
        createdBy: jobsheets.createdBy,
        isDeleted: jobsheets.isDeleted,
        createdAt: jobsheets.createdAt,
        updatedAt: jobsheets.updatedAt,
        sentAt: jobsheets.sentAt,
        startedAt: jobsheets.startedAt,
        completedAt: jobsheets.completedAt,
        suggestedMachineId: jobsheets.suggestedMachineId,
        parentJobsheetId: jobsheets.parentJobsheetId,
        parentJobsheetNo,
        takaNote: jobsheets.takaNote,
        blouseOption: orders.blouseOption,
        ...runningMachineColumns,
        order: orderPlanColumns,
        customer: { id: customers.id, name: customers.name, city: customers.city },
        material: { id: materials.id, name: materials.name, code: materials.code },
        designCode: designs.code,
        designImageUrl: designs.imageUrl,
        designThumbUrl: designs.thumbUrl,
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
      .leftJoin(runningMachine, eq(runningMachine.id, jobsheets.runningMachineId))
      .where(eq(jobsheets.id, id)),
    db
      .select(machineColumns)
      .from(jobsheetMachines)
      .innerJoin(machines, eq(machines.id, jobsheetMachines.machineId))
      .where(eq(jobsheetMachines.jobsheetId, id))
      .orderBy(asc(machines.machineNo)),
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        frames: jobsheets.frames,
        status: jobsheets.status,
        completedFrames: jobsheets.completedFrames,
      })
      .from(jobsheets)
      .where(
        and(
          // Outer column written explicitly (see the Drizzle gotcha in CLAUDE.md).
          sql`"jobsheets"."order_id" = (SELECT j2.order_id FROM jobsheets j2 WHERE j2.id = ${id})`,
          eq(jobsheets.isDeleted, false),
        ),
      )
      .orderBy(asc(jobsheets.jobsheetNo)),
    db
      .select({
        id: jobsheetEvents.id,
        event: jobsheetEvents.event,
        machineNo: machines.machineNo,
        frames: jobsheetEvents.frames,
        note: jobsheetEvents.note,
        role: jobsheetEvents.role,
        createdAt: jobsheetEvents.createdAt,
      })
      .from(jobsheetEvents)
      .leftJoin(machines, eq(machines.id, jobsheetEvents.machineId))
      .where(eq(jobsheetEvents.jobsheetId, id))
      .orderBy(asc(jobsheetEvents.createdAt), asc(jobsheetEvents.id)),
    db
      .select({ id: jobsheets.id, jobsheetNo: jobsheets.jobsheetNo })
      .from(jobsheets)
      .where(and(eq(jobsheets.parentJobsheetId, id), eq(jobsheets.isDeleted, false)))
      .orderBy(asc(jobsheets.jobsheetNo)),
    db
      .select(takaColumns)
      .from(takas)
      .where(and(eq(takas.jobsheetId, id), eq(takas.isDeleted, false))),
  ]);

  const r = rows[0];
  if (!r || r.isDeleted || !canRoleSeeJobsheetStatus(role, r.status)) throw notFound('Jobsheet');
  const restricted = isRestricted(role);
  if (!restricted && !canRoleSeeStatus(role, r.order.status)) throw notFound('Jobsheet');

  const code = r.variationCode ?? r.designCode;
  const coverage = restricted ? null : coverageOf(r.order, siblings);
  // Takas are hidden from roles that can't see them (the supervisor) — including their activity entries.
  const seesTakas = can(role, 'canViewTakas');
  return {
    id: r.id,
    jobsheetNo: r.jobsheetNo,
    blouseOption: r.blouseOption,
    status: r.status,
    frames: r.frames,
    completedFrames: r.completedFrames,
    picks: r.picks,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    sentAt: r.sentAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    machines: machineRows.map((m) => m.machine),
    runningMachine: toMachineRef(r),
    suggestedMachineId: r.suggestedMachineId,
    parent: r.parentJobsheetId !== null && r.parentJobsheetNo !== null ? { id: r.parentJobsheetId, jobsheetNo: r.parentJobsheetNo } : null,
    // A restricted role can't open a child that is still Pending — none are (children are created as Sent).
    children,
    events: seesTakas ? events : events.filter((e) => !TAKA_EVENTS.has(e.event)),
    orderNo: r.order.orderNo,
    design: code
      ? {
          code,
          baseCode: r.variationCode ? r.designCode : null,
          imageUrl: r.variationCode ? r.variationImageUrl : r.designImageUrl,
          thumbUrl: r.variationCode ? r.variationThumbUrl : r.designThumbUrl,
        }
      : null,
    order: restricted ? null : { ...r.order, customer: r.customer, material: r.material },
    siblings: restricted ? [] : siblings,
    coverage,
    warnings: coverage ? coverageWarnings(coverage) : [],
    takas: seesTakas ? sortTakas(takaRows.map(mapTaka)) : null,
    takaNote: seesTakas ? r.takaNote : null,
  };
}

/**
 * GET /jobsheets/by-no/:no — resolves a jobsheet number (from a scanned QR) to its id.
 * 404 when it doesn't exist, is deleted, or isn't visible for the role (the supervisor never sees Pending ones).
 */
export async function jobsheetByNo(role: RoleKey, jobsheetNo: number): Promise<JobsheetByNo> {
  const [r] = await db
    .select({
      id: jobsheets.id,
      jobsheetNo: jobsheets.jobsheetNo,
      status: jobsheets.status,
      isDeleted: jobsheets.isDeleted,
      orderNo: orders.orderNo,
      orderStatus: orders.status,
    })
    .from(jobsheets)
    .innerJoin(orders, eq(orders.id, jobsheets.orderId))
    .where(eq(jobsheets.jobsheetNo, jobsheetNo));
  if (!r || r.isDeleted || !canRoleSeeJobsheetStatus(role, r.status)) throw notFound('Jobsheet');
  if (!isRestricted(role) && !canRoleSeeStatus(role, r.orderStatus)) throw notFound('Jobsheet');
  return { id: r.id, jobsheetNo: r.jobsheetNo, orderNo: r.orderNo };
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
        status: jobsheets.status,
        orderNo: orders.orderNo,
        orderStatus: orders.status,
        jobsheetPieces: orders.jobsheetPieces,
        orderType: orders.orderType,
        blouseOption: orders.blouseOption,
        designCode: sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`,
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
  const restricted = isRestricted(role);
  const visible = rows.filter(
    (r) => canRoleSeeJobsheetStatus(role, r.status) && (restricted || canRoleSeeStatus(role, r.orderStatus)),
  );
  const byId = new Map(visible.map((r) => [r.id, r]));
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
      orderType: r.orderType,
      blouseOption: r.blouseOption,
    });
  }
  if (items.length === 0) throw notFound('Jobsheets');
  return items;
}

/* ------------------------------------------------------------------ */
/* supervisor list (Jobsheets module)                                   */
/* ------------------------------------------------------------------ */

const TAB_STATUS: Record<Exclude<JobsheetListQuery['tab'], 'all'>, JobsheetStatusKey> = {
  pending: JOBSHEET_STATUS.SENT,
  ongoing: JOBSHEET_STATUS.ONGOING,
  completed: JOBSHEET_STATUS.COMPLETED,
};

/**
 * Pending (Sent) first, then Ongoing, then Completed. Pending and Ongoing by number (oldest first);
 * Completed most recently completed first.
 */
const supervisorOrder = [
  sql`CASE ${jobsheets.status} WHEN 'sent' THEN 0 WHEN 'ongoing' THEN 1 ELSE 2 END`,
  sql`CASE WHEN ${jobsheets.status} = 'completed' THEN ${jobsheets.completedAt} END DESC`,
  asc(jobsheets.jobsheetNo),
];

/** The search term without a leading `#` / "order" / "jobsheet". */
const searchTerm = (search: string) => search.replace(/^(#|order\s*#?|jobsheet\s*#?)/i, '').trim() || search;

/**
 * Search by order number or jobsheet number (prefix) or design / variation code. A leading `#` is ignored.
 * The query must join `orders`, `designs` and `design_variations`.
 */
export function jobsheetSearch(search: string): SQL | undefined {
  const term = searchTerm(search);
  const codeP = likePattern(normalizeCode(term));
  const parts: (SQL | undefined)[] = [
    sql`${designs.code} LIKE ${codeP} ESCAPE '\\'`,
    sql`${designVariations.code} LIKE ${codeP} ESCAPE '\\'`,
  ];
  if (/^\d+$/.test(term)) {
    const numP = likePattern(term, 'prefix');
    parts.push(sql`CAST(${orders.orderNo} AS TEXT) LIKE ${numP} ESCAPE '\\'`);
    parts.push(sql`CAST(${jobsheets.jobsheetNo} AS TEXT) LIKE ${numP} ESCAPE '\\'`);
  }
  return or(...parts);
}

const designCodeCol = sql<string | null>`COALESCE(${designVariations.code}, ${designs.code})`;
const designThumbCol = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.thumbUrl} ELSE ${designs.thumbUrl} END`;
const designImageCol = sql<string | null>`CASE WHEN ${designVariations.id} IS NOT NULL THEN ${designVariations.imageUrl} ELSE ${designs.imageUrl} END`;

/** The jobsheet statuses the supervisor's module shows (never Pending = not yet sent). */
const supervisorStatuses = (role: RoleKey) => jobsheetStatusesForRole(role).filter((s) => s !== JOBSHEET_STATUS.PENDING);

export async function listSupervisorJobsheets(role: RoleKey, q: JobsheetListQuery): Promise<SupervisorJobsheetPage> {
  // Never Pending (not yet sent) — the visible set comes from the status config.
  const visible = supervisorStatuses(role);
  const scope: (SQL | undefined)[] = [eq(jobsheets.isDeleted, false), inArray(jobsheets.status, visible)];
  if (q.orderId) scope.push(eq(jobsheets.orderId, q.orderId));
  const base = [...scope];
  if (q.search) base.push(jobsheetSearch(q.search));
  // Filters modal: loom / quality / order type / blouse / sent date.
  base.push(rowFilters(workFiltersOf(q), jobsheets.sentAt));
  const listWhere = and(...base, q.tab === 'all' ? undefined : eq(jobsheets.status, TAB_STATUS[q.tab]));

  // The Order view: the order's header (number + design only). 404 when it has no jobsheets he can see.
  let order: SupervisorOrderHeader | null = null;
  if (q.orderId) {
    const [header] = await db
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        designCode: designCodeCol,
        designThumbUrl: designThumbCol,
        designImageUrl: designImageCol,
        blouseOption: orders.blouseOption,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(...scope))
      .limit(1);
    if (!header) throw notFound('Order');
    order = header;
  }

  const [items, [{ total }], countRows] = await db.batch([
    db
      .select({
        id: jobsheets.id,
        jobsheetNo: jobsheets.jobsheetNo,
        status: jobsheets.status,
        frames: jobsheets.frames,
        completedFrames: jobsheets.completedFrames,
        picks: jobsheets.picks,
        orderNo: orders.orderNo,
        quality: materials.name,
        blouseOption: orders.blouseOption,
        designCode: designCodeCol,
        thumbUrl: designThumbCol,
        imageUrl: designImageCol,
        machinesJson,
        ...runningMachineColumns,
        suggestedMachineId: jobsheets.suggestedMachineId,
        parentJobsheetNo,
        startedAt: jobsheets.startedAt,
        completedAt: jobsheets.completedAt,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .innerJoin(materials, eq(materials.id, orders.materialId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .leftJoin(runningMachine, eq(runningMachine.id, jobsheets.runningMachineId))
      .where(listWhere)
      .orderBy(...supervisorOrder)
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db
      .select({ total: count() })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(listWhere),
    db
      .select({ status: jobsheets.status, n: count() })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(...base))
      .groupBy(jobsheets.status),
  ]);

  const byStatus = new Map(countRows.map((c) => [c.status, c.n]));
  const counts: JobsheetTabCounts = {
    all: countRows.reduce((s, c) => s + c.n, 0),
    pending: byStatus.get(JOBSHEET_STATUS.SENT) ?? 0,
    ongoing: byStatus.get(JOBSHEET_STATUS.ONGOING) ?? 0,
    completed: byStatus.get(JOBSHEET_STATUS.COMPLETED) ?? 0,
  };
  return {
    items: items.map(
      (r): SupervisorJobsheetItem => ({
        id: r.id,
        jobsheetNo: r.jobsheetNo,
        status: r.status,
        frames: r.frames,
        completedFrames: r.completedFrames,
        picks: r.picks,
        orderNo: r.orderNo,
        quality: r.quality,
        blouseOption: r.blouseOption,
        designCode: r.designCode,
        thumbUrl: r.thumbUrl,
        imageUrl: r.imageUrl,
        machines: parseMachinesJson(r.machinesJson),
        runningMachine: toMachineRef(r),
        suggestedMachineId: r.suggestedMachineId,
        parentJobsheetNo: r.parentJobsheetNo,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      }),
    ),
    page: q.page,
    limit: q.limit,
    total,
    hasMore: q.page * q.limit < total,
    counts,
    order,
  };
}

/**
 * GET /jobsheets/orders — the supervisor's Order view: one row per order that has jobsheets he can see (Sent /
 * Ongoing / Completed), with the counts per status. One aggregate query (GROUP BY order) + its count.
 * Orders with Pending or On-loom work first (by order number), fully completed ones last (most recently completed
 * first). Never returns the client or other order details.
 */
export async function listSupervisorOrders(role: RoleKey, q: SupervisorOrderListQuery): Promise<SupervisorOrderPage> {
  const where: (SQL | undefined)[] = [eq(jobsheets.isDeleted, false), inArray(jobsheets.status, supervisorStatuses(role))];
  if (q.search) {
    const term = searchTerm(q.search);
    const codeP = likePattern(normalizeCode(term));
    const parts: (SQL | undefined)[] = [
      sql`${designs.code} LIKE ${codeP} ESCAPE '\\'`,
      sql`${designVariations.code} LIKE ${codeP} ESCAPE '\\'`,
    ];
    if (/^\d+$/.test(term)) parts.push(sql`CAST(${orders.orderNo} AS TEXT) LIKE ${likePattern(term, 'prefix')} ESCAPE '\\'`);
    where.push(or(...parts));
  }
  // Filters modal: an order is listed (and counted) by its jobsheets that match.
  where.push(rowFilters(workFiltersOf(q), jobsheets.sentAt));

  const pending = sql<number>`SUM(CASE WHEN ${jobsheets.status} = 'sent' THEN 1 ELSE 0 END)`;
  const ongoing = sql<number>`SUM(CASE WHEN ${jobsheets.status} = 'ongoing' THEN 1 ELSE 0 END)`;
  const completed = sql<number>`SUM(CASE WHEN ${jobsheets.status} = 'completed' THEN 1 ELSE 0 END)`;
  const lastCompletedAt = sql<string | null>`MAX(${jobsheets.completedAt})`;
  const from = () =>
    db
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        designCode: designCodeCol,
        designThumbUrl: designThumbCol,
        designImageUrl: designImageCol,
        blouseOption: orders.blouseOption,
        pending,
        ongoing,
        completed,
        total: sql<number>`COUNT(*)`,
        lastCompletedAt,
      })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(...where))
      .groupBy(orders.id);

  const [rows, [{ total }]] = await db.batch([
    from()
      .orderBy(
        sql`CASE WHEN ${pending} + ${ongoing} > 0 THEN 0 ELSE 1 END`,
        sql`CASE WHEN ${pending} + ${ongoing} > 0 THEN ${orders.orderNo} END`,
        sql`${lastCompletedAt} DESC`,
        orders.orderNo,
      )
      .limit(q.limit)
      .offset((q.page - 1) * q.limit),
    db
      .select({ total: sql<number>`COUNT(DISTINCT ${jobsheets.orderId})` })
      .from(jobsheets)
      .innerJoin(orders, eq(orders.id, jobsheets.orderId))
      .leftJoin(designs, eq(designs.id, orders.designId))
      .leftJoin(designVariations, eq(designVariations.id, orders.variationId))
      .where(and(...where)),
  ]);
  const n = Number(total);
  return {
    items: rows.map((r) => ({
      orderId: r.orderId,
      orderNo: r.orderNo,
      designCode: r.designCode,
      designThumbUrl: r.designThumbUrl,
      designImageUrl: r.designImageUrl,
      blouseOption: r.blouseOption,
      counts: {
        pending: Number(r.pending),
        ongoing: Number(r.ongoing),
        completed: Number(r.completed),
        total: Number(r.total),
      },
      lastCompletedAt: r.lastCompletedAt,
    })),
    page: q.page,
    limit: q.limit,
    total: n,
    hasMore: q.page * q.limit < n,
  };
}

/* ------------------------------------------------------------------ */
/* edit + auto-adjust (7.4)                                             */
/* ------------------------------------------------------------------ */

async function loadJobsheetForWrite(tx: Tx, role: RoleKey, id: number) {
  const [js] = await tx
    .select({
      id: jobsheets.id,
      jobsheetNo: jobsheets.jobsheetNo,
      orderId: jobsheets.orderId,
      status: jobsheets.status,
      isDeleted: jobsheets.isDeleted,
    })
    .from(jobsheets)
    .where(eq(jobsheets.id, id));
  if (!js || js.isDeleted) throw notFound('Jobsheet');
  const order = await loadVisibleOrder(tx, role, js.orderId).catch(() => {
    throw notFound('Jobsheet');
  });
  return { js, orderId: js.orderId, order };
}

export async function updateJobsheet(role: RoleKey, id: number, input: unknown): Promise<JobsheetUpdateResult> {
  const data = jobsheetUpdateSchema.parse(input);

  return db.transaction(async (tx) => {
    const { js, orderId, order } = await loadJobsheetForWrite(tx, role, id);
    assertPending(js.status);
    const active = await activeJobsheets(tx, orderId);
    const current = active.find((j) => j.id === id)!;
    const currentMachines = await tx
      .select({ machineId: jobsheetMachines.machineId })
      .from(jobsheetMachines)
      .where(eq(jobsheetMachines.jobsheetId, id));
    const currentIds = currentMachines.map((m) => m.machineId);
    // Machines that are already on this jobsheet may stay even if they are inactive now.
    await assertMachines(tx, data.machineIds, currentIds);

    // Only Pending jobsheets are adjusted; the last PENDING one absorbs the change.
    const plan = planFramesEdit({
      jobsheets: active,
      editedId: id,
      newFrames: data.frames,
      framesPerJobsheet: order.framesPerJobsheet,
    });
    const pendingIds = active.filter((j) => j.status === JOBSHEET_STATUS.PENDING).map((j) => j.id);

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

    // Auto-adjust of the last Pending jobsheet — conditional on it still being Pending.
    for (const u of plan.updated) {
      if (u.id === id) continue;
      const done = await tx
        .update(jobsheets)
        .set({ frames: u.to })
        .where(and(eq(jobsheets.id, u.id), eq(jobsheets.status, JOBSHEET_STATUS.PENDING)))
        .returning({ id: jobsheets.id });
      if (!done.length) throw conflict('Another jobsheet of this order was just sent. Refresh and try again.');
    }
    if (plan.removed.length) {
      const removedIds = plan.removed.map((r) => r.id).filter((rid) => pendingIds.includes(rid));
      await tx
        .update(jobsheets)
        .set({ isDeleted: true })
        .where(and(inArray(jobsheets.id, removedIds), eq(jobsheets.status, JOBSHEET_STATUS.PENDING)));
    }
    let created: JobsheetRef[] = [];
    if (plan.created.length) {
      // New jobsheets copy the picks and machines of the last Pending jobsheet (after this edit).
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

    await recomputeOrderStatus(orderId, role, tx);
    const after = await activeJobsheets(tx, orderId);
    const coverage = coverageOf(order, after);
    return {
      orderNo: order.orderNo,
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
    const { js, orderId } = await loadJobsheetForWrite(tx, role, id);
    assertPending(js.status);
    const deleted = await tx
      .update(jobsheets)
      .set({ isDeleted: true })
      .where(and(eq(jobsheets.id, id), eq(jobsheets.status, JOBSHEET_STATUS.PENDING)))
      .returning({ id: jobsheets.id });
    if (!deleted.length) throw conflict('This jobsheet was just sent to the supervisor. Refresh and try again.');
    const remaining = await activeJobsheets(tx, orderId);
    if (remaining.length === 0) {
      // That was the last one: reset the jobsheet plan (the status moves back below).
      await tx
        .update(orders)
        .set({ jobsheetPieces: 0, targetFrames: 0, framesPerJobsheet: null })
        .where(eq(orders.id, orderId));
    }
    await recomputeOrderStatus(orderId, role, tx);
    return { orderId, orderReset: remaining.length === 0 };
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

/* ------------------------------------------------------------------ */
/* send to supervisor / pull back                                       */
/* ------------------------------------------------------------------ */

/** Pending → Sent for the given jobsheets of one order. Others are skipped; 409 if none were Pending. */
export async function sendJobsheets(role: RoleKey, orderId: number, input: unknown): Promise<JobsheetSendResult> {
  const { jobsheetIds } = jobsheetSendSchema.parse(input);
  return db.transaction(async (tx) => {
    await loadVisibleOrder(tx, role, orderId);
    const updated = await tx
      .update(jobsheets)
      .set({ status: JOBSHEET_STATUS.SENT, sentAt: now() })
      .where(
        and(
          inArray(jobsheets.id, jobsheetIds),
          eq(jobsheets.orderId, orderId),
          eq(jobsheets.isDeleted, false),
          eq(jobsheets.status, JOBSHEET_STATUS.PENDING),
        ),
      )
      .returning({ id: jobsheets.id });
    if (updated.length === 0) {
      throw conflict('None of the selected jobsheets are pending any more. Refresh and try again.');
    }
    await writeEvents(tx, role, updated.map((j) => ({ jobsheetId: j.id, event: 'sent' as const })));
    await recomputeOrderStatus(orderId, role, tx);
    return { updated: updated.length, jobsheetIds: updated.map((j) => j.id) };
  });
}

/** Sent → Pending (only while the supervisor hasn't started it). */
export async function pullBackJobsheet(role: RoleKey, id: number): Promise<JobsheetActionResult> {
  return db.transaction(async (tx) => {
    const { js, orderId, order } = await loadJobsheetForWrite(tx, role, id);
    const updated = await tx
      .update(jobsheets)
      .set({ status: JOBSHEET_STATUS.PENDING, sentAt: null })
      .where(and(eq(jobsheets.id, id), eq(jobsheets.status, JOBSHEET_STATUS.SENT)))
      .returning({ id: jobsheets.id });
    if (!updated.length) {
      throw conflict(
        js.status === JOBSHEET_STATUS.PENDING
          ? 'This jobsheet has not been sent to the supervisor.'
          : 'The supervisor has already started this jobsheet, so it can no longer be pulled back.',
      );
    }
    await writeEvents(tx, role, [{ jobsheetId: id, event: 'pulled_back' }]);
    await recomputeOrderStatus(orderId, role, tx);
    return { id, jobsheetNo: js.jobsheetNo, orderNo: order.orderNo, status: JOBSHEET_STATUS.PENDING, machineNo: null };
  });
}

/* ------------------------------------------------------------------ */
/* supervisor: start / complete / change machine                        */
/* ------------------------------------------------------------------ */

/** A jobsheet the role may run: exists, not deleted, and its status is visible (never Pending for the supervisor). */
async function loadJobsheetForRun(tx: Tx, role: RoleKey, id: number) {
  const [js] = await tx
    .select({
      id: jobsheets.id,
      jobsheetNo: jobsheets.jobsheetNo,
      orderId: jobsheets.orderId,
      status: jobsheets.status,
      frames: jobsheets.frames,
      picks: jobsheets.picks,
      runningMachineId: jobsheets.runningMachineId,
      isDeleted: jobsheets.isDeleted,
      orderNo: orders.orderNo,
    })
    .from(jobsheets)
    .innerJoin(orders, eq(orders.id, jobsheets.orderId))
    .where(eq(jobsheets.id, id));
  if (!js || js.isDeleted || !canRoleSeeJobsheetStatus(role, js.status)) throw notFound('Jobsheet');
  if (js.status === JOBSHEET_STATUS.PENDING) throw notFound('Jobsheet');
  return { ...js, ref: jobsheetRef(js.orderNo, js.jobsheetNo) };
}

async function activeMachine(tx: Tx, machineId: number, field: string) {
  const [m] = await tx
    .select({ id: machines.id, machineNo: machines.machineNo, isActive: machines.isActive, isDeleted: machines.isDeleted })
    .from(machines)
    .where(eq(machines.id, machineId));
  if (!m || m.isDeleted) throw conflict('This machine no longer exists. Refresh and pick again.', field);
  if (!m.isActive) throw conflict(`Machine ${m.machineNo} is inactive. Pick an active machine.`, field);
  return m;
}

/** Sent → Ongoing on one of the jobsheet's machines. */
export async function startJobsheet(role: RoleKey, id: number, input: unknown): Promise<JobsheetActionResult> {
  const { machineId } = jobsheetStartSchema.parse(input);
  return db.transaction(async (tx) => {
    const js = await loadJobsheetForRun(tx, role, id);
    if (js.status !== JOBSHEET_STATUS.SENT) throw conflict(`${js.ref} has already been started.`);
    const [assigned] = await tx
      .select({ machineId: jobsheetMachines.machineId })
      .from(jobsheetMachines)
      .where(and(eq(jobsheetMachines.jobsheetId, id), eq(jobsheetMachines.machineId, machineId)));
    if (!assigned) throw conflict('This machine is not assigned to this jobsheet.', 'machineId');
    const machine = await activeMachine(tx, machineId, 'machineId');

    const updated = await tx
      .update(jobsheets)
      .set({ status: JOBSHEET_STATUS.ONGOING, runningMachineId: machineId, startedAt: now() })
      .where(and(eq(jobsheets.id, id), eq(jobsheets.status, JOBSHEET_STATUS.SENT)))
      .returning({ id: jobsheets.id });
    if (!updated.length) throw conflict(`${js.ref} has already been started.`);
    await writeEvents(tx, role, [{ jobsheetId: id, event: 'started', machineId }]);
    await recomputeOrderStatus(js.orderId, role, tx);
    return { id, jobsheetNo: js.jobsheetNo, orderNo: js.orderNo, status: JOBSHEET_STATUS.ONGOING, machineNo: machine.machineNo };
  });
}

/** Ongoing → Completed with the actual frames made. */
export async function completeJobsheet(role: RoleKey, id: number, input: unknown): Promise<JobsheetActionResult> {
  const { completedFrames } = jobsheetCompleteSchema.parse(input);
  return db.transaction(async (tx) => {
    const js = await loadJobsheetForRun(tx, role, id);
    if (js.status !== JOBSHEET_STATUS.ONGOING) {
      throw conflict(
        js.status === JOBSHEET_STATUS.COMPLETED ? `${js.ref} is already completed.` : `${js.ref} hasn't been started yet.`,
      );
    }
    const updated = await tx
      .update(jobsheets)
      .set({ status: JOBSHEET_STATUS.COMPLETED, completedFrames, completedAt: now() })
      .where(and(eq(jobsheets.id, id), eq(jobsheets.status, JOBSHEET_STATUS.ONGOING)))
      .returning({ id: jobsheets.id });
    if (!updated.length) throw conflict(`${js.ref} is already completed.`);
    await writeEvents(tx, role, [{ jobsheetId: id, event: 'completed', machineId: js.runningMachineId, frames: completedFrames }]);
    await recomputeOrderStatus(js.orderId, role, tx);
    const [m] = js.runningMachineId
      ? await tx.select({ machineNo: machines.machineNo }).from(machines).where(eq(machines.id, js.runningMachineId))
      : [];
    return { id, jobsheetNo: js.jobsheetNo, orderNo: js.orderNo, status: JOBSHEET_STATUS.COMPLETED, machineNo: m?.machineNo ?? null };
  });
}

/**
 * Completes the running jobsheet with the frames made so far and creates a new Sent jobsheet for the rest,
 * with the chosen machine pre-selected at Start. The order's jobsheet plan doesn't change.
 */
export async function changeMachine(role: RoleKey, id: number, input: unknown): Promise<JobsheetChangeMachineResult> {
  const data = jobsheetChangeMachineSchema.parse(input);
  return db.transaction(async (tx) => {
    const js = await loadJobsheetForRun(tx, role, id);
    if (js.status !== JOBSHEET_STATUS.ONGOING) {
      throw conflict(`${js.ref} isn't running, so its machine can't be changed.`);
    }
    if (data.completedFrames > js.frames) {
      throw badRequest(`Can't be more than the ${js.frames} frames assigned.`, 'completedFrames');
    }

    const updated = await tx
      .update(jobsheets)
      .set({ status: JOBSHEET_STATUS.COMPLETED, completedFrames: data.completedFrames, completedAt: now() })
      .where(and(eq(jobsheets.id, id), eq(jobsheets.status, JOBSHEET_STATUS.ONGOING)))
      .returning({ id: jobsheets.id });
    if (!updated.length) throw conflict(`${js.ref} was just completed. Refresh and try again.`);

    // The new jobsheet may run on any active machine; the chosen one is pre-selected at Start.
    const allActive = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.isDeleted, false), eq(machines.isActive, true)));
    const [created] = await insertJobsheets(
      tx,
      role,
      js.orderId,
      [data.nextFrames],
      js.picks,
      allActive.map((m) => m.id),
      {
        status: JOBSHEET_STATUS.SENT,
        parentJobsheetId: id,
        note: `Continued from ${jobsheetRefShort(js.orderNo, js.jobsheetNo)}`,
      },
    );
    await writeEvents(tx, role, [
      {
        jobsheetId: id,
        event: 'machine_changed',
        machineId: js.runningMachineId,
        frames: data.completedFrames,
        note: `Continued as ${jobsheetRefShort(js.orderNo, created.jobsheetNo)}`,
      },
    ]);
    await recomputeOrderStatus(js.orderId, role, tx);
    return {
      orderNo: js.orderNo,
      completed: { id, jobsheetNo: js.jobsheetNo, frames: data.completedFrames },
      created,
    };
  });
}

