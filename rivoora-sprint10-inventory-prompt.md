# Rivoora Textile — Sprint 10: Inventory (design-wise), Damaged inventory, godown order screen improvements

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first (Sprints 1–9, including the follow-up changes). All quantities in this sprint are **pcs**, using actual pcs (`takaActualPcs` / `COALESCE(actual_pcs, pcs)`) wherever takas are counted.

**Visual quality matters most in this sprint.** It's an overview screen the owner will look at every day. Follow the Sprint 8 §11 rules:
- calm neutral surfaces; colour only as small accents (dots, thin bars, small badges)
- one focal number per tile; `tabular-nums`
- generous spacing; no crowding; no heavy borders
- skeletons that match the layout; friendly empty states

Take screenshots at **360 / 768 / 1280px** at the end of each UI phase and refine anything that looks busy, heavy or misaligned. Say what you refined in the phase summary.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode and show me the plan: the pcs definitions (§2) as shared pure functions, endpoints and queries, and the screens.
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. Who sees it

- A new module **Inventory** (nav item with a lucide `Warehouse` or `Boxes` icon) for **Jemish and Gaurang**: new permission `canViewInventory`.
- On phones it goes in the main bar or the More sheet, following the existing "max 4 tabs" rule.
- Not for the godown supervisor or other roles (the order lists show client names).

---

## 2. What is an inventory item, and how pcs are counted

**Inventory item = a design OR a variation.**
- Each **variation is its own item**.
- Orders on the base design (no variation) belong to the **base design** item.
- Orders with **no design** are grouped into one item "Without design", shown last.
- Only **pcs-unit** orders are counted. Orders in other units are left out, with a one-line muted note on the page: "N orders in meters / kg are not included".

**Per order** (a pure shared function, e.g. `orderInventoryPcs(order, jobsheets, takas)` in `shared/src/inventory.ts`, with tests):

| Figure | Definition |
|---|---|
| **Ordered** | order quantity (pcs) |
| **Ready for dispatch** | actual pcs of takas in `ready_dispatch` |
| **In godown** | actual pcs of takas in `final` (Mill QC done, not yet ready for dispatch) |
| **In refinish** | actual pcs of takas in `refinish` |
| **In making** | everything still being made, before the godown. Pcs of active takas in `entered`, `at_butta`, `butta_qc`, `waiting_mill`, `at_mill`, `mill_qc`, **plus** pcs not yet turned into takas: Pending / Sent / Ongoing jobsheets count frames × `SECTIONS_PER_BEAM`; Completed jobsheets without takas count `completed_frames` × `SECTIONS_PER_BEAM` (the same logic the dashboard bar already uses — reuse it, don't duplicate it). |
| **Damaged** | **open** damaged pcs (`pcs − resolved_pcs` of open damages) on takas in `final` or `ready_dispatch`, meaning damaged stock that is physically in the godown |

**Per item:** the sums over its orders. The **top KPIs** are the sums over all items.

---

## 3. Inventory page (`/inventory`)

### 3.1 KPI row (top)
Five calm tiles: one row on desktop, 2 columns on phones, with the last tile spanning both. Each tile is one big number + a small label + a tiny coloured dot:
- **Total in godown:** Ready for dispatch + In godown pcs (finished stock on hand)
- **Ready for dispatch**
- **In making**
- **Damaged pcs**
- **In refinish**

### 3.2 Section switch
Under the KPIs, two text tabs: **All designs** · **Damaged**.
- Plain text, **an underline under the selected one** (primary colour, 2px), muted text for the other. No pills, no boxes.
- Kept in the URL (`?section=damaged`). Default: **All designs**.

### 3.3 All designs (default)
- A small **search** (design or variation code, design name) on the right of the section row; on phones, a search icon that expands.
- A **compact card grid** (`auto-fill, minmax(17rem, 1fr)`), designed for many items, so keep each card light. Each card shows:
  - a design image, about **56px**, rounded (variation image for variations)
  - the **code** (focal, bold), e.g. `D101N2`, with the design name / "Variation of D101" muted below
  - three figures in one row, tiny label above each number: **Ordered** · **In making** · **Ready**
  - a hairline-thin bar under them: Ready (green) and In making (soft blue) as shares of Ordered
  - nothing else
- Sort: items with the most In making + Ready first, then by code. Items with nothing ordered are not shown.
- Paginated with the existing infinite scroll + Load more.
- Tapping a card opens the **item details** (§3.4).

### 3.4 Item details (full screen inside the layout: `/inventory/items/:key`, key `d-<designId>` or `v-<variationId>`)
- **Back** link to Inventory (keeping the section and search).
- **Header:** the image (lightbox), code, name, "Variation of …" if relevant, the default quality if any.
- **KPI tiles (pcs):** Ordered · In making · In godown · Ready for dispatch · Damaged · In refinish.
- **Orders list** of this item, newest first. Each row (a card on phones):
  - **Order #26** (focal) and the **client name** (muted)
  - **ordered pcs**
  - a **small bar**: ready vs ordered, with **"90 / 300"** beside it
  - the order **status badge** (the existing `StatusBadge`), below or beside it
- Tapping a row → `/orders/:id`.
- A **search icon** in the list header expands into a search field matching **order number or taka number** (a taka number finds the order that has it). Clearing it closes it.
- Empty state: "No orders for this design yet".

### 3.5 Damaged section
- The same compact card grid, **only items that have damaged pcs** (as defined in §2) **or refinish pcs**. Each card shows:
  - the 56px image
  - the code
  - **Damaged pcs** (focal, red-tinted number)
  - **In refinish** pcs (small, if > 0)
  - **Last cleared:** a date, or "Never" (muted). The stock wipe-out action comes in a later sprint. Store nothing new for it yet; the API returns `lastClearedAt: null` for now.
- Search like §3.3. Sort: most damaged pcs first.
- Tapping a card → the damaged item details (§3.6).

### 3.6 Damaged item details (`/inventory/damaged/:key`)
- **Back** link and the same header as §3.4.
- **KPI tiles:** **Total damaged pcs** · **In refinish** (pcs).
- **Damage type filters:** a row of tappable chips with counts: **Machine damage (n)** · **Butta cutting damage (n)** · **Mill damage (n)** · **Supervisor marked (n)**.
  - The counts are the number of damaged takas with an open damage of that type.
  - Show only types that are > 0, plus an **All** chip (default).
  - Tapping filters the taka list; tapping the active chip again goes back to All. Kept in the URL.
- **Taka list** (light; not overfilled). Each row:
  - the **taka number** (focal)
  - **Order #26**
  - the **date** (when the latest open damage was recorded)
  - a tiny damage-type dot
- Tapping a row → the existing damage details screen `/orders/:orderId/takas/:takaId/damages`.
- Takas in **refinish** are listed in the same list with a small amber **"Refinish"** tag. The **"In refinish"** KPI tile also works as a filter when tapped.
- A **search icon** expands into a field matching **taka number, order number or damage name**.
- **Last stock clearance** section (at the bottom, a quiet card):
  - Show **one demo entry**: "Sold on 12-09-2026 · 120 pcs · to Shree Textiles · ₹180 / pc".
  - Mark it with a small grey **"Demo"** tag so nobody mistakes it for real data. Put the demo values in one constant.
  - This becomes real when the wipe-out flow is built.

---

## 4. Godown supervisor: order screen improvements

### 4.1 KPI row (`/godown/orders/:orderId`)
Next to the existing tiles (Cleared by Mill QC, Checked, Refinish), show **pcs** tiles for:
- **Ready for dispatch** (pcs)
- **In refinish** (pcs)
- **Damaged** (open damaged pcs)

Keep the row calm and in the same tile style: if it gets crowded, merge the old "Refinish: 1 taka" tile into the new pcs tile ("4 pcs · 1 taka"). On phones, use 2 columns.

### 4.2 Damage tab: make each taka's state obvious
On each damaged taka card, show its **state clearly but quietly** next to the taka number, as a small but **bold** badge:
- **Ready for dispatch** (green)
- **Refinish** (amber)
- **In godown** (neutral; the `final` stage)

The badge must read at a glance without making the card louder. Use a soft tinted badge with bold text, no full-card colour.

**Tap filters** above the list: chips with counts for the states **and** damage types present in this order, e.g. **All (6)** · **In godown (3)** · **Ready for dispatch (2)** · **Refinish (1)** · **Machine (4)** · **Butta (1)** · **Mill (1)** · **Supervisor (1)**.
- Hide chips with 0.
- One state filter and one type filter can combine.
- Kept in the URL.

---

## 5. API (new)

| Method | Path | Notes |
|---|---|---|
| GET | `/inventory/summary` | the top KPIs + the count of non-pcs orders left out |
| GET | `/inventory/items?search=&page=&limit=` | the All designs cards (one aggregate query per page; no per-item queries) |
| GET | `/inventory/items/:key` | header + KPIs |
| GET | `/inventory/items/:key/orders?search=` | orders with client name, ordered, ready, status |
| GET | `/inventory/damaged?search=&page=&limit=` | the Damaged cards (`lastClearedAt: null` for now) |
| GET | `/inventory/damaged/:key` | header + KPIs + type counts |
| GET | `/inventory/damaged/:key/takas?type=&refinish=&search=` | the taka rows |

- All endpoints need `canViewInventory`.
- Compute the pcs with the shared functions from §2. Use SQL aggregates (GROUP BY design/variation) for speed, and make the tests show that SQL and the shared function agree on a seeded example.
- Godown changes: extend `GET /godown/orders/:orderId` (pcs KPIs) and `GET /godown/orders/:orderId/damages` (state per taka + counts for the chips). Never return the client name or rate.
- React Query keys: `['inventory', …]`. Invalidate `['inventory']` after **every** taka / jobsheet / challan / QC / godown write (add it to the existing invalidation helpers).

---

## 6. Quality checklist

- **Shared tests** for `orderInventoryPcs`:
  - each figure
  - jobsheets without takas
  - partial resolves
  - refinish
  - split parts (actual pcs)
  - non-pcs orders left out
  - variation vs base design grouping
- The numbers on the Inventory item details match the order dashboard for the same orders (spot-check one order end to end).
- The design pass is done with screenshots for: the KPI row, the underline tabs, both card grids, both details screens (incl. the expanding search), the godown KPI row, and the Damage tab badges + filters.
- No overflow at 360px; tap targets are at least 44px; the Inventory grid stays light with 100+ items.

## 7. Build phases

1. **Shared pcs functions + tests** (`shared/src/inventory.ts`), permission, nav.
2. **Inventory API** (summary, items, item details + orders, damaged, damaged details + takas).
3. **Inventory page:** KPIs, underline tabs, All designs grid, item details.
4. **Damaged section + damaged item details** (filters, search, demo clearance card).
5. **Godown order screen:** pcs KPIs, Damage tab state badges + tap filters.
6. **Design pass and polish:** screenshots at all breakpoints; update `CLAUDE.md` and `PROJECT_STATE.md`.
