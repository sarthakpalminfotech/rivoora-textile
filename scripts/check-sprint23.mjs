/**
 * Sprint 23 API check on a LOCAL file database (never Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint23.mjs [baseUrl]
 *
 * (db migrated + seeded, API running on baseUrl, default http://localhost:4100). It starts extra API servers on the SAME
 * file database with FY_NOW set (ports 4101 / 4102) to simulate the financial year changing, and checks:
 *   A · numbers restart each FY (orders, jobsheets), per-FY unique indexes, lookups current-FY-first, QR /j/<no> and
 *       /j/<fy>/<no>.
 *   B · QC login limits: outside place / outside hours refused (and logged), location_required flow, grants,
 *       heartbeat, forced logout, other roles unaffected, permission 403.
 */
import { spawn } from 'node:child_process';
import { createClient } from '@libsql/client';

const base = process.argv[2] ?? 'http://localhost:4100';
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl?.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database.');
  process.exit(2);
}
const db = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN ?? 'x' });
const sql = async (q, a = []) => (await db.execute({ sql: q, args: a })).rows.map((r) => ({ ...r }));
let failed = 0;
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!ok) failed += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rawLogin(url, phone, password, extra = {}) {
  const res = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password, ...extra }) });
  return { status: res.status, body: await res.json().catch(() => null), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const mk = (url) => async (cookie, method, path, body) => {
  const res = await fetch(`${url}/api${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const call = mk(base);

const owner = (await rawLogin(base, '9999999999', 'Rivoora@999')).cookie;
const sup = (await rawLogin(base, '7777777777', 'Rivoora@777')).cookie;
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

// ============================================================ B · QC login limits
const QC = ['5555555555', 'Rivoora@555'];
const FACTORY = { lat: 21.17, lng: 72.83 };
check((await call(sup, 'GET', '/login-limits')).status === 403, 'supervisor cannot open the QC login limits');
check((await call(owner, 'GET', '/login-limits')).status === 200, 'owner can open the QC login limits');

// all day, every day, no place → QC logs in without a location
await ok(owner, 'PUT', '/login-limits/settings', { enabled: true, fromTime: '00:00', toTime: '23:59', days: [1, 2, 3, 4, 5, 6, 7] });
for (const l of (await ok(owner, 'GET', '/login-limits')).locations) await ok(owner, 'DELETE', `/login-limits/locations/${l.id}`);
let r = await rawLogin(base, ...QC);
check(r.status === 200 && r.body?.user?.limitUntil, 'no place configured → QC logs in (place not checked), session end returned', r.body);

// add the factory
const loc = await ok(owner, 'POST', '/login-limits/locations', { name: 'Factory', latitude: FACTORY.lat, longitude: FACTORY.lng, radiusM: 200, isActive: true });
r = await rawLogin(base, ...QC);
check(r.status === 403 && r.body?.error?.field === 'location_required', 'no location sent → 403 location_required (client asks the browser)', r.body);
r = await rawLogin(base, ...QC, { locationDenied: true });
check(r.status === 403 && r.body?.error?.field !== 'location_required', 'location denied → refused with an explanation', r.body);
r = await rawLogin(base, ...QC, { location: { lat: FACTORY.lat + 0.01, lng: FACTORY.lng, accuracy: 10 } });
check(r.status === 403, 'far away (~1.1 km) → refused', r.body);
r = await rawLogin(base, ...QC, { location: { lat: FACTORY.lat + 0.0005, lng: FACTORY.lng, accuracy: 10 } });
check(r.status === 200, 'inside the radius → logged in', r.body);
const qcCookie = r.cookie;
const log = await ok(owner, 'GET', '/login-limits/log');
check(log.some((e) => e.event === 'login_refused'), 'refused logins are in the log', log.slice(0, 3));
check((await rawLogin(base, '9999999999', 'Rivoora@999')).status === 200, 'other roles are not limited (no location needed)');

// heartbeat: inside keeps the session, away twice ends it
let hb = await call(qcCookie, 'POST', '/auth/heartbeat', { location: { lat: FACTORY.lat, lng: FACTORY.lng, accuracy: 10 } });
check(hb.status === 200 && hb.body?.outside === false && hb.body?.validUntil, 'heartbeat inside keeps the session', hb.body);
const away = { location: { lat: FACTORY.lat + 0.05, lng: FACTORY.lng, accuracy: 10 } };
hb = await call(qcCookie, 'POST', '/auth/heartbeat', away);
check(hb.status === 200 && hb.body?.outside === true, 'first heartbeat away → warning only', hb.body);
hb = await call(qcCookie, 'POST', '/auth/heartbeat', away);
check(hb.status === 401 && hb.body?.error?.field === 'session_ended', 'second heartbeat away → session ended (401)', hb.body);
check((await call(qcCookie, 'GET', '/auth/me')).status === 401, 'the ended session stays ended');

// hours: a window that excludes now → refused; a grant lets him in
const hh = new Date(Date.now() + 330 * 60_000).getUTCHours();
const from = `${String((hh + 2) % 24).padStart(2, '0')}:00`;
const to = `${String((hh + 3) % 24).padStart(2, '0')}:00`;
if (from < to) {
  await ok(owner, 'PUT', '/login-limits/settings', { enabled: true, fromTime: from, toTime: to, days: [1, 2, 3, 4, 5, 6, 7] });
  const inPlace = { location: { lat: FACTORY.lat, lng: FACTORY.lng, accuracy: 10 } };
  r = await rawLogin(base, ...QC, inPlace);
  check(r.status === 403, 'outside the login hours → refused', r.body);
  const qcUser = (await ok(owner, 'GET', '/login-limits')).qcUsers[0];
  const ist = new Date(Date.now() + 330 * 60_000).toISOString();
  const grant = await ok(owner, 'POST', '/login-limits/grants', { userId: qcUser.id, grantDate: ist.slice(0, 10), untilTime: '23:59', reason: 'smoke test' });
  r = await rawLogin(base, ...QC, inPlace);
  check(r.status === 200, 'an extra-time grant lets him in after hours', r.body);
  await ok(owner, 'POST', `/login-limits/grants/${grant.id}/cancel`);
  r = await rawLogin(base, ...QC, inPlace);
  check(r.status === 403, 'a cancelled grant no longer works', r.body);
} else console.log('skip  hours window test (clock wraps midnight)');
check((await sql('SELECT COUNT(*) AS n FROM login_limit_changes'))[0].n >= 3, 'every settings change is recorded');
await ok(owner, 'PUT', '/login-limits/settings', { enabled: true, fromTime: '08:30', toTime: '19:20', days: [1, 2, 3, 4, 5, 6, 7] });
await ok(owner, 'DELETE', `/login-limits/locations/${loc.id}`);

// ============================================================ A · financial years
function startServer(port, fyNow) {
  return spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', shell: true, env: { ...process.env, PORT: String(port), FY_NOW: fyNow }, stdio: 'ignore' });
}
function stopServer(child) {
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  } catch {
    child.kill();
  }
}
async function waitFor(url) {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return true;
    } catch {
      /* not yet */
    }
    await sleep(1000);
  }
  return false;
}
const customer = (await ok(owner, 'GET', '/lookup/customers'))[0];
const design = (await ok(owner, 'GET', '/designs?limit=5')).items[0];
const material = design.qualities[0];
const machineIds = (await ok(owner, 'GET', '/lookup/machines')).slice(0, 2).map((m) => m.id);
const today = new Date().toISOString().slice(0, 10);
const orderBody = { customerId: customer.id, orderType: 'pcs_to_pcs', materialId: material.id, designId: design.id, quantity: 30, unit: 'pcs', rate: 10, orderDate: today, notes: '', noteImages: [] };

async function makeOrderWithJobsheet(url, cookie) {
  const c = mk(url);
  const o = await c(cookie, 'POST', '/orders', orderBody);
  if (o.status >= 300) throw new Error(JSON.stringify(o.body));
  await c(cookie, 'POST', '/orders/send-to-production', { orderIds: [o.body.id] });
  const g = await c(cookie, 'POST', `/orders/${o.body.id}/jobsheets/generate`, { pieces: 30, framesPerJobsheet: 10, machineIds });
  if (g.status >= 300) throw new Error(JSON.stringify(g.body));
  return o.body;
}

const fy0 = (await sql('SELECT fy FROM orders ORDER BY id DESC LIMIT 1'))[0]?.fy;
check(typeof fy0 === 'string' && /^\d{4}-\d{2}$/.test(fy0), 'existing orders carry a financial year', fy0);
const a = await makeOrderWithJobsheet(base, owner);
const s1 = startServer(4101, '2027-04-05');
check(await waitFor('http://localhost:4101'), 'FY 2027-28 server started');
try {
  const o27 = await rawLogin('http://localhost:4101', '9999999999', 'Rivoora@999');
  const b = await makeOrderWithJobsheet('http://localhost:4101', o27.cookie);
  const o1 = (await sql('SELECT fy, order_no FROM orders WHERE id = ?', [b.id]))[0];
  check(o1.fy === '2027-28' && o1.order_no === 1, 'first order of 2027-28 is #1 (restarted)', o1);
  const a1 = (await sql('SELECT fy, order_no FROM orders WHERE id = ?', [a.id]))[0];
  check(a1.fy !== '2027-28' && a1.order_no > 1, 'the order made earlier keeps its number and year', a1);
  const j27 = (await sql('SELECT fy, jobsheet_no FROM jobsheets WHERE order_id = ? ORDER BY id', [b.id])).map((x) => ({ fy: x.fy, no: x.jobsheet_no }));
  check(j27[0]?.fy === '2027-28' && j27[0]?.no === 1, 'jobsheet numbers restart at 1 in the new year', j27);
  const o27b = { body: await makeOrderWithJobsheet('http://localhost:4101', o27.cookie) };
  check((await sql('SELECT order_no FROM orders WHERE id = ?', [o27b.body.id]))[0].order_no === 2, 'second order of 2027-28 is #2');
  const dup = await sql('SELECT jobsheet_no, COUNT(DISTINCT fy) AS n FROM jobsheets WHERE is_deleted = 0 GROUP BY jobsheet_no HAVING n > 1 LIMIT 1');
  check(dup.length === 1, 'the same jobsheet number exists in two years (per-year unique index)', dup);
  const no = j27[0].no;
  const c27 = mk('http://localhost:4101');
  const byNew = await c27(o27.cookie, 'GET', `/jobsheets/by-no/2027-28/${no}`);
  check(byNew.status === 200 && byNew.body?.fy === '2027-28', 'by-no with a year finds that year', byNew.body);
  const byOld = await c27(o27.cookie, 'GET', `/jobsheets/by-no/${fy0}/${no}`);
  check(byOld.status === 200 && byOld.body?.fy === fy0, 'an old QR with the year still resolves', byOld.body);
  const plain = await c27(o27.cookie, 'GET', `/jobsheets/by-no/${no}`);
  check(plain.status === 200 && plain.body?.fy === '2027-28', '/j/<no> without a year → current year first', plain.body);
} finally {
  stopServer(s1);
}
const s2 = startServer(4102, '2028-04-05');
check(await waitFor('http://localhost:4102'), 'FY 2028-29 server started');
try {
  const o28 = await rawLogin('http://localhost:4102', '9999999999', 'Rivoora@999');
  const c28 = mk('http://localhost:4102');
  const plain = await c28(o28.cookie, 'GET', '/jobsheets/by-no/1');
  check(plain.status === 200 && (plain.body?.id || (plain.body?.candidates ?? []).length > 1), 'older number with no match in the current year → older match or the "Which one?" candidates', plain.body);
  const n = { body: await makeOrderWithJobsheet('http://localhost:4102', o28.cookie) };
  check((await sql('SELECT order_no FROM orders WHERE id = ?', [n.body.id]))[0].order_no === 1, 'orders restart at #1 again in 2028-29');
} finally {
  stopServer(s2);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 23 checks passed');
process.exit(failed ? 1 : 0);
