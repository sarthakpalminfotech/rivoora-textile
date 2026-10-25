/**
 * Quick auth check against a running API (default http://localhost:4000):
 *   node scripts/check-auth.mjs [baseUrl]
 * 1. every /api router rejects a request without a session cookie (401),
 * 2. login works, wrong passwords give one generic message,
 * 3. a role that can't switch roles can't use X-Act-As, Jenish can,
 * 4. logout clears the cookie and the session stops working.
 */
const base = process.argv[2] ?? 'http://localhost:4000';
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed += 1;
};

const prefixes = [
  'orders', 'customers', 'materials', 'damages', 'designs', 'machines', 'jobsheets', 'machine-view', 'taka', 'takas',
  'butta-parties', 'mill-parties', 'butta/counts', 'mill/counts', 'butta-qc/pending', 'mill-qc/pending', 'godown/orders',
  'inventory/summary', 'dispatch/challans/1', 'dispatched', 'lookup/customers', 'users', 'auth/me',
  // Sprint 17: yarn.
  'yarn-parties', 'yarn-qualities', 'tfo-machines', 'yarn-pos', 'yarn/summary', 'yarn/tfo/board', 'lookup/yarn-qualities',
];
for (const p of prefixes) {
  const res = await fetch(`${base}/api/${p}`, { headers: { 'X-Role': 'jemish' } });
  check(res.status === 401, `GET /api/${p} without a session → ${res.status}`);
}
for (const [method, p] of [['POST', 'orders'], ['PUT', 'orders/1'], ['POST', 'uploads'], ['POST', 'orders/1/takas/move-to-inventory'], ['POST', 'users'], ['POST', 'yarn/transfers'], ['POST', 'yarn-pos/1/receipts']]) {
  const res = await fetch(`${base}/api/${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check(res.status === 401, `${method} /api/${p} without a session → ${res.status}`);
}
check((await fetch(`${base}/api/health`)).status === 200, 'GET /api/health is public');

async function login(phone, password) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  return { res, cookie, body: await res.json().catch(() => null) };
}
const bad = await login('9999999999', 'wrong-password');
check(bad.res.status === 401 && bad.body?.error?.message === 'Wrong number or password', 'wrong password → generic message');
const unknown = await login('1234567890', 'x');
check(unknown.res.status === 401 && unknown.body?.error?.message === 'Wrong number or password', 'unknown number → the same message');

const jemish = await login('9999999999', 'Rivoora@999');
check(jemish.res.status === 200 && jemish.cookie?.startsWith('rivoora_session='), 'Jenish logs in with the default password');
const setCookie = jemish.res.headers.get('set-cookie') ?? '';
check(/HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), 'cookie is HttpOnly + SameSite=Lax');

const api = (cookie, path, headers = {}) => fetch(`${base}/api/${path}`, { headers: { Cookie: cookie, ...headers } });
check((await api(jemish.cookie, 'auth/me')).status === 200, 'GET /auth/me with the cookie');
check((await api(jemish.cookie, 'orders')).status === 200, 'Jenish lists orders');
check((await api(jemish.cookie, 'customers')).status === 200, 'Jenish opens the customers master');
check((await api(jemish.cookie, 'customers', { 'X-Act-As': 'supervisor' })).status === 403, 'Jenish acting as the supervisor loses the customers master');
check((await api(jemish.cookie, 'jobsheets', { 'X-Act-As': 'supervisor' })).status === 200, 'Jenish acting as the supervisor sees the supervisor jobsheets');

const supervisor = await login('7777777777', 'Rivoora@777');
check(supervisor.res.status === 200, 'Supervisor logs in');
check((await api(supervisor.cookie, 'jobsheets', { 'X-Act-As': 'jemish' })).status === 200, 'supervisor X-Act-As jemish is ignored (still the supervisor jobsheets)');
check((await api(supervisor.cookie, 'customers', { 'X-Act-As': 'jemish' })).status === 403, 'supervisor can not become Jenish (customers master stays closed)');
check((await api(supervisor.cookie, 'users')).status === 403, 'supervisor can not open the Users master');

const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: supervisor.cookie } });
check(/Max-Age=0/i.test(out.headers.get('set-cookie') ?? ''), 'logout clears the cookie');
check((await api(supervisor.cookie, 'jobsheets')).status === 401, 'the session is gone after logout');

// Deactivating a user ends their sessions.
const tempPhone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const temp = await (await fetch(`${base}/api/users`, { method: 'POST', headers: { Cookie: jemish.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Temp user', phone: tempPhone, role: 'qc' }) })).json();
const tempLogin = await login(tempPhone, `Rivoora@${tempPhone.slice(0, 3)}`);
check(tempLogin.res.status === 200, 'new user logs in with the default password');
const upd = await fetch(`${base}/api/users/${temp.id}`, { method: 'PUT', headers: { Cookie: jemish.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Temp user', phone: tempPhone, role: 'qc', isActive: false }) });
check(upd.status === 200, 'deactivate the user');
check((await api(tempLogin.cookie, 'auth/me')).status === 401, 'deactivating a user logs them out');
check((await login(tempPhone, `Rivoora@${tempPhone.slice(0, 3)}`)).res.status === 401, 'a deactivated user can not log in');

// Rate limit: 5 failures per phone.
const limitedPhone = `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
for (let i = 0; i < 5; i += 1) await login(limitedPhone, 'nope');
check((await login(limitedPhone, 'nope')).res.status === 429, 'after 5 failed attempts the login is slowed down (429)');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
