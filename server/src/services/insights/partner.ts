import { sql } from 'drizzle-orm';
import {
  addDays,
  AGE_BUCKETS,
  ageBucket,
  beyondTolerance,
  diffPct,
  formatValue,
  getStatus,
  gramsToKg,
  jobsheetRefShort,
  monthOf,
  monthStart,
  pct,
  poLabel,
  sum,
  type CardBody,
  type CardPayload,
} from '@rivoora/shared';
import { emptyCard, orderHref, ordersHref, rows, type InsightCtx } from './context';
import { isOpenOrder, loadMachines, loadOrders, qtyText, TAKA_M, TAKA_PCS, type OrderRow } from './data';
import { ageText, beamsCard, completedShortCard, hoursSince, machineDamageByLoom, tfoCard, tfoSections, top } from './floor';

/**
 * Sprint 25 — the Production partner dashboard (Gaurang). ±10 % cards list only items beyond the tolerance
 * (`beyondTolerance`). Quantities never mix pcs and metres.
 */

type Builder = (ctx: InsightCtx) => Promise<CardPayload>;
const orderLabel = (no: number) => `Order #${no}`;
const daysSince = (day: string, today: string) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day.slice(0, 10)}T00:00:00Z`)) / 86_400_000));
const qty = (o: OrderRow) => formatValue(o.quantity, o.unit === 'meters' ? 'm' : 'pcs');

/* ---------- strip ---------- */

const stripOnLoom: Builder = async () => {
  const [r] = await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM jobsheets WHERE status = 'ongoing' AND is_deleted = 0 AND is_external = 0`);
  return { id: 'p.s.on_loom', periodLabel: 'Now', body: { kind: 'figure', value: r?.n ?? 0, unit: 'jobsheets' }, href: '/machine-view' };
};

const stripWaitingJs: Builder = async (ctx) => {
  const list = (await loadOrders(ctx)).filter((o) => !o.isClosed && o.status === 'ready_production');
  return { id: 'p.s.waiting_js', periodLabel: 'Now', body: { kind: 'figure', value: list.length, unit: 'orders' }, href: ordersHref({ status: ['ready_production'] }) };
};

const stripQc: Builder = async () => {
  const [r] = await rows<{ butta: number; mill: number }>(sql`
    SELECT COALESCE(SUM(CASE WHEN stage = 'butta_qc' THEN 1 ELSE 0 END), 0) AS butta, COALESCE(SUM(CASE WHEN stage = 'mill_qc' THEN 1 ELSE 0 END), 0) AS mill
    FROM takas WHERE is_deleted = 0 AND stage IN ('butta_qc', 'mill_qc')`);
  const total = (r?.butta ?? 0) + (r?.mill ?? 0);
  return { id: 'p.s.qc_backlog', periodLabel: 'Now', body: { kind: 'figure', value: total, unit: 'takas', sub: `${r?.butta ?? 0} butta · ${r?.mill ?? 0} mill` } };
};

const stripOutside: Builder = async () => {
  const [r] = await rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM outside_pos WHERE status IN ('open', 'partly_received')`);
  return { id: 'p.s.outside_open', periodLabel: 'Now', body: { kind: 'figure', value: r?.n ?? 0, unit: 'count', caption: (r?.n ?? 0) === 1 ? 'PO' : 'POs' }, href: '/receive-goods' };
};

const stripTfo: Builder = async (ctx) => {
  const t = await tfoSections(ctx);
  return { id: 'p.s.tfo_running', periodLabel: 'Now', body: { kind: 'figure', value: t.running, unit: 'sections', sub: `of ${t.total} · ${t.onHold} on hold` }, href: '/yarn/tfo' };
};

/* ---------- planning ---------- */

const queue: Builder = async (ctx) => {
  const list = (await loadOrders(ctx))
    .filter((o) => !o.isClosed && (o.status === 'ready_production' || o.status === 'jobsheet_created'))
    .sort((a, b) => (a.sentToProductionAt ?? a.orderDate).localeCompare(b.sentToProductionAt ?? b.orderDate));
  if (!list.length) return emptyCard('p.queue', 'Nothing waiting to be planned', 'Now');
  const { shown, more } = top(list, 6);
  return {
    id: 'p.queue',
    periodLabel: 'Now',
    body: {
      kind: 'table',
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'design', label: 'Design' },
        { key: 'qty', label: 'Qty', align: 'right' },
        { key: 'status', label: 'Status' },
        { key: 'days', label: 'Waiting', align: 'right' },
      ],
      rows: shown.map((o) => ({
        cells: { order: orderLabel(o.orderNo), design: o.designCode ?? '—', qty: qty(o), status: getStatus(o.status).label + (o.isOnHold ? ' · on hold' : ''), days: `${daysSince(o.sentToProductionAt ?? o.orderDate, ctx.today)} d` },
        href: orderHref(o.id, 'jobsheets'),
      })),
      more,
      moreHref: ordersHref({ status: ['ready_production', 'jobsheet_created'] }),
    },
  };
};

const waitingJs: Builder = async (ctx) => {
  const list = (await loadOrders(ctx))
    .filter((o) => !o.isClosed && o.status === 'ready_production')
    .map((o) => ({ o, days: daysSince(o.sentToProductionAt ?? o.orderDate, ctx.today) }))
    .sort((a, b) => b.days - a.days);
  if (!list.length) return { ...emptyCard('p.waiting_js', 'No order is waiting for jobsheets', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(list, 6);
  return {
    id: 'p.waiting_js',
    periodLabel: 'Now',
    badge: list.some((x) => x.days > 2) ? { tone: 'amber', text: `${list.filter((x) => x.days > 2).length} over 2 days` } : null,
    body: {
      kind: 'table',
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'design', label: 'Design' },
        { key: 'days', label: 'Days waiting', align: 'right' },
      ],
      rows: shown.map(({ o, days }) => ({ cells: { order: orderLabel(o.orderNo), design: o.designCode ?? '—', days: `${days} d` }, href: orderHref(o.id, 'jobsheets'), tone: days > 2 ? 'amber' : undefined })),
      more,
      moreHref: ordersHref({ status: ['ready_production'] }),
    },
  };
};

/** Jobsheet + outside PO coverage of each open in-house order (pcs: effective frames × sections; meters: loom m × sections). */
const coverage: Builder = async (ctx) => {
  const [orders, js, pos] = await Promise.all([
    loadOrders(ctx),
    rows<{ orderId: number; pcs: number; m: number; n: number }>(sql`
      SELECT j.order_id AS orderId,
             COALESCE(SUM(CASE WHEN j.status = 'completed' AND j.completed_frames IS NOT NULL THEN j.completed_frames ELSE j.frames END * j.sections), 0) AS pcs,
             COALESCE(SUM(CASE WHEN j.status = 'completed' AND j.completed_meters IS NOT NULL THEN j.completed_meters ELSE COALESCE(j.meters, 0) END * j.sections), 0) AS m,
             COUNT(*) AS n
      FROM jobsheets j WHERE j.is_deleted = 0 AND j.is_external = 0 GROUP BY 1`),
    rows<{ orderId: number; pcs: number; m: number }>(sql`
      SELECT order_id AS orderId, COALESCE(SUM(CASE WHEN unit = 'pcs' THEN quantity END), 0) AS pcs, COALESCE(SUM(CASE WHEN unit = 'meters' THEN quantity END), 0) AS m
      FROM outside_pos WHERE status <> 'cancelled' GROUP BY 1`),
  ]);
  const jsBy = new Map(js.map((j) => [j.orderId, j]));
  const poBy = new Map(pos.map((p) => [p.orderId, p]));
  const list = orders
    .filter((o) => isOpenOrder(o) && (o.unit === 'pcs' || o.unit === 'meters') && (jsBy.has(o.id) || poBy.has(o.id)))
    .map((o) => {
      const meter = o.unit === 'meters';
      const covered = (meter ? jsBy.get(o.id)?.m : jsBy.get(o.id)?.pcs) ?? 0;
      const outside = (meter ? poBy.get(o.id)?.m : poBy.get(o.id)?.pcs) ?? 0;
      return { o, meter, covered: covered + outside, outside, diff: diffPct(covered + outside, o.quantity) };
    })
    .filter((x) => beyondTolerance(x.covered, x.o.quantity))
    .sort((a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0));
  if (!list.length) return { ...emptyCard('p.coverage', 'Every order’s jobsheets cover it within ±10 %', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(list, 6);
  return {
    id: 'p.coverage',
    periodLabel: 'Now',
    badge: { tone: 'amber', text: `${list.length} beyond ±10 %` },
    body: {
      kind: 'table',
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'design', label: 'Design' },
        { key: 'need', label: 'Needs', align: 'right' },
        { key: 'covered', label: 'Covered', align: 'right' },
        { key: 'diff', label: 'Diff', align: 'right' },
      ],
      rows: shown.map((x) => ({
        cells: {
          order: orderLabel(x.o.orderNo),
          design: x.o.designCode ?? '—',
          need: qty(x.o),
          covered: `${formatValue(x.covered, x.meter ? 'm' : 'pcs')}${x.outside ? ' (incl. outside)' : ''}`,
          diff: x.diff === null ? '—' : `${x.diff > 0 ? '+' : '−'}${Math.abs(x.diff).toFixed(0)} %`,
        },
        href: orderHref(x.o.id, 'jobsheets'),
        tone: (x.diff ?? 0) < 0 ? 'red' : 'amber',
      })),
      more,
    },
  };
};

/** Jobsheets sent more than 24 h ago and not on a loom (shared with the owner's attention panel rule). */
export function sentNotStarted(ctx: InsightCtx) {
  return ctx.memo('sent-not-started', () =>
    rows<{ jobsheetId: number; jobsheetNo: number; orderId: number; orderNo: number; designCode: string | null; sentAt: string; frames: number; isOnHold: number }>(sql`
      SELECT j.id AS jobsheetId, j.jobsheet_no AS jobsheetNo, o.id AS orderId, o.order_no AS orderNo, d.code AS designCode, j.sent_at AS sentAt, j.frames,
             o.is_on_hold AS isOnHold
      FROM jobsheets j JOIN orders o ON o.id = j.order_id LEFT JOIN designs d ON d.id = o.design_id
      WHERE j.status = 'sent' AND j.is_deleted = 0 AND j.is_external = 0 AND o.is_closed = 0 AND j.sent_at IS NOT NULL
      ORDER BY j.sent_at`),
  );
}

const notStarted: Builder = async (ctx) => {
  const list = (await sentNotStarted(ctx)).filter((j) => !j.isOnHold && hoursSince(j.sentAt, ctx.now) > 24);
  if (!list.length) return { ...emptyCard('p.not_started', 'Every jobsheet sent over a day ago is on a loom', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(list, 6);
  return {
    id: 'p.not_started',
    periodLabel: 'Now',
    badge: { tone: 'amber', text: `${list.length} waiting` },
    body: {
      kind: 'table',
      columns: [
        { key: 'js', label: 'Jobsheet' },
        { key: 'design', label: 'Design' },
        { key: 'since', label: 'Sent', align: 'right' },
      ],
      rows: shown.map((j) => ({ cells: { js: jobsheetRefShort(j.orderNo, j.jobsheetNo), design: j.designCode ?? '—', since: `${ageText(hoursSince(j.sentAt, ctx.now))} ago` }, href: `/jobsheets/${j.jobsheetId}` })),
      more,
      moreHref: '/alerts',
    },
  };
};

/* ---------- floor ---------- */

/** Jobsheets started / completed today per loom (shared with the supervisor's floor card). */
export function floorToday(ctx: InsightCtx) {
  return ctx.memo('floor-today', () =>
    rows<{ machineId: number | null; started: number; completed: number; frames: number }>(sql`
      SELECT j.running_machine_id AS machineId,
             COALESCE(SUM(CASE WHEN date(j.started_at, '+330 minutes') = ${ctx.today} THEN 1 ELSE 0 END), 0) AS started,
             COALESCE(SUM(CASE WHEN j.status = 'completed' AND date(j.completed_at, '+330 minutes') = ${ctx.today} THEN 1 ELSE 0 END), 0) AS completed,
             COALESCE(SUM(CASE WHEN j.status = 'completed' AND date(j.completed_at, '+330 minutes') = ${ctx.today} THEN COALESCE(j.completed_frames, 0) ELSE 0 END), 0) AS frames
      FROM jobsheets j
      WHERE j.is_deleted = 0 AND j.is_external = 0 AND (date(j.started_at, '+330 minutes') = ${ctx.today} OR date(j.completed_at, '+330 minutes') = ${ctx.today})
      GROUP BY 1`),
  );
}

const floorTodayCard: Builder = async (ctx) => {
  const [list, machines] = await Promise.all([floorToday(ctx), loadMachines(ctx)]);
  const started = sum(list.map((r) => r.started));
  const completed = sum(list.map((r) => r.completed));
  const noOf = new Map(machines.map((m) => [m.id, m.machineNo]));
  const byLoom = list.filter((r) => r.started || r.completed).sort((a, b) => (noOf.get(a.machineId ?? 0) ?? 9999) - (noOf.get(b.machineId ?? 0) ?? 9999));
  const { shown, more } = top(byLoom, 6);
  return {
    id: 'p.floor_today',
    periodLabel: 'Today',
    empty: byLoom.length ? null : 'Nothing started or completed yet today',
    body: {
      kind: 'table',
      head: [
        { label: 'Started', value: started, unit: 'jobsheets' },
        { label: 'Completed', value: completed, unit: 'jobsheets', sub: `${sum(list.map((r) => r.frames))} frames` },
      ],
      columns: [
        { key: 'loom', label: 'Loom' },
        { key: 'started', label: 'Started', align: 'right' },
        { key: 'completed', label: 'Completed', align: 'right' },
      ],
      rows: shown.map((r) => ({ cells: { loom: r.machineId ? `Loom ${noOf.get(r.machineId) ?? '—'}` : 'Taka entry (no loom)', started: r.started || '—', completed: r.completed || '—' } })),
      more,
    },
    href: '/machine-view',
  };
};

/* ---------- reliability ---------- */

const damagePer100: Builder = async (ctx) => {
  const from = addDays(ctx.today, -29);
  const [dmg, frames, machines] = await Promise.all([
    machineDamageByLoom(ctx, from, ctx.today),
    rows<{ machineId: number; frames: number }>(sql`
      SELECT running_machine_id AS machineId, COALESCE(SUM(completed_frames), 0) AS frames FROM jobsheets
      WHERE status = 'completed' AND is_deleted = 0 AND is_external = 0 AND running_machine_id IS NOT NULL AND date(completed_at, '+330 minutes') >= ${from}
      GROUP BY 1`),
    loadMachines(ctx),
  ]);
  const fBy = new Map(frames.map((f) => [f.machineId, f.frames]));
  const list = machines
    .map((m) => ({ m, dmg: dmg.get(m.id) ?? 0, frames: fBy.get(m.id) ?? 0 }))
    .filter((x) => x.frames > 0)
    .map((x) => ({ ...x, rate: (x.dmg / x.frames) * 100 }));
  if (!list.length) return emptyCard('p.damage_per_100', 'No frames completed in the last 30 days', 'Last 30 days');
  const avg = (sum(list.map((x) => x.dmg)) / sum(list.map((x) => x.frames))) * 100;
  const limit = avg * 1.5;
  const sorted = list.sort((a, b) => b.rate - a.rate);
  const { shown, more } = top(sorted, 5);
  const red = sorted.filter((x) => x.rate > limit && x.dmg > 0).length;
  return {
    id: 'p.damage_per_100',
    periodLabel: 'Last 30 days',
    badge: red ? { tone: 'red', text: `${red} above limit` } : { tone: 'green', text: 'Fine' },
    body: {
      kind: 'ranked',
      head: [{ label: 'Factory average', value: Number(avg.toFixed(2)), unit: 'count', sub: 'damaged pcs per 100 frames' }],
      rows: shown.map((x) => ({
        label: `Loom ${x.m.machineNo}`,
        sub: `${x.dmg} pcs on ${x.frames} frames`,
        value: x.rate,
        unit: 'count',
        valueText: `${x.rate.toFixed(2)} / 100`,
        tone: x.rate > limit && x.dmg > 0 ? 'red' : undefined,
        href: '/machine-view',
      })),
      more,
    },
  };
};

/* ---------- after the loom ---------- */

const STAGES = [
  { key: 'at_butta', label: 'At butta' },
  { key: 'butta_qc', label: 'Butta QC' },
  { key: 'waiting_mill', label: 'Waiting mill' },
  { key: 'at_mill', label: 'At mill' },
  { key: 'mill_qc', label: 'Mill QC' },
  { key: 'final', label: 'Godown' },
  { key: 'ready_dispatch', label: 'Ready' },
] as const;

const clothStage: Builder = async () => {
  const list = await rows<{ stage: string; unit: string; takas: number; pcs: number; m: number }>(sql`
    SELECT t.stage, o.unit, COUNT(*) AS takas, COALESCE(SUM(${TAKA_PCS}), 0) AS pcs, COALESCE(SUM(${TAKA_M}), 0) AS m
    FROM takas t JOIN orders o ON o.id = t.order_id
    WHERE t.is_deleted = 0 AND t.is_free_stock = 0 AND o.is_stock_holder = 0 GROUP BY 1, 2`);
  const view = (k: 'pcs' | 'takas' | 'm'): CardBody => ({
    kind: 'bars',
    unit: k,
    series: [k === 'takas' ? 'Takas' : k === 'pcs' ? 'Pcs' : 'Metres'],
    points: STAGES.map((s) => ({
      label: s.label,
      values: [sum(list.filter((r) => r.stage === s.key && (k === 'takas' || r.unit === (k === 'pcs' ? 'pcs' : 'meters'))).map((r) => r[k]))],
    })),
  });
  return {
    id: 'p.cloth_stage',
    periodLabel: 'Now',
    switch: { options: [{ value: 'pcs', label: 'Pcs' }, { value: 'takas', label: 'Takas' }, { value: 'm', label: 'm (meter orders)' }], value: 'pcs' },
    body: null,
    views: { pcs: view('pcs'), takas: view('takas'), m: view('m') },
  };
};

const qcBacklog: Builder = async (ctx) => {
  const list = await rows<{ stage: string; since: string }>(sql`
    SELECT t.stage, COALESCE(
      (SELECT MAX(ct.received_at) FROM challan_takas ct WHERE ct.taka_id = t.id AND ct.kind = CASE WHEN t.stage = 'butta_qc' THEN 'butta' ELSE 'mill' END),
      t.updated_at) AS since
    FROM takas t WHERE t.is_deleted = 0 AND t.stage IN ('butta_qc', 'mill_qc')`);
  if (!list.length) return { ...emptyCard('p.qc_backlog', 'No takas waiting for QC', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const days = (s: string) => Math.floor(hoursSince(s, ctx.now) / 24);
  const old = list.filter((r) => days(r.since) > 3).length;
  return {
    id: 'p.qc_backlog',
    periodLabel: 'Now',
    badge: old ? { tone: 'red', text: `${old} over 3 days` } : null,
    body: {
      kind: 'bars',
      unit: 'takas',
      series: ['Butta QC', 'Mill QC'],
      points: AGE_BUCKETS.map((b) => ({
        label: b,
        values: [list.filter((r) => r.stage === 'butta_qc' && ageBucket(days(r.since)) === b).length, list.filter((r) => r.stage === 'mill_qc' && ageBucket(days(r.since)) === b).length],
      })),
      summary: `${list.length} takas waiting`,
    },
  };
};

const reworkOpen: Builder = async (ctx) => {
  const list = await rows<{ stage: string; since: string }>(sql`
    SELECT t.stage, COALESCE((SELECT MAX(e.created_at) FROM taka_events e WHERE e.taka_id = t.id AND e.event IN ('sent_back', 'sent_refinish')), t.updated_at) AS since
    FROM takas t WHERE t.is_deleted = 0 AND t.stage IN ('rework_butta', 'refinish')`);
  if (!list.length) return { ...emptyCard('p.rework_open', 'No takas in re-butta or refinish', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const days = (s: string) => Math.floor(hoursSince(s, ctx.now) / 24);
  return {
    id: 'p.rework_open',
    periodLabel: 'Now',
    body: {
      kind: 'bars',
      unit: 'takas',
      series: ['Re-butta', 'Refinish'],
      points: AGE_BUCKETS.map((b) => ({
        label: b,
        values: [list.filter((r) => r.stage === 'rework_butta' && ageBucket(days(r.since)) === b).length, list.filter((r) => r.stage === 'refinish' && ageBucket(days(r.since)) === b).length],
      })),
      summary: `${list.length} takas open`,
    },
    href: '/mill',
  };
};

const waitingSend: Builder = async () => {
  const list = await rows<{ orderId: number; orderNo: number; designCode: string | null; butta: number; mill: number }>(sql`
    SELECT o.id AS orderId, o.order_no AS orderNo, d.code AS designCode,
           COALESCE(SUM(CASE WHEN (t.stage = 'entered' AND o.has_butta = 1) OR t.stage = 'rework_butta' THEN 1 ELSE 0 END), 0) AS butta,
           COALESCE(SUM(CASE WHEN t.stage IN ('waiting_mill', 'refinish') THEN 1 ELSE 0 END), 0) AS mill
    FROM takas t JOIN orders o ON o.id = COALESCE(t.allocated_order_id, t.order_id) LEFT JOIN designs d ON d.id = o.design_id
    WHERE t.is_deleted = 0 AND t.is_free_stock = 0 AND o.is_closed = 0 AND o.is_on_hold = 0 AND o.is_stock_holder = 0
      AND (((t.stage = 'entered' AND o.has_butta = 1) OR t.stage = 'rework_butta') OR t.stage IN ('waiting_mill', 'refinish'))
    GROUP BY o.id ORDER BY (butta + mill) DESC`);
  if (!list.length) return emptyCard('p.waiting_send', 'Nothing is waiting to go to butta or the mill', 'Now');
  const { shown, more } = top(list, 6);
  return {
    id: 'p.waiting_send',
    periodLabel: 'Now',
    body: {
      kind: 'table',
      head: [
        { label: 'For butta', value: sum(list.map((r) => r.butta)), unit: 'takas', href: '/butta' },
        { label: 'For mill', value: sum(list.map((r) => r.mill)), unit: 'takas', href: '/mill' },
      ],
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'design', label: 'Design' },
        { key: 'butta', label: 'For butta', align: 'right' },
        { key: 'mill', label: 'For mill', align: 'right' },
      ],
      rows: shown.map((r) => ({ cells: { order: orderLabel(r.orderNo), design: r.designCode ?? '—', butta: r.butta || '—', mill: r.mill || '—' }, href: orderHref(r.orderId, 'takas') })),
      more,
    },
  };
};

/* ---------- outside & FG ---------- */

function openPos(ctx: InsightCtx) {
  return ctx.memo('open-pos', () =>
    rows<{ id: number; poNo: number; orderId: number; orderNo: number; weaverId: number; weaverName: string; unit: string; quantity: number; receivedQty: number; poDate: string; dueDate: string | null }>(sql`
      SELECT p.id, p.po_no AS poNo, p.order_id AS orderId, o.order_no AS orderNo, p.weaver_id AS weaverId, w.name AS weaverName, p.unit, p.quantity,
             p.received_qty AS receivedQty, p.po_date AS poDate, p.due_date AS dueDate
      FROM outside_pos p JOIN weavers w ON w.id = p.weaver_id JOIN orders o ON o.id = p.order_id
      WHERE p.status IN ('open', 'partly_received')`),
  );
}

const outsideMonth: Builder = async (ctx) => {
  const from = monthStart(monthOf(ctx.today));
  const [given, received] = await Promise.all([
    rows<{ n: number; pcs: number; m: number }>(sql`
      SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN unit = 'pcs' THEN quantity END), 0) AS pcs, COALESCE(SUM(CASE WHEN unit = 'meters' THEN quantity END), 0) AS m
      FROM outside_pos WHERE status <> 'cancelled' AND po_date >= ${from}`),
    rows<{ kind: string; n: number; pcs: number; m: number }>(sql`
      SELECT kind, COUNT(*) AS n, COALESCE(SUM(pcs), 0) AS pcs, COALESCE(SUM(meters), 0) AS m FROM outside_receipts WHERE receipt_date >= ${from} GROUP BY 1`),
  ]);
  const g = given[0] ?? { n: 0, pcs: 0, m: 0 };
  const r = received.find((x) => x.kind === 'outside_po') ?? { n: 0, pcs: 0, m: 0 };
  const fg = received.find((x) => x.kind === 'fg') ?? { n: 0, pcs: 0, m: 0 };
  return {
    id: 'p.outside_month',
    periodLabel: 'This month',
    body: {
      kind: 'split',
      items: [
        { label: 'POs given', value: g.n, unit: 'count', sub: qtyText(g.pcs, g.m) },
        { label: 'Received from weavers', value: r.pcs, unit: 'pcs', sub: `${formatValue(r.m, 'm')} · ${r.n} challan${r.n === 1 ? '' : 's'}` },
        { label: 'FG received', value: fg.pcs, unit: 'pcs', sub: `${formatValue(fg.m, 'm')} · ${fg.n} challan${fg.n === 1 ? '' : 's'}` },
      ],
    },
    href: '/receive-goods',
  };
};

const outsideByWeaver: Builder = async (ctx) => {
  const pos = await openPos(ctx);
  if (!pos.length) return emptyCard('p.outside_weaver', 'No outside PO is open', 'Now');
  const view = (unit: 'pcs' | 'meters'): CardBody => {
    const by = new Map<number, { name: string; qty: number; n: number }>();
    for (const p of pos.filter((x) => x.unit === unit)) {
      const w = by.get(p.weaverId) ?? { name: p.weaverName, qty: 0, n: 0 };
      w.qty += Math.max(0, p.quantity - p.receivedQty);
      w.n += 1;
      by.set(p.weaverId, w);
    }
    const sorted = [...by.values()].sort((a, b) => b.qty - a.qty);
    const { shown, more } = top(sorted, 5);
    return { kind: 'ranked', rows: shown.map((w) => ({ label: w.name, sub: `${w.n} PO${w.n === 1 ? '' : 's'}`, value: w.qty, unit: unit === 'pcs' ? 'pcs' : 'm', href: '/receive-goods' })), more };
  };
  return {
    id: 'p.outside_weaver',
    periodLabel: 'Now',
    switch: { options: [{ value: 'pcs', label: 'Pcs' }, { value: 'm', label: 'All-over (m)' }], value: 'pcs' },
    body: null,
    views: { pcs: view('pcs'), m: view('meters') },
  };
};

const latePos: Builder = async (ctx) => {
  const list = (await openPos(ctx))
    .filter((p) => p.dueDate && p.dueDate < ctx.today)
    .map((p) => ({ p, late: daysSince(p.dueDate!, ctx.today) }))
    .sort((a, b) => b.late - a.late);
  if (!list.length) return { ...emptyCard('p.late_pos', 'No outside PO is past its due date', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(list, 6);
  return {
    id: 'p.late_pos',
    periodLabel: 'Now',
    badge: { tone: 'red', text: `${list.length} late` },
    body: {
      kind: 'table',
      columns: [
        { key: 'po', label: 'PO' },
        { key: 'weaver', label: 'Weaver' },
        { key: 'open', label: 'Pending', align: 'right' },
        { key: 'late', label: 'Late', align: 'right' },
      ],
      rows: shown.map(({ p, late }) => ({
        cells: { po: `${poLabel(p.poNo)} · ${orderLabel(p.orderNo)}`, weaver: p.weaverName, open: formatValue(Math.max(0, p.quantity - p.receivedQty), p.unit === 'pcs' ? 'pcs' : 'm'), late: `${late} d` },
        href: orderHref(p.orderId, 'outside'),
        tone: 'red',
      })),
      more,
    },
  };
};

const weaverQuality: Builder = async (ctx) => {
  const from = addDays(ctx.today, -89);
  const list = await rows<{ weaverId: number; name: string; pcs: number; damaged: number; n: number }>(sql`
    SELECT r.weaver_id AS weaverId, w.name, COALESCE(SUM(r.pcs), 0) AS pcs, COALESCE(SUM(r.damaged_pcs), 0) AS damaged, COUNT(*) AS n
    FROM outside_receipts r JOIN weavers w ON w.id = r.weaver_id
    WHERE r.kind = 'outside_po' AND r.receipt_date >= ${from} GROUP BY 1`);
  const rated = list.filter((w) => w.pcs > 0).map((w) => ({ ...w, pct: pct(w.damaged, w.pcs) ?? 0 }));
  if (!rated.length) return emptyCard('p.weaver_quality', 'No pcs received from weavers in 90 days', 'Last 90 days');
  const avg = pct(sum(rated.map((w) => w.damaged)), sum(rated.map((w) => w.pcs))) ?? 0;
  const sorted = rated.sort((a, b) => b.pct - a.pct);
  const { shown, more } = top(sorted, 5);
  return {
    id: 'p.weaver_quality',
    periodLabel: 'Last 90 days',
    body: {
      kind: 'ranked',
      head: [{ label: 'All weavers', value: avg, unit: 'pct' }],
      rows: shown.map((w) => ({ label: w.name, sub: `${w.damaged} of ${w.pcs} pcs · ${w.n} challan${w.n === 1 ? '' : 's'}`, value: w.pct, unit: 'pct', tone: w.pct > Math.max(2, avg * 1.5) ? 'red' : undefined, href: '/receive-goods' })),
      more,
    },
  };
};

const fgAwaiting: Builder = async (ctx) => {
  const [orders, got] = await Promise.all([
    loadOrders(ctx),
    rows<{ orderId: number; pcs: number; m: number }>(sql`
      SELECT COALESCE(t.allocated_order_id, t.order_id) AS orderId, COALESCE(SUM(${TAKA_PCS}), 0) AS pcs, COALESCE(SUM(${TAKA_M}), 0) AS m
      FROM takas t WHERE t.is_deleted = 0 AND t.is_free_stock = 0 GROUP BY 1`),
  ]);
  const have = new Map(got.map((g) => [g.orderId, g]));
  const list = orders
    .filter((o) => !o.isClosed && !o.hasProduction && !o.hasButta && !o.hasMill && o.status !== 'pending_production' && isOpenOrder(o) && (o.unit === 'pcs' || o.unit === 'meters'))
    .map((o) => {
      const received = o.unit === 'pcs' ? (have.get(o.id)?.pcs ?? 0) : (have.get(o.id)?.m ?? 0);
      return { o, received, days: daysSince(o.sentToProductionAt ?? o.orderDate, ctx.today) };
    })
    .filter((x) => x.received < x.o.quantity)
    .sort((a, b) => b.days - a.days);
  if (!list.length) return emptyCard('p.fg_awaiting', 'No FG purchase is waiting for goods', 'Now');
  const { shown, more } = top(list, 6);
  const unit = (o: OrderRow) => (o.unit === 'pcs' ? 'pcs' : 'm');
  return {
    id: 'p.fg_awaiting',
    periodLabel: 'Now',
    body: {
      kind: 'table',
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'design', label: 'Design' },
        { key: 'got', label: 'Received', align: 'right' },
        { key: 'days', label: 'Waiting', align: 'right' },
      ],
      rows: shown.map((x) => ({ cells: { order: orderLabel(x.o.orderNo), design: x.o.designCode ?? '—', got: `${formatValue(x.received, unit(x.o))} of ${formatValue(x.o.quantity, unit(x.o))}`, days: `${x.days} d` }, href: orderHref(x.o.id) })),
      more,
      moreHref: ordersHref({ kind: ['fg_purchase'] }),
    },
  };
};

/* ---------- yarn ---------- */

const lowYarn: Builder = async () => {
  const list = await rows<{ id: number; name: string; minG: number; stock: number; reserved: number }>(sql`
    SELECT q.id, q.name, q.min_g AS minG,
           COALESCE((SELECT SUM(m.qty_g) FROM yarn_stock_moves m WHERE m.quality_id = q.id AND m.item = 'raw'), 0) AS stock,
           COALESCE((SELECT SUM(p.raw_g) FROM tfo_pending_programs p WHERE p.status = 'pending' AND p.raw_quality_id = q.id), 0)
             + COALESCE((SELECT SUM(i.qty_g) FROM warping_pending_job_inputs i JOIN warping_pending_jobs j ON j.id = i.job_id WHERE j.status = 'pending' AND i.item = 'raw' AND i.quality_id = q.id), 0) AS reserved
    FROM yarn_qualities q WHERE q.is_deleted = 0 AND q.is_system = 0 AND q.min_g IS NOT NULL AND q.min_g > 0`);
  const low = list.map((q) => ({ ...q, available: Math.max(0, q.stock - q.reserved) })).filter((q) => q.available < q.minG).sort((a, b) => a.available / a.minG - b.available / b.minG);
  if (!list.length) return emptyCard('p.low_yarn', 'Set a minimum kg on yarn qualities (Masters → Yarn qualities) to watch them here', 'Now');
  if (!low.length) return { ...emptyCard('p.low_yarn', 'Every watched quality is above its minimum', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(low, 6);
  return {
    id: 'p.low_yarn',
    periodLabel: 'Now',
    badge: { tone: 'red', text: `${low.length} low` },
    body: {
      kind: 'table',
      columns: [
        { key: 'q', label: 'Quality' },
        { key: 'avail', label: 'Available', align: 'right' },
        { key: 'min', label: 'Minimum', align: 'right' },
      ],
      rows: shown.map((q) => ({ cells: { q: q.name, avail: formatValue(gramsToKg(q.available), 'kg'), min: formatValue(gramsToKg(q.minG), 'kg') }, href: '/yarn', tone: 'red' })),
      more,
    },
    href: '/yarn',
  };
};

export const PARTNER_CARDS: Record<string, Builder> = {
  'p.s.on_loom': stripOnLoom,
  'p.s.waiting_js': stripWaitingJs,
  'p.s.qc_backlog': stripQc,
  'p.s.outside_open': stripOutside,
  'p.s.tfo_running': stripTfo,
  'p.queue': queue,
  'p.waiting_js': waitingJs,
  'p.coverage': coverage,
  'p.not_started': notStarted,
  'p.floor_today': floorTodayCard,
  'p.damage_per_100': damagePer100,
  'p.completed_short': (ctx) => completedShortCard(ctx, 'p.completed_short', null),
  'p.cloth_stage': clothStage,
  'p.qc_backlog': qcBacklog,
  'p.rework_open': reworkOpen,
  'p.waiting_send': waitingSend,
  'p.outside_month': outsideMonth,
  'p.outside_weaver': outsideByWeaver,
  'p.late_pos': latePos,
  'p.weaver_quality': weaverQuality,
  'p.fg_awaiting': fgAwaiting,
  'p.tfo': (ctx) => tfoCard(ctx, 'p.tfo'),
  'p.beams_needed': (ctx) => beamsCard(ctx, 'p.beams_needed', true),
  'p.low_yarn': lowYarn,
};

