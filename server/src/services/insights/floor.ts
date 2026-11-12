import { sql } from 'drizzle-orm';
import {
  beyondTolerance,
  diffPct,
  formatValue,
  framesFromTakaPcs,
  jobsheetRefShort,
  metersFromTakaMeters,
  sum,
  type CardPayload,
  type DrawerRow,
} from '@rivoora/shared';
import { emptyCard, rows, type InsightCtx } from './context';
import { loadMachines, TAKA_M, TAKA_PCS } from './data';

/**
 * Sprint 25 — cards the Production partner and the Supervisor dashboards share (TFO sections, machine damage per loom,
 * completed short, beams in stock). Each builder takes the card id it answers for.
 */

export const top = <T>(xs: T[], n: number) => ({ shown: xs.slice(0, n), more: Math.max(0, xs.length - n) });
export const drawerOf = (title: string, list: DrawerRow[], href: string | null) => ({ title, rows: list.slice(0, 20), more: Math.max(0, list.length - 20), href });
export const hoursSince = (at: string, now: Date) => Math.max(0, (now.getTime() - new Date(at).getTime()) / 3_600_000);
export const ageText = (hours: number) => (hours >= 48 ? `${Math.floor(hours / 24)} d` : `${Math.floor(hours)} h`);
/** The IST midnight of a day, as an instant. */
export const istStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 330 * 60_000).toISOString();

/* ---------- TFO sections ---------- */

export async function tfoSections(ctx: InsightCtx): Promise<{ running: number; idle: number; onHold: number; boxPending: number; total: number }> {
  return ctx.memo('tfo-sections', async () => {
    const [[m], [r], [h]] = await Promise.all([
      rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM tfo_machines WHERE is_deleted = 0 AND is_active = 1`),
      rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM tfo_program_sections ps JOIN tfo_machines tm ON tm.id = ps.machine_id WHERE ps.is_running = 1 AND tm.is_deleted = 0`),
      rows<{ onHold: number; boxPending: number }>(sql`
        SELECT COALESCE(SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END), 0) AS onHold,
               COALESCE(SUM(CASE WHEN status = 'box_pending' THEN 1 ELSE 0 END), 0) AS boxPending
        FROM tfo_programs WHERE status IN ('on_hold', 'box_pending')`),
    ]);
    const total = (m?.n ?? 0) * 2;
    const running = r?.n ?? 0;
    return { running, idle: Math.max(0, total - running), onHold: h?.onHold ?? 0, boxPending: h?.boxPending ?? 0, total };
  });
}

export async function tfoCard(ctx: InsightCtx, id: string): Promise<CardPayload> {
  const t = await tfoSections(ctx);
  if (!t.total) return emptyCard(id, 'No active TFO machines', 'Now');
  return {
    id,
    periodLabel: 'Now',
    body: {
      kind: 'split',
      items: [
        { label: 'Running', value: t.running, unit: 'sections', sub: `of ${t.total}`, href: '/yarn/tfo' },
        { label: 'On hold', value: t.onHold, unit: 'count', sub: t.onHold === 1 ? 'program' : 'programs', tone: t.onHold ? 'amber' : undefined, href: '/yarn/tfo?tab=on_hold' },
        { label: 'Idle', value: t.idle, unit: 'sections', href: '/yarn/tfo' },
      ],
    },
    href: '/yarn/tfo',
  };
}

/* ---------- machine damage per loom ---------- */

/** Machine damage pcs (in-house takas) recorded from `fromDay` (IST), per loom the jobsheet ran on. */
export function machineDamageByLoom(ctx: InsightCtx, fromDay: string, toDay: string): Promise<Map<number, number>> {
  return ctx.memo(`mdmg-${fromDay}-${toDay}`, async () => {
    const list = await rows<{ machineId: number; pcs: number }>(sql`
      SELECT j.running_machine_id AS machineId, COALESCE(SUM(td.pcs), 0) AS pcs
      FROM taka_damages td
      JOIN takas t ON t.id = td.taka_id
      JOIN jobsheets j ON j.id = t.jobsheet_id
      WHERE td.is_deleted = 0 AND td.found_at = 'machine' AND t.source = 'production' AND j.running_machine_id IS NOT NULL
        AND date(td.created_at, '+330 minutes') BETWEEN ${fromDay} AND ${toDay}
      GROUP BY 1`);
    return new Map(list.map((r) => [r.machineId, r.pcs]));
  });
}

export async function damageByLoomCard(ctx: InsightCtx, id: string, fromDay: string, periodLabel: string, empty: string): Promise<CardPayload> {
  const [by, machines] = await Promise.all([machineDamageByLoom(ctx, fromDay, ctx.today), loadMachines(ctx)]);
  const list = machines.map((m) => ({ m, pcs: by.get(m.id) ?? 0 })).filter((x) => x.pcs > 0).sort((a, b) => b.pcs - a.pcs);
  if (!list.length) return { ...emptyCard(id, empty, periodLabel), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(list, 5);
  return {
    id,
    periodLabel,
    badge: { tone: 'amber', text: `${sum(list.map((x) => x.pcs))} pcs` },
    body: { kind: 'ranked', rows: shown.map((x) => ({ label: `Loom ${x.m.machineNo}`, value: x.pcs, unit: 'pcs', href: '/machine-view' })), more },
    href: '/machine-view',
  };
}

/* ---------- completed short (±10 %) ---------- */

interface ShortRow {
  jobsheetId: number;
  jobsheetNo: number;
  orderNo: number;
  unit: string;
  frames: number;
  meters: number | null;
  sections: number;
  machineNo: number | null;
  completedAt: string;
  takaPcs: number;
  takaM: number;
  takas: number;
}

/**
 * Completed jobsheets (in the period) whose taka-based frames (pcs ÷ sections; m ÷ sections for meter orders) differ from
 * the assigned frames / metres by MORE than ±10 %. `onlyUser` = jobsheets this user started or completed.
 */
export async function completedShortCard(ctx: InsightCtx, id: string, onlyUser: number | null): Promise<CardPayload> {
  const { from, to } = ctx.period;
  const list = await rows<ShortRow>(sql`
    SELECT j.id AS jobsheetId, j.jobsheet_no AS jobsheetNo, o.order_no AS orderNo, o.unit, j.frames, j.meters, j.sections,
           m.machine_no AS machineNo, j.completed_at AS completedAt,
           COALESCE(SUM(CASE WHEN t.id IS NOT NULL THEN ${TAKA_PCS} END), 0) AS takaPcs,
           COALESCE(SUM(CASE WHEN t.id IS NOT NULL THEN ${TAKA_M} END), 0) AS takaM,
           COUNT(t.id) AS takas
    FROM jobsheets j
    JOIN orders o ON o.id = j.order_id
    LEFT JOIN machines m ON m.id = j.running_machine_id
    LEFT JOIN takas t ON t.jobsheet_id = j.id AND t.is_deleted = 0 AND t.parent_taka_id IS NULL AND t.is_return_lot = 0
    WHERE j.status = 'completed' AND j.is_deleted = 0 AND j.is_external = 0 AND j.completed_at IS NOT NULL
      AND date(j.completed_at, '+330 minutes') BETWEEN ${from} AND ${to}
      ${onlyUser !== null ? sql`AND EXISTS (SELECT 1 FROM jobsheet_events e WHERE e.jobsheet_id = j.id AND e.user_id = ${onlyUser} AND e.event IN ('started', 'completed'))` : sql``}
    GROUP BY j.id`);
  const short = list
    .filter((j) => j.takas > 0)
    .map((j) => {
      const meter = j.unit === 'meters';
      const assigned = meter ? (j.meters ?? 0) : j.frames;
      const actual = meter ? metersFromTakaMeters(j.takaM, j.sections) : framesFromTakaPcs(j.takaPcs, j.sections);
      return { j, meter, assigned, actual, diff: diffPct(actual, assigned) };
    })
    .filter((x) => beyondTolerance(x.actual, x.assigned))
    .sort((a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0));
  if (!short.length) return { ...emptyCard(id, 'Every completed jobsheet is within ±10 %', ctx.period.label), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(short, 6);
  const fmt = (v: number, meter: boolean) => (meter ? formatValue(v, 'm') : formatValue(v, 'frames'));
  return {
    id,
    periodLabel: ctx.period.label,
    badge: { tone: 'amber', text: `${short.length} beyond ±10 %` },
    body: {
      kind: 'table',
      columns: [
        { key: 'js', label: 'Jobsheet' },
        { key: 'loom', label: 'Loom' },
        { key: 'assigned', label: 'Assigned', align: 'right' },
        { key: 'actual', label: 'From takas', align: 'right' },
        { key: 'diff', label: 'Diff', align: 'right' },
      ],
      rows: shown.map((x) => ({
        cells: {
          js: jobsheetRefShort(x.j.orderNo, x.j.jobsheetNo),
          loom: x.j.machineNo ?? '—',
          assigned: fmt(x.assigned, x.meter),
          actual: fmt(x.actual, x.meter),
          diff: x.diff === null ? '—' : `${x.diff > 0 ? '+' : '−'}${Math.abs(x.diff).toFixed(0)} %`,
        },
        href: `/jobsheets/${x.j.jobsheetId}`,
        tone: (x.diff ?? 0) < 0 ? 'red' : 'amber',
      })),
      more,
    },
  };
}

/* ---------- beams ---------- */

export function beamsInStock(ctx: InsightCtx): Promise<{ name: string; n: number; m: number }[]> {
  return ctx.memo('beams', () =>
    rows<{ name: string; n: number; m: number }>(sql`
      SELECT COALESCE(wq.name, q.name) AS name, COUNT(*) AS n, COALESCE(SUM(b.meters), 0) AS m
      FROM beams b JOIN yarn_qualities q ON q.id = b.quality_id LEFT JOIN warping_qualities wq ON wq.id = b.warping_quality_id
      WHERE b.status = 'in_stock' GROUP BY 1 ORDER BY 2 DESC`),
  );
}

export async function beamsCard(ctx: InsightCtx, id: string, withNeeded: boolean): Promise<CardPayload> {
  const [beams, [need]] = await Promise.all([
    beamsInStock(ctx),
    withNeeded
      ? rows<{ pending: number; sent: number }>(sql`
          SELECT COALESCE(SUM(CASE WHEN j.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending, COALESCE(SUM(CASE WHEN j.status = 'sent' THEN 1 ELSE 0 END), 0) AS sent
          FROM jobsheets j JOIN orders o ON o.id = j.order_id
          WHERE j.is_deleted = 0 AND j.is_external = 0 AND j.status IN ('pending', 'sent') AND o.is_closed = 0`)
      : Promise.resolve([{ pending: 0, sent: 0 }]),
  ]);
  const total = sum(beams.map((b) => b.n));
  if (!total && !withNeeded) return emptyCard(id, 'No beams in stock', 'Now');
  const { shown, more } = top(beams, 5);
  return {
    id,
    periodLabel: 'Now',
    body: {
      kind: 'ranked',
      head: withNeeded
        ? [
            { label: 'Beams in stock', value: total, unit: 'beams', href: '/yarn/warping/stock?view=beams' },
            { label: 'Jobsheets pending / sent', value: (need?.pending ?? 0) + (need?.sent ?? 0), unit: 'jobsheets', sub: `${need?.pending ?? 0} pending · ${need?.sent ?? 0} sent`, tone: total < (need?.pending ?? 0) + (need?.sent ?? 0) ? 'amber' : undefined },
          ]
        : [{ label: 'Beams in stock', value: total, unit: 'beams', href: '/yarn/warping/stock?view=beams' }],
      rows: shown.map((b) => ({ label: b.name, value: b.n, unit: 'beams', valueText: `${b.n} beam${b.n === 1 ? '' : 's'} · ${formatValue(b.m, 'm')}`, href: '/yarn/warping/stock?view=beams' })),
      more,
    },
    href: '/yarn/warping/stock?view=beams',
  };
}

