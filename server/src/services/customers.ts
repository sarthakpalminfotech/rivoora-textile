import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import { customerInputSchema, type Broker, type Customer, type LookupItem, type Paginated } from '@rivoora/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import { customerBrokers, customers, orders } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

/** Active brokers of the customer as a JSON array (outer column written explicitly — see the Drizzle gotcha). */
const brokersJson = sql<string | null>`(SELECT json_group_array(json_object('id', b.id, 'name', b.name)) FROM (SELECT id, name FROM customer_brokers WHERE customer_id = "customers"."id" AND is_deleted = 0 ORDER BY lower(name)) b)`;

const columns = {
  id: customers.id,
  name: customers.name,
  phone: customers.phone,
  alternatePhone: customers.alternatePhone,
  email: customers.email,
  address: customers.address,
  city: customers.city,
  gstNumber: customers.gstNumber,
  notes: customers.notes,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
  brokersJson,
};

type Row = Omit<Customer, 'brokers'> & { brokersJson: string | null };

function parseBrokers(raw: string | null): Broker[] {
  if (!raw) return [];
  return (JSON.parse(raw) as Broker[]).filter((b) => b.id !== null);
}

const toCustomer = ({ brokersJson: raw, ...c }: Row): Customer => ({ ...c, brokers: parseBrokers(raw) });

function searchCondition(search?: string) {
  if (!search) return undefined;
  const p = likePattern(search);
  return or(
    sql`${customers.name} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.phone} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.city} LIKE ${p} ESCAPE '\\'`,
    // Broker names too (outer column written explicitly).
    sql`EXISTS (SELECT 1 FROM customer_brokers b WHERE b.customer_id = "customers"."id" AND b.is_deleted = 0 AND b.name LIKE ${p} ESCAPE '\\')`,
  );
}

export async function listCustomers({ page, limit, search }: PaginationQuery): Promise<Paginated<Customer>> {
  const where = and(eq(customers.isDeleted, false), searchCondition(search));
  const [items, [{ total }]] = await db.batch([
    db
      .select(columns)
      .from(customers)
      .where(where)
      .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(customers).where(where),
  ]);
  return { items: items.map(toCustomer), page, limit, total, hasMore: page * limit < total };
}

export async function lookupCustomers(search?: string): Promise<LookupItem[]> {
  return db
    .select({ id: customers.id, name: customers.name, city: customers.city })
    .from(customers)
    .where(and(eq(customers.isDeleted, false), searchCondition(search)))
    .orderBy(asc(sql`lower(${customers.name})`))
    .limit(30);
}

/** GET /lookup/customers/:id/brokers — the customer's active brokers, by name (for the order form). */
export async function lookupBrokers(customerId: number): Promise<Broker[]> {
  return db
    .select({ id: customerBrokers.id, name: customerBrokers.name })
    .from(customerBrokers)
    .where(and(eq(customerBrokers.customerId, customerId), eq(customerBrokers.isDeleted, false)))
    .orderBy(asc(sql`lower(${customerBrokers.name})`));
}

async function loadCustomer(tx: DbOrTx, id: number): Promise<Customer> {
  const [row] = await tx
    .select(columns)
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.isDeleted, false)));
  if (!row) throw notFound('Customer');
  return toCustomer(row);
}

export const getCustomer = (id: number) => loadCustomer(db, id);

/**
 * Saves the customer's brokers: rows with an id are renamed when changed, rows without one are added, missing ids
 * are soft-deleted (they stay on old orders). Renames go through a temporary value so swapping two names never
 * hits the unique index.
 */
async function saveBrokers(tx: Tx, customerId: number, list: { id?: number; name: string }[]) {
  const existing = await tx
    .select({ id: customerBrokers.id, name: customerBrokers.name })
    .from(customerBrokers)
    .where(and(eq(customerBrokers.customerId, customerId), eq(customerBrokers.isDeleted, false)));
  const byId = new Map(existing.map((b) => [b.id, b]));
  const kept = new Set<number>();
  for (const [i, b] of list.entries()) {
    if (b.id === undefined) continue;
    if (!byId.has(b.id) || kept.has(b.id)) {
      throw badRequest('A broker was just changed by someone else. Close the form, refresh and try again.', `brokers.${i}.name`);
    }
    kept.add(b.id);
  }
  const removed = existing.filter((b) => !kept.has(b.id)).map((b) => b.id);
  if (removed.length) {
    await tx.update(customerBrokers).set({ isDeleted: true }).where(inArray(customerBrokers.id, removed));
  }
  const renamed = list.filter((b) => b.id !== undefined && byId.get(b.id)!.name !== b.name);
  for (const b of renamed) {
    await tx.update(customerBrokers).set({ name: `~${b.id}` }).where(eq(customerBrokers.id, b.id!));
  }
  for (const b of renamed) {
    await tx.update(customerBrokers).set({ name: b.name }).where(eq(customerBrokers.id, b.id!));
  }
  const added = list.filter((b) => b.id === undefined);
  if (added.length) {
    await tx.insert(customerBrokers).values(added.map((b) => ({ customerId, name: b.name })));
  }
}

export async function createCustomer(input: unknown): Promise<Customer> {
  const { brokers, ...data } = customerInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(customers).values(data).returning({ id: customers.id });
    await saveBrokers(tx, row.id, brokers);
    return loadCustomer(tx, row.id);
  });
}

export async function updateCustomer(id: number, input: unknown): Promise<Customer> {
  const { brokers, ...data } = customerInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(customers)
      .set(data)
      .where(and(eq(customers.id, id), eq(customers.isDeleted, false)))
      .returning({ id: customers.id });
    if (!row) throw notFound('Customer');
    await saveBrokers(tx, id, brokers);
    return loadCustomer(tx, id);
  });
}

export async function deleteCustomer(id: number): Promise<void> {
  await getCustomer(id);
  const [{ used }] = await db.select({ used: count() }).from(orders).where(eq(orders.customerId, id));
  if (used > 0) {
    throw conflict(
      `This customer can't be deleted because they are used in ${used} order${used === 1 ? '' : 's'}.`,
    );
  }
  await db.update(customers).set({ isDeleted: true }).where(eq(customers.id, id));
}
