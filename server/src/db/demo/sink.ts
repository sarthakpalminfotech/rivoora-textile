import type { Client, InStatement } from '@libsql/client';

/**
 * Sprint 26 — collects the demo rows in memory (ids assigned up front so rows can point at each other) and writes them in
 * ONE write batch (one transaction). Rows use the SQL column names. Rows with different column sets go in separate
 * INSERTs, so a column a row leaves out keeps its table default. `created_at` / `updated_at` are filled from the row's
 * time when the table has them.
 */
export type Row = Record<string, unknown>;

/** Tables whose primary key is not an autoincrement `id`. */
const NO_ID = new Set(['jobsheet_machines', 'counters', 'app_settings', 'dashboard_layouts', 'design_variation_map', 'sessions']);

export class Sink {
  private readonly data = new Map<string, Row[]>();
  private readonly next = new Map<string, number>();

  constructor(private readonly startIds: Map<string, number>) {}

  /** Adds a row (and returns its id). `at` = created / updated time when the row has none. */
  add(table: string, row: Row, at?: string): number {
    const r: Row = { ...row };
    if (at && r.created_at === undefined) r.created_at = at;
    if (at && r.updated_at === undefined) r.updated_at = r.created_at;
    let id = 0;
    if (!NO_ID.has(table)) {
      if (typeof r.id === 'number') id = r.id;
      else {
        id = this.peekId(table);
        r.id = id;
      }
      this.next.set(table, Math.max(this.peekId(table), id + 1));
    }
    const list = this.data.get(table) ?? [];
    list.push(r);
    this.data.set(table, list);
    return id;
  }

  /** Takes the next id of a table now (the row is added later with that `id`). */
  reserve(table: string): number {
    const id = this.peekId(table);
    this.next.set(table, id + 1);
    return id;
  }

  /** The id the next `add(table)` will get. */
  peekId(table: string): number {
    return this.next.get(table) ?? (this.startIds.get(table) ?? 0) + 1;
  }

  /** Rows added so far (for later fix-ups before the flush). */
  rows(table: string): Row[] {
    return this.data.get(table) ?? [];
  }

  count(table: string): number {
    return this.rows(table).length;
  }

  tables(): string[] {
    return [...this.data.keys()];
  }

  /** Writes everything in one transaction. */
  async flush(client: Client, columnsOf: Map<string, Set<string>>, nowIso: string): Promise<number> {
    const stmts: InStatement[] = [];
    let total = 0;
    for (const [table, list] of this.data) {
      const cols = columnsOf.get(table);
      if (!cols) throw new Error(`demo seed: unknown table ${table}`);
      const groups = new Map<string, Row[]>();
      for (const raw of list) {
        const r: Row = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v === undefined) continue;
          if ((k === 'created_at' || k === 'updated_at') && !cols.has(k)) continue;
          if (!cols.has(k)) throw new Error(`demo seed: ${table}.${k} is not a column`);
          r[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
        }
        if (cols.has('created_at') && r.created_at === undefined) r.created_at = nowIso;
        if (cols.has('updated_at') && r.updated_at === undefined) r.updated_at = r.created_at ?? nowIso;
        const key = Object.keys(r).sort().join(',');
        const g = groups.get(key) ?? [];
        g.push(r);
        groups.set(key, g);
      }
      for (const [key, rowsOfKey] of groups) {
        const keys = key.split(',');
        const per = Math.max(1, Math.floor(30_000 / keys.length));
        for (let i = 0; i < rowsOfKey.length; i += per) {
          const chunk = rowsOfKey.slice(i, i + per);
          const args: (string | number | null)[] = [];
          const values = chunk.map((r) => {
            for (const k of keys) args.push((r[k] ?? null) as string | number | null);
            return `(${keys.map(() => '?').join(',')})`;
          });
          stmts.push({ sql: `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES ${values.join(',')}`, args });
        }
      }
      total += list.length;
    }
    await client.batch(stmts, 'write');
    return total;
  }
}
