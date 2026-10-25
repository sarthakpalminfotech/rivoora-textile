import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm';
import {
  tfoMachineInputSchema,
  yarnPartyInputSchema,
  yarnQualityInputSchema,
  type LookupItem,
  type Paginated,
  type TfoMachine,
  type TfoSection,
  type YarnParty,
  type YarnQuality,
  type YarnQualityLookupItem,
} from '@rivoora/shared';
import { db } from '../db/client';
import {
  beams,
  tfoMachines,
  tfoPrograms,
  warpingJobInputs,
  yarnParties,
  yarnPoLines,
  yarnPos,
  yarnQualities,
  yarnStockMoves,
} from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

/**
 * Sprint 17 — the yarn masters: Yarn parties, Yarn qualities, TFO machines. Same shape as the other masters: names
 * unique (case-insensitive) among active rows, soft delete, delete blocked (409) while the record is in use.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ------------------------------------------------------------------ */
/* Yarn parties                                                         */
/* ------------------------------------------------------------------ */

const partyColumns = {
  id: yarnParties.id,
  name: yarnParties.name,
  mobile: yarnParties.mobile,
  address: yarnParties.address,
  gstin: yarnParties.gstin,
  notes: yarnParties.notes,
  createdAt: yarnParties.createdAt,
  updatedAt: yarnParties.updatedAt,
};

export async function listYarnParties({ page, limit, search }: PaginationQuery): Promise<Paginated<YarnParty>> {
  const p = search ? likePattern(search) : null;
  const where = and(
    eq(yarnParties.isDeleted, false),
    p
      ? or(
          sql`${yarnParties.name} LIKE ${p} ESCAPE '\\'`,
          sql`${yarnParties.mobile} LIKE ${p} ESCAPE '\\'`,
          sql`${yarnParties.gstin} LIKE ${p} ESCAPE '\\'`,
        )
      : undefined,
  );
  const [items, [{ total }]] = await db.batch([
    db.select(partyColumns).from(yarnParties).where(where).orderBy(asc(sql`lower(${yarnParties.name})`)).limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(yarnParties).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

export async function lookupYarnParties(search?: string): Promise<LookupItem[]> {
  return db
    .select({ id: yarnParties.id, name: yarnParties.name })
    .from(yarnParties)
    .where(and(eq(yarnParties.isDeleted, false), search ? sql`${yarnParties.name} LIKE ${likePattern(search)} ESCAPE '\\'` : undefined))
    .orderBy(asc(sql`lower(${yarnParties.name})`))
    .limit(100);
}

export async function getYarnParty(id: number): Promise<YarnParty> {
  const [row] = await db.select(partyColumns).from(yarnParties).where(and(eq(yarnParties.id, id), eq(yarnParties.isDeleted, false)));
  if (!row) throw notFound('Yarn party');
  return row;
}

async function assertPartyName(name: string, exceptId?: number) {
  const [row] = await db
    .select({ name: yarnParties.name })
    .from(yarnParties)
    .where(and(eq(yarnParties.isDeleted, false), exceptId ? ne(yarnParties.id, exceptId) : undefined, sql`lower(${yarnParties.name}) = lower(${name})`))
    .limit(1);
  if (row) throw conflict(`A yarn party named "${row.name}" already exists`, 'name');
}

export async function createYarnParty(input: unknown): Promise<YarnParty> {
  const data = yarnPartyInputSchema.parse(input);
  await assertPartyName(data.name);
  const [row] = await db.insert(yarnParties).values(data).returning(partyColumns);
  return row;
}

export async function updateYarnParty(id: number, input: unknown): Promise<YarnParty> {
  const data = yarnPartyInputSchema.parse(input);
  await getYarnParty(id);
  await assertPartyName(data.name, id);
  const [row] = await db.update(yarnParties).set(data).where(and(eq(yarnParties.id, id), eq(yarnParties.isDeleted, false))).returning(partyColumns);
  if (!row) throw notFound('Yarn party');
  return row;
}

/** Soft delete; blocked while the party is on any Yarn PO (cancelled ones included — they are on record). */
export async function deleteYarnParty(id: number): Promise<void> {
  await getYarnParty(id);
  const [{ used }] = await db.select({ used: count() }).from(yarnPos).where(eq(yarnPos.partyId, id));
  if (used > 0) throw conflict(`This party can't be deleted because it is used on ${plural(used, 'Yarn PO')}.`);
  await db.update(yarnParties).set({ isDeleted: true }).where(eq(yarnParties.id, id));
}

/* ------------------------------------------------------------------ */
/* Yarn qualities                                                       */
/* ------------------------------------------------------------------ */

const qualityColumns = {
  id: yarnQualities.id,
  name: yarnQualities.name,
  denier: yarnQualities.denier,
  filament: yarnQualities.filament,
  notes: yarnQualities.notes,
  createdAt: yarnQualities.createdAt,
  updatedAt: yarnQualities.updatedAt,
};

export async function listYarnQualities({ page, limit, search }: PaginationQuery): Promise<Paginated<YarnQuality>> {
  const p = search ? likePattern(search) : null;
  const where = and(
    eq(yarnQualities.isDeleted, false),
    p
      ? or(
          sql`${yarnQualities.name} LIKE ${p} ESCAPE '\\'`,
          sql`${yarnQualities.denier} LIKE ${p} ESCAPE '\\'`,
          sql`${yarnQualities.filament} LIKE ${p} ESCAPE '\\'`,
        )
      : undefined,
  );
  const [items, [{ total }]] = await db.batch([
    db.select(qualityColumns).from(yarnQualities).where(where).orderBy(asc(sql`lower(${yarnQualities.name})`)).limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(yarnQualities).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

export async function lookupYarnQualities(search?: string): Promise<YarnQualityLookupItem[]> {
  return db
    .select({ id: yarnQualities.id, name: yarnQualities.name, denier: yarnQualities.denier, filament: yarnQualities.filament })
    .from(yarnQualities)
    .where(and(eq(yarnQualities.isDeleted, false), search ? sql`${yarnQualities.name} LIKE ${likePattern(search)} ESCAPE '\\'` : undefined))
    .orderBy(asc(sql`lower(${yarnQualities.name})`))
    .limit(200);
}

export async function getYarnQuality(id: number): Promise<YarnQuality> {
  const [row] = await db.select(qualityColumns).from(yarnQualities).where(and(eq(yarnQualities.id, id), eq(yarnQualities.isDeleted, false)));
  if (!row) throw notFound('Yarn quality');
  return row;
}

async function assertQualityName(name: string, exceptId?: number) {
  const [row] = await db
    .select({ name: yarnQualities.name })
    .from(yarnQualities)
    .where(and(eq(yarnQualities.isDeleted, false), exceptId ? ne(yarnQualities.id, exceptId) : undefined, sql`lower(${yarnQualities.name}) = lower(${name})`))
    .limit(1);
  if (row) throw conflict(`A yarn quality named "${row.name}" already exists`, 'name');
}

export async function createYarnQuality(input: unknown): Promise<YarnQuality> {
  const data = yarnQualityInputSchema.parse(input);
  await assertQualityName(data.name);
  const [row] = await db.insert(yarnQualities).values(data).returning(qualityColumns);
  return row;
}

export async function updateYarnQuality(id: number, input: unknown): Promise<YarnQuality> {
  const data = yarnQualityInputSchema.parse(input);
  await getYarnQuality(id);
  await assertQualityName(data.name, id);
  const [row] = await db.update(yarnQualities).set(data).where(and(eq(yarnQualities.id, id), eq(yarnQualities.isDeleted, false))).returning(qualityColumns);
  if (!row) throw notFound('Yarn quality');
  return row;
}

/** Soft delete; blocked while the quality is on a PO line, in the stock ledger, on a beam, a TFO program or a warping job. */
export async function deleteYarnQuality(id: number): Promise<void> {
  await getYarnQuality(id);
  const [[poLines], [moves], [beamRows], [programs], [inputs]] = await db.batch([
    db.select({ n: count() }).from(yarnPoLines).where(eq(yarnPoLines.qualityId, id)),
    db.select({ n: count() }).from(yarnStockMoves).where(eq(yarnStockMoves.qualityId, id)),
    db.select({ n: count() }).from(beams).where(eq(beams.qualityId, id)),
    db.select({ n: count() }).from(tfoPrograms).where(or(eq(tfoPrograms.rawQualityId, id), eq(tfoPrograms.outputQualityId, id))),
    db.select({ n: count() }).from(warpingJobInputs).where(eq(warpingJobInputs.qualityId, id)),
  ]);
  const uses = [
    poLines.n ? plural(poLines.n, 'Yarn PO line') : null,
    moves.n ? plural(moves.n, 'stock movement') : null,
    beamRows.n ? plural(beamRows.n, 'beam') : null,
    programs.n ? plural(programs.n, 'TFO program') : null,
    inputs.n ? plural(inputs.n, 'warping input') : null,
  ].filter(Boolean);
  if (uses.length) throw conflict(`This quality can't be deleted because it is used on ${uses.join(', ')}.`);
  await db.update(yarnQualities).set({ isDeleted: true }).where(eq(yarnQualities.id, id));
}

/* ------------------------------------------------------------------ */
/* TFO machines                                                         */
/* ------------------------------------------------------------------ */

/** Sections with a running program, per machine (one aggregate query). */
const runningSectionsSql = sql<string | null>`(
  SELECT group_concat(p.section) FROM tfo_programs p
  WHERE p.machine_id = "tfo_machines"."id" AND p.status = 'running'
)`;

const machineColumns = {
  id: tfoMachines.id,
  machineNo: tfoMachines.machineNo,
  name: tfoMachines.name,
  isActive: tfoMachines.isActive,
  running: runningSectionsSql,
  createdAt: tfoMachines.createdAt,
  updatedAt: tfoMachines.updatedAt,
};

type MachineRow = Omit<TfoMachine, 'runningSections'> & { running: string | null };
const toMachine = ({ running, ...r }: MachineRow): TfoMachine => ({
  ...r,
  runningSections: (running ? running.split(',') : []).filter((s): s is TfoSection => s === 'A' || s === 'B').sort(),
});

export async function listTfoMachines({ page, limit, search }: PaginationQuery): Promise<Paginated<TfoMachine>> {
  const where = and(
    eq(tfoMachines.isDeleted, false),
    search
      ? /^\d+$/.test(search)
        ? or(eq(tfoMachines.machineNo, Number(search)), sql`${tfoMachines.name} LIKE ${likePattern(search)} ESCAPE '\\'`)
        : sql`${tfoMachines.name} LIKE ${likePattern(search)} ESCAPE '\\'`
      : undefined,
  );
  const [items, [{ total }]] = await db.batch([
    db.select(machineColumns).from(tfoMachines).where(where).orderBy(asc(tfoMachines.machineNo)).limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(tfoMachines).where(where),
  ]);
  return { items: items.map(toMachine), page, limit, total, hasMore: page * limit < total };
}

export async function getTfoMachine(id: number): Promise<TfoMachine> {
  const [row] = await db.select(machineColumns).from(tfoMachines).where(and(eq(tfoMachines.id, id), eq(tfoMachines.isDeleted, false)));
  if (!row) throw notFound('TFO machine');
  return toMachine(row);
}

async function assertMachineNo(machineNo: number, exceptId?: number) {
  const [row] = await db
    .select({ id: tfoMachines.id })
    .from(tfoMachines)
    .where(and(eq(tfoMachines.isDeleted, false), eq(tfoMachines.machineNo, machineNo), exceptId ? ne(tfoMachines.id, exceptId) : undefined))
    .limit(1);
  if (row) throw conflict(`TFO machine ${machineNo} already exists`, 'machineNo');
}

export async function createTfoMachine(input: unknown): Promise<TfoMachine> {
  const data = tfoMachineInputSchema.parse(input);
  await assertMachineNo(data.machineNo);
  const [row] = await db.insert(tfoMachines).values(data).returning({ id: tfoMachines.id });
  return getTfoMachine(row.id);
}

/** A machine with a running program can't be made inactive (stop the program first). */
export async function updateTfoMachine(id: number, input: unknown): Promise<TfoMachine> {
  const data = tfoMachineInputSchema.parse(input);
  const current = await getTfoMachine(id);
  await assertMachineNo(data.machineNo, id);
  if (!data.isActive && current.runningSections.length) {
    throw conflict(`A program is running on ${current.runningSections.map((s) => `${current.machineNo}${s}`).join(' and ')} — stop it before making the machine inactive.`, 'isActive');
  }
  await db.update(tfoMachines).set(data).where(and(eq(tfoMachines.id, id), eq(tfoMachines.isDeleted, false)));
  return getTfoMachine(id);
}

/** Soft delete; blocked while a program is running on it (its finished programs stay in the history). */
export async function deleteTfoMachine(id: number): Promise<void> {
  const machine = await getTfoMachine(id);
  if (machine.runningSections.length) {
    throw conflict(`TFO machine ${machine.machineNo} can't be deleted while a program is running on it — stop the program first, or mark the machine inactive.`);
  }
  await db.update(tfoMachines).set({ isDeleted: true }).where(eq(tfoMachines.id, id));
}
