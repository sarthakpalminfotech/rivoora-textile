import { sql } from 'drizzle-orm';
import {
  addDays,
  averageStages,
  challanLabel,
  change,
  dispatchWeek,
  formatValue,
  getStatus,
  gramsToKg,
  lastMonths,
  median,
  monthEnd,
  monthLong,
  monthOf,
  monthShort,
  monthStart,
  nextWeeks,
  OVERDUE_LIMITS,
  overlapHours,
  pct,
  percentile,
  quietClient,
  stageDurations,
  sum,
  topShare,
  utilisation,
  ORDER_STATUSES,
  type BarPoint,
  type CardBody,
  type CardPayload,
  type DrawerRow,
  type RankedRow,
} from '@rivoora/shared';
import { listAlerts } from '../alerts';
import { emptyCard, hiddenCard, orderHref, ordersHref, rows, type InsightCtx } from './context';
import {
  DONE_STATUSES,
  ENTERED_TAKA,
  IN_PRODUCTION,
  isOpenOrder,
  lastDispatchDay,
  loadDispatches,
  loadLoomRuns,
  loadMachines,
  loadOrders,
  qtyText,
  runEnd,
  TAKA_M,
  TAKA_PCS,
  type OrderRow,
} from './data';

/**
 * Sprint 25 — the Owner dashboard (Jenish). One builder per card; each reads what it needs (shared rows are memoised on the
 * context) and returns its payload. Money is null without `canSeeRate`, client names only with `canSeeClient`.
 */

type Builder = (ctx: InsightCtx) => Promise<CardPayload>;

const orderLabel = (no: number) => `Order #${no}`;
const isPcs = (o: { unit: string }) => o.unit === 'pcs';
const isM = (o: { unit: string }) => o.unit === 'meters';
const value = (o: Pick<OrderRow, 'quantity' | 'rate'>) => (o.rate !== null ? o.quantity * o.rate : 0);
const OPEN_STATUS_KEYS = ORDER_STATUSES.map((s) => s.key).filter((k) => !DONE_STATUSES.includes(k));
const top = <T>(xs: T[], n: number) => ({ shown: xs.slice(0, n), more: Math.max(0, xs.length - n) });
const drawerOf = (title: string, list: DrawerRow[], href: string | null) => ({ title, rows: list.slice(0, 20), more: Math.max(0, list.length - 20), href });

/** pcs and m of a list of orders (never added together). */
const qtyOf = (list: OrderRow[]) => ({ pcs: sum(list.filter(isPcs).map((o) => o.quantity)), m: sum(list.filter(isM).map((o) => o.quantity)) });

/* ------------------------------------------------------------------ */
/* Today strip                                                          */
/* ------------------------------------------------------------------ */

const stripOpen: Builder = async (ctx) => {
  const open = (await loadOrders(ctx)).filter(isOpenOrder);
  const q = qtyOf(open);
  return {
    id: 'o.s.open',
    periodLabel: 'Now',
    body: { kind: 'figure', value: open.length, unit: 'orders', sub: qtyText(q.pcs, q.m) },
    href: ordersHref({ status: OPEN_STATUS_KEYS }),
  };
};

const stripProduction: Builder = async (ctx) => {
  const list = (await loadOrders(ctx)).filter((o) => !o.isClosed && IN_PRODUCTION.includes(o.status));
  const q = qtyOf(list);
  return { id: 'o.s.production', periodLabel: 'Now', body: { kind: 'figure', value: list.length, unit: 'orders', sub: qtyText(q.pcs, q.m) }, href: ordersHref({ status: [...IN_PRODUCTION] }) };
};

const stripReady: Builder = async (ctx) => {
  const list = (await loadOrders(ctx)).filter((o) => !o.isClosed && o.status === 'ready_for_dispatch');
  const q = qtyOf(list);
  return { id: 'o.s.ready', periodLabel: 'Now', body: { kind: 'figure', value: list.length, unit: 'orders', sub: qtyText(q.pcs, q.m) }, href: ordersHref({ status: ['ready_for_dispatch'] }) };
};

const stripDispatched: Builder = async (ctx) => {
  const list = (await loadDispatches(ctx)).filter((d) => d.challanDate === ctx.today);
  return {
    id: 'o.s.dispatched',
    periodLabel: 'Today',
    body: { kind: 'figure', value: list.length, unit: 'count', caption: list.length === 1 ? 'challan' : 'challans', sub: qtyText(sum(list.map((d) => d.pcs)), sum(list.map((d) => d.meters))) },
    href: '/dispatched',
  };
};

/* ------------------------------------------------------------------ */
/* Needs attention (the pinned panel) + its strip figure               */
/* ------------------------------------------------------------------ */

interface AttentionItem {
  kind: string;
  what: string;
  where: string;
  since: number;
  href: string;
  tone: 'red' | 'amber';
}

async function attentionItems(ctx: InsightCtx): Promise<AttentionItem[]> {
  return ctx.memo('attention', async () => {
    const [alerts, held, damages, notStarted] = await Promise.all([
      listAlerts(ctx.role),
      rows<{ id: number; orderNo: number; heldAt: string }>(sql`
        SELECT id, order_no AS orderNo, held_at AS heldAt FROM orders
        WHERE is_on_hold = 1 AND is_closed = 0 AND is_stock_holder = 0 AND held_at IS NOT NULL AND held_at < ${new Date(ctx.now.getTime() - 7 * 86_400_000).toISOString()}`),
      rows<{ orderId: number; orderNo: number; takas: number; pcs: number; oldest: string }>(sql`
        SELECT o.id AS orderId, o.order_no AS orderNo, COUNT(DISTINCT t.id) AS takas, COALESCE(SUM(td.pcs - td.resolved_pcs), 0) AS pcs, MIN(td.created_at) AS oldest
        FROM taka_damages td
        JOIN takas t ON t.id = td.taka_id
        JOIN orders o ON o.id = t.order_id
        WHERE td.is_deleted = 0 AND td.status = 'open' AND t.is_deleted = 0 AND t.stage NOT IN ('dispatched', 'lost')
          AND td.created_at < ${new Date(ctx.now.getTime() - 15 * 86_400_000).toISOString()}
        GROUP BY o.id`),
      rows<{ jobsheetId: number; jobsheetNo: number; orderId: number; orderNo: number; sentAt: string }>(sql`
        SELECT j.id AS jobsheetId, j.jobsheet_no AS jobsheetNo, o.id AS orderId, o.order_no AS orderNo, j.sent_at AS sentAt
        FROM jobsheets j JOIN orders o ON o.id = j.order_id
        WHERE j.status = 'sent' AND j.is_deleted = 0 AND j.is_external = 0 AND o.is_on_hold = 0 AND o.is_closed = 0
          AND j.sent_at IS NOT NULL AND j.sent_at < ${new Date(ctx.now.getTime() - 86_400_000).toISOString()}`),
    ]);
    const days = (at: string) => Math.max(0, Math.floor((ctx.now.getTime() - new Date(at).getTime()) / 86_400_000));
    const out: AttentionItem[] = [
      ...alerts.items.map((a) => ({
        kind: a.type === 'sent_short' ? 'Sent short' : 'Overdue',
        what: a.type === 'sent_short' ? a.stage : `${a.stage} · ${a.overBy} d over`,
        where: orderLabel(a.orderNo),
        since: a.days,
        href: a.link,
        tone: a.type === 'sent_short' ? ('amber' as const) : ('red' as const),
      })),
      ...held.map((h) => ({ kind: 'On hold', what: 'Held more than 7 days', where: orderLabel(h.orderNo), since: days(h.heldAt), href: orderHref(h.id), tone: 'amber' as const })),
      ...damages.map((d) => ({
        kind: 'Old damage',
        what: `${d.takas} taka${d.takas === 1 ? '' : 's'} · ${d.pcs} pcs open > 15 days`,
        where: orderLabel(d.orderNo),
        since: days(d.oldest),
        href: orderHref(d.orderId, 'damages'),
        tone: 'amber' as const,
      })),
      ...notStarted.map((j) => ({
        kind: 'Not started',
        what: `Jobsheet ${j.jobsheetNo} sent > 24 h`,
        where: orderLabel(j.orderNo),
        since: days(j.sentAt),
        href: `/jobsheets/${j.jobsheetId}`,
        tone: 'amber' as const,
      })),
    ];
    return out.sort((a, b) => (a.tone === b.tone ? b.since - a.since : a.tone === 'red' ? -1 : 1));
  });
}

const stripAttention: Builder = async (ctx) => {
  const items = await attentionItems(ctx);
  const red = items.filter((i) => i.tone === 'red').length;
  return {
    id: 'o.s.attention',
    periodLabel: 'Now',
    badge: items.length ? { tone: red ? 'red' : 'amber', text: red ? `${red} overdue` : 'Watch' } : { tone: 'green', text: 'Fine' },
    body: { kind: 'figure', value: items.length, unit: 'count', caption: items.length === 1 ? 'item' : 'items', sub: red ? `${red} overdue` : null },
    href: '#attention',
  };
};

const attention: Builder = async (ctx) => {
  const items = await attentionItems(ctx);
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  if (!items.length) return { ...emptyCard('o.attention', 'Nothing needs you right now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(items, 8);
  return {
    id: 'o.attention',
    periodLabel: 'Now',
    badge: { tone: items.some((i) => i.tone === 'red') ? 'red' : 'amber', text: `${items.length} item${items.length === 1 ? '' : 's'}` },
    body: {
      kind: 'table',
      head: [...counts.entries()].map(([label, n]) => ({ label, value: n, unit: 'count' as const, tone: label === 'Overdue' ? ('red' as const) : ('amber' as const) })),
      columns: [
        { key: 'kind', label: 'What' },
        { key: 'what', label: 'Detail' },
        { key: 'where', label: 'Order' },
        { key: 'since', label: 'Days', align: 'right' },
      ],
      rows: shown.map((i) => ({ cells: { kind: i.kind, what: i.what, where: i.where, since: i.since }, href: i.href, tone: i.tone })),
      more,
      moreHref: '/alerts',
    },
    href: '/alerts',
  };
};

/* ------------------------------------------------------------------ */
/* Business pulse                                                       */
/* ------------------------------------------------------------------ */

const glance: Builder = async (ctx) => {
  const [orders, dispatches] = await Promise.all([loadOrders(ctx), loadDispatches(ctx)]);
  const open = orders.filter(isOpenOrder);
  const prod = orders.filter((o) => !o.isClosed && IN_PRODUCTION.includes(o.status));
  const ready = orders.filter((o) => !o.isClosed && o.status === 'ready_for_dispatch');
  const month = monthOf(ctx.today);
  const dispMonth = dispatches.filter((d) => monthOf(d.challanDate) === month);
  const booked = orders.filter((o) => monthOf(o.orderDate) === month);
  const q = qtyOf(open);
  return {
    id: 'o.glance',
    periodLabel: 'Now · this month',
    body: {
      kind: 'split',
      items: [
        { label: 'Open orders', value: open.length, unit: 'orders', sub: qtyText(q.pcs, q.m), href: ordersHref({ status: OPEN_STATUS_KEYS }) },
        { label: 'In production', value: prod.length, unit: 'orders', href: ordersHref({ status: [...IN_PRODUCTION] }) },
        { label: 'Ready', value: ready.length, unit: 'orders', href: ordersHref({ status: ['ready_for_dispatch'] }) },
        { label: 'Dispatched this month', value: dispMonth.length, unit: 'count', sub: `challans · ${qtyText(sum(dispMonth.map((d) => d.pcs)), sum(dispMonth.map((d) => d.meters)))}`, href: '/dispatched' },
        ...(ctx.seesRate
          ? [{ label: 'Booked this month', value: sum(booked.map(value)), unit: 'rs' as const, sub: `${booked.length} order${booked.length === 1 ? '' : 's'}`, href: ordersHref({ from: monthStart(month), to: ctx.today }) }]
          : []),
      ],
    },
    href: ordersHref({ status: OPEN_STATUS_KEYS }),
  };
};

const bookedPerMonth: Builder = async (ctx) => {
  const orders = await loadOrders(ctx);
  const months = lastMonths(12, ctx.today);
  const view = (unit: 'pcs' | 'meters'): CardBody => {
    const points: BarPoint[] = months.map((m) => {
      const list = orders.filter((o) => monthOf(o.orderDate) === m && o.unit === unit);
      return { label: monthShort(m), hint: monthLong(m), values: [sum(list.map((o) => o.quantity))], note: `${list.length} order${list.length === 1 ? '' : 's'}`, href: ordersHref({ from: monthStart(m), to: monthEnd(m) }) };
    });
    const cur = points[11].values[0];
    const prev = points[10].values[0];
    return { kind: 'bars', unit: unit === 'pcs' ? 'pcs' : 'm', series: ['Booked'], points, change: change(cur, prev, 'vs last month') };
  };
  return {
    id: 'o.booked_month',
    periodLabel: 'Last 12 months',
    switch: { options: [{ value: 'm', label: 'All-over (m)' }, { value: 'pcs', label: 'Pcs' }], value: 'm' },
    body: null,
    views: { m: view('meters'), pcs: view('pcs') },
    href: ordersHref({ from: monthStart(months[0]), to: ctx.today }),
  };
};

const valuePerMonth: Builder = async (ctx) => {
  if (!ctx.seesRate) return hiddenCard('o.value_month');
  const orders = await loadOrders(ctx);
  const months = lastMonths(12, ctx.today);
  const points: BarPoint[] = months.map((m) => {
    const list = orders.filter((o) => monthOf(o.orderDate) === m);
    return { label: monthShort(m), hint: monthLong(m), values: [sum(list.map(value))], note: `${list.length} order${list.length === 1 ? '' : 's'}`, href: ordersHref({ from: monthStart(m), to: monthEnd(m) }) };
  });
  return {
    id: 'o.value_month',
    periodLabel: 'Last 12 months',
    body: { kind: 'bars', unit: 'rs', series: ['Booked'], points, change: change(points[11].values[0], points[10].values[0], 'vs last month') },
    href: ordersHref({ from: monthStart(months[0]), to: ctx.today }),
  };
};

const openByStatus: Builder = async (ctx) => {
  const open = (await loadOrders(ctx)).filter(isOpenOrder);
  if (!open.length) return emptyCard('o.open_status', 'No open orders', 'Now');
  const list: RankedRow[] = ORDER_STATUSES.flatMap((s) => {
    const of = open.filter((o) => o.status === s.key);
    if (!of.length) return [];
    const q = qtyOf(of);
    return [{ label: s.label, sub: qtyText(q.pcs, q.m), value: of.length, unit: 'orders' as const, href: ordersHref({ status: [s.key] }) }];
  });
  return { id: 'o.open_status', periodLabel: 'Now', body: { kind: 'ranked', rows: list, more: 0 }, href: ordersHref({ status: OPEN_STATUS_KEYS }) };
};

/* ------------------------------------------------------------------ */
/* Clients                                                              */
/* ------------------------------------------------------------------ */

const top3: Builder = async (ctx) => {
  if (!ctx.seesRate || !ctx.seesClient) return hiddenCard('o.top3');
  const from = addDays(ctx.today, -182);
  const list = (await loadOrders(ctx)).filter((o) => o.orderDate >= from && o.rate !== null);
  const byClient = new Map<number, { name: string; value: number }>();
  for (const o of list) byClient.set(o.customerId, { name: o.customerName, value: (byClient.get(o.customerId)?.value ?? 0) + value(o) });
  const r = topShare([...byClient.entries()].map(([key, v]) => ({ key, value: v.value })), 3);
  if (r.share === null) return emptyCard('o.top3', 'No booked value in the last 6 months', 'Last 6 months');
  const ids = r.top.map((t) => t.key);
  return {
    id: 'o.top3',
    periodLabel: 'Last 6 months',
    badge: r.share > 50 ? { tone: 'amber', text: 'Over half' } : { tone: 'green', text: 'Spread out' },
    body: {
      kind: 'figure',
      value: r.share,
      unit: 'pct',
      sub: `of ${formatValue(r.total, 'rs')} booked from the top 3: ${r.top.map((t) => byClient.get(t.key)!.name).join(', ')}`,
      drawer: drawerOf(
        'Top 3 clients · last 6 months',
        r.top.map((t) => ({ label: byClient.get(t.key)!.name, value: `${formatValue(t.value, 'rs')} · ${formatValue((t.value / r.total) * 100, 'pct')}`, href: ordersHref({ party: [t.key], from }) })),
        ordersHref({ party: ids, from }),
      ),
    },
    href: ordersHref({ party: ids, from }),
  };
};

const quiet: Builder = async (ctx) => {
  if (!ctx.seesClient) return hiddenCard('o.quiet');
  const orders = await loadOrders(ctx);
  const byClient = new Map<number, { name: string; days: string[] }>();
  for (const o of orders) {
    const c = byClient.get(o.customerId) ?? { name: o.customerName, days: [] };
    c.days.push(o.orderDate);
    byClient.set(o.customerId, c);
  }
  const list = [...byClient.entries()]
    .flatMap(([id, c]) => {
      const q = quietClient(c.days, ctx.today);
      return q ? [{ id, name: c.name, ...q }] : [];
    })
    .sort((a, b) => b.daysSince / b.usualGap - a.daysSince / a.usualGap);
  if (!list.length) return emptyCard('o.quiet', 'Every regular client is ordering on time');
  const { shown, more } = top(list, 6);
  return {
    id: 'o.quiet',
    periodLabel: null,
    badge: { tone: 'amber', text: `${list.length} quiet` },
    body: {
      kind: 'table',
      columns: [
        { key: 'client', label: 'Client' },
        { key: 'last', label: 'Last order' },
        { key: 'gap', label: 'Usual gap', align: 'right' },
        { key: 'since', label: 'Days since', align: 'right' },
      ],
      rows: shown.map((c) => ({ cells: { client: c.name, last: c.lastDay, gap: `${Math.round(c.usualGap)} d`, since: `${c.daysSince} d` }, href: ordersHref({ party: [c.id] }) })),
      more,
    },
  };
};

/* ------------------------------------------------------------------ */
/* Brokers & designs                                                    */
/* ------------------------------------------------------------------ */

const brokers: Builder = async (ctx) => {
  if (!ctx.seesClient) return hiddenCard('o.brokers');
  const { from, to } = ctx.period;
  const list = (await loadOrders(ctx)).filter((o) => o.brokerId !== null && o.orderDate >= from && o.orderDate <= to);
  if (!list.length) return emptyCard('o.brokers', 'No broker orders in this period', ctx.period.label);
  const by = new Map<number, { name: string; client: string; value: number; pcs: number; m: number; n: number }>();
  for (const o of list) {
    const b = by.get(o.brokerId!) ?? { name: o.brokerName ?? '—', client: o.customerName, value: 0, pcs: 0, m: 0, n: 0 };
    b.value += value(o);
    if (isPcs(o)) b.pcs += o.quantity;
    if (isM(o)) b.m += o.quantity;
    b.n += 1;
    by.set(o.brokerId!, b);
  }
  const view = (k: 'value' | 'pcs' | 'm'): CardBody => {
    const sorted = [...by.values()].filter((b) => b[k] > 0).sort((a, b) => b[k] - a[k]);
    const { shown, more } = top(sorted, 5);
    return {
      kind: 'ranked',
      rows: shown.map((b) => ({ label: b.name, sub: `${b.client} · ${b.n} order${b.n === 1 ? '' : 's'}`, value: b[k], unit: k === 'value' ? 'rs' : k === 'pcs' ? 'pcs' : 'm', href: ordersHref({ q: b.name, from, to }) })),
      more,
    };
  };
  const options = [...(ctx.seesRate ? [{ value: 'value', label: '₹' }] : []), { value: 'pcs', label: 'Pcs' }, { value: 'm', label: 'm' }];
  return {
    id: 'o.brokers',
    periodLabel: ctx.period.label,
    switch: { options, value: options[0].value },
    body: null,
    views: { ...(ctx.seesRate ? { value: view('value') } : {}), pcs: view('pcs'), m: view('m') },
  };
};

const repeatDesigns: Builder = async (ctx) => {
  const from = addDays(ctx.today, -365);
  const list = (await loadOrders(ctx)).filter((o) => o.designId !== null && o.orderDate >= from);
  const by = new Map<number, { code: string; n: number; last: string }>();
  for (const o of list) {
    const d = by.get(o.designId!) ?? { code: o.designCode ?? '—', n: 0, last: o.orderDate };
    d.n += 1;
    if (o.orderDate > d.last) d.last = o.orderDate;
    by.set(o.designId!, d);
  }
  const again = [...by.values()].filter((d) => d.n >= 2).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
  if (!again.length) return emptyCard('o.repeat_designs', 'No design was ordered twice in 12 months', 'Last 12 months');
  const { shown, more } = top(again, 6);
  return {
    id: 'o.repeat_designs',
    periodLabel: 'Last 12 months',
    body: {
      kind: 'table',
      columns: [
        { key: 'design', label: 'Design' },
        { key: 'n', label: 'Orders', align: 'right' },
        { key: 'last', label: 'Last order', align: 'right' },
      ],
      rows: shown.map((d) => ({ cells: { design: d.code, n: d.n, last: d.last }, href: ordersHref({ q: d.code }) })),
      more,
    },
  };
};

const qualityDemand: Builder = async (ctx) => {
  const { from, to } = ctx.period;
  const list = (await loadOrders(ctx)).filter((o) => o.orderDate >= from && o.orderDate <= to);
  if (!list.length) return emptyCard('o.quality_demand', 'No orders booked in this period', ctx.period.label);
  const view = (unit: 'pcs' | 'meters'): CardBody => {
    const by = new Map<number, { name: string; qty: number; n: number }>();
    for (const o of list.filter((x) => x.unit === unit)) {
      const q = by.get(o.materialId) ?? { name: o.materialName, qty: 0, n: 0 };
      q.qty += o.quantity;
      q.n += 1;
      by.set(o.materialId, q);
    }
    const sorted = [...by.entries()].sort((a, b) => b[1].qty - a[1].qty);
    const { shown, more } = top(sorted, 5);
    return {
      kind: 'ranked',
      rows: shown.map(([id, q]) => ({ label: q.name, sub: `${q.n} order${q.n === 1 ? '' : 's'}`, value: q.qty, unit: unit === 'pcs' ? 'pcs' : 'm', href: ordersHref({ material: [id], from, to }) })),
      more,
    };
  };
  return {
    id: 'o.quality_demand',
    periodLabel: ctx.period.label,
    switch: { options: [{ value: 'pcs', label: 'Pcs' }, { value: 'm', label: 'All-over (m)' }], value: 'pcs' },
    body: null,
    views: { pcs: view('pcs'), m: view('meters') },
  };
};

/* ------------------------------------------------------------------ */
/* Speed                                                                */
/* ------------------------------------------------------------------ */

/** Orders whose final dispatch fell in the period, with the days from booking to it. */
async function dispatchedInPeriod(ctx: InsightCtx) {
  const [orders, last] = await Promise.all([loadOrders(ctx), lastDispatchDay(ctx)]);
  return orders
    .filter((o) => (o.status === 'dispatched' || o.status === 'returned') && last.has(o.id))
    .map((o) => ({ o, day: last.get(o.id)!, days: Math.max(0, Math.round((Date.parse(`${last.get(o.id)}T00:00:00Z`) - Date.parse(`${o.orderDate}T00:00:00Z`)) / 86_400_000)) }))
    .filter((x) => x.day >= ctx.period.from && x.day <= ctx.period.to);
}

const toDispatch: Builder = async (ctx) => {
  const list = await dispatchedInPeriod(ctx);
  if (!list.length) return emptyCard('o.to_dispatch', 'No order was fully dispatched in this period', ctx.period.label);
  const days = list.map((x) => x.days);
  const drawer = drawerOf(
    'Dispatched orders · slowest first',
    [...list].sort((a, b) => b.days - a.days).map((x) => ({ label: orderLabel(x.o.orderNo), sub: `${x.o.designCode ?? '—'} · booked ${x.o.orderDate}`, value: `${x.days} d`, href: orderHref(x.o.id) })),
    '/dispatched',
  );
  return {
    id: 'o.to_dispatch',
    periodLabel: ctx.period.label,
    body: {
      kind: 'split',
      items: [
        { label: 'Median', value: median(days), unit: 'days', sub: `${list.length} order${list.length === 1 ? '' : 's'}`, drawer },
        { label: '90th percentile', value: percentile(days, 90), unit: 'days', sub: '9 in 10 orders faster', drawer },
      ],
    },
    href: '/dispatched',
  };
};

const stageDays: Builder = async (ctx) => {
  const from = addDays(ctx.today, -365);
  const orders = (await loadOrders(ctx)).filter((o) => o.orderDate >= from);
  if (!orders.length) return emptyCard('o.stage_days', 'No orders booked in the last 12 months', 'Last 12 months');
  const history = await rows<{ orderId: number; at: string; to: string }>(sql`
    SELECT h.order_id AS orderId, h.changed_at AS at, h.to_status AS "to" FROM order_status_history h
    JOIN orders o ON o.id = h.order_id WHERE o.is_stock_holder = 0 AND o.order_date >= ${from}`);
  const byOrder = new Map<number, { at: string; to: string }[]>();
  for (const h of history) byOrder.set(h.orderId, [...(byOrder.get(h.orderId) ?? []), h]);
  const durations = orders.map((o) =>
    stageDurations({ start: o.createdAt, firstStatus: 'pending_production', changes: byOrder.get(o.id) ?? [], endAt: o.isClosed && o.closedAt ? o.closedAt : ctx.now.toISOString() }),
  );
  const avg = averageStages(durations);
  return {
    id: 'o.stage_days',
    periodLabel: 'Orders of the last 12 months',
    body: {
      kind: 'bars',
      unit: 'days',
      series: ['Average days'],
      horizontal: true,
      points: avg.map((s) => ({ label: s.label, values: [Number(s.days.toFixed(1))], note: `${s.orders} order${s.orders === 1 ? '' : 's'}` })),
      summary: `Total ≈ ${formatValue(sum(avg.map((s) => s.days)), 'days')} per order`,
    },
  };
};

const oldestOpen: Builder = async (ctx) => {
  const open = (await loadOrders(ctx)).filter(isOpenOrder).sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderNo - b.orderNo);
  if (!open.length) return emptyCard('o.oldest_open', 'No open orders', 'Now');
  const { shown, more } = top(open, 10);
  const age = (o: OrderRow) => Math.max(0, Math.round((Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${o.orderDate}T00:00:00Z`)) / 86_400_000));
  return {
    id: 'o.oldest_open',
    periodLabel: 'Now',
    body: {
      kind: 'table',
      columns: [
        { key: 'order', label: 'Order' },
        ...(ctx.seesClient ? [{ key: 'client', label: 'Client' }] : []),
        { key: 'design', label: 'Design' },
        { key: 'stage', label: 'Step' },
        { key: 'age', label: 'Age', align: 'right' as const },
      ],
      rows: shown.map((o) => ({
        cells: { order: orderLabel(o.orderNo), client: o.customerName, design: o.designCode ?? '—', stage: getStatus(o.status).label + (o.isOnHold ? ' · on hold' : ''), age: `${age(o)} d` },
        href: orderHref(o.id),
        tone: age(o) > 45 ? 'red' : age(o) > 25 ? 'amber' : undefined,
      })),
      more,
      moreHref: ordersHref({ status: OPEN_STATUS_KEYS }),
    },
  };
};

const onTime: Builder = async (ctx) => {
  const list = (await dispatchedInPeriod(ctx)).filter((x) => !!x.o.promisedDate);
  if (!list.length) return emptyCard('o.on_time', 'No order with a promised date was dispatched in this period', ctx.period.label);
  const late = list.filter((x) => x.day > x.o.promisedDate!);
  const share = ((list.length - late.length) / list.length) * 100;
  return {
    id: 'o.on_time',
    periodLabel: ctx.period.label,
    badge: late.length ? { tone: share < 80 ? 'red' : 'amber', text: `${late.length} late` } : { tone: 'green', text: 'All on time' },
    body: {
      kind: 'figure',
      value: share,
      unit: 'pct',
      sub: `${list.length - late.length} of ${list.length} orders on or before the promised date`,
      drawer: drawerOf(
        'Late orders',
        late.map((x) => ({ label: orderLabel(x.o.orderNo), sub: `promised ${x.o.promisedDate} · dispatched ${x.day}`, value: `${Math.round((Date.parse(`${x.day}T00:00:00Z`) - Date.parse(`${x.o.promisedDate}T00:00:00Z`)) / 86_400_000)} d late`, href: orderHref(x.o.id), tone: 'red' })),
        '/dispatched',
      ),
    },
    href: '/dispatched',
  };
};

/* ------------------------------------------------------------------ */
/* Quality & damage                                                     */
/* ------------------------------------------------------------------ */

interface DamageRow {
  takaId: number;
  orderId: number;
  designId: number | null;
  designCode: string | null;
  unit: string;
  source: string;
  foundAt: string;
  name: string | null;
  pcs: number | null;
  meters: number | null;
  day: string;
}

/** Damages recorded from `from` (IST day) on, with their taka's order / design. */
function damagesSince(ctx: InsightCtx, from: string): Promise<DamageRow[]> {
  return ctx.memo(`damages-${from}`, () =>
    rows<DamageRow>(sql`
      SELECT td.taka_id AS takaId, t.order_id AS orderId, o.design_id AS designId, d.code AS designCode, o.unit, t.source,
             td.found_at AS foundAt, dm.name, td.pcs, td.meters, date(td.created_at, '+330 minutes') AS day
      FROM taka_damages td
      JOIN takas t ON t.id = td.taka_id
      JOIN orders o ON o.id = t.order_id
      LEFT JOIN designs d ON d.id = o.design_id
      LEFT JOIN damages dm ON dm.id = td.damage_id
      WHERE td.is_deleted = 0 AND date(td.created_at, '+330 minutes') >= ${from}`),
  );
}

/** Pcs entered per IST day (first pieces only) from `from` on, per design. */
function enteredSince(ctx: InsightCtx, from: string): Promise<{ day: string; designId: number | null; pcs: number; m: number }[]> {
  return ctx.memo(`entered-${from}`, () =>
    rows(sql`
      SELECT date(t.created_at, '+330 minutes') AS day, o.design_id AS designId,
             COALESCE(SUM(CASE WHEN o.unit = 'pcs' THEN ${TAKA_PCS} END), 0) AS pcs,
             COALESCE(SUM(CASE WHEN o.unit = 'meters' THEN ${TAKA_M} END), 0) AS m
      FROM takas t JOIN orders o ON o.id = t.order_id
      WHERE ${ENTERED_TAKA} AND date(t.created_at, '+330 minutes') >= ${from}
      GROUP BY 1, 2`),
  );
}

/** Damage type as the owner reads it: Machine · Weaver (outside takas) · Butta · Mill · Supervisor · Other. */
const damageCategory = (d: Pick<DamageRow, 'foundAt' | 'source'>) =>
  d.source === 'outside_po' && d.foundAt === 'machine' ? 'Weaver' : d.foundAt === 'machine' ? 'Machine' : d.foundAt === 'butta' ? 'Butta' : d.foundAt === 'mill' ? 'Mill' : d.foundAt === 'godown' ? 'Supervisor' : 'Other';

const DAMAGED_HREF = '/inventory?section=damaged';

const damagePct: Builder = async (ctx) => {
  const sixAgo = monthStart(lastMonths(6, ctx.today)[0]);
  const since = [ctx.period.prevFrom, sixAgo].sort()[0];
  const [dmg, entered] = await Promise.all([damagesSince(ctx, since), enteredSince(ctx, since)]);
  const pcsIn = (from: string, to: string) => ({
    damaged: sum(dmg.filter((d) => d.day >= from && d.day <= to).map((d) => d.pcs ?? 0)),
    entered: sum(entered.filter((e) => e.day >= from && e.day <= to).map((e) => e.pcs)),
  });
  const cur = pcsIn(ctx.period.from, ctx.period.to);
  const prev = pcsIn(ctx.period.prevFrom, ctx.period.prevTo);
  const curPct = pct(cur.damaged, cur.entered);
  if (curPct === null) return emptyCard('o.damage_pct', 'No pcs entered in this period', ctx.period.label);
  const prevPct = pct(prev.damaged, prev.entered);
  const spark = lastMonths(6, ctx.today).map((m) => pct(pcsIn(monthStart(m), monthEnd(m)).damaged, pcsIn(monthStart(m), monthEnd(m)).entered) ?? 0);
  return {
    id: 'o.damage_pct',
    periodLabel: ctx.period.label,
    badge: curPct > 5 ? { tone: 'red', text: 'High' } : curPct > 2 ? { tone: 'amber', text: 'Watch' } : { tone: 'green', text: 'Fine' },
    body: {
      kind: 'figure',
      value: curPct,
      unit: 'pct',
      sub: `${cur.damaged.toLocaleString('en-IN')} of ${cur.entered.toLocaleString('en-IN')} pcs entered`,
      change: prevPct !== null ? change(curPct, prevPct, 'vs previous period', false) : null,
      spark,
    },
    href: DAMAGED_HREF,
  };
};

const damageType: Builder = async (ctx) => {
  const list = (await damagesSince(ctx, ctx.period.from)).filter((d) => d.day <= ctx.period.to && (d.pcs ?? 0) > 0);
  if (!list.length) return emptyCard('o.damage_type', 'No damage in this period', ctx.period.label);
  const by = new Map<string, number>();
  for (const d of list) by.set(damageCategory(d), (by.get(damageCategory(d)) ?? 0) + (d.pcs ?? 0));
  const parts = ['Machine', 'Weaver', 'Butta', 'Mill', 'Supervisor', 'Other'].filter((k) => (by.get(k) ?? 0) > 0).map((k) => ({ label: k, value: by.get(k)!, href: DAMAGED_HREF }));
  return { id: 'o.damage_type', periodLabel: ctx.period.label, body: { kind: 'donut', unit: 'pcs', parts, total: sum(parts.map((p) => p.value)) }, href: DAMAGED_HREF };
};

const damageMoney: Builder = async (ctx) => {
  if (!ctx.seesRate) return hiddenCard('o.damage_money');
  const [r] = await rows<{ pcs: number; money: number; takas: number }>(sql`
    SELECT COALESCE(SUM(td.pcs - td.resolved_pcs), 0) AS pcs,
           COALESCE(SUM((td.pcs - td.resolved_pcs) * COALESCE(eo.rate, 0)), 0) AS money,
           COUNT(DISTINCT t.id) AS takas
    FROM taka_damages td
    JOIN takas t ON t.id = td.taka_id
    JOIN orders eo ON eo.id = COALESCE(t.allocated_order_id, t.order_id)
    WHERE td.is_deleted = 0 AND td.status = 'open' AND td.pcs IS NOT NULL AND t.is_deleted = 0 AND t.stage NOT IN ('dispatched', 'lost')`);
  if (!r || !r.pcs) return { ...emptyCard('o.damage_money', 'No open damaged pcs', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  return {
    id: 'o.damage_money',
    periodLabel: 'Now',
    body: { kind: 'figure', value: r.money, unit: 'rs', sub: `${r.pcs.toLocaleString('en-IN')} open damaged pcs on ${r.takas} taka${r.takas === 1 ? '' : 's'}` },
    href: DAMAGED_HREF,
  };
};

const damageReasons: Builder = async (ctx) => {
  const list = (await damagesSince(ctx, ctx.period.from)).filter((d) => d.day <= ctx.period.to && (d.pcs ?? 0) > 0);
  if (!list.length) return emptyCard('o.damage_reasons', 'No damage in this period', ctx.period.label);
  const by = new Map<string, { pcs: number; n: number }>();
  for (const d of list) {
    const k = d.name ?? 'Not named';
    const v = by.get(k) ?? { pcs: 0, n: 0 };
    v.pcs += d.pcs ?? 0;
    v.n += 1;
    by.set(k, v);
  }
  const sorted = [...by.entries()].sort((a, b) => b[1].pcs - a[1].pcs);
  const { shown, more } = top(sorted, 5);
  return {
    id: 'o.damage_reasons',
    periodLabel: ctx.period.label,
    body: { kind: 'ranked', rows: shown.map(([name, v]) => ({ label: name, sub: `${v.n} time${v.n === 1 ? '' : 's'}`, value: v.pcs, unit: 'pcs', href: DAMAGED_HREF })), more },
  };
};

const damageDesigns: Builder = async (ctx) => {
  const { from, to } = ctx.period;
  const [dmg, entered] = await Promise.all([damagesSince(ctx, from), enteredSince(ctx, from)]);
  const enteredBy = new Map<number, number>();
  for (const e of entered) if (e.designId !== null && e.day <= to) enteredBy.set(e.designId, (enteredBy.get(e.designId) ?? 0) + e.pcs);
  const dmgBy = new Map<number, { code: string; pcs: number }>();
  for (const d of dmg) {
    if (d.designId === null || d.day > to || !d.pcs) continue;
    const v = dmgBy.get(d.designId) ?? { code: d.designCode ?? '—', pcs: 0 };
    v.pcs += d.pcs;
    dmgBy.set(d.designId, v);
  }
  const list = [...dmgBy.entries()]
    .flatMap(([id, v]) => {
      const e = enteredBy.get(id) ?? 0;
      return e >= 50 ? [{ id, code: v.code, pcs: v.pcs, entered: e, pct: (v.pcs / e) * 100 }] : [];
    })
    .sort((a, b) => b.pct - a.pct);
  if (!list.length) return emptyCard('o.damage_designs', 'No design with 50+ pcs entered had damage in this period', ctx.period.label);
  const { shown, more } = top(list, 5);
  return {
    id: 'o.damage_designs',
    periodLabel: ctx.period.label,
    body: {
      kind: 'ranked',
      rows: shown.map((d) => ({ label: d.code, value: d.pct, unit: 'pct', valueText: `${formatValue(d.pct, 'pct')} · ${d.pcs} of ${d.entered} pcs`, tone: d.pct > 5 ? 'red' : undefined, href: ordersHref({ q: d.code }) })),
      more,
    },
  };
};

/* ------------------------------------------------------------------ */
/* Returns & rework                                                     */
/* ------------------------------------------------------------------ */

interface ReturnRow {
  day: string;
  customerId: number;
  customerName: string;
  pcs: number;
  m: number;
}

/** Everything that came back: the old challan-linked GRs (per taka) and the new party GRs (Sprint 22). */
function loadReturns(ctx: InsightCtx): Promise<ReturnRow[]> {
  return ctx.memo('returns', async () => {
    const [old, party, partyTakas] = await Promise.all([
      rows<ReturnRow>(sql`
        SELECT gr.return_date AS day, o.customer_id AS customerId, c.name AS customerName,
               COALESCE(SUM(CASE WHEN o.unit = 'pcs' THEN COALESCE(grt.pcs, t.pcs, 0) END), 0) AS pcs,
               COALESCE(SUM(CASE WHEN o.unit = 'meters' THEN COALESCE(t.meters, 0) END), 0) AS m
        FROM goods_returns gr
        JOIN dispatch_challans dc ON dc.id = gr.challan_id
        JOIN orders o ON o.id = dc.order_id
        JOIN customers c ON c.id = o.customer_id
        JOIN goods_return_takas grt ON grt.goods_return_id = gr.id
        JOIN takas t ON t.id = grt.taka_id
        GROUP BY gr.id`),
      rows<ReturnRow>(sql`
        SELECT pr.received_date AS day, pr.customer_id AS customerId, c.name AS customerName,
               CASE WHEN pr.received_as = 'pcs' THEN pr.received_qty ELSE 0 END AS pcs,
               CASE WHEN pr.received_as = 'meters' THEN pr.received_qty ELSE 0 END AS m
        FROM party_returns pr JOIN customers c ON c.id = pr.customer_id
        WHERE pr.received_as <> 'takas'`),
      rows<ReturnRow>(sql`
        SELECT pr.received_date AS day, pr.customer_id AS customerId, c.name AS customerName,
               COALESCE(SUM(CASE WHEN o.unit = 'pcs' THEN ${TAKA_PCS} END), 0) AS pcs,
               COALESCE(SUM(CASE WHEN o.unit = 'meters' THEN ${TAKA_M} END), 0) AS m
        FROM party_returns pr
        JOIN customers c ON c.id = pr.customer_id
        JOIN party_return_takas prt ON prt.return_id = pr.id
        JOIN takas t ON t.id = prt.taka_id
        JOIN orders o ON o.id = t.order_id
        WHERE pr.received_as = 'takas'
        GROUP BY pr.id`),
    ]);
    return [...old, ...party, ...partyTakas];
  });
}

const returnsPerMonth: Builder = async (ctx) => {
  const list = await loadReturns(ctx);
  const months = lastMonths(12, ctx.today);
  const view = (k: 'pcs' | 'm'): CardBody => ({
    kind: 'bars',
    unit: k,
    series: ['Returned'],
    points: months.map((m) => {
      const of = list.filter((r) => monthOf(r.day) === m);
      return { label: monthShort(m), hint: monthLong(m), values: [sum(of.map((r) => r[k]))], note: `${of.length} return${of.length === 1 ? '' : 's'}`, href: '/goods-return' };
    }),
  });
  return {
    id: 'o.returns_month',
    periodLabel: 'Last 12 months',
    switch: { options: [{ value: 'pcs', label: 'Pcs' }, { value: 'm', label: 'All-over (m)' }], value: 'pcs' },
    body: null,
    views: { pcs: view('pcs'), m: view('m') },
    href: '/goods-return',
  };
};

const returnsByClient: Builder = async (ctx) => {
  if (!ctx.seesClient) return hiddenCard('o.returns_client');
  const { from, to } = ctx.period;
  const [ret, disp, orders] = await Promise.all([loadReturns(ctx), loadDispatches(ctx), loadOrders(ctx)]);
  const custOf = new Map(orders.map((o) => [o.id, o]));
  const by = new Map<number, { name: string; rp: number; rm: number; dp: number; dm: number }>();
  const get = (id: number, name: string) => by.get(id) ?? by.set(id, { name, rp: 0, rm: 0, dp: 0, dm: 0 }).get(id)!;
  for (const d of disp) {
    if (d.challanDate < from || d.challanDate > to) continue;
    const o = custOf.get(d.orderId);
    if (!o) continue;
    const c = get(o.customerId, o.customerName);
    c.dp += d.pcs;
    c.dm += d.meters;
  }
  for (const r of ret) {
    if (r.day < from || r.day > to) continue;
    const c = get(r.customerId, r.customerName);
    c.rp += r.pcs;
    c.rm += r.m;
  }
  const view = (k: 'p' | 'm'): CardBody => {
    const list = [...by.entries()].filter(([, c]) => (k === 'p' ? c.rp : c.rm) > 0).sort((a, b) => (k === 'p' ? b[1].rp - a[1].rp : b[1].rm - a[1].rm));
    const { shown, more } = top(list, 6);
    const unit = k === 'p' ? 'pcs' : 'm';
    return {
      kind: 'table',
      columns: [
        { key: 'client', label: 'Client' },
        { key: 'ret', label: 'Returned', align: 'right' },
        { key: 'pct', label: '% of dispatched', align: 'right' },
      ],
      rows: shown.map(([id, c]) => {
        const r = k === 'p' ? c.rp : c.rm;
        const d = k === 'p' ? c.dp : c.dm;
        const share = pct(r, d);
        return { cells: { client: c.name, ret: formatValue(r, unit), pct: share === null ? '—' : formatValue(share, 'pct') }, href: ordersHref({ party: [id] }), tone: share !== null && share > 5 ? 'red' : undefined };
      }),
      more,
    };
  };
  if (![...by.values()].some((c) => c.rp > 0 || c.rm > 0)) return emptyCard('o.returns_client', 'Nothing came back in this period', ctx.period.label);
  return {
    id: 'o.returns_client',
    periodLabel: ctx.period.label,
    switch: { options: [{ value: 'p', label: 'Pcs' }, { value: 'm', label: 'All-over (m)' }], value: 'p' },
    body: null,
    views: { p: view('p'), m: view('m') },
    href: '/goods-return',
  };
};

const rework: Builder = async (ctx) => {
  const months = lastMonths(12, ctx.today);
  const since = monthStart(months[0]);
  const [sent, entered] = await Promise.all([
    rows<{ month: string; n: number }>(sql`
      SELECT substr(date(created_at, '+330 minutes'), 1, 7) AS month, COUNT(*) AS n FROM taka_events
      WHERE event IN ('sent_back', 'sent_refinish') AND date(created_at, '+330 minutes') >= ${since} GROUP BY 1`),
    rows<{ month: string; n: number }>(sql`
      SELECT substr(date(t.created_at, '+330 minutes'), 1, 7) AS month, COUNT(*) AS n FROM takas t
      WHERE ${ENTERED_TAKA} AND date(t.created_at, '+330 minutes') >= ${since} GROUP BY 1`),
  ]);
  const points: BarPoint[] = months.map((m) => {
    const n = sent.find((s) => s.month === m)?.n ?? 0;
    const e = entered.find((s) => s.month === m)?.n ?? 0;
    return { label: monthShort(m), hint: monthLong(m), values: [n], note: e ? `${formatValue((n / e) * 100, 'pct')} of ${e} takas entered` : null };
  });
  const total = sum(points.map((p) => p.values[0]));
  return {
    id: 'o.rework',
    periodLabel: 'Last 12 months',
    body: { kind: 'bars', unit: 'takas', series: ['Sent back'], points, summary: `${total} taka${total === 1 ? '' : 's'} sent back in 12 months` },
    href: '/mill',
  };
};

/* ------------------------------------------------------------------ */
/* Stock                                                                */
/* ------------------------------------------------------------------ */

interface FreeRow {
  takaId: number;
  designId: number | null;
  designCode: string | null;
  materialId: number;
  unit: string;
  pcs: number;
  m: number;
  damaged: number;
  lastMove: string;
}

function loadFreeStock(ctx: InsightCtx): Promise<FreeRow[]> {
  return ctx.memo('free-stock', () =>
    rows<FreeRow>(sql`
      SELECT t.id AS takaId, o.design_id AS designId, d.code AS designCode, o.material_id AS materialId, o.unit,
             ${TAKA_PCS} AS pcs, ${TAKA_M} AS m, t.is_damaged AS damaged,
             MAX(COALESCE(t.free_stock_at, t.created_at), t.updated_at, COALESCE((SELECT MAX(e.created_at) FROM taka_events e WHERE e.taka_id = t.id), t.created_at)) AS lastMove
      FROM takas t
      JOIN orders o ON o.id = t.order_id
      LEFT JOIN designs d ON d.id = o.design_id
      WHERE t.is_deleted = 0 AND t.is_free_stock = 1 AND t.allocated_order_id IS NULL AND t.stage NOT IN ('dispatched', 'lost')`),
  );
}

/** The latest order rate per design + unit (the value of free stock). */
async function lastRates(ctx: InsightCtx): Promise<Map<string, number>> {
  const orders = (await loadOrders(ctx)).filter((o) => o.rate !== null && o.designId !== null).sort((a, b) => a.orderDate.localeCompare(b.orderDate));
  const out = new Map<string, number>();
  for (const o of orders) out.set(`${o.designId}|${o.unit}`, o.rate!);
  return out;
}

const stockGlance: Builder = async (ctx) => {
  const [free, rates] = await Promise.all([loadFreeStock(ctx), lastRates(ctx)]);
  if (!free.length) return emptyCard('o.stock_glance', 'No free stock in the godown', 'Now');
  const pick = (dmg: boolean, unit: string) => free.filter((f) => !!f.damaged === dmg && f.unit === unit);
  const valueOf = sum(free.map((f) => (f.unit === 'pcs' ? f.pcs : f.unit === 'meters' ? f.m : 0) * (rates.get(`${f.designId}|${f.unit}`) ?? 0)));
  return {
    id: 'o.stock_glance',
    periodLabel: 'Now',
    body: {
      kind: 'split',
      items: [
        { label: 'Fresh', value: sum(pick(false, 'pcs').map((f) => f.pcs)), unit: 'pcs', sub: `${formatValue(sum(pick(false, 'meters').map((f) => f.m)), 'm')} all-over`, href: '/inventory' },
        { label: 'Damaged', value: sum(pick(true, 'pcs').map((f) => f.pcs)), unit: 'pcs', sub: `${formatValue(sum(pick(true, 'meters').map((f) => f.m)), 'm')} all-over`, tone: 'amber', href: DAMAGED_HREF },
        ...(ctx.seesRate ? [{ label: 'Value at last order rate', value: valueOf, unit: 'rs' as const, sub: `${free.length} taka${free.length === 1 ? '' : 's'}`, href: '/inventory' }] : []),
      ],
    },
    href: '/inventory',
  };
};

const deadStock: Builder = async (ctx) => {
  const [free, orders] = await Promise.all([loadFreeStock(ctx), loadOrders(ctx)]);
  const cutoff = new Date(ctx.now.getTime() - 60 * 86_400_000).toISOString();
  const openDesigns = new Set(orders.filter(isOpenOrder).map((o) => o.designId));
  const by = new Map<number, { code: string; pcs: number; m: number; takas: number; idle: number }>();
  for (const f of free) {
    if (f.designId === null || f.lastMove > cutoff || openDesigns.has(f.designId)) continue;
    const v = by.get(f.designId) ?? { code: f.designCode ?? '—', pcs: 0, m: 0, takas: 0, idle: 0 };
    if (f.unit === 'pcs') v.pcs += f.pcs;
    if (f.unit === 'meters') v.m += f.m;
    v.takas += 1;
    v.idle = Math.max(v.idle, Math.floor((ctx.now.getTime() - new Date(f.lastMove).getTime()) / 86_400_000));
    by.set(f.designId, v);
  }
  const list = [...by.entries()].sort((a, b) => b[1].idle - a[1].idle);
  if (!list.length) return { ...emptyCard('o.dead_stock', 'No stock lying unused for 60+ days', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(list, 6);
  return {
    id: 'o.dead_stock',
    periodLabel: 'Now',
    badge: { tone: 'amber', text: `${list.length} design${list.length === 1 ? '' : 's'}` },
    body: {
      kind: 'table',
      columns: [
        { key: 'design', label: 'Design' },
        { key: 'qty', label: 'Stock', align: 'right' },
        { key: 'idle', label: 'Idle', align: 'right' },
      ],
      rows: shown.map(([id, v]) => ({ cells: { design: v.code, qty: qtyText(v.pcs, v.m), idle: `${v.idle} d` }, href: `/inventory/items/d-${id}` })),
      more,
      moreHref: '/inventory',
    },
  };
};

const stockMatch: Builder = async (ctx) => {
  const [free, orders, counted] = await Promise.all([
    loadFreeStock(ctx),
    loadOrders(ctx),
    rows<{ orderId: number; pcs: number; m: number }>(sql`
      SELECT COALESCE(t.allocated_order_id, t.order_id) AS orderId, COALESCE(SUM(${TAKA_PCS}), 0) AS pcs, COALESCE(SUM(${TAKA_M}), 0) AS m
      FROM takas t WHERE t.is_deleted = 0 AND t.is_free_stock = 0 AND t.stage <> 'lost' GROUP BY 1`),
  ]);
  const have = new Map(counted.map((c) => [c.orderId, c]));
  const list = orders
    .filter((o) => isOpenOrder(o) && o.designId !== null && (o.unit === 'pcs' || o.unit === 'meters'))
    .flatMap((o) => {
      const got = have.get(o.id);
      const need = o.quantity - (o.unit === 'pcs' ? (got?.pcs ?? 0) : (got?.m ?? 0));
      const stock = sum(free.filter((f) => f.designId === o.designId && f.unit === o.unit).map((f) => (o.unit === 'pcs' ? f.pcs : f.m)));
      return need > 0 && stock > 0 ? [{ o, need, stock }] : [];
    });
  if (!list.length) return emptyCard('o.stock_match', 'No free stock matches an open order', 'Now');
  const { shown, more } = top(list, 6);
  const unit = (o: OrderRow) => (o.unit === 'pcs' ? 'pcs' : 'm');
  return {
    id: 'o.stock_match',
    periodLabel: 'Now',
    body: {
      kind: 'table',
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'design', label: 'Design' },
        { key: 'need', label: 'Still needs', align: 'right' },
        { key: 'stock', label: 'Free stock', align: 'right' },
      ],
      rows: shown.map(({ o, need, stock }) => ({ cells: { order: orderLabel(o.orderNo), design: o.designCode ?? '—', need: formatValue(need, unit(o)), stock: formatValue(stock, unit(o)) }, href: `/inventory/items/d-${o.designId}` })),
      more,
    },
  };
};

/* ------------------------------------------------------------------ */
/* Vendors                                                              */
/* ------------------------------------------------------------------ */

interface OutRow {
  kind: 'butta' | 'mill';
  challanId: number;
  challanNo: number;
  challanDate: string;
  partyId: number;
  partyName: string;
  pcs: number;
  m: number;
}

/** Takas at butta / mill parties right now (active challan rows not received / lost). */
function loadOutside(ctx: InsightCtx): Promise<OutRow[]> {
  return ctx.memo('outside', () =>
    rows<OutRow>(sql`
      SELECT ch.kind, ch.id AS challanId, ch.challan_no AS challanNo, ch.challan_date AS challanDate, ch.party_id AS partyId,
             COALESCE(bp.name, mp.name, '—') AS partyName, COALESCE(ct.pcs, 0) AS pcs, COALESCE(ct.meters, 0) AS m
      FROM challan_takas ct
      JOIN challans ch ON ch.id = ct.challan_id
      JOIN takas t ON t.id = ct.taka_id
      LEFT JOIN butta_parties bp ON ch.kind = 'butta' AND bp.id = ch.party_id
      LEFT JOIN mill_parties mp ON ch.kind = 'mill' AND mp.id = ch.party_id
      WHERE ch.status = 'active' AND ct.is_active = 1 AND ct.received_at IS NULL AND ct.lost_at IS NULL AND t.is_deleted = 0
        AND t.stage = CASE WHEN ch.kind = 'butta' THEN 'at_butta' ELSE 'at_mill' END`),
  );
}

const limitOf = (kind: 'butta' | 'mill') => (kind === 'butta' ? OVERDUE_LIMITS.buttaDays : OVERDUE_LIMITS.millDays);

const jobParties: Builder = async (ctx) => {
  const since90 = addDays(ctx.today, -89);
  const [out, received, damaged, pos, receipts] = await Promise.all([
    loadOutside(ctx),
    rows<{ kind: string; partyId: number; pcs: number }>(sql`
      SELECT ch.kind, ch.party_id AS partyId, COALESCE(SUM(ct.pcs), 0) AS pcs FROM challan_takas ct JOIN challans ch ON ch.id = ct.challan_id
      WHERE ct.received_at IS NOT NULL AND date(ct.received_at, '+330 minutes') >= ${since90} GROUP BY 1, 2`),
    rows<{ kind: string; partyId: number; pcs: number }>(sql`
      SELECT ch.kind, ch.party_id AS partyId, COALESCE(SUM(td.pcs), 0) AS pcs
      FROM taka_damages td
      JOIN challan_takas ct ON ct.taka_id = td.taka_id AND ct.kind = td.found_at AND ct.received_at IS NOT NULL
      JOIN challans ch ON ch.id = ct.challan_id
      WHERE td.is_deleted = 0 AND td.found_at IN ('butta', 'mill') AND date(td.created_at, '+330 minutes') >= ${since90}
      GROUP BY 1, 2`),
    rows<{ id: number; weaverId: number; weaverName: string; unit: string; quantity: number; receivedQty: number; poDate: string; dueDate: string | null }>(sql`
      SELECT p.id, p.weaver_id AS weaverId, w.name AS weaverName, p.unit, p.quantity, p.received_qty AS receivedQty, p.po_date AS poDate, p.due_date AS dueDate
      FROM outside_pos p JOIN weavers w ON w.id = p.weaver_id WHERE p.status IN ('open', 'partly_received')`),
    rows<{ weaverId: number; pcs: number; damaged: number }>(sql`
      SELECT r.weaver_id AS weaverId, COALESCE(SUM(r.pcs), 0) AS pcs, COALESCE(SUM(r.damaged_pcs), 0) AS damaged FROM outside_receipts r
      WHERE r.kind = 'outside_po' AND r.weaver_id IS NOT NULL AND r.receipt_date >= ${since90} GROUP BY 1`),
  ]);
  const days = (d: string) => Math.max(0, Math.round((Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000));
  const challanView = (kind: 'butta' | 'mill'): CardBody => {
    const by = new Map<number, { name: string; takas: number; pcs: number; m: number; days: number[]; overdue: number }>();
    for (const r of out.filter((x) => x.kind === kind)) {
      const p = by.get(r.partyId) ?? { name: r.partyName, takas: 0, pcs: 0, m: 0, days: [], overdue: 0 };
      p.takas += 1;
      p.pcs += r.pcs;
      p.m += r.m;
      p.days.push(days(r.challanDate));
      if (days(r.challanDate) > limitOf(kind)) p.overdue += 1;
      by.set(r.partyId, p);
    }
    for (const r of received.filter((x) => x.kind === kind)) if (!by.has(r.partyId)) by.set(r.partyId, { name: '', takas: 0, pcs: 0, m: 0, days: [], overdue: 0 });
    const list = [...by.entries()].filter(([, p]) => p.takas > 0).sort((a, b) => b[1].overdue - a[1].overdue || b[1].takas - a[1].takas);
    const { shown, more } = top(list, 6);
    return {
      kind: 'table',
      columns: [
        { key: 'party', label: 'Party' },
        { key: 'out', label: 'Out now', align: 'right' },
        { key: 'days', label: 'Avg days', align: 'right' },
        { key: 'dmg', label: 'Damage % (90 d)', align: 'right' },
        { key: 'late', label: 'Overdue', align: 'right' },
      ],
      rows: shown.map(([id, p]) => {
        const rec = received.find((x) => x.kind === kind && x.partyId === id)?.pcs ?? 0;
        const dmg = damaged.find((x) => x.kind === kind && x.partyId === id)?.pcs ?? 0;
        const share = pct(dmg, rec);
        return {
          cells: { party: p.name, out: `${p.takas} takas · ${qtyText(p.pcs, p.m)}`, days: (median(p.days) ?? 0).toFixed(0), dmg: share === null ? '—' : formatValue(share, 'pct'), late: p.overdue || '—' },
          href: `/${kind}?tab=receive&party=${id}`,
          tone: p.overdue ? 'red' : undefined,
        };
      }),
      more,
    };
  };
  const weaverView = (): CardBody => {
    const by = new Map<number, { name: string; pcs: number; m: number; days: number[]; late: number }>();
    for (const p of pos) {
      const w = by.get(p.weaverId) ?? { name: p.weaverName, pcs: 0, m: 0, days: [], late: 0 };
      const open = Math.max(0, p.quantity - p.receivedQty);
      if (p.unit === 'pcs') w.pcs += open;
      else w.m += open;
      w.days.push(days(p.poDate));
      if (p.dueDate && p.dueDate < ctx.today) w.late += 1;
      by.set(p.weaverId, w);
    }
    const list = [...by.entries()].sort((a, b) => b[1].late - a[1].late || b[1].pcs + b[1].m - (a[1].pcs + a[1].m));
    const { shown, more } = top(list, 6);
    return {
      kind: 'table',
      columns: [
        { key: 'party', label: 'Weaver' },
        { key: 'out', label: 'Open now', align: 'right' },
        { key: 'days', label: 'Avg days', align: 'right' },
        { key: 'dmg', label: 'Damage % (90 d)', align: 'right' },
        { key: 'late', label: 'Late', align: 'right' },
      ],
      rows: shown.map(([id, w]) => {
        const r = receipts.find((x) => x.weaverId === id);
        const share = r ? pct(r.damaged, r.pcs) : null;
        return { cells: { party: w.name, out: qtyText(w.pcs, w.m), days: (median(w.days) ?? 0).toFixed(0), dmg: share === null ? '—' : formatValue(share, 'pct'), late: w.late || '—' }, href: '/receive-goods', tone: w.late ? 'red' : undefined };
      }),
      more,
    };
  };
  return {
    id: 'o.job_parties',
    periodLabel: 'Now · damage last 90 days',
    switch: { options: [{ value: 'butta', label: 'Butta cutting' }, { value: 'mill', label: 'Mill' }, { value: 'weavers', label: 'Outside weavers' }], value: 'butta' },
    body: null,
    views: { butta: challanView('butta'), mill: challanView('mill'), weavers: weaverView() },
  };
};

const challansLate: Builder = async (ctx) => {
  const out = await loadOutside(ctx);
  const by = new Map<number, OutRow & { takas: number; days: number }>();
  for (const r of out) {
    const days = Math.max(0, Math.round((Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${r.challanDate}T00:00:00Z`)) / 86_400_000));
    if (days <= limitOf(r.kind)) continue;
    const c = by.get(r.challanId) ?? { ...r, takas: 0, days };
    c.takas += 1;
    by.set(r.challanId, c);
  }
  const list = [...by.values()].sort((a, b) => b.days - limitOf(b.kind) - (a.days - limitOf(a.kind)));
  if (!list.length) return { ...emptyCard('o.challans_late', 'No challan is out for too long', 'Now'), badge: { tone: 'green', text: 'Fine' } };
  const { shown, more } = top(list, 6);
  return {
    id: 'o.challans_late',
    periodLabel: 'Now',
    badge: { tone: 'red', text: `${list.length} overdue` },
    body: {
      kind: 'table',
      columns: [
        { key: 'challan', label: 'Challan' },
        { key: 'party', label: 'Party' },
        { key: 'takas', label: 'Takas', align: 'right' },
        { key: 'days', label: 'Days', align: 'right' },
      ],
      rows: shown.map((c) => ({ cells: { challan: challanLabel(c.challanNo, c.kind), party: c.partyName, takas: c.takas, days: `${c.days} d` }, href: `/${c.kind}/challans/${c.challanId}`, tone: 'red' })),
      more,
      moreHref: '/alerts',
    },
  };
};

const outsideGoods: Builder = async (ctx) => {
  const out = await loadOutside(ctx);
  if (!out.length) return emptyCard('o.outside_goods', 'Nothing is at butta or mill parties right now', 'Now');
  const by = new Map<string, { label: string; sub: string; takas: number; pcs: number; m: number; href: string }>();
  for (const r of out) {
    const k = `${r.kind}-${r.partyId}`;
    const v = by.get(k) ?? { label: r.partyName, sub: r.kind === 'butta' ? 'Butta cutting' : 'Mill', takas: 0, pcs: 0, m: 0, href: `/${r.kind}?tab=receive&party=${r.partyId}` };
    v.takas += 1;
    v.pcs += r.pcs;
    v.m += r.m;
    by.set(k, v);
  }
  const list = [...by.values()].sort((a, b) => b.takas - a.takas);
  const { shown, more } = top(list, 5);
  return {
    id: 'o.outside_goods',
    periodLabel: 'Now',
    body: {
      kind: 'ranked',
      head: [
        { label: 'Takas', value: out.length, unit: 'takas' },
        { label: 'Pcs', value: sum(out.map((r) => r.pcs)), unit: 'pcs' },
        { label: 'All-over', value: sum(out.map((r) => r.m)), unit: 'm' },
      ],
      rows: shown.map((v) => ({ label: v.label, sub: v.sub, value: v.takas, unit: 'takas', valueText: `${v.takas} takas · ${qtyText(v.pcs, v.m)}`, href: v.href })),
      more,
    },
  };
};

/* ------------------------------------------------------------------ */
/* Looms & yarn                                                         */
/* ------------------------------------------------------------------ */

/** Running hours per loom inside [from, to] (instants). */
async function loomHours(ctx: InsightCtx, from: string, to: string): Promise<Map<number, number>> {
  const runs = await loadLoomRuns(ctx);
  const out = new Map<number, number>();
  for (const r of runs) out.set(r.machineId, (out.get(r.machineId) ?? 0) + overlapHours(r.startedAt, runEnd(r, ctx.now), from, to));
  return out;
}
/** The IST midnight of a day, as an instant. */
const istStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 330 * 60_000).toISOString();

const loomUtilisation: Builder = async (ctx) => {
  const machines = await loadMachines(ctx);
  if (!machines.length) return emptyCard('o.utilisation', 'No active looms', ctx.period.label);
  const from = istStart(ctx.period.from);
  const to = ctx.now.toISOString();
  const days = (ctx.now.getTime() - new Date(from).getTime()) / 86_400_000;
  const hours = await loomHours(ctx, from, to);
  const list = machines.map((m) => ({ m, h: hours.get(m.id) ?? 0, u: utilisation(hours.get(m.id) ?? 0, days, ctx.workingHours) ?? 0 })).sort((a, b) => a.u - b.u);
  if (!list.some((x) => x.h > 0)) return emptyCard('o.utilisation', 'No loom ran in this period', ctx.period.label);
  const overall = utilisation(sum(list.map((x) => x.h)), days * machines.length, ctx.workingHours) ?? 0;
  const { shown, more } = top(list, 5);
  return {
    id: 'o.utilisation',
    periodLabel: ctx.period.label,
    badge: overall < 50 ? { tone: 'amber', text: 'Low' } : { tone: 'green', text: 'Good' },
    body: {
      kind: 'ranked',
      head: [{ label: `All looms · ${ctx.workingHours} h a day`, value: overall, unit: 'pct' }],
      rows: shown.map((x) => ({ label: `Loom ${x.m.machineNo}`, value: x.u, unit: 'pct', valueText: `${formatValue(x.u, 'pct')} · ${Math.round(x.h)} h`, tone: x.u < 40 ? 'amber' : undefined, href: '/machine-view' })),
      more,
    },
    href: '/machine-view',
  };
};

const framesPerMonth: Builder = async (ctx) => {
  const months = lastMonths(12, ctx.today);
  const list = await rows<{ month: string; frames: number; m: number; n: number }>(sql`
    SELECT substr(date(j.completed_at, '+330 minutes'), 1, 7) AS month, COALESCE(SUM(j.completed_frames), 0) AS frames,
           COALESCE(SUM(j.completed_meters), 0) AS m, COUNT(*) AS n
    FROM jobsheets j
    WHERE j.status = 'completed' AND j.is_deleted = 0 AND j.is_external = 0 AND j.completed_at IS NOT NULL
      AND date(j.completed_at, '+330 minutes') >= ${monthStart(months[0])}
    GROUP BY 1`);
  const view = (k: 'frames' | 'm'): CardBody => ({
    kind: 'bars',
    unit: k === 'frames' ? 'frames' : 'm',
    series: [k === 'frames' ? 'Frames' : 'Loom m'],
    points: months.map((m) => {
      const r = list.find((x) => x.month === m);
      return { label: monthShort(m), hint: monthLong(m), values: [r ? Number(r[k].toFixed(2)) : 0], note: r ? `${r.n} jobsheet${r.n === 1 ? '' : 's'} completed` : null };
    }),
  });
  return {
    id: 'o.frames_month',
    periodLabel: 'Last 12 months',
    switch: { options: [{ value: 'frames', label: 'Frames (pcs)' }, { value: 'm', label: 'Loom m' }], value: 'frames' },
    body: null,
    views: { frames: view('frames'), m: view('m') },
    href: '/machine-view',
  };
};

const yarnPerMonth: Builder = async (ctx) => {
  const months = lastMonths(12, ctx.today);
  const list = await rows<{ month: string; received: number; used: number }>(sql`
    SELECT substr(date(created_at, '+330 minutes'), 1, 7) AS month,
           COALESCE(SUM(CASE WHEN kind = 'receipt' THEN qty_g END), 0) AS received,
           COALESCE(-SUM(CASE WHEN kind IN ('tfo_issue', 'warping_issue', 'withdraw') AND item = 'raw' THEN qty_g END), 0) AS used
    FROM yarn_stock_moves WHERE date(created_at, '+330 minutes') >= ${monthStart(months[0])} GROUP BY 1`);
  const points: BarPoint[] = months.map((m) => {
    const r = list.find((x) => x.month === m);
    return { label: monthShort(m), hint: monthLong(m), values: [r ? gramsToKg(r.received) : 0, r ? gramsToKg(r.used) : 0], href: '/yarn/movements' };
  });
  return {
    id: 'o.yarn_month',
    periodLabel: 'Last 12 months · raw yarn',
    body: { kind: 'bars', unit: 'kg', series: ['Received', 'Used'], points, summary: `12 months: received ${formatValue(sum(points.map((p) => p.values[0])), 'kg')}, used ${formatValue(sum(points.map((p) => p.values[1])), 'kg')}` },
    href: '/yarn/movements',
  };
};

const idleLooms: Builder = async (ctx) => {
  const machines = await loadMachines(ctx);
  if (!machines.length) return emptyCard('o.idle_looms', 'No active looms', 'This month');
  const from = istStart(monthStart(monthOf(ctx.today)));
  const hours = await loomHours(ctx, from, ctx.now.toISOString());
  const available = ((ctx.now.getTime() - new Date(from).getTime()) / 3_600_000) * (ctx.workingHours / 24);
  const list = machines.map((m) => ({ m, idle: Math.max(0, available - (hours.get(m.id) ?? 0)) })).sort((a, b) => b.idle - a.idle);
  const { shown, more } = top(list, 5);
  return {
    id: 'o.idle_looms',
    periodLabel: 'This month',
    body: { kind: 'ranked', rows: shown.map((x) => ({ label: `Loom ${x.m.machineNo}`, value: x.idle, unit: 'hours', valueText: `${Math.round(x.idle)} h idle`, href: '/machine-view' })), more },
    href: '/machine-view',
  };
};

/* ------------------------------------------------------------------ */
/* Attention & team                                                     */
/* ------------------------------------------------------------------ */

const teamToday: Builder = async (ctx) => {
  const day = ctx.today;
  const [events, qc, dcs, names] = await Promise.all([
    rows<{ userId: number; event: string; n: number; challans: number }>(sql`
      SELECT user_id AS userId, event, COUNT(*) AS n, COUNT(DISTINCT challan_id) AS challans FROM taka_events
      WHERE user_id IS NOT NULL AND date(created_at, '+330 minutes') = ${day} AND event IN ('entered', 'sent_butta', 'sent_mill')
      GROUP BY 1, 2`),
    rows<{ userId: number; n: number }>(sql`SELECT done_by_user_id AS userId, COUNT(*) AS n FROM qc_runs WHERE done_by_user_id IS NOT NULL AND date(created_at, '+330 minutes') = ${day} GROUP BY 1`),
    rows<{ userId: number; n: number }>(sql`SELECT created_by_user_id AS userId, COUNT(*) AS n FROM dispatch_challans WHERE created_by_user_id IS NOT NULL AND revision = 0 AND date(created_at, '+330 minutes') = ${day} GROUP BY 1`),
    rows<{ id: number; name: string; role: string }>(sql`SELECT id, name, role FROM users`),
  ]);
  const by = new Map<number, { takas: number; qc: number; challans: number; dispatches: number }>();
  const get = (id: number) => by.get(id) ?? by.set(id, { takas: 0, qc: 0, challans: 0, dispatches: 0 }).get(id)!;
  for (const e of events) {
    if (e.event === 'entered') get(e.userId).takas += e.n;
    else get(e.userId).challans += e.challans;
  }
  for (const q of qc) get(q.userId).qc += q.n;
  for (const d of dcs) get(d.userId).dispatches += d.n;
  const list = [...by.entries()].sort((a, b) => sum(Object.values(b[1])) - sum(Object.values(a[1])));
  if (!list.length) return emptyCard('o.team_today', 'Nothing recorded yet today', 'Today');
  const nameOf = new Map(names.map((u) => [u.id, u.name]));
  const { shown, more } = top(list, 6);
  const cell = (n: number) => (n ? n : '—');
  return {
    id: 'o.team_today',
    periodLabel: 'Today',
    body: {
      kind: 'table',
      columns: [
        { key: 'who', label: 'Person' },
        { key: 'takas', label: 'Takas entered', align: 'right' },
        { key: 'qc', label: 'QC done', align: 'right' },
        { key: 'challans', label: 'Challans', align: 'right' },
        { key: 'dispatches', label: 'Dispatches', align: 'right' },
      ],
      rows: shown.map(([id, v]) => ({ cells: { who: nameOf.get(id) ?? `User ${id}`, takas: cell(v.takas), qc: cell(v.qc), challans: cell(v.challans), dispatches: cell(v.dispatches) } })),
      more,
    },
  };
};

const dispatchWeeks: Builder = async (ctx) => {
  const list = await rows<{ stage: string; unit: string; pcs: number; m: number }>(sql`
    SELECT t.stage, o.unit, COALESCE(SUM(${TAKA_PCS}), 0) AS pcs, COALESCE(SUM(${TAKA_M}), 0) AS m
    FROM takas t JOIN orders o ON o.id = COALESCE(t.allocated_order_id, t.order_id)
    WHERE t.is_deleted = 0 AND t.is_free_stock = 0 AND o.is_closed = 0 AND o.is_stock_holder = 0
      AND t.stage IN ('ready_dispatch', 'final', 'at_mill', 'mill_qc', 'refinish', 'at_butta', 'butta_qc', 'waiting_mill', 'rework_butta', 'entered')
    GROUP BY 1, 2`);
  const weeks = nextWeeks(ctx.today, 4);
  const view = (k: 'pcs' | 'm'): CardBody => ({
    kind: 'bars',
    unit: k,
    series: ['Expected'],
    points: weeks.map((w, i) => ({
      label: w.label,
      values: [sum(list.filter((r) => dispatchWeek(r.stage) === i + 1 && r.unit === (k === 'pcs' ? 'pcs' : 'meters')).map((r) => r[k]))],
      note: ['Ready for dispatch', 'In the godown', 'At the mill / mill QC', 'At butta / waiting for the mill'][i],
    })),
    summary: 'Estimated from where the cloth is now',
  });
  return {
    id: 'o.dispatch_weeks',
    periodLabel: 'Next 4 weeks',
    switch: { options: [{ value: 'pcs', label: 'Pcs' }, { value: 'm', label: 'All-over (m)' }], value: 'pcs' },
    body: null,
    views: { pcs: view('pcs'), m: view('m') },
    href: ordersHref({ status: ['ready_for_dispatch'] }),
  };
};

const todayNumbers: Builder = async (ctx) => {
  const day = ctx.today;
  const [orders, dispatches, [frames], [takas], [qc]] = await Promise.all([
    loadOrders(ctx),
    loadDispatches(ctx),
    rows<{ frames: number; n: number }>(sql`
      SELECT COALESCE(SUM(completed_frames), 0) AS frames, COUNT(*) AS n FROM jobsheets
      WHERE status = 'completed' AND is_deleted = 0 AND is_external = 0 AND date(completed_at, '+330 minutes') = ${day}`),
    rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM takas t WHERE ${ENTERED_TAKA} AND date(t.created_at, '+330 minutes') = ${day}`),
    rows<{ n: number }>(sql`SELECT COUNT(*) AS n FROM qc_runs WHERE date(created_at, '+330 minutes') = ${day}`),
  ]);
  const booked = orders.filter((o) => o.orderDate === day);
  const disp = dispatches.filter((d) => d.challanDate === day);
  return {
    id: 'o.today_numbers',
    periodLabel: 'Today',
    body: {
      kind: 'split',
      items: [
        { label: 'Orders booked', value: booked.length, unit: 'orders', href: ordersHref({ from: day, to: day }) },
        { label: 'Frames completed', value: frames?.frames ?? 0, unit: 'frames', sub: `${frames?.n ?? 0} jobsheets` },
        { label: 'Takas entered', value: takas?.n ?? 0, unit: 'takas' },
        { label: 'QC done', value: qc?.n ?? 0, unit: 'takas' },
        { label: 'Dispatched', value: sum(disp.map((d) => d.pcs)), unit: 'pcs', sub: `${formatValue(sum(disp.map((d) => d.meters)), 'm')} · ${disp.length} challans`, href: '/dispatched' },
      ],
    },
  };
};

export const OWNER_CARDS: Record<string, Builder> = {
  'o.s.open': stripOpen,
  'o.s.production': stripProduction,
  'o.s.ready': stripReady,
  'o.s.dispatched': stripDispatched,
  'o.s.attention': stripAttention,
  'o.attention': attention,
  'o.glance': glance,
  'o.booked_month': bookedPerMonth,
  'o.value_month': valuePerMonth,
  'o.open_status': openByStatus,
  'o.top3': top3,
  'o.quiet': quiet,
  'o.brokers': brokers,
  'o.repeat_designs': repeatDesigns,
  'o.quality_demand': qualityDemand,
  'o.to_dispatch': toDispatch,
  'o.stage_days': stageDays,
  'o.oldest_open': oldestOpen,
  'o.on_time': onTime,
  'o.damage_pct': damagePct,
  'o.damage_type': damageType,
  'o.damage_money': damageMoney,
  'o.damage_reasons': damageReasons,
  'o.damage_designs': damageDesigns,
  'o.returns_month': returnsPerMonth,
  'o.returns_client': returnsByClient,
  'o.rework': rework,
  'o.stock_glance': stockGlance,
  'o.dead_stock': deadStock,
  'o.stock_match': stockMatch,
  'o.job_parties': jobParties,
  'o.challans_late': challansLate,
  'o.outside_goods': outsideGoods,
  'o.utilisation': loomUtilisation,
  'o.frames_month': framesPerMonth,
  'o.yarn_month': yarnPerMonth,
  'o.idle_looms': idleLooms,
  'o.team_today': teamToday,
  'o.dispatch_weeks': dispatchWeeks,
  'o.today_numbers': todayNumbers,
};

