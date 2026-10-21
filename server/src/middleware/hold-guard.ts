import type { RequestHandler } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { orderOnHoldMessage, seesHeldOrders } from '@rivoora/shared';
import { db } from '../db/client';
import { challanTakas, dispatchChallans, jobsheets, orders, takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { isGodownOrdersOnly, orderInGodownScope } from '../services/godown-scope';

/**
 * Hold order (Sprint 15) — the ONE place that decides what a held order blocks.
 *
 * WRITES: every write that touches a held order answers 409 "Order #26 is on hold" — for every role, Jenish and
 * Gaurang included. Only the receive endpoints (butta / mill receive, the mill received count, undo receive) and
 * Jenish's hold / release are NOT listed, so they keep working.
 *
 * READS: roles that must not see held orders (everyone except Jenish / Gaurang) get 404 on the order-level screens
 * (Orders, Godown orders, Dispatched, the pending lists' order drawers) and a 409 "Order #26 is on hold" on the
 * jobsheet / taka screens (scan, QC, taka entry), so the person knows why. The LIST queries filter in SQL
 * (`orderNotHeldFor` in services/hold.ts).
 *
 * Mounted once after the auth middleware (see index.ts). `scripts/check-hold.mjs` exercises every rule.
 */

type Resolver = (m: RegExpMatchArray, req: Parameters<RequestHandler>[0]) => Promise<number[]>;

/** The order a taka counts for (free stock belongs to no order). */
async function ordersOfTakaRows(rows: { orderId: number; allocatedOrderId: number | null; isFreeStock: boolean }[]): Promise<number[]> {
  return rows.filter((r) => !r.isFreeStock).map((r) => r.allocatedOrderId ?? r.orderId);
}

const byTakaIds = async (ids: number[]): Promise<number[]> => {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ orderId: takas.orderId, allocatedOrderId: takas.allocatedOrderId, isFreeStock: takas.isFreeStock })
    .from(takas)
    .where(inArray(takas.id, ids.slice(0, 2000)));
  return ordersOfTakaRows(rows);
};

const idList = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0) : [];

const ofOrder: Resolver = async (m) => [Number(m[1])];
const ofJobsheet: Resolver = async (m) => {
  const rows = await db.select({ orderId: jobsheets.orderId }).from(jobsheets).where(eq(jobsheets.id, Number(m[1])));
  return rows.map((r) => r.orderId);
};
const ofTaka: Resolver = async (m) => byTakaIds([Number(m[1])]);
const ofTakaNo: Resolver = async (m) => {
  const rows = await db
    .select({ orderId: takas.orderId, allocatedOrderId: takas.allocatedOrderId, isFreeStock: takas.isFreeStock })
    .from(takas)
    .where(and(eq(takas.takaNo, decodeURIComponent(m[1])), eq(takas.isDeleted, false)));
  return ordersOfTakaRows(rows);
};
const ofBodyTakaIds: Resolver = async (_m, req) => byTakaIds(idList((req.body as { takaIds?: unknown } | undefined)?.takaIds));
const ofBodyOrderIds: Resolver = async (_m, req) => idList((req.body as { orderIds?: unknown } | undefined)?.orderIds);
const ofChallanTakas: Resolver = async (m) => {
  const rows = await db
    .selectDistinct({ orderId: challanTakas.orderId })
    .from(challanTakas)
    .where(eq(challanTakas.challanId, Number(m[m.length - 1] ?? m[1])));
  return rows.map((r) => r.orderId);
};
const ofDispatchChallan: Resolver = async (m) => {
  const rows = await db.select({ orderId: dispatchChallans.orderId }).from(dispatchChallans).where(eq(dispatchChallans.id, Number(m[1])));
  return rows.map((r) => r.orderId);
};
const ofQuerySheetIds: Resolver = async (_m, req) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 500);
  if (ids.length === 0) return [];
  const rows = await db.selectDistinct({ orderId: jobsheets.orderId }).from(jobsheets).where(inArray(jobsheets.id, ids));
  return rows.map((r) => r.orderId);
};
const ofJobsheetNo: Resolver = async (m) => {
  const rows = await db.select({ orderId: jobsheets.orderId }).from(jobsheets).where(eq(jobsheets.jobsheetNo, Number(m[1])));
  return rows.map((r) => r.orderId);
};

interface Rule {
  methods: string[];
  pattern: RegExp;
  resolve: Resolver;
}

/** Writes. NOT listed on purpose: orders hold / release, the receive endpoints, the mill received count and undo receive. */
const WRITE_RULES: Rule[] = [
  { methods: ['PUT', 'DELETE'], pattern: /^\/jobsheets\/(\d+)$/, resolve: ofJobsheet },
  { methods: ['POST', 'PUT'], pattern: /^\/jobsheets\/(\d+)\/(?:pull-back|start|complete|change-machine|takas)$/, resolve: ofJobsheet },
  { methods: ['PUT'], pattern: /^\/orders\/(\d+)$/, resolve: ofOrder },
  {
    methods: ['POST'],
    pattern: /^\/orders\/(\d+)\/(?:jobsheets|jobsheets\/generate|jobsheets\/send|undo-production|takas\/move-to-inventory|takas\/add-from-free-stock|takas\/send-back)$/,
    resolve: ofOrder,
  },
  { methods: ['POST'], pattern: /^\/orders\/send-to-production$/, resolve: ofBodyOrderIds },
  { methods: ['POST'], pattern: /^\/(?:butta|mill)\/challans$/, resolve: ofBodyTakaIds },
  { methods: ['POST'], pattern: /^\/(?:butta|mill)\/challans\/(\d+)\/cancel$/, resolve: ofChallanTakas },
  { methods: ['POST'], pattern: /^\/(?:butta-qc|mill-qc)\/(\d+)$/, resolve: ofTaka },
  { methods: ['PATCH', 'POST'], pattern: /^\/godown\/takas\/(\d+)(?:\/[a-z-]+)?$/, resolve: ofTaka },
  { methods: ['POST'], pattern: /^\/godown\/orders\/(\d+)\/(?:ready-dispatch|dispatch)$/, resolve: ofOrder },
  { methods: ['POST'], pattern: /^\/dispatch\/challans\/(\d+)\/goods-return$/, resolve: ofDispatchChallan },
  { methods: ['POST'], pattern: /^\/inventory\/takas\/(\d+)\/mark-fresh$/, resolve: ofTaka },
];

/** Reads of roles that must not see held orders: 409 with the hold message (jobsheet / taka screens). */
const READ_MESSAGE_RULES: Rule[] = [
  { methods: ['GET'], pattern: /^\/jobsheets\/(\d+)$/, resolve: ofJobsheet },
  { methods: ['GET'], pattern: /^\/jobsheets\/by-no\/(\d+)$/, resolve: ofJobsheetNo },
  { methods: ['GET'], pattern: /^\/jobsheets\/print$/, resolve: ofQuerySheetIds },
  { methods: ['GET'], pattern: /^\/takas\/by-no\/([^/]+)$/, resolve: ofTakaNo },
  { methods: ['GET'], pattern: /^\/takas\/(\d+)(?:\/damages)?$/, resolve: ofTaka },
  { methods: ['GET'], pattern: /^\/mill-qc\/taka\/([^/]+)$/, resolve: ofTakaNo },
];

/** Reads of roles that must not see held orders: 404 (order-level screens). */
const READ_HIDDEN_RULES: Rule[] = [
  { methods: ['GET'], pattern: /^\/orders\/(\d+)(?:\/.*)?$/, resolve: ofOrder },
  { methods: ['GET'], pattern: /^\/godown\/orders\/(\d+)(?:\/.*)?$/, resolve: ofOrder },
  { methods: ['GET'], pattern: /^\/dispatched\/(\d+)$/, resolve: ofOrder },
  { methods: ['GET'], pattern: /^\/dispatch\/challans\/(\d+)(?:\/print)?$/, resolve: ofDispatchChallan },
  { methods: ['GET'], pattern: /^\/(?:butta|mill)\/(?:pending-orders|refinish-orders)\/(\d+)\/takas$/, resolve: ofOrder },
];

const match = (rules: Rule[], method: string, path: string, req: Parameters<RequestHandler>[0]) => {
  for (const rule of rules) {
    if (!rule.methods.includes(method)) continue;
    const m = path.match(rule.pattern);
    if (m) return { rule, m, req };
  }
  return null;
};

async function heldOrders(orderIds: number[]): Promise<{ id: number; orderNo: number }[]> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return [];
  return db
    .select({ id: orders.id, orderNo: orders.orderNo })
    .from(orders)
    .where(and(inArray(orders.id, ids), sql`${orders.isOnHold} = 1`));
}

export const holdGuard: RequestHandler = (req, _res, next) => {
  const method = req.method.toUpperCase();
  const path = req.path.replace(/\/+$/, '') || '/';
  const run = async () => {
    if (method === 'GET' || method === 'HEAD') {
      // Sprint 15: the godown supervisor's Orders — only orders with takas at the butta stage or later.
      const scoped = isGodownOrdersOnly(req.role) ? path.match(/^\/orders\/(\d+)(?:\/.*)?$/) : null;
      if (scoped && !(await orderInGodownScope(Number(scoped[1])))) throw notFound('Order');
      if (seesHeldOrders(req.role)) return;
      const hit = match(READ_MESSAGE_RULES, method, path, req) ?? match(READ_HIDDEN_RULES, method, path, req);
      if (!hit) return;
      const held = await heldOrders(await hit.rule.resolve(hit.m, req));
      if (held.length === 0) return;
      if (READ_MESSAGE_RULES.includes(hit.rule)) throw conflict(orderOnHoldMessage(held[0].orderNo, req.role));
      throw notFound('Order');
    }
    const hit = match(WRITE_RULES, method, path, req);
    if (!hit) return;
    const held = await heldOrders(await hit.rule.resolve(hit.m, req));
    if (held.length) throw conflict(orderOnHoldMessage(held[0].orderNo, req.role));
  };
  run().then(() => next(), next);
};
