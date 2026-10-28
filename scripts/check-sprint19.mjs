/**
 * Sprint 19 API flow check against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint19.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) Built incrementally, one section per build
 * phase of the Sprint 19 plan. Creates its own orders, so it can run many times.
 */
const base = process.argv[2] ?? 'http://localhost:4100';
if (!process.env.TURSO_DATABASE_URL?.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database.');
  process.exit(2);
}

let failed = 0;
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!ok) failed += 1;
};

const PHONES = { jemish: '9999999999', gaurang: '8888888888', supervisor: '7777777777', taka: '6666666666', qc: '5555555555', godown: '4444444444', dhruvil: '3333333333' };
const sessions = {};
for (const [who, phone] of Object.entries(PHONES)) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: `Rivoora@${phone.slice(0, 3)}` }) });
  if (!res.ok) throw new Error(`login ${who} failed: ${res.status}`);
  sessions[who] = res.headers.get('set-cookie').split(';')[0];
}
async function call(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { Cookie: sessions[who], 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const today = new Date().toISOString().slice(0, 10);

const customer = (await ok('jemish', 'GET', '/lookup/customers'))[0];
const material = (await ok('jemish', 'GET', '/lookup/materials'))[0];
const design = ((await ok('jemish', 'GET', '/designs?limit=5')).items ?? [])[0];
const machineIds = (await ok('jemish', 'GET', '/lookup/machines')).slice(0, 2).map((m) => m.id);

const letters = 'ABCDEHJKLMNPQRTUVWXY';
const weaverCode = () => Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');

const baseOrder = (over = {}) => ({
  customerId: customer.id, materialId: material.id, designId: design.id, quantity: 60, rate: 100, orderDate: today, notes: '', noteImages: [], ...over,
});

/* ============================================================ Phase 4: order form (unit, lump lock, unit lock) */

{
  const r = await call('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'pcs_to_pcs' }));
  check(r.status === 400, 'a meter order rejects pcs_to_pcs', r);

  const meterOrderC = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 300 }));
  const meterOrder = await ok('jemish', 'GET', `/orders/${meterOrderC.id}`);
  check(meterOrder.unit === 'meters' && meterOrder.orderType === 'lump', 'a meter order is created as lump', meterOrder);

  const pcsOrderC = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'pcs', orderType: 'pcs_to_pcs' }));
  const pcsOrder = await ok('jemish', 'GET', `/orders/${pcsOrderC.id}`);
  check(pcsOrder.orderType === 'pcs_to_pcs', 'a pcs order still accepts pcs_to_pcs (unaffected)', pcsOrder);

  // Unit can still change on an untouched order…
  await ok('jemish', 'PUT', `/orders/${pcsOrder.id}`, baseOrder({ unit: 'meters', orderType: 'lump' }));
  const changed = await ok('jemish', 'GET', `/orders/${pcsOrder.id}`);
  check(changed.unit === 'meters', 'unit can change before any jobsheet / taka / outside PO exists', changed);

  // …but is locked once an outside PO exists (POs can only be made once the order is sent for production).
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [changed.id] });
  const weaverForPo = await ok('jemish', 'POST', '/weavers', { name: `S19 Weaver ${Date.now()}`, shortCode: weaverCode() });
  await ok('jemish', 'POST', `/orders/${changed.id}/outside-pos`, { weaverId: weaverForPo.id, materialId: material.id, quantity: 50, unit: 'meters', orderType: 'lump', poDate: today });
  const lockedByPo = await call('jemish', 'PUT', `/orders/${changed.id}`, baseOrder({ unit: 'pcs', orderType: 'pcs_to_pcs' }));
  check(lockedByPo.status === 400 && /jobsheets, takas or outside POs/.test(lockedByPo.body?.error?.message ?? ''), 'unit is locked once an outside PO exists', lockedByPo);

  // A pcs order is locked once it has jobsheets (existing rule, still works).
  const prodOrder = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'pcs', orderType: 'pcs_to_pcs', quantity: 30 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [prodOrder.id] });
  await ok('jemish', 'POST', `/orders/${prodOrder.id}/jobsheets/generate`, { pieces: 30, framesPerJobsheet: 100, machineIds });
  const lockedByJobsheet = await call('jemish', 'PUT', `/orders/${prodOrder.id}`, baseOrder({ unit: 'meters', orderType: 'lump' }));
  check(lockedByJobsheet.status === 400, 'unit is still locked once jobsheets exist (existing rule unaffected)', lockedByJobsheet);

  const detail = await ok('jemish', 'GET', `/orders/${meterOrder.id}`);
  check(detail.unit === 'meters', 'meter order detail loads normally', detail);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 19 checks (so far) passed');
process.exit(failed ? 1 : 0);
