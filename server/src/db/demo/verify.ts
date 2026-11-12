import { sql } from 'drizzle-orm';
import { DASHBOARDS, formatValue, type CardBody, type CardPayload, type DashboardKey, type RoleKey } from '@rivoora/shared';
import { db } from '../client';
import { dashboardCards } from '../../services/insights';
import { recomputeOrderStatus } from '../../services/jobsheets';

/**
 * Sprint 26 — after the demo seed: (1) every order's status is re-derived by the app's own `recomputeOrderStatus` inside
 * a transaction that is rolled back (0 corrections = the demo statuses are exactly what the app computes); (2) every
 * considered card of the three dashboards is built through the real service and must have data, except the deliberate
 * empty section (the supervisor's Performance section this month).
 */

/** The section that is empty on purpose (UI edge case), and cards behind an off-by-default flag (not served). */
export const DELIBERATELY_EMPTY = new Set(['s.completed_short']);

const WHO: Record<DashboardKey, RoleKey> = { owner: 'jemish', partner: 'gaurang', supervisor: 'supervisor' };

function describe(body: CardBody | null): { empty: boolean; text: string } {
  if (!body) return { empty: true, text: '—' };
  switch (body.kind) {
    case 'figure':
      return { empty: false, text: formatValue(body.value, body.unit) + (body.sub ? ` · ${body.sub}` : '') };
    case 'split':
      return { empty: body.items.length === 0, text: body.items.map((i) => `${i.label} ${formatValue(i.value, i.unit)}`).join(' | ') };
    case 'bars': {
      const nonZero = body.points.filter((p) => p.values.some((v) => v)).length;
      const last = body.points[body.points.length - 1];
      return { empty: nonZero === 0, text: `${body.points.length} bars (${nonZero} with data) · last ${last ? last.values.map((v) => formatValue(v, body.unit)).join(' / ') : '—'}` };
    }
    case 'donut':
      return { empty: body.parts.length === 0, text: body.parts.map((p) => `${p.label} ${formatValue(p.value, body.unit)}`).join(' | ') };
    case 'ranked':
      return { empty: body.rows.length === 0, text: `${body.rows.length + body.more} rows · top: ${body.rows[0] ? `${body.rows[0].label} ${body.rows[0].valueText ?? formatValue(body.rows[0].value, body.rows[0].unit)}` : '—'}` };
    case 'table':
      return { empty: body.rows.length === 0, text: `${body.rows.length + body.more} rows · first: ${body.rows[0] ? Object.values(body.rows[0].cells).slice(0, 3).join(' · ') : '—'}` };
  }
}

export interface CardCheck {
  dashboard: DashboardKey;
  id: string;
  title: string;
  ok: boolean;
  text: string;
}

export async function checkCards(): Promise<CardCheck[]> {
  const users = await db.all<{ id: number; role: string }>(sql`SELECT id, role FROM users`);
  const out: CardCheck[] = [];
  for (const key of Object.keys(DASHBOARDS) as DashboardKey[]) {
    const def = DASHBOARDS[key];
    const role = WHO[key];
    const userId = users.find((u) => u.role === role)?.id ?? null;
    const ids = [...def.strip.map((s) => s.id), ...def.cards.filter((c) => !c.flag).map((c) => c.id)];
    const res = await dashboardCards(role, userId, key, { ids: ids.join(','), period: '30d' });
    for (const id of ids) {
      const title = def.strip.find((s) => s.id === id)?.label ?? def.cards.find((c) => c.id === id)?.title ?? id;
      const p = res.cards[id] as (CardPayload & { error?: string }) | undefined;
      if (!p) {
        out.push({ dashboard: key, id, title, ok: false, text: 'not returned' });
        continue;
      }
      if ('error' in p && p.error) {
        out.push({ dashboard: key, id, title, ok: false, text: `ERROR ${p.error}` });
        continue;
      }
      if (p.hidden) {
        out.push({ dashboard: key, id, title, ok: false, text: `hidden: ${p.hidden}` });
        continue;
      }
      const body = p.body ?? (p.views && p.switch ? p.views[p.switch.value] : null) ?? null;
      const d = describe(body);
      const empty = d.empty || (!p.body && !p.views);
      const allowed = DELIBERATELY_EMPTY.has(id);
      out.push({ dashboard: key, id, title, ok: allowed ? empty : !empty, text: empty ? `EMPTY${p.empty ? ` — "${p.empty}"` : ''}${allowed ? ' (deliberate)' : ''}` : d.text });
    }
  }
  return out;
}

/** Re-derives every order status with the app's own function; returns the orders it would change (rolled back). */
export async function statusCorrections(): Promise<{ orderNo: number; from: string; to: string }[]> {
  const orders = await db.all<{ id: number; orderNo: number; status: string }>(sql`SELECT id, order_no AS orderNo, status FROM orders WHERE is_stock_holder = 0`);
  const changes: { orderNo: number; from: string; to: string }[] = [];
  const ROLLBACK = new Error('rollback');
  try {
    await db.transaction(async (tx) => {
      for (const o of orders) {
        if (await recomputeOrderStatus(o.id, 'jemish', tx)) {
          const [row] = await tx.all<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${o.id}`);
          changes.push({ orderNo: o.orderNo, from: o.status, to: row.status });
        }
      }
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return changes;
}
