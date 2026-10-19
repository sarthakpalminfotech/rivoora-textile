import { and, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { WorkFilters } from '@rivoora/shared';
import { jobsheets, orders } from '../db/schema';

/**
 * SQL for the work filters (Filters modal of the supervisor's Jobsheets and the godown's Butta cutting / Mill).
 * `rowFilters` is for a query that JOINS `jobsheets` and `orders` (so the columns render qualified);
 * `challanFilters` is for the single-table challan list (raw SQL, `"challans"` outer column written explicitly).
 */

const idList = (ids: readonly number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/** Blouse: the chosen options, "not set" = NULL. */
function blouseSql(keys: WorkFilters['blouse'], col: SQL | typeof orders.blouseOption): SQL | undefined {
  if (!keys.length) return undefined;
  const opts = keys.filter((k) => k !== 'not_set');
  const parts: SQL[] = [];
  if (opts.length) parts.push(sql`${col} IN (${sql.join(opts.map((o) => sql`${o}`), sql`, `)})`);
  if (keys.includes('not_set')) parts.push(sql`${col} IS NULL`);
  return parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * Order + jobsheet conditions. `dateCol` = the date the range applies to (e.g. the jobsheet's sent time); without it
 * the range is ignored. Loom = assigned to the jobsheet OR the machine it runs / ran on.
 */
export function rowFilters(f: WorkFilters, dateCol?: SQL | typeof jobsheets.sentAt): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.qualities.length) conds.push(inArray(orders.materialId, f.qualities));
  if (f.types.length) conds.push(inArray(orders.orderType, f.types));
  if (f.blouse.length) conds.push(blouseSql(f.blouse, orders.blouseOption));
  if (f.looms.length) {
    conds.push(
      or(
        sql`EXISTS (SELECT 1 FROM jobsheet_machines jm WHERE jm.jobsheet_id = ${jobsheets.id} AND jm.machine_id IN (${idList(f.looms)}))`,
        inArray(jobsheets.runningMachineId, f.looms),
      ),
    );
  }
  if (dateCol && f.from) conds.push(sql`substr(${dateCol}, 1, 10) >= ${f.from}`);
  if (dateCol && f.to) conds.push(sql`substr(${dateCol}, 1, 10) <= ${f.to}`);
  return conds.length ? and(...conds) : undefined;
}

/**
 * Challan list: party + challan date on the challan itself; quality / type / blouse / loom = the challan has at least
 * one taka matching them.
 */
export function challanFilters(f: WorkFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.parties.length) conds.push(sql`"challans"."party_id" IN (${idList(f.parties)})`);
  if (f.from) conds.push(sql`"challans"."challan_date" >= ${f.from}`);
  if (f.to) conds.push(sql`"challans"."challan_date" <= ${f.to}`);
  const inner: SQL[] = [];
  if (f.qualities.length) inner.push(sql`o.material_id IN (${idList(f.qualities)})`);
  if (f.types.length) inner.push(sql`o.order_type IN (${sql.join(f.types.map((t) => sql`${t}`), sql`, `)})`);
  const blouse = blouseSql(f.blouse, sql`o.blouse_option`);
  if (blouse) inner.push(blouse);
  if (f.looms.length) {
    inner.push(
      sql`(EXISTS (SELECT 1 FROM jobsheet_machines jm WHERE jm.jobsheet_id = j.id AND jm.machine_id IN (${idList(f.looms)})) OR j.running_machine_id IN (${idList(f.looms)}))`,
    );
  }
  if (inner.length) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM challan_takas ct JOIN takas t ON t.id = ct.taka_id JOIN jobsheets j ON j.id = t.jobsheet_id JOIN orders o ON o.id = ct.order_id WHERE ct.challan_id = "challans"."id" AND ${sql.join(inner, sql` AND `)})`,
    );
  }
  return conds.length ? and(...conds) : undefined;
}
