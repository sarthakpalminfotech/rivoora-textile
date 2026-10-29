import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  availableAfterReserved,
  formatKg,
  gramsToKg,
  kgToGrams,
  PROGRAM_STOP_ERROR_TEXT,
  TFO_SECTIONS,
  tfoPendingProgramInputSchema,
  tfoPendingProgramsCreateSchema,
  tfoPendingStartSchema,
  tfoProgramStopSchema,
  tfoSectionLabel,
  validateProgramStop,
  YARN_ZONE_CONFIG,
  type BoxDestination,
  type Paginated,
  type RoleKey,
  type TfoBoard,
  type TfoPendingProgram,
  type TfoProgram,
  type TfoSection,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import { tfoMachines, tfoPendingPrograms, tfoPrograms, warpingQualities, yarnBoxes, yarnLots, yarnParties, yarnQualities, yarnStockMoves, yarnTransfers } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { actor, addStock, balanceG, nowIso, qualityNames, reservedG, systemQualityId, takeStock } from './yarn-ledger';

/**
 * Sprint 17 → 20 — TFO programs: Pending → Running → Completed.
 * - Create (owners, `canPlanYarn`): no machine yet; the raw kg are RESERVED on their lot in TFO raw stock (nothing else
 *   can take reserved stock — see `reservedG` / `takeStock`). Edit / cancel while pending.
 * - Start (the floor): pick an idle section of an active machine → Running; the raw kg leave TFO raw stock now with the
 *   lot (`tfo_issue`) and the reservation ends. One running program per section (partial unique index + a check).
 * - Stop: the output is recorded as BOXES under one warping quality (TFO output = total net wt, `tfo_output` per box),
 *   boxes may go straight to Warping / Direct consumption (a transfer per destination), raw returned goes back with
 *   the program's lot (`tfo_return`).
 */

const qName = (col: 'raw_quality_id' | 'output_quality_id') =>
  sql<string>`(SELECT q.name FROM yarn_qualities q WHERE q.id = "tfo_programs".${sql.raw(`"${col}"`)})`;
const uName = (col: 'started_by_user_id' | 'stopped_by_user_id') =>
  sql<string | null>`(SELECT u.name FROM users u WHERE u.id = "tfo_programs".${sql.raw(`"${col}"`)})`;

const programColumns = {
  id: tfoPrograms.id,
  machineId: tfoPrograms.machineId,
  machineNo: tfoMachines.machineNo,
  section: tfoPrograms.section,
  rawQualityId: tfoPrograms.rawQualityId,
  rawQualityName: qName('raw_quality_id'),
  rawG: tfoPrograms.rawG,
  outputQualityId: tfoPrograms.outputQualityId,
  outputQualityName: qName('output_quality_id'),
  windingMeter: tfoPrograms.windingMeter,
  denierFilament: tfoPrograms.denierFilament,
  tpm: tfoPrograms.tpm,
  direction: tfoPrograms.direction,
  note: tfoPrograms.note,
  status: tfoPrograms.status,
  startedAt: tfoPrograms.startedAt,
  startedRole: tfoPrograms.startedRole,
  startedByName: uName('started_by_user_id'),
  stoppedAt: tfoPrograms.stoppedAt,
  stoppedRole: tfoPrograms.stoppedRole,
  stoppedByName: uName('stopped_by_user_id'),
  twistedG: tfoPrograms.twistedG,
  twistedMeters: tfoPrograms.twistedMeters,
  returnedRawG: tfoPrograms.returnedRawG,
  stopNote: tfoPrograms.stopNote,
  lotId: tfoPrograms.lotId,
};

const programsFrom = (tx: DbOrTx) => tx.select(programColumns).from(tfoPrograms).innerJoin(tfoMachines, eq(tfoMachines.id, tfoPrograms.machineId));
type ProgramRow = Awaited<ReturnType<typeof programsFrom>>[number];
type LotInfo = { id: number; lotNo: string; partyName: string };

async function lotsById(tx: DbOrTx, ids: (number | null)[]): Promise<Map<number, LotInfo>> {
  const unique = [...new Set(ids.filter((v): v is number => v !== null))];
  if (!unique.length) return new Map();
  const rows = await tx
    .select({ id: yarnLots.id, lotNo: yarnLots.lotNo, partyName: yarnParties.name })
    .from(yarnLots)
    .innerJoin(yarnParties, eq(yarnParties.id, yarnLots.partyId))
    .where(inArray(yarnLots.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Programs → DTOs with their lot, boxes and stop quality (two extra queries for the whole list). */
async function toPrograms(tx: DbOrTx, rows: ProgramRow[]): Promise<TfoProgram[]> {
  const ids = rows.map((r) => r.id);
  const [lots, boxes] = await Promise.all([
    lotsById(
      tx,
      rows.map((r) => r.lotId),
    ),
    ids.length
      ? tx
          .select({
            id: yarnBoxes.id,
            programId: yarnBoxes.programId,
            boxNo: yarnBoxes.boxNo,
            rolls: yarnBoxes.rolls,
            grossG: yarnBoxes.grossG,
            netG: yarnBoxes.netG,
            avgG: yarnBoxes.avgG,
            zone: yarnBoxes.zone,
            warpingQualityId: yarnBoxes.warpingQualityId,
            warpingQualityName: warpingQualities.name,
          })
          .from(yarnBoxes)
          .innerJoin(warpingQualities, eq(warpingQualities.id, yarnBoxes.warpingQualityId))
          .where(inArray(yarnBoxes.programId, ids))
          .orderBy(asc(yarnBoxes.id))
      : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const own = boxes.filter((b) => b.programId === r.id);
    return {
      id: r.id,
      machineId: r.machineId,
      machineNo: r.machineNo,
      section: r.section,
      rawQuality: { id: r.rawQualityId, name: r.rawQualityName },
      rawG: r.rawG,
      outputQuality: { id: r.outputQualityId, name: r.outputQualityName },
      windingMeter: r.windingMeter,
      denierFilament: r.denierFilament,
      tpm: r.tpm,
      direction: r.direction,
      note: r.note,
      status: r.status,
      startedAt: r.startedAt,
      startedBy: { role: r.startedRole, userName: r.startedByName },
      stoppedAt: r.stoppedAt,
      stoppedBy: r.stoppedAt ? { role: r.stoppedRole, userName: r.stoppedByName } : null,
      twistedG: r.twistedG,
      twistedMeters: r.twistedMeters,
      returnedRawG: r.returnedRawG,
      stopNote: r.stopNote,
      lot: r.lotId !== null ? (lots.get(r.lotId) ?? null) : null,
      warpingQuality: own[0] ? { id: own[0].warpingQualityId, name: own[0].warpingQualityName } : null,
      boxes: own.map((b) => ({ id: b.id, boxNo: b.boxNo, rolls: b.rolls, grossG: b.grossG, netG: b.netG, avgG: b.avgG, currentZone: b.zone })),
    };
  });
}

export async function getProgram(id: number, tx: DbOrTx = db): Promise<TfoProgram> {
  const [row] = await programsFrom(tx).where(eq(tfoPrograms.id, id));
  if (!row) throw notFound('Program');
  return (await toPrograms(tx, [row]))[0];
}

/* ------------------------------------------------------------------ */
/* pending programs                                                     */
/* ------------------------------------------------------------------ */

const pendingColumns = {
  id: tfoPendingPrograms.id,
  rawQualityId: tfoPendingPrograms.rawQualityId,
  rawQualityName: sql<string>`(SELECT q.name FROM yarn_qualities q WHERE q.id = "tfo_pending_programs"."raw_quality_id")`,
  lotId: tfoPendingPrograms.lotId,
  rawG: tfoPendingPrograms.rawG,
  outputQualityId: tfoPendingPrograms.outputQualityId,
  outputQualityName: sql<string>`(SELECT q.name FROM yarn_qualities q WHERE q.id = "tfo_pending_programs"."output_quality_id")`,
  windingMeter: tfoPendingPrograms.windingMeter,
  denierFilament: tfoPendingPrograms.denierFilament,
  tpm: tfoPendingPrograms.tpm,
  direction: tfoPendingPrograms.direction,
  note: tfoPendingPrograms.note,
  status: tfoPendingPrograms.status,
  createdAt: tfoPendingPrograms.createdAt,
  createdByName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = "tfo_pending_programs"."created_by_user_id")`,
};
const pendingFrom = (tx: DbOrTx) => tx.select(pendingColumns).from(tfoPendingPrograms);
type PendingRow = Awaited<ReturnType<typeof pendingFrom>>[number];

async function toPending(tx: DbOrTx, rows: PendingRow[]): Promise<TfoPendingProgram[]> {
  const lots = await lotsById(
    tx,
    rows.map((r) => r.lotId),
  );
  return rows.map((r) => ({
    id: r.id,
    rawQuality: { id: r.rawQualityId, name: r.rawQualityName },
    lot: r.lotId !== null ? (lots.get(r.lotId) ?? null) : null,
    rawG: r.rawG,
    outputQuality: { id: r.outputQualityId, name: r.outputQualityName },
    windingMeter: r.windingMeter,
    denierFilament: r.denierFilament,
    tpm: r.tpm,
    direction: r.direction,
    note: r.note,
    createdAt: r.createdAt,
    createdBy: { userName: r.createdByName, role: null },
  }));
}

/** GET /yarn/tfo/pending — programs waiting for a section, oldest first. */
export async function listPendingPrograms(tx: DbOrTx = db): Promise<TfoPendingProgram[]> {
  const rows = await pendingFrom(tx).where(eq(tfoPendingPrograms.status, 'pending')).orderBy(asc(tfoPendingPrograms.id));
  return toPending(tx, rows);
}

async function getPending(tx: DbOrTx, id: number): Promise<PendingRow> {
  const [row] = await pendingFrom(tx).where(eq(tfoPendingPrograms.id, id));
  if (!row) throw notFound('Program');
  return row;
}

/** 400 when the lot is not a lot of that quality. */
async function checkLot(tx: Tx, lotId: number | null, qualityId: number, field: string) {
  if (lotId === null) return;
  const [lot] = await tx.select({ qualityId: yarnLots.qualityId }).from(yarnLots).where(eq(yarnLots.id, lotId));
  if (!lot) throw badRequest('That lot no longer exists — pick another', field);
  if (lot.qualityId !== qualityId) throw badRequest('That lot is of another quality', field);
}

/**
 * After writing pending rows: what pending programs reserve on (quality, lot) must still fit in the TFO raw balance —
 * 409 "Only 12 kg of raw yarn 75D (lot 123) free in TFO" otherwise (the transaction rolls back).
 */
async function assertReservationFits(tx: Tx, qualityId: number, lotId: number | null, qualityName: string, field: string) {
  const balance = await balanceG(tx, 'tfo', 'raw', qualityId, { lotId });
  const reserved = await reservedG(tx, 'tfo', 'raw', qualityId, { lotId });
  if (reserved > balance) {
    const [lot] = lotId === null ? [] : await tx.select({ lotNo: yarnLots.lotNo }).from(yarnLots).where(eq(yarnLots.id, lotId));
    const where = lotId === null ? 'No lot' : `lot ${lot?.lotNo ?? lotId}`;
    // `reserved` includes this program — free before it = balance − (reserved − this).
    throw conflict(`Not enough raw yarn ${qualityName} (${where}) free in ${YARN_ZONE_CONFIG.tfo.label}: ${formatKg(balance)} in stock, ${formatKg(reserved)} would be reserved`, field);
  }
}

type PendingInput = ReturnType<typeof tfoPendingProgramInputSchema.parse>;

const pendingValues = (p: PendingInput) => ({
  rawQualityId: p.rawQualityId,
  lotId: p.lotId ?? null,
  rawG: kgToGrams(p.rawKg),
  outputQualityId: p.outputQualityId,
  windingMeter: p.windingMeter,
  denierFilament: p.denierFilament,
  tpm: p.tpm,
  direction: p.direction,
  note: p.note,
});

/** POST /yarn/tfo/pending — one or more programs (owners). Each reserves its raw kg on its lot; all or nothing. */
export async function createPendingPrograms(role: RoleKey, input: unknown): Promise<TfoPendingProgram[]> {
  const data = tfoPendingProgramsCreateSchema.parse(input);
  return db.transaction(async (tx) => {
    const names = await qualityNames(
      tx,
      data.programs.flatMap((p) => [p.rawQualityId, p.outputQualityId]),
      'programs',
    );
    const who = actor(role);
    const ids: number[] = [];
    for (const [i, p] of data.programs.entries()) {
      await checkLot(tx, p.lotId ?? null, p.rawQualityId, `programs.${i}.lotId`);
      const [row] = await tx
        .insert(tfoPendingPrograms)
        .values({ ...pendingValues(p), status: 'pending', createdByUserId: who.userId })
        .returning({ id: tfoPendingPrograms.id });
      ids.push(row.id);
      await assertReservationFits(tx, p.rawQualityId, p.lotId ?? null, names.get(p.rawQualityId)!, `programs.${i}.rawKg`);
    }
    const rows = await pendingFrom(tx).where(inArray(tfoPendingPrograms.id, ids)).orderBy(asc(tfoPendingPrograms.id));
    return toPending(tx, rows);
  });
}

/** PUT /yarn/tfo/pending/:id — edit while pending (the reservation follows the new quality / lot / kg). */
export async function updatePendingProgram(_role: RoleKey, id: number, input: unknown): Promise<TfoPendingProgram> {
  const p = tfoPendingProgramInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const names = await qualityNames(tx, [p.rawQualityId, p.outputQualityId], 'rawQualityId');
    await checkLot(tx, p.lotId ?? null, p.rawQualityId, 'lotId');
    const done = await tx
      .update(tfoPendingPrograms)
      .set({ ...pendingValues(p), updatedAt: nowIso() })
      .where(and(eq(tfoPendingPrograms.id, id), eq(tfoPendingPrograms.status, 'pending')))
      .returning({ id: tfoPendingPrograms.id });
    if (!done.length) {
      await getPending(tx, id);
      throw conflict('This program is no longer pending — refresh and try again.');
    }
    await assertReservationFits(tx, p.rawQualityId, p.lotId ?? null, names.get(p.rawQualityId)!, 'rawKg');
    return (await toPending(tx, [await getPending(tx, id)]))[0];
  });
}

/** POST /yarn/tfo/pending/:id/cancel — releases the reservation. */
export async function cancelPendingProgram(role: RoleKey, id: number): Promise<{ id: number }> {
  return db.transaction(async (tx) => {
    const who = actor(role);
    const done = await tx
      .update(tfoPendingPrograms)
      .set({ status: 'cancelled', cancelledAt: nowIso(), cancelledByUserId: who.userId, updatedAt: nowIso() })
      .where(and(eq(tfoPendingPrograms.id, id), eq(tfoPendingPrograms.status, 'pending')))
      .returning({ id: tfoPendingPrograms.id });
    if (!done.length) {
      await getPending(tx, id);
      throw conflict('This program is no longer pending — refresh and try again.');
    }
    return { id };
  });
}

const isRunningUnique = (err: unknown) => /tfo_programs_running_unique|tfo_programs\.machine_id/i.test(String((err as Error)?.message ?? err));

/**
 * POST /yarn/tfo/pending/:id/start — runs a pending program on an idle section of an active machine. The pending row is
 * marked started FIRST (its reservation ends), then the raw kg leave TFO raw stock with the lot (`tfo_issue`).
 */
export async function startPendingProgram(role: RoleKey, pendingId: number, input: unknown): Promise<TfoProgram> {
  const data = tfoPendingStartSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const pending = await getPending(tx, pendingId);
      if (pending.status !== 'pending') throw conflict('This program is no longer pending — refresh and try again.');
      const [machine] = await tx
        .select({ id: tfoMachines.id, machineNo: tfoMachines.machineNo, isActive: tfoMachines.isActive })
        .from(tfoMachines)
        .where(and(eq(tfoMachines.id, data.machineId), eq(tfoMachines.isDeleted, false)));
      if (!machine) throw notFound('TFO machine');
      if (!machine.isActive) throw conflict(`TFO machine ${machine.machineNo} is inactive.`, 'machineId');
      const label = tfoSectionLabel(machine.machineNo, data.section);
      const [busy] = await tx
        .select({ id: tfoPrograms.id })
        .from(tfoPrograms)
        .where(and(eq(tfoPrograms.machineId, data.machineId), eq(tfoPrograms.section, data.section), eq(tfoPrograms.status, 'running')));
      if (busy) throw conflict(`A program is already running on ${label}.`, 'section');
      const who = actor(role);
      const at = nowIso();
      const [p] = await tx
        .insert(tfoPrograms)
        .values({
          machineId: data.machineId,
          section: data.section,
          rawQualityId: pending.rawQualityId,
          rawG: pending.rawG,
          outputQualityId: pending.outputQualityId,
          windingMeter: pending.windingMeter,
          denierFilament: pending.denierFilament,
          tpm: pending.tpm,
          direction: pending.direction,
          note: pending.note,
          status: 'running',
          startedAt: at,
          startedByUserId: who.userId,
          startedRole: role,
          lotId: pending.lotId,
          pendingProgramId: pending.id,
        })
        .returning({ id: tfoPrograms.id });
      const started = await tx
        .update(tfoPendingPrograms)
        .set({ status: 'started', startedProgramId: p.id, updatedAt: at })
        .where(and(eq(tfoPendingPrograms.id, pending.id), eq(tfoPendingPrograms.status, 'pending')))
        .returning({ id: tfoPendingPrograms.id });
      if (!started.length) throw conflict('This program is no longer pending — refresh and try again.');
      await takeStock(tx, {
        zone: 'tfo',
        item: 'raw',
        qualityId: pending.rawQualityId,
        lotId: pending.lotId,
        qtyG: pending.rawG,
        kind: 'tfo_issue',
        refType: 'program',
        refId: p.id,
        note: pending.note,
        role,
        createdAt: at,
        qualityName: pending.rawQualityName,
        field: 'rawKg',
      });
      return getProgram(p.id, tx);
    });
  } catch (err) {
    if (isRunningUnique(err)) throw conflict('A program is already running on this section.', 'section');
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* board + history                                                      */
/* ------------------------------------------------------------------ */

/** GET /yarn/tfo/board — active machines + running programs + pending programs + TFO raw stock (balance / reserved). */
export async function tfoBoard(): Promise<TfoBoard> {
  const [machines, runningRows, pending, stock, reserved] = await Promise.all([
    db
      .select({ id: tfoMachines.id, machineNo: tfoMachines.machineNo, name: tfoMachines.name })
      .from(tfoMachines)
      .where(and(eq(tfoMachines.isDeleted, false), eq(tfoMachines.isActive, true)))
      .orderBy(asc(tfoMachines.machineNo)),
    programsFrom(db).where(eq(tfoPrograms.status, 'running')),
    listPendingPrograms(db),
    db
      .select({
        id: yarnQualities.id,
        name: yarnQualities.name,
        denier: yarnQualities.denier,
        filament: yarnQualities.filament,
        g: sql<number>`COALESCE(SUM(${yarnStockMoves.qtyG}), 0)`,
      })
      .from(yarnStockMoves)
      .innerJoin(yarnQualities, eq(yarnQualities.id, yarnStockMoves.qualityId))
      .where(and(eq(yarnStockMoves.zone, 'tfo'), eq(yarnStockMoves.item, 'raw')))
      .groupBy(yarnQualities.id)
      .orderBy(sql`lower(${yarnQualities.name})`),
    db
      .select({ id: tfoPendingPrograms.rawQualityId, g: sql<number>`COALESCE(SUM(${tfoPendingPrograms.rawG}), 0)` })
      .from(tfoPendingPrograms)
      .where(eq(tfoPendingPrograms.status, 'pending'))
      .groupBy(tfoPendingPrograms.rawQualityId),
  ]);
  const programs = await toPrograms(db, runningRows);
  return {
    machines: machines.map((m) => ({
      ...m,
      sections: TFO_SECTIONS.map((section) => ({ section, program: programs.find((p) => p.machineId === m.id && p.section === section) ?? null })),
    })),
    runningSections: programs.filter((p) => machines.some((m) => m.id === p.machineId)).length,
    pending,
    rawStock: stock
      .map((s) => {
        const rawG = Number(s.g);
        const reservedG = Number(reserved.find((r) => r.id === s.id)?.g ?? 0);
        return { quality: { id: s.id, name: s.name, denier: s.denier, filament: s.filament }, rawG, reservedG, availableG: availableAfterReserved(rawG, reservedG) };
      })
      .filter((s) => s.rawG > 0),
  };
}

/** GET /yarn/tfo/programs?machineId=&section= — program history (newest first). */
export async function listPrograms(q: { page: number; limit: number; machineId?: number; section?: TfoSection }): Promise<Paginated<TfoProgram>> {
  const where = and(q.machineId ? eq(tfoPrograms.machineId, q.machineId) : undefined, q.section ? eq(tfoPrograms.section, q.section) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    programsFrom(db).where(where).orderBy(desc(tfoPrograms.startedAt), desc(tfoPrograms.id)).limit(q.limit).offset((q.page - 1) * q.limit),
    db.select({ total: count() }).from(tfoPrograms).where(where),
  ]);
  return { items: await toPrograms(db, rows), page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

/* ------------------------------------------------------------------ */
/* stop                                                                 */
/* ------------------------------------------------------------------ */

const isBoxNoUnique = (err: unknown) => /yarn_boxes_box_no_unique|yarn_boxes\.box_no/i.test(String((err as Error)?.message ?? err));

/**
 * POST /yarn/tfo/programs/:id/stop — Completed. Boxes are created (stock = net wt) under the stop's warping quality,
 * each into TFO first (`tfo_output`), then moved by one transfer per destination (Warping / Direct consumption).
 * Returned raw goes back to TFO raw stock with the program's lot. The section becomes idle.
 */
export async function stopProgram(role: RoleKey, id: number, input: unknown): Promise<TfoProgram> {
  const data = tfoProgramStopSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const p = await getProgram(id, tx);
      if (p.status !== 'running') throw conflict(`The program on ${tfoSectionLabel(p.machineNo, p.section)} is already stopped.`);
      const [wq] = await tx
        .select({ id: warpingQualities.id, name: warpingQualities.name })
        .from(warpingQualities)
        .where(and(eq(warpingQualities.id, data.warpingQualityId), eq(warpingQualities.isDeleted, false)));
      if (!wq) throw badRequest('That warping quality no longer exists — pick another', 'warpingQualityId');
      const boxes = data.boxes.map((b) => ({ ...b, boxNo: b.boxNo.trim(), grossG: kgToGrams(b.grossKg), netG: kgToGrams(b.netKg), avgG: kgToGrams(b.avgKg) }));
      if (boxes.length) {
        const taken = await tx
          .select({ boxNo: yarnBoxes.boxNo })
          .from(yarnBoxes)
          .where(sql`lower(${yarnBoxes.boxNo}) IN (${sql.join(
            boxes.map((b) => sql`${b.boxNo.toLowerCase()}`),
            sql`, `,
          )})`);
        if (taken.length) {
          const i = boxes.findIndex((b) => taken.some((t) => t.boxNo.toLowerCase() === b.boxNo.toLowerCase()));
          throw conflict(`Box no. ${boxes[i].boxNo} is already used`, `boxes.${i}.boxNo`);
        }
      }
      const twistedG = boxes.reduce((s, b) => s + b.netG, 0);
      const returnedG = kgToGrams(data.returnedRawKg ?? 0);
      const err = validateProgramStop({ rawG: p.rawG, twistedG, returnedG });
      if (err) {
        throw badRequest(
          err === 'returned_too_much' ? `${PROGRAM_STOP_ERROR_TEXT[err]} (${gramsToKg(p.rawG)} kg)` : PROGRAM_STOP_ERROR_TEXT[err],
          err === 'returned_too_much' ? 'returnedRawKg' : 'boxes',
        );
      }
      const who = actor(role);
      const at = nowIso();
      const done = await tx
        .update(tfoPrograms)
        .set({
          status: 'completed',
          stoppedAt: at,
          stoppedByUserId: who.userId,
          stoppedRole: role,
          twistedG,
          twistedMeters: data.twistedMeters,
          returnedRawG: returnedG,
          stopNote: data.note,
        })
        .where(and(eq(tfoPrograms.id, id), eq(tfoPrograms.status, 'running')))
        .returning({ id: tfoPrograms.id });
      if (!done.length) throw conflict('The program changed meanwhile — refresh and try again.');

      const sysQ = await systemQualityId(tx);
      const label = tfoSectionLabel(p.machineNo, p.section);
      const created: { id: number; netG: number; zone: BoxDestination }[] = [];
      for (const b of boxes) {
        const [row] = await tx
          .insert(yarnBoxes)
          .values({
            boxNo: b.boxNo,
            programId: id,
            lotId: p.lot?.id ?? null,
            warpingQualityId: wq.id,
            rolls: b.rolls,
            grossG: b.grossG,
            netG: b.netG,
            avgG: b.avgG,
            zone: b.zone,
            status: 'in_stock',
            createdByUserId: who.userId,
          })
          .returning({ id: yarnBoxes.id });
        created.push({ id: row.id, netG: b.netG, zone: b.zone });
        await addStock(tx, {
          zone: 'tfo',
          item: 'twisted',
          qualityId: sysQ,
          boxId: row.id,
          warpingQualityId: wq.id,
          qtyG: b.netG,
          kind: 'tfo_output',
          refType: 'program',
          refId: id,
          note: data.note,
          role,
          createdAt: at,
        });
      }
      // Boxes that leave TFO at once: one transfer per destination, out of TFO and into the zone (box zone already set).
      for (const dest of ['warping', 'direct'] as const) {
        const moving = created.filter((b) => b.zone === dest);
        if (!moving.length) continue;
        const [t] = await tx
          .insert(yarnTransfers)
          .values({ fromZone: 'tfo', toZone: dest, what: 'twisted', note: `At stop of ${label}`, ...who, createdAt: at })
          .returning({ id: yarnTransfers.id });
        for (const b of moving) {
          const common = { item: 'twisted' as const, qualityId: sysQ, boxId: b.id, warpingQualityId: wq.id, qtyG: b.netG, refType: 'transfer' as const, refId: t.id, note: `At stop of ${label}`, role, createdAt: at };
          await takeStock(tx, { ...common, zone: 'tfo', kind: 'transfer_out', qualityName: wq.name, field: 'boxes' });
          await addStock(tx, { ...common, zone: dest, kind: 'transfer_in' });
        }
      }
      if (returnedG > 0) {
        await addStock(tx, {
          zone: 'tfo',
          item: 'raw',
          qualityId: p.rawQuality.id,
          lotId: p.lot?.id ?? null,
          qtyG: returnedG,
          kind: 'tfo_return',
          refType: 'program',
          refId: id,
          note: data.note,
          role,
          createdAt: at,
        });
      }
      return getProgram(id, tx);
    });
  } catch (err) {
    if (isBoxNoUnique(err)) throw conflict('A box no. on this stop is already used — refresh and try again.', 'boxes');
    throw err;
  }
}
