# Sprint 26 — Dashboard review with demo data: plan

Spec: `rivoora-sprint26-dashboard-review-demo-data-prompt.md`. Branch `sprint-26` (from `main` 3597434). The user asked
for the sprint "in single go", so the plan is written and then carried out without a separate approval stop. The two
hand-off points the spec asks for (findings before fixing, any migration that would touch Turso) are kept as notes in the
report. No migration is needed for this sprint.

## 0 · Safety

- Demo data lives ONLY in `server/.data/demo.db` (git-ignored: `server/.data/`). Demo images go to
  `server/uploads/demo-seed/` (already ignored by `server/uploads/*`).
- `server/src/db/demo-seed.ts` runs the guard (`server/src/db/demo/guard.ts`, which imports nothing of the app) BEFORE
  any import that opens a connection or reads `server/.env`. It refuses unless the URL starts with `file:`, the file
  name contains `demo` and `ALLOW_DEMO_SEED=1`. The refusal never prints a non-file URL. The guard runs again on the
  loaded config inside `buildDemo`.
- `scripts/demo.mjs` always sets `TURSO_DATABASE_URL=file:<repo>/server/.data/demo.db` (dotenv never overrides a set
  variable, so the Turso address in `server/.env` is never read) and blanks `CLOUDINARY_*`.
- `node scripts/check-demo-guard.mjs` proves the refusals (libsql://, https://, ws://, a file without "demo", a missing
  or wrong `ALLOW_DEMO_SEED`, no URL): exit 1, "REFUSED", no migration started, no file created.
- Turso is never touched: no command in this sprint runs against `server/.env`'s database.

## 1 · Commands

```bash
npm run demo:seed                 # recreate server/.data/demo.db, migrate, fill, check every card, print the logins
npm run demo:dev                  # server :4000 + client :5180 on the demo DB (DEMO DATA ribbon)
node scripts/check-demo-guard.mjs # the guard refuses everything that is not a local demo file
npm run test:dashboard-ui         # Playwright (installed Chrome): 6 sizes × 3 dashboards, no overflow / errors
```

Logins = the 8 default users (`Rivoora@` + first 3 digits): Jenish 9999999999, Gaurang 8888888888,
Supervisor 7777777777, Taka entry 6666666666, QC 5555555555, Godown 4444444444, Dhruvil 3333333333, Yarn 2222222222.

## 2 · Phase A — demo data (how it is built)

The data is SIMULATED, then written by direct inserts in one transaction (`Sink`), because rows have to carry
timestamps spread over 14 months (the services stamp "now"). Consistency is kept by reusing the app's own rules:

- order status at every moment = the shared `orderStatusForJobsheets`, evaluated at every change point → the status
  history is exactly what the app would have written; afterwards the app's own `recomputeOrderStatus` runs on every
  order in a rolled-back transaction and must change NOTHING (the seed fails otherwise);
- taka routing = `nextTakaStage`; completed frames / metres = `framesFromTakaPcs` / `metersFromTakaMeters`;
- the yarn ledger is the only source of quantities and is never allowed below zero;
- every id is assigned up front; `PRAGMA foreign_key_check` must be clean after the write;
- counters are set to the highest number used, so new numbers in the demo app continue after the demo ones.

Timeline (`demo/clock.ts`): x = days since IST midnight 426 days ago; now = H. Deterministic random numbers (same data
for the same day). Modules: `masters.ts` (names), `production.ts` (booking, loom scheduler on each order's looms,
taka entry, butta → QC → mill → QC → godown, rework, refinish, damages), `outside.ts` (POs to 8 weavers with different
damage rates; FG purchase from 4 suppliers), `aftermath.ts` (splits, move to inventory, delivery challans in parts,
close early, old DC goods returns with revisions, undo dispatch, lost at party), `stock.ts` (holder orders, manual
add / remove, damaged lot sold, party goods returns pending / completed in takas / pcs / metres), `yarn.ts` (POs + lots
incl. a lot combined across two challans, TFO programs in every status, transfers, warping with beams + leftover box,
Palti, withdrawals sell / in-house, pending programs / jobs, low yarn), `status.ts`, `emit.ts`, `verify.ts`.

Volumes (one run on 12-11-2026): 25 clients (one 72-character name) + 8 brokers, 40 qualities (one 60+ characters, one
with zero stock), 120 designs with generated images (one 60+ character name; 8 only ordered long ago → dead stock),
30 looms, 6 butta / 5 mill parties, 8 weavers, 4 FG suppliers, 14 damage names, 10 yarn parties, 15 yarn qualities
(6 with a minimum, 5 of them low), 10 warping qualities, 8 TFO machines; ≈ 340 orders (≈ 70 % saree, ≈ 85 % pcs,
lump / pcs to pcs, blouse mix, half with a promised date), ≈ 2,600 jobsheets, ≈ 6,700 takas, ≈ 1,300 damages,
≈ 2,450 butta / mill challans, ≈ 350 delivery challans, ≈ 35 outside POs, ≈ 3,300 yarn moves — ≈ 1.25 lakh rows in
≈ 6 s. Every order status has at least one order; ≈ 18–25 looms are running now.

Edge cases on purpose: a 2,45,000 pcs order (booked last month, ₹ 1.1 Cr — so this month shows ▼), crores in
12-month totals, 60+ character names, "Returns by client" with exactly one client this month, the supervisor's
**Performance** section empty this month (his recent jobsheets are all within ±10 %; Gaurang's are not), a quality with
zero stock.

The seed ends with a card-by-card table for the three dashboards (30-day period) and fails if any considered card
(other than the deliberate empty one) has no data.

## 3 · Phase B — review

The Claude in Chrome extension did not connect in this session (it needs Chrome signed in to claude.ai with the same
account as Claude Code), so the review is done with Playwright driving the installed Chrome (`channel: 'chrome'`) at
the exact sizes of the spec, with touch emulation (`hasTouch`, `isMobile`) for the tablet sizes. 1280 × 720 at 125 %
uses `deviceScaleFactor` 1.25 with a 1024 × 576 viewport. Screenshots: `docs/screenshots/sprint-26/before/`.
Findings: `docs/plans/sprint-26-findings.md`. Console errors are captured per page.

## 4 · Phase C — fixes

Desktop and tablet stay separate layouts (`useDashboardMode`): desktop = 12-column grid, max 1440 px centred, 24 px
gutters (16 px at ≤ 1280), rows packed (a card may move inside its section to fill a row; Arrange order kept
otherwise), equal heights, figures on one baseline; tablet = 2 / 3 columns, section tabs, bottom sheets, 48 px targets.
`npm run test:dashboard-ui` asserts no horizontal scroll, nothing overflowing its card, no console errors, the tablet
layout at 1180 touch and the desktop one at 1280 → `docs/screenshots/sprint-26/after/`.

## 5 · Phase D

Re-check every finding, before / after pairs at 1440 and 1180, CLAUDE.md + PROJECT_STATE.md, report.
