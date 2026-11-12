# Rivoora Textile — Sprint 24 — Yarn: combined lots, withdraw purpose, TFO hold, warping leftover, Palti, box stickers

Prepared 06-11-2026 from the client's confirmed changes (CR-01 … CR-25, `Rivoora-Client-Change-Requests-3-4-Nov-2026`) and his answers of 06-11-2026. Sprints 21 → 25 must be built **in order**; this file is Sprint 24.

## 0. Read this first (rules for this sprint)

You are working on the live Rivoora Textile app (npm workspaces: `shared/`, `server/`, `client/`; Express + Drizzle + Turso; React 18 + Vite + Tailwind + Radix + TanStack Query). The client uses it every day.

**Safety (never break these)**
- The database is the **live Turso DB**. Migrations must be **additive only**: new tables, new nullable columns or columns with a default, new indexes. No dropping, renaming or retyping columns; no rewriting existing rows except a documented backfill.
- **Before running any migration against Turso, stop and tell me.** Remind me to export a backup first, and wait for my "go".
- Never run seed / wipe / reset scripts against Turso. Never put the Turso URL or token in code, the client, a commit, a log or a zip. Never commit `.env` files.
- Never `git init` and never force-push. Work on a branch `sprint-24` and commit after every phase with a clear message.
- **Existing behaviour must keep working** unless this prompt changes it on purpose. When you change a rule, change it in one place (shared helpers / `roles.ts` / `statuses.ts`), not by copying code.
- Server is the source of truth: every rule below is checked on the server (permissions with `requirePermission`, conditional updates inside one transaction, the hold / close guard in `middleware/hold-guard.ts`). The client only mirrors the rules to hide buttons and show messages.

**How to work**
1. Read `CLAUDE.md` (all sprint sections) and `PROJECT_STATE.md`, then the files named in each section of this prompt, **before planning**.
2. Write the plan to `docs/plans/sprint-24-plan.md`: phases, migrations (SQL shown), files touched, new endpoints, UI per breakpoint, tests, and a list of anything in this prompt that clashes with the code or is unclear. **Stop and wait for my approval of the plan.**
3. Build **one phase at a time**. At the end of each phase: `npm run typecheck`, `npm test`, `npm run build` all green, a short report (what changed, how to test it by hand), then commit. Don't start the next phase until I say so.
4. At the end: update `CLAUDE.md` (new "Sprint 24" section that supersedes older notes where they differ), `PROJECT_STATE.md`, `docs/flows/*` (role matrix, flow inventory), and add `scripts/check-sprint-24.mjs` (an API smoke script like the earlier ones, run against a local DB only).

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
| A | CR-16 Same lot across challans is combined |
| B | CR-17 Withdraw as **Sell** or **Use in-house**, in every zone · CR-19 Program-wise view on Withdraw and Transfer |
| C | CR-20 Hold a running TFO program (rolls made / rolls left, made part can be completed with boxes later) · CR-21 Stop without boxes ("box details pending") |
| D | CR-24 Warping: denier at start, kg used / remaining at Mark done, remaining split over the last two programs |
| E | CR-25 Palti section (leftover yarn → new box) |
| F | CR-18 Box sticker print (TFO + Palti boxes), box number with the FY in brackets |

CR-22 (yarn PO number automatic) is already built — no work. Depends on Sprint 23 (box numbers carry an FY).

Read first: `CLAUDE.md` sections Sprint 17, 20, 20b, 20c (they supersede each other in that order), `rivoora-sprint17-yarn-prompt.md`, `shared/src/yarn.ts`, `yarnSchemas.ts`, `yarnTypes.ts`, `server/src/services/yarn-*.ts`, `client/src/features/yarn/*` (`zone-page`, `tfo-board`, `tfo-stop`, `warping`, `stock-page`, `zone-actions`, `manual-stock`, `receive-page`). Yarn is kept in **grams** in the DB and shown in kg with up to 4 decimals — keep that.

Roles (unchanged unless said): floor actions = Yarn inventory supervisor · Supervisor · Jenish · Gaurang (`canUseYarnInventory`); planning = Jenish · Gaurang (`canPlanYarn`); manual add / remove = Jenish · Gaurang (`canAdjustYarnStock`). The Godown supervisor has no yarn.

---

## 2. Phase A — CR-16 Combine the same lot

Today a lot number is unique per party, so the same lot can't be received twice.
- When a challan line's **party + quality + lot no** match an existing lot (lot no compared **case-insensitive, otherwise exactly the same characters** — "245a" = "245A", but "245" ≠ "245A" ≠ "245-A"), the received kg are **added to the existing lot**: no new lot row, the allocation rows add to that lot's stock in each zone, the lot's history shows both challans.
- Same party + lot no but a **different quality** → refuse with a field error ("Lot 245 of this party is 75D Poly — check the quality or the lot number").
- The receive screen shows, as soon as the lot no is typed, "Existing lot · 600 kg received earlier (challan 77)" or "New lot". Use the existing `checkLotNo` endpoint, extended to return the lot's quality and received kg.
- Everything later (transfers, withdraw, TFO, warping, lot report) sees one lot.

---

## 3. Phase B — Withdraw purpose and program-wise view

### B1 · CR-17 Withdraw: Sell or Use in-house, every zone
- Withdraw becomes available in **all three zones**: Direct consumption, TFO, **Warping** (new). What can be withdrawn per zone stays as today plus Warping: raw yarn by lot (kg), twisted boxes (Direct: part of a box; TFO and Warping: whole boxes — keep today's rule; Warping like TFO), No-box twisted (kg), beams (Direct and Warping).
- Withdraw form gets a required **Purpose**: `Segmented` **Sell** | **Use in-house**.
  - **Sell**: party (typed, required), **rate per kg (optional)** (amount shown = rate × kg when given), note.
  - **Use in-house**: note (optional).
- Migration: `yarn_withdrawals.purpose TEXT NOT NULL DEFAULT 'in_house'`, `party_name`, `rate_paise` (nullable). Old withdrawals = Use in-house.
- Rates / amounts visible only to roles with `canSeeRate`; the Yarn inventory supervisor and the Supervisor can enter a rate but don't see rates in lists afterwards (show "rate entered" only).
- Movements list: filter Purpose (Sell / In-house), columns show it.

### B2 · CR-19 Program-wise view on Withdraw and Transfer
- In the Transfer and Withdraw pickers, twisted boxes are shown **grouped by their TFO program** (header: program no, output quality, stop date, boxes count, kg; then the boxes with box no, rolls, net kg) with a toggle **By program | By quality** (default By program; remembered per user in localStorage, wrapped in try/catch). Raw yarn stays grouped by quality → lot. Remaining kg rows from Phase D and Palti boxes from Phase E appear under their program / under "Palti".
- Tick a whole program to select all its boxes.
- Tablet: picker = 2 columns (groups left, selected list right with totals); desktop the same; phone: one column with a sticky "N boxes · X kg" bar.

---

## 4. Phase C — TFO hold and stop without boxes

TFO program statuses become: Pending → Running → **On hold** → Running … → Completed, plus **Box details pending** (between Running/On hold and Completed). Keep `tfo_programs.status` as the source; add the new values to the type and the shared label config.

### C1 · CR-20 Hold a running program
- Who: floor roles. On a Running program: **Hold** → form: **rolls made** (so far) and **rolls left** (prefilled = started rolls − made; editable; made + left must equal the rolls started), reason (optional).
- Effect: status **On hold**; its machine sections are **freed** (idle again); the hold is logged with rolls made / left.
- **Resume**: pick idle sections (any machines, like Start) → Running again with the rolls left.
- **Complete the made part** (any time, not necessarily immediately; also while On hold or after Resume): enter boxes for the rolls already made (same box form as Stop: roll weight, boxes with rolls, gross kg, avg kg, S/Z) → boxes are created now (automatic numbers) for those rolls; the program keeps going with the rolls left. Several partial completions are allowed; the program is Completed when all rolls are accounted for (made with boxes + raw returned).
- Board / Machine view: on-hold programs show in a **On hold** list (tab next to Running | Pending) with "6 / 12 rolls made · 6 left", buttons Resume · Complete made part · Stop.

### C2 · CR-21 Stop without box details
- Stop now offers **Stop · enter boxes later**. Effect: sections freed, status **Box details pending**, the program shows "300 kg issued · boxes pending". Nothing is added to twisted stock until boxes are entered; raw yarn already left at start (as today).
- List / tab **Box details pending** in the TFO screen (with a count badge). Opening one shows the normal box form (roll weight, boxes, raw returned, twisted meters, note) → **Save boxes** → Completed (same rules and automatic numbers as today's Stop).
- Who fills: the same roles that can stop.

UI notes for both: TFO screen tabs become **Running · On hold · Box details pending · Pending** (counts on each). Tablet: tabs as a `Segmented` row, cards in 2 columns, the box form as a table-like grid (box rows in one line: rolls · gross · avg · S/Z) with a sticky totals bar; phone: one box per card; desktop: table.

---

## 5. Phase D — CR-24 Warping kg used and remaining

- **Denier** is entered when a warping job **starts** (required number > 0, one value per job). Migration `warping_jobs.denier REAL`.
- At **Mark done**, after the beams' meters are entered, the system calculates:
  - meters = total metres of all beams of the job;
  - **kg used = (meters × denier × taar) ÷ 9,000,000** (taar from the job; show the formula with the numbers);
  - kg issued = total kg of the job's inputs;
  - **remaining kg = kg issued − kg used**. If negative → amber warning "Used more than issued by X kg — check denier / taar / meters" and remaining = 0.
- The remaining kg are split **half and half over the last two TFO programs** whose boxes were inputs of this job (ordered by the program's stop date, latest two). One program only → it gets all of it. No program (raw yarn only) → the remaining kg go back to the input lot(s) in Warping, split by their input kg.
- Remaining kg become **stock in the Warping zone**, labelled "Remaining · Program P-12" (store as a twisted stock row linked to the program: e.g. a `yarn_boxes` row with `kind='remaining'`, rolls 0, gross = net, number from the box counter — or a separate table if cleaner; explain the choice in the plan). They can be used in another warping job, transferred, withdrawn, or used in Palti, like any twisted stock, and show under their program in the program-wise views.
- Mark done screen shows a summary card: meters · denier · taar · kg used · kg issued · remaining → "P-12: 3.25 kg · P-11: 3.25 kg". Tablet: beams table on the left, the summary card on the right; phone: summary at the bottom above the Save bar.
- Shared pure function `warpingLeftover(input)` + tests (two programs, one program, raw only, negative).

---

## 6. Phase E — CR-25 Palti section

Palti = leftover yarn re-wound into a new spindle and stored in a new box. Managed by hand, **not linked** to the warping remaining kg (though remaining stock may be picked as an input like any stock).
- Who: floor roles (Yarn inventory supervisor · Supervisor · Jenish · Gaurang).
- Yarn inventory gets a **Palti** entry (button / tab next to the zones). Palti screen: list of Palti boxes made (date, box no, quality, kg, zone, from what) + **New Palti box**.
- New Palti box form:
  - **Inputs**: pick from stock in any zone — boxes (whole or kg from a box), No-box twisted kg, remaining kg, raw lot kg (rare). Each input = what + kg. Stock leaves at save.
  - **Output**: one new box (automatic number from the box counter, FY), warping quality (from the Warping qualities master, ➕ quick add), rolls / spindles (optional), gross kg, net kg (required; default = sum of input kg, editable; if net is less than inputs the difference is recorded as "waste"), zone where it is kept (Direct / TFO / Warping), note.
- Migration: `yarn_boxes.kind TEXT NOT NULL DEFAULT 'tfo'` (`tfo` | `palti` | `remaining`), `palti_runs` (id, date, note, user, waste_g) + `palti_run_inputs`.
- Palti boxes behave like TFO boxes everywhere (transfer, withdraw, warping input, stock screen, program-wise view under "Palti").
- Tablet: inputs picker left, output form right (2 columns); phone: stepper (Inputs → Output → Save); desktop 2 columns.

---

## 7. Phase F — CR-18 Box sticker print

- For **TFO boxes and Palti boxes** (and remaining-kg rows if they have a number).
- Print one box (box row menu "Print sticker") or **all boxes of a stop / partial completion / Palti run** at once (button on the success screen and on the program / run details), or a ticked selection in the stock screen.
- Sticker size **50 × 25 mm** (thermal label printers), one sticker per page; plus an **A4 sheet** option (labels in a grid, 3 × 8) as a fallback. Print route like the jobsheet print (`@page` size per option, CSS injected only while mounted).
- Sticker content: **Box no with the FY in brackets** — `15 (26-27)` — big and bold; quality; lot (if any); **gross kg** and **net kg**; rolls; date; program no (TFO) or "Palti"; a QR code that opens the box in the stock screen (`/yarn/box/<id>`).
- Box numbers show the FY bracket **only on boxes** (stickers, box lists, pickers); all other numbers stay without the year (Sprint 23).

---

## 8. Acceptance checklist
1. Receive lot "245" twice from the same party / quality → one lot with both challans; different quality refused; "245" vs "245A" stay separate; "245a" = "245A".
2. Withdraw in Warping works; every withdraw asks Sell / Use in-house; Sell takes party and optional rate; rates hidden from roles without rate.
3. Transfer / Withdraw pickers group boxes by program with the toggle.
4. Hold a running program with made / left → sections free → Resume on other sections → Complete made part with boxes → later Stop; Stop · enter boxes later → Box details pending → Save boxes → Completed.
5. Warping job with denier → Mark done shows kg used and remaining; remaining split over the last two programs and usable later; negative case warns.
6. Palti box from two inputs → new numbered box in the chosen zone; stock correct; waste recorded.
7. Sticker prints at 50 × 25 mm and on A4 with "15 (26-27)", gross / net kg and QR.
8. Every screen at 360 / 820 / 1180 / 1440 px.
