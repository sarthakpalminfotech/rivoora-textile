# Rivoora Textile — Sprint 12: Rework loops, Dhruvil (dispatch + goods return), Mark as fresh, Login & users

This continues the existing project. Read `CLAUDE.md` and `PROJECT_STATE.md` first, especially Sprints 7–11: generic challans, `taka_damages`, `taka_events`, the godown Orders module, Inventory, the one `qc` role, system-generated taka numbers, and mill receive by count.

**Keep the current look and patterns** and follow the visual rules from Sprint 8 §11:
- calm surfaces, one focal number, colour only as small accents
- `tabular-nums`, generous spacing
- screenshots at 360 / 768 / 1280px with a refinement pass per UI phase

Reuse the existing components: selection mode + action bar, `ConfirmDialog`, full-screen forms, the damage popup with images, the challan print engine, `TickBox`, `MasterList`.

**How to work**
0. Run `git status`. **Sprints 9–11 are not committed yet.** Stop and tell me so I can commit them first. Make sure migrations 0010 and 0011 are applied (`npm run db:migrate`) before adding new ones.
1. Start in plan mode and show me the plan: migrations, stage/status changes, the auth design, endpoints, screens. **Login touches every request, so plan it carefully** (§6).
2. Build in the phases at the end. After each phase, run `npm run typecheck` and `npm test`, run the app, fix all errors, and give me a short summary.
3. At the end, update `CLAUDE.md` and `PROJECT_STATE.md`.
4. **Never break existing flows.** Every migration is additive. Re-test the existing roles' main flows after each phase.

---

## 1. Rework: sending takas back to butta cutting or the mill

Sometimes a taka at a later stage has to go **back** to butta cutting or the mill. Jemish and Gaurang decide this from the order.

### 1.1 Where
On the order details page **Takas** tab (Jemish/Gaurang, new permission `canReworkTakas`):
- a **Select** action starts the existing selection-mode pattern
- action bar: "N takas selected" · **Send back to butta cutting** · **Send back to mill** · Cancel

**Selectable takas (with us now):**
- `entered`, `waiting_mill`
- `butta_qc`, `mill_qc` (received, QC pending)
- `final`, `ready_dispatch`, `refinish`
- returned takas (§4)

**Not selectable:** takas **at** butta cutting or **at** the mill right now (`at_butta`, `at_mill`), and **dispatched** takas (they come back only through GR). These are greyed, with a tooltip saying why.

**Confirm dialog:** taka count, pcs, and a short line per current stage ("3 from godown, 1 ready for dispatch"), plus an optional note.

### 1.2 What happens (one transaction)
- **Send back to butta cutting:**
  - taka → new stage **`rework_butta`**
  - `rework_count + 1`
  - `sent_back` event (target, note, role)
  - clears `godown_checked_at/by`
- **Send back to mill:**
  - taka → the existing **`refinish`** stage (it already goes back to the mill through Mill → Send → **Refinish**)
  - `refinish_count + 1`, plus a `sent_back` event with reason "Sent back by owner"
- Recompute the order status.

### 1.3 Butta cutting picks them up
- Butta cutting → Send → **Pending** lists `entered` **and** `rework_butta` takas. Rework takas carry a small **"Re-butta"** tag (with ×N when sent back more than once).
- After that it's the normal flow: challan (GSM-n), receive, QC.
- The Mill **Refinish** sub-tab shows owner-sent takas with a **"Re-mill"** tag (reason "Sent back by owner") next to QC refinish takas.

### 1.4 Where a taka goes after Butta QC (important rule)
Add a shared helper, `stageAfterButtaQc(taka)`:
- If the taka has **already been to the mill before** (any mill challan row in its history, or `refinish_count > 0`) → **`final`** (back to the godown). It has already been bleached/dyed once, so it does **not** go to the mill again automatically.
- Otherwise → **`waiting_mill`** (the normal flow).

Re-mill takas follow the existing refinish flow: Mill QC → `final`.

Tests: both branches of the helper; selection rules; the status recompute.

**Pipeline/dashboard:** add `rework_butta` to the Butta cutting main stage as a sub-stage **"Sent back · waiting"** (connected). Takas tab stage dots and taka history show the new stage and events.

---

## 2. New role: **Dhruvil** (dispatch)

- Role key `dhruvil`, name **"Dhruvil"**, title "Dispatch", English only. Phone + tablet.
- Landing: `/godown/orders`.
- **Move from the godown supervisor to Dhruvil:** the whole **Orders** module (`canUseGodownOrders`: final takas, tick, actual pcs, split, mark damage / resolve, send to refinish, Ready to dispatch).
- The godown supervisor keeps only **Butta cutting** and **Mill**. Remove Orders from his nav and permissions; his landing stays `/butta`.
- **Dhruvil sees the client name and the rate** (`canSeeClient`, `canSeeRate`).
- New permissions: `canDispatch`, `canGoodsReturn`, `canMoveTakas` (§5).
  - Dhruvil gets all of them, plus `canUseGodownOrders`.
  - Jemish and Gaurang get them too.
- **Nav:** **Orders** (the godown orders screen; keep the "Orders" label) and **Dispatched**.

---

## 3. Dispatch

### 3.1 Dispatch from the order screen (`/godown/orders/:orderId`)
- Next to **Ready to dispatch**, add a primary **Dispatch** button. It's enabled when the order has takas in `ready_dispatch`.
- **One order can be dispatched in several lots.** Each dispatch takes **all** takas currently ready for dispatch.
- **Confirm modal:**
  - client (M/s name)
  - takas count, total pcs, total meters
  - challan date (today)
  - optional **Transport**, **LR no**, **Eway no**
  - Cancel / **Create dispatch challan**

**On confirm (one transaction):**
- new challan number from the counter `dispatch_challan_no`, displayed **`DC-<n>`** (DC-1, DC-2…, never reused)
- create the challan and its rows (meters/pcs at dispatch)
- takas → new stage **`dispatched`** (`dispatched` event)
- recompute the order status
- open the **challan preview** (Print / Close)

### 3.2 Order statuses (extend the shared status function + tests)

| key | label | sequence | Rule |
|---|---|---|---|
| `partly_dispatched` | Partly dispatched | 130 | at least one active taka is `dispatched` and not all are |
| `dispatched` | Dispatched | 140 | every active taka is `dispatched` |

These two take precedence once any taka is dispatched. The dashboard keeps showing the stage detail. Visible to Jemish, Gaurang and Dhruvil.

**Pipeline:**
- add **Dispatched** as the last sub-stage of the Ready main stage (connected)
- the dashboard bar and inventory treat dispatched pcs as done
- Inventory "In godown" never includes dispatched takas

### 3.3 Dispatch challan print (`/print/dispatch-challan/:id`)
For the **client**. Use the existing challan print engine and the same style as the GSM/MIL challans, A4 landscape:
- the **company header** (`COMPANY`: name, GSTIN, mobiles, address) and `!! DELIVERY CHALLAN !!`
- the **party box:** `M/s <CLIENT>`, address, mobile, GSTIN, and **Broker:** name (if any)
- **right box:** `Ch. No DC-12` (or `DC-12 R1`, §4), Date, Eway No, Transport, LR No
- `Quality Name :` (material) and `Design :` code
- **Lump orders:** the taka grid, 4 groups × 12 rows, columns **NO | Taka No | MTRS | PCS**, with group subtotals, then `Total Taka · Total Mtrs · Total Pcs`. Multi-page like the others.
- **Pcs to pcs orders:** **no taka numbers.** A simple table, **Sr | Quality | Design | Pcs**, with one line per design/quality on the challan and the **Total Pcs**.
- No rate or amount.
- Footer: `For, RIVOORA ETHNIC FASHION`, `Receiver's Signature`, `Subject to SURAT Jurisdiction Only. E& O.E.`, `Authorised Signatory`.
- Revised challans (§4) show a small **"Revision 1 · replaces DC-12"** line under the challan number.

### 3.4 **Dispatched** module (`/dispatched`)
- **Search at the top** across: order no, **client (party) name**, broker, challan no (DC-12), taka no, design code, quality. Debounced, server-side.
- **Order cards:**
  - design image (medium)
  - **Order #26** (focal) and the client name
  - dispatched pcs / ordered pcs, with a slim bar
  - latest challan no + date
  - the status badge (Partly dispatched / Dispatched)

  Newest dispatch first; paginated.
- **Order dispatch screen** (`/dispatched/:orderId`): a header (order, client, design, quality, type), then the list of this order's dispatch challans. Each shows:
  - **DC-12** (or **DC-12 R1**)
  - date, takas / pcs, meters
  - its state: **Active** / **Revised**
  - a **Print** icon
  - a **GR** button (active revision only)

---

## 4. GR: goods return

Pressing **GR** on an active dispatch challan opens a full-screen GR form.

**Lump order:**
- The list of takas on the challan (taka no, meters, pcs), each with a **Returned** tick.
- For a returned taka, a **Damaged** button opens our damage popup: damage name / Other, **damaged pcs**, optional photos.
  - Recorded with a **new `found_at` = `customer_return`**, label **"Customer return"**. Add it to `DAMAGE_TYPE_CONFIG`, the dashboard damage strip, the Damages tab and the Inventory filters.

**Pcs to pcs order:**
- Inputs: **Returned pcs** (1 to the challan's pcs) and **Damaged pcs** (0 to returned).
- If damaged > 0: the damage name (master / Other) and optional photos.

**Common:** GR date, optional note → **confirm summary** → save.

**On save (one transaction):**
1. **Revise the challan.** Create the next revision of the **same challan number**: `DC-12 R1` (then `R2`…). It contains **everything except the returned items**: lump without the returned takas; pcs to pcs with the pcs reduced.
   - The previous revision is marked **Revised** (kept for history, still printable, watermarked "REVISED").
   - Store `revision` and `parent_challan_id` on the challan, and a GR record (`goods_returns`: challan, revision created, date, note, role, returned/damaged totals).
2. **Returned goods go back to inventory:**
   - **Lump:** returned takas → stage **`final`** (in the godown, with Dhruvil), marked `returned_at` / `returned_from_challan_id`, with a `goods_returned` event. Damaged ones get the `customer_return` damage.
   - **Pcs to pcs:** there are no taka numbers, so the system creates **one "return lot" taka**:
     - an automatic number from the taka counter
     - `is_return_lot = true`
     - same order; linked to the jobsheet of the first taka on that challan
     - `pcs` = returned pcs; meters empty
     - stage `final`, `goods_returned` event
     - if damaged pcs > 0: a `customer_return` damage on it with those pcs

     It appears with a small **"Return lot"** tag everywhere.
3. Recompute the order status (back to Partly dispatched if anything returned), and invalidate inventory/dispatch/godown queries.

Returned stock is **live inventory**:
- it appears in Dhruvil's Final takas list, where he can make it ready and dispatch it again
- it appears in **Inventory** under its design (fresh pcs in "In godown"; damaged pcs in **Damaged**)
- fresh returned takas can be moved to another order (§5)

---

## 5. Using fresh stock in another order: **Move to order**

- On Dhruvil's Final takas list (and the same screen for Jemish/Gaurang; permission `canMoveTakas`), a **Move to order** action in selection mode, for **fresh** takas in `final`: no open damage, not checked for dispatch.
- **Picker:** only orders of the **same inventory item** (same design/variation; pcs unit) that are **not fully dispatched**. Each shows Order #, client and ordered vs ready pcs.
- **Confirm:** takas count, pcs, from Order #A → Order #B.

**On save (one transaction):**
- `takas.order_id` = the target
- keep `origin_order_id` (the first order)
- `moved_order` events on both sides
- recompute both orders' statuses

The taka keeps its jobsheet link and history. It shows "from Order #A" on the target order.

Inventory, the dashboards and the godown counts follow `order_id` automatically. Add a test that the totals move correctly.

---

## 6. Inventory: **Mark as fresh**

On **Inventory → Damaged → item details**, each taka row gets a **Mark as fresh** action (Jemish/Gaurang, new permission `canMarkFresh`):
- confirm dialog listing its open damages
- **resolves all open damages** of that taka (`resolved_stage = 'inventory'`, `damage_resolved` events)
- recompute `is_damaged`; the row leaves the list; KPIs update

Add `inventory` to `RESOLVED_STAGE_LABEL` ("Marked fresh in inventory").

---

## 7. Login and users

Today the role is just a header the browser chooses. Replace it with **real logins**, while keeping the role switcher for Jemish and Gaurang.

### 7.1 Data (migration, additive)
- **`users`:** `id`, `name`, `phone` (10 digits, unique among active), `role` (role key), `password_hash`, `is_active`, `created_at`, `updated_at`.
- **`sessions`:** `id` (random 32-byte token, stored hashed), `user_id`, `created_at`, `expires_at` (30 days), `last_seen_at`.
- Hash passwords with Node's built-in **`crypto.scrypt`** (with a salt), so there are no native dependencies; it works on Vercel. Never store or log plain passwords.

**Default users**, created by an idempotent step in `npm run db:migrate` (or a `db:seed-users` script it calls), inserted only if that phone doesn't exist:

| Name | Phone | Role |
|---|---|---|
| Jemish | 9999999999 | jemish |
| Gaurang | 8888888888 | gaurang |
| Supervisor | 7777777777 | supervisor |
| Taka entry | 6666666666 | taka_entry |
| QC | 5555555555 | qc |
| Godown supervisor | 4444444444 | godown_supervisor |
| Dhruvil | 3333333333 | dhruvil |

**Default password rule:** `Rivoora@` + the **first 3 digits** of the phone number (e.g. 9999999999 → `Rivoora@999`). Put it in one shared helper, `defaultPassword(phone)`.

### 7.2 Server
- `POST /api/auth/login {phone, password}`:
  - checks an active user
  - creates a session
  - sets an **httpOnly, Secure (in production), SameSite=Lax cookie**
  - returns `{user: {id, name, role}}`

  Wrong phone or password → one generic message "Wrong number or password". Add simple rate limiting: slow down after 5 failed attempts per phone/IP.
- `GET /api/auth/me`, `POST /api/auth/logout` (deletes the session).
- **Every other `/api` route requires a valid session** (except `/api/health` and `/api/auth/login`). `req.role` comes from the **logged-in user**, no longer from the client.
- **Role switching:** users whose role has the new permission **`canSwitchRoles`** (Jemish, Gaurang) may send `X-Act-As: <roleKey>`. The server then acts with that role's permissions and **logs the real user** in events (role + `user_id`). For everyone else, `X-Act-As` is ignored (or 403).
- Keep writing `role` in all existing event/history tables as now. Add `user_id` (nullable) to new events going forward, so history shows **who** did it.
- Changing a user's password or deactivating them deletes their sessions.
- Uploads, print routes and the QR link `/j/:no` all work with the cookie. When logged out, they redirect to login and **back** after login (keep the return URL).

### 7.3 Login screen (`/login`)
A clean, centred card on the calm background, with the logo and "Rivoora Textile":
- **Mobile number:** 10 digits, `inputMode="tel"`, digits only.
- **Password:** always shown as **dots**. **No "show password" eye** and **no "forgot password"**.
- **Autofill:** a small **Autofill** text button beside the password field. It's enabled once a 10-digit number is entered, and fills the password with `defaultPassword(phone)`.
  - If that user has changed their password, login just fails with the normal message.
  - Controlled by one setting, `VITE_LOGIN_AUTOFILL` (default **on**), so it can be turned off before real use. Note this in the README.
- **Log in** button (loading state). On success, go to the return URL or the role's landing.
- Logged-in users visiting `/login` go to their landing.

### 7.4 Profile menu
- Shows the **user's name** + role.
- **Jemish/Gaurang:** the existing **Switch role** dropdown stays. Switching sets `X-Act-As`, clears the cache and goes to that role's landing. While acting as another role, show a subtle bar: "Viewing as Supervisor · Back to Jemish".
- **Everyone:** **Log out**.

### 7.5 **Users** master (Jemish, Gaurang: `canManageUsers`)
- A new master next to the others: `MasterList`.
  - Table on md+: Name, Phone, Role, Status (Active/Inactive), Last login.
  - Cards on phones.
- **Add / edit** form (full screen):
  - Name*
  - Phone* (10 digits, unique)
  - Role* (standard `Select` from the existing roles)
  - Active switch
  - **Password**: set on add (defaults to `defaultPassword(phone)`, shown as dots with an "Use default" link); on edit, a **Reset password** action (new password or default)
- **Roles are fixed in code** (their permissions don't change here). This screen only manages users.
- **Safety:** a user can't deactivate themselves or change their own role, and the last active user with `canManageUsers` can't be deactivated or changed.

---

## 8. API summary (new)

| Method | Path | Notes | Permission |
|---|---|---|---|
| POST | `/orders/:id/takas/send-back` | `{ takaIds[], target: 'butta' \| 'mill', note? }` | `canReworkTakas` |
| POST | `/godown/orders/:id/dispatch` | `{ challanDate, transport?, lrNo?, ewayNo? }` (all `ready_dispatch` takas) | `canDispatch` |
| GET | `/dispatch/challans/:id`, `/dispatch/challans/:id/print` | challan (any revision) | `canDispatch` |
| GET | `/dispatched?search=&page=` · `/dispatched/:orderId` | the Dispatched module | `canDispatch` |
| POST | `/dispatch/challans/:id/goods-return` | lump `{ returns: [{ takaId, damages? }] }` · pcs-to-pcs `{ returnedPcs, damagedPcs, damage? }`, plus `date`, `note` | `canGoodsReturn` |
| POST | `/godown/takas/move` | `{ takaIds[], targetOrderId }` · `GET /godown/orders/:id/move-targets` | `canMoveTakas` |
| POST | `/inventory/takas/:id/mark-fresh` | resolves all open damages | `canMarkFresh` |
| POST | `/auth/login` · `GET /auth/me` · `POST /auth/logout` | sessions | public / any |
| CRUD | `/users` (+ `POST /users/:id/reset-password`) | the Users master | `canManageUsers` |

- Dispatch challans can use the generic `challans` tables with a new `kind = 'dispatch'` (customer instead of a party; add `revision` and `parent_challan_id`) if that fits cleanly; otherwise use their own tables. **Explain the choice in the plan.**
- Every multi-row write is one transaction with conditional stage updates, ending with the status recompute.
- Validate with zod in `shared/src/schemas.ts`.
- Invalidate `orders`, `order-dashboard`, `takas`, `godown`, `challans`, `inventory`, `dispatched` after each write.

---

## 9. Quality checklist

- **Shared tests:**
  - `stageAfterButtaQc`
  - send-back selection rules
  - dispatch status rules (partly / fully)
  - GR maths: lump revision contents, pcs-to-pcs reduction, return lot pcs
  - move-to-order totals
  - mark fresh
  - `defaultPassword`
  - the `X-Act-As` permission rule
- **Auth:**
  - every API route rejects requests without a session (write a quick script that calls each router without a cookie)
  - a non-switching role can't use `X-Act-As`
  - logout clears the cookie
  - deactivating a user logs them out
- **Existing flows still work** for every role after login is added: taka entry, QC, supervisor, butta / mill, godown, inventory, orders.
- **Prints:** the DC challan for a lump and a pcs-to-pcs order, a revised `R1`, multi-page.
- **Design pass with screenshots** for: the login screen, the Users master, send-back selection on the Takas tab, Dhruvil's Orders + Dispatch modal, Dispatched list + order screen, the GR form (both types), Move to order, Mark as fresh.

## 10. Build phases

1. **Migrations + shared:**
   - stages `rework_butta`, `dispatched`
   - statuses
   - `found_at = customer_return`
   - takas columns: `rework_count`, `returned_at`, `returned_from_challan_id`, `is_return_lot`, `origin_order_id`
   - dispatch challans + revisions + `goods_returns`
   - users + sessions + default users
   - permissions + Dhruvil role
   - tests
2. **Login & users:** auth endpoints, session middleware, `X-Act-As`, login screen, profile menu, Users master. Verify **every existing role still works**.
3. **Rework:** send back from the Takas tab, Butta Send pending + Re-butta tag, Mill Refinish Re-mill tag, `stageAfterButtaQc`.
4. **Dhruvil:** move the Orders module and nav from the godown supervisor.
5. **Dispatch:** button + modal, DC challan + print, statuses.
6. **Dispatched module + GR** (both order types, revisions, return lots, damages).
7. **Move to order + Mark as fresh.**
8. **Polish:** the design pass at all breakpoints, a full regression run of every role, and update `CLAUDE.md` + `PROJECT_STATE.md` + README (logins, autofill setting).
