# Rivoora Textile — Sprint 17: Yarn PO + Yarn Inventory (zones: Direct consumption · TFO · Warping)

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first. This sprint adds a **new, separate area**: **yarn (raw material) purchasing and yarn inventory**.
- It is **not linked to orders**, jobsheets or takas.
- It must **not change any existing behaviour**.

The app is live with real data:
- **all database changes are new tables / additive columns**, in one migration, tested on a local file DB copy first
- tell me exactly what `npm run db:migrate` will add on Turso before I run it
- never run wipe / seed scripts against Turso

**Build it complete and properly in this one sprint** (data, API, screens, prints, tests), following the phases at the end.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in **plan mode**: tables, the stock ledger design, endpoints, screens per role, and the **tablet layouts** (§9). Wait for my OK.
2. One commit per phase. After each phase, run `npm run typecheck` and `npm test`, run the app, check the screens at **360 / 768 / 1024 / 1280px**, and confirm the existing modules still work for every role.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. The process (plain words)

1. A **Yarn PO** is raised to a yarn party. It can have **several yarn qualities**, each with quantity (kg) and rate (₹/kg).
2. Yarn arrives on **challans** against the PO, **partly or fully**. While receiving, the person picks **which zone** the yarn goes to.
3. **Yarn Inventory** has three **zones**:
   - **Direct consumption**: raw yarn, twisted yarn and **beams**, used directly
   - **TFO**: raw yarn is twisted on TFO machines into **twisted yarn**
   - **Warping**: raw and/or twisted yarn is warped into **beams**
4. Every zone has **Transfer** (move stock to another zone) and **Withdraw** (use the stock; what it means depends on the zone, §5).
5. Everything is in **kg** for yarn and **count** for beams (each beam has its own details).

---

## 2. Masters (Masters hub; Jenish + Gaurang manage: `canManageYarnMasters`)

Use `MasterList` + full-screen forms like the other masters, with soft delete, and delete blocked (409) while in use.

| Master | Fields |
|---|---|
| **Yarn parties** | Name* (unique, case-insensitive), Mobile, Address, GSTIN, Notes |
| **Yarn qualities** | Name* (unique, case-insensitive), Denier, Filament, Notes. Used for raw **and** twisted yarn. |
| **TFO machines** | Machine no* (integer ≥ 1, unique), Name, Active. Every machine has **two sections: A (top) and B (bottom)**, shown as **1A / 1B**. Inactive machines are hidden from the board. |

Quick-add: the Yarn PO form has a **➕ beside Party** that opens the Yarn party form and selects the new party (like the customer ➕ on Add order). Add the same quick-add for **Yarn quality** on PO lines.

---

## 3. Yarn PO module (`/yarn-po`)

**Permissions:**
- `canManageYarnPo`: create / edit / cancel / close / print (Jenish, Gaurang)
- `canReceiveYarn`: receive challans (Jenish, Gaurang, Supervisor, Godown supervisor)
- `canViewYarn`: view (the same four)

### 3.1 PO list
- **Search:** PO no, party, quality.
- **Filters** (multi-select, URL state, chips): status, party, quality, date range.
- **Desktop / tablet:** a **table** with columns PO no, date, party, qualities (first + "+2"), ordered kg, received kg, pending kg, a slim progress bar, status badge, amount.
- **Phones:** cards.
- **Status:** **Open → Partly received → Received**, or **Closed** (closed short by hand) / **Cancelled** (only while nothing is received).

### 3.2 Create / Edit PO (full screen; tablet layout §9)
**Header fields:**
- **Date*** (prefilled today)
- **PO no.*** (numeric input, **unique**, live availability check like design codes)
- **Party*** (searchable `Select` from Yarn parties + ➕)
- **Remark** (textarea)

**Lines** (at least one): a compact editable table with columns **Yarn quality*** (Select + ➕) · **Quantity (kg)*** (> 0, 3 decimals) · **Rate (₹/kg)*** · **Amount** (read-only = kg × rate). Add line / remove line.

**Footer:** the **total kg** and **total amount**, then **Save**.

Edit is allowed while nothing is received; after that only the remark can change.

### 3.3 PO details screen
- **Header:** PO no, date, party (name, mobile, GSTIN), status, remark, created by. Actions: **Receive challan**, **Print PO**, **Edit**, **Close PO**, **Cancel**.
- **Lines table:** quality · ordered kg · received kg · pending kg · rate · amount · a progress bar.
- **Challans received** (newest first): challan no, date, zone, received by, kg per quality, total kg, notes. Each challan can expand to show its lines.
- **Activity:** created, received, edited, closed.

### 3.4 Receive challan (full screen)
**Fields:**
- **Challan no*** (the party's number)
- **Date*** (today)
- **Zone*** (big tappable options: **Direct consumption · TFO · Warping**)
- **Notes**

**Lines:** one row per **PO line** showing quality, ordered and pending kg, with inputs **Received kg** (≥ 0; at least one line > 0) and **Boxes / cones** (optional).
- Receiving more than the pending quantity is allowed **with an amber warning**, not blocked.

**On save (one transaction):**
- create the receipt + its lines
- add **raw yarn** stock to the chosen zone in the ledger (§6), per quality
- update the PO received totals and status

### 3.5 Print PO (`/print/yarn-po/:id`)
A4 portrait, the same style as the existing prints:
- the company header (`COMPANY`) and **`!! YARN PURCHASE ORDER !!`**
- `M/s <party>`, mobile, address, GSTIN
- PO no + date
- a table **Sr | Yarn quality | Qty (kg) | Rate (₹/kg) | Amount**
- totals and the remark
- `For, RIVOORA ETHNIC FASHION` / Authorised Signatory

---

## 4. Yarn Inventory module (`/yarn`): **zones**

Permission `canUseYarnInventory`: Jenish, Gaurang, Supervisor, Godown supervisor (all can transfer / withdraw / run programs / warping).

### 4.1 Main screen
- **Top KPI row** (calm tiles):
  - **Raw yarn** (kg, all zones)
  - **Twisted yarn** (kg)
  - **Beams** (count)
  - **TFO programs running**
  - **Warping in process**
- **Three large zone panels**, not small tabs. Each panel is a clearly separated **zone**, with:
  - its own soft accent colour and icon, and the zone name large
  - **Raw yarn kg**, **Twisted yarn kg** and **Beams** (beams only in Direct consumption and Warping)
  - for TFO: running sections "3 of 10 running"; for Warping: jobs in process
  - two clear buttons: **Transfer** and **Withdraw**. In TFO, Withdraw is labelled **Run program**; in Warping it's **Start warping**.
  - tapping the panel body opens the **zone screen** (§4.2)

  **Layout:** desktop 3 across; tablet portrait and landscape 3 across in a compact form (§9); phones stacked.
- **Recent movements:** the last 10 ledger entries (time, zone, what, kg / beams, by whom), plus **View all**.

### 4.2 Zone screen (`/yarn/:zone`)
- **Header:** zone name + the same two actions.
- **Stock by quality:** a table of quality · raw kg · twisted kg (and for beams: a **Beams** list with beam no, quality, taar, panna, meters, made on).
- **TFO:** the **machine board** (§5.2) is the main content.
- **Warping:** the **jobs in process** list (§5.3) plus stock.
- **Movements:** this zone's ledger, filterable by type (Receipt / Transfer in / Transfer out / Withdraw / TFO / Warping), quality and date.

---

## 5. Zone actions

### 5.1 Transfer (every zone)
A dialog with:
- **From zone** (current) → **To zone*** (the other two)
- **What*:** Raw yarn / Twisted yarn / Beams
  - yarn: **Quality*** (only qualities with stock in the From zone, showing the available kg) + **kg*** (≤ available)
  - beams: **select beams** (checklist of beams in the zone)
- Note

**Rules:**
- Beams can move only between **Direct consumption** and **Warping**.
- **No negative stock**, ever (server-checked inside the transaction).
- One transaction: a ledger **transfer out** + **transfer in** pair with the same transfer id.

### 5.2 Withdraw by zone

**Direct consumption → Withdraw** (yarn or beams used directly):
- **What*:** Raw yarn / Twisted yarn / Beams
  - yarn: quality + kg
  - beams: select beams. Each selected beam is marked **Consumed** (date, by, note) and the count reduces. No loom link.
- Note. A ledger **withdraw** entry is written.

**TFO → Run program** (machine board):
- **Board:** each active TFO machine is a **rectangular machine card split horizontally into two sections: A (top) and B (bottom)**, labelled **1A / 1B**, **2A / 2B**…
  - **Idle section:** calm grey, with a "+ Assign program" affordance.
  - **Running section:** tinted with the TFO accent and a subtle running indicator (small pulsing dot), showing:
    - quality
    - TPM · direction
    - raw kg loaded
    - running time (`useNow` + `formatElapsed`)
  - **Tap a section** to assign a program (idle) or open its program (running).
  - **One program per section at a time.**
  - **Grid:** phones 2 per row, tablet portrait 3, tablet landscape / laptop 4, desktop 5–6. The machine number is large and the sections are big enough to tap (≥ 72px tall).
- **Assign program** (dialog / side sheet). Fields:
  - **Machine + section** (pre-filled from the tap, read-only)
  - **Raw yarn quality*** (TFO-zone stock, showing the available kg) + **Raw yarn kg*** (≤ available): **deducted from TFO raw stock now**
  - **Output quality*** (the yarn quality the twisted yarn will be recorded as; defaults to the raw quality)
  - **Winding meter**, **Denier / Filament**, **TPM***, **Direction*** (S / Z, two tappable options)
  - Note

  Save → the program starts on that section (ledger **TFO issue**).
- **Stop / close program** (from the running section):
  - asks **Twisted yarn produced (kg)*** and optionally **meters**
  - the produced kg **may differ** from the raw kg issued; it's not called wastage, just show both numbers
  - optional **Raw yarn returned (kg)**, which goes back to TFO raw stock

  Save → **twisted yarn kg is added to TFO stock** under the output quality (ledger **TFO output**), and the section becomes idle.
- **Program history** per machine section and in the zone movements: issued kg, produced kg, returned kg, times, parameters, by whom.

**Warping → Start warping:**
- **Inputs:** add one or more rows. Each row is **Raw** or **Twisted** · **Quality*** · **kg*** (≤ available in the Warping zone). Any mix is allowed: only raw, only twisted, or both.
- Optional job note.
- Save → a **warping job** is created with status **In process**, and the inputs are **deducted from Warping stock** (ledger **warping issue**).
- **In-process list:** job no (counter `warping_job_no`, shown **WJ-1**), started, the inputs summary, by whom, **Mark done**.
- **Mark done:** a form to add **one or more beams**. Each beam has:
  - **Taar*** (ends, integer)
  - **Panna*** (width, number)
  - **Meters*** (number)
  - **Quality*** (yarn quality)
  - **Keep in*** (Direct consumption / Warping)

  Each beam gets a number from the counter `beam_no`, shown **BM-1**. Save → the job is **Done**, the beams are created in their chosen zones (ledger **beam created**).

---

## 6. Data model (new tables only)

**Masters:**
- `yarn_parties`
- `yarn_qualities`
- `tfo_machines` (`machine_no` unique among active)

**PO:**
- `yarn_pos`: `po_no` (integer, unique), `po_date`, `party_id`, `remark`, `status`, created by user/role, `closed_at`, `cancelled_at`
- `yarn_po_lines`: `po_id`, `quality_id`, `qty_kg`, `rate`
- `yarn_receipts`: `po_id`, `challan_no`, `receipt_date`, `zone`, `notes`, received by
- `yarn_receipt_lines`: `receipt_id`, `po_line_id`, `quality_id`, `qty_kg`, `boxes`

**Stock ledger: the single source of truth for yarn quantities.** `yarn_stock_moves`:
- `id`, `zone` (`direct` | `tfo` | `warping`), `item` (`raw` | `twisted`), `quality_id`
- `qty_kg` (signed: + in, − out; stored to 3 decimals; use exact integer grams or a decimal-safe approach so the totals never drift)
- `kind` (`receipt` | `transfer_in` | `transfer_out` | `withdraw` | `tfo_issue` | `tfo_output` | `tfo_return` | `warping_issue`)
- `ref_type` + `ref_id` (receipt / transfer / program / job), `note`
- `user_id`, `role`, `created_at`

**Balance** = the sum per zone + item + quality. Every write checks the balance inside the transaction, so it can never go negative.

**Beams:** `beams`:
- `beam_no` (from the counter), `zone` (`direct` | `warping`), `quality_id`, `taar`, `panna`, `meters`
- `status` (`in_stock` | `consumed`), `warping_job_id`, `consumed_at/by/note`

`beam_moves` (created / transferred / consumed history).

**TFO:** `tfo_programs`:
- `machine_id`, `section` (`A` | `B`), `raw_quality_id`, `raw_kg`, `output_quality_id`
- `winding_meter`, `denier_filament`, `tpm`, `direction` (`S` | `Z`), `note`
- `status` (`running` | `completed`), `started_at/by`, `stopped_at/by`
- `twisted_kg`, `twisted_meters`, `returned_raw_kg`

Add a unique partial index: one running program per (`machine_id`, `section`).

**Warping:**
- `warping_jobs`: `job_no` (counter), `status` (`in_process` | `done`), `note`, started/done by + times
- `warping_job_inputs`: `job_id`, `item`, `quality_id`, `qty_kg`

**Counters:** `warping_job_no`, `beam_no`. The PO no is typed by the user, so it has no counter.

Put the pure maths in `shared/src/yarn.ts`, with **tests**:
- balances from moves
- the transfer / withdraw / program / warping validations
- PO received / pending / status
- amounts
- kg rounding

---

## 7. API (all new; zod-validated; one transaction per write)

| Method | Path | Permission |
|---|---|---|
| CRUD | `/yarn-parties`, `/yarn-qualities`, `/tfo-machines` + `/lookup/yarn-parties`, `/lookup/yarn-qualities` | manage: `canManageYarnMasters` (lookups: + `canManageYarnPo` / `canUseYarnInventory` / `canReceiveYarn`; quick-add party/quality from the PO form: `canManageYarnPo`) |
| GET / POST / PUT | `/yarn-pos`, `/yarn-pos/:id`, `GET /yarn-pos/check-no?no=`, `POST /yarn-pos/:id/close`, `/cancel` | view `canViewYarn`; write `canManageYarnPo` |
| GET | `/yarn-pos/:id/print` | `canManageYarnPo` |
| POST | `/yarn-pos/:id/receipts` | `canReceiveYarn` |
| GET | `/yarn/summary`, `/yarn/zones/:zone`, `/yarn/moves?zone=&kind=&quality=&from=&to=&page=` | `canUseYarnInventory` |
| POST | `/yarn/transfers`, `/yarn/withdrawals` | `canUseYarnInventory` |
| GET | `/yarn/tfo/board` · POST `/yarn/tfo/programs` · POST `/yarn/tfo/programs/:id/stop` | `canUseYarnInventory` |
| GET | `/yarn/warping/jobs?status=` · POST `/yarn/warping/jobs` · POST `/yarn/warping/jobs/:id/done` | `canUseYarnInventory` |
| GET | `/yarn/beams?zone=&status=` | `canUseYarnInventory` |

Board, summary and zone endpoints use aggregate queries (no per-machine / per-quality query loops). Use React Query keys `['yarn', …]`, and invalidate `['yarn']` after every yarn write.

---

## 8. Navigation and roles

- New nav items: **Yarn inventory** (`/yarn`) and **Yarn PO** (`/yarn-po`) for Jenish, Gaurang, the Supervisor and the Godown supervisor (Yarn PO is read + receive for the supervisors).
  - Follow the existing bottom-bar rules (`phoneOrder`, the **More** sheet).
  - The masters go in the **Masters** hub (Jenish / Gaurang).
- The Supervisor and Godown supervisor keep everything they have today. Make sure their landing pages and existing nav are unchanged.
- **Not affected by Hold / Close order** (yarn isn't linked to orders). Don't add these routes to the order hold guard.

---

## 9. Tablet layouts: design them properly (important)

On tablets, forms currently become **one field per full-width row**, which wastes space and forces scrolling. For **every new screen in this sprint**, design the **tablet layout explicitly** (768–1023px portrait and 1024–1279px landscape), not just a stretched phone layout:

**Forms:**
- Use a grid: **2 columns on tablet portrait, 3 on tablet landscape / desktop**.
- Size fields by content: short numbers (kg, rate, TPM, taar, panna, meters, PO no, date) take narrow columns; quality / party selects take wider ones; only textareas span the full row.
- Group related fields in labelled sections (e.g. "Twist settings: TPM · Direction · Winding meter · Denier/Filament" on one row on tablets).

**Line tables** (PO lines, receipt lines, warping inputs, beams on Mark done): a **real table row per line** on tablet and desktop (all fields in one row), and stacked cards **only on phones**.

**Dialogs:**
- centred and wide enough on tablets (e.g. max 720–880px), with the sticky footer (`kb-bar`) above the keyboard
- **side sheets** for Assign program / Transfer on landscape tablets

**Lists:** tables from 768px; cards only below 768px.

**Zone panels:** 3 across from 768px (compact), stacked on phones.

**TFO board:** see §5.2. Sections must stay large enough to tap.

**Before calling a phase done:** take screenshots at **768 and 1024** (as well as 360 and 1280) of every new form, dialog and list. Fix any screen where fields sit one per row on a tablet without a reason.

At the end, also **list (don't fix)** existing screens that show the same one-field-per-row tablet problem, so we can plan a follow-up.

---

## 10. Quality checklist

- **Shared tests (`yarn.test.ts`):**
  - ledger balances
  - no negative stock (transfer / withdraw / TFO issue / warping issue)
  - PO statuses and partial receipts (incl. over-receipt warning)
  - program issue/stop with a returned raw kg
  - a warping job → several beams in different zones
  - beam transfer only between Direct consumption and Warping
  - beam consume
  - the unique PO no
- **A check script** (local file DB only), e.g. `scripts/check-sprint17.mjs`:
  - PO with 2 qualities → 2 partial challans into different zones
  - transfer raw from Direct consumption → TFO
  - run a program on 3A, stop with twisted kg ≠ raw kg + returned raw
  - transfer twisted → Warping
  - start warping with raw + twisted → done → 2 beams (one to Direct consumption, one stays in Warping)
  - consume a beam
  - totals reconcile with the ledger at every step
- **Regression:** the existing modules (orders, production, taka entry, QC, butta / mill, dispatch, inventory, login) work as before for every role.
- **Design pass** with screenshots at 360 / 768 / 1024 / 1280px for every new screen (§9).

## 11. Build phases

1. **Migration + shared** (`yarn.ts`, tests) + masters (Yarn parties, Yarn qualities, TFO machines) + permissions + nav.
2. **Yarn PO:** list, create/edit with lines + quick-adds, details, receive challan (into a zone), print, close/cancel.
3. **Yarn Inventory main screen:** zone panels, KPIs, recent movements, the zone screens with stock, beams and the movements ledger.
4. **Transfer + Direct consumption withdraw** (yarn + beams).
5. **TFO machine board:** assign program, running view, stop.
6. **Warping:** start job, in-process list, mark done → beams.
7. **Tablet layout pass** (§9) + polish + the check script + regression; update `CLAUDE.md` + `PROJECT_STATE.md`.
