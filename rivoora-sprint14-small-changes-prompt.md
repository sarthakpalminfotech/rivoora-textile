# Rivoora Textile — Sprint 14: Client feedback (small changes)

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first (up to Sprint 13). These are **small, focused changes** after a client demo. **Don't change anything else.** Keep the current look and follow the visual rules from Sprint 8 §11 for anything new.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Do the items in order, one commit per item. After each one, run `npm run typecheck` and `npm test`, check the screen at 360 / 768 / 1280px, and confirm the related flows still work.
2. No schema changes should be needed (item 11 changes only one user's name). If one turns out to be necessary, it must be additive. Tell me before running anything on Turso.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`, and give me a short summary per item.

---

## 1. Add / Edit order: don't filter stock by blouse option
The inventory panel on the Add / Edit order screen (free stock, in making, … for the chosen design) currently filters its numbers by the selected **With / Without blouse** option. **Stop filtering:**
- Always show **all** stock of that design, whatever the blouse option.
- A quiet breakdown line ("With blouse 120 · Without 80 · Not set 40") may stay, for information only.
- Remove the "Showing With blouse stock" caption.

## 2. Orders list filters: party filter + every filter multi-select
On the Orders list filter dialog (all roles that have it):
- Add a **Party (client)** filter: the standard searchable `MultiSelect` from the customer lookup, server search. Hide it for roles without `canSeeClient`.
- **Every filter is multi-select**: Status, Material, Order type, Party, and any other single-choice filter that exists (e.g. Blouse, if present). The date range stays a range.
- Filters live in the URL (e.g. `party=3,7`), show as removable chips, and count in the filter badge, like the existing ones.
- The server accepts comma-separated ids for each filter, with zod validation.

## 3. Order details → History: **Overview** and **Detailed** views
On the History tab, add a small segmented toggle at the top: **Overview · Detailed** (kept in the URL, `?hview=overview|detailed`; default **Overview**).

### 3.1 Overview: the main steps only
A clean vertical timeline of the **main steps**, in order:
1. **Order created**
2. **In production**: when production started (first jobsheet started on a loom)
3. **Sent to butta cutting**: first butta challan of this order
4. **Received from butta cutting**
5. **Sent to mill**
6. **Received from mill**
7. **Dispatched**: first dispatch challan

**Each step shows:**
- the **date + time** it first happened
- when it happened in several lots: a quiet second line, "3 lots · last on 12-10-2026 4:10 pm"
- **between consecutive steps**, the **time taken** in a small pill on the connecting line, e.g. "Butta cutting took 4 days 6 h" (from Sent to butta → Received from butta), or "2 d 3 h" between other steps
- steps not reached yet: muted, with "Pending"
- steps that don't apply (e.g. the design skips butta cutting): "Skipped"

Derive the steps from the existing data (order status history, jobsheet events, challan / taka events). Put the step definitions and the duration maths in one shared pure function (e.g. `orderMilestones(...)`), with tests: lots, skipped steps, pending steps, durations.

### 3.2 Detailed: the current timeline
- Keep the existing detailed history exactly as it is.
- **Mark the main-step entries subtly** so they're visible at a glance: a slightly stronger dot in the primary colour and a soft tinted row background (no heavy borders, no loud colours).
- Show the same "time since the previous main step" pill on those rows.

## 4. Taka entry: **pcs before meters**
On the Taka entry screen (Taka entry role), switch the field order in each row: **pcs first, then meters** (then Damage).
- Keyboard "next" moves taka number → pcs → meters in that order.
- Labels stay bilingual. Only the Taka entry screen changes.

## 5. Send to butta cutting / Send to mill: show the pcs total
In the **confirmation popup** for sending takas (Butta cutting → Send, Mill → Send, Mill → Refinish), show the **total pcs** next to the existing totals: "18 takas · 216 pcs · 1,092.50 m". Also show pcs in the selection bar if it isn't already there.

## 6. Receive → Challans: design thumbnails + design preview
In **both** Butta cutting and Mill → **Receive → Challans** (and the challan list cards of In butta cutting / In mill, which use the same card):
- Each challan card shows a **small design thumbnail** (about 40px, rounded) of the designs on that challan.
  - **One design:** one thumbnail.
  - **Several designs:** the first thumbnail with a small overlapping **"+2"** chip (or stacked thumbnails, at most 3 visible plus a count).
- **Tapping the thumbnail(s)** opens a **design preview** (it must not open the challan itself):
  - full-screen on phones, a centred large modal on tablet/desktop
  - one design at a time, **large image**, with **"Order #26"** (and the design/variation code) at the top
  - **‹ previous** and **next ›** arrow buttons on both sides
  - swipe left/right on touch, ←/→ keys on desktop
  - a small "2 / 3" counter
  - first / last arrows disabled at the ends; Escape / ✕ closes it
  - load full images only in the preview (thumbnails in the list)
- **API:** the challan list items include `designs: [{ orderNo, designCode, thumbUrl, imageUrl }]` (distinct per order + design/variation), from one query, with no per-card queries.

## 7. QC role: remove the "QC pending" list
On `/qc`, remove the **QC pending** list. The screen keeps only the **taka number box + Open**. Remove the now-unused client query. The pending endpoints may stay on the server.

## 8. Dhruvil → Dispatch: damage notice
In the **Dispatch** confirmation modal, if any taka being dispatched still has **open damage**, show an **amber notice** (not a blocker):
- "3 takas (12 pcs) still have damage", with a small expandable list (taka no or, for pcs to pcs, just pcs · damage type · name)
- **Dispatch** stays enabled

## 9. Inventory: rename "In godown" → **"Ready for order"**
Rename the label **"In godown"** to **"Ready for order"** everywhere in Inventory: the KPI tile, item cards, item details tiles, and any captions or tooltips. Labels only.

## 10. Docs tab: show dispatch (delivery) challans
The order details **Docs → Challans** list doesn't show the **dispatch / delivery challans** (DC-n). Fix it:
- List them alongside butta and mill challans, with a kind badge **"Delivery"**, every revision (**DC-12**, **DC-12 R1** with Active / Revised state), date, takas / pcs, and a print icon (opens the existing dispatch challan print).
- Clicking one opens the order's dispatch screen (`/dispatched/:orderId`).
- Update `GET /orders/:id/challans`. Check the cause: a missing `kind`, a different table, or a filter.

## 11. Spelling: the owner is **Jenish** (not Jemish)

Change **only what people see**. **Do NOT rename the internal role key `jemish`.** It's stored in the database (`users.role`, `role` columns in every history/event table, `X-Act-As`, permissions), and renaming it would risk breaking data and logins.

- Change the role's **display name / title** in `shared/src/roles.ts` to **"Jenish"** (e.g. "Jenish — Owner"). Do the same for any other user-facing text that hard-codes "Jemish":
  - the profile menu and role switcher
  - the "Viewing as …" bar
  - history / activity labels ("by Jenish")
  - empty states and toasts
  - the login screen
  - the README
- History and activity screens show **role labels from the config**, so old events also display "Jenish" automatically. Check that no screen prints the raw key `jemish`.
- **Users table:** the default user row is named "Jemish". Update **only its name**, with a safe one-time step that changes `users.name` to "Jenish" **only where** `phone = '9999999999'` **and** `name = 'Jemish'` (nothing else changes; the phone, password and role stay the same). Also update the default-users seed so a fresh install uses "Jenish". Tell me before running this on Turso. Alternatively, the name can be edited by hand in the Users master.
- In docs and code comments, you may write "Jenish (role key `jemish`)" so future readers aren't confused. **Don't** rename variables, files or permission names.
- Grep the client and shared code for `Jemish` (case-insensitive) and confirm every **visible** occurrence is changed, and that only the internal key `jemish` remains.

---

## Quality checklist
- **Tests:** `orderMilestones` (incl. lots, skipped, durations), the multi-select filter parsing, the Docs list including dispatch challans.
- **Login and role switching** still work for the owner (phone 9999999999) after the rename, and old history shows "Jenish".
- **Regression:** order creation, the orders list, the history tab, taka entry, butta/mill send + receive, QC open, dispatch, inventory, the Docs tab.
- The design preview works on a phone (swipe), a tablet and a desktop (arrows + keys).
