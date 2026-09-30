# Rivoora Textile — Sprint 3: Supervisor role, machine production flow, Machine view

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first; they describe the current code, including the Sprint 2 jobsheets work. **Reuse the existing patterns and components**: the selection mode from the orders list, `ConfirmDialog`, `ResponsiveModal`, `Select`/`MultiSelect`, `StatusBadge`, `ImageThumb`, `EmptyState`, `Skeleton`, `SearchBar`, `LoadMore`, the tabs, the format helpers, theme tokens and the full-screen form style. New screens must look like the existing ones. Don't restyle or refactor other screens beyond what this document asks.

**How to work**
0. Run `git status`. If there are uncommitted changes, stop and tell me so I can commit them first.
1. Start in plan mode and show me the plan: schema + migration, status configs, endpoints, screens, and how the order status is recomputed.
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.

---

## 1. Rename: "Ready for production" → "Jobsheet pending"

- Change only the **label** of the `ready_production` status to **Jobsheet pending**. Keep the key `ready_production` so existing data keeps working.
- Search the client for every hard-coded text that says "ready for production" and reword it:
  - "No orders ready for production yet" → "No orders pending for jobsheets yet"
  - undo dialog texts, toasts, empty states, hints

---

## 2. New role: Supervisor

Add a third role in `shared/src/roles.ts`: **`supervisor`**, name "Supervisor", initial "S". It must be a valid `X-Role` value and appear in the profile menu's **Switch role** list.

New permissions (and their values for the existing roles):

| Permission | jemish | gaurang | supervisor |
|---|---|---|---|
| `canViewJobsheetsModule` (the Jobsheets nav module) | ❌ | ❌ | ✅ |
| `canRunJobsheets` (start / complete / change machine) | ❌ | ❌ | ✅ |
| `canPrintJobsheets` | ✅ | ✅ | ✅ |
| `canViewMachineView` | ✅ | ✅ | ✅ |
| `canManageJobsheets` (existing: create, edit, delete, send, pull back) | ✅ | ✅ | ❌ |
| `canManageMachines`, `canManageMasters`, `canAddOrder`, `canSeeRate`, and the other existing permissions | as now | as now | ❌ |

**Supervisor visibility:**
- Nav items: **Jobsheets** and **Machine view** only. There are no Orders or masters links, and those routes redirect him to `/jobsheets`.
- On the server, every order and master endpoint returns 403 for the supervisor, except the lookups he needs (active machines).
- No order status is `visibleTo` the supervisor.
- He can see jobsheets whose status is **Sent / Ongoing / Completed**, never Pending (not yet sent).
- Where a jobsheet shows its order, the supervisor sees only the **order number as plain text** (no link) and never sees the client name, rate or order details.

**Landing routes:**
- `/` and the role-switch target go to `/orders` for Jemish and Gaurang, and to `/jobsheets` for the supervisor.
- Keep the landing route per role in the roles config.

**Nav:**
- Jemish and Gaurang get a new nav item **Machine view**, after Orders.
- Check that the phone bottom nav still fits at 360px now that Jemish and Gaurang have 6 tabs. If it doesn't, use a clean "More" tab/menu for the masters. Don't let labels wrap or overflow.

---

## 3. Jobsheet statuses

Extend the existing `JOBSHEET_STATUSES` config (in shared; check how it's currently stored and add a real `status` column to `jobsheets` if it's only client-side). Keep it config-driven, like the order statuses.

| key | label (Jemish/Gaurang) | label (Supervisor) | sequence | badge |
|---|---|---|---|---|
| `pending` | Pending | — (never shown) | 10 | grey / slate |
| `sent` | Sent to supervisor | **Pending** | 20 | amber |
| `ongoing` | Ongoing | Ongoing | 30 | blue |
| `completed` | Completed | Completed | 40 | green |

Add a helper `jobsheetStatusLabel(status, role)`, and make sure `StatusBadge` (or a `JobsheetStatusBadge`) uses it everywhere.

**New columns on `jobsheets`** (in a new migration):
- `status` (default `pending`; backfill existing rows as `pending`)
- `sent_at`, `started_at`, `completed_at` (nullable ISO)
- `running_machine_id` (FK → machines, nullable): the machine it was started on
- `completed_frames` (integer, nullable): the actual frames made
- `parent_jobsheet_id` (FK → jobsheets, nullable): set on the new jobsheet created by *Change machine*
- `suggested_machine_id` (FK → machines, nullable): the machine chosen in *Change machine*, pre-selected at Start

Add indexes on `status` and `running_machine_id`.

**New table `jobsheet_events`** (the history timeline):
- `id`, `jobsheet_id` (FK, indexed), `event` (`created` | `sent` | `pulled_back` | `started` | `completed` | `machine_changed`)
- `machine_id` (nullable), `frames` (nullable), `note` (nullable text, e.g. "continued as jobsheet 331")
- `role`, `created_at`

Write an event for every action below.

**Rules:**
- Only **Pending** jobsheets can be edited or deleted. For other statuses, hide Edit and Delete in the UI, and the server returns 409 ("Pull it back from the supervisor first").
- **Pull back:** allowed only for **Sent** jobsheets (not yet started). Sent → Pending.

**Auto-adjust (Sprint 2, rule 7.4) must now only touch Pending jobsheets:**
- The "last jobsheet" used by the auto-adjust is the **highest-numbered Pending jobsheet**.
- If the edited jobsheet is the only Pending one, or is itself the last Pending one, treat it as "editing the last" (no other jobsheet changes; only warnings).
- Sent, Ongoing and Completed jobsheets are never changed, split or removed by the auto-adjust.
- Update `planFramesEdit` and its tests to cover this.

**Coverage (Sprint 2, rule 7.5) now uses actual frames:**
- Each jobsheet counts `completed_frames` if it's Completed, otherwise `frames`.
- "Frames in jobsheets" and the warnings use this. There is no auto-adjust when actual differs from assigned; only the warnings show it.
- Add tests for this.

---

## 4. Order status: moves automatically with the jobsheets

Add two order statuses (both visible to Jemish and Gaurang, not the supervisor):

| key | label | sequence | badge |
|---|---|---|---|
| `in_production` | In production | 40 | blue / sky, distinct from indigo "Jobsheet created" |
| `production_completed` | Production completed | 50 | teal / emerald |

Write **one** server function, `recomputeOrderStatus(orderId, role, tx)`, and call it at the end of every jobsheet write in the same transaction:
- no active jobsheets → `ready_production` (Jobsheet pending)
- all active jobsheets are Completed → `production_completed`
- any jobsheet is Ongoing or Completed (but not all Completed) → `in_production`
- otherwise (all Pending/Sent) → `jobsheet_created`

Only write `order_status_history` when the status actually changes. It never moves an order that's still `pending_production`. Undo send-for-production for the order still requires zero jobsheets.

---

## 5. Gaurang/Jemish: send jobsheets to the supervisor (order details → Jobsheets card)

**Send button:**
- Add an **icon button** with an upward-arrow/upload icon (lucide `ArrowUpFromLine` or `Upload`) beside the existing Create jobsheets / Add single jobsheet / Print all actions.
- Tooltip: "Send to supervisor".
- It needs `canManageJobsheets`, and it's disabled (with a tooltip explaining why) when no jobsheet is Pending.

**Selection mode** (reuse the order-list selection-mode pattern and styling):
- Clicking the icon enters selection mode, with nothing pre-selected.
- Only **Pending** jobsheet cards are selectable, with a checkbox indicator. Every other card is dimmed and not clickable.
- The card taps toggle selection instead of opening details. The other card actions are hidden.
- A small info banner reads: "Select the jobsheets to send to the supervisor."

**Action bar** (fixed above the bottom nav on phones, sticky at the bottom of the card on md+):
- "N selected"
- **Select all pending**
- **Cancel**
- **Send for machine production (N)**, which reads **Send (N)** on phones; disabled at 0

Escape exits selection mode.

**On send:**
- A confirm dialog: "Send N jobsheets to the supervisor?"
- One API call, in one transaction: Pending → Sent, with `sent_at` and events.
- Toast: "N jobsheets sent to supervisor"
- Exit selection mode and refresh.

**Cards in the order details listing:**
- Show the status badge with the Jemish/Gaurang labels.
- For **Completed** jobsheets, frames show as **actual/assigned**, e.g. `8/10 frames`. Show it in amber when actual is less, and use neutral styling when it's equal or more.
- For **Ongoing** jobsheets, show "Machine 7".
- A jobsheet created by *Change machine* shows a small "continued from 319" line.
- The summary tiles use the new coverage numbers. Add one tile: **Completed** `X of Y jobsheets`.

**Jobsheet details page (Jemish/Gaurang):**
- **Sent** jobsheets get a **Pull back from supervisor** button (confirm dialog → Pending).
- Edit and Delete appear only for Pending jobsheets.
- Add an **Activity** timeline card built from `jobsheet_events`: "Sent to supervisor", "Started on Machine 7", "Completed — 8 of 10 frames", "Moved from Machine 7 → continued as jobsheet 331"…, each with date/time and role.

---

## 6. Supervisor: Jobsheets module (`/jobsheets`)

He mostly uses a **tablet**, so design this screen tablet-first: large tap targets (buttons at least 48px high), clear hierarchy, and readable at arm's length. It must still work well on phones and desktop.

**Header:**
- Search: jobsheet number or design code, debounced.
- **Tabs with counts:** All / Pending / Ongoing / Completed. Default **All**.

**Sorting:** Pending first, then Ongoing, then Completed. Within Pending and Ongoing sort by jobsheet number ascending (oldest first); within Completed, most recently completed first. Use server-side pagination with the existing infinite scroll + Load more.

**Card grid:** 1 column on phones, 2 at md, 3 at lg, 4 at xl. Each card shows:
- the **design image** (the variation image if set, else the design image) as a prominent square or landscape thumbnail, larger than the order list thumbnail (tap → lightbox)
- **Jobsheet 319** in large text, plus a status badge (supervisor labels)
- the design code, frames, picks, and "Order #12" as small plain text
- for **Ongoing**: "Machine 7 · started 2h 10m ago" (relative time)
- for **Completed**: the actual/assigned frames (e.g. `8/10 frames`) and the completed date
- **Actions** at the bottom, full width:
  - Pending: **Start** (primary)
  - Ongoing: **Complete** (primary) and **Change machine** (secondary), side by side
  - Completed: no actions

  The action buttons don't open the details page; tapping elsewhere on the card does.

**Empty states** per tab: "No jobsheets waiting", "Nothing running right now", "No completed jobsheets yet".

### 6.1 Start dialog
A centred modal on tablet/desktop and a bottom-anchored or full-screen modal on phones, whichever fits the existing `Modal` variants best.
- At the top: **Jobsheet 319** (display only) with the design code and a small thumbnail.
- "Select machine" with **large square tap chips**, one per machine assigned to this jobsheet (active machines only), showing the machine number big.
  - If the jobsheet has a `suggested_machine_id`, that chip is **pre-selected**.
  - A chip for a machine that already has an ongoing jobsheet shows a small "busy · 321" note but can still be chosen.
  - Selection is **required**: the **Start** button is disabled until a chip is selected.
- Buttons: Cancel / **Start**.

**On Start:**
- Sent → **Ongoing**, set `running_machine_id` and `started_at`, write an event, and recompute the order status.
- Use a conditional update (`WHERE status = 'sent'`); return 409 if it has already been started.
- Toast: "Jobsheet 319 started on Machine 7".

### 6.2 Complete dialog
- Title "Complete jobsheet 319", showing the machine and the assigned frames.
- **Frames completed:** an integer ≥ 0, **prefilled with the assigned frames**, editable. Use a stepper control (− / number / +) with large buttons, and allow typing.
- If the value differs from the assigned frames, show a note: "Assigned 10 — you're recording 8 (2 fewer)."
- Buttons: Cancel / **Complete**.

**On Complete:**
- Ongoing → **Completed**, set `completed_frames` and `completed_at`, write an event, and recompute the order status.
- The machine becomes idle if nothing else is running on it.

### 6.3 Change machine dialog
- Title "Change machine — Jobsheet 319", showing "Currently on Machine 7 · 10 frames assigned".
- Fields:
  1. **New machine**: the standard `Select` with **all active machines from Machine Master** ("Machine 9 · name"). Required. It may show a "busy" hint.
  2. **Frames completed on Machine 7**: a `Select` dropdown with the options **0 to the assigned frames**. Required.
  3. **Frames to make next**: a `Select` dropdown with the options **1 to a max** (use a constant, e.g. `MAX_FRAMES_PICK = 100`). **Prefilled with the remaining frames** (assigned − completed), and it updates when "completed" changes, until the user edits it themselves. Editable.

  Using dropdowns avoids typing errors on the tablet.
- A live summary: "Jobsheet 319 will be completed with 4 frames. A new jobsheet with 6 frames will be created for Machine 9."
- Buttons: Cancel / **Confirm**.

**On Confirm (one transaction):**
- The current jobsheet → **Completed**, with `completed_frames` = completed, `completed_at`, and a `machine_changed` event.
- A **new jobsheet** is created:
  - a new number from the `counters` table
  - same order, frames = next, picks copied
  - `parent_jobsheet_id` = the old jobsheet
  - `suggested_machine_id` = the chosen machine
  - its machine list = **all active machines** in Machine Master
  - status **Sent**, so it appears in the supervisor's Pending tab. It is **not** started: he has to press Start again, and the chosen machine is pre-selected there.
  - `created_by` = supervisor, plus `created` and `sent` events
- The order's `jobsheet_pieces` and `target_frames` don't change. The coverage warnings reflect any difference.
- Recompute the order status.
- Show a toast: "Jobsheet 319 completed (4 frames). New jobsheet 331 (6 frames) is waiting to start." It has a **Print** action that opens the print route for the new jobsheet.

### 6.4 Supervisor's jobsheet details (`/jobsheets/:id`)
Use the existing page, adapted by role:
- The back link goes to `/jobsheets`.
- Shows the jobsheet number and status badge; the design image (lightbox) and code; frames (actual/assigned when completed), picks and machines; the order number as **plain text**; the running machine and started time; and the Activity timeline.
- Actions depend on the status: **Start**, or **Complete** + **Change machine**, plus **Print**, using the same dialogs as the list. There's no Edit, Delete or Pull back.
- 404 for Pending (unsent) jobsheets.

---

## 7. Machine view module (`/machine-view`, all 3 roles)

The goal: **at one glance, see which machines are running what and which are idle.** Design it as a visual **machine floor board**, not a table. Make it clean and polished; this is a showcase screen.

**Top summary bar:**
- Three stat pills/tiles: **Total machines**, **Running** (green), **Idle** (grey).
- Tapping one filters the board. Include an "All" filter; the default is All.
- On the right: a "Last updated hh:mm" text and a small refresh button.

**Machine tiles:** one tile per **active** machine, sorted by machine number.
- Responsive grid: 2 columns on phones (use compact tiles), 3–4 at md, 5–6 at xl, so a tablet shows the whole floor with little scrolling.
- **Tile header:** the machine number in large, bold type (e.g. **07**, or "M-07"), the machine name if any, and a state indicator (a pulsing green dot + "Running", or a grey dot + "Idle").
- **Running tile:**
  - A clear visual accent, e.g. a green top border/stripe and a soft green tint. It must be clearly different from idle tiles at a glance.
  - The body lists **each ongoing jobsheet** on that machine as a compact tappable row or chip: a small design thumbnail, **Jobsheet 319** (bold), the design code, frames, and "2h 10m" running time. Tapping a row opens `/jobsheets/:id`.
  - When several jobsheets are on one machine, stack them neatly with each number clearly readable. If there are more than 3, show 3 plus "+N more", which expands inside the tile.
- **Idle tile:** a muted look, a simple idle icon, the text "Idle", and "since 3h" (the time since the last jobsheet completed on it; hide this if it has never run).
- **Inactive machines** are not in the main grid. Show them in a collapsed "Inactive machines (N)" section at the bottom, greyed out.

**Behaviour:**
- Data comes from one lightweight endpoint, `GET /api/machine-view`. It returns the active machines with their ongoing jobsheets (id, number, frames, design code, thumbnail, started_at) and last-completed time. Use one or two queries, not per machine.
- Auto-refresh every 30 seconds (React Query `refetchInterval`) and on window focus. The relative times update without refetching.
- There's a skeleton board while loading, and an empty state if no machines exist. For roles that can manage machines, the empty state links to Machine Master.
- Tapping a jobsheet opens its details page for every role. Jemish and Gaurang get their version, the supervisor gets his.

---

## 8. API summary

| Method | Path | Purpose | Permission |
|---|---|---|---|
| POST | `/orders/:id/jobsheets/send` | `{ jobsheetIds[] }`: only Pending ones → Sent (skip others; 409 if none) | `canManageJobsheets` |
| POST | `/jobsheets/:id/pull-back` | Sent → Pending (409 otherwise) | `canManageJobsheets` |
| GET | `/jobsheets?tab=all\|pending\|ongoing\|completed&search=&page=&limit=` | The supervisor's list with the sorting from §6, plus tab counts | `canViewJobsheetsModule` |
| POST | `/jobsheets/:id/start` | `{ machineId }`: the machine must be one of the jobsheet's machines and active | `canRunJobsheets` |
| POST | `/jobsheets/:id/complete` | `{ completedFrames }` (int ≥ 0) | `canRunJobsheets` |
| POST | `/jobsheets/:id/change-machine` | `{ newMachineId, completedFrames, nextFrames }` | `canRunJobsheets` |
| GET | `/jobsheets/:id` | Now includes status, times, running machine, parent/child numbers and events. For the supervisor it omits the client/order details (order number only) and returns 404 for Pending | role-aware |
| GET | `/jobsheets/print?ids=` | Now also allowed for the supervisor (his visible jobsheets only) | `canPrintJobsheets` |
| GET | `/machine-view` | The board data | `canViewMachineView` |

- Existing PUT/DELETE on a jobsheet return 409 unless it's Pending.
- Every state change uses a conditional update on the current status, inside a transaction, and ends with `recomputeOrderStatus`.
- Validate every body with zod schemas in `shared/src/schemas.ts`.
- After each mutation, invalidate the jobsheet, order, orders-list, supervisor-list and machine-view queries.

---

## 9. Quality checklist

- Shared tests cover:
  - the auto-adjust touching only Pending jobsheets
  - coverage using actual frames
  - `recomputeOrderStatus` rules (as a pure function in shared that takes a list of jobsheet statuses)
  - the Change-machine prefill logic
- No double actions: buttons show a loading state while their request runs, and they're disabled until it finishes.
- The supervisor can never reach order or master data, whether through the UI or the API (test with the `X-Role: supervisor` header).
- Test every new screen at 360px, 768px (**the tablet layout is the priority for the supervisor**), 1024px and 1280px. There must be no horizontal overflow.
- Loading, empty and error states everywhere, consistent with the existing screens.

## 10. Build phases

1. **Migration and configs:** the new jobsheet columns, the `jobsheet_events` table, the backfill, the rename label, the new order statuses, the supervisor role and permissions, and the per-role landing and nav.
2. **Shared logic and tests:** `recomputeOrderStatus`, the updated `planFramesEdit`, coverage with actual frames, and the change-machine helpers.
3. **Send to supervisor:** the endpoints, pull back, the edit/delete restrictions, and the order-details selection mode, cards and tiles.
4. **Supervisor Jobsheets module:** the list, tabs, and the Start, Complete and Change machine dialogs, plus the role-aware details page and Activity timeline.
5. **Machine view:** the endpoint and the board UI.
6. **Polish:** test every flow as all three roles at every breakpoint, and update `CLAUDE.md` and `PROJECT_STATE.md`.
