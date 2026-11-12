# Rivoora Textile — Sprint 26: Dashboard review with demo data (desktop and tablet checked separately)

Prepared 12-11-2026. Sprints 21–25 are done and merged. The three insight dashboards (owner — Jenish, production partner — Gaurang, supervisor) work, and the card layout is broadly right. But:
- the UI **breaks in some places**;
- the **desktop view needs fixing** — it is a different screen size and must be designed for itself, not stretched from tablet;
- there is **not enough real data** to see whether the cards are right.

This sprint:
1. builds a **realistic demo data set** in a **separate demo database**;
2. reviews every dashboard **in Chrome** at fixed desktop and tablet sizes, separately;
3. fixes what is wrong, and re-checks.

You have the **Claude in Chrome** browser connected: use it to open the app, resize the window / use device emulation, take screenshots and read the console.

---

## 0. Safety (read first — non-negotiable)

- The live database is **Turso** and the client works on it every day. **Demo data must NEVER go into Turso.** Not a single row.
- Demo data goes into a **separate local SQLite file** `server/.data/demo.db` (git-ignored), used only when `DATABASE_URL=file:./.data/demo.db` (or the project's equivalent local setting — read `server/src/db/*` and `.env.example` to see how the local DB is selected).
- The seed script must **refuse to run** unless:
  - the DB URL starts with `file:`;
  - the file name contains `demo`;
  - `ALLOW_DEMO_SEED=1` is set.

  On any `libsql://` / `https://` / Turso URL it must exit with an error before connecting.
- Never print, log or commit the Turso URL / token. Never commit `.env` files or `demo.db`. Never run any seed, wipe or reset script against Turso.
- The only migrations allowed in this sprint are additive ones, and only if a fix truly needs one. Stop and tell me before any migration would touch Turso, and remind me to take a backup first.
- Work on a branch `sprint-26`, commit per phase, never force-push, never `git init`.
- Changing dashboards must not change any other module's behaviour. Run `npm run typecheck`, `npm test` and `npm run build` after each phase.

## 1. Read before planning
- `CLAUDE.md` (Sprint 25 section and everything it supersedes), `PROJECT_STATE.md`, `docs/plans/sprint-25-plan.md`, the Sprint 25 prompt (`rivoora-sprint25-insight-dashboards-prompt.md`, especially **§2A Dashboard UI design**, the card tables §3–§5 and the quality bar).
- The dashboard code: `shared/src/insights/*`, the `/dashboard/*` routes and services, `client/src/features/dashboard*` (or wherever Sprint 25 put it), the `InsightCard` component, layout / Arrange code, `useIsTabletLayout`.
- The existing seed / dev-data scripts in `scripts/` and `server/` (reuse their helpers so demo rows go through the same services and rules where practical).

Then write `docs/plans/sprint-26-plan.md` with the phases below, the demo-data volumes, and the exact commands to start the demo environment. **Wait for my approval.**

---

## 2. Phase A — Demo database and seed

### A1 · How it runs
- `npm run demo:seed` → creates / recreates `server/.data/demo.db`, runs all migrations on it, fills demo data. Re-runnable: it deletes **only** the demo file first.
- `npm run demo:dev` → starts server + client against `demo.db` (same as `npm run dev` with the demo DB env), on the usual ports.
- Demo logins: the 8 default role users (same mobile numbers / passwords as the local seed) so every dashboard and role can be checked. Print them at the end of the seed output.
- A visible **"DEMO DATA"** ribbon in the app header whenever the server runs on a `demo` DB (server exposes it in `/auth/me` or `/health`), so screenshots can never be mistaken for live data.

### A2 · What the demo data must contain
Realistic for a power-loom saree / suit maker. Spread over the **last 14 months up to today**, so 12-month cards, "this FY" and "vs last month" all have data. Dates relative to the day the seed runs.

**Masters**
- ~25 clients (some with long names, Gujarati / Hindi-style names), 8 brokers;
- ~40 qualities, ~120 designs with thumbnails (simple generated images are fine);
- 30 looms;
- 6 butta parties, 5 mill parties, 8 weavers, 4 FG suppliers;
- 10 yarn parties, 15 yarn qualities (with `min_kg` on some), 10 warping qualities, 8 TFO machines (sections A / B).

**Orders (~350)**
- Mix of FG type Saree (~70 %) / Suit; pcs (~85 %) and **meter (all-over) orders**; Lump and Pcs to pcs; with and without blouse; with and without a **promised date** (some on time, some late).
- Steps mix: in-house P·B·M, P·M, P only, outside production, FG purchase.
- **Every order status present**, with realistic counts: many dispatched / closed in the past months, a healthy pipeline now (jobsheet pending, in production, at butta, butta QC, at mill, mill QC, godown, ready, partly dispatched), a few **on hold** (Jenish and Gaurang), a few closed early.
- Clients whose order gaps make **"Clients gone quiet"** show 3–4 names; designs ordered again for **"Designs that sell again"**; top-3 share around 45–55 %.

**Production**
- Jobsheets for in-house orders across the 30 looms. Statuses mixed: pending, sent (some **sent > 24 h, not started**), ongoing, completed.
- Some completed **waiting for taka entry**. Some with taka-based frames off by **> 10 %** and some within 10 % (to test the ±10 % cards). Some machine changes and holds.
- Loom running / idle history so **utilisation, idle hours and "today on the floor"** have numbers. Today: ~20 running, ~10 idle.

**Takas (~6,000)**
- Through every stage, with pcs and metres. Damages of all types (machine, butta, mill, supervisor, weaver) and many damage names. Some resolved, some open > 15 days, photos on a few.
- Rework (re-butta, refinish), a few **lost at party**, godown metre corrections (**shrinkage**), splits, dummy D-numbered stock.

**Challans**
- Butta / mill challans: active ones with takas out **past 3 / 8 days** (overdue), received ones, a cancelled one, an edited one.
- Delivery challans: many over the months, revisions from old GRs, one **cancelled** (undo dispatch).
- Goods returns: old DC-based and new party-based (pending and completed), with damage.

**Outside / FG**
- Outside POs: open, partly received, **late** (past due), received, closed, across weavers with different damage rates. FG purchases awaiting goods.

**Stock**
- Free stock fresh / damaged in pcs and m, some **older than 60 days with no open order** (dead stock), manual adds / removes in Stock adjustments, one damaged lot sold.

**Yarn**
- POs with lots (including combined lots), receipts over 14 months, transfers, withdrawals (Sell and In-house).
- TFO programs: pending, running on sections, on hold, box details pending, completed with boxes. Warping jobs: pending, in process, done with beams and remaining kg. Palti boxes.
- Some qualities **below min kg** (Low yarn).

**Alerts**
- Every overdue type present (production > 3 d, butta > 3 d, mill > 8 d, whole order > 20 d / > 25 d), plus orders sent short.

**Edge cases on purpose** (the UI must survive them)
- a client / design / party name of 60+ characters;
- quantities in lakhs (e.g. 2,45,000 pcs) and ₹ in crores;
- a section where every card is empty;
- a card with exactly one data point;
- negative changes ("▼ 38 %");
- a quality with zero stock.

**Tests:** after seeding, run each dashboard endpoint and assert every **considered** card returns non-empty data (except the deliberate empty section). Print a summary table: card → value.

Write the data through the same services / rules where practical (so it's consistent: statuses, counters, stock ledgers). Where direct inserts are faster, run the same recompute helpers afterwards (order status, frames, stock) and say so in the plan.

---

## 3. Phase B — UI review in Chrome (desktop and tablet separately)

Log in as Jenish (owner dashboard, plus the switch to the other two), Gaurang (partner dashboard) and Supervisor (supervisor dashboard). Check each dashboard in each of these windows — **use exactly these sizes** (Chrome window resize or DevTools device toolbar):

| View | Size (CSS px) | Notes |
|---|---|---|
| Desktop large | 1920 × 1080 | 100 % zoom |
| Desktop standard | 1440 × 900 | the main design target |
| Desktop small / laptop | 1280 × 720 | also check at 125 % Windows-style zoom (≈ 1024 effective) |
| Tablet landscape | 1180 × 820 | touch emulation on (`pointer: coarse`) — must show the **tablet** layout, not desktop |
| Tablet portrait | 820 × 1180 | touch on |
| Small tablet portrait | 768 × 1024 | touch on |
| Phone (sanity only) | 390 × 844 | must be usable, not polished |

For every dashboard × size, take screenshots of:
- the top (top bar + Today strip + Needs attention);
- each section (or each tab on tablet);
- one detail drawer (desktop) / bottom sheet (tablet) opened from a figure;
- Arrange mode.

Save them to `docs/screenshots/sprint-26/before/<dashboard>-<size>-<part>.png`.

Check and record every problem in `docs/plans/sprint-26-findings.md`, one row per issue: id · dashboard · size · card / area · problem · screenshot · severity (breaks / ugly / minor). Look for at least:

**Breaking**
- horizontal scroll;
- text / numbers cut off or overlapping;
- cards of unequal height in a row;
- charts overflowing their card;
- tooltips off-screen;
- the drawer / sheet covering controls;
- sticky bars hiding content;
- the period selector or the dashboard switch wrapping badly;
- section tabs not scrollable on tablet;
- console errors / React warnings (read the Chrome console);
- layout jumps after load.

**Desktop-specific**
- content too wide at 1920 (max width and centring);
- too much empty space or cards too small at 1440;
- grid spans that leave holes;
- figure baselines not aligned across a row;
- charts with too few / too many labels for the width;
- hover states missing;
- drawer width;
- keyboard focus order;
- 1280 px laptop squeeze.

**Tablet-specific**
- landscape 1180 falling into the desktop layout (must be the 3-column tablet layout);
- touch targets < 48 px;
- tap-to-tooltip;
- bottom sheet drag;
- pull-to-refresh;
- section tabs;
- 2-column portrait grid;
- wide cards spanning correctly.

**Content**
- every figure has a unit and a period;
- pcs and m never added together;
- Indian number format;
- the ±10 % cards list only items beyond 10 %;
- every figure taps through to the right filtered list (verify a few counts against the list they open);
- empty states and skeletons look right;
- supervisor sees no client names or rates.

Send me the findings list with the key screenshots and **wait** — I will mark what to fix and add my own points.

---

## 4. Phase C — Fix

- Fix the approved findings. **Desktop and tablet are separate layouts**: fix desktop issues in the desktop grid / components and tablet issues in the tablet ones. Don't "fix" one by breaking the other. If a component needs different structure per view, branch on the layout hook — don't fight it with CSS alone.
- Desktop design rules (from Sprint 25 §2A, tightened):
  - content max width 1440 px, centred, 24 px gutters; at 1920 the extra space is margin, not wider cards;
  - 12-column grid with small 3 / normal 4 / wide 6 / full 12; rows packed with no holes — the layout engine may move a card within its section to fill a row, but must keep the Arrange order otherwise;
  - equal heights per row; figure baselines aligned;
  - 1280 px: the same grid, tighter padding (16 px), charts drop to fewer axis labels.
- Tablet rules: as Sprint 25 §2A. Landscape 1024–1279 px with `pointer: coarse` = 3-column tablet layout; portrait = 2 columns; section tabs; bottom sheets; 48 px targets.
- Keep the visual language: one accent per card, greys elsewhere, status colours only for meaning.
- Add a Playwright visual check: `npm run test:dashboard-ui` opens the demo app at the 6 sizes above (with touch emulation for the tablet sizes), logs in as the three roles and asserts:
  - no horizontal scroll;
  - no element overflowing its card;
  - no console errors;
  - the tablet layout at 1180 with touch, and the desktop layout at 1280 without.

  It saves screenshots to `docs/screenshots/sprint-26/after/`.

## 5. Phase D — Re-check and hand-over
- Repeat the Chrome review for every finding at its size; mark each fixed / not fixed in the findings file with an "after" screenshot.
- Before / after screenshot pairs for each dashboard at 1440 desktop and 1180 tablet landscape, in the final report.
- Update `CLAUDE.md` (Sprint 26: demo DB commands, the safety guard, layout rules per view, the UI test), `PROJECT_STATE.md`.
- Confirm in the report that Turso was never touched (the seed guard output) and that `demo.db` and screenshots of demo data are git-ignored except the chosen docs screenshots.

## 6. Acceptance checklist
1. `npm run demo:seed` refuses any non-`file:` / non-`demo` DB and fills `demo.db`; every considered card shows data; the app shows the DEMO DATA ribbon.
2. Findings list with screenshots delivered before fixing.
3. At 1920 / 1440 / 1280 desktop and 1180 / 820 / 768 tablet (touch), every dashboard has no horizontal scroll, no cut-off text, equal-height rows, aligned figures; tablet landscape uses the tablet layout.
4. Every figure taps through to a list whose count matches.
5. `npm run test:dashboard-ui` passes; typecheck, tests and build green.
6. No change outside the dashboards (except the demo scripts, the ribbon and the UI test).
