import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  availableAfterReserved,
  BOX_NO_COUNTER,
  boxNetG,
  checkStartRolls,
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
  type TfoProgramStatus,
  type TfoSection,
} from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  tfoMachines,
  tfoPendingPrograms,
  tfoProgramSections,
  tfoPrograms,
  warpingQualities,
  yarnBoxes,
  yarnLots,
  yarnParties,
  yarnQualities,
  yarnStockMoves,
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
        .select({ programId: tfoProgramSections.programId, machineId: tfoProgramSections.machineId, machineNo: tfoMachines.machineNo, section: tfoProgramSections.section })
        .from(tfoProgramSections)
        .innerJoin(tfoMachines, eq(tfoMachines.id, tfoProgramSections.machineId))
        .where(inArray(tfoProgramSections.programId, ids))
        .orderBy(asc(tfoMachines.machineNo), asc(tfoProgramSections.section))
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
        })
        .from(yarnBoxes)
        .innerJoin(warpingQualities, eq(warpingQualities.id, yarnBoxes.warpingQualityId))
        .where(inArray(yarnBoxes.programId, ids))
        .orderBy(asc(yarnBoxes.id))
    : [];
  return rows.map((r) => {
    const own = boxes.filter((b) => b.programId === r.id);
    const ownSections = sections.filter((s) => s.programId === r.id).map(({ programId: _p, ...s }) => s);
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
      })),
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
      const machineIds = [...new Set(data.sections.map((s) => s.machineId))];
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
      const clash = data.sections.find((s) => busy.some((b) => b.machineId === s.machineId && b.section === s.section));
      if (clash) {
        throw conflict(`A program is already running on ${tfoSectionLabel(machines.find((m) => m.id === clash.machineId)!.machineNo, clash.section)}.`, 'sections');
      }
      const first = [...data.sections].sort((a, b) => {
        const ma = machines.find((m) => m.id === a.machineId)!.machineNo;
        const mb = machines.find((m) => m.id === b.machineId)!.machineNo;
        return ma - mb || a.section.localeCompare(b.section);
      })[0];
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
  const onSection = (machineId: number, section: TfoSection) => programs.find((p) => p.sections.some((s) => s.machineId === machineId && s.section === section)) ?? null;
  const sections = machines.map((m) => ({ ...m, sections: TFO_SECTIONS.map((section) => ({ section, program: onSection(m.id, section) })) }));
  return {
    machines: sections,
    runningSections: sections.reduce((n, m) => n + m.sections.filter((s) => s.program).length, 0),
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
  const where = q.machineId
    ? sql`EXISTS (SELECT 1 FROM tfo_program_sections ps WHERE ps.program_id = ${tfoPrograms.id} AND ps.machine_id = ${q.machineId}${q.section ? sql` AND ps.section = ${q.section}` : sql``})`
    : undefined;
  const [rows, [{ total }]] = await Promise.all([
    programsFrom(db).where(where).orderBy(desc(tfoPrograms.startedAt), desc(tfoPrograms.id)).limit(q.limit).offset((q.page - 1) * q.limit),
    db.select({ total: count() }).from(tfoPrograms).where(where),
  ]);
  return { items: await toPrograms(db, rows), page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

/* ------------------------------------------------------------------ */
/* stop                                                                 */
/* ------------------------------------------------------------------ */

/** The next `n` free box numbers ("1", "2", …): counter `yarn_box_no`, skipping numbers already used by any box. */
async function allocateBoxNos(tx: Tx, n: number): Promise<string[]> {
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

/**
 * POST /yarn/tfo/programs/:id/stop — Completed; every section is free again. Boxes (system numbers, net = gross − roll
 * weight × rolls) go into TFO stock (`tfo_output`) under their output quality; returned raw goes back with the lot.
 */
export async function stopProgram(role: RoleKey, id: number, input: unknown): Promise<TfoProgram> {
  const data = tfoProgramStopSchema.parse(input);
  return db.transaction(async (tx) => {
    const p = await getProgram(id, tx);
    const label = programSectionsLabel(p.sections);
    if (p.status !== 'running') throw conflict(`The program on ${label} is already stopped.`);
    const rollWeightG = kgToGrams(data.rollWeightKg);
    const boxes = data.boxes.map((b, i) => {
      const grossG = kgToGrams(b.grossKg);
      const netG = boxNetG(grossG, rollWeightG, b.rolls);
      if (!(netG > 0)) throw badRequest('Gross kg must be more than roll weight × rolls', `boxes.${i}.grossKg`);
      const direction = p.direction === 'SZ' ? b.direction : p.direction;
      if (direction !== 'S' && direction !== 'Z') throw badRequest('Pick S or Z for this box', `boxes.${i}.direction`);
      return { rolls: b.rolls, grossG, netG, avgG: b.avgKg ? kgToGrams(b.avgKg) : 0, direction };
    });
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
        rollWeightG,
        stopNote: data.note,
      })
      .where(and(eq(tfoPrograms.id, id), eq(tfoPrograms.status, 'running')))
      .returning({ id: tfoPrograms.id });
    if (!done.length) throw conflict('The program changed meanwhile — refresh and try again.');
    await tx.update(tfoProgramSections).set({ isRunning: false }).where(eq(tfoProgramSections.programId, id));

    // One output quality per direction ("75/36 Poly 75D-600-S"), found or created in the Warping qualities master.
    const qualityOf = new Map<string, { id: number; name: string }>();
    for (const dir of [...new Set(boxes.map((b) => b.direction))]) {
      const name = tfoOutputQualityName({ denierFilament: p.denierFilament, rawQualityName: p.rawQuality.name, tpm: p.tpm, direction: dir });
      qualityOf.set(dir, await findOrCreateWarpingQuality(tx, name));
    }
    const sysQ = await systemQualityId(tx);
    const nos = await allocateBoxNos(tx, boxes.length);
    for (const [i, b] of boxes.entries()) {
      const wq = qualityOf.get(b.direction)!;
      const [row] = await tx
        .insert(yarnBoxes)
        .values({
          boxNo: nos[i],
          programId: id,
          lotId: p.lot?.id ?? null,
          warpingQualityId: wq.id,
          rolls: b.rolls,
          grossG: b.grossG,
          netG: b.netG,
          avgG: b.avgG,
          zone: 'tfo',
          status: 'in_stock',
          createdByUserId: who.userId,
        })
        .returning({ id: yarnBoxes.id });
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
