/**
 * Sprint 18 API flow check against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint18.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) It builds its own designs and orders, so it can
 * run many times. Covers: the design library by quality (groups, required qualities, Upload many all-or-nothing, the
 * new design from an order, previous designs, permissions incl. Dhruvil view-only), old v- inventory links, sections per
 * beam (generate / single / edit / change machine / hold remaining + live numbers + dashboard), Outside order, and the
 * §6 goods-return end-to-end check (lump + pcs to pcs → revision, free stock, add from free stock, Returned, prints,
 * Docs, Dispatched, inventory). Stage moves that need physical steps (butta / mill / godown) are set in the file DB.
 */
import { createClient } from '@libsql/client';

const base = process.argv[2] ?? 'http://localhost:4100';
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl?.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database.');
  process.exit(2);
}
const db = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN ?? 'x' });
let failed = 0;
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!ok) failed += 1;
};

async function login(phone, password) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) });
  if (!res.ok) throw new Error(`login ${phone} failed: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}
const sessions = {
  jemish: await login('9999999999', 'Rivoora@999'),
  gaurang: await login('8888888888', 'Rivoora@888'),
  supervisor: await login('7777777777', 'Rivoora@777'),
  taka: await login('6666666666', 'Rivoora@666'),
  dhruvil: await login('3333333333', 'Rivoora@333'),
};
async function call(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Cookie: sessions[who], 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const sql = async (q, args = []) => (await db.execute({ sql: q, args })).rows;
const run = Date.now().toString(36).toUpperCase().slice(-5);

// ---------------------------------------------------------------- fixtures
const customers = await ok('jemish', 'GET', '/lookup/customers');
const customer = customers[0];
const materials = await ok('jemish', 'GET', '/lookup/materials');
const [m1, m2] = materials;
const machineIds = (await ok('jemish', 'GET', '/lookup/machines')).slice(0, 2).map((m) => m.id);
check(!!customer && !!m1 && !!m2 && machineIds.length === 2, 'fixtures: customer, two qualities, machines');
const img = { imageUrl: '/uploads/demo/d101.webp', thumbUrl: '/uploads/demo/d101-thumb.webp' };

// ---------------------------------------------------------------- §1 design library
const noQuality = await call('jemish', 'POST', '/designs', { code: `S18A${run}`, buttaCutting: true, ...img });
check(noQuality.status === 400 && noQuality.body?.error?.field === 'materialIds', 'a new design needs at least one quality', noQuality.body);
const d1 = await ok('jemish', 'POST', '/designs', { code: `S18A${run}`, name: 'Two qualities', buttaCutting: false, materialIds: [m1.id, m2.id], ...img });
check(d1.qualities.length === 2 && !('variations' in d1), 'design with two qualities, no variations', d1);
const groups = await ok('jemish', 'GET', '/designs/qualities?designs=60');
const g1 = groups.find((g) => g.materialId === m1.id);
const g2 = groups.find((g) => g.materialId === m2.id);
check(g1?.designs.some((d) => d.id === d1.id) && g2?.designs.some((d) => d.id === d1.id), 'a design in two qualities appears under each group');
check(groups.findIndex((g) => g.materialId === null) === -1 || groups.at(-1).materialId === null, '"No quality" group (if any) comes last');
const byQuality = await ok('jemish', 'GET', `/designs?quality=${m2.id}&search=S18A${run}`);
check(byQuality.items.length === 1 && byQuality.items[0].qualities.length === 2, '/designs?quality= lists the design with its qualities');
const qSearch = await ok('jemish', 'GET', `/designs/qualities?qualitySearch=${encodeURIComponent(m1.name.slice(0, 3))}&designs=0`);
check(qSearch.every((g) => g.name.toLowerCase().includes(m1.name.slice(0, 3).toLowerCase()) || g.materialId === null), 'quality search filters groups by name');

// Upload many: all or nothing
const bulkBad = await call('jemish', 'POST', '/designs/bulk', {
  designs: [
    { code: `S18B${run}`, materialIds: [m1.id], buttaCutting: true, ...img },
    { code: `S18A${run}`, materialIds: [m1.id], buttaCutting: true, ...img },
  ],
});
check(bulkBad.status === 409 && bulkBad.body?.error?.field === 'designs.1.code', 'bulk: a used code is reported on its row', bulkBad.body);
check((await sql('SELECT COUNT(*) n FROM designs WHERE code = ?', [`S18B${run}`]))[0].n === 0, 'bulk: nothing saved when one row fails');
const bulkDupe = await call('jemish', 'POST', '/designs/bulk', {
  designs: [
    { code: `S18C${run}`, materialIds: [m1.id], buttaCutting: true, ...img },
    { code: `s18c${run}`, materialIds: [m1.id], buttaCutting: true, ...img },
  ],
});
check(bulkDupe.status === 400 && bulkDupe.body?.error?.field === 'designs.1.code', 'bulk: a code twice on the page is rejected', bulkDupe.body);
const bulk = await ok('gaurang', 'POST', '/designs/bulk', {
  designs: [1, 2, 3].map((i) => ({ code: `S18D${run}${i}`, name: i === 1 ? 'Bulk one' : null, materialIds: [m2.id], buttaCutting: i !== 2, ...img })),
});
check(bulk.created.length === 3, 'bulk: 3 designs saved in one request (Gaurang manages designs)', bulk);
const checkCodes = await ok('jemish', 'GET', `/designs/check-codes?codes=S18D${run}1,NEW${run}`);
check(checkCodes.taken.length === 1 && checkCodes.taken[0] === `S18D${run}1`, 'check-codes reports only used codes', checkCodes);

// permissions
const dRead = await call('dhruvil', 'GET', '/designs/qualities');
const dDesign = await call('dhruvil', 'GET', `/designs/${d1.id}`);
const dWrite = await call('dhruvil', 'PUT', `/designs/${d1.id}`, { code: d1.code, materialIds: [m1.id], buttaCutting: true });
const dBulk = await call('dhruvil', 'POST', '/designs/bulk', { designs: [{ code: `X${run}`, materialIds: [m1.id], buttaCutting: true, ...img }] });
const dDelete = await call('dhruvil', 'DELETE', `/designs/${d1.id}`);
check(dRead.status === 200 && dDesign.status === 200, 'Dhruvil reads the design library');
check(dWrite.status === 403 && dBulk.status === 403 && dDelete.status === 403, 'Dhruvil cannot add / edit / delete / upload', [dWrite.status, dBulk.status, dDelete.status]);
check((await call('supervisor', 'GET', '/designs')).status === 403, 'the supervisor has no design library');
const edited = await ok('jemish', 'PUT', `/designs/${d1.id}`, { code: d1.code, name: 'Edited', buttaCutting: false, materialIds: [m2.id] });
check(edited.qualities.length === 1 && edited.qualities[0].id === m2.id, 'editing replaces the qualities');

// an order that uploads a new design → the design gets the order's quality
const newDesignOrder = await ok('jemish', 'POST', '/orders', {
  customerId: customer.id, orderType: 'lump', materialId: m1.id, quantity: 10, unit: 'pcs', orderDate: '2026-10-26',
  newDesign: { code: `S18N${run}`, buttaCutting: true, ...img },
});
const nd = (await sql('SELECT d.id, dq.material_id FROM orders o JOIN designs d ON d.id = o.design_id JOIN design_qualities dq ON dq.design_id = d.id WHERE o.id = ?', [newDesignOrder.id]));
check(nd.length === 1 && Number(nd[0].material_id) === m1.id, 'a design uploaded on an order gets the order quality', nd);
const prev = await ok('jemish', 'GET', `/customers/${customer.id}/previous-designs`);
const prevRow = prev.find((p) => p.code === `S18N${run}`);
check(prevRow && prevRow.qualities.length === 1 && !('variationId' in prevRow), 'previous designs carry qualities, no variation', prevRow);

// old v- inventory links resolve through the map
const [{ id: vDesignId }] = await sql('SELECT id FROM designs WHERE code = ?', [`S18D${run}1`]);
await sql(`INSERT INTO design_variations (design_id, variation_no, code) VALUES (?, 99, ?)`, [d1.id, `OLDV${run}`]);
const [{ id: variationId }] = await sql('SELECT id FROM design_variations WHERE code = ?', [`OLDV${run}`]);
await sql('INSERT INTO design_variation_map (variation_id, new_design_id) VALUES (?, ?)', [variationId, vDesignId]);
const legacy = await ok('jemish', 'GET', `/inventory/items/v-${variationId}`);
check(legacy.key === `d-${vDesignId}` && legacy.code === `S18D${run}1`, 'old v-<id> item link answers as the design it became', legacy.key);
check((await call('jemish', 'GET', '/inventory/items/v-999999')).status === 404, 'unknown v- link → 404');

// ---------------------------------------------------------------- §5 outside order
const missingParty = await call('jemish', 'POST', '/orders', {
  customerId: customer.id, orderType: 'lump', materialId: m1.id, designId: d1.id, quantity: 10, unit: 'pcs', orderDate: '2026-10-26', isOutsideOrder: true,
});
check(missingParty.status === 400 && missingParty.body?.error?.field === 'outsidePartyName', 'Outside order needs a party name', missingParty.body);
const outside = await ok('jemish', 'POST', '/orders', {
  customerId: customer.id, orderType: 'lump', materialId: m1.id, designId: d1.id, quantity: 12, unit: 'pcs', orderDate: '2026-10-26',
  isOutsideOrder: true, outsidePartyName: `Shree ${run}`,
});
const outsideDetail = await ok('jemish', 'GET', `/orders/${outside.id}`);
check(outsideDetail.isOutsideOrder && outsideDetail.outsidePartyName === `Shree ${run}`, 'Outside order saved with the party');
const listYes = await ok('jemish', 'GET', '/orders?outside=yes&limit=100');
const listNo = await ok('jemish', 'GET', '/orders?outside=no&limit=100');
check(listYes.items.some((o) => o.id === outside.id) && listYes.items.every((o) => o.isOutsideOrder), 'filter outside=yes');
check(!listNo.items.some((o) => o.id === outside.id), 'filter outside=no leaves it out');
const bySearch = await ok('jemish', 'GET', `/orders?search=${encodeURIComponent(`Shree ${run}`)}`);
check(bySearch.items.length === 1 && bySearch.items[0].id === outside.id, 'search by the outside party name');
const editedOut = await ok('jemish', 'PUT', `/orders/${outside.id}`, {
  customerId: customer.id, orderType: 'lump', materialId: m1.id, designId: d1.id, quantity: 12, unit: 'pcs', orderDate: '2026-10-26', isOutsideOrder: false, outsidePartyName: 'ignored',
});
check(!editedOut.isOutsideOrder && editedOut.outsidePartyName === null, 'unticking clears the party name');

// ---------------------------------------------------------------- §3 sections per beam
const S = await ok('jemish', 'POST', '/orders', {
  customerId: customer.id, orderType: 'pcs_to_pcs', materialId: m2.id, designId: d1.id, quantity: 300, unit: 'pcs', orderDate: '2026-10-26',
});
await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [S.id] });
const badSections = await call('jemish', 'POST', `/orders/${S.id}/jobsheets/generate`, { pieces: 150, framesPerJobsheet: 25, sections: 13, machineIds });
check(badSections.status === 400, 'sections must be 1–12');
await ok('jemish', 'POST', `/orders/${S.id}/jobsheets/generate`, { pieces: 150, framesPerJobsheet: 25, machineIds }); // default 3 → 50 frames
const run4 = await ok('jemish', 'POST', `/orders/${S.id}/jobsheets/generate`, { pieces: 152, framesPerJobsheet: 19, sections: 4, machineIds }); // 38 frames
check(run4.created.length === 2 && run4.created.every((c) => c.frames === 19), '152 pcs ÷ 4 sections = 38 frames → 2 × 19', run4.created);
let sList = await ok('jemish', 'GET', `/orders/${S.id}/jobsheets`);
check(sList.jobsheets.filter((j) => j.sections === 3).length === 2 && sList.jobsheets.filter((j) => j.sections === 4).length === 2, 'each jobsheet stores its own sections');
check(sList.coverage.jobsheetPieces === 302 && sList.coverage.sections === 4 && sList.coverage.targetFrames === 75 && sList.warnings.length === 0, 'mixed 3 / 4 sections: 302 pcs, frames needed at 4, no warnings', sList.coverage);
const sDetail = await ok('jemish', 'GET', `/orders/${S.id}`);
check(sDetail.jobsheetPieces === 302, 'order detail jobsheet quantity uses each jobsheet’s sections', sDetail.jobsheetPieces);
const single = await ok('jemish', 'POST', `/orders/${S.id}/jobsheets`, { frames: 2, sections: 5, machineIds });
sList = await ok('jemish', 'GET', `/orders/${S.id}/jobsheets`);
check(sList.coverage.jobsheetPieces === 312 && sList.coverage.sections === 5 && sList.warnings.some((w) => w.kind === 'pieces_more'), 'single add with 5 sections: 312 pcs and a "more" warning', sList.coverage);
const singleId = single.created[0].id;
const editSections = await ok('jemish', 'PUT', `/jobsheets/${singleId}`, { frames: 2, sections: 3, machineIds });
check(editSections.detailsChanged && editSections.coverage.jobsheetPieces === 308, 'edit: sections changed while Pending (310→ 302 + 6 = 308)', editSections.coverage);
await ok('jemish', 'DELETE', `/jobsheets/${singleId}`);
// edit with auto-adjust: the new jobsheet copies the last one's sections
const fours = sList.jobsheets.filter((j) => j.sections === 4).sort((a, b) => a.jobsheetNo - b.jobsheetNo);
const adjust = await ok('jemish', 'PUT', `/jobsheets/${fours[0].id}`, { frames: 10, machineIds });
// 19 → 10 on the first of the 4-section run: the last pending one would become 28 > 19 frames per jobsheet, so it stays
// at 19 and a new 9-frame jobsheet is created — with the last one's 4 sections.
check(adjust.created.length === 1 && adjust.created[0].frames === 9, 'edit: auto-adjust creates the remainder jobsheet', adjust);
const adjRow = (await sql('SELECT sections FROM jobsheets WHERE id = ?', [adjust.created[0]?.id ?? 0]))[0];
check(Number(adjRow?.sections) === 4, 'edit: the auto-adjust jobsheet copies the last jobsheet’s sections', adjRow);
check(adjust.coverage.jobsheetPieces === 302 && adjust.warnings.length === 0, 'edit keeps the pcs (frames moved, same sections)', adjust.coverage);
const dash = await ok('jemish', 'GET', `/orders/${S.id}/dashboard`);
check(dash.barTotalPcs === adjust.coverage.jobsheetPieces, 'dashboard bar uses each jobsheet’s sections', [dash.barTotalPcs, adjust.coverage.jobsheetPieces]);
// change machine + hold remaining keep the sections
sList = await ok('jemish', 'GET', `/orders/${S.id}/jobsheets`);
const four = sList.jobsheets.find((j) => j.sections === 4);
const three = sList.jobsheets.find((j) => j.sections === 3);
await ok('jemish', 'POST', `/orders/${S.id}/jobsheets/send`, { jobsheetIds: [four.id, three.id] });
await ok('supervisor', 'POST', `/jobsheets/${four.id}/start`, { machineId: four.machines[0].id });
const cm = await ok('supervisor', 'POST', `/jobsheets/${four.id}/change-machine`, { completedFrames: 4, nextFrames: four.frames - 4 });
const cmRow = (await sql('SELECT sections FROM jobsheets WHERE id = ?', [cm.created.id]))[0];
check(Number(cmRow.sections) === 4, 'change machine: the new jobsheet keeps 4 sections', cmRow);
await ok('supervisor', 'POST', `/jobsheets/${three.id}/start`, { machineId: three.machines[0].id });
const held = await ok('jemish', 'POST', `/orders/${S.id}/hold`, { ongoing: [{ jobsheetId: three.id, completedFrames: 5 }] });
const heldRow = (await sql('SELECT sections FROM jobsheets WHERE parent_jobsheet_id = ? AND is_deleted = 0', [three.id]))[0];
check(held && Number(heldRow?.sections) === 3, 'hold: the remaining-frames jobsheet keeps its 3 sections', heldRow);
await ok('jemish', 'POST', `/orders/${S.id}/release`, {});
const print = await ok('jemish', 'GET', `/jobsheets/print?ids=${cm.created.id}`);
check(print[0].sections === 4, 'jobsheet print carries the sections', print[0]);
const jsDetail = await ok('taka', 'GET', `/jobsheets/${cm.created.id}`);
check(jsDetail.sections === 4, 'taka entry sees the jobsheet’s sections (pcs warning = frames × 4)');

// ---------------------------------------------------------------- §6 goods return end to end
console.log('-- goods return (lump)');
const lumpOrder = async () => {
  const o = await ok('jemish', 'POST', '/orders', {
    customerId: customer.id, orderType: 'lump', materialId: m2.id, designId: d1.id, quantity: 60, unit: 'pcs', orderDate: '2026-10-26',
  });
  await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [o.id] });
  await ok('jemish', 'POST', `/orders/${o.id}/jobsheets/generate`, { pieces: 60, framesPerJobsheet: 20, machineIds });
  const js = (await ok('jemish', 'GET', `/orders/${o.id}/jobsheets`)).jobsheets[0];
  return { ...o, jsId: js.id };
};
const A = await lumpOrder();
const B = await lumpOrder();
const entered = await ok('taka', 'POST', `/jobsheets/${A.jsId}/takas`, { takas: Array.from({ length: 5 }, () => ({ pcs: 12, meters: 110 })) });
const aTakas = entered.added;
await sql(`UPDATE takas SET stage = 'ready_dispatch', has_been_to_mill = 1, godown_checked_at = '2026-10-26' WHERE jobsheet_id = ?`, [A.jsId]);
const disp = await ok('dhruvil', 'POST', `/godown/orders/${A.id}/dispatch`, { challanDate: '2026-10-26' });
const dc = await ok('dhruvil', 'GET', `/dispatch/challans/${disp.challanId}`);
check(dc.label === `DC-${dc.challanNo}` && dc.totals.takas === 5, 'dispatch challan DC-n with 5 takas', dc.label);
const damages = await ok('jemish', 'GET', '/lookup/damages');
const returned = aTakas.slice(0, 3).map((t) => t.id);
const gr = await ok('dhruvil', 'POST', `/dispatch/challans/${disp.challanId}/goods-return`, {
  returns: [
    { takaId: returned[0] },
    { takaId: returned[1] },
    { takaId: returned[2], damages: [damages[0] ? { type: 'mill', damageId: damages[0].id, pcs: 3 } : { type: 'mill', otherName: 'Hole', pcs: 3 }] },
  ],
  date: '2026-10-27',
  note: 'S18 GR check',
});
check(gr.returnedTakas === 3 && gr.label === `DC-${dc.challanNo} R1`, 'GR of 3 takas → DC-n R1', gr);
const r1 = await ok('dhruvil', 'GET', `/dispatch/challans/${gr.challanId}`);
const oldRev = await ok('dhruvil', 'GET', `/dispatch/challans/${disp.challanId}`);
check(r1.totals.takas === 2 && !r1.takas.some((t) => returned.includes(t.takaId ?? t.id)) && oldRev.status === 'revised', 'R1 holds the 2 kept takas; DC-n is revised', { r1: r1.totals, old: oldRev.status });
const r1Print = await call('dhruvil', 'GET', `/dispatch/challans/${gr.challanId}/print`);
const oldPrint = await call('dhruvil', 'GET', `/dispatch/challans/${disp.challanId}/print`);
check(r1Print.status === 200 && oldPrint.status === 200, 'both revisions print');
const freeRows = await sql(`SELECT id, stage, is_free_stock, free_stock_reason, is_damaged FROM takas WHERE id IN (${returned.join(',')})`);
check(freeRows.every((r) => Number(r.is_free_stock) === 1 && r.stage === 'final' && r.free_stock_reason === 'goods_return'), '3 returned takas are free stock (final, reason goods_return)', freeRows);
check(freeRows.filter((r) => Number(r.is_damaged) === 1).length === 1, '1 of them is damaged');
const key = `d-${d1.id}`;
const item = await ok('jemish', 'GET', `/inventory/items/${key}`);
check(item.free.ready >= 36 && item.free.damaged >= 3, 'inventory: free stock ready pcs + damaged pcs of the design', item.free);
const damagedItem = await ok('jemish', 'GET', `/inventory/damaged/${key}`);
check(damagedItem.damaged >= 3, 'Inventory → Damaged shows the damaged returned taka', damagedItem.damaged);
const aDetail = await ok('jemish', 'GET', `/orders/${A.id}`);
check(aDetail.status === 'returned' && aDetail.returned?.takas === 3, 'order A → Returned with the returned summary', { status: aDetail.status, returned: aDetail.returned });
const docs = await ok('jemish', 'GET', `/orders/${A.id}/challans`);
const docLabels = docs.items.filter((d) => d.kind === 'delivery').map((d) => d.label);
check(docLabels.includes(`DC-${dc.challanNo}`) && docLabels.includes(`DC-${dc.challanNo} R1`), 'Docs tab lists DC-n and DC-n R1', docLabels);
const dispOrder = await ok('dhruvil', 'GET', `/dispatched/${A.id}`);
check(dispOrder.returned?.takas === 3 && dispOrder.challans.length === 2, 'Dispatched module shows both revisions + returned', { returned: dispOrder.returned, n: dispOrder.challans.length });
const history = aDetail.history.map((h) => h.toStatus);
check(history.includes('dispatched') && history.at(-1) === 'returned', 'history: dispatched → returned', history);
// add 2 fresh returned takas to order B (same design)
const fresh = freeRows.filter((r) => Number(r.is_damaged) === 0).map((r) => Number(r.id));
const added = await ok('dhruvil', 'POST', `/orders/${B.id}/takas/add-from-free-stock`, { takaIds: fresh });
const bTakas = await ok('jemish', 'GET', `/orders/${B.id}/takas`);
const bIds = bTakas.groups.flatMap((g) => g.takas.map((t) => t.id));
check(added && fresh.every((id) => bIds.includes(id)), 'Add from free stock: the 2 fresh takas now count for order B');
const afterAdd = await ok('jemish', 'GET', `/inventory/items/${key}/free-stock`);
check(!afterAdd.takas.some((t) => fresh.includes(t.id)) && afterAdd.takas.some((t) => t.id === returned[2]), 'free stock keeps only the damaged one');
// after the design migration: the returned takas still belong to the right design
const designOf = await sql(`SELECT DISTINCT o.design_id FROM takas t JOIN orders o ON o.id = t.order_id WHERE t.id IN (${returned.join(',')})`);
check(designOf.length === 1 && Number(designOf[0].design_id) === d1.id, 'returned takas map to the design (origin order) in inventory');

console.log('-- goods return (pcs to pcs)');
const C = await ok('jemish', 'POST', '/orders', {
  customerId: customer.id, orderType: 'pcs_to_pcs', materialId: m2.id, designId: d1.id, quantity: 60, unit: 'pcs', orderDate: '2026-10-26',
});
await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [C.id] });
await ok('jemish', 'POST', `/orders/${C.id}/jobsheets/generate`, { pieces: 60, framesPerJobsheet: 20, machineIds });
const cJs = (await ok('jemish', 'GET', `/orders/${C.id}/jobsheets`)).jobsheets[0];
await ok('taka', 'POST', `/jobsheets/${cJs.id}/takas`, { takas: Array.from({ length: 3 }, () => ({ pcs: 20, meters: 180 })) });
await sql(`UPDATE takas SET stage = 'ready_dispatch', has_been_to_mill = 1, godown_checked_at = '2026-10-26' WHERE jobsheet_id = ?`, [cJs.id]);
const cDisp = await ok('dhruvil', 'POST', `/godown/orders/${C.id}/dispatch`, { challanDate: '2026-10-26' });
const cDc = await ok('dhruvil', 'GET', `/dispatch/challans/${cDisp.challanId}`);
check(cDc.lines.length >= 1 && cDc.totals.pcs === 60, 'pcs-to-pcs challan: lines, 60 pcs', cDc.totals);
const freeBefore = (await ok('jemish', 'GET', `/inventory/items/${key}/free-stock`)).figures;
const cGr = await ok('dhruvil', 'POST', `/dispatch/challans/${cDisp.challanId}/goods-return`, {
  returnedPcs: 15, damagedPcs: 4, damage: { type: 'machine', otherName: `Stain ${run}`, pcs: 4 }, date: '2026-10-27',
});
check(cGr.returnedPcs === 15 && cGr.damagedPcs === 4 && cGr.label.endsWith('R1'), 'pcs GR: 15 returned (4 damaged) → R1', cGr);
const lot = (await sql(`SELECT id, pcs, actual_pcs, is_return_lot, is_free_stock, stage FROM takas WHERE is_return_lot = 1 AND order_id = ? AND is_deleted = 0`, [C.id]))[0];
check(lot && Number(lot.is_free_stock) === 1 && lot.stage === 'final' && Number(lot.actual_pcs ?? lot.pcs) === 15, 'return lot: 15 pcs, free stock, final', lot);
const freeAfter = (await ok('jemish', 'GET', `/inventory/items/${key}/free-stock`)).figures;
check(freeAfter.ready - freeBefore.ready === 15 && freeAfter.damaged - freeBefore.damaged === 4, 'free figures: +15 ready, +4 damaged', { freeBefore, freeAfter });
const cR1 = await ok('dhruvil', 'GET', `/dispatch/challans/${cGr.challanId}`);
check(cR1.totals.pcs === 45, 'pcs R1 = 60 − 15 = 45 pcs', cR1.totals);
const cDetail = await ok('jemish', 'GET', `/orders/${C.id}`);
check(cDetail.status === 'returned' && cDetail.returned?.pcs === 15, 'pcs order → Returned (15 pcs back)', cDetail.returned);
const D = await ok('jemish', 'POST', '/orders', {
  customerId: customer.id, orderType: 'pcs_to_pcs', materialId: m2.id, designId: d1.id, quantity: 30, unit: 'pcs', orderDate: '2026-10-26',
});
await ok('jemish', 'POST', '/orders/send-to-production', { orderIds: [D.id] });
const dAdd = await call('jemish', 'POST', `/orders/${D.id}/takas/add-from-free-stock`, { pcs: 10 });
check(dAdd.status < 300, 'the return lot pcs are usable in another pcs order (Add from free stock 10 pcs)', dAdd.body);
const summary = await ok('jemish', 'GET', '/inventory/summary');
check(typeof summary === 'object' && summary !== null, 'inventory summary still loads');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Sprint 18 checks passed');
process.exit(failed ? 1 : 0);
