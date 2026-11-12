import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  availableAfterReserved,
  BOX_NO_COUNTER,
  boxNetG,
  checkHoldRolls,
  checkStartRolls,
  HOLD_ROLLS_ERROR_TEXT,
  partRollsLimit,
  tfoProgramHoldSchema,
  tfoProgramPartSchema,
  tfoProgramResumeSchema,
  tfoProgramStopLaterSchema,
  START_ROLLS_ERROR_TEXT,
  formatKg,
  gramsToKg,
  kgToGrams,
  PROGRAM_STOP_ERROR_TEXT,
  programSectionsLabel,
  rawFromRolls,
  TFO_SECTIONS,
  tfoOutputQualityName,
  tfoPendingProgramInputSchema,
  tfoPendingProgramsCreateSchema,
  tfoPendingStartSchema,
  tfoProgramStopSchema,
  tfoSectionLabel,
  validateProgramStop,
  YARN_ZONE_CONFIG,
  type Paginated,
  type RoleKey,
  type TfoBoard,
  type TfoPendingProgram,
  type TfoProgram,
  type TfoProgramEvent,
  type TfoProgramStatus,
  type TfoSection,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  tfoMachines,
  tfoPendingPrograms,
  tfoProgramEvents,
  tfoProgramSections,
  tfoPrograms,
  warpingQualities,
  yarnBoxes,
  yarnLots,
  yarnParties,
  yarnQualities,
  yarnStockMoves,
  users,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { currentFy, nextNumber } from '../lib/numbering';
import { actor, addStock, balanceG, nowIso, qualityNames, reservedG, systemQualityId, takeStock } from './yarn-ledger';

/**
 * Sprint 17 → 20b — TFO programs: Pending → Running → Completed.
 * - Create (owners, `canPlanYarn`): no machine yet; raw kg = rolls × winding kg, RESERVED on its lot in TFO raw stock
 *   (nothing else can take reserved stock — see `reservedG` / `takeStock`). Edit / cancel while pending.
 * - Start (the floor): one or more idle sections of active machines (`tfo_program_sections`; one running program per
 *   section) → Running; the raw kg leave TFO raw stock now with the lot (`tfo_issue`) and the reservation ends.
 * - Stop: frees every section. Boxes get system numbers (counter `yarn_box_no`), net = gross − roll weight × rolls, and
 *   an output quality named from the program (`tfoOutputQualityName`; S + Z programs: S or Z per box) that is found or
 *   created in the Warping qualities master. Every box stays in TFO (`tfo_output`); moving them is a normal transfer.
 *   Raw returned goes back with the program's lot (`tfo_return`).
 * - Sprint 24 (CR-20/21): Hold (rolls made / left; sections freed) ⇄ Resume (new idle sections); "Complete made part" =
 *   boxes for the rolls already made while the program goes on (it completes by itself once every roll is boxed); Stop ·
 *   enter boxes later → Box details pending → Save boxes → Completed. Every step is logged in `tfo_program_events`.
 */

const uName = (col: 'started_by_user_id' | 'stopped_by_user_id') =>
  sql<string | null>`(SELECT u.name FROM users u WHERE u.id = "tfo_programs".${sql.raw(`"${col}"`)})`;

const programColumns = {
  id: tfoPrograms.id,
  machineId: tfoPrograms.machineId,
  machineNo: tfoMachines.machineNo,
  section: tfoPrograms.section,
  rawQualityId: tfoPrograms.rawQualityId,
  rawQualityName: sql<string>`(SELECT q.name FROM yarn_qualities q WHERE q.id = "tfo_programs"."raw_quality_id")`,
  rawG: tfoPrograms.rawG,
  rolls: tfoPrograms.rolls,
  windingG: tfoPrograms.windingG,
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
  rollWeightG: tfoPrograms.rollWeightG,
  stopNote: tfoPrograms.stopNote,
  lotId: tfoPrograms.lotId,
  rollsMade: tfoPrograms.rollsMade,
  rollsDone: tfoPrograms.rollsDone,
  heldAt: tfoPrograms.heldAt,
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

/** Programs → DTOs with their sections, lot, boxes and output qualities (three extra queries for the whole list). */
async function toPrograms(tx: DbOrTx, rows: ProgramRow[]): Promise<TfoProgram[]> {
  const ids = rows.map((r) => r.id);
  const lots = await lotsById(
    tx,
    rows.map((r) => r.lotId),
  );
  const sections = ids.length
    ? await tx
        .select({
          programId: tfoProgramSections.programId,
          machineId: tfoProgramSections.machineId,
          machineNo: tfoMachines.machineNo,
          section: tfoProgramSections.section,
          isRunning: tfoProgramSections.isRunning,
        })
        .from(tfoProgramSections)
        .innerJoin(tfoMachines, eq(tfoMachines.id, tfoProgramSections.machineId))
        .where(inArray(tfoProgramSections.programId, ids))
        .orderBy(asc(tfoMachines.machineNo), asc(tfoProgramSections.section))
    : [];
  const events = ids.length
    ? await tx
        .select({
          id: tfoProgramEvents.id,
          programId: tfoProgramEvents.programId,
          kind: tfoProgramEvents.kind,
          rollsMade: tfoProgramEvents.rollsMade,
          rollsLeft: tfoProgramEvents.rollsLeft,
          rolls: tfoProgramEvents.rolls,
          twistedG: tfoProgramEvents.twistedG,
          sections: tfoProgramEvents.sections,
          note: tfoProgramEvents.note,
          role: tfoProgramEvents.role,
          userName: users.name,
          createdAt: tfoProgramEvents.createdAt,
        })
        .from(tfoProgramEvents)
        .leftJoin(users, eq(users.id, tfoProgramEvents.userId))
        .where(inArray(tfoProgramEvents.programId, ids))
        .orderBy(asc(tfoProgramEvents.id))
    : [];
  const boxes = ids.length
    ? await tx
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
          fy: yarnBoxes.fy,
          eventId: yarnBoxes.programEventId,
        })
        .from(yarnBoxes)
        .innerJoin(warpingQualities, eq(warpingQualities.id, yarnBoxes.warpingQualityId))
        // Sprint 24: only the boxes made by the program (not warping "remaining" rows linked to it).
        .where(and(inArray(yarnBoxes.programId, ids), eq(yarnBoxes.kind, 'tfo')))
        .orderBy(asc(yarnBoxes.id))
    : [];
  return rows.map((r) => {
    const own = boxes.filter((b) => b.programId === r.id);
    // Sprint 24: a running program shows the sections it runs on now; otherwise every section it ran on (once each).
    const mine = sections.filter((s) => s.programId === r.id && (r.status !== 'running' || s.isRunning));
    const ownSections = [...new Map(mine.map((s) => [`${s.machineId}|${s.section}`, { machineId: s.machineId, machineNo: s.machineNo, section: s.section }])).values()];
    const wqs = new Map(own.map((b) => [b.warpingQualityId, { id: b.warpingQualityId, name: b.warpingQualityName }]));
    return {
      id: r.id,
      machineId: r.machineId,
      machineNo: r.machineNo,
      section: r.section,
      sections: ownSections.length ? ownSections : [{ machineId: r.machineId, machineNo: r.machineNo, section: r.section }],
      rawQuality: { id: r.rawQualityId, name: r.rawQualityName },
      rawG: r.rawG,
      rolls: r.rolls,
      windingG: r.windingG,
      windingMeter: r.windingMeter,
      denierFilament: r.denierFilament,
      tpm: r.tpm,
      direction: r.direction,
      note: r.note,
      status: r.status as TfoProgramStatus,
      startedAt: r.startedAt,
      startedBy: { role: r.startedRole, userName: r.startedByName },
      stoppedAt: r.stoppedAt,
      stoppedBy: r.stoppedAt ? { role: r.stoppedRole, userName: r.stoppedByName } : null,
      twistedG: r.twistedG,
      twistedMeters: r.twistedMeters,
      returnedRawG: r.returnedRawG,
      rollWeightG: r.rollWeightG,
      stopNote: r.stopNote,
      lot: r.lotId !== null ? (lots.get(r.lotId) ?? null) : null,
      warpingQualities: [...wqs.values()],
      boxes: own.map((b) => ({
        id: b.id,
        boxNo: b.boxNo,
        rolls: b.rolls,
        grossG: b.grossG,
        netG: b.netG,
        avgG: b.avgG > 0 ? b.avgG : null,
        warpingQuality: { id: b.warpingQualityId, name: b.warpingQualityName },
        currentZone: b.zone,
        fy: b.fy,
        eventId: b.eventId,
      })),
      rollsMade: r.rollsMade,
      rollsDone: r.rollsDone,
      heldAt: r.heldAt,
      events: events.filter((e) => e.programId === r.id).map(({ programId: _p, ...e }) => e),
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
  rolls: tfoPendingPrograms.rolls,
  windingG: tfoPendingPrograms.windingG,
  outputQualityId: tfoPendingPrograms.outputQualityId,
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
    rolls: r.rolls,
    windingG: r.windingG,
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
 * 409 otherwise (the transaction rolls back).
 */
async function assertReservationFits(tx: Tx, qualityId: number, lotId: number | null, qualityName: string, field: string) {
  const balance = await balanceG(tx, 'tfo', 'raw', qualityId, { lotId });
  const reserved = await reservedG(tx, 'tfo', 'raw', qualityId, { lotId });
  if (reserved > balance) {
    const [lot] = lotId === null ? [] : await tx.select({ lotNo: yarnLots.lotNo }).from(yarnLots).where(eq(yarnLots.id, lotId));
    const where = lotId === null ? 'No lot' : `lot ${lot?.lotNo ?? lotId}`;
    throw conflict(`Not enough raw yarn ${qualityName} (${where}) free in ${YARN_ZONE_CONFIG.tfo.label}: ${formatKg(balance)} in stock, ${formatKg(reserved)} would be reserved`, field);
  }
}

type PendingInput = ReturnType<typeof tfoPendingProgramInputSchema.parse>;

/** Columns of a pending program; raw kg = rolls × winding kg. The output quality column (Sprint 17) holds the raw quality. */
function pendingValues(p: PendingInput, field: string) {
  const windingG = kgToGrams(p.windingKg);
  const rawG = rawFromRolls(p.rolls, windingG);
  if (!(rawG > 0)) throw badRequest('Enter the rolls and winding kg', field);
  return {
    rawQualityId: p.rawQualityId,
    lotId: p.lotId ?? null,
    rolls: p.rolls,
    windingG,
    rawG,
    outputQualityId: p.rawQualityId,
    windingMeter: null,
    denierFilament: p.denierFilament,
    tpm: p.tpm,
    direction: p.direction,
    note: p.note,
  };
}

/** POST /yarn/tfo/pending — one or more programs (owners). Each reserves its raw kg on its lot; all or nothing. */
export async function createPendingPrograms(role: RoleKey, input: unknown): Promise<TfoPendingProgram[]> {
  const data = tfoPendingProgramsCreateSchema.parse(input);
  return db.transaction(async (tx) => {
    const names = await qualityNames(
      tx,
      data.programs.map((p) => p.rawQualityId),
      'programs',
    );
    const who = actor(role);
    const ids: number[] = [];
    for (const [i, p] of data.programs.entries()) {
      await checkLot(tx, p.lotId ?? null, p.rawQualityId, `programs.${i}.lotId`);
      const [row] = await tx
        .insert(tfoPendingPrograms)
        .values({ ...pendingValues(p, `programs.${i}.rolls`), status: 'pending', createdByUserId: who.userId })
        .returning({ id: tfoPendingPrograms.id });
      ids.push(row.id);
      await assertReservationFits(tx, p.rawQualityId, p.lotId ?? null, names.get(p.rawQualityId)!, `programs.${i}.rolls`);
    }
    const rows = await pendingFrom(tx).where(inArray(tfoPendingPrograms.id, ids)).orderBy(asc(tfoPendingPrograms.id));
    return toPending(tx, rows);
  });
}

/** PUT /yarn/tfo/pending/:id — edit while pending (the reservation follows the new quality / lot / kg). */
export async function updatePendingProgram(_role: RoleKey, id: number, input: unknown): Promise<TfoPendingProgram> {
  const p = tfoPendingProgramInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const names = await qualityNames(tx, [p.rawQualityId], 'rawQualityId');
    await checkLot(tx, p.lotId ?? null, p.rawQualityId, 'lotId');
    const done = await tx
      .update(tfoPendingPrograms)
      .set({ ...pendingValues(p, 'rolls'), updatedAt: nowIso() })
      .where(and(eq(tfoPendingPrograms.id, id), eq(tfoPendingPrograms.status, 'pending')))
      .returning({ id: tfoPendingPrograms.id });
    if (!done.length) {
      await getPending(tx, id);
      throw conflict('This program is no longer pending — refresh and try again.');
    }
    await assertReservationFits(tx, p.rawQualityId, p.lotId ?? null, names.get(p.rawQualityId)!, 'rolls');
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

type SectionPick = { machineId: number; section: TfoSection };

/**
 * The picked sections must be on active machines and idle (no running program on them); returns the first one (lowest
 * machine no., then A before B) — `tfo_programs.machine_id / section` keep it — and the "3A, 5B" label.
 */
async function idleSections(tx: Tx, picked: SectionPick[]): Promise<{ first: SectionPick; label: string }> {
  const machineIds = [...new Set(picked.map((s) => s.machineId))];
  const machines = await tx
    .select({ id: tfoMachines.id, machineNo: tfoMachines.machineNo, isActive: tfoMachines.isActive })
    .from(tfoMachines)
    .where(and(inArray(tfoMachines.id, machineIds), eq(tfoMachines.isDeleted, false)));
  for (const mid of machineIds) {
    const m = machines.find((x) => x.id === mid);
    if (!m) throw notFound('TFO machine');
    if (!m.isActive) throw conflict(`TFO machine ${m.machineNo} is inactive.`, 'sections');
  }
  const busy = await tx
    .select({ machineId: tfoProgramSections.machineId, section: tfoProgramSections.section })
    .from(tfoProgramSections)
    .where(and(inArray(tfoProgramSections.machineId, machineIds), eq(tfoProgramSections.isRunning, true)));
  const clash = picked.find((s) => busy.some((b) => b.machineId === s.machineId && b.section === s.section));
  if (clash) {
    throw conflict(`A program is already running on ${tfoSectionLabel(machines.find((m) => m.id === clash.machineId)!.machineNo, clash.section)}.`, 'sections');
  }
  const noOf = (id: number) => machines.find((m) => m.id === id)!.machineNo;
  const first = [...picked].sort((a, b) => noOf(a.machineId) - noOf(b.machineId) || a.section.localeCompare(b.section))[0];
  return { first, label: programSectionsLabel(picked.map((s) => ({ machineNo: noOf(s.machineId), section: s.section }))) };
}

const isRunningUnique = (err: unknown) => /tfo_program_sections_running_unique|tfo_programs_running_unique|tfo_program_sections\.machine_id|tfo_programs\.machine_id/i.test(String((err as Error)?.message ?? err));

/**
 * POST /yarn/tfo/pending/:id/start — runs a pending program on one or more idle sections of active machines. The pending
 * row is marked started FIRST (its reservation ends), then the raw kg leave TFO raw stock with the lot (`tfo_issue`).
 */
export async function startPendingProgram(role: RoleKey, pendingId: number, input: unknown): Promise<TfoProgram> {
  const data = tfoPendingStartSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const pending = await getPending(tx, pendingId);
      if (pending.status !== 'pending') throw conflict('This program is no longer pending — refresh and try again.');
      // Sprint 20c: start only part of the rolls — the rest stays a pending program with the same settings.
      const rollsErr = checkStartRolls(pending.rolls, data.rolls) ?? (data.rolls !== null && !pending.windingG ? 'no_rolls' : null);
      if (rollsErr) throw badRequest(START_ROLLS_ERROR_TEXT[rollsErr], 'rolls');
      const partial = data.rolls !== null && pending.rolls !== null && data.rolls < pending.rolls;
      const startRolls = partial ? data.rolls! : pending.rolls;
      const startRawG = partial ? rawFromRolls(data.rolls!, pending.windingG!) : pending.rawG;
      const { first } = await idleSections(tx, data.sections);
      const who = actor(role);
      const at = nowIso();
      const [p] = await tx
        .insert(tfoPrograms)
        .values({
          machineId: first.machineId,
          section: first.section,
          rawQualityId: pending.rawQualityId,
          rawG: startRawG,
          outputQualityId: pending.outputQualityId,
          windingMeter: pending.windingMeter,
          rolls: startRolls,
          windingG: pending.windingG,
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
      await tx.insert(tfoProgramSections).values(data.sections.map((s) => ({ programId: p.id, machineId: s.machineId, section: s.section, isRunning: true, createdAt: at })));
      const rest = partial ? pending.rolls! - data.rolls! : 0;
      const started = await tx
        .update(tfoPendingPrograms)
        .set(partial ? { rolls: rest, rawG: rawFromRolls(rest, pending.windingG!), updatedAt: at } : { status: 'started', startedProgramId: p.id, updatedAt: at })
        .where(and(eq(tfoPendingPrograms.id, pending.id), eq(tfoPendingPrograms.status, 'pending'), partial ? eq(tfoPendingPrograms.rolls, pending.rolls!) : undefined))
        .returning({ id: tfoPendingPrograms.id });
      if (!started.length) throw conflict('This program is no longer pending — refresh and try again.');
      await takeStock(tx, {
        zone: 'tfo',
        item: 'raw',
        qualityId: pending.rawQualityId,
        lotId: pending.lotId,
        qtyG: startRawG,
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
    if (isRunningUnique(err)) throw conflict('A program is already running on one of these sections.', 'sections');
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* board + history                                                      */
/* ------------------------------------------------------------------ */

/** GET /yarn/tfo/board — active machines + running programs (per section) + pending programs + TFO raw stock. */
export async function tfoBoard(): Promise<TfoBoard> {
  const [machines, runningRows, pending, stock, reserved] = await Promise.all([
    db
      .select({ id: tfoMachines.id, machineNo: tfoMachines.machineNo, name: tfoMachines.name })
      .from(tfoMachines)
      .where(and(eq(tfoMachines.isDeleted, false), eq(tfoMachines.isActive, true)))
      .orderBy(asc(tfoMachines.machineNo)),
    programsFrom(db).where(inArray(tfoPrograms.status, ['running', 'on_hold', 'box_pending'])),
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
  const open = await toPrograms(db, runningRows);
  const programs = open.filter((p) => p.status === 'running');
  const onSection = (machineId: number, section: TfoSection) => programs.find((p) => p.sections.some((s) => s.machineId === machineId && s.section === section)) ?? null;
  const sections = machines.map((m) => ({ ...m, sections: TFO_SECTIONS.map((section) => ({ section, program: onSection(m.id, section) })) }));
  return {
    machines: sections,
    runningSections: sections.reduce((n, m) => n + m.sections.filter((s) => s.program).length, 0),
    onHold: open.filter((p) => p.status === 'on_hold').sort((a, b) => (a.heldAt ?? '').localeCompare(b.heldAt ?? '')),
    boxPending: open.filter((p) => p.status === 'box_pending').sort((a, b) => (a.stoppedAt ?? '').localeCompare(b.stoppedAt ?? '')),
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

/** GET /yarn/tfo/programs?machineId=&section= — program history of a section (any of its sections), newest first. */
export async function listPrograms(q: { page: number; limit: number; machineId?: number; section?: TfoSection }): Promise<Paginated<TfoProgram>> {
  // Sprint 24: the one `system` row (Palti boxes) is never listed.
  const where = and(
    ne(tfoPrograms.status, 'system'),
    q.machineId
      ? sql`EXISTS (SELECT 1 FROM tfo_program_sections ps WHERE ps.program_id = ${tfoPrograms.id} AND ps.machine_id = ${q.machineId}${q.section ? sql` AND ps.section = ${q.section}` : sql``})`
      : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    programsFrom(db).where(where).orderBy(desc(tfoPrograms.startedAt), desc(tfoPrograms.id)).limit(q.limit).offset((q.page - 1) * q.limit),
    db.select({ total: count() }).from(tfoPrograms).where(where),
  ]);
  return { items: await toPrograms(db, rows), page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

/* ------------------------------------------------------------------ */
/* stop                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The next `n` free box numbers ("1", "2", …): counter `yarn_box_no`, skipping numbers already used by any box. Sprint 24:
 * also used by warping "remaining" rows and Palti boxes (one box counter).
 */
export async function allocateBoxNos(tx: Tx, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let guard = 0; out.length < n && guard < n + 10_000; guard++) {
    const no = String(await nextNumber(tx, BOX_NO_COUNTER));
    // Sprint 23: boxes restart each financial year — only a number used in this FY is taken.
    const [taken] = await tx.select({ id: yarnBoxes.id }).from(yarnBoxes).where(sql`lower(${yarnBoxes.boxNo}) = ${no} AND ${yarnBoxes.fy} = ${currentFy()}`).limit(1);
    if (!taken) out.push(no);
  }
  if (out.length < n) throw new Error('Could not allocate box numbers');
  return out;
}

/** The warping quality with this name (any case, active), created when it doesn't exist yet. */
async function findOrCreateWarpingQuality(tx: Tx, name: string): Promise<{ id: number; name: string }> {
  const [found] = await tx
    .select({ id: warpingQualities.id, name: warpingQualities.name })
    .from(warpingQualities)
    .where(and(sql`lower(${warpingQualities.name}) = lower(${name})`, eq(warpingQualities.isDeleted, false)))
    .limit(1);
  if (found) return found;
  const [row] = await tx
    .insert(warpingQualities)
    .values({ name, notes: 'Created at a TFO program stop' })
    .returning({ id: warpingQualities.id, name: warpingQualities.name });
  return row;
}

type BoxesInput = { rollWeightKg: number; boxes: { rolls: number; grossKg: number; avgKg: number | null; direction: 'S' | 'Z' | null }[] };

/** Box rows of a stop / part completion: net = gross − roll weight × rolls (> 0); S / Z per box for S + Z programs. */
function boxRows(p: TfoProgram, data: BoxesInput) {
  const rollWeightG = kgToGrams(data.rollWeightKg);
  const boxes = data.boxes.map((b, i) => {
    const grossG = kgToGrams(b.grossKg);
    const netG = boxNetG(grossG, rollWeightG, b.rolls);
    if (!(netG > 0)) throw badRequest('Gross kg must be more than roll weight × rolls', `boxes.${i}.grossKg`);
    const direction = p.direction === 'SZ' ? b.direction : p.direction;
    if (direction !== 'S' && direction !== 'Z') throw badRequest('Pick S or Z for this box', `boxes.${i}.direction`);
    return { rolls: b.rolls, grossG, netG, avgG: b.avgKg ? kgToGrams(b.avgKg) : 0, direction };
  });
  return { rollWeightG, boxes, twistedG: boxes.reduce((s, b) => s + b.netG, 0), rolls: boxes.reduce((s, b) => s + b.rolls, 0) };
}

/**
 * Creates the boxes (system numbers, output quality per direction found / created in the Warping qualities master) in TFO
 * stock (`tfo_output`), linked to the stop / part completion event.
 */
async function createProgramBoxes(tx: Tx, p: TfoProgram, rows: ReturnType<typeof boxRows>['boxes'], eventId: number, role: RoleKey, at: string, note: string | null) {
  // One output quality per direction ("75/36 Poly 75D-600-S"), found or created in the Warping qualities master.
  const qualityOf = new Map<string, { id: number; name: string }>();
  for (const dir of [...new Set(rows.map((b) => b.direction))]) {
    const name = tfoOutputQualityName({ denierFilament: p.denierFilament, rawQualityName: p.rawQuality.name, tpm: p.tpm, direction: dir });
    qualityOf.set(dir, await findOrCreateWarpingQuality(tx, name));
  }
  const sysQ = await systemQualityId(tx);
  const nos = await allocateBoxNos(tx, rows.length);
  const who = actor(role);
  for (const [i, b] of rows.entries()) {
    const wq = qualityOf.get(b.direction)!;
    const [row] = await tx
      .insert(yarnBoxes)
      .values({
        boxNo: nos[i],
        programId: p.id,
        lotId: p.lot?.id ?? null,
        warpingQualityId: wq.id,
        rolls: b.rolls,
        grossG: b.grossG,
        netG: b.netG,
        avgG: b.avgG,
        zone: 'tfo',
        status: 'in_stock',
        kind: 'tfo',
        programEventId: eventId,
        createdByUserId: who.userId,
      })
      .returning({ id: yarnBoxes.id });
    await addStock(tx, { zone: 'tfo', item: 'twisted', qualityId: sysQ, boxId: row.id, warpingQualityId: wq.id, qtyG: b.netG, kind: 'tfo_output', refType: 'program', refId: p.id, note, role, createdAt: at });
  }
}

async function writeEvent(
  tx: Tx,
  programId: number,
  kind: TfoProgramEvent['kind'],
  role: RoleKey,
  at: string,
  extra: Partial<Pick<TfoProgramEvent, 'rollsMade' | 'rollsLeft' | 'rolls' | 'twistedG' | 'sections' | 'note'>> = {},
): Promise<number> {
  const [row] = await tx
    .insert(tfoProgramEvents)
    .values({ programId, kind, role, userId: actor(role).userId, createdAt: at, ...extra })
    .returning({ id: tfoProgramEvents.id });
  return row.id;
}

const freeSections = (tx: Tx, id: number) => tx.update(tfoProgramSections).set({ isRunning: false }).where(eq(tfoProgramSections.programId, id));

/**
 * Stop (from Running or On hold) and Save boxes (from Box details pending) — the program is Completed and every section is
 * free. Boxes (system numbers, net = gross − roll weight × rolls) go into TFO stock under their output quality; returned raw
 * goes back with the lot. Boxes of earlier part completions count in the program's twisted kg.
 */
async function completeProgram(role: RoleKey, id: number, input: unknown, mode: 'stop' | 'boxes'): Promise<TfoProgram> {
  const data = tfoProgramStopSchema.parse(input);
  return db.transaction(async (tx) => {
    const p = await getProgram(id, tx);
    const label = programSectionsLabel(p.sections);
    const from: TfoProgramStatus[] = mode === 'stop' ? ['running', 'on_hold'] : ['box_pending'];
    if (!from.includes(p.status)) {
      throw conflict(
        mode === 'stop'
          ? p.status === 'box_pending'
            ? 'This program is already stopped — enter its boxes.'
            : `The program on ${label} is already stopped.`
          : p.status === 'completed'
            ? 'The boxes of this program are already saved.'
            : 'This program is not waiting for its boxes.',
      );
    }
    const { rollWeightG, boxes, twistedG: thisG, rolls } = boxRows(p, data);
    const priorG = p.twistedG ?? 0;
    const twistedG = priorG + thisG;
    const returnedG = kgToGrams(data.returnedRawKg ?? 0);
    // Boxes already saved by part completions are enough to stop without new boxes.
    const err = validateProgramStop({ rawG: p.rawG, twistedG: thisG > 0 || returnedG > 0 ? twistedG : priorG > 0 ? priorG : 0, returnedG });
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
        stoppedAt: p.stoppedAt ?? at,
        stoppedByUserId: mode === 'stop' ? who.userId : sql`COALESCE(${tfoPrograms.stoppedByUserId}, ${who.userId})`,
        stoppedRole: mode === 'stop' ? role : sql`COALESCE(${tfoPrograms.stoppedRole}, ${role})`,
        twistedG,
        twistedMeters: data.twistedMeters ?? p.twistedMeters,
        returnedRawG: returnedG,
        rollWeightG,
        rollsDone: p.rollsDone + rolls,
        stopNote: data.note ?? p.stopNote,
        updatedAt: at,
      })
      .where(and(eq(tfoPrograms.id, id), inArray(tfoPrograms.status, from)))
      .returning({ id: tfoPrograms.id });
    if (!done.length) throw conflict('The program changed meanwhile — refresh and try again.');
    await freeSections(tx, id);
    const eventId = await writeEvent(tx, id, mode === 'stop' ? 'stopped' : 'boxes_saved', role, at, { rolls, twistedG: thisG, note: data.note });
    if (boxes.length) await createProgramBoxes(tx, p, boxes, eventId, role, at, data.note);
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
}

/** POST /yarn/tfo/programs/:id/stop — Running or On hold → Completed (boxes now). */
export const stopProgram = (role: RoleKey, id: number, input: unknown) => completeProgram(role, id, input, 'stop');

/** POST /yarn/tfo/programs/:id/boxes — Sprint 24 (CR-21): Box details pending → Completed (same rules as Stop). */
export const saveProgramBoxes = (role: RoleKey, id: number, input: unknown) => completeProgram(role, id, input, 'boxes');

/**
 * POST /yarn/tfo/programs/:id/stop-later — Sprint 24 (CR-21): Running / On hold → Box details pending. The sections are
 * free now; nothing goes into twisted stock until the boxes are saved (the raw yarn already left at start).
 */
export async function stopProgramLater(role: RoleKey, id: number, input: unknown): Promise<TfoProgram> {
  const data = tfoProgramStopLaterSchema.parse(input ?? {});
  return db.transaction(async (tx) => {
    const p = await getProgram(id, tx);
    if (p.status !== 'running' && p.status !== 'on_hold') throw conflict('Only a running or held program can be stopped.');
    const who = actor(role);
    const at = nowIso();
    const done = await tx
      .update(tfoPrograms)
      .set({ status: 'box_pending', stoppedAt: at, stoppedByUserId: who.userId, stoppedRole: role, stopNote: data.note, updatedAt: at })
      .where(and(eq(tfoPrograms.id, id), inArray(tfoPrograms.status, ['running', 'on_hold'])))
      .returning({ id: tfoPrograms.id });
    if (!done.length) throw conflict('The program changed meanwhile — refresh and try again.');
    await freeSections(tx, id);
    await writeEvent(tx, id, 'stop_later', role, at, { sections: programSectionsLabel(p.sections), note: data.note });
    return getProgram(id, tx);
  });
}

/**
 * POST /yarn/tfo/programs/:id/hold — Sprint 24 (CR-20): Running → On hold with rolls made / left (made + left = rolls
 * started); the sections are free again (idle).
 */
export async function holdProgram(role: RoleKey, id: number, input: unknown): Promise<TfoProgram> {
  const data = tfoProgramHoldSchema.parse(input ?? {});
  return db.transaction(async (tx) => {
    const p = await getProgram(id, tx);
    if (p.status !== 'running') throw conflict(p.status === 'on_hold' ? 'This program is already on hold.' : 'Only a running program can be put on hold.');
    let made: number | null = null;
    let left: number | null = null;
    if (p.rolls !== null) {
      if (data.rollsMade === null) throw badRequest('Enter the rolls made', 'rollsMade');
      made = data.rollsMade;
      left = data.rollsLeft ?? p.rolls - made;
      const err = checkHoldRolls({ started: p.rolls, done: p.rollsDone, made, left });
      if (err) throw badRequest(HOLD_ROLLS_ERROR_TEXT[err], err === 'sum' ? 'rollsLeft' : 'rollsMade');
    }
    const at = nowIso();
    const done = await tx
      .update(tfoPrograms)
      .set({ status: 'on_hold', heldAt: at, rollsMade: made, updatedAt: at })
      .where(and(eq(tfoPrograms.id, id), eq(tfoPrograms.status, 'running')))
      .returning({ id: tfoPrograms.id });
    if (!done.length) throw conflict('The program changed meanwhile — refresh and try again.');
    await freeSections(tx, id);
    await writeEvent(tx, id, 'hold', role, at, { rollsMade: made, rollsLeft: left, sections: programSectionsLabel(p.sections), note: data.reason });
    return getProgram(id, tx);
  });
}

/** POST /yarn/tfo/programs/:id/resume — Sprint 24 (CR-20): On hold → Running on idle sections (any machines, like Start). */
export async function resumeProgram(role: RoleKey, id: number, input: unknown): Promise<TfoProgram> {
  const data = tfoProgramResumeSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const p = await getProgram(id, tx);
      if (p.status !== 'on_hold') throw conflict('Only a program on hold can be resumed.');
      const { first, label } = await idleSections(tx, data.sections);
      const at = nowIso();
      // The running unique index sits on the program's FIRST section — it moves to the first new one.
      const done = await tx
        .update(tfoPrograms)
        .set({ status: 'running', machineId: first.machineId, section: first.section, updatedAt: at })
        .where(and(eq(tfoPrograms.id, id), eq(tfoPrograms.status, 'on_hold')))
        .returning({ id: tfoPrograms.id });
      if (!done.length) throw conflict('The program changed meanwhile — refresh and try again.');
      await tx.insert(tfoProgramSections).values(data.sections.map((s) => ({ programId: id, machineId: s.machineId, section: s.section, isRunning: true, createdAt: at })));
      const left = p.rolls !== null && p.rollsMade !== null ? p.rolls - p.rollsMade : null;
      await writeEvent(tx, id, 'resume', role, at, { rollsLeft: left, sections: label });
      return getProgram(id, tx);
    });
  } catch (err) {
    if (isRunningUnique(err)) throw conflict('A program is already running on one of these sections.', 'sections');
    throw err;
  }
}

/**
 * POST /yarn/tfo/programs/:id/part — Sprint 24 (CR-20): "Complete made part" (Running or On hold): boxes for the rolls
 * already made are created now (automatic numbers, into TFO stock); the program keeps going with the rest. Rolls in the
 * boxes ≤ rolls made − already boxed (On hold) / started − already boxed (Running). Once every started roll is boxed the
 * program is Completed (sections freed).
 */
export async function completeMadePart(role: RoleKey, id: number, input: unknown): Promise<TfoProgram> {
  const data = tfoProgramPartSchema.parse(input);
  return db.transaction(async (tx) => {
    const p = await getProgram(id, tx);
    if (p.status !== 'running' && p.status !== 'on_hold') throw conflict('Only a running or held program can complete a made part.');
    const { boxes, twistedG, rolls } = boxRows(p, data);
    const limit = partRollsLimit(p);
    if (limit !== null && rolls > limit) {
      throw badRequest(`Only ${limit} roll${limit === 1 ? '' : 's'} ${p.status === 'on_hold' ? 'made' : 'started'} are not in boxes yet`, 'boxes');
    }
    const at = nowIso();
    const rollsDone = p.rollsDone + rolls;
    const allBoxed = p.rolls !== null && rollsDone >= p.rolls;
    const who = actor(role);
    const done = await tx
      .update(tfoPrograms)
      .set({
        twistedG: (p.twistedG ?? 0) + twistedG,
        rollsDone,
        rollWeightG: kgToGrams(data.rollWeightKg),
        twistedMeters: data.twistedMeters ?? p.twistedMeters,
        updatedAt: at,
        ...(allBoxed ? { status: 'completed' as const, stoppedAt: at, stoppedByUserId: who.userId, stoppedRole: role, returnedRawG: 0, stopNote: data.note } : {}),
      })
      .where(and(eq(tfoPrograms.id, id), eq(tfoPrograms.status, p.status), eq(tfoPrograms.rollsDone, p.rollsDone)))
      .returning({ id: tfoPrograms.id });
    if (!done.length) throw conflict('The program changed meanwhile — refresh and try again.');
    if (allBoxed) await freeSections(tx, id);
    const eventId = await writeEvent(tx, id, 'part_done', role, at, { rolls, twistedG, note: data.note });
    await createProgramBoxes(tx, p, boxes, eventId, role, at, data.note);
    return getProgram(id, tx);
  });
}
