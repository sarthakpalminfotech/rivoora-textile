# Rivoora Textile — Sprint 22 — Finished stock, goods return against the party, inventory by quality

Prepared 06-11-2026 from the client's confirmed changes (CR-01 … CR-25, `Rivoora-Client-Change-Requests-3-4-Nov-2026`) and his answers of 06-11-2026. Sprints 21 → 25 must be built **in order**; this file is Sprint 22.

## 0. Read this first (rules for this sprint)

You are working on the live Rivoora Textile app (npm workspaces: `shared/`, `server/`, `client/`; Express + Drizzle + Turso; React 18 + Vite + Tailwind + Radix + TanStack Query). The client uses it every day.

**Safety (never break these)**
- The database is the **live Turso DB**. Migrations must be **additive only**: new tables, new nullable columns or columns with a default, new indexes. No dropping, renaming or retyping columns; no rewriting existing rows except a documented backfill.
- **Before running any migration against Turso, stop and tell me.** Remind me to export a backup first, and wait for my "go".
- Never run seed / wipe / reset scripts against Turso. Never put the Turso URL or token in code, the client, a commit, a log or a zip. Never commit `.env` files.
- Never `git init` and never force-push. Work on a branch `sprint-22` and commit after every phase with a clear message.
- **Existing behaviour must keep working** unless this prompt changes it on purpose. When you change a rule, change it in one place (shared helpers / `roles.ts` / `statuses.ts`), not by copying code.
- Server is the source of truth: every rule below is checked on the server (permissions with `requirePermission`, conditional updates inside one transaction, the hold / close guard in `middleware/hold-guard.ts`). The client only mirrors the rules to hide buttons and show messages.

**How to work**
1. Read `CLAUDE.md` (all sprint sections) and `PROJECT_STATE.md`, then the files named in each section of this prompt, **before planning**.
2. Write the plan to `docs/plans/sprint-22-plan.md`: phases, migrations (SQL shown), files touched, new endpoints, UI per breakpoint, tests, and a list of anything in this prompt that clashes with the code or is unclear. **Stop and wait for my approval of the plan.**
3. Build **one phase at a time**. At the end of each phase: `npm run typecheck`, `npm test`, `npm run build` all green, a short report (what changed, how to test it by hand), then commit. Don't start the next phase until I say so.
4. At the end: update `CLAUDE.md` (new "Sprint 22" section that supersedes older notes where they differ), `PROJECT_STATE.md`, `docs/flows/*` (role matrix, flow inventory), and add `scripts/check-sprint-22.mjs` (an API smoke script like the earlier ones, run against a local DB only).

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
| A | C1 Meter (all-over) stock in free stock and inventory · CR-12 Dummy taka numbers D01 … |
| B | C2 Manual Add stock · CR-14 Manual withdraw (Remove stock) with reason · Stock adjustments list |
| C | C9 Damaged stock sold in a lot |
| D | CR-13 + C8 Goods return against the party (received first, organised design-wise later, then Complete) |
| E | CR-15 Inventory screens: Quality → Design → Design details, Create order, Assign to order |

Depends on Sprint 21 being merged. Not in this sprint: FY numbering (Sprint 23 — build the dummy counter so Sprint 23 can make it yearly), yarn, dashboards.

Read first: `CLAUDE.md` sections Sprint 10, 12, 13, 19 (and the Sprint 19 plan `docs/plans/sprint19-plan-APPROVED.md` phases 9–10, which were never built — this sprint builds them), `server/src/services/inventory.ts`, `inventory-moves.ts`, `free-stock.ts`, `dispatch.ts` (goods return), `shared/src/inventory.ts`, `shared/src/freeStock.ts`, `shared/src/dispatch.ts`, the DB tables `stock_adjustments`, `orders.is_stock_holder`, `takas.removed_*` (added in Sprint 19, unused so far), `client/src/features/inventory/*`, `client/src/features/free-stock/*`, `client/src/features/dispatch/*`.

---

## 2. Phase A — Meter stock and dummy numbers

### A1 · C1 Meter (all-over) free stock
Today the server refuses meter orders ("Only pcs orders can move stock to the inventory" / "Only pcs orders can use free stock") and inventory counts pcs orders only.
- Allow **Move to inventory** and **Add from free stock** for meter orders. A meter taka moves **whole** (tick takas; no "N metres" split).
- **Pcs and metres never mix:** meter free stock can be added only to a **meter order of the same design**; pcs free stock only to pcs orders (same design, as today). The server checks it (409 with a clear message).
- Inventory shows **two separate figures** wherever it shows quantities: "1,240 pcs · 860.50 m". Never one total. Free stock, damaged, ordered, in making, ready columns all get the metre twin.
- Meter takas returned by a goods return become visible in free stock / inventory.
- Shared helpers in `shared/src/inventory.ts` return `{ pcs, meters }` pairs; tests for mixed designs.

### A2 · CR-12 Dummy taka numbers D01, D02 …
- Stock that has **no taka of its own** gets a dummy taka number when it is created as stock: manual Add stock (Phase B), a goods-return line received pcs-wise / metres-wise without taka numbers (Phase D), and a pcs-to-pcs leftover that needs a new taka when there is no taka to split.
- Format `D` + number, at least two digits: D01 … D99, D100 … Counter `counters.dummy_taka_no`, allocated inside the write transaction, never reused. (Sprint 23 makes every counter restart each financial year — keep allocation in one helper `nextDummyTakaNo(tx)` so that change is one place.)
- Dummy numbers live in `takas.taka_no` like any other (the system-wide unique index covers them). Allow the `D` prefix in the taka-number validation **only for system-created dummy numbers** (users never type them). Chips show them like any taka, with a small grey "dummy" hint.

---

## 3. Phase B — Manual finished stock (Jenish · Gaurang)

New permission `canAdjustFinishedStock` (jemish, gaurang).

### B1 · C2 Add stock
- From Inventory (top bar "Add stock") and from a design's details.
- Fields: Quality (required) · Design (required, filtered by quality) · Unit Pcs / Meters · Quantity · Condition Fresh / Damaged → if Damaged: damage type (all four: Machine / Butta / Mill / Supervisor), damage name (master or Other), damaged qty (≤ quantity) · Blouse (pcs only: with / without / not set) · Remark (optional).
- Creates **one free-stock taka** with a dummy number, `free_reason = 'manual_add'`, owned by the hidden stock-holder order of that design / quality (`orders.is_stock_holder`, see the Sprint 19 plan), plus a `stock_adjustments` row (`kind='add'`). Damaged → an open damage on that taka. Shown everywhere as **"Manual stock"** instead of an order number.
- UI: full-screen form. Tablet 2 columns (Quality · Design on one row, Unit · Qty on one row, Condition + damage block below); desktop 3 columns; phone 1 column.

### B2 · CR-14 Remove stock (manual withdraw) — reason required
- **Free stock only.** Two ways: tick free-stock takas (whole), or for pcs stock enter a pcs amount → the system picks takas (largest first) and splits one if needed (reuse the pcs-to-pcs picking logic).
- **Reason** (required): a `Select` — Sold · Sample · Lost · Damaged / scrap · Other — plus a note (required when Other).
- Effect: takas get `removed_at / by / reason` (Sprint 19 columns), leave every stock figure; `stock_adjustments` row `kind='remove'`; taka event `stock_removed`.
- UI: from Inventory → design → Free stock section ("Remove stock") and Inventory top bar. Confirm dialog summarises ("Remove 2 takas · 48 pcs · reason Sample").

### B3 · Stock adjustments list
- Inventory → "Stock adjustments": date, Add / Remove, quality, design, pcs or m, fresh / damaged, reason / remark, user. Filters: date range, add / remove, design, user. Desktop table, tablet 2-column cards, phone cards.

---

## 4. Phase C — C9 Damaged stock sold in a lot

- Who: Jenish · Gaurang (`canAdjustFinishedStock`).
- From Inventory → Damaged: "Sell as lot". Pick damaged free-stock takas (tick; filters by quality / design / damage type), see the running total (pcs and m separately).
- Lot form: date (default today), buyer (typed, optional), **lump-sum amount (₹, optional)**, note.
- New tables `damaged_lots` (lot_no from counter `damaged_lot_no`, shown `DL-n`; date, buyer, amount, note, user) and `damaged_lot_takas` (lot_id, taka_id, pcs, meters).
- Effect: takas removed from stock with reason `sold_lot`, open damages closed as "sold"; a `stock_adjustments` row per taka (`kind='remove'`, remark "Sold in lot DL-3").
- List "Damaged lots sold" under Inventory → Damaged (lot no, date, buyer, takas, pcs / m, amount). Lot details page with its takas; print (A4, simple list, Rivoora header) — optional, if time allows.
- Amounts are only shown to roles with `canSeeRate`.

---

## 5. Phase D — Goods return against the party (CR-13 + C8)

This **replaces** today's goods return against a delivery challan for **new** returns. Old GR records stay readable as they are.

Read `createGoodsReturn`, `getOrderReturnSummary` in `dispatch.ts`, the GR screens, `goods_returns` / `goods_return_takas` tables.

### Flow
1. **Mark goods received** (Dhruvil; Jenish · Gaurang as today, `canGoodsReturn`). Fields: Party (client, required) · date · received as **Pcs / Meters / Takas** · quantity received (pcs or m), or for Takas: the taka numbers (scan / type; our dispatched takas of that client) · note · photos. Save → GR number `GR-n` (counter `goods_return_no`), status **Pending**. Nothing enters stock yet.
2. **Pending GR** (list "Goods return → Pending"). Dhruvil can open it any time and:
   - edit the received details;
   - **organise it design-wise**: add lines — Quality · Design · quantity received for that design · of which **damaged** (qty, damage type, damage name; several damage rows allowed) · blouse (pcs). For a Takas GR, each picked taka is already a line (its design is known) — he only marks damage.
   - The screen shows "Received 120 pcs · organised 96 pcs · left 24 pcs".
3. **Complete** (button appears after the first save; enabled when organised quantity = received quantity — if they differ, he must correct the received quantity first).
   - Each design line becomes free stock: **fresh part** → one free-stock taka with a dummy number; **damaged part** → a separate free-stock taka with a dummy number and the open damage(s). For a Takas GR the returned takas themselves go `dispatched` → free stock (reason "Returned"), damaged ones get the damage.
   - Origin shown as "Returned · GR-7 · Party name". Owner: the stock-holder order of that design (no client order is linked — the DC is not known).
   - GR status **Completed**, read-only afterwards (no undo).
4. Pcs and metres never mix in one GR (the "received as" choice decides).

Effects on orders / challans: a new GR is **not linked to any delivery challan or order**, so it creates **no DC revision** and does **not** set the order status Returned. Old returns keep showing their R1 / R2 revisions and the Returned status.

UI:
- Goods return home: tabs **Pending** · **Completed**; "Mark goods received" button.
- Mark received form: tablet 2 columns (Party · Date; Received as · Quantity), desktop 3; phone 1.
- Organise screen: **desktop** = left: received summary + photos, right: design lines table with inline add row. **Tablet** = summary bar on top, design lines as 2-column cards, "Add design" button, sticky bottom bar with the "left to organise" counter and Save / Complete. **Phone** = summary, then stacked line cards, full-screen line editor.

---

## 6. Phase E — CR-15 Inventory screens

Today Inventory lists designs (card per design key) → design details.

New navigation, three levels:
1. **Inventory home = qualities.** One card per quality that has any stock or open order quantity: quality name, designs count, ordered · in making · ready · free stock · damaged (pcs and m as separate figures), a small bar. Search (quality or design code), filters: has free stock / has damaged, FG type (Saree / Suit, from Sprint 21). Top bar: Add stock · Remove stock · Stock adjustments · Damaged · History (dispatched).
2. **Quality → designs.** Design cards (thumbnail, code, the same figures). Sort: free stock first / design code.
3. **Design details** — today's details screen (its sections stay), with the **current quantity** shown on top as big tiles (Free stock · Ready · In making · Damaged). Actions on this screen:
   - **Create order** (only `canAddOrder`): opens `/orders/new?designId=…&qualityId=…` — the Add order screen with the design (and its quality) **pre-selected**. Add the query-param pre-fill to the add-order page.
   - **Assign to order**: assign free stock of this design to any open order of the same design and unit (today's "Assign to order" flow).
   - Add stock / Remove stock for this design.
- Breakpoints: home and design lists — desktop 4–5 column grid, **tablet 2-column grid with bigger tiles**, phone 1 column. Details: desktop 2 columns (tiles + sections left, free stock / orders right), tablet tiles in a 2×2 grid on top then sections, phone stacked.
- Keep the old URLs working (redirect the old design-details URL to the new one).

---

## 7. Acceptance checklist

1. A meter order's takas move to inventory and show "860.50 m" separately; meter stock can't be added to a pcs order or a different design.
2. Add stock (fresh and damaged) creates one taka with D01 / D02 …, shown as Manual stock; remove by takas and by pcs (with a split) with a reason; both appear in Stock adjustments.
3. Sell damaged takas as lot DL-1 with amount; they leave stock; amount hidden from roles without rate.
4. Mark a GR received (120 pcs) → Pending; organise 3 designs incl. damage; Complete → free stock per design with dummy numbers and damage; a Takas GR returns our own takas to free stock; no DC revision created.
5. Inventory opens on qualities → designs → details; Create order opens Add order with the design pre-selected; Assign to order works.
6. All screens checked at 360 / 820 / 1180 / 1440 px.
