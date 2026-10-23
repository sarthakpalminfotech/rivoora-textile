/**
 * Sprint 16 — "existing orders behave exactly as before". LOCAL FILE DB ONLY.
 *
 *   1. Run the OLD code (before Sprint 16) on a file DB with data, then:
 *      TURSO_DATABASE_URL=file:C:/path/a.db TURSO_AUTH_TOKEN=x node scripts/check-sprint16-snapshot.mjs snapshot out.json [baseUrl]
 *   2. Copy the DB, run `npm run db:migrate` (0015) with the NEW code on the copy, start the new API on it, then:
 *      TURSO_DATABASE_URL=file:C:/path/b.db TURSO_AUTH_TOKEN=x node scripts/check-sprint16-snapshot.mjs compare out.json [baseUrl]
 *
 * Compares, per order: status, jobsheet count + quantity, coverage, every taka's stage / pcs, and the dashboard numbers
 * (pcs bar total, progress, takas, damages, production totals, alerts, every main / sub stage count). A stage the new
 * dashboard hides (its step is not ticked) must have been empty. Plus the global lists (inventory, godown, butta / mill
 * counts, supervisor jobsheets, machine view).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, file, baseArg] = process.argv.slice(2);
const base = baseArg ?? 'http://localhost:4100';
if (!process.env.TURSO_DATABASE_URL?.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database.');
  process.exit(2);
}
if (!['snapshot', 'compare'].includes(mode) || !file) {
  console.error('Usage: node scripts/check-sprint16-snapshot.mjs snapshot|compare <file.json> [baseUrl]');
  process.exit(2);
}

const PHONES = { jemish: '9999999999', supervisor: '7777777777', godown: '4444444444', dhruvil: '3333333333' };
const sessions = {};
for (const [who, phone] of Object.entries(PHONES)) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: `Rivoora@${phone.slice(0, 3)}` }) });
  if (!res.ok) throw new Error(`login ${who} failed: ${res.status}`);
  sessions[who] = res.headers.get('set-cookie').split(';')[0];
}
async function get(who, path) {
  const res = await fetch(`${base}/api${path}`, { headers: { Cookie: sessions[who] } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function allOrders() {
  const out = [];
  for (let page = 1; page < 50; page += 1) {
    const r = await get('jemish', `/orders?limit=100&page=${page}`);
    out.push(...r.body.items);
    if (!r.body.hasMore) break;
  }
  return out;
}

const dashNumbers = (d) => ({
  barTotalPcs: d.barTotalPcs,
  progress: d.progress,
  takaCount: d.takaCount,
  damageTotal: d.damageTotal,
  production: d.production,
  isPcs: d.isPcs,
  hasJobsheets: d.hasJobsheets,
  alerts: d.alerts.map((a) => a.message).sort(),
  damages: Object.fromEntries(d.damages.filter((x) => x.count > 0).map((x) => [x.type, [x.count, x.pcs]])),
  main: Object.fromEntries(d.mainStages.map((m) => [m.key, { count: m.count, takas: m.takas, damaged: m.damaged, pcs: m.pcs, state: m.state }])),
  sub: Object.fromEntries(d.subStages.map((s) => [s.key, { count: s.count, frames: s.frames, damaged: s.damaged, takaPcs: s.takaPcs }])),
});

async function snapshot() {
  const orders = [];
  for (const o of await allOrders()) {
    const detail = (await get('jemish', `/orders/${o.id}`)).body;
    const entry = { id: o.id, orderNo: o.orderNo, status: detail.status, jobsheetCount: detail.jobsheetCount, jobsheetPieces: detail.jobsheetPieces };
    if (detail.status !== 'pending_production') {
      const js = await get('jemish', `/orders/${o.id}/jobsheets`);
      if (js.status === 200) entry.coverage = { ...js.body.coverage, warnings: js.body.warnings.map((w) => w.message) };
      const dash = await get('jemish', `/orders/${o.id}/dashboard`);
      if (dash.status === 200) entry.dashboard = dashNumbers(dash.body);
      const tk = await get('jemish', `/orders/${o.id}/takas`);
      if (tk.status === 200) {
        entry.takas = Object.fromEntries(tk.body.groups.flatMap((g) => g.takas).map((t) => [t.id, [t.takaNo, t.stage, t.pcs, t.actualPcs, t.isDamaged]]));
        entry.takaTotals = [tk.body.total, tk.body.damaged, tk.body.totalPcs, tk.body.totalMeters];
      }
    }
    orders.push(entry);
  }
  const global = {
    inventory: (await get('jemish', '/inventory/summary')).body,
    inventoryItems: (await get('jemish', '/inventory/items?limit=100')).body.items.map((i) => [i.key, i.pcs, i.freePcs]),
    godown: (await get('dhruvil', '/godown/orders?limit=100')).body.items.map((i) => [i.orderNo, i.uncheckedCount, i.readyDispatchCount]).sort(),
    buttaCounts: (await get('godown', '/butta/counts')).body,
    millCounts: (await get('godown', '/mill/counts')).body,
    supervisorTabs: (await get('supervisor', '/jobsheets?tab=all&limit=100')).body.counts,
    supervisorOrders: (await get('supervisor', '/jobsheets/orders?limit=100')).body.items.map((i) => [i.orderNo, i.counts]).sort(),
    productionOrders: (await get('supervisor', '/orders?limit=100')).body.items.map((i) => [i.orderNo, i.status]).sort(),
    machineView: (await get('supervisor', '/machine-view')).body.machines.map((m) => [m.machineNo, m.ongoing.map((j) => j.jobsheetNo)]),
    dispatched: (await get('dhruvil', '/dispatched?limit=100')).body.items.map((i) => [i.orderNo, i.status, i.dispatchedPcs]).sort(),
  };
  return { orders, global };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const now = await snapshot();
if (mode === 'snapshot') {
  writeFileSync(file, JSON.stringify(now, null, 1));
  console.log(`Snapshot of ${now.orders.length} orders written to ${file}`);
  process.exit(0);
}

const before = JSON.parse(readFileSync(file, 'utf8'));
let failed = 0;
const fail = (what, a, b) => {
  failed += 1;
  console.log(`FAIL ${what}\n   before ${JSON.stringify(a)}\n   after  ${JSON.stringify(b)}`);
};
const byId = new Map(now.orders.map((o) => [o.id, o]));
for (const o of before.orders) {
  const n = byId.get(o.id);
  if (!n) {
    fail(`order #${o.orderNo} missing`, o, null);
    continue;
  }
  for (const k of ['status', 'jobsheetCount', 'jobsheetPieces', 'coverage', 'takas', 'takaTotals']) {
    if (!same(o[k], n[k])) fail(`order #${o.orderNo} ${k}`, o[k], n[k]);
  }
  if (o.dashboard) {
    const a = o.dashboard;
    const b = n.dashboard;
    for (const k of ['barTotalPcs', 'progress', 'takaCount', 'damageTotal', 'production', 'isPcs', 'hasJobsheets', 'alerts', 'damages']) {
      if (!same(a[k], b?.[k])) fail(`order #${o.orderNo} dashboard.${k}`, a[k], b?.[k]);
    }
    for (const [key, m] of Object.entries(a.main)) {
      const nm = b.main[key];
      if (!nm) {
        // Hidden now (its step is not ticked): it must have been empty (it showed 0 / "Skipped" before).
        if (m.count !== 0 || m.pcs !== 0 || m.damaged !== 0) fail(`order #${o.orderNo} main stage ${key} hidden but had work`, m, null);
      } else if (!same({ ...m, state: m.state === 'skipped' ? null : m.state }, { ...nm, state: nm.state === 'skipped' ? null : nm.state })) {
        fail(`order #${o.orderNo} main stage ${key}`, m, nm);
      }
    }
    for (const [key, s] of Object.entries(a.sub)) {
      const ns = b.sub[key];
      if (!ns) {
        if (s.count !== 0) fail(`order #${o.orderNo} sub-stage ${key} hidden but had items`, s, null);
      } else if (!same(s, ns)) fail(`order #${o.orderNo} sub-stage ${key}`, s, ns);
    }
  }
}
for (const [k, v] of Object.entries(before.global)) {
  if (!same(v, now.global[k])) fail(`global ${k}`, v, now.global[k]);
}
console.log(failed ? `\n${failed} difference(s) FOUND` : `\nAll ${before.orders.length} existing orders and the global lists are unchanged.`);
process.exit(failed ? 1 : 0);
