import { and, asc, count, eq, or, sql } from 'drizzle-orm';
import { customerInputSchema, type Customer, type LookupItem, type Paginated } from '@rivoora/shared';
import { db } from '../db/client';
import { customers, orders } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { likePattern, type PaginationQuery } from '../lib/http';

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
};

function searchCondition(search?: string) {
  if (!search) return undefined;
  const p = likePattern(search);
  return or(
    sql`${customers.name} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.phone} LIKE ${p} ESCAPE '\\'`,
    sql`${customers.city} LIKE ${p} ESCAPE '\\'`,
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
  return { items, page, limit, total, hasMore: page * limit < total };
}

export async function lookupCustomers(search?: string): Promise<LookupItem[]> {
  return db
    .select({ id: customers.id, name: customers.name, city: customers.city })
    .from(customers)
    .where(and(eq(customers.isDeleted, false), searchCondition(search)))
    .orderBy(asc(sql`lower(${customers.name})`))
    .limit(30);
}

export async function getCustomer(id: number): Promise<Customer> {
  const [row] = await db
    .select(columns)
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.isDeleted, false)));
  if (!row) throw notFound('Customer');
  return row;
}

export async function createCustomer(input: unknown): Promise<Customer> {
  const data = customerInputSchema.parse(input);
  const [row] = await db.insert(customers).values(data).returning(columns);
  return row;
}

export async function updateCustomer(id: number, input: unknown): Promise<Customer> {
  const data = customerInputSchema.parse(input);
  const [row] = await db
    .update(customers)
    .set(data)
    .where(and(eq(customers.id, id), eq(customers.isDeleted, false)))
    .returning(columns);
  if (!row) throw notFound('Customer');
  return row;
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
