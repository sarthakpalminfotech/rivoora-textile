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
// A per-run unique seed so hand-picked weaver/taka numbers don't collide when the script is run again.
const run = Date.now() % 1000000;

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
  // `meters` here is the order's CLOTH-metres target (mirrors `pieces`), not loom metres directly: 90 cloth m ÷ 3
  // sections = 30 loom m needed, one jobsheet of exactly that (metersPerJobsheet=30 as a loom-metres cap).
  const order = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 300 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [order.id] });
  const gen = await ok('jemish', 'POST', `/orders/${order.id}/jobsheets/generate`, { meters: 90, metersPerJobsheet: 30, sections: 3, machineIds });
  check(gen.created[0].meters === 30, 'meter order: generate — 90 cloth m ÷ 3 sections = 30 loom m jobsheet', gen);
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
  const holdGen = await ok('jemish', 'POST', `/orders/${holdOrderObj.id}/jobsheets/generate`, { meters: 120, metersPerJobsheet: 40, sections: 3, machineIds });
  const holdJsId = holdGen.created[0].id;
  await ok('jemish', 'POST', `/orders/${holdOrderObj.id}/jobsheets/send`, { jobsheetIds: [holdJsId] });
  await ok('supervisor', 'POST', `/jobsheets/${holdJsId}/start`, { machineId: machineIds[0] });
  const held = await ok('jemish', 'POST', `/orders/${holdOrderObj.id}/hold`, { note: 'testing', ongoing: [{ jobsheetId: holdJsId, completedMeters: 15 }] });
  check(held.completed === 1 && held.created[0]?.meters === 25, 'meter order hold: 15 completed, 25 m remaining jobsheet created', held);
  await ok('jemish', 'POST', `/orders/${holdOrderObj.id}/release`);

  // --- Close a meter order with an ongoing jobsheet ---
  const closeOrderObj = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 60 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [closeOrderObj.id] });
  const closeGen = await ok('jemish', 'POST', `/orders/${closeOrderObj.id}/jobsheets/generate`, { meters: 60, metersPerJobsheet: 20, sections: 3, machineIds });
  const closeJsId = closeGen.created[0].id;
  await ok('jemish', 'POST', `/orders/${closeOrderObj.id}/jobsheets/send`, { jobsheetIds: [closeJsId] });
  await ok('supervisor', 'POST', `/jobsheets/${closeJsId}/start`, { machineId: machineIds[0] });
  const closePrev = await ok('jemish', 'GET', `/orders/${closeOrderObj.id}/close-preview`);
  check(closePrev.ongoing[0]?.meters === 20 && closePrev.ongoing[0]?.frames === 0, 'meter order close-preview: ongoing jobsheet carries meters, frames=0 sentinel', closePrev);
  const closed = await ok('jemish', 'POST', `/orders/${closeOrderObj.id}/close`, { note: 'testing close', ongoing: [{ jobsheetId: closeJsId, completedMeters: 20 }] });
  check(closed.completed === 1, 'meter order closed: ongoing jobsheet completed via metres', closed);
}

/* ============================================================ Phase 7: taka entry, edit takas, outside/FG receipts (meters) */

{
  // --- Taka entry (meters-only rows; pcs omitted; damage requires metres, bound by the taka's own metres) ---
  const order = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 90 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [order.id] });
  const gen = await ok('jemish', 'POST', `/orders/${order.id}/jobsheets/generate`, { meters: 90, metersPerJobsheet: 90, sections: 3, machineIds });
  const jsId = gen.created[0].id;

  const entered = await ok('taka', 'POST', `/jobsheets/${jsId}/takas`, { takas: [{ meters: 15 }, { meters: 15 }], note: '' });
  check(entered.autoCompleted === true, 'meter order: taka entry auto-completes the jobsheet', entered);
  check(entered.added.every((t) => t.meters !== null && t.pcs === null), 'meter order: entered takas carry meters, not pcs', entered.added);
  const jsDetail = await ok('jemish', 'GET', `/jobsheets/${jsId}`);
  check(jsDetail.completedMeters === jsDetail.meters, 'meter order: completedMeters = assigned meters at auto-complete', jsDetail);

  const missingQty = await call('taka', 'POST', `/jobsheets/${jsId}/takas`, { takas: [{}], note: '' });
  check(missingQty.status === 400, 'meter order: taka entry rejects a row with neither pcs nor metres', missingQty);

  const damaged = await ok('taka', 'POST', `/jobsheets/${jsId}/takas`, { takas: [{ meters: 20, damages: [{ type: 'machine', otherName: 'Hole S19', meters: 5 }] }], note: '' });
  check(damaged.added[0].damages[0].meters === 5 && damaged.added[0].damages[0].pcs === null, 'meter order: damage carries metres, not pcs', damaged.added[0]);
  const tooBig = await call('taka', 'POST', `/jobsheets/${jsId}/takas`, { takas: [{ meters: 10, damages: [{ type: 'machine', otherName: 'Hole S19 big', meters: 20 }] }], note: '' });
  check(tooBig.status === 400, "meter order: damage metres can't exceed the taka's metres", tooBig);
  const noDamageQty = await call('taka', 'POST', `/jobsheets/${jsId}/takas`, { takas: [{ meters: 10, damages: [{ type: 'machine', otherName: 'Hole S19 no qty' }] }], note: '' });
  check(noDamageQty.status === 400, 'meter order: a new damage without metres is rejected', noDamageQty);

  // --- Edit takas (Jenish): metres required, pcs stays null ---
  const group = (await ok('jemish', 'GET', `/orders/${order.id}/takas`)).groups.find((g) => g.jobsheetId === jsId);
  const firstTaka = group.takas[0];
  const editOk = await ok('jemish', 'PUT', `/jobsheets/${jsId}/takas`, {
    takas: group.takas.map((t) => ({ id: t.id, takaNo: t.takaNo, meters: t.id === firstTaka.id ? 25 : t.meters, pcs: null, damages: [] })),
    note: '',
  });
  check(editOk.changed >= 1, 'meter order: edit takas changes a metres value', editOk);
  const editMissing = await call('jemish', 'PUT', `/jobsheets/${jsId}/takas`, {
    takas: [{ id: firstTaka.id, takaNo: firstTaka.takaNo, meters: null, pcs: null, damages: [] }],
    note: '',
  });
  check(editMissing.status === 400, 'meter order: edit takas rejects clearing metres on a changed row', editMissing);

  // --- pcs order regression: taka entry + edit takas completely unaffected ---
  const pcsOrder = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'pcs', orderType: 'pcs_to_pcs', quantity: 30 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [pcsOrder.id] });
  const pcsGen = await ok('jemish', 'POST', `/orders/${pcsOrder.id}/jobsheets/generate`, { pieces: 30, framesPerJobsheet: 10, sections: 3, machineIds });
  const pcsJsId = pcsGen.created[0].id;
  const pcsEntered = await ok('taka', 'POST', `/jobsheets/${pcsJsId}/takas`, { takas: [{ pcs: 15 }, { pcs: 15 }], note: '' });
  check(pcsEntered.added.every((t) => t.pcs !== null && t.meters === null), 'pcs order: taka entry unaffected (pcs carried, no meters)', pcsEntered.added);
  const pcsMissingPcs = await call('taka', 'POST', `/jobsheets/${pcsJsId}/takas`, { takas: [{}], note: '' });
  check(pcsMissingPcs.status === 400, 'pcs order: taka entry still rejects a row with no pcs', pcsMissingPcs);
  const pcsGroup = (await ok('jemish', 'GET', `/orders/${pcsOrder.id}/takas`)).groups.find((g) => g.jobsheetId === pcsJsId);
  const pcsEditOk = await ok('jemish', 'PUT', `/jobsheets/${pcsJsId}/takas`, {
    takas: pcsGroup.takas.map((t) => ({ id: t.id, takaNo: t.takaNo, pcs: t.id === pcsGroup.takas[0].id ? 18 : t.pcs, meters: null, damages: [] })),
    note: '',
  });
  check(pcsEditOk.changed >= 1, 'pcs order: edit takas still works on pcs', pcsEditOk);

  // --- Outside PO receipt (meters): the PO is forced to unit "meters"; receipt rows carry meters only ---
  const outsideOrder = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 200 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [outsideOrder.id] });
  const weaver = await ok('jemish', 'POST', '/weavers', { name: `S19 Test Weaver ${Date.now()}`, shortCode: weaverCode() });
  const poRejected = await call('jemish', 'POST', `/orders/${outsideOrder.id}/outside-pos`, {
    weaverId: weaver.id, materialId: material.id, quantity: 100, unit: 'pcs', orderType: 'lump', poDate: today, notes: '',
  });
  check(poRejected.status === 400, 'meter order: a PO in pcs is rejected', poRejected);
  const po = await ok('jemish', 'POST', `/orders/${outsideOrder.id}/outside-pos`, {
    weaverId: weaver.id, materialId: material.id, quantity: 100, unit: 'meters', orderType: 'lump', poDate: today, notes: '',
  });
  check(po.unit === 'meters', 'meter order: PO created in metres', po);

  const receiptRejected = await call('jemish', 'POST', `/outside-pos/${po.id}/receipts`, {
    challanNo: 'S19-C1', date: today, notes: null, rows: [{ weaverTakaNo: `${run}01`, ourTakaNo: null, damages: [] }],
  });
  check(receiptRejected.status === 400, 'meter order: receipt row without metres is rejected', receiptRejected);
  const receipt = await ok('jemish', 'POST', `/outside-pos/${po.id}/receipts`, {
    challanNo: 'S19-C2', date: today, notes: null,
    rows: [{ weaverTakaNo: `${run}02`, ourTakaNo: null, meters: 40, damages: [{ type: 'weaver', otherName: 'S19 weaver cut', meters: 5, images: [] }] }],
  });
  check(receipt.meters === 40 && receipt.pcs === 0, 'meter order: receipt carries meters, not pcs', receipt);
  check(receipt.takas[0].pcs === null, 'meter order: received taka has no pcs', receipt.takas[0]);
  const poAfter = await ok('jemish', 'GET', `/outside-pos/${po.id}`);
  check(poAfter.receivedQty === 40, 'meter order: PO receivedQty tracks the metres received', poAfter);

  // --- FG lump receipt (meters) ---
  const fgOrder = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 80, hasProduction: false, hasButta: false, hasMill: false }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [fgOrder.id] });
  const fgReceipt = await ok('jemish', 'POST', `/orders/${fgOrder.id}/fg-receipts`, {
    challanNo: 'S19-F1', date: today, supplierName: 'S19 Test Supplier', notes: null,
    rows: [{ weaverTakaNo: `${run}03`, ourTakaNo: null, meters: 25, damages: [] }],
  });
  check(fgReceipt.meters === 25 && fgReceipt.pcs === 0, 'FG meter purchase: receipt carries meters, not pcs', fgReceipt);

  // --- pcs order regression: outside PO + FG receipt completely unaffected ---
  const pcsOutside = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'pcs', orderType: 'lump', quantity: 100 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [pcsOutside.id] });
  const pcsPo = await ok('jemish', 'POST', `/orders/${pcsOutside.id}/outside-pos`, {
    weaverId: weaver.id, materialId: material.id, quantity: 50, unit: 'pcs', orderType: 'lump', poDate: today, notes: '',
  });
  check(pcsPo.unit === 'pcs', 'pcs order: PO still created in pcs (unaffected)', pcsPo);
  const pcsReceipt = await ok('jemish', 'POST', `/outside-pos/${pcsPo.id}/receipts`, {
    challanNo: 'S19-P1', date: today, notes: null, rows: [{ weaverTakaNo: `${run}04`, ourTakaNo: null, pcs: 20, damages: [] }],
  });
  check(pcsReceipt.pcs === 20, 'pcs order: outside receipt unaffected (pcs carried)', pcsReceipt);
}

/* ============================================================ Phase 8 (QC slice): Butta QC / Mill QC in meters */

{
  const party = async (kind) => (await ok('jemish', 'POST', `/${kind}-parties`, { name: `S19 ${kind} ${Date.now()} ${Math.random()}` })).id;

  // --- Meter order through Butta QC: partial resolve, full resolve, a new metres damage ---
  const order = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'meters', orderType: 'lump', quantity: 90 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [order.id] });
  const gen = await ok('jemish', 'POST', `/orders/${order.id}/jobsheets/generate`, { meters: 90, metersPerJobsheet: 90, sections: 3, machineIds });
  const jsId = gen.created[0].id;
  const entered = await ok('taka', 'POST', `/jobsheets/${jsId}/takas`, {
    takas: [{ meters: 30, damages: [{ type: 'machine', otherName: 'S19 QC hole', meters: 10 }] }],
    note: '',
  });
  const takaId = entered.added[0].id;
  const damageId = entered.added[0].damages[0].id;

  await ok('godown', 'POST', '/butta/challans', { takaIds: [takaId], partyId: await party('butta'), challanDate: today });
  await ok('godown', 'POST', '/butta/receive', { takaIds: [takaId] });

  // One Butta QC visit: partially resolve the existing damage (4 of 10 m, stays open) AND add a new one (3 m).
  const buttaQc = await ok('qc', 'POST', `/butta-qc/${takaId}`, {
    damageDecisions: [{ takaDamageId: damageId, resolvedMeters: 4 }],
    newDamages: [{ type: 'butta', otherName: 'S19 QC new', meters: 3, images: [] }],
  });
  check(buttaQc.resolved === 0 && buttaQc.kept === 1 && buttaQc.added === 1, 'meter order: Butta QC partial resolve (4 of 10 m) + a new metres damage', buttaQc);
  const afterButta = await ok('jemish', 'GET', `/takas/${takaId}`);
  const d1 = afterButta.damages.find((d) => d.id === damageId);
  check(d1.resolvedMeters === 4 && d1.status === 'open', 'meter order: original damage stays open with 4 m resolved', d1);
  const newDamage = afterButta.damages.find((d) => d.id !== damageId);
  check(newDamage.meters === 3 && newDamage.pcs === null, 'meter order: new Butta damage carries metres, not pcs', newDamage);

  // --- Mill QC: metres bound check, then resolve both remaining open damages (6 m + 3 m) → Fresh ---
  const millCh = await ok('godown', 'POST', '/mill/challans', { takaIds: [takaId], partyId: await party('mill'), challanDate: today });
  await ok('godown', 'POST', `/mill/challans/${millCh.challanId}/received-count`, { count: 1 });
  const tooBig = await call('qc', 'POST', `/mill-qc/${takaId}`, {
    damageDecisions: [
      { takaDamageId: damageId, resolvedMeters: 6 },
      { takaDamageId: newDamage.id, resolvedMeters: 3 },
    ],
    newDamages: [{ type: 'mill', otherName: 'S19 too big', meters: 999, images: [] }],
    result: 'final',
  });
  check(tooBig.status === 400, "meter order: Mill QC rejects a new damage bigger than the taka's metres", tooBig);
  const millDone = await ok('qc', 'POST', `/mill-qc/${takaId}`, {
    damageDecisions: [
      { takaDamageId: damageId, resolvedMeters: 6 },
      { takaDamageId: newDamage.id, resolvedMeters: 3 },
    ],
    newDamages: [],
    result: 'final',
  });
  check(millDone.resolved === 2 && millDone.fresh === true, 'meter order: Mill QC resolves both remaining metres damages → Fresh', millDone);

  // --- pcs order regression: Butta QC completely unaffected ---
  const pcsOrder = await ok('jemish', 'POST', '/orders', baseOrder({ unit: 'pcs', orderType: 'pcs_to_pcs', quantity: 30 }));
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [pcsOrder.id] });
  const pcsGen = await ok('jemish', 'POST', `/orders/${pcsOrder.id}/jobsheets/generate`, { pieces: 30, framesPerJobsheet: 10, sections: 3, machineIds });
  const pcsJsId = pcsGen.created[0].id;
  const pcsEntered = await ok('taka', 'POST', `/jobsheets/${pcsJsId}/takas`, { takas: [{ pcs: 15, damages: [{ type: 'machine', otherName: 'S19 pcs hole', pcs: 5 }] }], note: '' });
  const pcsTakaId = pcsEntered.added[0].id;
  const pcsDamageId = pcsEntered.added[0].damages[0].id;
  await ok('godown', 'POST', '/butta/challans', { takaIds: [pcsTakaId], partyId: await party('butta'), challanDate: today });
  await ok('godown', 'POST', '/butta/receive', { takaIds: [pcsTakaId] });
  const pcsQc = await ok('qc', 'POST', `/butta-qc/${pcsTakaId}`, { damageDecisions: [{ takaDamageId: pcsDamageId, resolvedPcs: 5 }], newDamages: [] });
  check(pcsQc.resolved === 1, 'pcs order: Butta QC resolve unaffected (pcs)', pcsQc);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 19 checks (so far) passed');
process.exit(failed ? 1 : 0);
