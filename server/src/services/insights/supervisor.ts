import { sql } from 'drizzle-orm';
import { addDays, gramsToKg, jobsheetRefShort, sum, type CardPayload } from '@rivoora/shared';
import { emptyCard, rows, type InsightCtx } from './context';
import { loadMachines } from './data';
import { ageText, beamsCard, completedShortCard, damageByLoomCard, hoursSince, machineDamageByLoom, tfoCard, top } from './floor';
import { floorToday, sentNotStarted } from './partner';

/**
 * Sprint 25 — the Supervisor dashboard. Order numbers only (never a client or a rate). "My" jobsheets = the ones the
 * logged-in supervisor started or completed; owners looking at this dashboard see all of them.
 */

type Builder = (ctx: InsightCtx) => Promise<CardPayload>;

/** Looms with a jobsheet on them right now (distinct running machines of ongoing jobsheets). */
async function loomsNow(ctx: InsightCtx): Promise<{ running: number; idle: number; onLoom: number }> {
  return ctx.memo('looms-now', async () => {
    const [machines, [r]] = await Promise.all([
      loadMachines(ctx),
      rows<{ looms: number; jobsheets: number }>(sql`
        SELECT COUNT(DISTINCT j.running_machine_id) AS looms, COUNT(*) AS jobsheets FROM jobsheets j
        JOIN machines m ON m.id = j.running_machine_id
        WHERE j.status = 'ongoing' AND j.is_deleted = 0 AND j.is_external = 0 AND m.is_deleted = 0 AND m.is_active = 1`),
    ]);
    const running = r?.looms ?? 0;
    return { running, idle: Math.max(0, machines.length - running), onLoom: r?.jobsheets ?? 0 };
  });
}

const mine = (ctx: InsightCtx) => (ctx.role === 'supervisor' ? ctx.userId : null);

const stripRunning: Builder = async (ctx) => ({ id: 's.s.running', periodLabel: 'Now', body: { kind: 'figure', value: (await loomsNow(ctx)).running, unit: 'count', caption: 'looms' }, href: '/machine-view' });
const stripIdle: Builder = async (ctx) => {
  const n = (await loomsNow(ctx)).idle;
  return { id: 's.s.idle', periodLabel: 'Now', badge: n ? { tone: 'amber', text: 'Idle' } : null, body: { kind: 'figure', value: n, unit: 'count', caption: 'looms' }, href: '/machine-view' };
};
const stripStarted: Builder = async (ctx) => ({ id: 's.s.started', periodLabel: 'Today', body: { kind: 'figure', value: sum((await floorToday(ctx)).map((r) => r.started)), unit: 'jobsheets' }, href: '/jobsheets?tab=ongoing' });
const stripCompleted: Builder = async (ctx) => ({ id: 's.s.completed', periodLabel: 'Today', body: { kind: 'figure', value: sum((await floorToday(ctx)).map((r) => r.completed)), unit: 'jobsheets' }, href: '/jobsheets?tab=completed' });
const stripDamage: Builder = async (ctx) => {
  const pcs = sum([...(await machineDamageByLoom(ctx, ctx.today, ctx.today)).values()]);
  return { id: 's.s.damage', periodLabel: 'Today', badge: pcs ? { tone: 'amber', text: 'Watch' } : { tone: 'green', text: 'Fine' }, body: { kind: 'figure', value: pcs, unit: 'pcs', caption: 'machine damage' } };
};

const floorTodayCard: Builder = async (ctx) => {
  const [l, today] = await Promise.all([loomsNow(ctx), floorToday(ctx)]);
  return {
    id: 's.floor_today',
    periodLabel: 'Now · today',
    body: {
      kind: 'split',
      items: [
        { label: 'Looms running', value: l.running, unit: 'count', href: '/machine-view' },
        { label: 'Looms idle', value: l.idle, unit: 'count', tone: l.idle ? 'amber' : undefined, href: '/machine-view' },
        { label: 'On loom', value: l.onLoom, unit: 'jobsheets', href: '/jobsheets?tab=ongoing' },
        { label: 'Started today', value: sum(today.map((r) => r.started)), unit: 'jobsheets' },
        { label: 'Completed today', value: sum(today.map((r) => r.completed)), unit: 'jobsheets', href: '/jobsheets?tab=completed' },
      ],
    },
  };
};

const waitingLongest: Builder = async (ctx) => {
  const list = (await sentNotStarted(ctx)).filter((j) => !j.isOnHold);
  if (!list.length) return emptyCard('s.waiting_longest', 'No jobsheet is waiting to start', 'Now');
  const { shown, more } = top(list, 6);
  return {
    id: 's.waiting_longest',
    periodLabel: 'Now',
    body: {
      kind: 'table',
      columns: [
        { key: 'js', label: 'Order (jobsheet)' },
        { key: 'design', label: 'Design' },
        { key: 'frames', label: 'Frames', align: 'right' },
        { key: 'wait', label: 'Waiting', align: 'right' },
      ],
      rows: shown.map((j) => {
        const h = hoursSince(j.sentAt, ctx.now);
        return { cells: { js: jobsheetRefShort(j.orderNo, j.jobsheetNo), design: j.designCode ?? '—', frames: j.frames, wait: ageText(h) }, href: `/jobsheets/${j.jobsheetId}`, tone: h > 24 ? 'amber' : undefined };
      }),
      more,
      moreHref: '/jobsheets?tab=pending',
    },
  };
};

const onHold: Builder = async (ctx) => {
  const list = await rows<{ orderNo: number; heldAt: string | null; jobsheets: number; firstId: number }>(sql`
    SELECT o.order_no AS orderNo, o.held_at AS heldAt, COUNT(*) AS jobsheets, MIN(j.id) AS firstId
    FROM jobsheets j JOIN orders o ON o.id = j.order_id
    WHERE o.is_on_hold = 1 AND o.is_closed = 0 AND j.status = 'sent' AND j.is_deleted = 0 AND j.is_external = 0
    GROUP BY o.id ORDER BY o.held_at`);
  if (!list.length) return { ...emptyCard('s.on_hold', 'No held order has jobsheets waiting', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(list, 6);
  return {
    id: 's.on_hold',
    periodLabel: 'Now',
    badge: { tone: 'red', text: 'Don’t start' },
    body: {
      kind: 'table',
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'js', label: 'Jobsheets sent', align: 'right' },
        { key: 'since', label: 'Held', align: 'right' },
      ],
      rows: shown.map((o) => ({ cells: { order: `Order #${o.orderNo}`, js: o.jobsheets, since: o.heldAt ? `${ageText(hoursSince(o.heldAt, ctx.now))} ago` : '—' }, tone: 'red' })),
      more,
    },
  };
};

const linedUp: Builder = async (ctx) => {
  const [list, machines] = await Promise.all([
    rows<{ machineId: number; n: number; frames: number }>(sql`
      SELECT jm.machine_id AS machineId, COUNT(*) AS n, COALESCE(SUM(j.frames), 0) AS frames
      FROM jobsheet_machines jm JOIN jobsheets j ON j.id = jm.jobsheet_id JOIN orders o ON o.id = j.order_id
      WHERE j.status = 'sent' AND j.is_deleted = 0 AND j.is_external = 0 AND o.is_on_hold = 0 AND o.is_closed = 0
      GROUP BY 1`),
    loadMachines(ctx),
  ]);
  const noOf = new Map(machines.map((m) => [m.id, m.machineNo]));
  const sorted = list.filter((r) => noOf.has(r.machineId)).sort((a, b) => noOf.get(a.machineId)! - noOf.get(b.machineId)!);
  if (!sorted.length) return emptyCard('s.lined_up', 'No jobsheets lined up', 'Now');
  const { shown, more } = top(sorted, 6);
  return {
    id: 's.lined_up',
    periodLabel: 'Now',
    body: {
      kind: 'table',
      columns: [
        { key: 'loom', label: 'Loom' },
        { key: 'n', label: 'Jobsheets', align: 'right' },
        { key: 'frames', label: 'Frames', align: 'right' },
      ],
      rows: shown.map((r) => ({ cells: { loom: `Loom ${noOf.get(r.machineId)}`, n: r.n, frames: r.frames } })),
      more,
      moreHref: '/jobsheets?tab=pending',
    },
  };
};

const warping: Builder = async () => {
  const [[r]] = await Promise.all([
    rows<{ inProcess: number; pending: number }>(sql`
      SELECT (SELECT COUNT(*) FROM warping_jobs WHERE status = 'in_process') AS inProcess, (SELECT COUNT(*) FROM warping_pending_jobs WHERE status = 'pending') AS pending`),
  ]);
  return {
    id: 's.warping',
    periodLabel: 'Now',
    body: {
      kind: 'split',
      items: [
        { label: 'In process', value: r?.inProcess ?? 0, unit: 'count', sub: 'jobs', href: '/yarn/warping' },
        { label: 'Pending', value: r?.pending ?? 0, unit: 'count', sub: 'jobs', href: '/yarn/warping?tab=pending' },
      ],
    },
    href: '/yarn/warping',
  };
};

const yarnComing: Builder = async () => {
  const list = await rows<{ name: string; pending: number; pos: number }>(sql`
    SELECT q.name, SUM(MAX(l.qty_g - COALESCE((SELECT SUM(rl.qty_g) FROM yarn_receipt_lines rl WHERE rl.po_line_id = l.id), 0), 0)) AS pending,
           COUNT(DISTINCT p.id) AS pos
    FROM yarn_po_lines l JOIN yarn_pos p ON p.id = l.po_id JOIN yarn_qualities q ON q.id = l.quality_id
    WHERE p.status IN ('open', 'partly_received')
    GROUP BY q.id HAVING pending > 0 ORDER BY pending DESC`);
  if (!list.length) return emptyCard('s.yarn_coming', 'No yarn is on order', 'Now');
  const { shown, more } = top(list, 5);
  return {
    id: 's.yarn_coming',
    periodLabel: 'Now',
    body: {
      kind: 'ranked',
      head: [{ label: 'Still to come', value: gramsToKg(sum(list.map((r) => r.pending))), unit: 'kg' }],
      rows: shown.map((r) => ({ label: r.name, sub: `${r.pos} PO${r.pos === 1 ? '' : 's'}`, value: gramsToKg(r.pending), unit: 'kg', href: '/yarn-po' })),
      more,
    },
    href: '/yarn-po',
  };
};

export const SUPERVISOR_CARDS: Record<string, Builder> = {
  's.s.running': stripRunning,
  's.s.idle': stripIdle,
  's.s.started': stripStarted,
  's.s.completed': stripCompleted,
  's.s.damage': stripDamage,
  's.floor_today': floorTodayCard,
  's.damage_today': (ctx) => damageByLoomCard(ctx, 's.damage_today', ctx.today, 'Today', 'No machine damage today'),
  's.completed_short': (ctx) => completedShortCard(ctx, 's.completed_short', mine(ctx)),
  's.waiting_longest': waitingLongest,
  's.on_hold': onHold,
  's.damage_week': (ctx) => damageByLoomCard(ctx, 's.damage_week', addDays(ctx.today, -6), 'Last 7 days', 'No machine damage this week'),
  's.lined_up': linedUp,
  's.beams': (ctx) => beamsCard(ctx, 's.beams', false),
  's.tfo': (ctx) => tfoCard(ctx, 's.tfo'),
  's.warping': warping,
  's.yarn_coming': yarnComing,
};

