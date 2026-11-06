# Rivoora Textile — Sprint 21 — Orders, production, challans, dispatch, overdue alerts

Prepared 06-11-2026 from the client's confirmed changes (CR-01 … CR-25, `Rivoora-Client-Change-Requests-3-4-Nov-2026`) and his answers of 06-11-2026. Sprints 21 → 25 must be built **in order**; this file is Sprint 21.

## 0. Read this first (rules for this sprint)

You are working on the live Rivoora Textile app (npm workspaces: `shared/`, `server/`, `client/`; Express + Drizzle + Turso; React 18 + Vite + Tailwind + Radix + TanStack Query). The client uses it every day.

**Safety (never break these)**
- The database is the **live Turso DB**. Migrations must be **additive only**: new tables, new nullable columns or columns with a default, new indexes. No dropping, renaming or retyping columns; no rewriting existing rows except a documented backfill.
- **Before running any migration against Turso, stop and tell me.** Remind me to export a backup first, and wait for my "go".
- Never run seed / wipe / reset scripts against Turso. Never put the Turso URL or token in code, the client, a commit, a log or a zip. Never commit `.env` files.
- Never `git init` and never force-push. Work on a branch `sprint-21` and commit after every phase with a clear message.
- **Existing behaviour must keep working** unless this prompt changes it on purpose. When you change a rule, change it in one place (shared helpers / `roles.ts` / `statuses.ts`), not by copying code.
- Server is the source of truth: every rule below is checked on the server (permissions with `requirePermission`, conditional updates inside one transaction, the hold / close guard in `middleware/hold-guard.ts`). The client only mirrors the rules to hide buttons and show messages.

**How to work**
1. Read `CLAUDE.md` (all sprint sections) and `PROJECT_STATE.md`, then the files named in each section of this prompt, **before planning**.
2. Write the plan to `docs/plans/sprint-21-plan.md`: phases, migrations (SQL shown), files touched, new endpoints, UI per breakpoint, tests, and a list of anything in this prompt that clashes with the code or is unclear. **Stop and wait for my approval of the plan.**
3. Build **one phase at a time**. At the end of each phase: `npm run typecheck`, `npm test`, `npm run build` all green, a short report (what changed, how to test it by hand), then commit. Don't start the next phase until I say so.
4. At the end: update `CLAUDE.md` (new "Sprint 21" section that supersedes older notes where they differ), `PROJECT_STATE.md`, `docs/flows/*` (role matrix, flow inventory), and add `scripts/check-sprint-21.mjs` (an API smoke script like the earlier ones, run against a local DB only).

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

Client changes confirmed on 4–6 Nov 2026, numbered as in `Rivoora-Client-Change-Requests-3-4-Nov-2026` (CR-xx) plus the items the client moved into scope from flowcharts v1.1 (Cxx).

| Phase | Items |
|---|---|
| A | CR-01 FG type on the order · CR-02 Gaurang + dispatched orders (check only) |
| B | CR-03 Hold by Gaurang · CR-04 Close only when cleared |
| C | CR-05 Supervisor completes without frames · CR-06 Taka entry person edits his takas |
| D | CR-07 Rivoora taka number on outside receipts · CR-08 Shrinkage (godown meters) |
| E | CR-09 Undo send back · C6 Undo QC result / cancel refinish |
| F | C3 Edit challan / remove a taka · C4 Lost / short taka at a party |
| G | CR-10 Undo dispatch (reason, DC cancelled) · C7 Edit delivery challan |
| H | CR-11 + C5 Overdue alerts |

**Not in this sprint (do not build):** push / SMS / WhatsApp / email notifications (the hold notification of CR-03 is agreed but **not built in the prototype**); finished stock, goods return, inventory changes (Sprint 22); financial-year numbering and QC login limits (Sprint 23); yarn (Sprint 24); insight dashboards (Sprint 25).

---

## 2. Phase A — Orders

### A1 · CR-01 FG type (Saree / Suit)
Read: `shared/src/schemas.ts` (order schemas), `shared/src/units.ts`, `shared/src/orderTypes.ts`, `server/src/services/orders.ts`, `client/src/features/orders/add-order-page.tsx`, order header / list card / filters, `client/src/features/jobsheets/print-page.tsx`.

- New shared config `shared/src/fgTypes.ts`: `FG_TYPES = ['saree','suit'] as const`, labels `Saree`, `Suit`. Only these two (no master screen).
- Migration: `orders.fg_type TEXT NOT NULL DEFAULT 'saree'` → **all existing orders become Saree** (client decision).
- Add order / Edit order: required field **FG type** as a `Segmented` (Saree | Suit), placed first in the "Order" block, before Unit. Default **Saree** on a new order. Unit (Pcs / Meters) and Order type (Lump / Pcs to pcs) keep today's rules for both types (meter → always Lump, unit lock).
- Edit allowed for `canEditOrder` at any status (it is a label, nothing depends on it).
- Show it:
  - order list card: a small chip "Saree" / "Suit" on the status row;
  - order header detail grid ("FG type") and the Order details tab;
  - jobsheet print: in the info block next to Design / Quality ("FG: Saree");
  - supervisor jobsheet card and taka entry identity card (one short word, no layout change).
  - **Not** on the delivery challan.
- Orders list filter: new filter "FG type" (Saree / Suit), in the URL like the other filters; `GET /orders?fgType=saree,suit`.
- History: changing the FG type writes an `order_events` row "FG type Saree → Suit".
- Tablet: the add-order form keeps its 2-column grid; FG type + Unit + Order type sit on one row (3 compact segmented controls).

### A2 · CR-02 Gaurang and the dispatched orders
Gaurang already has `canDispatch` / `canGoodsReturn`. **Check only**: he must see the Dispatch module (pending + Dispatched list) in his nav on desktop, tablet (rail) and phone (bottom bar / More), and Dispatched / Returned / Closed orders must stay in his Orders list (status filter). If anything is missing, fix it; otherwise report "already in place". No other change.

---

## 3. Phase B — Hold and Close

### B1 · CR-03 Hold by Gaurang
Read: `shared/src/roles.ts`, `server/src/services/hold-order.ts`, `shared/src/hold.ts`, hold UI in the order header.

- `canHoldOrder: true` for **gaurang** (today Jenish only). Release: either Jenish or Gaurang can release a hold, whoever put it.
- Hold events already store who held; show "Held by Gaurang · 05-11-2026 10:42 · reason" in the header banner and History.
- **Notification to Supervisor + Gaurang: agreed, NOT built in the prototype.** Do not add any notification code. Put one line in `CLAUDE.md` "Not built yet".
- Role matrix (`docs/flows/ROLE_MATRIX.md`) HLD rows: Gaurang ✓.

### B2 · CR-04 Close only when everything is cleared
Read: `server/src/services/close-order.ts` (closePreview / closeOrder), `shared/src/hold.ts` (`planHold`, `planHoldMeters`), the close dialog in the client.

Today Close works at any stage. New rule: **Close is allowed only when nothing of the order is in process.** It applies to held orders too (closing a held order also ends the hold).

`closePreview` returns `blockers: { kind, label, count, link }[]`. Close is **blocked (409)** while any blocker exists:

| Blocker | Means | Link |
|---|---|---|
| Jobsheet on the loom | a jobsheet Sent or Ongoing | order → Jobsheets tab |
| Completed jobsheet without takas | Completed, 0 active takas | Jobsheets tab |
| Takas at butta cutting | stage `at_butta` | Butta → challan |
| Takas waiting for Butta QC | stage `butta_qc` | Butta QC |
| Takas at the mill | stage `at_mill` | Mill → challan |
| Takas waiting for Mill QC | stage `mill_qc` | Mill QC |
| Takas in refinish | stage `refinish` | Mill → Send → Refinish |
| Takas sent back to butta | stage `rework_butta` | Butta → Send |
| Outside PO with goods expected | PO Open / Partly received | Outside tab |

Not blockers (they are handled by Close as today):
- **Pending** jobsheets (never sent) → cancelled automatically (soft delete + `cancelled` event).
- Takas **with us**: `entered` (waiting for butta), `waiting_mill`, `final`, `ready_dispatch` → become free stock with reason "Order closed" (today's logic in `freeStockFields`).
- Dispatched takas stay dispatched.

Remove the "frames entered for loom jobsheets" step from Close (there can be no loom jobsheet now). Keep the optional close note.

UI (Close dialog, all breakpoints a `ResponsiveModal`):
- Opens with the preview. **If blockers exist**: a red panel "This order can't be closed yet — clear these first:" and the blocker list (icon, label, count, "Open" link), Close button disabled.
- **If clear**: summary of what will happen ("2 pending jobsheets will be cancelled · 14 takas with us go to free stock · 3 dispatched takas stay with the client"), note field, Close button.
- Tablet: the blocker list is a 2-column grid of cards; desktop: a table; phone: stacked cards.
- Server re-checks inside the close transaction (someone may have sent a jobsheet meanwhile) → 409 with the fresh blocker list.

Tests (shared): a pure `closeBlockers(input)` function with cases for every row above.

---

## 4. Phase C — Supervisor and taka entry

### C1 · CR-05 Supervisor completes without frames
Read: `server/src/services/jobsheets.ts` (complete / change machine), `shared/src/jobsheets.ts` (coverage, `effectiveFrames`), `shared/src/statuses.ts` (`orderStatusForJobsheets`), `client/src/features/jobsheets/run-dialogs.tsx`, `server/src/services/takas.ts` (`enterTakas`, `editTakas`).

- **Complete** (`POST /jobsheets/:id/complete`): no frames / meters input any more. Body becomes `{}` (still accept and ignore an old `completedFrames`). The jobsheet becomes `completed` with `completed_frames = NULL` and an event "completed by supervisor – frames from taka entry".
- **Frames come from the taka entry**: whenever the jobsheet's takas are entered or edited (by Taka entry, Jenish / Gaurang, or the CR-06 edit), recompute in the same transaction:
  - pcs order: `completed_frames = round(total pcs of all its active takas ÷ sections)` (sections = the jobsheet's sections per beam; round half up). Keep the exact pcs total visible ("Frames ≈ 32 · 96 pcs").
  - meter order: `completed_meters = total meters of all its active takas ÷ sections` (2 decimals).
  - While a Completed jobsheet has no takas, coverage and dashboards count its **assigned** frames / meters and show "waiting for taka entry".
- **Taka entry on a jobsheet that is not Completed** keeps today's behaviour (it completes it), but frames are now the taka-based value, not "= frames".
- **Change machine, Hold and Close of a running jobsheet still ask frames / meters done** (client confirmed). Unchanged.
- Supervisor UI: the Complete dialog becomes a simple confirmation ("Mark Order #26 (319) complete on loom 7? Frames will be taken from the taka entry."). Big 48 px buttons as today; bottom sheet on phone, centred dialog on tablet / desktop.
- Jobsheet card / details: Completed jobsheets without takas show an amber chip "Waiting for taka entry"; with takas "Frames 32 (96 pcs)".
- `orderStatusForJobsheets`: unchanged rules (Completed + ≥ 1 taka → Taka entry done).
- Tests: completing, then entering takas → frames computed; editing takas → recomputed; meter order variant.

### C2 · CR-06 Taka entry person edits his own entry
Read: `server/src/services/takas.ts` (`editTakas`), `client/src/features/takas/taka-entry-page.tsx`, `taka-jobsheets-page.tsx`, `edit-takas-dialog.tsx`, `shared/src/takas.ts`.

- New permission `canEditOwnTakaEntry` (taka_entry only). Jenish / Gaurang keep `canEditTakas` (full edit as today).
- A taka is **editable by the taka entry person while it is still in its first stage**: `entered` (butta design) or `waiting_mill` (no-butta design), not on any challan, no QC done, not split, not free stock. Shared helper `takaEditableAtEntry(taka)`.
- What he can change: **pcs, meters, damage** (add / change / remove), **delete a taka row**. He **cannot change the taka number** (numbers are automatic). He can **add new rows** to the jobsheet while **all** its takas are still editable (same rule as above); new rows get the next automatic numbers.
- Endpoint: `PUT /jobsheets/:id/takas/entry` (`canEditOwnTakaEntry`) — same payload shape as Edit takas, without `takaNo` changes; the server refuses any row that is no longer editable (409 with the taka number: "Taka 6245 has already gone to butta cutting — ask Jenish / Gaurang").
- Every change writes `taka_events` (`edited`, who, before → after) and a `takas_edited` jobsheet event; frames recompute (C1).
- UI (bilingual):
  - Taka jobsheets list → "Done" tab: each jobsheet card gets **Edit takas / टाका बदलें** when at least one taka is editable.
  - Edit screen = the entry screen layout (same rows: number shown read-only → meters → pcs → Damage), locked rows greyed with "Gone to butta / बट्टा में गया".
  - Phone: one row per taka, full width. **Tablet: 2 taka rows side by side** (each row a card with its fields in one line), sticky Save bar. Desktop: a table.
  - Confirm dialog lists the changes ("3 takas changed, 1 deleted").

---

## 5. Phase D — Outside receipts and shrinkage

### D1 · CR-07 Rivoora taka number on outside / FG receipts
Read: `server/src/services/outside.ts` (`createOutsideReceipt`, `createFgReceipt`, `outsideTakaNumber`), `server/src/services/taka-ops.ts` (`TAKA_COUNTER`), receive-goods screens.

- Every taka received from a weaver or an FG supplier gets a **Rivoora taka number from the same automatic counter as taka entry** (`counters.taka_no`), allocated in the receipt transaction, in row order. The "Add our taka numbers" option and the `<weaver code><weaver no>` system number are no longer used for new receipts.
- The **weaver's / supplier's own taka number** stays a field (optional, typed), saved in `takas.weaver_taka_no`, shown as "W 1101" next to our number everywhere it is shown today (chips, godown, challan prints).
- Old takas keep their numbers (no renumbering).
- Receipt form: the Rivoora number column shows "Auto" before saving and the real numbers on the success screen ("Takas 6301–6312 created"). Tablet: rows as 2-column cards (weaver no · pcs / meters · damage); desktop: table.
- Pcs-to-pcs FG receipts that create one lot taka: same rule (one automatic number).

### D2 · CR-08 Shrinkage = metres reduced by Dhruvil
Read: `server/src/services/godown.ts` (`patchGodownTaka`, actualMeters), `shared/src/godown.ts`, godown order screen 3-dot menu, order details tab.

Client decision: there is **no meters entry at the mill**. Dhruvil corrects the metres at the end, in the godown.
- Godown taka 3-dot menu: **Edit taka** (today "Edit pcs" / "Edit meters") opens one small form with **Actual pcs** (pcs orders) and **Actual meters** (**all** orders, pcs and meter), pre-filled with the current actual value, else the expected value (what taka entry / the receipt wrote). Uses the existing `PATCH /godown/takas/:id` (`actualPcs`, `actualMeters` — allow `actualMeters` on pcs orders too).
- **Shrinkage** = Σ over the order's takas of `max(expected meters − actual meters, 0)` for takas whose actual meters were changed (an increase is not shrinkage; show it separately as "Gain").
- Show it **only on the Order details page** (Order details tab, a small "Metres" block): "Expected 1,250.00 m · Actual 1,212.40 m · Shrinkage 37.60 m (3.0 %)". Takas without meters are left out of both sides. Shared pure function `orderShrinkage(takas)` + tests.
- No change at the mill or Mill QC.

---

## 6. Phase E — Undo send back and QC corrections

### E1 · CR-09 Undo a send back
Read: `server/src/services/rework.ts`, `shared/src/rework.ts`, Butta → Send / Mill → Send → Refinish screens.

- A send back to butta (`rework_butta`) or to the mill (`refinish` set by "Send back") can be **undone until the taka is put on a challan**. The taka returns to **the stage it had before the send back** — store it: migration `takas.stage_before_rework TEXT` (nullable), written by `sendBackTakas`.
- Who: Jenish · Gaurang (`canReworkTakas`).
- Where: order → Takas tab (taka chip menu "Undo send back"), and the Butta → Send / Mill → Send → Refinish pending lists (each re-butta / refinish taka gets "Undo"). Multi-select on the order's Takas tab ("Undo send back (3)").
- Reason required (the shared reason dialog). Event `rework_undone` with the reason.
- Older send-backs without `stage_before_rework`: fall back to `final` (they came from the godown).

### E2 · C6 Undo a QC result / cancel a refinish
Read: `server/src/services/butta-qc.ts`, `mill-qc.ts`, `qc-shared.ts`, QC screens.
- Who: **Gaurang and the Supervisor** (new permission `canUndoQc`; also give it to Jenish). Note: the supervisor today has no order screens — give him a small **"QC corrections"** screen (nav item for roles with `canUndoQc`) with a taka-number search.
- **Undo QC result**: allowed while the taka has not moved on since that QC (Butta QC → still `waiting_mill`, not on a mill challan; Mill QC → still `final` or `refinish` not yet on a challan, not ticked / split / ready in the godown). Effect: the taka goes back to `butta_qc` / `mill_qc`; damages **added** in that QC are deleted (soft), damages **resolved** in that QC are reopened (restore the resolved pcs / metres), photos added in that QC are kept but unlinked. Store what each QC submit changed (migration: `qc_runs` table — taka_id, kind butta|mill, changes JSON, undone_at/by/reason) so the undo is exact.
- **Cancel a refinish**: a taka in `refinish` that is not on a mill challan → back to `final` (godown), event `refinish_cancelled`.
- Both ask for a reason. Events written. Order status recompute.
- UI "QC corrections": search by taka number → taka card (stage, last QC result with time / who, damages) → buttons **Undo QC result** / **Cancel refinish** (only when allowed; otherwise a grey note why). Tablet: card left, history right (2 columns); phone: stacked; desktop: same as tablet with more width. Also show the two actions in the taka details drawer for Jenish / Gaurang.

---

## 7. Phase F — Challans at parties

### F1 · C3 Edit a butta / mill challan · remove a taka
Read: `server/src/services/challans.ts`, `client/src/features/challans/*`, challan print.
- Who: Jenish · Gaurang · Godown supervisor (`canUseButtaModule` / `canUseMillModule` holders; new permission `canEditChallan`).
- **Edit challan**: party, date, e-way no, transport / vehicle, notes — while the challan is active. History line on the challan ("Edited by …: date 04-11 → 05-11").
- **Remove a taka**: only a taka not yet received back. It goes back to the waiting stage it was sent from (`entered` / `rework_butta` for butta, `waiting_mill` / `refinish` for mill). Reason required. If it was the last taka, the challan becomes cancelled (today's cancel logic).
- The challan print shows the current takas; a removed taka is not printed.
- UI: challan details → "Edit" (form: tablet 2 columns, desktop 3, phone 1) and each taka row's menu "Remove from challan".

### F2 · C4 Lost / short taka at a party
- Who: **Gaurang** only (`canMarkLostAtParty`).
- On an active challan, a taka not received back can be marked **Lost / short at party** with a reason. New taka stage **`lost`** (add to `TAKA_STAGES`, label "Lost at party"); the challan row is closed for that taka (counts as "settled"), so the challan can be completed. The taka leaves every pending list and counts; the order dashboard shows "Lost at party: N" under its stage group; the order status recompute ignores lost takas (like deleted ones, but kept for history).
- **Undo lost** (Gaurang, reason): back to the "at party" stage on that challan.
- UI: challan details taka menu "Mark lost / short" (red confirm). Challan list shows "1 lost" chip.

---

## 8. Phase G — Undo dispatch and delivery challan edit

Read: `server/src/services/dispatch.ts`, `shared/src/dispatch.ts`, `client/src/features/dispatch/*`, the DC print.

### G1 · CR-10 Undo dispatch
- Who: Dhruvil · Gaurang · Jenish (`canDispatch` holders; new permission `canUndoDispatch`).
- Undo works on **the whole delivery challan** (latest active revision). Not allowed once any goods return exists against that challan (409 "Goods have come back on this challan — it can't be undone").
- **Reason required.**
- Effect, one transaction: every taka on the challan goes back to `ready_dispatch`; pcs-to-pcs dispatch lines are reversed the same way; the challan gets status **`cancelled`** (add to the DC status type; keep the row, revisions and number — never reused), with `cancelled_at / by / reason`; order status recompute (back from Dispatched); events `dispatch_undone` on each taka and an order event.
- The DC print of a cancelled challan shows a large diagonal **CANCELLED** watermark and the reason in the footer. Lists show a red "Cancelled" badge; cancelled challans are excluded from dispatched totals.
- UI: Dispatched → challan → "Undo dispatch" (danger button) → reason dialog that lists "18 takas go back to Ready for dispatch · DC-12 will be marked Cancelled".

### G2 · C7 Edit a delivery challan
- Who: same three roles. Edit transport, LR no, vehicle, e-way no, date, notes of an active DC without cancelling it. Saved on the challan with history ("Edited by Dhruvil …"); the print shows the current values. No new revision is created for a header edit.

---

## 9. Phase H — Overdue alerts (CR-11 + C5)

Read: `shared/src/pipeline.ts` (`ALERT_RULES`), `shared/src/orderDashboard.ts`, order list cards.

Rules (in `shared/src/overdue.ts`, pure + tests). A clock starts when the stage begins; the alert shows once the stage has lasted longer than the limit:

| Alert | Clock starts | Limit | Shown to |
|---|---|---|---|
| Production overdue | a jobsheet goes on the loom (`started_at`) | 3 days, per jobsheet, until it is completed | Jenish · Gaurang · Supervisor |
| Butta cutting overdue | the butta challan date | 3 days, per taka on the challan, until received | Jenish · Gaurang · Supervisor |
| Mill overdue | the mill challan date | 8 days, per taka, until received | Jenish · Gaurang · Supervisor |
| Whole order overdue | the **first** jobsheet of the order goes on the loom | **25 days for Jenish**, **20 days for Gaurang and the Supervisor**; until the order is fully dispatched or closed | per role as stated |
| Order sent short | the order is Dispatched / Closed and dispatched qty < ordered qty | — | Jenish · Gaurang |

- Limits live in one config object (`OVERDUE_LIMITS`) so they can be changed later.
- Shown on screen only (no push / SMS — not built):
  - an **Alerts** page (`/alerts`, nav item with a count badge for the three roles) grouped by alert type, newest overdue first, each row: order #, design, stage, started, days, "over by N days", link;
  - the order list card: a red "Overdue" chip;
  - the order header: a red banner line per active alert;
  - the supervisor sees only production / butta / mill / whole-order alerts with order numbers (no client, no rate).
- Endpoint `GET /alerts?type=` computed on request (no stored alerts table).
- Tablet: Alerts page = 2-column card grid with a type filter `Segmented` at the top; desktop: grouped tables; phone: cards.

---

## 10. Acceptance checklist (I will test these)

1. New order: Saree / Suit required (default Saree); old orders show Saree; filter works; jobsheet print shows "FG: Saree"; DC does not.
2. Gaurang can hold and release; Jenish can release Gaurang's hold.
3. Close is blocked with the exact list while any jobsheet is on the loom / takas at a party / in QC / refinish / rework / PO open; when clear, pending jobsheets are cancelled and takas with us go to free stock; a held order can be closed when clear.
4. Supervisor Complete asks nothing; after taka entry the jobsheet shows frames = round(total pcs ÷ sections); editing takas recomputes; Change machine still asks frames.
5. Taka entry person edits pcs / meters / damage, deletes and adds rows until the taka is sent on; then it is locked with the bilingual note; number never editable.
6. Outside / FG receipts create takas with the next automatic numbers; weaver number shown as "W …".
7. Dhruvil edits metres on a pcs-order taka; Order details shows expected / actual / shrinkage.
8. Send back to butta → Undo with reason → taka back where it was; impossible once on a challan.
9. Gaurang / Supervisor undo a Butta QC result (damages restored exactly) and cancel a refinish.
10. Edit a butta challan header; remove one unreceived taka (back to waiting); Gaurang marks a taka lost; challan completes.
11. Undo dispatch with reason → takas Ready for dispatch, DC Cancelled with watermark; blocked after a GR; DC header edit works.
12. Alerts page shows production > 3 d, butta > 3 d, mill > 8 d, whole order > 25 d (Jenish) / > 20 d (Gaurang, Supervisor), orders sent short.
13. Every new screen checked at 360 px, 820 px (tablet portrait), 1180 px (tablet landscape) and 1440 px.
