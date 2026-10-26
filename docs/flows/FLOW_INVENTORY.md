# Rivoora Textile — Flow Inventory

What the system does today, module by module, written from the **code** (server routes + services, shared rules, client
screens) as of commit `b4fd6be` (2026-10-26). Where the project notes (`CLAUDE.md`, `PROJECT_STATE.md`, sprint prompts)
say something different, this file follows the code and the difference is listed in `GAPS_AND_QUESTIONS.md` §B.

How to read it
- Each operation has an **ID** (e.g. `ORD-02`). `COVERAGE_CHECK.md` maps every server route and every screen to these IDs,
  and `ROLE_MATRIX.md` uses the same IDs.
- **Roles**: **Jenish** (owner, role key `jemish`), **Gaurang** (partner), **Supervisor** (production / loom floor),
  **Taka entry**, **QC** (one person does Butta QC and Mill QC), **Godown supervisor**, **Dhruvil** (godown orders +
  dispatch). Jenish and Gaurang can also *act as* any other role (Switch role), so "Jenish" below means "in his own role".
- **Taka** = one roll of woven cloth with its own number. **Jobsheet** = the printed loom instruction for an order.
  **Challan** = the paper that goes with goods to a party (butta cutting `GSM-n`, mill `MIL-n`, client delivery `DC-n`).
- "Held" = the order is **on hold** (Sprint 15). "Closed" = the order was **closed** (Sprint 16). Both block writes; see
  module 12 and `ALR` (warnings).
- Evidence column: `METHOD /api/path` + main server file (`services/…`) and screen (`client/…/features/…`). File paths
  are relative to `server/src/` and `client/src/features/` unless written in full.

Modules (36)

| # | Module | # | Module |
|---|---|---|---|
| 1 | Login, session, role switching (`AUTH`) | 19 | Outside production: POs + weaver receipts (`OUT`) |
| 2 | Users master (`USR`) | 20 | Direct FG purchase (`FG`) |
| 3 | Customers + brokers (`CUS`) | 21 | Butta cutting module (`BUT`) |
| 4 | Materials / qualities (`MAT`) | 22 | QC — Butta QC and Mill QC (`QC`) |
| 5 | Design library (`DES`) | 23 | Mill module (`MIL`) |
| 6 | Machines / looms (`MAC`) | 24 | Rework: send back (`RW`) |
| 7 | Damage master (`DMG`) | 25 | Godown orders — Dhruvil (`GD`) |
| 8 | Butta parties + Mill parties (`PTY`) | 26 | Dispatch, Dispatched, Goods return (`DSP`) |
| 9 | Weavers (`WEV`) | 27 | Free stock (`FS`) |
| 10 | Yarn masters: yarn parties, yarn qualities, TFO machines (`YM`) | 28 | Inventory (`INV`) |
| 11 | Orders: list, add, edit, steps, send / undo (`ORD`) | 29 | Yarn PO (`YPO`) |
| 12 | Hold order, Close order (`HLD`) | 30 | Yarn inventory: zones, TFO, warping, beams (`YRN`) |
| 13 | Order details page and its tabs (`ODT`) | 31 | Taka details, damage details, photo sharing (`TKD`) |
| 14 | Jobsheets — office side (`JS`) | 32 | Prints and documents (`PRN`) |
| 15 | Supervisor module + supervisor Orders (`SUP`) | 33 | Notifications, alerts and warnings (`ALR`) |
| 16 | Machine view (`MV`) | 34 | Image uploads (`UPL`) |
| 17 | Taka entry (`TE`) | 35 | Dropdown lookups (`LKP`) |
| 18 | Edit takas — owners (`ET`) | 36 | Hold / close guard (cross-cutting, `GRD`) |

---

## 1. Login, session, role switching (`AUTH`)

**Purpose.** Everyone logs in with a 10-digit mobile number + password; the server keeps a 30-day session. Jenish and
Gaurang can look at the system as any other role. **Who:** all roles.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| AUTH-01 | Log in | All | Login screen (shown on whatever URL was opened, so a QR / deep link continues after login) | Active user; 5 wrong passwords per phone or 30 per IP in 15 min → blocked for a while | Session created (httpOnly cookie, 30 days); default passwords are `Rivoora@` + first 3 digits of the phone | The role's landing screen (or the link that was opened) | `POST /api/auth/login` · `services/auth.ts` · `auth/login-page.tsx` |
| AUTH-02 | Stay logged in / check session | All | App start | Session valid | Returns the user; a 401 anywhere signs the person out | — | `GET /api/auth/me` · `middleware/role.ts`, `lib/auth-store.ts` |
| AUTH-03 | Log out | All | Profile menu → Log out | — | Session deleted | Login screen | `POST /api/auth/logout` |
| AUTH-04 | Switch role ("Viewing as …") | Jenish, Gaurang | Profile menu → Switch role | `canSwitchRoles`; for anyone else the request header is ignored | Every request carries `X-Act-As`; the server uses that role's permissions; history rows keep the acting role **and** the real user | A bar "Viewing as X · Back to Y"; landing of that role | `resolveActingRole` (`shared/src/auth.ts`), `middleware/role.ts`, `lib/role-store.ts` |
| AUTH-05 | Open a screen the role may not use | All | Any URL | — | Redirect to the role's landing; single-module roles (Taka entry, QC, Godown supervisor, Dhruvil) are sent to their landing for unknown URLs | — | `components/layout/require-permission.tsx`, `App.tsx` |
| AUTH-06 | Server health check | (technical) | — | Public | `{ok:true}` | — | `GET /api/health` |

**Alternative paths / exceptions.** Wrong password → "wrong phone or password"; too many tries → wait message. Password
reset / deactivate / role change by an owner signs that user out everywhere (sessions deleted). Login has an "Autofill"
button controlled by a build flag (`VITE_LOGIN_AUTOFILL`, default **on**). No "forgot password" self-service.

**Links.** Every other module needs a session. The acting role decides visibility everywhere (`ROLE_MATRIX.md`).

---

## 2. Users master (`USR`)

**Purpose.** Who can log in and with which role. **Who:** Jenish, Gaurang (`canManageUsers`).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| USR-01 | List / search users | Jenish, Gaurang | Masters → Users | — | Paged list | — | `GET /api/users` · `services/users.ts` · `masters/users/users-page.tsx` |
| USR-02 | Add user | Jenish, Gaurang | Users → Add | Phone unique among active users | User created with a role and a password | Can log in (AUTH-01) | `POST /api/users` |
| USR-03 | Edit user (name, phone, role, active) | Jenish, Gaurang | Users → row | Can't deactivate yourself or change your own role; the last active user who can manage users can't be deactivated / moved | Saved; deactivate or role change ends that user's sessions | — | `PUT /api/users/:id` |
| USR-04 | Reset password | Jenish, Gaurang | Users → row → Reset password | — | New password; sessions ended | — | `POST /api/users/:id/reset-password` |
| USR-05 | Read one user (API only, no screen calls it) | — | — | — | — | — | `GET /api/users/:id` |

**Exceptions.** No delete (deactivate only). Default 7 users are created by `npm run db:migrate` (one per role).
**Links.** Real user id is written into every history table (taka events, jobsheet events, order status history, dispatch).

---

## 3. Customers + brokers (`CUS`)

**Purpose.** The clients orders are made for, each with an optional list of brokers. **Who:** Jenish manages; Gaurang
views (read-only).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| CUS-01 | List / search customers (also by broker name) | Jenish, Gaurang | Masters → Customers | `canViewMasters` | Paged list | — | `GET /api/customers` · `services/customers.ts` · `masters/customers/customers-page.tsx` |
| CUS-02 | Add customer (with brokers) | Jenish | Customers → Add; also from Add order | `canManageMasters` or `canAddOrder` | Customer + brokers saved together | Pickable on Add order | `POST /api/customers` · `customer-form.tsx` |
| CUS-03 | Edit customer / brokers | Jenish | Customers → row | Broker names unique per customer | Renames kept; removed brokers are soft-deleted and stay on old orders | Broker dropdown of the order form | `PUT /api/customers/:id` |
| CUS-04 | Delete customer | Jenish | Customers → row → Delete | **Blocked (409) if any order uses it** | Soft delete | — | `DELETE /api/customers/:id` |
| CUS-05 | Saved designs of a client | Jenish (Add order) | Add order → Saved designs drawer | — | Latest order per design for that client (with that order's notes) | Pick a design for the new order | `GET /api/customers/:id/previous-designs` · `orders/saved-designs-drawer.tsx` |
| CUS-06 | Read one customer (API only) | — | — | — | — | — | `GET /api/customers/:id` |

**Links.** Orders (module 11) need a customer; the order's broker must be one of that customer's brokers. Client
name / broker / phone are shown only to roles with `canSeeClient` (Jenish, Gaurang, Dhruvil).

---

## 4. Materials / qualities (`MAT`)

**Purpose.** The cloth qualities an order is made in (shown as "Quality"). **Who:** Jenish manages; Gaurang views.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| MAT-01 | List / search | Jenish, Gaurang | Masters → Materials | — | Paged list | — | `GET /api/materials` · `services/materials.ts` · `masters/materials/materials-page.tsx` |
| MAT-02 | Add | Jenish (also quick-add from the design form's quality picker) | Materials → Add | Name unique (case-insensitive) | Saved | Order form, design qualities | `POST /api/materials` |
| MAT-03 | Edit | Jenish | Row | Name unique | Saved | — | `PUT /api/materials/:id` |
| MAT-04 | Delete | Jenish | Row | **Blocked if any order uses it** | Soft delete; designs lose this quality (a design left with none shows under "No quality") | Design library | `DELETE /api/materials/:id` |
| MAT-05 | Read one (API only) | — | — | — | — | — | `GET /api/materials/:id` |

---

## 5. Design library (`DES`)

**Purpose.** Every design (code + image) grouped by quality; a design can belong to several qualities. Variations were
turned into designs in Sprint 18. **Who:** Jenish, Gaurang manage; Dhruvil views.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| DES-01 | Browse qualities (level 1) | Jenish, Gaurang, Dhruvil | Masters → Designs (Dhruvil: nav "Design library") | `canViewDesignLibrary` | One card per quality with designs (+ "No quality"); search shows matching designs above matching qualities | DES-02 | `GET /api/designs/qualities` · `services/designs.ts` · `masters/designs/designs-page.tsx` |
| DES-02 | Designs of one quality / search | same | Quality card | — | Design grid | DES-03 | `GET /api/designs?quality=` |
| DES-03 | View a design | same | Design card | — | Code, image, qualities, "goes for butta cutting", notes | — | `GET /api/designs/:id` · `design-detail-page.tsx` |
| DES-04 | Add a design | Jenish, Gaurang (also while adding an order) | Designs → Add / Add order → upload | Code unique across all designs; ≥ 1 quality; "Goes for butta cutting" Yes/No required | Saved; a design added from the order form gets the order's quality | Order form, inventory items | `POST /api/designs` · `design-form.tsx` |
| DES-05 | Edit a design | Jenish, Gaurang | Design → Edit | Code unique | Saved (old prints keep the old code) | — | `PUT /api/designs/:id` |
| DES-06 | Delete a design | Jenish, Gaurang | Design → Delete | **Blocked if any order uses it** | Soft delete | — | `DELETE /api/designs/:id` |
| DES-07 | Upload many | Jenish, Gaurang | Designs → Upload many (full screen) | Every code valid + unique; every tile has a quality + butta answer; **all or nothing** | Images upload in the background (3 at a time, retry); review grid; "Add all" creates every design in one go | Quality view | `POST /api/designs/bulk`, `GET /api/designs/check-codes` · `upload-many-page.tsx` |
| DES-08 | Live code check | Jenish, Gaurang | Design forms | — | "Code already used" while typing | — | `GET /api/designs/check-code` |

**Flow-relevant field.** "Goes for butta cutting" only **pre-fills** the order's Butta step (module 11); the order's
steps decide the route. **Links.** Orders pick a design (Saved designs drawer groups the library by quality and asks
"Which quality?" when a design has several). Inventory is design-wise (module 28). Old `v-…` inventory links are
mapped to the new design.

---

## 6. Machines / looms (`MAC`)

**Purpose.** The looms jobsheets are assigned to. **Who:** Jenish, Gaurang.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| MAC-01 | List | Jenish, Gaurang | Masters → Machines | — | Paged list | — | `GET /api/machines` · `services/machines.ts` · `masters/machines/machines-page.tsx` |
| MAC-02 | Add | Jenish, Gaurang | Add | Machine number unique | Saved | Jobsheet forms, Start dialog | `POST /api/machines` |
| MAC-03 | Edit / mark inactive | Jenish, Gaurang | Row | — | Inactive machines vanish from dropdowns (they may stay on a jobsheet that already has them) | Machine view shows inactive collapsed | `PUT /api/machines/:id` |
| MAC-04 | Delete | Jenish, Gaurang | Row | **Blocked while on an active jobsheet** ("Mark it inactive instead") | Soft delete | — | `DELETE /api/machines/:id` |
| MAC-05 | Read one (API only) | — | — | — | — | — | `GET /api/machines/:id` |

---

## 7. Damage master (`DMG`)

**Purpose.** Names of damages ("Hole", "Colour spot"…). The *type* (machine / butta / mill / weaver) is chosen when a
damage is marked; the master says *what* it is. **Who:** Jenish, Gaurang.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| DMG-01 | List | Jenish, Gaurang | Masters → Damage master | — | Paged list | — | `GET /api/damages` · `services/damages.ts` · `masters/damages/damages-page.tsx` |
| DMG-02 | Add | Jenish, Gaurang | Add | Name unique (case-insensitive) | Saved | Damage popup everywhere | `POST /api/damages` |
| DMG-03 | Edit | Jenish, Gaurang | Row | — | Saved | — | `PUT /api/damages/:id` |
| DMG-04 | Delete | Jenish, Gaurang | Row | **Blocked while any taka uses it** | Soft delete | — | `DELETE /api/damages/:id` |
| DMG-05 | "Other" damage name typed in the popup | Anyone who marks damage | Damage popup → Other | — | The name is found (case-insensitive) or **added to the master** in the same save | Master list | `resolveDamageNames` (`services/taka-ops.ts`), `services/damages.ts` |
| DMG-06 | Read one (API only) | — | — | — | — | — | `GET /api/damages/:id` |

---

## 8. Butta parties + Mill parties (`PTY`)

**Purpose.** The outside parties takas are sent to on challans. One screen, two lists. **Who:** Jenish, Gaurang.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| PTY-01 | List butta / mill parties | Jenish, Gaurang | Masters → Butta parties / Mill parties | — | Paged list | — | `GET /api/butta-parties`, `GET /api/mill-parties` · `services/parties.ts` · `masters/parties/parties-page.tsx` |
| PTY-02 | Add | Jenish, Gaurang | Add | Name unique | Saved | Send dialog of Butta cutting / Mill | `POST /api/butta-parties`, `POST /api/mill-parties` |
| PTY-03 | Edit | Jenish, Gaurang | Row | — | Saved | — | `PUT …/:id` |
| PTY-04 | Delete | Jenish, Gaurang | Row | **Blocked if used on a challan** | Soft delete | — | `DELETE …/:id` |
| PTY-05 | Read one (API only) | — | — | — | — | — | `GET …/:id` |

---

## 9. Weavers (`WEV`)

**Purpose.** Outside weavers that get outside POs (module 19). The short code is used in their taka numbers. **Who:**
Jenish, Gaurang.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| WEV-01 | List | Jenish, Gaurang | Masters → Weavers | — | Paged list | — | `GET /api/weavers` · `services/weavers.ts` · `masters/weavers/weavers-page.tsx` |
| WEV-02 | Add (short code suggested from the name) | Jenish, Gaurang | Add | Name unique; short code 1–4 capital letters, unique, `FG` reserved | Saved | PO form | `POST /api/weavers`, `GET /api/weavers/suggest-code` |
| WEV-03 | Edit | Jenish, Gaurang | Row | **Short code can't change once any taka carries it** | Saved | — | `PUT /api/weavers/:id` |
| WEV-04 | Delete | Jenish, Gaurang | Row | **Blocked if used on a PO** | Soft delete | — | `DELETE /api/weavers/:id` |
| WEV-05 | Read one (API only) | — | — | — | — | — | `GET /api/weavers/:id` |

---

## 10. Yarn masters (`YM`)

**Purpose.** Masters of the yarn area (module 29–30). **Who:** Jenish, Gaurang.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| YM-01 | Yarn parties: list / add / edit / delete | Jenish, Gaurang | Masters → Yarn parties | Name unique; delete blocked if used on a Yarn PO | Saved / soft delete | Yarn PO form + filter | `GET/POST /api/yarn-parties`, `GET/PUT/DELETE /api/yarn-parties/:id` · `services/yarn-masters.ts` · `masters/yarn/yarn-parties-page.tsx` |
| YM-02 | Yarn qualities (raw and twisted): list / add / edit / delete | Jenish, Gaurang | Masters → Yarn qualities | Name unique; delete blocked if used anywhere (PO, stock, programs, beams) | Saved / soft delete | PO lines, receipts, transfers, TFO, warping, beams | `…/api/yarn-qualities…` · `yarn-qualities-page.tsx` |
| YM-03 | TFO machines: list / add / edit / delete | Jenish, Gaurang | Masters → TFO machines | Machine no unique; **can't make inactive or delete while a program runs on it** | Each machine has section A (top) and B (bottom) | TFO board | `…/api/tfo-machines…` · `tfo-machines-page.tsx` |
| YM-04 | Quick-add a party / quality from the Yarn PO form | Jenish, Gaurang (`canManageYarnPo`) | Yarn PO form ➕ | POST only | Saved | The form | `POST /api/yarn-parties`, `POST /api/yarn-qualities` |

---

## 11. Orders: list, add, edit, steps, send / undo (`ORD`)

**Purpose.** The client order and the route it will take. **Who:** Jenish (everything), Gaurang (edit, from "Jobsheet
pending" on), Supervisor (read-only, production phase), Godown supervisor (read-only, once takas exist).

**Fields that change the flow**
- **Steps** — Production · Butta cutting · Mill (all ticked by default; Butta follows the design's "goes for butta
  cutting" until tapped). Steps give the **order kind**: *In-house* (Production ticked), *Outside production* (no
  Production, Butta and/or Mill), *Direct FG purchase* (nothing ticked). They decide every taka's route (module
  states, `nextTakaStage`).
- **Order type** — *Lump* or *Pcs to pcs* (required): changes Move to inventory / Add from free stock (takas vs pcs),
  FG receipts (rows vs one lot), goods return (tick takas vs enter pcs) and the delivery challan print.
- **Unit** — only `pcs` orders get jobsheets; kg / g / meter orders show "coming soon". Unit is locked once jobsheets exist.
- **Blouse** (with / without / not set) — a tag everywhere, printed on jobsheet + delivery challan, splits inventory.
- **Outside order** + party name (Sprint 18) — only a violet tag + filter; does **not** change the route.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| ORD-01 | Orders list: search + filters | Jenish, Gaurang, Supervisor, Godown supervisor | Orders | Each role sees only its statuses (Jenish: all; Gaurang: from Jobsheet pending; Supervisor: Jobsheet created → Taka entry done, Production orders only; Godown supervisor: orders with ≥ 1 taka, In production → Returned); held / closed orders hidden from everyone except Jenish / Gaurang | Card grid; filters in the URL: status, quality, party (client), order type, **order kind**, outside order yes/no, date range; search: order no, client, broker, outside party, quality, design code, quantity, **weaver taka no**, letter-prefixed system taka no (S1101), `PO-n` | Order details | `GET /api/orders` · `services/orders.ts` (`listOrders`) · `orders/orders-page.tsx`, `order-filters.tsx` |
| ORD-02 | Add order | Jenish | Orders → Add order (full screen) | Client, quality, quantity, unit, order type required; broker must belong to the client | Order number = next number (assigned by the server); status **Pending for production**; history entry | Jenish's list; nobody else sees it yet | `POST /api/orders` · `orders/add-order-page.tsx` |
| ORD-03 | Pick a design (Saved designs drawer / library / upload new) + stock panel | Jenish (Add); Jenish, Gaurang (Edit) | Order form → Design | — | Picks a design; the side panel shows all stock of that design (ready for order / in making / free stock; with / without / not-set blouse line) | — | `orders/saved-designs-drawer.tsx`, `design-stock-panel.tsx`, `GET /api/inventory/items/:key…` |
| ORD-04 | Edit order (incl. steps) | Jenish, Gaurang | Order header → Edit (pencil) | Any status the role can see; **blocked on a held or closed order**; unit locked once jobsheets exist; step untick rules as ORD-05 | Saves client, broker, type, blouse, outside order, quality, design, quantity, unit, rate (only roles that see rate), date, notes, note images (full new set); status unchanged | Everywhere | `PUT /api/orders/:id` · `orders/edit-order-page.tsx` |
| ORD-05 | Change steps after creation | Jenish, Gaurang | Edit order → step pills | **Untick blocked** once: Production — any jobsheet exists; Butta — any taka has been to butta cutting; Mill — any taka has been to the mill. An order with outside POs can't become FG purchase. Closed → blocked | Takas *waiting* for an unticked step move on (waiting for butta → waiting for mill or final; waiting for mill → final); history "Steps changed: Butta removed"; status recomputed | Butta / Mill pending lists, dashboard | `PUT /api/orders/:id` (client) and `PUT /api/orders/:id/steps` (API only) · `services/order-steps.ts`, `shared/src/orderSteps.ts` |
| ORD-06 | Send for production | Jenish | Orders list → selection mode → Send; or the order's Dashboard ("Not sent for production yet") | Order is Pending for production | Status → **Jobsheet pending** (in-house), or straight to **At outside weaver** (outside production) / **Awaiting goods** (FG) | Gaurang now sees it; Jobsheets tab / Outside production tab / Receive goods | `POST /api/orders/send-to-production` · `services/orders.ts` |
| ORD-07 | Undo send for production | Jenish | Order header → Undo | Server: status Jobsheet pending / At outside weaver / Awaiting goods, **no jobsheets, no outside POs** (and for outside / FG: no takas). **The button only shows for Jobsheet pending** | Status → Pending for production | Hidden from Gaurang again | `POST /api/orders/:id/undo-production` · `order-details-page.tsx` |

**Alternative paths / exceptions.** Order number clash on two simultaneous creates → generic 409 (no retry). No delete /
cancel of an order (only Close, module 12). Gaurang can't add orders or send them for production and never sees
"Pending for production" orders. Editing quantity after jobsheets exist only changes the coverage warnings (JS-09).

**Links.** In: customers, materials, designs. Out: jobsheets (in-house), outside POs (module 19), FG receipts
(module 20), every later module through the order's steps.

---

## 12. Hold order, Close order (`HLD`)

**Purpose.** Stop work on an order for a while (Hold) or for good (Close). **Who:** Hold / Release — Jenish only.
Close — Jenish, Gaurang.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| HLD-01 | Put on hold | Jenish | Order header → Hold | Not already on hold. If jobsheets are **on the loom**, enter frames completed for each (0 … assigned) | Ongoing jobsheets → Completed ("completed on hold"); for remaining frames a **new Pending jobsheet** (same looms, same sections, linked to the old one); order flagged on hold (status unchanged); History "Put on hold" | Hidden from Supervisor, Taka entry, QC, Godown supervisor, Dhruvil (404 / "Order #26 is on hold"); every write blocked (GRD) except receiving | `POST /api/orders/:id/hold` · `services/hold-order.ts`, `shared/src/hold.ts` · `orders/hold/hold-order.tsx` |
| HLD-02 | Release hold | Jenish | Banner / header → Release | On hold | Flag cleared, History "Released from hold", status recomputed | Visible again everywhere | `POST /api/orders/:id/release` |
| HLD-03 | Close order — preview | Jenish, Gaurang | Order header → Close order | — | Shows: jobsheets on the loom, Pending/Sent jobsheets to cancel, open POs to close, takas (+ pcs) going to free stock, takas out at butta / mill, dispatched takas | HLD-04 | `GET /api/orders/:id/close-preview` · `services/close-order.ts` · `orders/close/close-order-dialog.tsx` |
| HLD-04 | Close order — confirm (optional note) | Jenish, Gaurang | Close dialog | Not already closed; **a held order must be released first** (blocked by the guard); frames completed for each loom jobsheet | One transaction: loom jobsheets completed ("completed — order closed", **no** remaining jobsheet) · Pending/Sent jobsheets **cancelled** (soft delete + event) · open outside POs → Closed · every taka **with us** (not at butta / mill / dispatched) → **free stock** (reason "Order closed"; ready-for-dispatch ones back to final) · order `closed`, status **Closed** (overrides all) · History "Order closed" | Hidden from every work list except Jenish / Gaurang (badge) and Dispatched; takas at butta / mill become free stock when received / QC'd | `POST /api/orders/:id/close` |

**Exceptions.** No reopen of a closed order. A closed order can still be put on hold (no check) and its Edit button still
shows (save is refused). Takas still to be **entered** for completed jobsheets of a closed order can no longer be entered
(GRD blocks taka entry). Hold dialog does not list open POs (was in the Sprint 16 spec).

---

## 13. Order details page and its tabs (`ODT`)

**Purpose.** One page per order: header + tabs. **Who:** Jenish, Gaurang (all tabs), Supervisor (read-only, no client /
money), Godown supervisor (read-only: Dashboard · Takas · Damages · Docs · History; no Jobsheets / Order details tab).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| ODT-01 | Header | All order roles | Orders → card | Visible status for the role; held orders 404 for others | Design thumb (opens full image), `#N`, status, On hold / Closed / steps tag ("P · B · M", "Outside production", "FG purchase"), blouse, outside-order tag, fields (client / broker / rate only for roles that see them), buttons Undo / Edit / Hold / Release / Close by permission | — | `GET /api/orders/:id` · `orders/dashboard/order-header.tsx` |
| ODT-02 | Dashboard tab | same (Godown supervisor: without Production) | Default tab (Gaurang opens on Jobsheets while Jobsheet pending) | — | Progress card (pcs now / pcs ordered); main stage cards by kind (Production or Outside production or Purchase → Butta cutting → Mill → Ready; unticked steps hidden; Completed tag); sub-stage KPI cards; "Needs attention" alerts (ALR-01/02); special cards: Not sent for production (+ Send), No jobsheets yet (+ Create jobsheets), No outside PO yet, Awaiting goods (+ Receive goods), non-pcs "coming soon"; refresh every 60 s | Sub-stage drawer (ODT-03) | `GET /api/orders/:id/dashboard` · `services/dashboard.ts`, `shared/src/orderDashboard.ts`, `pipeline.ts` · `orders/dashboard/dashboard-tab.tsx` |
| ODT-03 | Sub-stage drawer | same | Tap a sub-stage card | — | Jobsheet rows, takas grouped by jobsheet, or open POs ("At outside weaver" / "Given outside") | Jobsheet details, taka drawer | `GET /api/orders/:id/dashboard/items?sub=` |
| ODT-04 | Jobsheets tab | Jenish, Gaurang, Supervisor (read) | Tab (only if Production ticked) | — | Module 14 section | — | `GET /api/orders/:id/jobsheets` · `jobsheets/order-jobsheets-section.tsx` |
| ODT-05 | Outside production tab | Jenish, Gaurang always; Godown supervisor once the order has a PO (Dhruvil has no order details page — he receives from Receive goods) | Tab | — | PO cards + totals (module 19) | — | `GET /api/orders/:id/outside-pos` · `outside/outside-tab.tsx` |
| ODT-06 | Takas tab | Roles with `canViewTakas` | Tab | — | Summary (takas, damaged, pcs, meters); All / Damaged only; stage filter; groups per jobsheet, per receipt, "from Order #A" for takas allocated from elsewhere; chips (number, meters, pcs, damage, Free stock / In Order #n, Re-butta / Re-mill tags, W 1101); owner actions: Edit takas (ET), Select → Send back to butta / mill (RW), Move to inventory, Add from free stock (FS) | Taka drawer (TKD-01) | `GET /api/orders/:id/takas` · `takas/takas-card.tsx` |
| ODT-07 | Damages tab | `canViewTakas` | Tab | — | Tiles per damage type (Machine / Butta / Mill always; Weaver, Not marked, legacy only when > 0) + total; filter pills (URL); "Show resolved"; damaged taka cards; edits go through Edit takas | Damage details (TKD-02) | `GET /api/orders/:id/damages` · `orders/dashboard/damages-tab.tsx` |
| ODT-08 | Order details tab | Jenish, Gaurang, Supervisor | Tab | — | Notes, note images, dates, design, client fields by permission | — | `order-details-page.tsx` (`OrderInfoTab`) |
| ODT-09 | History tab: Overview / Detailed | All order roles | Tab (`?hview=detailed`) | — | Overview = main steps that apply to the order (Order created → In production / PO placed → Received from weaver / Goods received → Sent / Received butta → Sent / Received mill → Dispatched) with "took 4 days 6 h" spans and lot counts; Detailed = every status change ("Moved back to …"), hold events, steps changed, order closed | — | `GET /api/orders/:id/milestones`, `GET /api/orders/:id` · `services/order-milestones.ts`, `shared/src/orderMilestones.ts` · `orders/history-tab.tsx` |
| ODT-10 | Docs tab | `canViewTakas` (Jenish, Gaurang, Supervisor, Godown supervisor) | Tab | — | Sections Challans / POs / Receipts: every butta + mill challan with this order's takas (cancelled included, print), delivery challans with every revision (only roles that dispatch), outside POs (print), weaver / FG receipts | Prints (PRN) | `GET /api/orders/:id/challans` · `services/challans.ts` (`listOrderChallans`), `shared/src/orderDocs.ts` · `orders/dashboard/docs-tab.tsx` |

---

## 14. Jobsheets — office side (`JS`)

**Purpose.** Turn a pcs order into printed loom instructions. **Who:** Jenish, Gaurang (`canManageJobsheets`).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| JS-01 | Create jobsheets (plan) | Jenish, Gaurang | Order → Jobsheets tab → Create jobsheets (also from Dashboard) | Order is Jobsheet pending or later; **Production ticked**; unit pcs; looms exist and are active; not held / closed | Pcs → frames (pcs ÷ sections per beam, default 3, 1–12) split into jobsheets of N frames; each gets a new global number (never reused) and the chosen looms; status **Pending**; order status → Jobsheet created | Jobsheets tab; printable | `POST /api/orders/:id/jobsheets/generate` · `services/jobsheets.ts`, `shared/src/jobsheets.ts` · `jobsheets/jobsheet-forms.tsx` |
| JS-02 | Add a single jobsheet | Jenish, Gaurang | Jobsheets tab → Add | Same as JS-01 | One Pending jobsheet (frames, looms, sections; pcs = frames × sections, read-only) | — | `POST /api/orders/:id/jobsheets` |
| JS-03 | Edit a jobsheet (+ auto-adjust) | Jenish, Gaurang | Jobsheet details → Edit | **Only Pending** ("Pull it back from the supervisor first" if Sent; "already in production" if started) | Frames / looms / sections saved; the **last Pending jobsheet absorbs** the difference (may grow, shrink, be removed, or new ones are created with its looms + sections); result lists updated / created / removed + new coverage warnings | — | `PUT /api/jobsheets/:id` · `planFramesEdit` · `jobsheets/edit-jobsheet-form.tsx` |
| JS-04 | Delete a jobsheet | Jenish, Gaurang | Jobsheet details → Delete | **Only Pending** | Soft delete (number never reused, no event row); last one deleted → order back to Jobsheet pending | — | `DELETE /api/jobsheets/:id` |
| JS-05 | Send to supervisor | Jenish, Gaurang | Jobsheets tab → ⬆ (selection mode, **all Pending pre-selected**) | Pending only (others skipped; 409 if none) | Pending → **Sent**; event | Supervisor's Pending list | `POST /api/orders/:id/jobsheets/send` · `order-jobsheets-section.tsx` |
| JS-06 | Pull back | Jenish, Gaurang | Jobsheet details → Pull back | Only Sent (not started) | Sent → Pending; event | Leaves supervisor list | `POST /api/jobsheets/:id/pull-back` |
| JS-07 | Print jobsheets (one page each, QR) | Jenish, Gaurang, Supervisor | Jobsheets tab → Print all; jobsheet details; supervisor card; Start & print | `canPrintJobsheets`; supervisor can't print Pending | A4, one page per jobsheet: ORDER 26 (319), QR `…/j/319` ("Scan · 26 (319)"), design, quality, order type, blouse, pcs + "Sections: N", blank PICKS and Loom-no boxes, "Assigned: 7, 9" | Taka entry scans the QR (TE-01) | `GET /api/jobsheets/print?ids=` · `jobsheets/print-page.tsx` |
| JS-08 | Jobsheet details + activity | Jenish, Gaurang (full); Supervisor (order number only) | Card click | Supervisor never sees Pending | Status, times, running loom, parent / continued jobsheets, takas, timeline (created, sent, pulled back, started, completed, machine changed, takas entered / edited, cancelled) | — | `GET /api/jobsheets/:id` · `jobsheets/jobsheet-details-page.tsx`, `activity.tsx` |
| JS-09 | Live coverage + "given outside" line | Jenish, Gaurang | Jobsheets tab | — | Frames needed (at the latest run's sections) vs frames in jobsheets; pcs covered vs ordered; pcs on outside pcs-POs are subtracted ("120 pcs given outside (PO-3)") | Dashboard alerts | `orderJobsheetPlan`, `coverageWarnings`, `outsidePoCommittedPcs` (shared) · `services/jobsheet-live.ts` |

**Exceptions.** A non-pcs order shows "Jobsheets for kg / g / meter orders — coming soon". Orders without Production get
409 "This order has no Production step". Machines inactive → 409 at create. Concurrency: anything changed meanwhile →
"Refresh and try again".

---

## 15. Supervisor module + supervisor Orders (`SUP`)

**Purpose.** Tablet screens for the loom floor. **Who:** Supervisor (`canViewJobsheetsModule`, `canRunJobsheets`).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| SUP-01 | Jobsheets — All view | Supervisor | Jobsheets → All | Sees Sent ("Pending"), Ongoing ("On-loom"), Completed; never Pending; held / closed orders hidden | Tabs All / Pending / On-loom / Completed with counts; search (order no, jobsheet no, design code); filters (loom, quality, type, blouse, sent date); card: design thumb, quality, all assigned looms, print button | SUP-03..05 | `GET /api/jobsheets?tab=` · `services/jobsheets.ts` (`listSupervisorJobsheets`) · `jobsheets/supervisor-jobsheets-page.tsx`, `filters/work-filters.tsx` |
| SUP-02 | Order view | Supervisor | Jobsheets → Order (default) | — | One card per order (number, design, quality, looms, counts): orders with Pending / On-loom work first | Order's jobsheets list | `GET /api/jobsheets/orders`, `GET /api/jobsheets?orderId=` · `supervisor-order-jobsheets-page.tsx` |
| SUP-03 | Start (& print) | Supervisor | Card → Start | Sent only; loom must be one of its assigned active looms; order not held | Sent → **Ongoing** on that loom; then the print preview opens | Machine view shows it running; Dashboard "On loom" | `POST /api/jobsheets/:id/start` · `jobsheets/run-dialogs.tsx` |
| SUP-04 | Complete | Supervisor | Card → Complete | Ongoing only | Frames completed entered (note if different from assigned; **more than assigned is accepted**); → **Completed** | Taka entry "Taka pending" list; Dashboard "Taka entry pending" | `POST /api/jobsheets/:id/complete` |
| SUP-05 | Change machine | Supervisor | Card → Change machine | Ongoing only; frames completed ≤ assigned | Current → Completed with frames done; a **new Sent jobsheet** (new number, frames = "to make next", pre-filled with the remaining; all active looms; same sections; "Continued from …") | New card in Pending | `POST /api/jobsheets/:id/change-machine` |
| SUP-06 | Supervisor Orders (read-only) | Supervisor | Orders | Orders Jobsheet created → Taka entry done, Production ticked; no client / broker / rate | Same Orders screens as the owner (list, Dashboard, Jobsheets, Takas, Damages, Order details, History, Docs) without any write button | — | `GET /api/orders…` (`canViewProductionOrders`) · `orders/*` |

**Exceptions.** A 409 (e.g. the jobsheet was completed at taka entry meanwhile) refreshes everything. Busy-loom hints
come from the Machine view data.

---

## 16. Machine view (`MV`)

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| MV-01 | Loom floor board | Jenish, Gaurang, Supervisor | Machine view | — | Every loom (active + inactive): running jobsheets (green), idle "since …", filters All / Running / Idle; refresh every 30 s | Jobsheet details | `GET /api/machine-view` · `services/machine-view.ts` · `machine-view/machine-view-page.tsx` |

Read-only: no actions, no history / efficiency.

---

## 17. Taka entry (`TE`)

**Purpose.** Phone screens (English + Hindi) where woven takas are recorded per jobsheet. **Who:** Taka entry role.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| TE-01 | Scan jobsheet (camera QR) or type its number | Taka entry | Scan jobsheet (landing) | Camera only on HTTPS / localhost (else manual entry with an explanation); any host's `/j/<n>` QR accepted | Number → jobsheet | TE-04 | `GET /api/jobsheets/by-no/:no` · `takas/scan-page.tsx` |
| TE-02 | Open a QR link | Anyone logged in | Phone camera opens `…/j/319` | Not visible for the role → not found; held order → hold message | Redirect to `/jobsheets/:id` (for Taka entry: the entry screen) | TE-04 | `takas/jobsheet-qr-page.tsx` |
| TE-03 | Taka jobsheets list | Taka entry | Jobsheets | Every status (Pending included); held / closed hidden | Tabs **Taka pending** (no takas yet: Completed newest first → Ongoing → Sent → Pending) / **Done** (latest entry first); search | TE-04 | `GET /api/taka/jobsheets` · `takas/taka-jobsheets-page.tsx` |
| TE-04 | Enter takas | Taka entry | Jobsheet entry screen | Order not held / closed; ≤ 500 takas per jobsheet; pcs required (1–9999); meters optional; damage needs type + name + pcs ≤ taka pcs | Rows with **system numbers** (counter from 11, never reused, skips used numbers) in the order rows are saved; damages (type Machine / Butta / Mill as offered); note appended; if the jobsheet isn't Completed → **Completed** with frames = assigned ("completed at taka entry"); each taka starts at the stage the order's steps give (waiting for butta / waiting for mill / final) | Butta / Mill pending, Dhruvil (final), dashboard | `POST /api/jobsheets/:id/takas` · `services/takas.ts` (`enterTakas`), `taka-ops.ts` · `takas/taka-entry-page.tsx` |
| TE-05 | Preview next numbers | Taka entry | Entry screen | — | Shows the numbers the rows will probably get (confirmed on save) | — | `GET /api/takas/next-numbers` |

**Warnings / exceptions.** Amber "Pcs entered: X. Expected Y (frames × sections)" when the pcs differ (not a blocker).
Success screen: Scan next / Back to list / Add more. Taka entry **can't edit or remove** what was saved (only owners,
module 18). A **Pending** (never sent) jobsheet can be entered and becomes Completed without any loom recorded. Voice
note button is a "coming soon" placeholder.

---

## 18. Edit takas — owners (`ET`)

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| ET-01 | Edit takas of a jobsheet (full-screen form) | Jenish, Gaurang | Order Takas tab / jobsheet details → Edit takas | Not held / closed. Numbers valid + unique system-wide (live check). **Add** rows only on Completed jobsheets (manual numbers). **Remove** only takas waiting for butta / waiting for mill (not at / after butta cutting or mill). Free-stock or allocated-away takas are not in the set. Pcs required on new / changed rows | Replace-set: changed rows saved (number, meters, pcs, open damages: change / remove / add), removed rows soft-deleted, note replaced; `takas_edited` event | — | `PUT /api/jobsheets/:id/takas` · `services/takas.ts` (`editTakas`) · `takas/edit-takas-dialog.tsx` |
| ET-02 | Edit takas of one receipt (outside / FG) | Jenish, Gaurang | Takas tab → receipt group → Edit | As ET-01, plus: weaver numbers required where they existed, digits only, unique per weaver; **no new rows** on a receipt | Saved; receipt totals and the PO's received qty / status recomputed | Outside tab totals | `PUT /api/jobsheets/:id/takas` with `receiptId` · `takas/edit-receipt-takas-dialog.tsx`, `services/outside.ts` (`refreshReceiptTotals`) |
| ET-03 | Live taka number check | Jenish, Gaurang, receive roles | Number fields | — | "Already used in #26 (319)" | — | `GET /api/takas/check` · `features/takas/taka-check` |

---

## 19. Outside production: POs + weaver receipts (`OUT`)

**Purpose.** Give an order (or part of it) to an outside weaver and receive their takas. **Who:** POs — Jenish, Gaurang;
receiving — Jenish, Gaurang, Godown supervisor, Dhruvil.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| OUT-01 | Create outside PO | Jenish, Gaurang | Order → Outside production tab → Create a PO (also "give part outside" on in-house orders) | Sent for production; not closed / held; **not an FG purchase** (409; the tab still offers the button) | PO-n from its own counter (never reused); weaver, quality (default the order's), qty + unit (pcs / meters), order type, rate, date, notes; status **Open** | Receive goods list; Dashboard "At outside weaver" / "Given outside"; pcs POs reduce frames needed (JS-09) | `POST /api/orders/:id/outside-pos` · `services/outside.ts` · `outside/po-form-dialog.tsx` |
| OUT-02 | Edit PO | Jenish, Gaurang | PO card ⋯ → Edit | Only Open with nothing received | Saved | — | `PUT /api/outside-pos/:id` |
| OUT-03 | Cancel PO | Jenish, Gaurang | PO card ⋯ → Cancel | Only Open with nothing received | Status **Cancelled** (number kept) | — | `POST /api/outside-pos/:id/cancel` |
| OUT-04 | Close PO ("nothing more expected") | Jenish, Gaurang | PO card ⋯ → Close | Open or Partly received | Status **Closed** (also automatic on Close order) | No more receipts | `POST /api/outside-pos/:id/close` |
| OUT-05 | Print PO | Jenish, Gaurang, Godown supervisor, Dhruvil | PO card → Print; Docs tab | — | A4 "!! PURCHASE ORDER !!" for the weaver | — | `GET /api/outside-pos/:id/print` · `outside/po-print-page.tsx` |
| OUT-06 | Receive weaver challan against a PO | Jenish, Gaurang, Godown supervisor, Dhruvil | PO card → Receive challan; Receive goods → PO | PO open / partly received; order **not closed** (held is allowed — it's a receive); weaver taka no digits, unique per weaver; system number unique; damage pcs ≤ taka pcs | Header (weaver challan no, date, notes) + rows (weaver taka no, pcs, meters, damage with type **Weaver damage**); optional "Add our taka numbers" column pre-filled from our counter; system number = our number, else **weaver code + weaver no** (S1101); takas go on the order's hidden external jobsheet, stage by the order's steps; PO received qty (pcs or meters) + status recomputed; `received_outside` events; order status recomputed | Butta / Mill pending lists, Dhruvil final takas, Takas tab grouped by receipt | `GET /api/outside-pos/:id/receipt-form`, `POST /api/outside-pos/:id/receipts` · `outside/outside-po-receive-page.tsx`, `receipt-entry-page.tsx` |
| OUT-07 | Receive goods module | Godown supervisor, Dhruvil (Jenish / Gaurang reach it through orders) | Receive goods | Closed orders and (for these roles) held orders left out; no client / rate for the Godown supervisor | Open POs (PO no, weaver, order #, quality, pending qty) + FG orders awaiting goods; search | OUT-06 / FG-01 / FG-02 | `GET /api/receive-goods` · `outside/receive-goods-page.tsx` |
| OUT-08 | Read one PO (API only) | — | — | — | — | — | `GET /api/outside-pos/:id` |

**Exceptions.** No delete of a whole receipt (fix with ET-02). A fully received PO takes no more receipts. Printed
challans show the weaver's exact number (`printTakaNo`): our number if typed, else `1101` (not `S1101`).

---

## 20. Direct FG purchase (`FG`)

**Purpose.** Orders with no step ticked: goods are bought ready. **Who:** Jenish, Gaurang, Godown supervisor, Dhruvil.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| FG-01 | Receive FG challan — lump | same | Order Dashboard "Awaiting goods" → Receive goods; Receive goods module | Order kind FG; sent for production; not closed; lump | Supplier name (typed), supplier challan no, date, notes + rows like OUT-06; number = ours, else `FG` + supplier no; stage **final** | Dhruvil final takas (module 25) | `GET /api/orders/:id/fg-receipt-form`, `POST /api/orders/:id/fg-receipts` · `outside/fg-receive-page.tsx`, `receipt-entry-page.tsx` |
| FG-02 | Receive FG challan — pcs to pcs | same | same | pcs to pcs; damaged pcs need a damage name | One **Received lot** taka (our next number) with the pcs (+ damaged pcs damage); stage **final** | Dhruvil | same · `outside/fg-pcs-receipt-page.tsx` |
| FG-03 | Use stock instead (Add from free stock) | Jenish, Gaurang, Dhruvil | Takas tab / godown order | see FS-02 | Free takas of the same design allocated to the order | Dhruvil | → FS-02 |

FG orders appear in Dhruvil's Orders once they have a taka; before that only under Receive goods ("Awaiting goods").
There is no separate "Purchase" tab (the spec offered one); receipts show in Takas (grouped per receipt) and Docs.

---

## 21. Butta cutting module (`BUT`)

**Purpose.** Send takas to butta parties on a challan and get them back. **Who:** Jenish, Gaurang, Godown supervisor
(landing). Cancel challan: Jenish, Gaurang. Never shows the client or rate.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| BUT-01 | Send → Pending (orders with ready takas) | Jenish, Gaurang, Godown sup. | Butta cutting → Send → Pending | Takas waiting for butta (`entered`) or sent back (`rework_butta`); held orders not offered | Order cards with "18 / 20 ready"; search (order, design, taka / weaver no); work filters (loom, quality, type, blouse) | BUT-02 | `GET /api/butta/pending-orders`, `GET /api/butta/counts` · `services/challans.ts` · `challans/challan-module-page.tsx`, `send-pending.tsx` |
| BUT-02 | Order drawer: pick takas | same | Order card | Only ready takas selectable (others greyed with stage); ready ones pre-selected | Selection with totals (takas · pcs · meters); Re-butta tags | BUT-03 | `GET /api/butta/pending-orders/:orderId/takas` |
| BUT-03 | Create butta challan | same | Selection bar → Send | Party exists; every taka still sendable (else 409 listing them, nothing saved); orders not held / closed | **GSM-n** (own counter, never reused); party, date, e-way no; takas → **At butta cutting**; meters / pcs snapshot; re-butta trips close the old challan row | Print; In butta cutting list; status "In butta cutting" | `POST /api/butta/challans` |
| BUT-04 | In butta cutting / Challans list | same | Send → In butta cutting; Receive → Challans | — | Challan cards: number, party, date, sent / received counts, design thumbs (≤ 3 + preview); filters open / received / all, party, date, loom, quality… | BUT-05 | `GET /api/butta/challans` · `challans/challan-cards.tsx`, `design-preview.tsx` |
| BUT-05 | Challan details | same | Card | — | Takas per order, received / QC-done marks, Created by, e-way | BUT-06/08/10 | `GET /api/butta/challans/:id` · `challans/challan-details-page.tsx` |
| BUT-06 | Print butta challan | same | Details / after send / Docs | — | A4 landscape, 48 takas per page (4 × 12), printed taka no (`printTakaNo`) | — | `GET /api/butta/challans/:id/print` · `challans/challan-print-page.tsx` |
| BUT-07 | Receive by taka number | same | Receive → Taka number | Taka on an active butta challan, not yet received; a number matching several takas (weaver numbers) → **"Which taka?" picker** | Taka → **Butta QC pending**; `received_butta`; a taka of a **closed** order becomes free stock here | QC (QC-02) | `POST /api/butta/receive` · `challans/receive-screen.tsx` |
| BUT-08 | Receive by ticking on the challan | same | Challan details → tick → Receive | same | Same as BUT-07 for many takas | QC | `POST /api/butta/receive` (`takaIds`) |
| BUT-09 | Undo receive | same | Receive screen → Undo | Only while the taka is still Butta QC pending | Back to At butta cutting | — | `POST /api/butta/receive/:takaId/undo` |
| BUT-10 | Cancel challan | Jenish, Gaurang | Challan details → Cancel | **Nothing on it received** | Challan Cancelled (number kept); takas back to waiting for butta (re-butta trips back to "sent back") | Pending list again | `POST /api/butta/challans/:id/cancel` |

**Exceptions.** Per-taka receive results: not found / not sent / already received (with date) / changed. No edit of a
challan (party / date / takas) after it is made; no removing one taka from a challan.

---

## 22. QC — Butta QC and Mill QC (`QC`)

**Purpose.** Check takas that came back from butta cutting and from the mill. **Who:** QC role (bilingual).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| QC-01 | Open a taka by number | QC | QC home (only a number box) | Number valid; held order → "Order #n is on hold"; stage decides: waiting / at butta → "not received from butta cutting"; Butta QC pending → QC-02; anything else → QC-03 (which explains "not sent to the mill" / "already checked") | — | QC-02 / QC-03 | `GET /api/takas/by-no/:no` · `qc/qc-home-page.tsx` |
| QC-02 | Butta QC | QC | Butta QC screen | Stage Butta QC pending; **every open damage answered** (resolve all / some pcs / not resolved); new damages need a type + name + pcs ≤ taka pcs; ≤ 10 photos each; meters / pcs read-only | Partial resolve keeps a damage open with resolved pcs; new damages (+ photos) recorded at "Butta QC"; then the **routing rule**: waiting for mill if the order has Mill and the taka (or a parent) was never dyed, else **final**; `butta_qc_done` (Fresh / Damaged); closed order → free stock | Mill pending or Dhruvil | `POST /api/butta-qc/:takaId` · `services/butta-qc.ts`, `qc-shared.ts`, `shared/src/butta.ts` · `butta-qc/qc-taka-page.tsx` |
| QC-03 | Mill QC (Fresh / Done or Send to refinish) | QC | Mill QC screen | Stage Mill QC pending **or still At mill** (then it is marked received on its challan first, with a note); Done needs every open damage answered; refinish needs none | Damages as QC-02 (recorded at "Mill QC"); **Done → final**; **Refinish → Refinish** (+ refinish count, note); closed order → free stock | Dhruvil final takas, or Mill → Refinish | `GET /api/mill-qc/taka/:no`, `POST /api/mill-qc/:takaId` · `services/mill-qc.ts` · `mill-qc/qc-taka-page.tsx` |
| QC-04 | QC pending lists (API only — the screen was removed in Sprint 14) | — | — | — | — | — | `GET /api/butta-qc/pending`, `GET /api/mill-qc/pending` |

**Exceptions.** A weaver number shared by several takas returns "N takas have number … pick the right one" — the QC
screens have **no picker** (only Butta receive has one). No undo of a QC. Damage types offered follow the taka
(Machine for our production / Weaver for outside; Butta if the order has Butta or the taka was there; Mill likewise).

---

## 23. Mill module (`MIL`)

**Purpose.** Send takas to the mill for dyeing and count them back. **Who:** Jenish, Gaurang, Godown supervisor.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| MIL-01 | Send → Pending | Jenish, Gaurang, Godown sup. | Mill → Send → Pending | Takas waiting for mill; held orders not offered | Order cards "18 / ~20 ready" (+ approx takas still to come from jobsheets without taka entry); drawer lists every not-yet-sent taka with its stage | MIL-03 | `GET /api/mill/pending-orders[/:orderId/takas]`, `GET /api/mill/counts` · `challans/send-pending.tsx` |
| MIL-02 | Send → Refinish sub-tab | same | Mill → Send → Refinish | Takas in Refinish (Mill QC / godown / owner "sent back by owner") | Order cards + drawer | MIL-03 | `GET /api/mill/refinish-orders[/:orderId/takas]` |
| MIL-03 | Create mill challan | same | Selection → Send | Sendable; **refinish takas and normal takas can't share a challan** (409) | **MIL-n**; takas → **At mill**; refinish trip flagged; old active row closed | In mill list; print ("FOR REFINISH" when all are refinish) | `POST /api/mill/challans` |
| MIL-04 | In mill / Challans list | same | Send → In mill; Receive → Challans | — | Challan cards with "Sent N takas · Received M" | MIL-05 | `GET /api/mill/challans` |
| MIL-05 | Challan details | same | Card | — | Takas per order; received count control | MIL-06/07/08 | `GET /api/mill/challans/:id` |
| MIL-06 | Print mill challan | same | Details / Docs | — | A4 landscape like butta; "FOR REFINISH" on the quality row | — | `GET /api/mill/challans/:id/print` |
| MIL-07 | Enter received count | same | Receive → challan card / details | Count ≤ takas on the challan and ≥ takas already received at QC; challan not cancelled | Stores how many came back (no taka numbers; QC finds out which) | Mill QC can open those takas | `POST /api/mill/challans/:id/received-count` · `challans/received-count.tsx` |
| MIL-08 | Cancel mill challan | Jenish, Gaurang | Details → Cancel | Nothing received **and no count entered** | Cancelled; takas back to waiting for mill / refinish | — | `POST /api/mill/challans/:id/cancel` |
| MIL-09 | Receive / undo by taka (API only; the Mill screen uses counts) | — | — | — | Same engine as butta (→ Mill QC pending) | — | `POST /api/mill/receive`, `POST /api/mill/receive/:takaId/undo` |

---

## 24. Rework: send back (`RW`)

**Purpose.** Owners send takas back for another round, even if the order doesn't have that step. **Who:** Jenish,
Gaurang (`canReworkTakas`).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| RW-01 | Send back to butta cutting | Jenish, Gaurang | Takas tab → Select → Send back to butta cutting | Takas with us: waiting for butta / mill, butta QC, mill QC, final, ready for dispatch, refinish, already sent back; not at butta / at mill / dispatched (greyed with the reason); not held / closed | Stage **Sent back to butta cutting** (`rework_butta`), re-butta count + 1, godown tick cleared, note; `sent_back` | Butta → Pending (Re-butta tag); after Butta QC → final if it was dyed before | `POST /api/orders/:id/takas/send-back` · `services/rework.ts`, `shared/src/rework.ts` · `takas/send-back-dialog.tsx` |
| RW-02 | Send back to the mill | same | … → Send back to mill | same | Stage **Refinish**, refinish count + 1, "Sent back by owner" | Mill → Send → Refinish | same |

No undo of a send-back.

---

## 25. Godown orders — Dhruvil (`GD`)

**Purpose.** Final takas in the godown: count, tick, split, damage, ready for dispatch. **Who:** Dhruvil (landing),
Jenish, Gaurang. Shows client + rate to Dhruvil.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| GD-01 | Godown orders list | Dhruvil, Jenish, Gaurang | Orders (Dhruvil) | Orders with ≥ 1 taka final / refinish / ready; held / closed hidden for Dhruvil | Cards with unchecked count, ready count; search by order / taka / weaver no | GD-02 | `GET /api/godown/orders` · `services/godown.ts` · `godown/godown-orders-page.tsx` |
| GD-02 | Order screen (Final takas · Damage tabs) | same | Card | — | KPI tiles (ready pcs, refinish pcs/takas, damaged pcs…), checked-pcs bar vs ordered ("more than ordered"), final + ready rows (taka · actual pcs · ⋯ menu) | GD-03…11 | `GET /api/godown/orders/:orderId` · `godown/godown-order-page.tsx` |
| GD-03 | Tick / untick a taka | same | Row tick | Final only | Checked by + when; `godown_checked` / `godown_unchecked` | Ready-for-dispatch selection | `PATCH /api/godown/takas/:id {checked}` |
| GD-04 | Edit pcs (actual pcs) | same | ⋯ → Edit pcs | Final only | Actual pcs saved (same as expected → cleared); `actual_pcs_changed` | All pcs totals from the godown on use actual pcs | `PATCH /api/godown/takas/:id {actualPcs}` |
| GD-05 | Split a taka (+ damage picker) | same | ⋯ → Split (actual pcs ≥ 2) | Final only; parts add up to actual pcs; part 1 keeps the number, others get the next letter (1101A…, skipping used numbers); each earlier damage can be moved to one part only, with pcs ≤ part pcs | Original keeps its row with new pcs; new parts (stage final, or **refinish** if ticked) with meters by pcs; **all open damages of the original are cleared** ("split"); picked damages move to parts with photos; new damages possible; outside takas' weaver no gets the letter | Final list / Mill Refinish | `GET /api/godown/takas/:id/split-damages`, `POST /api/godown/takas/:id/split` · `godown/split-page.tsx`, `split-damage-picker.tsx`, `shared/src/splitDamage.ts` |
| GD-06 | Mark damage | same | ⋯ → Mark damage | Final only; type + name + pcs | New open damage (recorded at "Godown"; photos allowed) | Damage tab | `POST /api/godown/takas/:id/damage` |
| GD-07 | Mark resolved | same | ⋯ → Mark resolved / Damage tab | Final only; must have an open damage | One or all open damages resolved ("the godown") | — | `POST /api/godown/takas/:id/resolve` |
| GD-08 | Send to refinish | same | ⋯ → Send to refinish | Final only | Stage Refinish, count + 1, tick cleared, note | Mill → Refinish | `POST /api/godown/takas/:id/refinish` |
| GD-09 | Ready for dispatch (batch) | same | Select ticked takas → Ready for dispatch | Every chosen taka final **and ticked** (else 409 listing them) | Takas → **Ready for dispatch** | Dispatch (DSP-01); status "Ready for dispatch" when all are | `POST /api/godown/orders/:orderId/ready-dispatch` |
| GD-10 | Damage tab | same | Order screen → Damage | — | Every taka with open damage: state badge (final / ready / refinish), type chips, photos, Details, Mark resolved (final only) | Damage details (TKD-02) | `GET /api/godown/orders/:orderId/damages` · `godown/godown-damages-tab.tsx` |
| GD-11 | Move to inventory / Add from free stock (from this screen) | Dhruvil, Jenish, Gaurang | Order screen buttons | see FS-01 / FS-02 | | | → FS |

**Exceptions.** A Ready-for-dispatch taka can't be changed here and there is no "un-ready" (only Move to inventory or
send back puts it back to final / rework).

---

## 26. Dispatch, Dispatched module, Goods return (`DSP`)

**Purpose.** Hand goods to the client on a delivery challan, and take returns. **Who:** Dhruvil, Jenish, Gaurang.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| DSP-01 | Dispatch | Dhruvil, Jenish, Gaurang | Godown order → Dispatch | ≥ 1 taka Ready for dispatch; not held / closed; amber notice if some ready takas still have damage (not a blocker) | **All** ready takas of the order go on one **DC-n** (date, transport, LR no, e-way no; taka no / meters / pcs snapshot); takas → **Dispatched**; order → Partly dispatched / Dispatched | Print (DSP-02); Dispatched module | `POST /api/godown/orders/:orderId/dispatch` · `services/dispatch.ts` · `dispatch/dispatch-dialog.tsx` |
| DSP-02 | Print delivery challan | same | After dispatch; Dispatched; Docs | — | Lump: taka grid; pcs to pcs: Sr · Quality · Design · Pcs (no taka numbers); blouse next to design; "REVISED" watermark on old revisions | — | `GET /api/dispatch/challans/:id` · `dispatch/print-page.tsx` |
| DSP-03 | Dispatched list | same | Dispatched | Held orders hidden for Dhruvil; closed orders still listed | Orders with challans, newest first; status filter (Partly dispatched / Dispatched / Returned…); search (order, client, broker, quality, design, DC no, taka / weaver no) | DSP-04 | `GET /api/dispatched` · `dispatch/dispatched-page.tsx` |
| DSP-04 | Dispatched order screen | same | Card | — | Every challan + revisions, returned summary | DSP-05/06, print | `GET /api/dispatched/:orderId` · `dispatch/dispatched-order-page.tsx` |
| DSP-05 | Goods return — lump | Dhruvil, Jenish, Gaurang | Challan → GR | Challan is the **active** revision; ticked takas on it and still dispatched; optional damages (type optional → "not marked") | Returned takas → **final as free stock** (reason "Returned"); a new revision **DC-n R1** with everything else; old one **Revised**; GR record; order → Returned when all remaining are dispatched | Inventory free stock (usable via FS-02/03) | `POST /api/dispatch/challans/:id/goods-return` · `dispatch/goods-return-page.tsx` |
| DSP-06 | Goods return — pcs to pcs | same | same | Returned pcs 1…challan pcs; damaged ≤ returned, needs a damage name | One **return lot** taka (free stock, final, our next number) with the pcs + damage; dispatched takas' pcs reduced; new revision with the rest | Inventory free stock | same |
| DSP-07 | Challan detail print data (duplicate API) | — | — | — | — | — | `GET /api/dispatch/challans/:id/print` (API only) |

**Exceptions.** No cancel / edit of a dispatch challan (transport, LR, date); a GR can't be undone; no choosing *which*
ready takas to dispatch (control it with GD-09 batches). Dispatch does not check against the ordered quantity.

---

## 27. Free stock (`FS`)

**Purpose.** Takas that belong to no order. A taka always keeps its origin order; "which order it counts for" is: not
free → allocated order, else origin order. **Who:** Jenish, Gaurang, Dhruvil (move / add); Jenish, Gaurang (mark fresh).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| FS-01 | Move to inventory — lump (tick takas) / pcs to pcs (enter pcs) | Jenish, Gaurang, Dhruvil | Takas tab → Move to inventory / Select; godown order screen | pcs unit; takas with us (not at butta / mill / dispatched / already free); pcs: enough final + ready pcs; not held / closed | Lump: ticked takas become free stock (stage kept; ready → final). Pcs: system picks final first, then ready, largest first; one taka is **split** if needed only partly (next letter, meters by pcs, damages stay on the kept part); `moved_to_inventory` | Inventory free stock; order's figures drop | `POST /api/orders/:id/takas/move-to-inventory` · `services/inventory-moves.ts` · `free-stock/move-to-inventory-dialog.tsx` |
| FS-02 | Add from free stock (order side) | Jenish, Gaurang, Dhruvil | Takas tab / godown order → Add from free stock | pcs unit; order not Pending for production / Dispatched / Returned / Closed; **same design**; lump: tick free takas; pcs: ready (final) free pcs, optional blouse filter (warning if blouse differs) | Takas allocated to this order (stage kept); pcs mode splits one taka if needed; `allocated_from_free_stock` | Counts for the order (Dhruvil final list, dashboard "from Order #A") | `POST /api/orders/:id/takas/add-from-free-stock`, `GET /api/inventory/items/:key/free-stock` · `free-stock/add-from-free-stock-dialog.tsx` |
| FS-03 | Assign to order (inventory side) | Jenish, Gaurang | Inventory → item → Free stock → tick → Assign to order | Same as FS-02; order chosen from valid targets | Same as FS-02 | — | `GET /api/inventory/items/:key/assign-targets`, `POST /api/orders/:id/takas/add-from-free-stock` · `inventory/item-details-page.tsx` |
| FS-04 | Mark as fresh | Jenish, Gaurang | Inventory → Damaged → item → taka → Mark as fresh | Taka final / ready / refinish with an open damage | **Every** open damage resolved ("Marked fresh in inventory") | Ready stock | `POST /api/inventory/takas/:id/mark-fresh` · `services/move.ts` · `inventory/damaged-details-page.tsx` |

**Other ways a taka becomes free stock:** Close order (reason "Order closed"), goods return (reason "Returned"), coming
back from butta / mill / QC for a closed order. **In-making free takas** keep moving through butta / mill (they appear in
the pending lists under their origin order) and follow the origin order's steps.

---

## 28. Inventory (`INV`)

**Purpose.** Design-wise pcs: ordered, in making, ready for order, ready for dispatch, refinish, damaged, free stock.
**Who:** Jenish, Gaurang.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| INV-01 | Summary KPIs | Jenish, Gaurang | Inventory | — | Total ready for order, in making, ready for dispatch, refinish, damaged, free stock; blouse toggle | — | `GET /api/inventory/summary` · `services/inventory.ts`, `shared/src/inventory.ts` · `inventory/inventory-page.tsx` |
| INV-02 | All designs | same | Inventory → All designs | — | Card per design (bar ready / making, "Free N", refinish); search `?q=`; blouse filter; one grey "Demo" stock-clearance card | INV-03 | `GET /api/inventory/items` |
| INV-03 | Item details | same | Design card | — | Header, KPI tiles that filter (`?filter=godown` = orders with ready pcs, `free` = only free stock), orders list with pcs, Free stock section (ready / in making / damaged + free takas, Assign) | FS-03 | `GET /api/inventory/items/:key`, `…/orders` · `inventory/item-details-page.tsx` |
| INV-04 | Damaged inventory | same | Inventory → Damaged | — | Design cards with open damaged pcs (incl. free damaged + refinish) | INV-05 | `GET /api/inventory/damaged` |
| INV-05 | Damaged item details | same | Card | — | Takas with open damage; filters type / refinish / search; Mark as fresh | FS-04 | `GET /api/inventory/damaged/:key`, `…/takas` · `inventory/damaged-details-page.tsx` |
| INV-06 | Old variation links | same | Old bookmark `v-<id>` | — | Answered as the design it became | — | `inventoryRouter.param('key')` (`resolveInventoryKey`) |

Pending outside pcs-POs count as "in making"; closed orders count nothing ordered; free stock is never in any order's
figures. No stock clearance / write-off flow (the "Last stock clearance" date is always empty).

---

## 29. Yarn PO (`YPO`)

**Purpose.** Buy yarn from yarn parties and receive it into a zone. Not linked to orders. **Who:** view — Jenish,
Gaurang, Supervisor, Godown supervisor; create / edit / close / cancel / print — Jenish, Gaurang; receive — all four.
Quantities stored in grams, rates in paise; rate / amount hidden from the two supervisors.

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| YPO-01 | List + filters | 4 roles | Yarn PO | — | Table / cards; filters in the URL (status, party, quality, date) + chips | YPO-04 | `GET /api/yarn-pos` · `services/yarn-po.ts` · `yarn/po-list-page.tsx`, `po-filters.tsx` |
| YPO-02 | Create PO | Jenish, Gaurang | Yarn PO → New | PO no typed, unique over every PO (live check); ≤ 30 lines; no duplicate quality | PO **Open** with lines (quality, kg, rate) | Details | `POST /api/yarn-pos`, `GET /api/yarn-pos/check-no` · `yarn/po-form-page.tsx` |
| YPO-03 | Edit PO | Jenish, Gaurang | Details → Edit | Full edit only while nothing received; afterwards **remark only**; cancelled can't be edited | Lines replaced / remark saved; PO event | — | `PUT /api/yarn-pos/:id` |
| YPO-04 | PO details | 4 roles | List | — | Lines with ordered / received / pending, receipts, activity | YPO-05..08 | `GET /api/yarn-pos/:id` · `yarn/po-details-page.tsx` |
| YPO-05 | Receive yarn challan into a zone | 4 roles | Details → Receive | PO open / partly received (fully received takes nothing more); some qty > 0 | Receipt (challan no, date, zone Direct / TFO / Warping, kg per line); ledger rows `receipt` into that zone; PO status recomputed; amber "More than pending — you can still save" | Yarn inventory zone | `POST /api/yarn-pos/:id/receipts` · `yarn/receive-page.tsx` |
| YPO-06 | Close PO (short) | Jenish, Gaurang | Details → Close | **Only partly received** | Closed | — | `POST /api/yarn-pos/:id/close` |
| YPO-07 | Cancel PO | Jenish, Gaurang | Details → Cancel | **Only open with nothing received** | Cancelled | — | `POST /api/yarn-pos/:id/cancel` |
| YPO-08 | Print PO | Jenish, Gaurang | Details → Print | — | A4 PO | — | `GET /api/yarn-pos/:id/print` · `yarn/po-print-page.tsx` |

---

## 30. Yarn inventory: zones, TFO, warping, beams (`YRN`)

**Purpose.** Yarn stock in three zones — **Direct consumption · TFO · Warping** — kept as a ledger (every change is a
row; balance = sum). **Who:** Jenish, Gaurang, Supervisor, Godown supervisor (all may do everything here).

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| YRN-01 | Summary | 4 roles | Yarn inventory | — | Zone panels (raw / twisted kg, beams) + KPIs + recent movements | YRN-02 | `GET /api/yarn/summary` · `services/yarn-stock.ts` · `yarn/inventory-page.tsx` |
| YRN-02 | Zone screen | 4 roles | Zone panel | — | Stock by quality (raw / twisted), beams, movements of the zone, zone actions | YRN-04..11 | `GET /api/yarn/zones/:zone`, `GET /api/yarn/beams` · `yarn/zone-page.tsx`, `zone-actions.tsx` |
| YRN-03 | Movements ledger | 4 roles | View all | — | Every yarn + beam movement with filters (zone, kind, quality, dates) | — | `GET /api/yarn/moves` · `yarn/movements.tsx` |
| YRN-04 | Transfer between zones | 4 roles | Zone → Transfer | Different zones; enough stock (checked inside the save: "Only 12.5 kg of raw yarn 75D in TFO"); **beams only Direct ↔ Warping** | Ledger pair transfer_out / transfer_in; beams change zone | Target zone | `POST /api/yarn/transfers` · `yarn/stock-dialogs.tsx` |
| YRN-05 | Withdraw (consume) | 4 roles | Direct consumption → Withdraw | **Direct consumption zone only**; yarn qty ≤ stock, or beams in Direct | Ledger `withdraw` / beams → **Consumed** | — | `POST /api/yarn/withdrawals` |
| YRN-06 | TFO board | 4 roles | TFO zone / board | — | Every TFO machine, sections A (top) / B (bottom): idle or running program | YRN-07/08 | `GET /api/yarn/tfo/board` · `yarn/tfo-board.tsx` |
| YRN-07 | Assign / start a TFO program | 4 roles | Idle section → Assign program | Machine active; one running program per section; raw kg ≤ TFO raw stock; TPM / twist | Raw kg leave TFO stock (`tfo_issue`); program **Running** | YRN-08 | `POST /api/yarn/tfo/programs` |
| YRN-08 | Stop program | 4 roles | Running section → Stop | Running; twisted kg > 0 / returned raw ≤ issued | Twisted kg added under the output quality (`tfo_output`); optional returned raw (`tfo_return`); program **Completed** | TFO twisted stock | `POST /api/yarn/tfo/programs/:id/stop` |
| YRN-09 | Program history of a section | 4 roles | Section → history | — | Past programs with result line | — | `GET /api/yarn/tfo/programs?machineId=&section=` |
| YRN-10 | Start warping job | 4 roles | Warping zone → Start warping | ≤ 30 inputs; each ≤ Warping stock (raw and / or twisted) | **WJ-n**; inputs leave Warping stock (`warping_issue`); job **In process** | YRN-11 | `POST /api/yarn/warping/jobs`, `GET /api/yarn/warping/jobs` · `yarn/warping.tsx` |
| YRN-11 | Mark warping done → beams | 4 roles | In-process job → Mark done | In process; ≤ 50 beams; each beam: quality, taar, panna, meters, zone Direct / Warping | Job **Done**; beams **BM-n** created **In stock** in the chosen zone (`beam_created`) | Beams list; Withdraw | `POST /api/yarn/warping/jobs/:id/done` |
| YRN-12 | Read one program / job (API only) | — | — | — | — | — | `GET /api/yarn/tfo/programs/:id`, `GET /api/yarn/warping/jobs/:id` |

No undo of any yarn movement; no stock adjustment / physical count; beams aren't linked to looms, jobsheets or orders.

---

## 31. Taka details, damage details, photo sharing (`TKD`)

| ID | Operation | Who | Starts from | Preconditions / blocks | What happens | Next / shows up | Evidence |
|---|---|---|---|---|---|---|---|
| TKD-01 | Taka drawer (details + history) | Jenish, Gaurang, Supervisor, Godown sup. | Tap a taka chip | Held order → hold message for other roles | Number, weaver / supplier no, source, meters, pcs / actual pcs, stage, free stock / allocated, damages with photos, every taka event | TKD-02 | `GET /api/takas/:id` · `takas/taka-drawer.tsx` |
| TKD-02 | Damage details screen | Jenish, Gaurang, Supervisor, Godown sup., Dhruvil | Taka drawer / Damages tab / godown Damage tab → Details | — | Every damage with type, where recorded, open / resolved pcs, photos, own timeline | TKD-03 | `GET /api/takas/:id/damages` · `takas/damage-details-page.tsx` |
| TKD-03 | Share damage photo | same | Photo → Share | — | Phone share sheet with the image, else WhatsApp link + download; message "Damage … Taka … Order #…" | Outside the system | `lib/share-image.ts`, `takas/damage-gallery.tsx`, `damageShareMessage` |
| TKD-04 | Find taka by number | butta / mill / QC / owners / godown roles | Receive, QC | — | One taka (our or weaver number) or 409 ambiguous | — | `GET /api/takas/by-no/:no` |
| TKD-05 | "Which one?" lookup (API only — no screen calls it) | — | — | — | Every taka whose number or weaver number matches | — | `GET /api/takas/lookup` |

---

## 32. Prints and documents (`PRN`)

| ID | Document | Who | Opened from | Contents / notes | Evidence |
|---|---|---|---|---|---|
| PRN-01 | Jobsheet (A4, one page each, QR) | Jenish, Gaurang, Supervisor | Jobsheets tab (Print all), jobsheet details, supervisor card print button, Start & print | Order + jobsheet number box, QR (`VITE_PUBLIC_APP_URL`, warning bar if missing), design, quality, type, blouse, pcs + sections, blank picks + loom boxes | `/print/jobsheets?ids=` · `GET /api/jobsheets/print` · `jobsheets/print-page.tsx` |
| PRN-02 | Butta challan GSM-n (A4 landscape) | Jenish, Gaurang, Godown sup. | Challan details, after send, Docs | Company header, party, date, e-way, 48 takas / page, totals | `/print/challan/:id` · `GET /api/butta/challans/:id/print` · `challans/challan-print-page.tsx` |
| PRN-03 | Mill challan MIL-n (A4 landscape) | same | same | As PRN-02 + "FOR REFINISH" | `/print/mill-challan/:id` · `GET /api/mill/challans/:id/print` |
| PRN-04 | Delivery challan DC-n / DC-n R1 | Jenish, Gaurang, Dhruvil | Dispatch dialog, Dispatched order, Docs, order page returned summary | Lump: taka grid; pcs to pcs: lines without taka numbers; blouse; REVISED watermark | `/print/dispatch-challan/:id` · `GET /api/dispatch/challans/:id` · `dispatch/print-page.tsx` |
| PRN-05 | Outside PO (A4) | Jenish, Gaurang, Godown sup., Dhruvil | Outside tab PO card, Docs | Weaver block, PO no, date, quality, qty, type, rate, notes, signatory | `/print/outside-po/:id` · `GET /api/outside-pos/:id/print` |
| PRN-06 | Yarn PO (A4) | Jenish, Gaurang | Yarn PO details | Party, lines, rates, totals | `/print/yarn-po/:id` · `GET /api/yarn-pos/:id/print` |

Not printable: weaver / FG receipts, goods return note, butta / mill QC results, godown packing list, yarn receipts /
transfers, warping job cards / beam labels, TFO programs, order confirmation, invoice.

---

## 33. Notifications, alerts and warnings (`ALR`)

There are **no push / SMS / WhatsApp / email notifications**. Everything below is shown on a screen when someone opens it.

| ID | Warning | Where | Rule | Blocking? | Evidence |
|---|---|---|---|---|---|
| ALR-01 | "Sent to the supervisor more than 24h ago, not started" | Order Dashboard → Needs attention | Jobsheet Sent > 24 h without Start | No | `ALERT_RULES`, `buildOrderDashboard` |
| ALR-02 | Coverage: jobsheet pcs less / more than the order; frames short / over | Dashboard alerts, Jobsheets tab, create / edit previews | `coverageWarnings` (silent when on target by < 1 frame); outside pcs-POs subtracted | No | `shared/src/jobsheets.ts` |
| ALR-03 | Pcs mismatch at taka entry ("Expected frames × sections") | Taka entry screen (EN + HI) | pcs entered (existing + new) ≠ frames × sections | No | `taka-entry-page.tsx` (`PcsMismatchNote`) |
| ALR-04 | Completed frames ≠ assigned | Complete / Change machine dialogs | `completedFramesNote` | No | `run-dialogs.tsx` |
| ALR-05 | Takas not ready / approx. expected more | Butta / Mill drawer | "18 of ~20 expected takas are ready …" | No (greyed rows) | `send-pending.tsx` |
| ALR-06 | Ready takas still damaged | Dispatch dialog | open damages on ready takas, expandable list | No | `dispatch-dialog.tsx` |
| ALR-07 | Blouse mismatch | Add from free stock | taka blouse ≠ order blouse | No | `blouseMismatchNote`, `add-from-free-stock-dialog.tsx` |
| ALR-08 | Taka was damaged — split clears it | Split screen | original has open damage | No | `split-page.tsx` |
| ALR-09 | Not marked received from the mill yet — will be on save | Mill QC screen | taka still At mill | No | `MILL_QC_TEXT` |
| ALR-10 | "More than pending" | Yarn receipt | qty > pending on a line | No | `overReceiptText`, `yarn/receive-page.tsx` |
| ALR-11 | Order is on hold / closed | Banner on the order; every blocked screen (EN + HI for bilingual roles) | GRD | Yes (writes) | `hold-guard.ts`, `orders/hold/*` |
| ALR-12 | QR base address missing | Jobsheet print preview | `VITE_PUBLIC_APP_URL` not set | No | `jobsheets/print-page.tsx` |
| ALR-13 | Checked pcs more than ordered | Godown order bar | checked pcs > ordered | No | `checkedPcsBar` |
| ALR-14 | Live "number already used" | Edit takas, receipts, split | `GET /api/takas/check` | Yes (row) | ET-03 |
| ALR-15 | Conflict "changed meanwhile — refresh and try again" | Every write | conditional updates | Yes | all services |

---

## 34. Image uploads (`UPL`)

| ID | Operation | Who | Starts from | Rules | Evidence |
|---|---|---|---|---|---|
| UPL-01 | Upload an image (design, order note, damage photo) | Masters / design / order roles; QC, goods-return and receive roles **damage photos only** | Any image field | JPG / PNG / WebP / HEIC ≤ 10 MB (client shrinks > 3 MB); stored as WebP + 320 px thumb on Cloudinary (live) or disk (local) | `POST /api/uploads?folder=` · `routes/uploads.ts`, `storage/*` |

Taka entry can't add damage photos; Dhruvil's godown "Mark damage" can (he has goods-return upload rights). Abandoned
uploads are never cleaned up; image URLs are public.

---

## 35. Dropdown lookups (`LKP`)

Technical id + name lists used by forms: customers (+ brokers), materials, machines (active), damages, butta / mill
parties, weavers, yarn parties, yarn qualities. `GET /api/lookup/*` · `routes/lookup.ts`. Each is open to the roles
whose forms need it (see `COVERAGE_CHECK.md`).

---

## 36. Hold / close guard (`GRD`, cross-cutting)

**One place** (`server/src/middleware/hold-guard.ts`) decides what a held / closed order blocks.

| ID | Rule | Effect |
|---|---|---|
| GRD-01 | Writes on a **held** order | 409 "Order #26 is on hold" for every role (Jenish included): edit order / steps, jobsheet create / send / edit / delete / pull back / start / complete / change machine, taka entry, edit takas, send for production, undo, move to inventory, add from free stock, send back, outside PO create / edit / cancel / close, Close order, butta / mill challan create / cancel, QC, godown tick / split / damage / resolve / refinish, ready for dispatch, dispatch, goods return, mark fresh |
| GRD-02 | Not blocked on a held order | Hold / release, butta / mill receive, mill received count, undo receive, outside / FG receipts |
| GRD-03 | Writes on a **closed** order | Same 409 "Order #26 is closed", **except** receiving (as GRD-02), QC of takas that come back, and goods return |
| GRD-04 | Reads for roles that don't see held orders (all but Jenish / Gaurang) | Order-level screens → 404; jobsheet / taka / QC screens → 409 hold message; lists filter held + closed orders out |
| GRD-05 | Godown supervisor's Orders | Only orders with ≥ 1 active (non-free) taka; others 404 |

---

## Module links (inputs → outputs)

| Module | Receives from | Sends to |
|---|---|---|
| 1 AUTH | Users master (accounts) | Every module (acting role decides access) |
| 2 USR | — | AUTH (who can log in); user name on every history row |
| 3 CUS | — | Orders (client, broker); Dispatched search; delivery challan |
| 4 MAT | — | Orders (quality), designs (qualities), outside POs, work filters, inventory |
| 5 DES | Materials | Orders (design, pre-fills Butta step), inventory items, prints |
| 6 MAC | — | Jobsheets (assigned looms), Start / Change machine, Machine view, Loom filter |
| 7 DMG | — | Every damage popup (TE, ET, QC, GD, OUT, FG, DSP) |
| 8 PTY | — | Butta / mill challans |
| 9 WEV | — | Outside POs, weaver taka numbers (short code) |
| 10 YM | — | Yarn PO, yarn inventory, TFO board |
| 11 ORD | Masters | Jobsheets (in-house), outside POs, FG receipts, every later module via steps |
| 12 HLD | Orders | Hold guard (blocks / hides everywhere), free stock (Close), outside POs (Close) |
| 13 ODT | Every order-level module | Jobsheets, outside, takas actions, prints |
| 14 JS | Orders, machines | Supervisor (Sent), prints / QR, Taka entry, dashboard |
| 15 SUP | Jobsheets (Sent) | Machine view, Taka entry (Completed), dashboard |
| 16 MV | Jobsheets, machines | — (read-only) |
| 17 TE | Jobsheets (any status) | Takas → Butta pending / Mill pending / Dhruvil final (by steps); order status |
| 18 ET | Takas | Same takas (corrected); receipt / PO totals |
| 19 OUT | Orders, weavers | Takas → Butta / Mill / Dhruvil; jobsheet coverage (pcs POs); Receive goods |
| 20 FG | Orders (no steps) | Takas → Dhruvil final |
| 21 BUT | Takas waiting for butta / sent back; butta parties | Butta QC pending → QC |
| 22 QC | Butta receive, mill count / at-mill takas | Mill pending, Dhruvil final, Mill Refinish; free stock (closed orders) |
| 23 MIL | Takas waiting for mill / refinish; mill parties | Mill QC |
| 24 RW | Takas with us (owner choice) | Butta pending (Re-butta), Mill Refinish |
| 25 GD | Final takas (QC / receipts / FG / free stock assigned) | Dispatch, Mill Refinish, free stock |
| 26 DSP | Ready-for-dispatch takas | Client; Dispatched module; free stock (GR) |
| 27 FS | Orders (move), GR, Close order | Other orders of the same design; inventory figures |
| 28 INV | Every order's takas + free stock + open pcs POs | Assign to order (FS-03), Mark fresh |
| 29 YPO | Yarn parties / qualities | Yarn zones (receipts) |
| 30 YRN | Yarn receipts | Beams → consumed (no link to orders / looms) |
| 31 TKD | Takas, damages | Share sheet / WhatsApp |
| 32 PRN | Jobsheets, challans, POs | Paper |
| 33 ALR | Dashboard, forms | — |
| 34 UPL | Forms | Images on designs, notes, damages |
| 35 LKP | Masters | Dropdowns |
| 36 GRD | Order hold / close flags | Every write and work list |
