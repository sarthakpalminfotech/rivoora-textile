/**
 * Sprint 17 API flow check (yarn) against a running API on a LOCAL file database (never run against Turso):
 *
 *   TURSO_DATABASE_URL=file:C:/path/test.db TURSO_AUTH_TOKEN=x node scripts/check-sprint17.mjs [baseUrl]
 *
 * (migrate + seed the file first; start the API with the same env.) It creates its own masters with a unique suffix, so
 * it can run many times. Covers: masters + permissions, a PO with 2 qualities → 2 partial challans into different zones,
 * over-receipt, transfer raw Direct → TFO, a program on 3A stopped with twisted kg ≠ raw kg + returned raw, transfer
 * twisted → Warping, warping with raw + twisted → done → 2 beams (Direct consumption + Warping), consume a beam, the
 * no-negative-stock and beam-zone rules — and after EVERY step: the summary, the zone screens and the full ledger
 * reconcile with the balances this script expects.
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

const PHONES = { jemish: '9999999999', gaurang: '8888888888', supervisor: '7777777777', taka: '6666666666', qc: '5555555555', godown: '4444444444', dhruvil: '3333333333' };
const sessions = {};
for (const [who, phone] of Object.entries(PHONES)) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: `Rivoora@${phone.slice(0, 3)}` }) });
  if (!res.ok) throw new Error(`login ${who} failed: ${res.status}`);
  sessions[who] = res.headers.get('set-cookie').split(';')[0];
}
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

// ---------------------------------------------------------------- expected balances (grams)
const startZones = Object.fromEntries((await ok('jemish', 'GET', '/yarn/summary')).zones.map((z) => [z.zone, z]));
const expected = new Map(); // `${zone}|${item}|${qualityId}` → grams (only this script's qualities)
const add = (zone, item, q, g) => expected.set(`${zone}|${item}|${q}`, (expected.get(`${zone}|${item}|${q}`) ?? 0) + g);
let expectedBeams = { direct: startZones.direct.beams, warping: startZones.warping.beams };
let ourQualities = [];

async function allMoves() {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await ok('jemish', 'GET', `/yarn/moves?limit=100&page=${page}`);
    out.push(...r.items);
    if (!r.hasMore) return out;
  }
}

async function reconcile(step) {
  const summary = await ok('jemish', 'GET', '/yarn/summary');
  const moves = await allMoves();
  const ledger = new Map();
  for (const m of moves) if (m.source === 'yarn') ledger.set(`${m.zone}|${m.item}|${m.quality.id}`, (ledger.get(`${m.zone}|${m.item}|${m.quality.id}`) ?? 0) + m.qtyG);
  let good = true;
  const detail = [];
  // 1. the ledger (sum of moves) matches what this script expects for its qualities
  for (const [k, g] of expected) if ((ledger.get(k) ?? 0) !== g) { good = false; detail.push({ k, expected: g, ledger: ledger.get(k) ?? 0 }); }
  // 2. the summary's zone totals = the ledger's totals per zone (all qualities)
  for (const z of summary.zones) {
    let raw = 0;
    let twisted = 0;
    for (const [k, g] of ledger) {
      const [zone, item] = k.split('|');
      if (zone !== z.zone) continue;
      if (item === 'raw') raw += g;
      else twisted += g;
    }
    if (raw !== z.rawG || twisted !== z.twistedG) { good = false; detail.push({ zone: z.zone, summary: [z.rawG, z.twistedG], ledger: [raw, twisted] }); }
  }
  if (summary.totals.rawG !== summary.zones.reduce((s, z) => s + z.rawG, 0)) good = false;
  // 3. the zone screens show the same per-quality balances
  for (const zone of ['direct', 'tfo', 'warping']) {
    const zd = await ok('jemish', 'GET', `/yarn/zones/${zone}`);
    for (const q of ourQualities) {
      const row = zd.qualities.find((r) => r.quality.id === q);
      const raw = expected.get(`${zone}|raw|${q}`) ?? 0;
      const twisted = expected.get(`${zone}|twisted|${q}`) ?? 0;
      if ((row?.rawG ?? 0) !== raw || (row?.twistedG ?? 0) !== twisted) { good = false; detail.push({ zone, q, screen: [row?.rawG ?? 0, row?.twistedG ?? 0], expected: [raw, twisted] }); }
      if (row && (row.rawG < 0 || row.twistedG < 0)) { good = false; detail.push({ negative: row }); }
    }
    if (zone !== 'tfo' && zd.stock.beams !== expectedBeams[zone]) { good = false; detail.push({ zone, beams: zd.stock.beams, expected: expectedBeams[zone] }); }
    if (zone !== 'tfo' && zd.beams.length !== Math.min(500, expectedBeams[zone])) { good = false; detail.push({ zone, beamList: zd.beams.length }); }
  }
  check(good, `reconcile after: ${step}`, detail);
}

// ---------------------------------------------------------------- permissions
check((await call('taka', 'GET', '/yarn/summary')).status === 403, 'Taka entry has no Yarn inventory (403)');
check((await call('qc', 'GET', '/yarn-pos')).status === 403, 'QC has no Yarn PO (403)');
check((await call('dhruvil', 'GET', '/yarn/summary')).status === 403, 'Dhruvil has no Yarn inventory (403)');
check((await call('supervisor', 'GET', '/yarn/summary')).status === 200, 'Supervisor opens Yarn inventory');
check((await call('godown', 'GET', '/yarn-pos')).status === 200, 'Godown supervisor opens Yarn PO');
check((await call('supervisor', 'POST', '/yarn-parties', { name: `x ${tag}` })).status === 403, 'Supervisor cannot add yarn parties (403)');
check((await call('godown', 'GET', '/tfo-machines')).status === 403, 'Godown supervisor has no TFO machines master (403)');
check((await call('supervisor', 'GET', '/jobsheets')).status === 200, 'Supervisor keeps his Jobsheets module');
check((await call('godown', 'GET', '/butta/counts')).status === 200, 'Godown supervisor keeps Butta cutting');

// ---------------------------------------------------------------- masters
const party = await ok('jemish', 'POST', '/yarn-parties', { name: `Shiv Yarns ${tag}`, mobile: '9876543210', gstin: '24abcde1234f1z5', address: 'Surat' });
check(party.gstin === '24ABCDE1234F1Z5', 'GSTIN is stored upper case');
check((await call('jemish', 'POST', '/yarn-parties', { name: `shiv yarns ${tag}` })).status === 409, 'party names are unique (case-insensitive)');
const q75 = await ok('jemish', 'POST', '/yarn-qualities', { name: `75D ${tag}`, denier: '75', filament: '36' });
const q150 = await ok('gaurang', 'POST', '/yarn-qualities', { name: `150D ${tag}`, denier: '150', filament: '48' });
const qTw = await ok('jemish', 'POST', '/yarn-qualities', { name: `75D twist ${tag}` });
ourQualities = [q75.id, q150.id, qTw.id];
check((await call('jemish', 'POST', '/yarn-qualities', { name: `75d ${tag}` })).status === 409, 'quality names are unique (case-insensitive)');
const machinesNow = (await ok('jemish', 'GET', '/tfo-machines?limit=100')).items;
const nextNo = Math.max(0, ...machinesNow.map((m) => m.machineNo)) + 1;
const machine = await ok('jemish', 'POST', '/tfo-machines', { machineNo: nextNo, name: `TFO ${tag}`, isActive: true });
check((await call('jemish', 'POST', '/tfo-machines', { machineNo: nextNo })).status === 409, 'TFO machine numbers are unique');
const lookups = await ok('supervisor', 'GET', `/lookup/yarn-qualities?search=${encodeURIComponent(tag)}`);
check(lookups.length === 3, 'supervisor reads the yarn quality lookup');

// ---------------------------------------------------------------- PO with 2 qualities
const poNo = Math.floor(100_000 + Math.random() * 800_000);
check((await ok('jemish', 'GET', `/yarn-pos/check-no?no=${poNo}`)).available === true, 'PO no is free before');
const po = await ok('jemish', 'POST', '/yarn-pos', {
  poNo, poDate: today, partyId: party.id, remark: 'Urgent',
  lines: [{ qualityId: q75.id, qtyKg: 100, rate: 245.5 }, { qualityId: q150.id, qtyKg: 50.5, rate: 310.25 }],
});
check(po.status === 'open', 'PO created open');
check((await ok('jemish', 'GET', `/yarn-pos/check-no?no=${poNo}`)).available === false, 'PO no is taken after');
check((await call('gaurang', 'POST', '/yarn-pos', { poNo, poDate: today, partyId: party.id, lines: [{ qualityId: q75.id, qtyKg: 1, rate: 1 }] })).status === 409, 'duplicate PO no → 409');
check((await call('supervisor', 'POST', '/yarn-pos', { poNo: poNo + 1, poDate: today, partyId: party.id, lines: [{ qualityId: q75.id, qtyKg: 1, rate: 1 }] })).status === 403, 'Supervisor cannot create a PO');
check((await call('jemish', 'DELETE', `/yarn-parties/${party.id}`)).status === 409, 'a party on a PO cannot be deleted');
check((await call('jemish', 'DELETE', `/yarn-qualities/${q75.id}`)).status === 409, 'a quality on a PO cannot be deleted');

let detail = await ok('jemish', 'GET', `/yarn-pos/${po.id}`);
check(detail.totals.orderedG === 150_500 && detail.totals.amountPaise === 2_455_000 + Math.round(50_500 * 31_025 / 1000), 'PO totals: kg + amount', detail.totals);
check(detail.canEditAll && detail.canCancel && !detail.canClose, 'open PO: full edit + cancel');
const supDetail = await ok('supervisor', 'GET', `/yarn-pos/${po.id}`);
check(supDetail.totals.amountPaise === null && supDetail.lines[0].ratePaise === null && supDetail.canReceive && !supDetail.canEditAll, 'supervisor: no rate, can receive, cannot edit');
check((await call('supervisor', 'GET', `/yarn-pos/${po.id}/print`)).status === 403, 'supervisor cannot print the PO');
const print = await ok('jemish', 'GET', `/yarn-pos/${po.id}/print`);
check(print.lines.length === 2 && print.totalG === 150_500, 'print data');

// edit while nothing received (rate change) — then list / search / filters
await ok('jemish', 'PUT', `/yarn-pos/${po.id}`, {
  poNo, poDate: today, partyId: party.id, remark: 'Urgent',
  lines: [{ qualityId: q75.id, qtyKg: 100, rate: 250 }, { qualityId: q150.id, qtyKg: 50.5, rate: 310.25 }],
});
detail = await ok('jemish', 'GET', `/yarn-pos/${po.id}`);
check(detail.lines[0].ratePaise === 25_000, 'full edit while nothing received');
const list = await ok('jemish', 'GET', `/yarn-pos?search=${encodeURIComponent(`150D ${tag}`)}`);
check(list.items.length === 1 && list.items[0].qualities.length === 2, 'list search by quality');
check((await ok('jemish', 'GET', `/yarn-pos?search=${poNo}`)).items.some((i) => i.id === po.id), 'list search by PO no');
check((await ok('jemish', 'GET', `/yarn-pos?party=${party.id}&status=open`)).items.length === 1, 'list filter party + status');
check((await ok('jemish', 'GET', `/yarn-pos?quality=${q150.id}`)).items.some((i) => i.id === po.id), 'list filter quality');

// challan 1: 60 kg 75D into Direct consumption (supervisor receives)
const [line75, line150] = detail.lines;
const r1 = await ok('supervisor', 'POST', `/yarn-pos/${po.id}/receipts`, { challanNo: `C1-${tag}`, date: today, zone: 'direct', notes: 'first lot', lines: [{ poLineId: line75.id, qtyKg: 60, boxes: 12 }, { poLineId: line150.id, qtyKg: 0 }] });
add('direct', 'raw', q75.id, 60_000);
check(r1.status === 'partly_received', 'challan 1 → Partly received');
await reconcile('challan 1 (60 kg 75D → Direct consumption)');
check((await call('jemish', 'PUT', `/yarn-pos/${po.id}`, { poNo, poDate: today, partyId: party.id, lines: [{ qualityId: q75.id, qtyKg: 1, rate: 1 }] })).status === 409, 'after a receipt only the remark can change');
await ok('jemish', 'PUT', `/yarn-pos/${po.id}`, { remark: 'Remark after receipt' });
check((await ok('jemish', 'GET', `/yarn-pos/${po.id}`)).remark === 'Remark after receipt', 'remark-only edit works');
check((await call('jemish', 'POST', `/yarn-pos/${po.id}/cancel`)).status === 409, 'cannot cancel once received');

// challan 2: 30 kg 150D into Warping + 45 kg 75D (5 over pending) into Warping
const r2 = await ok('godown', 'POST', `/yarn-pos/${po.id}/receipts`, { challanNo: `C2-${tag}`, date: today, zone: 'warping', lines: [{ poLineId: line75.id, qtyKg: 45 }, { poLineId: line150.id, qtyKg: 30.25 }] });
add('warping', 'raw', q75.id, 45_000);
add('warping', 'raw', q150.id, 30_250);
detail = await ok('jemish', 'GET', `/yarn-pos/${po.id}`);
check(r2.status === 'partly_received' && detail.lines[0].overG === 5_000 && detail.lines[0].pendingG === 0 && detail.lines[1].pendingG === 20_250, 'challan 2 (over-receipt allowed) → still Partly received', detail.lines);
check(detail.receipts.length === 2 && detail.receipts[0].zone === 'warping', 'challans listed newest first with zone');
check(detail.events.some((e) => e.kind === 'received'), 'activity has the receipts');
await reconcile('challan 2 (→ Warping)');
check((await call('jemish', 'POST', `/yarn-pos/${po.id}/receipts`, { challanNo: 'x', date: today, zone: 'tfo', lines: [{ poLineId: line75.id, qtyKg: 0 }] })).status === 400, 'a challan needs > 0 kg on a line');

// ---------------------------------------------------------------- transfer raw Direct → TFO
check((await call('jemish', 'POST', '/yarn/transfers', { what: 'raw', from: 'direct', to: 'tfo', qualityId: q75.id, qtyKg: 60.001 })).status === 409, 'transfer more than available → 409');
await ok('godown', 'POST', '/yarn/transfers', { what: 'raw', from: 'direct', to: 'tfo', qualityId: q75.id, qtyKg: 55, note: 'for TFO' });
add('direct', 'raw', q75.id, -55_000);
add('tfo', 'raw', q75.id, 55_000);
await reconcile('transfer 55 kg raw Direct → TFO');

// ---------------------------------------------------------------- TFO program on <machine>A (3A in the spec)
check((await call('jemish', 'POST', '/yarn/tfo/programs', { machineId: machine.id, section: 'A', rawQualityId: q75.id, rawKg: 55.5, outputQualityId: qTw.id, tpm: 600, direction: 'S' })).status === 409, 'program raw kg > TFO stock → 409');
const prog = await ok('supervisor', 'POST', '/yarn/tfo/programs', {
  machineId: machine.id, section: 'A', rawQualityId: q75.id, rawKg: 50, outputQualityId: qTw.id, windingMeter: 12000, denierFilament: '75/36', tpm: 600, direction: 'S', note: 'first run',
});
add('tfo', 'raw', q75.id, -50_000);
check(prog.status === 'running' && prog.section === 'A', `program running on ${machine.machineNo}A`);
check((await call('jemish', 'POST', '/yarn/tfo/programs', { machineId: machine.id, section: 'A', rawQualityId: q75.id, rawKg: 1, outputQualityId: qTw.id, tpm: 600, direction: 'Z' })).status === 409, 'one program per section');
let board = await ok('jemish', 'GET', '/yarn/tfo/board');
const bm = board.machines.find((m) => m.id === machine.id);
check(bm?.sections[0].program?.id === prog.id && bm.sections[1].program === null, 'board shows A running, B idle');
check((await call('jemish', 'DELETE', `/tfo-machines/${machine.id}`)).status === 409, 'a machine with a running program cannot be deleted');
check((await call('jemish', 'PUT', `/tfo-machines/${machine.id}`, { machineNo: machine.machineNo, isActive: false })).status === 409, 'a machine with a running program cannot be made inactive');
await reconcile('TFO issue 50 kg');
check((await call('jemish', 'POST', `/yarn/tfo/programs/${prog.id}/stop`, { twistedKg: 48, returnedRawKg: 50.5 })).status === 400, 'returned raw > issued → 400');
const stopped = await ok('godown', 'POST', `/yarn/tfo/programs/${prog.id}/stop`, { twistedKg: 48.2, twistedMeters: 640000, returnedRawKg: 1.25 });
add('tfo', 'twisted', qTw.id, 48_200);
add('tfo', 'raw', q75.id, 1_250);
check(stopped.status === 'completed' && stopped.twistedG === 48_200 && stopped.returnedRawG === 1_250, 'program stopped with twisted ≠ raw + returned raw');
check((await call('jemish', 'POST', `/yarn/tfo/programs/${prog.id}/stop`, { twistedKg: 1 })).status === 409, 'cannot stop twice');
board = await ok('jemish', 'GET', '/yarn/tfo/board');
check(board.machines.find((m) => m.id === machine.id)?.sections[0].program === null, 'section is idle again');
const history = await ok('jemish', 'GET', `/yarn/tfo/programs?machineId=${machine.id}&section=A`);
check(history.items.length === 1 && history.items[0].twistedG === 48_200, 'program history per section');
await reconcile('TFO stop (48.2 twisted, 1.25 returned)');

// ---------------------------------------------------------------- transfer twisted TFO → Warping
await ok('supervisor', 'POST', '/yarn/transfers', { what: 'twisted', from: 'tfo', to: 'warping', qualityId: qTw.id, qtyKg: 40 });
add('tfo', 'twisted', qTw.id, -40_000);
add('warping', 'twisted', qTw.id, 40_000);
await reconcile('transfer 40 kg twisted TFO → Warping');

// ---------------------------------------------------------------- warping raw + twisted → 2 beams
check((await call('jemish', 'POST', '/yarn/warping/jobs', { inputs: [{ item: 'raw', qualityId: q75.id, qtyKg: 30 }, { item: 'raw', qualityId: q75.id, qtyKg: 15.001 }] })).status === 409, 'two rows of the same quality add up against stock → 409');
await reconcile('rejected warping job (nothing moved)');
const job = await ok('jemish', 'POST', '/yarn/warping/jobs', {
  inputs: [{ item: 'raw', qualityId: q75.id, qtyKg: 40 }, { item: 'twisted', qualityId: qTw.id, qtyKg: 35.5 }, { item: 'raw', qualityId: q150.id, qtyKg: 10 }],
  note: 'job note',
});
add('warping', 'raw', q75.id, -40_000);
add('warping', 'twisted', qTw.id, -35_500);
add('warping', 'raw', q150.id, -10_000);
check(job.status === 'in_process' && job.inputs.length === 3 && job.totalG === 85_500, 'warping job in process (WJ)');
const inProcess = await ok('jemish', 'GET', '/yarn/warping/jobs?status=in_process');
check(inProcess.items.some((j) => j.id === job.id), 'in-process list has the job');
await reconcile('warping issue');
const done = await ok('godown', 'POST', `/yarn/warping/jobs/${job.id}/done`, {
  beams: [
    { taar: 4800, panna: 52, meters: 1200, qualityId: q75.id, zone: 'direct' },
    { taar: 4800, panna: 52.5, meters: 1150.5, qualityId: qTw.id, zone: 'warping' },
  ],
});
expectedBeams = { direct: expectedBeams.direct + 1, warping: expectedBeams.warping + 1 };
check(done.beams.length === 2 && done.beams[0].beamNo + 1 === done.beams[1].beamNo, 'two beams with running numbers (BM)');
check((await call('jemish', 'POST', `/yarn/warping/jobs/${job.id}/done`, { beams: [{ taar: 1, panna: 1, meters: 1, qualityId: q75.id, zone: 'direct' }] })).status === 409, 'a done job cannot be done again');
await reconcile('warping done → 1 beam Direct, 1 beam Warping');

// ---------------------------------------------------------------- beams: transfer rule + consume
const directBeam = done.beams.find((b) => b.zone === 'direct');
const warpBeam = done.beams.find((b) => b.zone === 'warping');
check((await call('jemish', 'POST', '/yarn/transfers', { what: 'beams', from: 'warping', to: 'tfo', beamIds: [warpBeam.id] })).status === 400, 'beams cannot go to TFO');
check((await call('jemish', 'POST', '/yarn/transfers', { what: 'beams', from: 'direct', to: 'warping', beamIds: [warpBeam.id] })).status === 409, 'a beam not in the From zone → 409');
check((await call('jemish', 'POST', '/yarn/withdrawals', { what: 'beams', zone: 'direct', beamIds: [warpBeam.id] })).status === 409, 'cannot consume a beam that is in Warping from Direct consumption');
await ok('jemish', 'POST', '/yarn/withdrawals', { what: 'beams', zone: 'direct', beamIds: [directBeam.id], note: 'loom 7' });
expectedBeams.direct -= 1;
const consumed = await ok('jemish', 'GET', '/yarn/beams?zone=direct&status=consumed');
check(consumed.some((b) => b.id === directBeam.id && b.consumedNote === 'loom 7'), 'beam marked Consumed with the note');
check((await call('jemish', 'POST', '/yarn/withdrawals', { what: 'beams', zone: 'direct', beamIds: [directBeam.id] })).status === 409, 'a consumed beam cannot be consumed again');
await reconcile('consume a beam');
await ok('supervisor', 'POST', '/yarn/transfers', { what: 'beams', from: 'warping', to: 'direct', beamIds: [warpBeam.id] });
expectedBeams.warping -= 1;
expectedBeams.direct += 1;
await reconcile('beam Warping → Direct consumption');

// ---------------------------------------------------------------- withdraw yarn (Direct consumption) + no negative
check((await call('jemish', 'POST', '/yarn/withdrawals', { what: 'raw', zone: 'direct', qualityId: q75.id, qtyKg: 5.001 })).status === 409, 'withdraw more than available → 409');
check((await call('jemish', 'POST', '/yarn/withdrawals', { what: 'raw', zone: 'tfo', qualityId: q75.id, qtyKg: 1 })).status === 400, 'withdraw is Direct consumption only');
await ok('godown', 'POST', '/yarn/withdrawals', { what: 'raw', zone: 'direct', qualityId: q75.id, qtyKg: 5 });
add('direct', 'raw', q75.id, -5_000);
await reconcile('withdraw the last 5 kg 75D from Direct consumption');
check((await call('jemish', 'POST', '/yarn/withdrawals', { what: 'raw', zone: 'direct', qualityId: q75.id, qtyKg: 0.001 })).status === 409, 'zero stock: even 1 g is refused');

// ---------------------------------------------------------------- movements filters + close PO
const tfoMoves = await ok('jemish', 'GET', `/yarn/moves?zone=tfo&kind=tfo&quality=${q75.id}`);
check(tfoMoves.items.length === 2 && tfoMoves.items.every((m) => m.kind === 'tfo_issue' || m.kind === 'tfo_return'), 'zone movements filter by type + quality', tfoMoves.items.map((m) => m.kind));
const warpMoves = await ok('jemish', 'GET', '/yarn/moves?zone=warping&kind=warping');
check(warpMoves.items.some((m) => m.source === 'beam' && m.kind === 'beam_created'), 'beam created shows in Warping movements');
const recent = (await ok('jemish', 'GET', '/yarn/summary')).recent;
check(recent.length === 10 && recent[0].createdAt >= recent[9].createdAt, 'summary has the last 10 movements, newest first');
check((await call('supervisor', 'POST', `/yarn-pos/${po.id}/close`)).status === 403, 'supervisor cannot close a PO');
await ok('gaurang', 'POST', `/yarn-pos/${po.id}/close`);
detail = await ok('jemish', 'GET', `/yarn-pos/${po.id}`);
check(detail.status === 'closed' && detail.totals.pendingG === 0 && detail.events[0].kind === 'closed', 'PO closed short');
check((await call('supervisor', 'POST', `/yarn-pos/${po.id}/receipts`, { challanNo: 'late', date: today, zone: 'direct', lines: [{ poLineId: line150.id, qtyKg: 1 }] })).status === 409, 'a closed PO cannot receive');

// cancel: a fresh PO with nothing received
const po2 = await ok('jemish', 'POST', '/yarn-pos', { poNo: poNo + 1, poDate: today, partyId: party.id, lines: [{ qualityId: q150.id, qtyKg: 10, rate: 1 }] });
await ok('jemish', 'POST', `/yarn-pos/${po2.id}/cancel`);
check((await ok('jemish', 'GET', `/yarn-pos/${po2.id}`)).status === 'cancelled', 'PO cancelled while nothing received');
check((await call('jemish', 'PUT', `/yarn-pos/${po2.id}`, { remark: 'x' })).status === 409, 'a cancelled PO cannot be edited');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
