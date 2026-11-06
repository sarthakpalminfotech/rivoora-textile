# Sprint 23 plan — financial-year numbering (CR-23) + QC login limits (C10)

Spec: `rivoora-sprint23-fy-numbering-qc-login-prompt.md`. Branch `sprint-23` (from `sprint-22`). Written after the build; it records what was built and the decisions.

## Phase A — numbers restart each financial year

### A1 · Every automatic number (inventory)

| Number | Table · column | Counter key | Shown as |
|---|---|---|---|
| Order | `orders.order_no` | — (`MAX+1` within the FY) | `#26` |
| Jobsheet | `jobsheets.jobsheet_no` | `jobsheet_no` | `Order #26 (319)` |
| Taka | `takas.taka_no` | `taka_no` (starts at 11) | `6245` |
| Dummy taka | `takas.taka_no` | `dummy_taka_no` | `D01` |
| Butta challan | `challans.challan_no` (kind butta) | `butta_challan_no` | `GSM-n` |
| Mill challan | `challans.challan_no` (kind mill) | `mill_challan_no` | `MIL-n` |
| Delivery challan | `dispatch_challans.challan_no` (+ revision) | `dispatch_challan_no` | `DC-12 R1` |
| Goods return | `party_returns.return_no` | `party_return_no` | `GR-n` |
| Damaged lot | `damaged_lots.lot_no` | `damaged_lot_no` | `DL-n` |
| Outside PO | `outside_pos.po_no` | outside PO counter | PO no |
| Yarn PO | `yarn_pos.po_no` | yarn PO counter | PO no |
| TFO box | `yarn_boxes.box_no` | `yarn_box_no` | box no (year shown from Sprint 24) |
| Beam | `beams.beam_no` / `beam_code` | `beam_no` / `yarn_beam_code_no` | `1`, `2` … |
| Warping job | `warping_jobs.job_no` | `warping_job_no` | `WJ-n` |

Internal only (not per FY): stock-holder order numbers (negative), yarn adjustment ids.

### Decisions

- **No jump for live data.** The start FY (`NUMBERING_START_FY`, default `2026-27`) keeps the existing global counter rows; from 1 April 2027 each FY has its own row `"<key>:<fy>"`. Nothing is renumbered.
- **Backfill**: `fy` = the FY of `created_at` in IST (CASE on `strftime(… '+330 minutes')`); a DC revision takes its parent's `fy`. Checked on a copy of a populated DB including 31-03 23:59 / 01-04 00:00 IST rows.
- **Taka numbers restart at 11** (`TAKA_NO_START`) in a new year, like the first year — not at 1.
- **Lookups**: current-FY matches if any, else all older matches; one → open it; several → candidates with the year ("Which one?"). The QC correction screen answers with a 409 listing the years instead of a picker.
- **QR** `/j/<fy>/<no>`; old prints `/j/<no>` resolve current-year-first.
- **Drizzle default gotcha** (found by the FY simulation): a static `.default()` wins over `$defaultFn`; the runtime clears it for every `fy` column (`server/src/db/client.ts`).

### Unique indexes dropped and recreated by 0024 (needs the go before Turso)

`beams_beam_no_unique` → (fy, beam_no) · `beams_beam_code_unique` → (fy, lower(beam_code)) · `challans_kind_challan_no_unique` → (kind, fy, challan_no) · `damaged_lots_lot_no_unique` → (fy, lot_no) · `dispatch_challans_no_revision_unique` → (fy, challan_no, revision) · `jobsheets_jobsheet_no_unique` → (fy, jobsheet_no) · `orders_order_no_unique` → (fy, order_no) · `outside_pos_po_no_unique` → (fy, po_no) · `party_returns_no_unique` → (fy, return_no) · `takas_taka_no_active_unique` → (fy, taka_no) where not deleted · `warping_jobs_job_no_unique` → (fy, job_no) · `yarn_boxes_box_no_unique` → (fy, lower(box_no)) · `yarn_pos_po_no_unique` → (fy, po_no).

Each recreated index is at least as strict as before for existing data (all existing rows are in one or two FYs and were globally unique), so the CREATE cannot fail on live data.

## Phase B — QC login limits

- Only the QC role. Places (name, lat, lng, radius default 200 m, active), login hours (08:30–19:20, days Mon–Sun, editable), extra time per QC user (date, until, reason, cancellable).
- Login: inside a place (distance ≤ radius + accuracy, accuracy counted up to 100 m) and inside the hours or a grant. No place configured = place not checked. Location denied → refused with a bilingual explanation.
- Session `valid_until` checked on every request; heartbeat every 5 min + on focus; outside on 2 heartbeats in a row ends the session; 401 carries the bilingual reason, shown on the login screen. Toast 10 min before the end; bar "Logged in until 7:20 pm / शाम 7:20 तक".
- Log of refused logins / forced logouts (30 days) and of every settings change (who, when, before → after).
- Screen: Settings → QC login limits (Masters hub) — places full width on top, hours + extra time side by side on tablets, log below.

## Verification

`npm run typecheck`, `npm test` (479), `npm run build`, `node scripts/check-sprint23.mjs` (QC limits + servers with `FY_NOW=2027-04-05` and `2028-04-05`), regression `check-sprint21`, `check-sprint22`, `check-auth` — all on a local file DB.

## Still open

Apply 0022 → 0025 on Turso (backup + go); real-phone GPS check; screenshot pass of the Settings screen; `check-sprint16.mjs` still expects the old receipt numbering.
