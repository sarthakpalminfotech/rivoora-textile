import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm';
import { machineInputSchema, type Machine, type MachineLookupItem, type Paginated } from '@rivoora/shared';
import { db } from '../db/client';
import { jobsheetMachines, jobsheets, machines } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

const columns = {
  id: machines.id,
  machineNo: machines.machineNo,
  name: machines.name,
  notes: machines.notes,
  isActive: machines.isActive,
  createdAt: machines.createdAt,
  updatedAt: machines.updatedAt,
};

/** Matches the machine number (prefix) or the name; "Machine 7" / "M7" also work. */
function searchCondition(search?: string) {
  if (!search) return undefined;
  const term = search.replace(/^(machine|m)\s*/i, '').trim() || search;
  const parts = [sql`${machines.name} LIKE ${likePattern(search)} ESCAPE '\\'`];
  if (/^\d+$/.test(term)) parts.push(sql`CAST(${machines.machineNo} AS TEXT) LIKE ${likePattern(term, 'prefix')} ESCAPE '\\'`);
  return or(...parts);
}

export async function listMachines({ page, limit, search }: PaginationQuery): Promise<Paginated<Machine>> {
  const where = and(eq(machines.isDeleted, false), searchCondition(search));
  const [items, [{ total }]] = await db.batch([
    db
      .select(columns)
      .from(machines)
      .where(where)
      .orderBy(asc(machines.machineNo))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(machines).where(where),
  ]);
  return { items, page, limit, total, hasMore: page * limit < total };
}

/** Active machines only, for the jobsheet dropdowns. */
export async function lookupMachines(search?: string): Promise<MachineLookupItem[]> {
  return db
    .select({ id: machines.id, machineNo: machines.machineNo, name: machines.name })
    .from(machines)
    .where(and(eq(machines.isDeleted, false), eq(machines.isActive, true), searchCondition(search)))
    .orderBy(asc(machines.machineNo))
    .limit(200);
}

export async function getMachine(id: number): Promise<Machine> {
  const [row] = await db
    .select(columns)
    .from(machines)
    .where(and(eq(machines.id, id), eq(machines.isDeleted, false)));
  if (!row) throw notFound('Machine');
  return row;
}

async function assertUniqueNo(machineNo: number, exceptId?: number) {
  const [dupe] = await db
    .select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.isDeleted, false), eq(machines.machineNo, machineNo), exceptId ? ne(machines.id, exceptId) : undefined))
    .limit(1);
  if (dupe) throw conflict(`Machine ${machineNo} already exists`, 'machineNo');
}

export async function createMachine(input: unknown): Promise<Machine> {
  const data = machineInputSchema.parse(input);
  await assertUniqueNo(data.machineNo);
  const [row] = await db.insert(machines).values(data).returning(columns);
  return row;
}

export async function updateMachine(id: number, input: unknown): Promise<Machine> {
  const data = machineInputSchema.parse(input);
  await assertUniqueNo(data.machineNo, id);
  const [row] = await db
    .update(machines)
    .set(data)
    .where(and(eq(machines.id, id), eq(machines.isDeleted, false)))
    .returning(columns);
  if (!row) throw notFound('Machine');
  return row;
}

export async function deleteMachine(id: number): Promise<void> {
  const machine = await getMachine(id);
  const [{ used }] = await db
    .select({ used: count() })
    .from(jobsheetMachines)
    .innerJoin(jobsheets, and(eq(jobsheets.id, jobsheetMachines.jobsheetId), eq(jobsheets.isDeleted, false)))
    .where(eq(jobsheetMachines.machineId, id));
  if (used > 0) {
    throw conflict(
      `Machine ${machine.machineNo} can't be deleted because it is used on ${used} active jobsheet${used === 1 ? '' : 's'}. Mark it inactive instead.`,
    );
  }
  await db.update(machines).set({ isDeleted: true }).where(eq(machines.id, id));
}
