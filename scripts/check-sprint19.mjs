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

/* ============================================================ Phase 5: jobsheets in meters */

{
  const order = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 300 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [order.id] });

  // Create: 300 m ÷ 3 sections = 100 loom m, 50 per jobsheet → 2 jobsheets of 50.
  const created = await ok('jemish', 'POST', `/orders/${order.id}/jobsheets/generate`, { meters: 300, metersPerJobsheet: 50, sections: 3, machineIds });
  check(created.created.length === 2, 'meter order: generate creates 2 jobsheets', created);
  check(created.created.every((j) => j.frames === 0 && j.meters === 50), 'meter order: each jobsheet has frames=0 (sentinel) and meters=50', created);

  const list = await ok('jemish', 'GET', `/orders/${order.id}/jobsheets`);
  check(list.coverage.jobsheetClothMeters === 300 && list.coverage.totalLoomMeters === 100, 'meter order: coverage totals (300 cloth m, 100 loom m)', list.coverage);
  check(list.warnings.length === 0, 'meter order: on target, no warnings', list.warnings);
  check(list.jobsheets.every((j) => j.meters === 50 && j.frames === 0), 'meter order: jobsheet list carries meters, frames stays 0', list.jobsheets);

  // Add a single jobsheet (10 m more) — now over target, expect a warning.
  const single = await ok('jemish', 'POST', `/orders/${order.id}/jobsheets`, { meters: 10, sections: 3, machineIds });
  check(single.created[0].meters === 10, 'meter order: add single jobsheet', single);
  const list2 = await ok('jemish', 'GET', `/orders/${order.id}/jobsheets`);
  check(list2.warnings.some((w) => w.kind === 'frames_over'), 'meter order: now over target, warns', list2.warnings);

  // Edit the single jobsheet down to the exact amount needed to land back on target (100 - 50 - 50 = 0... the
  // minimum is >0, so use a tiny amount and confirm the warning shrinks to match exactly).
  const singleId = single.created[0].id;
  const edited = await ok('jemish', 'PUT', `/jobsheets/${singleId}`, { meters: 0.01, sections: 3, machineIds });
  check(edited.updated[0]?.to === 0.01, 'meter order: edit auto-adjust updates the jobsheet to 0.01 m', edited);
  const list3 = await ok('jemish', 'GET', `/orders/${order.id}/jobsheets`);
  check(list3.warnings.length === 0, 'meter order: 100.01 loom m → 300.03 cloth m (0.03 over) is within the 0.05 m slack — on target', list3.warnings);

  // Print carries meters + cloth metres, no pcs-only fields breaking.
  const printed = await ok('jemish', 'GET', `/jobsheets/print?ids=${list3.jobsheets.map((j) => j.id).join(',')}`);
  check(printed.every((p) => p.meters !== null && p.clothMeters > 0), 'meter order: print items carry meters + clothMeters', printed);

  // A pcs order's create/print/edit paths are completely unaffected.
  const pcsOrder = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'pcs', orderType: 'pcs_to_pcs', quantity: 90 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [pcsOrder.id] });
  const pcsCreated = await ok('jemish', 'POST', `/orders/${pcsOrder.id}/jobsheets/generate`, { pieces: 90, framesPerJobsheet: 10, sections: 3, machineIds });
  check(pcsCreated.created.every((j) => j.meters === null || j.meters === undefined), 'pcs order: jobsheets still carry no meters', pcsCreated);
  const pcsList = await ok('jemish', 'GET', `/orders/${pcsOrder.id}/jobsheets`);
  check(pcsList.coverage.orderedPieces === 90 && pcsList.coverage.totalFrames === 30, 'pcs order: coverage unaffected (90 pcs, 30 frames)', pcsList.coverage);
}

/* ============================================================ Phase 6: supervisor complete/change-machine, hold/close */

{
  // --- Start, complete, change machine on a meter jobsheet ---
  const order = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 300 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [order.id] });
  const gen = await ok('jemish', 'POST', `/orders/${order.id}/jobsheets/generate`, { meters: 50, metersPerJobsheet: 50, sections: 3, machineIds });
  const jsId = gen.created[0].id;
  await ok('jemish', 'POST', `/orders/${order.id}/jobsheets/send`, { jobsheetIds: [jsId] });
  const started = await ok('supervisor', 'POST', `/jobsheets/${jsId}/start`, { machineId: machineIds[0] });
  check(started.status === 'ongoing', 'meter jobsheet: started', started);

  const changed = await ok('supervisor', 'POST', `/jobsheets/${jsId}/change-machine`, { completedMeters: 20, nextMeters: 30 });
  check(changed.completed.meters === 20 && changed.created.meters === 30, 'meter jobsheet: change machine (20 completed, 30 new)', changed);

  const newJsId = changed.created.id;
  await ok('supervisor', 'POST', `/jobsheets/${newJsId}/start`, { machineId: machineIds[1] ?? machineIds[0] });
  const completed = await ok('supervisor', 'POST', `/jobsheets/${newJsId}/complete`, { completedMeters: 30 });
  check(completed.status === 'completed', 'meter jobsheet: completed via the meters path', completed);

  const detail = await ok('jemish', 'GET', `/jobsheets/${newJsId}`);
  check(detail.completedMeters === 30 && detail.meters === 30, 'meter jobsheet detail: completedMeters recorded', detail);

  // pcs jobsheet complete/change-machine completely unaffected.
  const pcsOrder = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'pcs', orderType: 'pcs_to_pcs', quantity: 30 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [pcsOrder.id] });
  const pcsGen = await ok('jemish', 'POST', `/orders/${pcsOrder.id}/jobsheets/generate`, { pieces: 30, framesPerJobsheet: 10, sections: 3, machineIds });
  const pcsJsId = pcsGen.created[0].id;
  await ok('jemish', 'POST', `/orders/${pcsOrder.id}/jobsheets/send`, { jobsheetIds: [pcsJsId] });
  await ok('supervisor', 'POST', `/jobsheets/${pcsJsId}/start`, { machineId: machineIds[0] });
  const pcsCompleted = await ok('supervisor', 'POST', `/jobsheets/${pcsJsId}/complete`, { completedFrames: 10 });
  check(pcsCompleted.status === 'completed', 'pcs jobsheet: complete via the frames path unaffected', pcsCompleted);

  // --- Hold a meter order with an ongoing jobsheet ---
  const holdOrderObj = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 100 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [holdOrderObj.id] });
  const holdGen = await ok('jemish', 'POST', `/orders/${holdOrderObj.id}/jobsheets/generate`, { meters: 40, metersPerJobsheet: 40, sections: 3, machineIds });
  const holdJsId = holdGen.created[0].id;
  await ok('jemish', 'POST', `/orders/${holdOrderObj.id}/jobsheets/send`, { jobsheetIds: [holdJsId] });
  await ok('supervisor', 'POST', `/jobsheets/${holdJsId}/start`, { machineId: machineIds[0] });
  const held = await ok('jemish', 'POST', `/orders/${holdOrderObj.id}/hold`, { note: 'testing', ongoing: [{ jobsheetId: holdJsId, completedMeters: 15 }] });
  check(held.completed === 1 && held.created[0]?.meters === 25, 'meter order hold: 15 completed, 25 m remaining jobsheet created', held);
  await ok('jemish', 'POST', `/orders/${holdOrderObj.id}/release`);

  // --- Close a meter order with an ongoing jobsheet ---
  const closeOrderObj = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 60 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [closeOrderObj.id] });
  const closeGen = await ok('jemish', 'POST', `/orders/${closeOrderObj.id}/jobsheets/generate`, { meters: 20, metersPerJobsheet: 20, sections: 3, machineIds });
  const closeJsId = closeGen.created[0].id;
  await ok('jemish', 'POST', `/orders/${closeOrderObj.id}/jobsheets/send`, { jobsheetIds: [closeJsId] });
  await ok('supervisor', 'POST', `/jobsheets/${closeJsId}/start`, { machineId: machineIds[0] });
  const closePrev = await ok('jemish', 'GET', `/orders/${closeOrderObj.id}/close-preview`);
  check(closePrev.ongoing[0]?.meters === 20 && closePrev.ongoing[0]?.frames === 0, 'meter order close-preview: ongoing jobsheet carries meters, frames=0 sentinel', closePrev);
  const closed = await ok('jemish', 'POST', `/orders/${closeOrderObj.id}/close`, { note: 'testing close', ongoing: [{ jobsheetId: closeJsId, completedMeters: 20 }] });
  check(closed.completed === 1, 'meter order closed: ongoing jobsheet completed via metres', closed);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 19 checks (so far) passed');
process.exit(failed ? 1 : 0);
