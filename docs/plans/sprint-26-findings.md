# Sprint 26 — Dashboard review findings

Review on the demo database (`npm run demo:seed`, 12-11-2026), three dashboards (owner as Jenish, partner as Gaurang,
supervisor as Supervisor) at 1920 × 1080, 1440 × 900, 1280 × 720 (+ 1280 at 125 % = 1024 CSS px), 1180 × 820 touch,
820 × 1180 touch, 768 × 1024 touch and 390 × 844.

**How:** the Claude in Chrome extension did not connect in this session, so the review ran in the installed Chrome via
Playwright (`node scripts/dashboard-ui.mjs --review`), which also measures every screen: horizontal scroll, elements
outside their card, rows with holes, figure start lines per row, sideways scrollers, truncated text, touch targets under
44 px, and console errors. Measurements: `docs/screenshots/sprint-26/before/metrics.json` (before) and
`…/after-review/metrics.json` (after, same sizes). Full screenshot sets are git-ignored; the committed ones are listed at
the end.

Severity: **breaks** · **ugly** · **minor**. Status after Phase C: ✅ fixed · ⏸ not changed (needs your decision /
outside the dashboards).

| id | dashboard | size | card / area | problem | screenshot (before) | severity | status |
|---|---|---|---|---|---|---|---|
| F01 | all | all | Every column chart (Orders booked per month, Order value booked, Goods returned, Work done twice, Frames woven, Yarn bought vs used, Cloth by stage, QC backlog, Rework open, Dispatch next 4 weeks) | Bars invisible; value labels ("₹2.2 Cr", "7.6k") float outside the card. Cause: each column had `px-[12%]`, a share of the WHOLE chart's width — 12 columns × 24 % = 288 % of the chart, so bars shrank to 0. | owner-1440-section-0-business-pulse.png | breaks | ✅ bars sit in 64 % of their own column |
| F02 | owner | 1920 / 1440 / 1280 / 1024 | page | Horizontal scroll (caused by F01's labels) | owner-1440-full.png | breaks | ✅ |
| F03 | owner, partner | 1440 / 1280 | Business at a glance, Outside work this month, Today on the floor | Split labels cut ("Dispatched th…", "Booked this m…", "Received from …"); "₹ 40.66 L" breaks onto two lines | owner-1440-section-0-business-pulse.png | ugly | ✅ labels wrap to 2 lines, figures never break |
| F04 | all | desktop | top bar | Dashboard switch "Production …" and period "This …" truncated | owner-1440-top.png | ugly | ✅ segments as wide as their label (`Segmented fit`) |
| F05 | all | all | card switches | "All-ov…", "P…" (Business by broker), "m (met…" truncated | owner-1440-section-2-brokers-designs.png | ugly | ✅ |
| F06 | all | desktop | section grids | Rows with holes (owner: 12 rows leave 160–920 px empty; partner 5; supervisor 2) | owner-1440-full.png | ugly | ✅ rows packed: a later card of the section may move up to fill a row; short rows step up to the next standard width (6 + 4 → 6 + 6, 4 → 12) — `packRows` in shared |
| F07 | all | desktop | section grids | Figures of a row start at different heights (up to 58 px; 103 px at 125 %) — cards with a switch or a 2-line title push their figure down | owner-1440-full.png | ugly | ✅ CSS subgrid: header · answer · switch · body share the row's lines |
| F08 | all | 1280 / 1024 | tables (Designs that sell again, Returns by client, Dead stock, Challans out for too long, Orders waiting for jobsheets, Sent but not started, Late POs, FG awaiting, Low yarn, Orders waiting longest, On hold, Lined up per loom) | Tables scroll sideways inside normal cards (fixed 18 rem minimum) | owner-1280-full.png | ugly | ✅ tables fit the card |
| F09 | owner | all | Where the open orders are right now | 16 rows make the whole row ~1,100 px tall and leave big empty cards beside it | owner-1440-section-0-business-pulse.png | ugly | ✅ ranked lists show 8 rows + "Show all 16" |
| F10 | all | 768–1180 touch | 2- / 3-column tablet grids | Single cards alone in a row (owner 9 holes at 820 / 768) and figures not aligned | owner-820t-tab-1-clients.png | ugly | ✅ same packing (2 / 3 columns) + subgrid |
| F11 | owner | 1180 / 820 / 768 | column charts in narrow cards | Bars 39 px wide — too small to tap | owner-1180t-tab-0-overview.png | minor | ✅ at least ~52 px per column, the rest swipes |
| F12 | owner, supervisor | touch | "+ N more", donut legend, ranked rows, Refresh (phone) | Touch targets 28–40 px high | metrics.json | minor | ✅ 44–48 px on coarse pointers |
| F13 | owner | 1180 touch | Dispatch next 4 weeks | Axis labels "Wk of 16 Nov" cut | owner-1180t-tab-9-attention-team.png | minor | ✅ axis labels wrap to 2 lines |
| F14 | owner | 1024 (125 %) | Damage by type | Donut legend % column outside the card (after F06 made the card narrower) | after-review/owner-1280z125-full.png | breaks | ✅ legend moves under the donut when there is no room |
| F15 | all | all | top bar + page heading | "Owner dashboard" twice (top bar and page heading) | owner-1440-top.png | minor | ✅ top bar says "Dashboard" |
| F16 | all | 1920 | page | Content width: was already capped at 1440 px; at 1280 the 32 px gutter squeezed the grid | owner-1920-top.png | minor | ✅ max 1440 centred at every desktop width, 24 px gutters (16 px at ≤ 1280) |
| F17 | partner, supervisor | all | Completed short | Jobsheets split by **Change machine** always show as short (−45 %, −57 %): the old jobsheet keeps its assigned frames, the rest went to the new one. Not a ±10 % problem of the loom. | partner-1440-full.png | content | ⏸ needs your decision: leave out machine-changed / held jobsheets, or compare with the frames completed at the change |
| F18 | partner, supervisor | all | Completed short | Whole-frame rounding: a 9-frame jobsheet (4 sections) with 38 pcs = 9.5 → 10 frames = +11 % and is listed. Small jobsheets cross ±10 % by rounding alone. | (demo seed log) | content | ⏸ needs your decision: compare pcs (frames × sections) instead of rounded frames |
| F19 | partner, supervisor | all | every figure | No figure opens a detail drawer / sheet (only the owner's do); taps go straight to the list | partner-1440-full.png | content | ⏸ by Sprint 25 design; say if you want drawers there |
| F20 | all | 1180 touch | app layout | The app's own sidebar shows at 1180 (≥ 1024 px) while the dashboard correctly uses the tablet layout | owner-1180t-top.png | minor | ⏸ outside the dashboards (app-wide navigation rule) |
| F21 | owner | 390 | Needs attention table | Four columns on a phone wrap "Overdue" under the dot; usable | owner-390-tab-0-overview.png | minor | ⏸ phone = sanity only |
| F22 | owner | all | Needs attention → "Sent short 41" | Demo data: meter orders lost 1–4 % to shrinkage and a −1 pc correction landed on exact orders, so 41 orders looked sent short | owner-1440-top.png | data | ✅ demo seed fixed (meter orders woven a little long); now ≈ 11 |
| F23 | all | all | console | No console errors or React warnings at any size | metrics.json | — | ✅ |
| F25 | all | laptop (owner's screenshots) + every desktop / tablet size | Business at a glance, Order value booked, On-time delivery, Damage % / money, TFO machines, Late POs … | Big empty space inside cards: equal-height rows stretched a short card to its tall neighbour (On-time delivery 566 px empty next to the 10-row Oldest open orders); the subgrid's shared switch row added an empty band under the description of cards without a switch | (owner's laptop screenshots) | ugly | ✅ measured masonry (each card its natural height, the next card moves up), switch inside the body; 0 cards with > 72 px empty at all 24 dashboard × size combinations, now asserted by the UI test |
| F07b | all | desktop | section grids | F07's aligned figures are given up for F25: cards in a "row" no longer share a top line exactly, and a section can end lower in one column | — | trade-off | ✅ chosen (no empty space inside cards matters more) |
| F24 | all | 1180 touch | layout mode | 1180 × 820 with touch uses the 3-column tablet layout, 1280 without touch the desktop one | metrics.json | — | ✅ (asserted by `npm run test:dashboard-ui`) |

## Content checks

- Units and periods: every figure shows its unit and a period chip (Now / Today / Last 30 days / Last 12 months).
- pcs and m never added together: totals are "2,60,849 pcs · 7,430 m" style everywhere.
- Indian number format: 2,45,000 pcs · ₹ 40.66 L · ₹ 6.63 Cr.
- ±10 % cards list only items beyond 10 % (see F17 / F18 for what that includes).
- Tap-through counts (checked through the API on the demo data: card value vs `GET /orders` with the card's link
  filters): Open orders 57 = 57, Ready to dispatch 2 = 2, In production 21 = 21; Clients gone quiet lists the 4 clients
  that stopped ordering.
- The supervisor sees no client names or rates (order numbers only).
- Deliberate edge cases render: the 72-character client name truncates with a tooltip, the 2,45,000 pcs / ₹ crore
  bars, "▼ 82 % vs last month", "Returns by client" with one client, the supervisor's empty Performance section ("Every
  completed jobsheet is within ±10 %").

## Committed screenshots

`docs/screenshots/sprint-26/before/` and `…/after/`: `<dashboard>-1440-top`, `-1440-full`, `-1180t-top`,
`-1180t-tab-0-overview` for owner / partner / supervisor, `owner-1440-drawer`, `owner-1180t-drawer`, plus
`before/owner-1440-section-0-business-pulse.png` (F01) and `before/owner-1440-arrange.png`.
