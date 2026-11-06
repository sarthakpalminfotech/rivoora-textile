# Rivoora Textile — Sprint 23 — Financial-year numbering, QC login limits

Prepared 06-11-2026 from the client's confirmed changes (CR-01 … CR-25, `Rivoora-Client-Change-Requests-3-4-Nov-2026`) and his answers of 06-11-2026. Sprints 21 → 25 must be built **in order**; this file is Sprint 23.

## 0. Read this first (rules for this sprint)

You are working on the live Rivoora Textile app (npm workspaces: `shared/`, `server/`, `client/`; Express + Drizzle + Turso; React 18 + Vite + Tailwind + Radix + TanStack Query). The client uses it every day.

**Safety (never break these)**
- The database is the **live Turso DB**. Migrations must be **additive only**: new tables, new nullable columns or columns with a default, new indexes. No dropping, renaming or retyping columns; no rewriting existing rows except a documented backfill.
- **Before running any migration against Turso, stop and tell me.** Remind me to export a backup first, and wait for my "go".
- Never run seed / wipe / reset scripts against Turso. Never put the Turso URL or token in code, the client, a commit, a log or a zip. Never commit `.env` files.
- Never `git init` and never force-push. Work on a branch `sprint-23` and commit after every phase with a clear message.
- **Existing behaviour must keep working** unless this prompt changes it on purpose. When you change a rule, change it in one place (shared helpers / `roles.ts` / `statuses.ts`), not by copying code.
- Server is the source of truth: every rule below is checked on the server (permissions with `requirePermission`, conditional updates inside one transaction, the hold / close guard in `middleware/hold-guard.ts`). The client only mirrors the rules to hide buttons and show messages.

**How to work**
1. Read `CLAUDE.md` (all sprint sections) and `PROJECT_STATE.md`, then the files named in each section of this prompt, **before planning**.
2. Write the plan to `docs/plans/sprint-23-plan.md`: phases, migrations (SQL shown), files touched, new endpoints, UI per breakpoint, tests, and a list of anything in this prompt that clashes with the code or is unclear. **Stop and wait for my approval of the plan.**
3. Build **one phase at a time**. At the end of each phase: `npm run typecheck`, `npm test`, `npm run build` all green, a short report (what changed, how to test it by hand), then commit. Don't start the next phase until I say so.
4. At the end: update `CLAUDE.md` (new "Sprint 23" section that supersedes older notes where they differ), `PROJECT_STATE.md`, `docs/flows/*` (role matrix, flow inventory), and add `scripts/check-sprint-23.mjs` (an API smoke script like the earlier ones, run against a local DB only).

**UI rules (every screen in this prompt)**
- Breakpoints as in `CLAUDE.md`: phone < 768, **tablet 768–1023**, desktop ≥ 1024. Nothing may overflow at 360 px.
- **Tablet is designed on its own, not as a stretched phone or a squeezed desktop.** On tablet:
  - forms use 2 columns (3 for short numeric fields); never one field per row;
  - lists are 2-column card grids (or a table when the desktop is a table and it fits);
  - touch targets ≥ 44 px (48 px on floor screens: supervisor, taka entry, yarn floor, godown);
  - bottom bar / icon rail as today; sticky action bar at the bottom of long forms.
- Desktop: tables or 3–5 column grids as the module already does, side panels (right drawer) for details where the module already uses them, keyboard-friendly forms (Enter → next field).
- Phone: single column, cards, bottom sheets for short dialogs, full-screen forms.
- Reuse the design system in `client/src/components/ui/*` (`Select`, `Segmented`, `Modal` / `ResponsiveModal`, `ConfirmDialog`, `StatusBadge`, date picker, `LoadMore`). Same colours, spacing and type as today. Every new dialog that asks for a **reason** uses the same component (a required textarea, min 3 characters, max 300).
- Every write shows a toast on success and an inline / field error on failure. Every destructive or "undo" action has a `ConfirmDialog` that says exactly what will happen.
- Taka entry and QC screens stay bilingual (`<Bi en hi />` / `bi()`); all other screens English.
- Lists: TanStack Query hooks in `features/*/api.ts`, invalidate only the affected keys; debounced search; filters in the URL where the module already does that.

**Words**: the client says "Jenish" (role key `jemish`), "Gaurang" (`gaurang`), "Supervisor" (production supervisor, `supervisor`), "Taka entry" (`taka_entry`), "QC" (`qc`), "Godown supervisor" (`godown_supervisor`), "Dhruvil" (`dhruvil`), "Yarn inventory supervisor" (`yarn_supervisor`).

---

## 1. What this sprint covers

| Phase | Items |
|---|---|
| A | CR-23 Every automatic number restarts each financial year (India, 1 April – 31 March) |
| B | C10 QC login limits: allowed location + login hours 8:30 am – 7:20 pm, auto log-out, extra time per person |

Depends on Sprints 21 and 22. This is the riskiest change of the series — **plan Phase A very carefully** and list every place a number is generated or looked up before writing code.

---

## 2. Phase A — CR-23 Financial-year numbering

Client decision: **all automatically generated numbers restart at 1 each financial year** (FY = 1 April – 31 March, Asia/Kolkata time; e.g. FY "2026-27"). **The year is shown only on TFO / Palti box numbers** (box stickers in Sprint 24: "15 (26-27)"). Everywhere else the number is shown as today, without the year.

### A1 · Inventory of numbers (do this first, put it in the plan)
Find every generator and every lookup-by-number. At least:

| Number | Today | Lookup by number? |
|---|---|---|
| Order no | `MAX(order_no)+1` + unique index | order search, `#26` |
| Jobsheet no | counter `jobsheet_no` | QR `/j/<no>`, `GET /jobsheets/by-no/:no`, supervisor search |
| Taka no | counter `taka_no` + system-wide unique index | QC by number, godown search, takas by number everywhere |
| Dummy taka no | counter `dummy_taka_no` (Sprint 22) | as taka no |
| Butta challan GSM-n, Mill challan MIL-n | counters | challan search |
| Delivery challan DC-n | counter | dispatched search |
| Goods return GR-n, Damaged lot DL-n | counters (Sprint 22) | lists |
| Outside PO PO-n | counter | PO search |
| Yarn PO no | automatic, skips used | PO search |
| TFO box no, Beam no | automatic, skip used | stock screens |
| Warping job WJ-n, TFO program no | counters | yarn screens |

Add anything else you find.

### A2 · Design
- `shared/src/fy.ts`: `fyOf(date) → '2026-27'`, `fyShort('2026-27') → '26-27'`, `currentFy(now)`; IST-safe; tests around 31 March / 1 April midnight.
- One server helper `lib/numbering.ts`: `nextNumber(tx, key, fy)` — every generator above calls it. Counters become per-FY: counter name `"<key>:<fy>"` (new rows; the old global rows are kept but no longer used for new numbers after the switch). The "skip used numbers" generators (yarn PO, boxes, beams) skip only numbers used **in the same FY**.
- Migration (additive): a `fy TEXT` column on every numbered table (`orders`, `jobsheets`, `takas`, `challans`, `dispatch_challans`, `goods_returns`, `damaged_lots`, `outside_pos`, `yarn_pos`, `yarn_boxes`, `beams`, `warping_jobs`, `tfo_programs`, …). **Backfill existing rows with the FY of their `created_at`** (documented one-off backfill — show me the SQL; this is the only allowed row rewrite).
- Uniqueness: new unique indexes on `(fy, number)` **in addition to** the old ones until the switch, then the old global unique indexes must stop blocking: SQLite can't alter an index in place — create the new `(fy, …)` unique index, then **drop the old global unique index** (index drop only, no data loss). List exactly which indexes change and **ask me before running it**. The taka system-wide unique index becomes `(fy, taka_no)` among non-deleted takas.
- **Effective date**: numbering restarts at the **next 1 April (2027-04-01)** for the live data. The current FY 2026-27 continues its existing sequence (no renumbering, no jump). Make the start FY a config value so a test can simulate a year change.

### A3 · Lookups by number (no wrong matches across years)
- Every "find by number" (search boxes, QC "type taka number", godown search, challan search, `by-no`) looks in the **current FY first**. If nothing matches there, it looks in older years; if more than one FY matches, return all matches and the UI shows a small picker "Which one? · 6245 · Order #26 · 2026-27 / 6245 · Order #3 · 2027-28".
- **Jobsheet QR**: new prints encode `/j/<fy>/<no>` (e.g. `/j/2026-27/319`); old QR codes `/j/<no>` keep working (current FY first, then the picker). `parseJobsheetQr` accepts both forms.
- Lists sort by date (newest first), never by number alone, so restarted numbers don't jump to the top / bottom.
- Prints and screens show numbers **without** the year, except box numbers (Sprint 24). Where two records with the same number could appear in one list (e.g. "All orders"), show the date next to the number as today.

### A4 · Tests
Pure tests for `fy.ts`; a server test (local DB) that simulates the FY switch: create records on 31-03 and 01-04 → numbers restart, lookups resolve correctly, QR old/new both resolve.

---

## 3. Phase B — C10 QC login limits

Client decision: the **QC role** may log in **only at the allowed location** and **only between 8:30 am and 7:20 pm** (Asia/Kolkata). At the end time QC is **logged out automatically** and can't use the app. **Jenish and Gaurang** can change the times and give **extra time** to a person. Only the QC role is limited (no location / time limits for anyone else).

### B1 · Settings (Jenish · Gaurang, new permission `canManageLoginLimits`)
Screen **Settings → QC login limits**:
- **Allowed locations**: list of places, each = name · latitude · longitude · radius (metres, default 200). Add by "Use my current location" (browser geolocation) or typing coordinates; a small map preview is optional (no paid map API — skip the map if none is free).
- **Login hours**: from 08:30 to 19:20 (editable), days: all days (editable checkboxes Mon–Sun).
- **Extra time** for one QC user: user · date · until time (e.g. today until 21:00) · reason. List of active / past grants; a grant can be cancelled.
- Tablet: the three blocks as cards in a 2-column layout (locations full width on top, hours + extra time side by side); desktop the same with more width; phone stacked.
- Tables: `login_limit_settings` (single row JSON or columns), `login_locations`, `login_time_grants`. Every change is logged (who, when, before → after).

### B2 · Enforcement (server)
- At **login** of a QC user: the client sends the device location (`navigator.geolocation`, high accuracy, 10 s timeout). The server checks: inside any allowed location (haversine ≤ radius + reported accuracy, capped at 100 m extra) **and** inside the login hours or an active grant. Otherwise 403 with a bilingual reason: "Login allowed only at the factory / लॉगिन केवल फैक्ट्री में", "Login allowed 8:30 am – 7:20 pm / लॉगिन सुबह 8:30 – शाम 7:20".
- Location permission denied / unavailable → login refused with a message explaining how to allow location.
- **During the session**: the client sends a heartbeat with the location every 5 minutes (and on app focus) to `POST /auth/heartbeat`; the server re-checks location and time. When the time is over (or the device left the location for 2 heartbeats in a row) the session is ended server-side; every API call of an ended session returns 401 → the client shows "Your login time is over / आपका लॉगिन समय समाप्त हो गया" and returns to the login screen.
- The session itself also carries `valid_until` = end of hours / grant; requests after it are refused even without a heartbeat.
- Jenish / Gaurang "view as QC" (role switching) is **not** limited.
- Log every refused login / forced log-out (user, time, reason, distance) — shown in Settings → "QC login log" (last 30 days).

### B3 · Client
- QC login screen: asks for location before submitting, with a clear bilingual explanation.
- A small bar on QC screens: "Logged in until 7:20 pm / शाम 7:20 तक" (and the extra-time end when a grant is active); 10 minutes before the end a toast warns.

---

## 4. Acceptance checklist
1. FY helpers pass the 31-03 / 01-04 tests; with the start FY set to a test value, every number restarts at 1 and lookups / QR resolve across years with the picker.
2. Live data keeps its current numbering until 1 April 2027; nothing renumbered.
3. QC can't log in outside the allowed place or outside 8:30–19:20; is logged out at 19:20; an extra-time grant lets one QC user work until the granted time; other roles unaffected; refused logins appear in the log.
4. All new screens at 360 / 820 / 1180 / 1440 px.
