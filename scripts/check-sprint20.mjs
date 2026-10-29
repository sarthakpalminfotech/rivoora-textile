/**
 * Sprint 20 API flow check (yarn lots, boxes, pending programs / jobs) against a running API on a LOCAL file database
 * (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint20.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) It creates its own masters with a unique suffix,
 * so it can run many times. After the steps that move yarn it checks the lot / box balances it expects.
 */
const base = process.argv[2] ?? 'http://localhost:4100';
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl?.startsWith('file:')) {
  console.error('Refusing to run: TURSO_DATABASE_URL must be a local file: database.');
  process.exit(2);
}

let failed = 0;
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!ok) failed += 1;
};

const PHONES = { jemish: '9999999999', gaurang: '8888888888', supervisor: '7777777777', taka: '6666666666', godown: '4444444444' };
const sessions = {};
async function login(who, phone) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: `Rivoora@${phone.slice(0, 3)}` }) });
  if (!res.ok) throw new Error(`login ${who} failed: ${res.status}`);
  sessions[who] = res.headers.get('set-cookie').split(';')[0];
}
for (const [who, phone] of Object.entries(PHONES)) await login(who, phone);
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
const today = new Date().toISOString().slice(0, 10);
const tag = Date.now().toString(36);

/** Available (balance − reserved) grams of a lot (null = No lot) of a quality in a zone, from the lot picker. */
async function lotAvail(zone, qualityId, lotId) {
  const lots = await ok('jemish', 'GET', `/yarn/lots?zone=${zone}&qualityId=${qualityId}`);
  const l = lots.find((x) => x.id === lotId);
  return { availableG: l?.availableG ?? 0, reservedG: l?.reservedG ?? 0 };
}
const boxIn = async (zone, boxNo) => (await ok('jemish', 'GET', `/yarn/boxes?zone=${zone}&search=${encodeURIComponent(boxNo)}`)).find((b) => b.boxNo === boxNo);

// ---------------------------------------------------------------- masters + a PO received in 2 lots
const party = await ok('jemish', 'POST', '/yarn-parties', { name: `S20 Yarns ${tag}` });
const q75 = await ok('jemish', 'POST', '/yarn-qualities', { name: `75D s20 ${tag}` });
const qOut = await ok('jemish', 'POST', '/yarn-qualities', { name: `75D twist s20 ${tag}` });
const wq = await ok('jemish', 'POST', '/warping-qualities', { name: `WQ s20 ${tag}` });
const machinesNow = (await ok('jemish', 'GET', '/tfo-machines?limit=100')).items;
const nextNo = Math.max(0, ...machinesNow.map((m) => m.machineNo)) + 1;
const machine = await ok('jemish', 'POST', '/tfo-machines', { machineNo: nextNo, name: `TFO s20 ${tag}`, isActive: true });

const po = await ok('jemish', 'POST', '/yarn-pos', { poDate: today, partyId: party.id, lines: [{ qualityId: q75.id, qtyKg: 1000, rate: 200 }] });
check(Number.isInteger(po.poNo) && po.poNo > 0, 'PO number assigned by the system', po);
const po2 = await ok('jemish', 'POST', '/yarn-pos', { poDate: today, partyId: party.id, lines: [{ qualityId: q75.id, qtyKg: 1, rate: 1 }] });
check(po2.poNo > po.poNo, 'next PO gets a higher number');
await ok('jemish', 'POST', `/yarn-pos/${po2.id}/cancel`);
const poLine = (await ok('jemish', 'GET', `/yarn-pos/${po.id}`)).lines[0];
const lotA = `A-${tag}`;
const lotB = `B-${tag}`;
check((await ok('jemish', 'GET', `/yarn/lots/check?partyId=${party.id}&lotNo=${lotA}`)).available, 'lot no free before');
await ok('supervisor', 'POST', `/yarn-pos/${po.id}/receipts`, {
  challanNo: `CH-${tag}`,
  date: today,
  lots: [
    { poLineId: poLine.id, lotNo: lotA, qtyKg: 500, allocations: [{ zone: 'tfo', qtyKg: 300 }, { zone: 'warping', qtyKg: 100 }] },
    { poLineId: poLine.id, lotNo: lotB, qtyKg: 200, allocations: [{ zone: 'tfo', qtyKg: 200 }] },
  ],
});
check(!(await ok('jemish', 'GET', `/yarn/lots/check?partyId=${party.id}&lotNo=${lotA.toLowerCase()}`)).available, 'lot no taken after (any case)');
const tfoLots = await ok('jemish', 'GET', `/yarn/lots?zone=tfo&qualityId=${q75.id}`);
const lotAId = tfoLots.find((l) => l.lotNo === lotA)?.id;
const lotBId = tfoLots.find((l) => l.lotNo === lotB)?.id;
check(lotAId && lotBId, 'both lots have TFO stock');
check((await lotAvail('direct', q75.id, lotAId)).availableG === 100_000, 'lot A: unplaced 100 kg went to Direct consumption');
check((await lotAvail('warping', q75.id, lotAId)).availableG === 100_000, 'lot A: 100 kg in Warping');

// ---------------------------------------------------------------- TFO: 3 pending programs (reserved)
const progBase = { rawQualityId: q75.id, outputQualityId: qOut.id, tpm: 600, direction: 'SZ', windingMeter: 12000, denierFilament: '75/36' };
check((await call('supervisor', 'POST', '/yarn/tfo/pending', { programs: [{ ...progBase, lotId: lotAId, rawKg: 10 }] })).status === 403, 'supervisor cannot create programs (403)');
check(
  (await call('jemish', 'POST', '/yarn/tfo/pending', { programs: [{ ...progBase, lotId: lotAId, rawKg: 200 }, { ...progBase, lotId: lotAId, rawKg: 100.5 }] })).status === 409,
  'programs reserving more than the lot has → 409 (all or nothing)',
);
check((await lotAvail('tfo', q75.id, lotAId)).reservedG === 0, 'the failed batch reserved nothing');
const created = await ok('jemish', 'POST', '/yarn/tfo/pending', {
  programs: [
    { ...progBase, lotId: lotAId, rawKg: 120, note: 'p1' },
    { ...progBase, lotId: lotAId, rawKg: 80, direction: 'S' },
    { ...progBase, lotId: lotBId, rawKg: 50, direction: 'Z' },
  ],
});
check(created.length === 3 && created[0].direction === 'SZ' && created[0].lot?.lotNo === lotA, '3 pending programs created (S + Z kept)', created[0]);
let a = await lotAvail('tfo', q75.id, lotAId);
check(a.reservedG === 200_000 && a.availableG === 100_000, 'lot A in TFO: 200 kg reserved, 100 kg available', a);
check((await call('jemish', 'POST', '/yarn/transfers', { what: 'raw', from: 'tfo', to: 'direct', qualityId: q75.id, lotId: lotAId, qtyKg: 100.001 })).status === 409, 'reserved stock cannot be transferred out (409)');
const board0 = await ok('supervisor', 'GET', '/yarn/tfo/board');
const rs = board0.rawStock.find((s) => s.quality.id === q75.id);
check(board0.pending.length >= 3 && rs.reservedG === 250_000 && rs.availableG === rs.rawG - 250_000, 'board lists pending + reserved per quality', rs);

// edit (floor) + cancel
const p3 = created[2];
await ok('supervisor', 'PUT', `/yarn/tfo/pending/${p3.id}`, { ...progBase, lotId: lotBId, rawKg: 60, direction: 'Z' });
check((await lotAvail('tfo', q75.id, lotBId)).reservedG === 60_000, 'supervisor edits a pending program (reservation follows)');
check((await call('supervisor', 'PUT', `/yarn/tfo/pending/${p3.id}`, { ...progBase, lotId: lotBId, rawKg: 200.5, direction: 'Z' })).status === 409, 'edit beyond the lot → 409');
await ok('supervisor', 'POST', `/yarn/tfo/pending/${p3.id}/cancel`);
check((await lotAvail('tfo', q75.id, lotBId)).reservedG === 0, 'cancel releases the reservation');
check((await call('supervisor', 'POST', `/yarn/tfo/pending/${p3.id}/start`, { machineId: machine.id, section: 'A' })).status === 409, 'a cancelled program cannot start');

// ---------------------------------------------------------------- start p1 on <machine>A (2A in the spec)
const run = await ok('supervisor', 'POST', `/yarn/tfo/pending/${created[0].id}/start`, { machineId: machine.id, section: 'A' });
check(run.status === 'running' && run.lot?.id === lotAId && run.direction === 'SZ', `supervisor starts p1 on ${nextNo}A`, run);
a = await lotAvail('tfo', q75.id, lotAId);
check(a.reservedG === 80_000 && a.availableG === 100_000, 'start: the reservation became an issue (available unchanged)', a);
check((await call('supervisor', 'POST', `/yarn/tfo/pending/${created[1].id}/start`, { machineId: machine.id, section: 'A' })).status === 409, 'second program on a busy section → 409');

// ---------------------------------------------------------------- stop with 3 boxes + a new warping quality
const wqNew = await ok('supervisor', 'POST', '/warping-qualities', { name: `WQ new s20 ${tag}` }).catch(() => null);
const stopQ = wqNew ?? wq;
const bx = (n) => `BX${n}-${tag}`;
check((await ok('jemish', 'GET', `/yarn/boxes/check?boxNo=${bx(1)}`)).available, 'box no free before');
check(
  (await call('supervisor', 'POST', `/yarn/tfo/programs/${run.id}/stop`, {
    warpingQualityId: stopQ.id,
    boxes: [{ boxNo: bx(1), rolls: 10, grossKg: 40, netKg: 41, avgKg: 4, zone: 'tfo' }],
  })).status === 400,
  'net > gross → 400',
);
check(
  (await call('supervisor', 'POST', `/yarn/tfo/programs/${run.id}/stop`, {
    warpingQualityId: stopQ.id,
    boxes: [
      { boxNo: bx(1), rolls: 10, grossKg: 40, netKg: 38, avgKg: 3.8, zone: 'tfo' },
      { boxNo: bx(1).toLowerCase(), rolls: 10, grossKg: 40, netKg: 38, avgKg: 3.8, zone: 'tfo' },
    ],
  })).status === 400,
  'the same box no twice on one stop → 400',
);
const stopped = await ok('supervisor', 'POST', `/yarn/tfo/programs/${run.id}/stop`, {
  warpingQualityId: stopQ.id,
  twistedMeters: 50000,
  returnedRawKg: 2.5,
  note: 'done',
  boxes: [
    { boxNo: bx(1), rolls: 12, grossKg: 40, netKg: 38.5, avgKg: 3.2, zone: 'warping' },
    { boxNo: bx(2), rolls: 12, grossKg: 40, netKg: 37.25, avgKg: 3.1, zone: 'direct' },
    { boxNo: bx(3), rolls: 10, grossKg: 42, netKg: 40, avgKg: 4, zone: 'tfo' },
  ],
});
check(stopped.status === 'completed' && stopped.twistedG === 115_750 && stopped.boxes.length === 3 && stopped.warpingQuality?.id === stopQ.id, 'stop → completed, output = total net', stopped);
check(!(await ok('jemish', 'GET', `/yarn/boxes/check?boxNo=${bx(1).toLowerCase()}`)).available, 'box no taken after (any case)');
const b1 = await boxIn('warping', bx(1));
const b2 = await boxIn('direct', bx(2));
const b3 = await boxIn('tfo', bx(3));
check(b1?.remainingG === 38_500 && b2?.remainingG === 37_250 && b3?.remainingG === 40_000, 'boxes are in their zones with their net wt', { b1, b2, b3 });
check(b1?.lot?.id === lotAId && b1?.warpingQuality.id === stopQ.id, 'box carries the lot and the stop quality');
a = await lotAvail('tfo', q75.id, lotAId);
check(a.availableG === 102_500, 'raw returned (2.5 kg) is back on lot A in TFO', a);
const reuse = await call('supervisor', 'POST', `/yarn/tfo/pending/${created[1].id}/start`, { machineId: machine.id, section: 'A' });
check(reuse.status === 201, 'section is idle again after stop');
const tfoZone = await ok('jemish', 'GET', '/yarn/zones/tfo');
check(tfoZone.warpingQualities.some((w) => w.quality.id === stopQ.id && w.boxes >= 1) && !tfoZone.qualities.some((q) => /system/.test(q.quality.name)), 'TFO stock lists twisted by warping quality (no system row)');
const moves = (await ok('jemish', 'GET', `/yarn/moves?search=${encodeURIComponent(bx(1))}&limit=50`)).items;
check(moves.some((m) => m.kind === 'tfo_output' && m.box?.boxNo === bx(1)) && moves.some((m) => m.kind === 'transfer_in' && m.zone === 'warping'), 'movements: box output + transfer to Warping', moves.map((m) => m.kind));

// Exports for later phases (warping, manual add / remove) live below this line.
globalThis.s20 = { party, q75, qOut, wq, stopQ, machine, lotAId, lotBId, b1, b2, b3, bx };

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
