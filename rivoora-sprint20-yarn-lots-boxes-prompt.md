# Rivoora Textile — Sprint 20: Yarn rework — auto PO no, lots, pending programs, Yarn inventory supervisor, TFO boxes, warping qualities, beams, manual add / remove, new yarn screens

This continues the existing project. Read `CLAUDE.md`, `PROJECT_STATE.md`, the Sprint 17 spec (`rivoora-sprint17-yarn-prompt.md`) and `docs/flows/*` (modules 10, 29, 30) first. The app is **live with real data**.

This sprint touches **only the yarn area**:
- Yarn masters, Yarn PO, Yarn inventory, TFO, warping, beams
- the new role
- removing yarn access from the godown supervisor

Don't change orders, jobsheets, takas, inventory of finished goods or anything outside yarn.

**Safety rules (they come first)**
- Migrations are **additive** (new tables / new nullable columns; no table rebuilds, no dropped columns). Existing stock must stay **exactly** the same: the migration checks that every zone / item / quality balance is identical before and after, and aborts on any difference.
- Test on a **local file-DB copy of real-shaped data** first. Before I run `npm run db:migrate` on Turso, tell me **exactly** what it changes and remind me to **export a Turso backup first**.
- Never run wipe / seed scripts against Turso.
- **No negative stock, ever.** Every write checks balances inside its transaction (per zone + item + quality + lot / box).
- One commit per item; after each: `npm run typecheck`, `npm test`, `scripts/check-sprint17.mjs` (updated) and the other check scripts (local file DB only).
- Keep the current look (Sprint 8 §11 rules). **Tablet layouts must be designed properly** (§10).

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me.
1. Start in **plan mode**. The plan must cover:
   - the data model for lots, boxes, warping qualities and program statuses
   - how the ledger and balances change, and the migration of existing stock (§1.4)
   - every screen and endpoint that changes
   - the permission changes

   Wait for my OK.
2. At the end, update `CLAUDE.md` and `PROJECT_STATE.md` (a Sprint 20 section).

---

## 1. Concepts and data

### 1.1 Lots (raw yarn)
- A **lot** = one supplier lot of **one raw yarn quality** from **one party**. Fields: lot no (typed, text), party, quality, first receipt, created by / at.
- **Lot no is unique per party** (the same party never repeats a lot no). Server-checked + live check in the form.
- **Every raw-yarn ledger row carries a lot** (`yarn_stock_moves.lot_id`, nullable). `NULL` = **"No lot"**: the stock that existed before this sprint, plus manual additions (§8). "No lot" is shown and picked like a lot everywhere ("No lot" option at the top of lot pickers).
- Balances are per **zone + item + quality + lot** (raw) and per **box** (twisted, §1.2).

### 1.2 Boxes (twisted yarn from TFO)
- TFO output is recorded as **boxes**. Box fields:
  - **Box no** (typed, **unique across all boxes**, live check)
  - Rolls
  - Gross wt (kg)
  - Net wt (kg)
  - **Avg kg** (typed by the user, not calculated)
  - the program it came from
  - the source lot (from the program)
  - the **warping quality** (§1.3)
  - the current zone
  - remaining kg
  - status `in_stock` / `used`
- The box's stock = its **net wt**. It goes down when part of it is withdrawn or used in warping.
- **Twisted-yarn ledger rows carry `box_id`** (nullable). `NULL` = **"No box"** twisted stock (twisted yarn that existed before this sprint, and manual additions). It is picked by quality + kg, like today.

### 1.3 Warping quality master (new)
- New master **Warping qualities** (name unique, notes; soft delete blocked while used). In the Masters hub. Jenish and Gaurang manage it; a **➕ quick add** sits beside every warping-quality picker.
- **Quality naming through the flow:**
  - **Raw yarn** keeps its **yarn quality** (yarn quality master), also when moved straight to warping.
  - **TFO start quality** = the output quality chosen at program creation, from the yarn quality master, **exactly as today**.
  - **TFO stop quality** = a **warping quality** chosen at stop (required). It is stored on every box and carried from then on: twisted stock, transfers, withdrawals, warping inputs.
  - **Beams**: the quality changes again after warping. Each beam gets a **warping quality** at Mark done (required, pre-filled from the twisted input's warping quality when there is exactly one, else empty). Old beams keep their yarn quality and are shown as before.
- Ledger rows of twisted yarn reference the warping quality (`warping_quality_id`); old twisted rows keep their yarn `quality_id` (shown as before). Design the read side so both show correctly in stock tables, filters and movements.

### 1.4 Migration of existing stock
- Existing raw stock → **No lot**. Existing twisted stock → **No box** (old yarn quality).
- Existing running TFO programs → status `running` (unchanged). Existing in-process warping jobs → `in_process` (unchanged).
- Existing beams keep their BM numbers (§6).
- **Check:** every balance before = after; the counts of programs, jobs and beams are unchanged.

---

## 2. Yarn PO number: automatic
- New POs get the number **from the system**. Counter `yarn_po_no` **starts at 1** and **skips numbers already used** by existing (typed) POs, so it never clashes; numbers are never reused.
- The PO form shows "PO no: assigned on save" (read-only); remove the typed field and its live check from the UI. Existing POs keep their numbers.

## 3. Receiving a yarn challan: lots + split across zones

Receive screen (against a PO), full screen:
- **Header:** party challan no\*, date\* (today), notes.
- **Lots** (add one or more; "Add lot" button):
  - PO line / **quality**\* (only that PO's lines)
  - **Lot no**\* (unique per party, live check)
  - **kg**\*
  - boxes count (optional, as today)
- **Where each lot goes:** each lot has an **allocation list**: zone (Direct consumption / TFO / Warping) + kg. Add allocation rows to split a lot (e.g. lot 123: 500 kg TFO + 500 kg Direct). Any kg **not allocated goes to Direct consumption**, shown live ("500 kg not placed → Direct consumption").
  - Allocations can't exceed the lot kg.
  - The same challan can of course send different lots to different zones.
- **Summary panel:** challan total kg, per-zone totals, per-quality received vs pending on the PO, and the amber "More than pending" note as today (allowed).
- **On save:**
  - one receipt
  - its lots
  - one ledger `receipt` row per allocation (zone + quality + lot)
  - PO received qty / status recomputed
  - PO event
- **PO details:** receipts show their lots and where each lot went.

## 4. TFO programs: Pending → Running → Completed

### 4.1 Create (Jenish, Gaurang) — no machine yet
- **Fields:**
  - raw quality\*
  - **lot**\* (lots with TFO raw stock of that quality, incl. "No lot", with available kg)
  - raw kg\*
  - output quality (yarn quality master, as today)
  - TPM\*
  - **Direction\*: S / Z / S + Z** (new third value)
  - winding meter
  - denier / filament
  - note
- Status **Pending**.
- Owners can create **many** programs in one go: an "Add another" flow, or a list of rows. The rows must be clean on tablets.
- **Reservation:** a pending program **reserves** its kg on that lot. Available TFO stock everywhere = balance − reserved, and pickers show "reserved X kg".
- **Edit / cancel** a pending program: Jenish, Gaurang and the yarn supervisors (cancel releases the reservation).

### 4.2 Start (Yarn inventory supervisor, production supervisor, Jenish, Gaurang)
- From the TFO screen's **Pending programs** list: **Start** → pick **machine + section** (only idle sections of active machines) → **Running**.
- On start, the raw kg **leaves** TFO stock (ledger `tfo_issue` with the lot); the reservation ends.
- One running program per section (as today).

### 4.3 Stop (same roles) — boxes
Stop screen (full screen on phones, wide dialog / side sheet on tablets):
- **Shown:** program, machine / section, raw quality, **lot (auto, read-only)**, kg issued.
- **Stop quality\*:** a warping quality (+ ➕ add).
- **Boxes** (one or more; "Add box"): **Box no\*** (unique across all boxes), **Rolls\***, **Gross wt\*** (kg), **Net wt\*** (kg, ≤ gross), **Avg kg\***.
  - Totals shown live: boxes, rolls, gross, net.
  - TFO output = **total net wt**.
- **Raw returned** (kg, optional, as today): goes back to TFO raw stock **with the same lot**. Twisted meters (optional) and stop note: as today.
- **Where the boxes go:** per box a choice **Warping / Direct consumption / Stay in TFO** (default Stay in TFO), with "Move all to …" helpers.
  - Before confirming, show: **"N boxes stay in TFO — move them later with Transfer."**
- **On save:**
  - program **Completed**
  - boxes created in their zones
  - ledger rows per box (`tfo_output`, then transfer rows for boxes moved out)
  - history

## 5. Transfer / withdraw with lots and boxes
- **Raw yarn:** zone → quality → **lot** (incl. No lot) → kg ≤ available (minus reservations in TFO).
- **Twisted yarn:**
  - **Transfer:** tick **whole boxes** (list: box no, warping quality, rolls, net, remaining, lot). "No box" twisted stock: quality + kg.
  - **Withdraw** (Direct consumption only, as today): tick boxes and enter **kg per box** (≤ the box's remaining; a box at 0 becomes `used`). "No box" stock: quality + kg.
- **Beams:** as today (Direct ↔ Warping only; withdraw from Direct).
- The **movements ledger** shows lot and box columns, and has a **lot / box search** filter.

## 6. Warping: Pending → In process → Done (no machines)

### 6.1 Create (Jenish, Gaurang)
- **Inputs** (rows):
  - Raw: quality + **lot** + kg
  - Twisted: **boxes** (whole box or kg from a box)
  - "No box" twisted: quality + kg
  - All from **Warping** stock. **Reserved** while pending.
- **Taar\***, **Panna\***.
- **Meters\*** **or** tick **"Full meter"**. With Full meter the meters stay empty and **must** be entered per beam at Done.
- Note.
- Status **Pending**. Edit / cancel while pending, by the same roles as TFO.

### 6.2 Start (yarn supervisors, owners)
**Start** → **In process**; the inputs leave Warping stock now (reservation ends).

### 6.3 Mark done (same roles) → beams
- Add **one or more beams** ("Add beam"). Each beam has:
  - **Beam no\*** (typed, **unique across all beams**; old beams keep their BM numbers)
  - **Warping quality\*** (+ ➕)
  - **Taar\*** and **Panna\*** (pre-filled from the job, editable)
  - **Meters\*** (pre-filled from the job; required and empty when Full meter was ticked)
  - **Zone** Direct / Warping
- **Date is automatic** (done time).
- Beam numbers become text (store a new `beam_code` text column; old rows get `BM-<n>` as their code). Show the code everywhere a beam shows.

## 7. New role: Yarn inventory supervisor
- Role key `yarn_supervisor`, label **"Yarn inventory supervisor"**. English only. Landing `/yarn`.
- **Default user** created by `db:migrate` (phone `2222222222`, default password rule as for the others).
- **Can:**
  - view Yarn PO (no rates / amounts) and **receive yarn challans**
  - Yarn inventory: transfer, withdraw
  - start / stop TFO programs; start / done warping
  - edit / cancel pending programs and jobs
- **Cannot:** create / edit / close / cancel POs, create programs or warping jobs, manual add / remove, masters, anything outside yarn.
- **Production supervisor:** **same yarn rights** as the yarn supervisor (he keeps yarn).
- **Godown supervisor:** **loses all yarn access** (nav items, routes, API → 403). Update roles, nav, route guards, the role matrix in docs.
- **Jenish / Gaurang:** everything, plus creating programs and jobs, POs, masters and manual add / remove. They can act as the new role (Switch role).

## 8. Manual add / remove of yarn stock (Jenish, Gaurang only)
New permission `canAdjustYarnStock` (Jenish, Gaurang); the server rejects everyone else.
- **Add** (from the Yarn inventory screen and each zone):
  - zone\*
  - item\* Raw / Twisted
  - quality\* (raw: yarn quality; twisted: warping quality)
  - kg\*
  - remark (optional)

  It goes in as **"No lot"** raw / **"No box"** twisted stock (ledger kind `manual_add`).
- **Remove:**
  - zone\*, item\* (Raw / Twisted / Beams)
  - raw: quality + lot (incl. No lot) + kg
  - twisted: boxes (+ kg per box) or No-box quality + kg
  - beams: tick beams
  - **Remark\* required**

  Ledger kind `manual_remove` (beams → status `consumed` with the remark, or a new `removed` status if cleaner — say which in the plan).
- Both show in Movements as "Added manually" / "Removed manually" with the user and remark.

## 9. Yarn inventory screens: redesign (clean, glanceable)
- **Main screen:**
  - three zone panels (Direct · TFO · Warping) with only the headline figures: raw kg, twisted kg / boxes, beams, and in TFO running / pending programs
  - KPIs
  - recent movements
  - actions: Receive (via PO), Manual add / remove (owners)
- **TFO zone screen** (no machine grid here any more):
  - tabs or sections **Running programs** | **Pending programs** | **Stock**
  - Running = rows with **machine + section (e.g. 3A)**, quality, lot, kg, started, Stop
  - Pending = rows with quality, lot, kg, created by, **Start**, Edit, Cancel
  - Stock = raw by quality + lot; twisted boxes
  - a **"Machine view"** button opens a **full-screen board**: every machine as a card split **A (top) / B (bottom)**; each section idle / running (program quality, lot, kg, since); legend; tap a running section → Stop; tap an idle section → pick a pending program to start there
- **Warping zone screen:** **In process** | **Pending** | **Stock** (raw by lot, twisted boxes, beams) | Beams. Start / Done from the rows.
- **Direct consumption screen:** stock (raw by lot, twisted boxes, beams) + Withdraw.
- Keep it light: no dense tables on phones (cards). Show only what is needed to decide; details open on tap.

## 10. Tablet layouts (important — not just "responsive")
Forms must **not** become one field per full-width row on tablets. For **every screen in this sprint**, design the layout explicitly for 768–1023 px portrait **and** 1024–1279 px landscape:
- **PO receive with lots:** each lot is a card. On tablets the lot fields sit in one row (quality · lot no · kg · boxes), with the allocation rows below it in a compact grid (zone · kg · remove). The summary panel goes on the right on landscape and sticks at the bottom on portrait.
- **Create TFO program(s):** 2–3 column form; "many programs" as compact rows on landscape.
- **Start program:** a machine / section picker as tappable tiles.
- **Stop program:**
  - Program info at the top in a 2-column summary.
  - Boxes: a **table-like grid on tablets** (box no · rolls · gross · net · avg kg · destination · ✕) with big inputs. Cards on phones.
  - Totals bar always visible.
- **Warping create / done:** inputs grid; beams grid (beam no · quality · taar · panna · meters · zone).
- **Transfer / withdraw** with box selection: a list with checkboxes and kg inputs in a two-column sheet on landscape.
- **Machine view board:** 4–6 machine cards per row on landscape, 3–4 on portrait. Each section is large enough to tap.
- **Manual add / remove:** 2 columns; Remark full width.

Use side sheets / wide dialogs on landscape tablets and full-screen pages on phones. Keyboard-safe action bars (`kb-bar`).

**Screenshots** at 360 / 768 / 1024 / 1280 px of every new or changed screen go in the final summary. Nothing may overflow at 360 px.

## 11. Tests and checks
- **Shared tests** (`yarn20.test.ts`):
  - PO number skips used numbers
  - lot allocation (unplaced kg → Direct)
  - reservations
  - balances per lot and per box
  - box withdraw partial
  - stop totals
  - "stay in TFO" boxes
  - warping inputs from lots and boxes
  - beam code uniqueness
  - permission matrix for the new role (production supervisor = yarn rights; godown supervisor = none)
- **Check script** (local file DB only, update `check-sprint17.mjs` or add `check-sprint20.mjs`):
  - PO auto number
  - challan with 2 lots split across zones
  - create 3 TFO programs (pending, reserved)
  - yarn supervisor starts one on 2A
  - stop with 3 boxes (1 → Warping, 1 → Direct, 1 stays) and a new warping quality
  - transfer the staying box
  - withdraw part of a box
  - warping job pending → start → done with 2 beams (one Full meter)
  - manual add / remove (remark required; 403 for others)
  - godown supervisor gets 403 on yarn
  - old No-lot / No-box stock still usable
  - migration balance check
- **Regression:** Yarn PO print, movements, beams transfer / withdraw as before.

## 12. Build phases
1. Data model + migration with balance checks (local copy first; summarise the Turso changes for me).
2. Warping quality master + Masters hub.
3. PO auto number.
4. Receive with lots + allocations; PO details.
5. Lot / box-aware ledger, balances, transfer, withdraw, movements.
6. TFO pending → start → stop with boxes; S + Z.
7. Warping pending → start → done with beams.
8. New role + permission changes (production supervisor keeps, godown supervisor loses).
9. Manual add / remove.
10. Screens redesign + Machine view board + tablet layouts.
11. Tests, check script, screenshots, docs.

Final summary: what changed per item, the migration summary for Turso, test / check results, screenshots, and anything you were unsure about.
