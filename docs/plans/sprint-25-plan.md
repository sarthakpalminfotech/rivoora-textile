# Sprint 25 plan — Insight dashboards (owner, partner, supervisor) with client-arranged layout

Spec: `rivoora-sprint25-insight-dashboards-prompt.md`. Branch `sprint-25` (from `main` = Sprint 24). The owner asked for the
whole sprint "in one go", so the phases are built back to back (one commit per phase) instead of stopping after each one —
including the phase 0 design review (screenshots are taken at the end instead). **No migration is run against Turso**
without the owner's "go" (after a backup).

## Migration — ONE file `0027_sprint25_dashboards.sql` (additive only)

```sql
ALTER TABLE orders ADD promised_date text;              -- On-time delivery (optional, Add / Edit order)
ALTER TABLE outside_pos ADD due_date text;               -- Late POs (optional, PO form) — see clash 2
ALTER TABLE yarn_qualities ADD min_g integer;            -- Low yarn (optional "minimum kg", yarn units like every yarn qty)
CREATE TABLE dashboard_layouts (dashboard text PRIMARY KEY, layout text NOT NULL, updated_by_user_id integer, updated_at text …);
CREATE TABLE app_settings (key text PRIMARY KEY, value text NOT NULL, updated_by_user_id integer, updated_at text …);
-- read-performance indexes (phase E)
CREATE INDEX taka_events_created_idx ON taka_events (created_at);
CREATE INDEX taka_damages_created_idx ON taka_damages (created_at);
CREATE INDEX jobsheets_completed_idx ON jobsheets (completed_at);
CREATE INDEX dispatch_challans_date_idx ON dispatch_challans (challan_date);
CREATE INDEX order_status_history_changed_idx ON order_status_history (order_id, changed_at);
```
`app_settings` keys: `working_hours_per_day` (default 24 when missing) and `insight_stock_match` (hidden flag, off when missing).

## Architecture

- **Shared** `shared/src/insights/`:
  - `period.ts`: periods 7d · 30d · 3m · 6m · 12m · fy, IST days, month buckets.
  - `math.ts`: median / percentile, ±10 %, top-N share, the quiet-client gap rule, age buckets, stage durations, loom hours, dispatch weeks, Indian ₹ / qty text.
  - `types.ts`: card payloads — figure · split · bars (1–2 series) · donut · ranked · table · attention; plus a drawer list, badge and switch views.
  - `registry.ts`: every card of the 3 dashboards, with section, title, answer line, width, period use, rate / client needs, and the default layout. It also holds `mergeLayout` / `validateLayout`.
  - Tests: `insights.test.ts`.
- **Server** `services/insights/*`:
  - One request per screen: `GET /dashboard/:key/cards?ids=&period=` computes each requested card (try / catch per card → inline error) from live rows (memoised loaders on a request context) with the shared pure functions.
  - Layout: `GET /dashboard/:key/layout`, `PUT` (`canArrangeDashboards`), `DELETE` (Reset).
  - Settings: `GET|PUT /dashboard-settings`.
  - Money is null without `canSeeRate`; client names are never sent to roles without `canSeeClient`.
- **Permissions** (`roles.ts`):
  - `canViewOwnerDashboard`, `canViewPartnerDashboard`, `canViewSupervisorDashboard`: Jenish + Gaurang have all three, the supervisor has his own;
  - `canArrangeDashboards`: Jenish + Gaurang.
- **Client** `features/insights/`:
  - `dashboard-page`: top bar · Today strip · Needs attention · sections, with desktop 12-col / tablet 2-or-3-col / phone layouts;
  - `insight-card`: one component with the variants;
  - `charts`: hand-made SVG bars, grouped bars, donut, sparkline, inline bar, with tooltips;
  - `arrange`: drag on desktop, ↑ ↓ on every device, hide, wide, rename section, reset;
  - `detail-sheet`: right drawer on desktop, bottom sheet on tablet / phone;
  - `useIsTabletLayout()` (768–1023, or 1024–1279 with `pointer: coarse`).
  - Nav item **Dashboard** (first) for the three roles; routes `/dashboard`, `/dashboard/:key`; Settings → Dashboard (working hours).

## Cards built (exactly the "considered" ones, in the prompt's order)
- **Owner**: 35 (incl. "Stock that matches an open order" behind the hidden flag). "Needs your attention now" is shown as the
  pinned *Needs attention* panel under the Today strip (§2A says so) — not a second time as a card.
- **Partner**: 18.
- **Supervisor**: 11.
- **Today strips** as listed in §2A.

## Decisions / clashes with the code
1. Pcs and metres never add up: quantity cards carry `Pcs | m` switch views; units kg / g are left out of qty cards.
2. **Late POs needs a due date — outside POs have none.** Added an optional `outside_pos.due_date` (PO form); POs without it are left out (like On-time delivery and the promised date).
3. `yarn_qualities.min_g` (not `min_kg`): every yarn quantity is stored in yarn units (0.1 g); the API / form speak kg.
4. "Where the days go" uses `order_status_history` (time spent in each status group until the next change; the current status counts until now).
5. "Dispatch expected next 4 weeks" is an estimate by stage: ready → week 1, in godown → week 2, at mill / mill QC → week 3, butta / waiting mill → week 4.
6. Damage "type" donut: Machine (in-house) · Weaver (takas from outside POs) · Butta · Mill · Supervisor (godown) · Other (customer return / not marked).
7. "His" (supervisor) = jobsheets whose start or completion event was done by the logged-in supervisor user; owners viewing the supervisor dashboard see all.
8. A FG purchase = an order with none of Production / Butta / Mill; "awaiting goods" = sent, not closed, received < ordered.
9. Loom utilisation: running hours = jobsheet on-loom intervals (start → completion / now) clipped to the period, ÷ (days × working hours per day).
10. Tap-through links go to existing screens with URL filters (orders `q / status / party / material / kind / from / to`, `/alerts?type=`, `/inventory`, `/machine-view`, challans, yarn stock …); the figure drawer shows the top 20 rows of the card first.

## UI per breakpoint
- **Desktop ≥ 1024 (fine pointer)**: 12-col grid (small 3 · normal 4 · wide 6 · full 12), sections one under another, right detail drawer, drag & drop Arrange, full charts (12 bars).
- **Tablet 768–1023 and 1024–1279 touch**: 2 / 3-col grid, sticky section tabs, bottom sheet, large Segmented, ↑ ↓ + handle in Arrange, sticky "Done" bar, ≤ 6 bars (swipe), pull-to-refresh.
- **Phone**: one column, the strip 2 × 3, section tabs, no Arrange.

## Tests
`shared/src/insights/insights.test.ts`; API smoke `scripts/check-sprint-25.mjs` (local file DB only).
