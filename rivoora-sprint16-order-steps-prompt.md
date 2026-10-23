# Rivoora Textile — Sprint 16: Order steps (Production · Butta cutting · Mill), outside production POs, direct FG purchase, Close order

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first (up to **Sprint 15**: live jobsheet numbers, Hold order, godown supervisor Orders, split damage picker). The app is **live with real data**.

This sprint changes how an order flows through the **whole system**. It must be done **carefully, without breaking anything that works today.**

**Safety rules (they come before everything else)**
- **Every migration is additive** (new tables/columns with defaults, backfills that only fill new columns). **No table rebuilds, no dropped or renamed columns.** If you believe a rebuild is unavoidable, **stop and explain why** before writing it.
- Test every migration on a **local file DB copy** first. Then tell me **exactly** what `npm run db:migrate` will change on Turso before I run it. **Never** run wipe / seed scripts against Turso.
- **Existing orders must behave exactly as today** after the migration (see §2 backfill). Write a check script that proves it.
- Work in small steps, one commit per step. After each step, run `npm run typecheck`, `npm test`, the existing check scripts (`check-auth`, `check-sprint13`, `check-sprint15`) and a role-by-role regression of the main flows.
- **New write endpoints must be added to `WRITE_RULES` in `middleware/hold-guard.ts`** (hold) and respect **Close** (§8).
- Every new order-level takas query uses the free-stock rule (`takaInOrder`, `effectiveOrderId`) and the hold filter (`orderNotHeldFor`).
- UI: keep the current look; follow the visual rules from Sprint 8 §11; sticky bars carry `kb-bar`. Do a screenshot pass at 360 / 768 / 1280px for every new or changed screen.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in **plan mode**. The plan must list:
   - the data model, incl. how outside takas relate to jobsheets (§5.4)
   - the routing helper
   - **every** screen / query / permission you'll touch, grouped by role
   - the migration and backfill
   - the test plan

   **Wait for my OK.**
2. Build in the phases at the end. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. The idea

The client sometimes does a step himself, sometimes gives it outside, and sometimes buys finished goods. Each order now says **which of the three main steps happen in our system**:

**Production · Butta cutting · Mill**: multi-select, **all ticked by default** when creating an order.

After the **last ticked step**, every order always ends with **Dhruvil's part**: final takas in the godown → tick → ready for dispatch → dispatch / GR. That part is unchanged.

**What happens for each combination:**

| Steps ticked | What happens |
|---|---|
| Production + Butta + Mill | as today: taka entry → butta → Butta QC → mill → Mill QC → Dhruvil |
| Production + Mill | taka entry → **waiting for mill** → mill → Mill QC → Dhruvil |
| Production + Butta | taka entry → butta → Butta QC → **Dhruvil (final)** |
| Production only | taka entry → **Dhruvil (final)** |
| Butta and/or Mill, **no Production** | **Outside production:** POs to outside weavers (§4) → receive challans with weaver takas (§5) → next ticked step → Dhruvil |
| **Nothing ticked** | **Direct FG purchase** (§6): receive finished goods (or take from inventory) → Dhruvil → dispatch |

Production can **also** be partly outside: on an order **with** Production ticked, Jenish / Gaurang can still create outside POs for the part made outside (§4).

---

## 2. Data: order steps

- New columns on `orders` (additive): `has_production`, `has_butta`, `has_mill` (booleans, NOT NULL with defaults).
- A derived kind, in one shared helper `orderKind(order)`:
  - `in_house` (Production ticked)
  - `outside_production` (no Production, Butta and/or Mill ticked)
  - `fg_purchase` (nothing ticked)
- **Backfill for existing orders** (they must behave exactly as before):
  - `has_production = 1`, `has_mill = 1`
  - `has_butta` = the design's current "Goes for butta cutting" (the variation's parent design); **1 when the order has no design**, matching the old `initialTakaStage` rule
- **The design setting no longer decides anything by itself.** It only **pre-fills** the Butta tick on Add order. **The order's ticks decide.**

### 2.1 Add / Edit order
- **At the top of the form:** a row of three **multi-select tappable pills** with clear on/off states: **Production · Butta cutting · Mill**. All are on by default.
  - When a design is picked, Butta follows the design's setting until the user taps Butta themselves.
- **Helper line under the pills, by kind:**
  - in-house: "Jobsheets → taka entry → Butta → Mill → Dispatch" (only the ticked ones)
  - outside production: "You'll create POs to outside weavers from the order"
  - nothing ticked: "**Direct FG purchase**: goods will be received ready, then dispatched"
- **Editing steps later** (Jenish, Gaurang; permission `canEditOrderSteps`):
  - **Unticking** a step is blocked once any taka has reached that step. For Production: once any jobsheet exists. Show an inline reason.
  - **Ticking** a step later affects only takas that haven't passed that point yet.
  - Every change writes a history entry ("Steps changed: Butta removed").
- Show the steps compactly on the **order card** (small "P · B · M" dots or tags, or an **"FG purchase"** / **"Outside production"** tag), the **order header** and the **Order details** tab.
- **Orders list filter:** **Order kind** (In-house / Outside production / FG purchase), multi-select, with URL state and chips like the others.

---

## 3. One routing rule for every taka

Replace every place that decides a taka's next stage (`initialTakaStage(design)`, `stageAfterButtaQc`, the post-receipt / post-QC transitions) with **one shared helper**, e.g. `nextTakaStage(order, from, taka)` in `shared/src/pipeline.ts`, with full tests:

| From | Next stage |
|---|---|
| **taka entry**, or **received from an outside weaver** (§5) | `entered` (waiting for butta) if Butta is ticked; else `waiting_mill` if Mill is ticked; else **`final`** (Dhruvil) |
| **Butta QC done** | `waiting_mill` if Mill is ticked **and** the taka hasn't been to the mill (keep `has_been_to_mill` / ancestor rule); else **`final`** |
| **Mill QC done** | `final` (as today) |
| **FG purchase receipt** (§6) | `final` |

**Rework / refinish stays allowed as an exception**, even when a step isn't ticked: Jenish **and Gaurang** can send a taka back to butta cutting or the mill (existing `canReworkTakas`, give it to Gaurang if he doesn't have it). It's tagged **Refinish / Re-butta** as today. After it comes back and passes QC, it returns to `final`.

Butta / Mill **Pending** lists, QC routing and the dashboard then follow naturally. Verify that no order shows takas in a step it didn't tick, except rework.

---

## 4. Outside production: POs to outside weavers

### 4.1 Weaver master (new)
Masters hub → **Weavers** (Jenish, Gaurang: `canManageWeavers`):
- Name*
- **Short code*** (letters only, 1–4, uppercase, unique among active weavers, auto-suggested from the name's first letter(s) and editable; used in taka numbers, §5.2; `FG` is reserved)
- Mobile, Address, GSTIN, Notes
- Soft delete, blocked (409) if used on a PO
- Uses `MasterList` + a full-screen form, like the other masters

### 4.2 Outside PO (new)
- **Who:** Jenish and Gaurang (`canCreateOutsidePo`).
- **Where:** the order details page, in a new **Outside production** tab. It's shown for orders without Production, **and** on in-house orders as "Give part outside".
- **Fields:**
  - weaver* (from the master)
  - quality* (material; defaults to the order's)
  - quantity* + unit (pcs / meters)
  - order type* (Lump / Pcs to pcs; defaults to the order's)
  - **rate** (₹, optional)
  - PO date (today)
  - notes
- **PO number:** from a counter `outside_po_no`, shown **PO-1, PO-2…**, never reused.
- **Printable PO** (`/print/outside-po/:id`), A4 portrait, same style as the other prints:
  - the company header, `!! PURCHASE ORDER !!`
  - `M/s <weaver>`, address, mobile, GSTIN
  - PO no, date
  - quality, quantity + unit, type, rate, notes
  - `For, RIVOORA ETHNIC FASHION` / Authorised Signatory
- **PO status:** **Open → Partly received → Received**, or **Closed** (manually by Jenish/Gaurang, or when the order closes). Show ordered / received / pending (in the PO's unit; for meters POs, sum the meters; for pcs POs, sum the pcs).
- **Edit / cancel:** allowed only while nothing has been received.
- **Partial outside on in-house orders:** pcs-unit POs reduce the order's **frames needed** for jobsheets. Use `orderJobsheetPlan` with `orderedPieces − outside PO pcs`, so the coverage warnings stay right. Show a quiet line in the Jobsheets section: "120 pcs given outside (PO-3)".

---

## 5. Receiving goods from an outside weaver (against a PO)

### 5.1 Who and where
- **Who:** Jenish, Gaurang, the **godown supervisor** and **Dhruvil** (`canReceiveOutside`).
- **Where:**
  - from the order's **Outside production** tab (each PO → **Receive challan**)
  - from a new module **Receive goods** (`/receive-goods`) for the godown supervisor and Dhruvil, listing **open POs** (PO no, weaver, order #, quality, pending qty) and **FG orders awaiting goods** (§6)
- The godown supervisor sees **no client name / rate** there, as elsewhere.

### 5.2 The receipt form (full screen, keyboard-fast like Taka entry)
**Header:**
- the weaver's **challan no*** and **date*** (today)
- notes

**Rows:**
- **Weaver taka no*** (numeric)
- **pcs*** then **meters**, the same order as Taka entry (pcs before meters)
- Damage: the shared damage popup (§7), with the type **Weaver damage**, damage name, damaged pcs and optional photos

The form also shows running totals (takas, pcs, meters), Add row, and "Enter → next".

**"Add our taka numbers" button** (small, top right of the table): shows an extra column **Our taka no**, **pre-filled with our next numbers** from the normal taka counter (the same as Taka entry's `GET /takas/next-numbers`). They're editable, live-checked for uniqueness, and the column can be hidden again (its values are kept).

**Numbering rules** (one shared helper with tests, e.g. `outsideTakaNumber`):
- **Our number typed** → the taka's system number = **our number**, and the weaver number is stored beside it.
- **Only the weaver number** → the system number = **weaver short code + weaver number**, e.g. Shree Textiles (code **S**) + 1101 → **S1101**. Split parts later become **S1101A**.
- Extend `TAKA_NO_REGEX` / `cleanTakaNo` / `compareTakaNo` to allow a **1–4 letter uppercase prefix** (`^[A-Z]{0,4}\d+([-/]\d+)*[A-Z]?$`). Check every place that parses taka numbers (scan, receive, QC, split, edit takas) and add tests.
- **Uniqueness:**
  - the **system number** stays unique across the whole system (existing index); a clash blocks the row with a clear message
  - the **weaver number** must be unique **per weaver** (the same weaver can't send 1101 twice): a new partial unique index on (`weaver_id`, `weaver_taka_no`) where not deleted, plus an inline check

**On save (one transaction):**
- create the **receipt** record
- create the takas: `source = 'outside_po'`, `weaver_taka_no`, `has_own_number`, `outside_receipt_id`, meters, pcs, damages (`found_at = 'weaver'`, `recorded_at = 'outside_receipt'`)
- each taka's stage comes from `nextTakaStage(order, 'outside_receipt')` (§3)
- write taka events (`received_outside`)
- update the PO's received totals and status
- recompute the order status

### 5.3 Which number is printed and searched
**Prints** (butta / mill challans, the client delivery challan, the jobsheet print doesn't apply): in the **Taka No** column:
- if **our number** was typed → print **our number**
- if only the **weaver number** exists → print the **weaver's exact number** (e.g. `1101`, **not** `S1101`)
- if both exist → our number

One helper, `printTakaNo(taka)`, used by every print.

**Screens** show the system number, plus "W 1101" small when a weaver number exists.

**Typing a number** anywhere a taka is looked up (Butta receive by taka number, QC open, Mill QC, search, split, GR, etc.) must **also match the weaver number**, because the physical taka may only carry the weaver's number. If more than one taka matches, show a small **"Which one?"** picker (taka · weaver · order #). Put this in one shared server lookup used by all of these.

### 5.4 Outside takas and jobsheets (important design decision)
`takas.jobsheet_id` is NOT NULL today, and many queries join takas → jobsheets. **Don't rebuild the takas table.** In plan mode, choose and explain one of these:
- **(a) Recommended:** one hidden **external jobsheet per order** (`jobsheets.is_external = 1`, number from a separate counter that is never shown) that outside / FG takas point to.
  - It must be excluded **everywhere** jobsheets are listed or counted: supervisor lists, Order view, Machine view, the order Jobsheets tab, coverage / `orderJobsheetPlan`, taka entry lists, QR / by-no, print, milestones, dashboard production KPIs.
  - Use **one** SQL helper / filter (e.g. `realJobsheet`) and grep every jobsheet query.
- **(b)** Another additive approach you find safer. It must still keep all existing joins correct for in-house takas.

Show outside / FG takas grouped by **receipt** (weaver challan no · PO no) in the Takas tab instead of by jobsheet.

---

## 6. Direct FG purchase (nothing ticked)

- The order is a **Direct FG purchase**. There's no PO, no production, no QC.
- **Receive FG challan** (Jenish, Gaurang, godown supervisor, Dhruvil; from the order and from **Receive goods**):
  - **Supplier name*** (typed, no master)
  - supplier challan no*
  - date
  - notes
  - **Lump orders:** rows like §5.2 (weaver / supplier taka no*, pcs, meters, damage). Damage type: **Weaver damage**, labelled "Weaver / supplier damage" for FG.
    - Numbering: our number if typed (with the same "Add our taka numbers" button); otherwise **`FG` + the number** (e.g. FG1101).
    - If that already exists → block the row and ask for our number.
    - Printing / lookup follow §5.3.
  - **Pcs-to-pcs orders:** only **received pcs*** (+ damaged pcs + damage, optional). The system creates one **"Received lot"** taka automatically (our next number, `is_received_lot`, like the GR return lot).
  - Takas go to **`final`** → Dhruvil's normal flow (tick → ready → dispatch).
- **Attach from inventory:** the existing **Add from free stock** works for FG orders too (same design/variation), so stock can be dispatched without a purchase.
- FG orders show in Dhruvil's Orders once they have any taka (received or attached). Before that they're listed under **Receive goods** as "Awaiting goods".

---

## 7. Damage types follow the order's steps

The damage type radio (shared `DamageDialog` / `DamageTypeRadio`) shows **only the types that apply** to that taka:

| Type | When it's shown |
|---|---|
| **Machine damage** | the taka came from our production |
| **Weaver damage** (new `found_at = 'weaver'`) | the taka came from an outside PO or FG receipt |
| **Butta cutting damage** | the order has Butta ticked, **or** the taka has been to butta cutting (rework) |
| **Mill damage** | the order has Mill ticked, **or** the taka has been to the mill (rework / refinish) |

- If only **one** type applies, pre-select it (still visible).
- GR keeps its optional type, with the same filtered options.
- **Old damages keep their stored type.**
- Add "Weaver damage" to the dashboard damage strip, the Damages tab, the Inventory → Damaged filters, the godown chips and the share message. Show it only when > 0, like the legacy types.
- **QC** only offers Butta QC for butta orders/takas and Mill QC for mill takas (routing already ensures this; verify).

---

## 8. **Close order** (any order, any time)

- **Who:** Jenish and Gaurang (`canCloseOrder`).
- **Where:** the order header, **Close order**. Use a destructive-style confirm with a short summary of what will happen and an optional note.
- If jobsheets are **on the loom**, ask for the **frames completed** per jobsheet (reuse the Hold dialog's component), then complete them. **No** remaining-frames jobsheet is created.

**On confirm (one transaction):**
- **Pending / Sent jobsheets** → cancelled (soft delete or a `cancelled` flag; never hard delete), with events.
- **Open outside POs** → Closed.
- **Takas with us that aren't dispatched** (any stage except `at_butta`, `at_mill`, `dispatched`) → **free stock**, with `free_stock_reason = 'order_closed'`. Add the reason to labels.
- **Takas at butta / mill:** stay; they can still be **received**, and on receive (or QC) they go to **free stock** instead of back to the order.
- The order gets **`is_closed`** + `closed_at`, `closed_by_user_id`, `close_note`, and a new status **`closed`** ("Closed", neutral grey badge; it overrides every other status in `orderStatusForJobsheets`).
- History entry: "Order closed".

**After close:**
- writes are blocked like hold (409 "Order #26 is closed"), except receive endpoints
- hidden from the work lists of the supervisor, taka entry, QC, godown supervisor and Dhruvil
- still visible to Jenish / Gaurang (badge), and in Dispatched for what was dispatched
- No reopen in this sprint.

---

## 9. Every part of the system must respect the steps

Go through **each** item and handle it. Mark each in your plan and final summary.

- **Order dashboard** (`buildOrderDashboard`, config in `pipeline.ts`):
  - show **only the main stages that are ticked**, plus the Ready / Dhruvil stage
  - unticked stages are **hidden**, not "Skipped"
  - orders without Production show an **"Outside production"** card in Production's place: POs count, ordered / received / pending qty, takas received, and a sub-stage "At outside weaver"
  - **in-house orders with outside POs** show a small "Outside" sub-stage under Production
  - **FG orders** show a **"Purchase"** card: awaiting / received
  - the progress bar uses only the ticked stages
  - alerts don't mention jobsheets for orders without Production
- **Order details tabs:**
  - **Jobsheets** only when Production is ticked
  - **Outside production** when POs exist or Production isn't ticked
  - FG orders get a **Purchase** tab, or show their receipts inside Takas
  - the **Docs** tab lists outside POs (print) and receipts
- **History / milestones** (`orderMilestones`):
  - add **"PO placed"** and **"Received from weaver"**, and **"Goods received"** for FG
  - production steps appear only when Production is ticked, butta/mill steps only when ticked
  - durations between the steps that exist
- **Supervisor:** orders without Production never appear (no jobsheets). The Order view / Machine view exclude external jobsheets.
- **Taka entry:** only real jobsheets. QR / by-no ignore external jobsheets.
- **QC:** lookup by our or weaver number (§5.3); damage types filtered (§7).
- **Butta cutting / Mill modules:** Pending lists follow the routing. Prints use `printTakaNo`. The Receive-by-number lookup matches weaver numbers too.
- **Godown supervisor Orders scope** (`godown-scope.ts`): include outside / FG orders once they have takas.
- **Dhruvil:** FG and outside orders flow into his Orders once takas reach `final`. Dispatch / GR unchanged; the delivery challan uses `printTakaNo`.
- **Inventory** (`orderInventoryPcs`):
  - takas from outside / FG count like any taka by stage
  - **pending outside PO quantity** (pcs POs) counts as **In making** ("at outside weaver")
  - FG orders with no goods yet show nothing in making
  - free stock from **closed** orders counts as free stock
- **Status rules** (`orderStatusForJobsheets`):
  - add **`closed`** (overrides everything)
  - add **`outside_production`**: "At outside weaver", shown when the order has no Production, has open POs and no taka received yet
  - add **`awaiting_goods`**: "Awaiting goods", FG with nothing received yet
  - once takas exist, the existing stage-based rules apply
  - give each status a distinct calm badge colour, visible to Jenish / Gaurang (+ Dhruvil where relevant)
- **Orders list:** the kind filter (§2.1), and tags on cards.
- **Hold** (Sprint 15): hold works for every kind; add all new write endpoints to `WRITE_RULES`; the hold dialog also lists open POs (informational).
- **Free stock** rule and **Add from free stock**: work for every kind (FG included).
- **Edit takas** (Jenish/Gaurang): works for outside takas (edit weaver no / our no with the same uniqueness rules).
- **Split:** works for outside takas (parts `S1101A` / `25A`; `printTakaNo` uses our number if present, else the weaver number + letter).
- **Search everywhere** (orders search, Dispatched search, inventory search, challan search): also matches weaver taka numbers and PO numbers.
- **Seed / demo data:** leave it untouched, except adding one demo weaver if the seed is idempotent.

---

## 10. API summary (new or changed)

| Method | Path | Notes | Permission |
|---|---|---|---|
| PUT | `/orders/:id/steps` | `{ hasProduction, hasButta, hasMill }`, with the untick guards | `canEditOrderSteps` |
| CRUD | `/weavers`, `GET /lookup/weavers` | the master | `canManageWeavers` (lookup: + `canCreateOutsidePo`, `canReceiveOutside`) |
| GET / POST / PUT | `/orders/:id/outside-pos`, `/outside-pos/:id`, `POST /outside-pos/:id/close` | POs | `canCreateOutsidePo` |
| GET | `/outside-pos/:id/print` | print data | `canCreateOutsidePo` / `canReceiveOutside` |
| POST | `/outside-pos/:id/receipts` | `{ challanNo, date, notes?, rows: [{ weaverTakaNo, ourTakaNo?, pcs, meters?, damages[] }] }` | `canReceiveOutside` |
| POST | `/orders/:id/fg-receipts` | lump rows as above + `supplierName` · pcs-to-pcs `{ supplierName, challanNo, date, pcs, damagedPcs?, damage? }` | `canReceiveOutside` |
| GET | `/receive-goods?search=` | open POs + FG orders awaiting goods (no client for restricted roles) | `canReceiveOutside` |
| GET | `/takas/lookup?no=` | matches the system number **or** the weaver number; returns candidates | roles that look takas up |
| POST | `/orders/:id/close` | `{ note?, ongoing: [{ jobsheetId, completedFrames }] }` | `canCloseOrder` |

**Data (additive):**
- `orders`: `has_production`, `has_butta`, `has_mill`, `is_closed`, `closed_at`, `closed_by_user_id`, `close_note`
- tables `weavers`, `outside_pos`, `outside_receipts` (po_id nullable for FG, `supplier_name`, challan no/date, totals)
- `takas`: `source` (`production` | `outside_po` | `fg_purchase`), `weaver_taka_no`, `weaver_id`, `has_own_number`, `outside_receipt_id`, `is_received_lot`
- new partial unique index (`weaver_id`, `weaver_taka_no`)
- `jobsheets.is_external` (if option 5.4a)
- jobsheet cancel flag (if needed)
- counters `outside_po_no`
- damage type `weaver`; free-stock reason `order_closed`; statuses `outside_production`, `awaiting_goods`, `closed`
- events: `received_outside`, `received_fg`, `order_closed`, `steps_changed`

---

## 11. Tests and checks

- **Shared tests:**
  - `nextTakaStage`: every combination of ticks, incl. rework and `has_been_to_mill`
  - `orderKind`
  - `outsideTakaNumber` + `printTakaNo` + the regex with prefixes and split letters
  - weaver-number lookup with several matches
  - `orderJobsheetPlan` with outside PO pcs subtracted
  - the status rules (closed / outside_production / awaiting_goods + existing)
  - dashboard stages per kind
  - milestones per kind
  - inventory pcs with outside / FG / closed
  - damage type options per taka
- **A check script** (local file DB only), e.g. `scripts/check-sprint16.mjs`:
  - migrate a copy of a DB with existing orders and prove they behave the same (stages, statuses, dashboard numbers unchanged)
  - then run one order of **each kind** end to end:
    - P+B+M
    - P+M
    - P+B
    - P only
    - outside + B + M
    - outside + M
    - outside only
    - FG lump
    - FG pcs
    - in-house with a partial PO
    - close mid-way
    - hold an outside order
- **Role regression:** Jenish, Gaurang, Supervisor, Taka entry, QC, Godown supervisor and Dhruvil all still work for existing in-house orders.

## 12. Build phases

1. **Migration + shared:** steps columns + backfill, `orderKind`, `nextTakaStage` (replacing the old helpers), statuses, damage type `weaver`, taka number regex + `printTakaNo`, tests. **Prove existing orders are unchanged.**
2. **Add / Edit order steps** UI + card / header tags + list filter + the steps edit guard.
3. **Weaver master + outside POs** (create / edit / cancel / close / print) + the partial-outside effect on jobsheet coverage.
4. **External jobsheet / data link (§5.4) + receipt form** (weaver numbers, our numbers button, damages) + **Receive goods** module + taka lookup by weaver number everywhere.
5. **FG purchase:** receipts (lump + pcs lot), Attach from inventory, FG in Dhruvil.
6. **Close order.**
7. **Everything else in §9:** dashboard, tabs, milestones, inventory, damage type filtering, search, prints, godown scope, hold rules.
8. **Polish:** screenshots at all breakpoints, the full check script, role regression, update `CLAUDE.md` + `PROJECT_STATE.md`.
