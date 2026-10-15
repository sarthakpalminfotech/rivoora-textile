# Rivoora Textile — Sprint 13: Free stock (Move to inventory), re-butta fix, damage type radio, Returned status, Blouse option

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first, especially Sprint 12: Dhruvil, dispatch, GR, rework, Move to order, login.

**Keep the UI elegant and easy to understand.** Follow the visual rules from Sprint 8 §11:
- calm surfaces, one focal number, small colour accents
- clear labels in plain words, no clutter
- screenshots at 360 / 768 / 1280px with a refinement pass per UI phase

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode: migrations, the free-stock model, status changes, the damage-type change, screens.
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give a short summary.
3. **Database (Turso):** all changes are **additive migrations** (new columns/values with defaults, no table rebuilds, no dropped columns, no data loss). Write them with `npm run db:generate` (+ hand edits where needed), test them on a local file DB copy first, then tell me exactly what `npm run db:migrate` will change on Turso before I run it.
4. Re-test every role's main flow after each phase. Nothing that works today may break.
5. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. Free stock: **Move to inventory** (replaces Move to order)

### 1.1 What changes
- **Remove the "Move to order" action** everywhere (button, dialog, client hooks). Keep the old endpoint only if removing it is risky, but nothing in the UI may call it.
- Add **Move to inventory**: takas (or pcs) leave their order and become **free stock**, meaning stock in Inventory that isn't attached to any order and can be used later for any order.

### 1.2 Data model (additive, no table rebuild)
`takas.order_id` stays as it is: the **origin** order, so history and design/blouse info are kept. Add:
- `is_free_stock` (boolean, default false, indexed)
- `free_stock_at`, `free_stock_by` (role), `free_stock_reason` (`moved` | `goods_return`)
- `allocated_order_id` (nullable; set when free stock is used for another order, §1.6)

**Rule for every order-level query** (dashboards, Takas tab, godown/Dhruvil lists, KPIs, statuses, dispatch, inventory "per order" figures):
- a taka counts for its order **only if it's not free stock**: `is_free_stock = 0`
- or it counts for the order it's been **allocated** to (`allocated_order_id`)

Put this in **one** shared helper / SQL fragment (e.g. `effectiveOrderId`) and use it everywhere. **Grep for every place that filters takas by `order_id`** and update it. Add tests.

### 1.3 Lump orders: move takas
- **Where:** Dhruvil's order screen (`/godown/orders/:orderId`) and the owner's order **Takas** tab (Jemish/Gaurang), as a **Move to inventory** action in selection mode. Rename the permission `canMoveTakas` → `canMoveToInventory` (Jemish, Gaurang, Dhruvil).
- **Selectable:** takas **in any status** that are physically with us:
  - `entered`, `rework_butta`, `waiting_mill`, `butta_qc`, `mill_qc`, `refinish`, `final`, `ready_dispatch`
  - and returned takas
- **Not selectable:** `at_butta`, `at_mill` (outside right now) and `dispatched`, greyed with the reason.
- A taka moved while still in making **keeps its stage** and continues its normal flow (butta / mill / QC) as free stock. A `ready_dispatch` taka goes back to `final` and its tick is cleared.
- **Confirm:** takas count, pcs, meters, and "These takas will leave Order #26 and become free stock for D101N2". Optional note.
- **Save (one transaction):**
  - set the free-stock fields
  - write a `moved_to_inventory` event
  - recompute the order status (§4)

### 1.4 Pcs-to-pcs orders: move a pcs count
These orders don't show taka numbers to the user, so:
- The action asks for **"How many pcs to move to inventory?"** (1 up to the pcs available in the order's godown stages, `final` + `ready_dispatch`).
- The system picks takas automatically: `final` first, then `ready_dispatch`, then largest first.
  - It moves whole takas while they fit.
  - If one taka is needed only partly, it **splits** that taka with the existing split helpers: the kept part stays on the order; the moved part (next letter suffix, meters divided by pcs) becomes free stock.
- **Confirm** shows only pcs (no taka numbers): "40 pcs will leave Order #31 and become free stock".
- The same events and recompute as above. Tests for the selection and split maths.

### 1.5 Inventory shows free stock
On `/inventory`:
- **KPI row:** add **Free stock** (pcs).
- **Item cards:** a small "Free 120" figure when > 0.
- **Item details:** a **Free stock** section with:
  - free pcs ready (`final`), free pcs in making (other stages), free damaged pcs
  - the list of free takas (taka no, pcs, meters, from Order #, reason Moved / Returned, date)
- Free stock is **not counted** in any order's Ordered / In making / Ready figures; it's its own figure.

### 1.6 Using free stock in an order
"Free stock can be used later in the same or another order":
- **Where:** Dhruvil's order screen and the owner's order Takas tab: an **Add from free stock** button, shown when free stock exists for the **same design/variation**.
- **Picker:**
  - free takas of that item, with pcs, meters, stage, blouse option (§5) and origin order
  - takas with a different blouse option than the order show a small amber "Without blouse" / "With blouse" note
  - pcs-to-pcs orders enter a pcs count, picked/split the same way as §1.4
- **Save:**
  - `allocated_order_id` = this order
  - `is_free_stock = 0`
  - `allocated_from_free_stock` event
  - the taka now counts for this order (and keeps its stage)
  - recompute statuses

The same action is available from Inventory item details → **Assign to order** (choose an order of the same item).

---

## 2. Re-butta: split parts (and all takas) must not go to the mill again

**Bug:** a taka that has already been to the mill, then sent back to butta cutting (Re-butta), goes to **Mill → ready to send** after Butta QC, instead of back to us. It happens especially with **split parts** (1101A…), because the part has no mill history of its own.

**Fix:**
- Add `takas.has_been_to_mill` (boolean, default false).
  - **Backfill** it from history: any mill challan row, any `received_mill` / `mill_qc_done` event, or `refinish_count > 0`.
  - Set it whenever a taka is received from the mill / passes Mill QC.
  - **Copy it to split parts** and to return-lot / free-stock parts.
- `stageAfterButtaQc(taka)`:
  - `has_been_to_mill` (of the taka **or any ancestor** through `parent_taka_id`) → **`final`**, back in the godown with its order, or still free stock if it is free stock
  - otherwise → `waiting_mill`

  From there it can be dispatched, used in the same order, or moved to inventory.
- **Check every place that sets a stage after a QC, split, return or rework**, so parts always inherit the parent's stage and history flags.
- **Tests:** a normal taka; a re-butta taka; a split part of a re-butta taka; a split part of a taka that never went to the mill.

---

## 3. Damage type: chosen with a **radio** wherever damage is marked

The client wants the person marking damage to **choose the type**, instead of the system deciding it.

**Data:**
- Keep `taka_damages.found_at` as the **type** the user chose: `machine` | `butta` | `mill`, or **null** for "Not marked" (GR only).
- Add `taka_damages.recorded_at` = **where** it was recorded:
  - `taka_entry`, `edit_takas`, `butta_qc`, `mill_qc`, `godown`, `goods_return`, `split`, `inventory`

  Backfill it from the existing values / events as best you can.

**Damage popup** (the one shared component, used everywhere):
- At the top, a required **"Damage type"** radio group: **Machine damage · Butta cutting damage · Mill damage**.
  - Show them as clean, large tappable radio cards, bilingual on the QC / Taka entry screens: "मशीन खराबी", "बुट्टा खराबी", "मिल खराबी".
  - **Nothing is pre-selected.** The Save button stays disabled until one is chosen, with an inline hint "Choose the damage type".
- **Godown / Dhruvil:** the old automatic "Supervisor marked" type goes away for new damages. They choose from the same three.
- **Goods return (GR):** the radio is **optional**. If nothing is chosen, the damage is saved with type null and shown everywhere as **"Damage type not marked"** (grey).
- Existing damages keep their type. Old `godown` damages show as "Supervisor marked" (legacy, read-only label).

**Everywhere damages are counted or filtered**, use the chosen type, plus a **"Not marked"** bucket when > 0:
- the order dashboard damage strip
- the Damages tab
- Inventory → Damaged filters
- the godown Damage tab chips

The label shows both type and name, e.g. "Mill damage · Hole · 2 pcs". The taka history shows where it was recorded.

---

## 4. Order status after goods return, and when free stock leaves the order

- **When goods come back (GR):** the returned takas (lump) or the return lot (pcs to pcs) go straight to **free stock** (`free_stock_reason = goods_return`). They're **not** attached to the order any more.
  - Damaged returns go to free stock with their damage, so they show in Inventory → Damaged.
  - The revised challan (DC-12 R1) stays as built in Sprint 12.
- **Order completion:** an order whose remaining (non-free) takas are **all dispatched** is complete:
  - if it had **no** goods return → **Dispatched** (as now)
  - if it **had** a goods return → a new status **`returned`**, label **"Returned"** (sequence 145, a distinct calm badge colour, visible to Jemish, Gaurang, Dhruvil), shown **instead of "Partly dispatched"**. Its details show "Dispatched · N takas / N pcs returned to stock" with a link to the GR.
- **Partly dispatched** is used only when the order still has non-free takas that aren't dispatched.
- Moving takas to inventory (§1) also recomputes. An order whose remaining takas are all dispatched becomes Dispatched / Returned.
- Update the shared status function, the tests, and the Dispatched module (filter and badge for "Returned").

---

## 5. Blouse option on orders

**Data:** `orders.blouse_option`, nullable, `with_blouse` | `without_blouse`. Labels **"With blouse"** / **"Without blouse"**.

**Add / Edit order:**
- an **optional** field "Blouse", shown as the same attached two-option control as Order type: **With blouse · Without blouse**
- tapping the selected option again clears it
- a small hint "Optional · shown to production and dispatch"

**Show it everywhere the order is seen** (a small consistent tag, e.g. a soft badge with a tiny icon; **only when set**):
- the order cards, the order header and the Order details tab
- the supervisor's jobsheet cards and order view
- the **jobsheet print**: printed clearly under the Design no / order type, e.g. **WITH BLOUSE**
- the Taka entry identity card, the QC screens (bilingual: "ब्लाउज़ के साथ" / "बिना ब्लाउज़")
- Dhruvil's / godown order screens, the Dispatched module
- the **dispatch challan** (next to Design)
- inventory free-stock rows (taken from the origin order)

### 5.1 Inventory split by blouse
In **Inventory → item details** (and the free-stock section):
- a clean segmented toggle **All · With blouse · Without blouse · Not set**, each with its pcs count
- choosing one filters the KPIs, the orders list and the free-stock list
- show only the options that have data (All is always shown)

### 5.2 Inventory figures on the Add order screen
The Add order screen already shows the inventory status for the chosen design (free pcs available, in making, …).
- When **With blouse** or **Without blouse** is selected, those numbers are **filtered to that option**, with a small caption: "Showing With blouse stock".
- When nothing is selected, show the totals with a quiet breakdown line: "With blouse 120 · Without 80 · Not set 40".
- Include **free stock** in this panel ("Free stock available: 120 pcs"), filtered the same way.

---

## 6. API summary (new or changed)

| Method | Path | Notes | Permission |
|---|---|---|---|
| POST | `/orders/:id/takas/move-to-inventory` | lump `{ takaIds[], note? }` · pcs-to-pcs `{ pcs, note? }` | `canMoveToInventory` |
| GET | `/inventory/items/:key/free-stock?blouse=` | the free takas of an item | `canViewInventory` or `canMoveToInventory` |
| POST | `/orders/:id/takas/add-from-free-stock` | lump `{ takaIds[] }` · pcs-to-pcs `{ pcs }` | `canMoveToInventory` |
| — | inventory, dashboard, godown, dispatch endpoints | apply the free-stock rule (§1.2) and `blouse` filters | — |
| — | every damage write | `type: 'machine' \| 'butta' \| 'mill' \| null` (null only on GR) + `recorded_at` | — |
| — | orders create/edit | `blouseOption` | — |
| ✕ | Move to order | remove from the UI | — |

- Validate with zod.
- One transaction per write, with conditional stage checks and status recompute.
- Invalidate `orders`, `order-dashboard`, `takas`, `godown`, `inventory`, `dispatched`, `challans` after each write.

---

## 7. Quality checklist

- **Shared tests:**
  - the free-stock order rule (a taka counts for exactly one order or for free stock)
  - lump and pcs-to-pcs move-to-inventory (incl. the split)
  - add from free stock
  - `has_been_to_mill` inheritance and `stageAfterButtaQc`
  - the status rules (Partly dispatched / Dispatched / Returned)
  - damage type required vs optional (GR)
  - blouse filtering of inventory figures
- **Numbers reconcile:** for a test design, the sum across orders + free stock = all active takas of that design. No taka is counted twice.
- **Regression:** taka entry, QC, butta/mill send/receive, godown, dispatch, GR and inventory still work for every role.
- **Design pass with screenshots:**
  - the Move to inventory flows (lump + pcs)
  - the free-stock section and the blouse toggle
  - the Add from free stock picker
  - the damage popup with the radio cards (incl. bilingual)
  - the Returned badge
  - the blouse field and tags, the jobsheet print, the Add order inventory panel

## 8. Build phases

1. **Migrations + shared:** free-stock columns, `has_been_to_mill` (+ backfill), `taka_damages.recorded_at` (+ backfill; `found_at` may be null), `orders.blouse_option`, `returned` status, helpers, tests. Test on a local DB copy, then summarise the Turso changes for me.
2. **Re-butta / split fix** (§2) + tests.
3. **Damage type radio** in the shared popup, every caller, counts/filters with "Not marked".
4. **Move to inventory** (lump + pcs to pcs), remove Move to order, free-stock rule across all queries.
5. **Inventory free stock + Add from free stock / Assign to order.**
6. **GR → free stock + Returned status.**
7. **Blouse option** (form, tags everywhere, print, challan, inventory toggle, Add order panel filter).
8. **Polish:** the design pass at all breakpoints, a full regression run, update `CLAUDE.md` + `PROJECT_STATE.md`.
