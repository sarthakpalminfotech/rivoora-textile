# Rivoora Textile — Project State

Snapshot of what the code actually does as of **2026-10-14** — the latest work is the **Sprint 11** section at the very end (Sprints 7–10 are short summaries at the end too; see `CLAUDE.md` for detail). **Sprint 6 (client demo feedback)** is in
[§13](#13-sprint-6--client-demo-feedback); Sprint 5 (order dashboard) in [§12](#12-sprint-5--order-dashboard-order-details-page).
Sprint 4 is in [§11](#11-sprint-4--taka-entry-role-qr-scan-takas-on-orders), Sprint 3 in
[§10](#10-sprint-3--supervisor-machine-production-flow-machine-view), Sprint 2 in [§9](#9-sprint-2--machines--jobsheets).
Written so a developer can continue the project without reading the code first. The original brief is
`rivoora-claude-code-prompt.md`; day-to-day conventions are in `CLAUDE.md`.

> Where §1–§9 disagree with §10–§13 or the Sprint 7–11 sections at the end (e.g. "Ready for production" label, two roles, 4-tab bottom nav, the order details layout, the 2-page print, digits-only taka numbers, DEFAULT_UNIT meters), **the later section is current.**

`npm run typecheck` and `npm run build` pass for all three packages at the time of writing. `npm test` runs the vitest
suites for the shared logic (jobsheet maths, takas, QR parsing, order dashboard, butta/mill, inventory — 173 tests as of Sprint 11, all passing). There are no server or UI tests
in the repo (the Sprint 3–5 API flows were verified with throwaway scripts against a local SQLite copy, see §10–§12).

---

## 1. Tech stack and folder structure

### Stack

| Layer | Technology |
|---|---|
| Monorepo | npm workspaces: `shared`, `server`, `client`; `concurrently` runs dev servers together |
| Shared | TypeScript source only (no build step), zod 3 |
| Server | Node 20+, Express 4, TypeScript (ESM), `tsx` for dev, `tsup` for build |
| DB | Turso (libSQL) via `@libsql/client` + Drizzle ORM 0.45, `drizzle-kit` migrations |
| Uploads | multer (memory storage) + sharp → WebP; stored on local disk |
| Client | Vite 6, React 18, TypeScript, React Router 6 (data router), TanStack Query 5 |
| UI | Tailwind 3 + `tailwindcss-animate`, Radix primitives (dialog, popover, dropdown-menu, tooltip, tabs, checkbox, slot), shadcn-style components written in-repo, `lucide-react`, `sonner` toasts, `react-day-picker` 9, `class-variance-authority` |
| Forms | react-hook-form + zod (`@hookform/resolvers`) |
| Dates | date-fns 4 |

Ports: API `4000` (env `PORT`), Vite dev server `5180` with `host: true` (LAN-reachable). Vite proxies `/api` and
`/uploads` to `API_URL` env or `http://localhost:4000`. In production (`npm start`) Express also serves
`client/dist` with an SPA fallback when that folder exists.

### Folder structure

```
rivoora-textile/
├─ package.json                  workspaces + root scripts (dev, build, start, typecheck, db:*)
├─ CLAUDE.md  README.md  rivoora-claude-code-prompt.md  PROJECT_STATE.md
├─ shared/                       @rivoora/shared — imported by client AND server
│  └─ src/
│     ├─ index.ts                re-exports everything below
│     ├─ roles.ts                ROLES config + permissions, can(), isRoleKey()
│     ├─ statuses.ts             ORDER_STATUSES config + helpers
│     ├─ units.ts                UNITS = meters | kg | pcs | g, DEFAULT_UNIT = meters
│     ├─ codes.ts                normalizeCode(), variationCode() (placeholder hint only)
│     ├─ schemas.ts              zod request schemas (server validates with these)
│     └─ types.ts                API DTO types
├─ server/
│  ├─ .env.example               TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, PORT
│  ├─ drizzle.config.ts  tsup.config.ts
│  ├─ drizzle/                   generated SQL migrations + meta/ (journal, snapshots)
│  ├─ uploads/                   image files (gitignored except demo/ and .gitkeep)
│  │  ├─ demo/                   42 seed images (21 full + 21 thumbs), committed
│  │  └─ designs/ notes/         user uploads (created on demand)
│  └─ src/
│     ├─ index.ts                Express app wiring
│     ├─ env.ts                  loads server/.env, exits if TURSO_* missing
│     ├─ config/roles.ts         re-export of shared roles
│     ├─ db/                     client.ts, schema.ts, migrate.ts, seed.ts, patterns.ts (SVG textile patterns)
│     ├─ lib/                    errors.ts (HttpError helpers), http.ts (ah(), parseId, pagination, LIKE escaping, csv)
│     ├─ middleware/             role.ts (X-Role → req.role, requirePermission), error.ts (error JSON)
│     ├─ routes/                 customers, designs, lookup, materials, orders, uploads (thin routers)
│     ├─ services/               customers, designs, materials, orders (all SQL + business rules)
│     └─ storage/                index.ts (active driver), local.ts (sharp → disk), types.ts (driver contract)
└─ client/
   ├─ index.html                 DM Sans from Google Fonts, theme-color #8B1E3F
   ├─ vite.config.ts  tailwind.config.ts  postcss.config.js
   ├─ public/favicon.svg         also used as the logo
   └─ src/
      ├─ main.tsx  App.tsx  index.css
      ├─ config/                 roles.ts, statuses.ts (re-exports from shared)
      ├─ lib/                    api.ts, form.ts, format.ts, query-client.ts, role-store.ts, utils.ts
      ├─ hooks/                  useDebounce, useInfiniteList, useInfiniteScroll, useMediaQuery, useRole
      ├─ components/
      │  ├─ layout/              app-layout (sidebar/rail, top bar, bottom nav), nav-items, page-title, page-skeleton, profile-menu
      │  ├─ ui/                  design system (see §6)
      │  └─ list-parts.tsx       SearchBar, LoadMore, ErrorState, Fab, FetchingIndicator
      ├─ features/
      │  ├─ orders/              orders-page, add-order-page, order-details-page, saved-designs-drawer,
      │  │                       order-filters, filters (URL state), api (query hooks)
      │  └─ masters/             api, master-list (generic list scaffold), use-delete-flow,
      │     ├─ customers/        customers-page, customer-form
      │     ├─ materials/        materials-page (form inline)
      │     └─ designs/          designs-page, design-detail-page, design-form, variation-form
      └─ pages/                  not-found-page, route-error
```

---

## 2. Database

Turso (libSQL/SQLite). Schema source of truth: `server/src/db/schema.ts`.

Conventions used by every table:
- `id` — `integer PRIMARY KEY AUTOINCREMENT`
- `created_at`, `updated_at` — `text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` (ISO strings).
  `updated_at` is also set by Drizzle `$onUpdate` on every update issued through Drizzle.
- `is_deleted` — `integer (boolean) NOT NULL DEFAULT false`, only on masters (customers, materials, designs).
- Booleans are stored as 0/1. Dates-only (`order_date`) are `yyyy-MM-dd` text.

### customers

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| name | text NOT NULL | |
| phone | text | normalized (spaces/dashes and leading `+91`/`0` stripped), must match `^[6-9]\d{9}$` |
| alternate_phone | text | same rule as phone |
| email | text | lower-cased, email-validated |
| address | text | ≤500 |
| city | text | ≤80 |
| gst_number | text | ≤20, upper-cased, no format validation |
| notes | text | ≤1000 |
| is_deleted, created_at, updated_at | | |

Indexes: `customers_name_idx (name)`.

### materials

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| name | text NOT NULL | ≤80, unique (case-insensitive) among non-deleted |
| code | text | ≤30, optional, not unique |
| notes | text | |
| is_deleted, created_at, updated_at | | |

Indexes: `materials_name_idx (name)`; `materials_name_active_unique` UNIQUE on `lower(name)` WHERE `is_deleted = 0`.

### designs

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| code | text NOT NULL | normalized (upper-case, spaces removed), `^[A-Z0-9_\-/.]+$`, ≤30 |
| name | text | |
| image_url | text | nullable (a design can exist without an image) |
| thumb_url | text | |
| notes | text | |
| material_id | integer FK → materials.id | **nullable; added in migration 0001.** "This design is only made in this material" |
| is_deleted, created_at, updated_at | | |

Indexes: `designs_code_idx (code)`; `designs_material_idx (material_id)`; `designs_code_active_unique` UNIQUE on
`code` WHERE `is_deleted = 0`.

### design_variations

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| design_id | integer NOT NULL FK → designs.id | |
| variation_no | integer NOT NULL | assigned by server as `MAX(variation_no)+1` per design |
| code | text NOT NULL | **typed by the user**, same rules as design codes |
| image_url | text | required by the API schema, nullable in DB |
| thumb_url | text | |
| created_at, updated_at | | no `is_deleted` — variations are hard-deleted |

Indexes: `design_variations_design_idx (design_id)`; `design_variations_code_idx (code)`;
`design_variations_design_no_unique` UNIQUE on `(design_id, variation_no)`.

Code uniqueness: design codes and variation codes share one namespace. This is enforced **in application code
only** (`isDesignCodeTaken` in `services/designs.ts`) — there is no DB constraint on variation `code`.

### orders

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| order_no | integer NOT NULL | `(SELECT COALESCE(MAX(order_no),0)+1 FROM orders)` inside the insert transaction |
| customer_id | integer NOT NULL FK → customers.id | |
| material_id | integer NOT NULL FK → materials.id | |
| design_id | integer FK → designs.id | nullable |
| variation_id | integer FK → design_variations.id | nullable; requires design_id |
| quantity | real NOT NULL | > 0, ≤ 100,000,000 |
| unit | text NOT NULL | `meters` \| `kg` \| `pcs` \| `g` |
| rate | real | nullable, ≥ 0 |
| order_date | text NOT NULL | `yyyy-MM-dd` |
| notes | text | ≤4000 |
| status | text NOT NULL | status key from `shared/src/statuses.ts` |
| sent_to_production_at | text | ISO, set on send, cleared on undo |
| created_at, updated_at | | |

Indexes: `orders_order_no_unique` UNIQUE `(order_no)`; `orders_status_idx`; `orders_order_date_idx`;
`orders_customer_idx`; `orders_material_idx`; `orders_design_idx`.

### order_note_images

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| order_id | integer NOT NULL FK → orders.id ON DELETE CASCADE | |
| image_url, thumb_url | text NOT NULL | |
| created_at, updated_at | | |

Indexes: `order_note_images_order_idx (order_id)`. Max 10 per order (validated).

### order_status_history

| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| order_id | integer NOT NULL FK → orders.id ON DELETE CASCADE | |
| from_status | text | NULL for the "created" entry |
| to_status | text NOT NULL | |
| role | text NOT NULL | role key that made the change (`jemish` / `gaurang`) |
| changed_at | text NOT NULL | default now |
| created_at, updated_at | | |

Indexes: `order_status_history_order_idx (order_id)`. Written on create, send-to-production and undo.

### Relations summary

```
customers 1─* orders *─1 materials
designs   1─* orders        design_variations 1─* orders
designs   1─* design_variations
materials 1─* designs (optional default material)
orders    1─* order_note_images, order_status_history (cascade delete — orders are never deleted today)
```

All other FKs are `ON DELETE NO ACTION`; masters are soft-deleted, so FKs are never violated in practice.

### Migrations (`server/drizzle/`)

| # | File | What it does | Git state |
|---|---|---|---|
| 0000 | `0000_tiresome_mandroid.sql` | Creates all 7 tables and indexes above (without `designs.material_id`) | committed |
| 0001 | `0001_curious_mulholland_black.sql` | `ALTER TABLE designs ADD material_id integer REFERENCES materials(id)` + `designs_material_idx` | committed |
| 0002 | `0002_jobsheets_machines.sql` | `machines`, `jobsheets`, `jobsheet_machines`, `counters` (+ row `jobsheet_no = 0`), orders `jobsheet_pieces` / `target_frames` / `frames_per_jobsheet` | uncommitted; **applied to Turso** on 2026-09-29 |

Whether 0001 has been applied to the Turso DB can't be told from the code. `npm run db:migrate` is idempotent,
so run it to be sure.

### Seed (`npm run db:seed`)

Idempotent: customers/materials/designs/variations are matched by name, code or `(design, variation_no)` and
inserted only if missing. Orders are seeded only when the `orders` table is empty. It creates 8 customers
(Surat, Ahmedabad, Jaipur, Vadodara, Mumbai, Rajkot, Chennai), 6 materials (Georgette GEO, Chiffon CHF, Silk SLK,
Cotton COT, Crepe CRP, Rayon RAY), 6 designs D101–D106 with 2–3 variations each (codes `D101N1`…, images
generated from SVG patterns in `patterns.ts`), and 25 orders over the last 44 days (14 Ready, 11 Pending, with
repeat designs for the same client) plus matching history rows. The seed does not set `designs.material_id`.

---

## 3. API endpoints

Everything is under `/api`, JSON in and out. Every route except `GET /api/health` needs the header
`X-Role: jemish | gaurang` (case-insensitive). If it's missing or invalid the API returns **400**.
Errors look like `{ "error": { "message": string, "field"?: string } }`, with codes 400 (validation, zod, multer,
bad JSON), 403 (permission), 404, 409 (conflict / UNIQUE constraint), 500.

Permission column: **All** means any valid role. Permission names are from `shared/src/roles.ts`.
`requirePermission(a, b)` means **either** permission is enough.

### Orders

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/orders?search=&status=a,b&material=1,2&from=&to=&page=&limit=` | Lean paginated list (default 20, max 100), newest `order_no` first. Joins customer, material, design, variation in one query. Returns `designCode` / `designThumbUrl` (variation if set, else design). **Never returns rate.** Only statuses visible to the role; requested statuses are intersected with visible ones. Search (leading `#` stripped) matches customer name, material name, design code, variation code; if numeric also exact `order_no` and quantity prefix. `from`/`to` filter `order_date` inclusive. | All (role-filtered) |
| GET | `/orders/:id` | Full detail + note images + status history. **404 if the order's status isn't visible to the role.** `rate` key present only when `canSeeRate`. | All (role-filtered) |
| POST | `/orders` | Create. Body `orderCreateSchema`: `customerId, materialId, designId?, variationId?, newDesign? {code,imageUrl,thumbUrl}, quantity, unit, rate?, orderDate, notes?, noteImages[]`. Checks that the referenced records exist and aren't deleted. `newDesign` inserts a design into Design Master in the same transaction (409 on `designCode` if the code is taken). Status `pending_production`, writes history. Returns `{ id, orderNo }` (201). | `canAddOrder` |
| POST | `/orders/send-to-production` | Body `{ orderIds: number[] }` (1–500). In one transaction, moves only those currently `pending_production` → `ready_production`, sets `sent_to_production_at`, writes history. Other ids are silently skipped. 409 if none were updated. Returns `{ updated, orderIds }`. | `canSendToProduction` |
| POST | `/orders/:id/undo-production` | `ready_production` → `pending_production`, clears `sent_to_production_at`, writes history. 409 if the order isn't Ready. Returns the updated order detail. | `canUndoProduction` |

### Customers

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/customers?search=&page=&limit=` | Paginated, sorted by `lower(name)`. Search: name, phone, city. | All |
| GET | `/customers/:id` | One customer | All |
| GET | `/customers/:id/previous-designs` | Distinct design/variation pairs used in this client's orders, each with its **latest** order (no, date), `timesUsed`, and the design's default material; newest first, max 60, not paginated. Skips deleted designs. Not role-filtered by status. | All |
| POST | `/customers` | Create | `canManageMasters` **or** `canAddOrder` (so the Add Order ➕ works) |
| PUT | `/customers/:id` | Update | `canManageMasters` |
| DELETE | `/customers/:id` | Soft delete. 409 with "used in N orders" when referenced. 204. | `canManageMasters` |

### Materials

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/materials?search=&page=&limit=` | Paginated, sorted by `lower(name)`. Search: name, code. | All |
| GET | `/materials/:id` | One material | All |
| POST | `/materials` | Create. 409 on `name` if a case-insensitive duplicate exists. | `canManageMasters` |
| PUT | `/materials/:id` | Update (same uniqueness rule) | `canManageMasters` |
| DELETE | `/materials/:id` | Soft delete. 409 if used in orders. Also sets `material_id = NULL` on designs that used it. 204. | `canManageMasters` |

### Designs & variations

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/designs?search=&page=&limit=` | Paginated, newest id first. Items: `id, code, name, thumbUrl, imageUrl, variationCount, materialName`. Search: design code, name, or any of its variation codes. | All |
| GET | `/designs/check-code?code=&exceptId=` | `{ code (normalized), available }` — checks active design codes **and** variation codes | All |
| GET | `/designs/:id` | Design + `material {id,name} \| null` + variations (by `variation_no`) | All |
| POST | `/designs` | Create (`code, name?, notes?, imageUrl?, thumbUrl?, materialId?`). 409 on `code` if taken; 400 on `materialId` if the material doesn't exist. | `canManageMasters` |
| PUT | `/designs/:id` | Update the same fields. Variation codes are **not** renamed when the design code changes. | `canManageMasters` |
| DELETE | `/designs/:id` | Soft delete. 409 if any order references the design. | `canManageMasters` |
| GET | `/designs/:id/variations` | Variations array | All |
| POST | `/designs/:id/variations` | Body `{ code, imageUrl, thumbUrl }` (all required). 409 on `code` if taken. `variation_no` auto-assigned. | `canManageMasters` |
| DELETE | `/designs/:id/variations/:variationId` | **Hard delete.** 409 if used in orders. | `canManageMasters` |

There is no endpoint to edit a variation.

### Lookups (dropdowns)

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/lookup/customers?search=` | `{id, name, city}[]`, max 30, `Cache-Control: private, max-age=10` | All |
| GET | `/lookup/materials?search=` | `{id, name, code}[]`, max 50, same cache header | All |

### Uploads & misc

| Method | Path | Purpose | Permission |
|---|---|---|---|
| POST | `/uploads?folder=designs\|notes` | multipart field `file`, one image ≤10 MB (jpg/jpeg/png/webp/heic/heif by MIME or extension). sharp auto-rotates it and saves `<name>.webp` (≤1600px wide, q82) + `<name>-thumb.webp` (320×320 cover, q72). Returns `{ url, thumbUrl }` (201). | `canManageMasters` **or** `canAddOrder` |
| GET | `/api/health` | `{ ok: true }` — no role header needed | — |
| GET | `/uploads/*` (not under /api) | Static files, `immutable`, `max-age 365d`, 404 on missing | public |

---

## 4. Screens and routes

Routing lives in `client/src/App.tsx`. Pages are lazy-loaded (`React.lazy`). Changing the role re-mounts the whole
router (`key={role}`) and clears the React Query cache. Breakpoints (Tailwind): `sm 480`, `md 768`, `lg 1024`,
`xl 1280`, `2xl 1536`.

### App shell (`AppLayout`, all routes except `/orders/new`)

- **Phone (<768):** sticky top bar (logo, page title, role tag, avatar) + fixed **bottom nav** with 4 tabs
  (Orders, Customers, Materials, Designs). Pages leave bottom padding for the nav.
- **Tablet (768–1023):** left **icon rail** (76px), with an Expand/Collapse button at the bottom. The expanded
  state is saved in localStorage `rivoora.sidebar.expanded`. No bottom nav.
- **Desktop (≥1024):** always-expanded 256px sidebar with logo, "Rivoora Textile / Order management" and the 4 links.
- **Top bar:** page title (set with `usePageTitle`, which also sets `document.title`), `RoleTag` (gold pill with
  "Owner"/"Partner"), and `ProfileMenu`.
- **ProfileMenu:** avatar (initial on maroon with gold ring) + name/title (≥480px). The dropdown shows the current
  user and a "Switch role" radio list (Jemish — Owner, Gaurang — Partner). Switching saves to localStorage
  `rivoora.role`, clears the cache, shows a toast and navigates to `/orders`.
- `/` redirects to `/orders`. Unknown paths → `NotFoundPage`. A crash or failed lazy chunk → `RouteError`
  ("A new version is available" + Reload button for chunk errors).

### `/orders` — Orders list (`features/orders/orders-page.tsx`)

- **Toolbar:** `SearchBar` ("Search by client, order no, design, quantity, material…", debounced 300 ms),
  a spinner while refetching, a filter icon button with an active-count badge, and an **Add Order** button
  (md+ only, `canAddOrder` only).
- **Filter chips** below the toolbar (status / material / date range), each removable, plus "Clear all".
  All filters and the search live in the URL (`q`, `status`, `material`, `from`, `to`), so they survive
  going to a detail page and back.
- **Filter dialog** (`OrderFiltersDialog`): **full screen on every breakpoint** (content max-w-2xl). Fields:
  Status multi-select (only shown if the role can see more than one status, so it's hidden for Gaurang),
  Order date with preset pills (Today / Last 7 days / This month) + `DateRangePicker`, and Material multi-select
  with server search. The footer has "Clear all" (clears the draft) and "Apply".
- **List:** a **card grid on every breakpoint**: 1 column on phones, 2 at md, 3 at lg, 4 at xl, 5 at 2xl.
  Each card shows `#N` + `StatusBadge`; a 64px design thumbnail (variation or design, no lightbox) next to the
  client name and "Design <code>" / "No design"; then Quality, Quantity (with unit) and Date. The whole card
  opens `/orders/:id`. Pending cards show a full-width **"Send for production"** button (`canSendToProduction`
  only); the button stops the click from opening the order.
- **Pagination:** infinite scroll with an IntersectionObserver (400px margin) plus a "Load more" fallback button
  and a "Showing X of Y orders" line.
- **Selection mode** (starts from a card's Send button): that order is pre-selected. Pending cards get a checkbox
  and toggle when clicked. Non-pending cards are dimmed (opacity 40%) and can't be clicked. The row buttons and the
  FAB are hidden. An info banner appears. The **action bar** is fixed above the bottom nav on phones and sticky at
  the bottom of the list on md+. It has "N of M pending selected" (≥480px), **Select all pending** (only covers the
  pages loaded so far), **Cancel**, and **Send for production (N)** (disabled at 0). Escape exits selection mode.
  Confirm dialog: "Send N orders for production?" → one API call → toast "N orders sent for production" → exit
  selection mode. The cache is patched to the new status, then refetched.
- **FAB** (phone only, `canAddOrder`, hidden in selection mode) → `/orders/new`.
- **States:** skeleton cards; `ErrorState` with Retry; empty states: "No orders match your search/filters"
  (+ Clear filters), "No orders yet — add your first order" (+ Add Order, Jemish), "No orders ready for
  production yet" (Gaurang).

### `/orders/new` — Add Order (`features/orders/add-order-page.tsx`)

This is a full-screen route **outside** the app layout (no sidebar or nav). If the role lacks `canAddOrder` it
redirects to `/orders`.

- **Header:** close (X) → `/orders`, the title "New order", and a **"Save order"** button on md+ only.
- **Form** (max-w-3xl, centred), in section cards:
  1. **Client & material** (2 columns at md+): *Client name* (required; searchable `Select` with server search and a
     **➕** button beside it that opens `CustomerFormDialog`; after saving, the new customer is selected and the rest
     of the form is kept) and *Material / Quality* (required; searchable). If a design with a default material is
     picked, the material is pre-selected and a hint "Pre-selected from design X" appears. The user can still
     change it.
  2. **Design**: with nothing attached there are two tiles: **Upload design image** (`ImageDropzone`,
     tap = camera/gallery on phones, drag-drop on desktop) and **View saved designs** (opens the drawer). Once
     attached, a card shows the thumbnail (tap → lightbox) and either
     - *saved*: "Design"/"Variation" label + code, **Change** (reopens drawer), **Remove**; or
     - *upload*: a required **Design code** input with a **live availability check** (debounced 400 ms via
       `/designs/check-code`; the hint says "X is available — it will be saved to Design Master" or "This code is
       already used"), **Change image**, **Remove**.
  3. **Quantity & pricing**: *Quantity* (required, decimal, > 0) with a fixed **unit** `Select` beside it
     (meters default, kg, pcs, g); *Rate* (optional, ₹ prefix, "per unit" hint, shown only when `canSeeRate`);
     *Order date* (`DatePicker`, defaults to today).
  4. **Notes**: a textarea with a toolbar holding a **disabled mic** (tooltip "Voice notes coming soon",
     opens on hover or tap) and an **image attach** button (multiple files, max 10). Attached images show as
     removable 80px thumbnails.
- **Sticky bottom bar:** Cancel + **Save** (both breakpoints; on phones they share a 2-column grid).
- **Save:** client-side zod validation with inline errors. Server field errors are mapped inline (including
  `designCode`/`newDesign.code` → design code field). While saving the button is disabled with a spinner.
  On success: toast "Order #N created" → `/orders`.
- **Unsaved changes:** `useBlocker` shows "Discard this order?" (Discard / Keep editing) for in-app navigation, and
  `beforeunload` covers tab close or reload.

### Saved designs drawer (`features/orders/saved-designs-drawer.tsx`)

- **Phone:** full screen (back arrow). **md+ (≥768):** slides in from the **right**, `max-w-[540px]`, with a
  dimmed backdrop.
- Header "Saved designs", search box ("Search design or variation code…", debounced), and tabs:
  - **Previous orders** (the default tab when a client is selected): tiles from `/customers/:id/previous-designs`
    showing thumbnail, code, `#orderNo · date`, and "N×" if the design was used more than once. The search filters
    **client-side**. Empty states: "Select a client to see their previous designs", "No previous designs",
    "No previous designs match your search".
  - **Design library**: server-searched, paginated grid of `DesignCard`s (2 columns, 3 at ≥480px). Tapping one opens
    the variations view: "All designs" back link, code/name/material, and tiles for **Base design** + each
    variation.
- The currently attached design is highlighted with a check mark. Picking a tile closes the drawer and attaches it
  (and its default material, if any).

### `/orders/:id` — Order details (`features/orders/order-details-page.tsx`)

- "← Orders" back link: goes back in history, which keeps the list filters, or to `/orders` on a direct visit.
- Heading "Order #N" + status badge. An **Undo send for production** button appears only when `canUndoProduction`
  and the status is Ready. It opens a confirm dialog ("Move order #N back to Pending for production?" → "Move back"),
  then a toast.
- Layout: a single column on phone/tablet. At lg+ it has two columns (`1fr | 360px`).
  - **Order details** card: client (+ city), phone (a `tel:` link), material (+ code), quantity with unit,
    **rate only if the API returned it**, order date.
  - **Notes** card: text + note image thumbnails (lightbox).
  - **Dates** card: Created (date + time), Sent to production (or "Not yet").
  - **Design** card (right column): a large square image (lightbox loads the full image), the code, and
    "Variation of D101 · name" when a variation is set; otherwise "No design attached".
  - **Status history** card: a timeline, newest first. It says "Order created", "Moved to X" or
    "Moved back to X" (when the sequence goes down), with date/time and "by <role name>".
- 404 → "Order not found — it may not exist or isn't visible for your role."

### `/customers` — Customer Master (`features/masters/customers/`)

- Toolbar: search ("name, phone or city"), **Add Customer** button (md+) / FAB (phone). The add controls only
  appear when `canManageMasters`.
- **md+ (from 768, so tablets too):** a table inside a card with a sticky header. Columns: Name, Phone, City,
  GST number (lg+), Email (xl+), and Edit/Delete icon buttons. **Phone:** cards (name, phone, city) with the same
  icons.
- Clicking a row opens the form: **Add / Edit customer** for Jemish, **Customer details** (read-only fieldset,
  Close button only) for Gaurang.
- `CustomerFormDialog`: full screen on every breakpoint (content max-w-3xl). Fields: Name*, Phone, Alternate
  phone, Email, City, Address, GST number, Notes. It can't be dismissed by an outside click while dirty.
  The same component is reused by the Add Order ➕.
- Delete → confirm dialog → soft delete. If the customer is in use, a toast shows the server's 409 message.

### `/materials` — Material Master (`features/masters/materials/materials-page.tsx`)

- Same list scaffold (`MasterList`). Table columns: Name, Code, Notes. Phone cards show the name + code and a
  one-line notes preview.
- Form (full screen, max-w-2xl content): Name (quality)*, Code, Notes. It's read-only for Gaurang.
- Delete is the same as customers (409 if used in orders).

### `/designs` — Design Master grid (`features/masters/designs/designs-page.tsx`)

- Search ("design or variation code") + **Add Design** (button/FAB, `canManageMasters`).
- A thumbnail grid on **every** breakpoint: 2 columns on phones, 3 at ≥480px, 4 at lg, 5 at xl. `DesignCard` shows a
  square thumbnail, code, "name · material", and a gold badge with the variation count.
- Add Design form → after saving, navigates to the new design's page.

### `/designs/:id` — Design detail (`features/masters/designs/design-detail-page.tsx`)

- "← All designs" link. Top card: a square image (lightbox; 300px column at md+), code, name, **Edit** / **Delete**
  (`canManageMasters`), Material / Quality ("Any material" if none), variation count, "Added on", notes.
- **Variations** card: a grid (2 columns on phones, 3 at ≥480px, 5 at lg) of thumbnails + code, each with an ✕
  remove button (confirm dialog, hard delete, 409 if used), plus an **Add variation** tile.
- `DesignFormDialog` (full screen): image (dropzone or preview with Change/Remove), Design code* (the server checks
  uniqueness; this form has no live check), Name, **Material / Quality** (optional searchable select with a clear
  ✕ button; the hint explains it pre-selects on new orders), Notes.
- `VariationFormDialog` (full screen): Variation image* + **Variation code*** typed by the user, with a live
  availability check. The placeholder suggests `<DESIGN>N<next no>`.
- Delete design → confirm → soft delete → `/designs`. A 409 if it's used in orders.

---

## 5. Status and role configuration (current values)

### `shared/src/statuses.ts`

| key | label | sequence | badge bg / text / dot | visibleTo |
|---|---|---|---|---|
| `pending_production` | Pending for production | 10 | `#FEF3C7` / `#92400E` / `#F59E0B` (amber) | `['jemish']` |
| `ready_production` | Ready for production | 20 | `#DCFCE7` / `#166534` / `#22C55E` (green) | `FROM_READY` = `['jemish','gaurang']` |
| `jobsheet_created` | Jobsheet created | 30 | `#E0E7FF` / `#3730A3` / `#6366F1` (indigo) | `FROM_READY` |

Helpers: `getStatus(key)` (unknown keys fall back to a grey badge), `isStatusKey`, `statusesForRole(role)`
(sorted by sequence), `visibleStatusKeys(role)`, `canRoleSeeStatus(role, status)`, and the constant
`STATUS.PENDING_PRODUCTION / READY_PRODUCTION`. The only transitions are Pending → Ready (send) and
Ready → Pending (undo), both via `changeStatus()` in `server/src/services/orders.ts`.

### `shared/src/roles.ts`

| Permission | jemish (Jemish — Owner, "J") | gaurang (Gaurang — Partner, "G") |
|---|---|---|
| `canSeeRate` | ✅ | ✅ |
| `canAddOrder` | ✅ | ❌ |
| `canSendToProduction` | ✅ | ❌ |
| `canUndoProduction` | ✅ | ❌ |
| `canManageMasters` | ✅ | ❌ |
| `canManageJobsheets` (create, edit, delete, print) | ✅ | ✅ |
| `canManageMachines` | ✅ | ✅ |

`DEFAULT_ROLE = 'jemish'`, `ROLE_HEADER = 'X-Role'`. Order visibility isn't a permission; it comes from each
status's `visibleTo`. `client/src/config/roles.ts` and `server/src/config/roles.ts` just re-export the shared file.

---

## 6. Design system

### Theme tokens (`client/src/index.css`, HSL channels, mapped in `tailwind.config.ts`)

| Token | Value | Hex / meaning |
|---|---|---|
| `--background` | 210 40% 98% | #F8FAFC page background |
| `--foreground` | 222 47% 11% | slate-900 text |
| `--card` / `--card-foreground` | white / 222 47% 11% | |
| `--primary` | 342 64% 33% | **#8B1E3F maroon** |
| `--primary-hover` / `--primary-active` | 342 64% 29% / 25% | darker shades |
| `--primary-soft` | 342 60% 96% | tinted backgrounds (active nav, chips, selection) |
| `--primary-foreground` | white | |
| `--accent` | 46 68% 47% | **#C9A227 muted gold** |
| `--accent-soft` / `--accent-foreground` | 46 80% 94% / 36 60% 20% | role tag, variation badge |
| `--muted` / `--muted-foreground` | 210 40% 96% / 215 16% 47% | |
| `--border` / `--input` | 214 32% 91% / 214 28% 86% | |
| `--ring` | = primary | focus ring (used at 40% alpha) |
| `--destructive` / `-soft` / `-foreground` | 0 72% 45% / 0 86% 97% / white | |
| `--radius` | 0.75rem (12px) | `rounded-lg`; inputs/buttons/dropdowns use `rounded-[10px]` |

Other theme settings:
- **Font:** DM Sans (Google Fonts, weights 400–700), with a system sans-serif fallback. `font-feature-settings: 'ss01'`.
- **Shadows:** `shadow-soft` (cards) and `shadow-pop` (popovers, modals, FAB).
- **Spacing:** `bottom-nav` = `4rem + safe-area`.
- **Utility classes:** `.page-container` (max 1920px, 16/24/32/40px gutters), `.pb-safe`, `.scrollbar-thin`.
- **Other:** `react-day-picker` is themed to primary with 40px days (36px under 380px). The number-input spinners
  are hidden. Status badge colours come from the status config, not from tokens.

### Formatting helpers (`client/src/lib/format.ts`)

- `formatDate` → `dd-MM-yyyy`
- `formatDateTime` → `dd-MM-yyyy, hh:mm a`
- `formatMoney` → `₹1,25,000.00` (en-IN)
- `formatQuantity` → `250 meters` (up to 3 decimals)
- `formatOrderNo` → `#N`
- `toApiDate` → `yyyy-MM-dd`

### Shared UI components (`client/src/components/ui/`)

| Component | Description |
|---|---|
| `button.tsx` — `Button`, `buttonVariants` | cva button; variants `primary`, `secondary`, `ghost`, `soft`, `destructive`, `link`; sizes `sm`, `md` (44px), `lg`, `icon`, `icon-sm`; `loading` shows a spinner and disables; `asChild` via Radix Slot. |
| `input.tsx` — `Input`, `NumberInput`, `Textarea`, `fieldBase` | Soft-grey rounded fields with a primary focus ring; `Input` supports `prefix`/`suffix`; `NumberInput` uses `inputMode="decimal"` and keeps a string value. |
| `field.tsx` — `Field` | Label (+ required asterisk) + control + inline error or hint. |
| `select.tsx` — `Select`, `MultiSelect` | **The standard dropdown**, used for every select. It's a Radix Popover the width of the trigger, with a chevron that flips and a primary border when open, and a check mark on selected items. Options: `searchable` combobox, `onSearchChange` for server search, `loading`, `emptyText`, `action` slot beside the trigger (➕). Keyboard: arrows, Home/End, Enter, Escape. The panel is capped to the viewport. |
| `modal.tsx` — `Modal`, `ResponsiveModal` | Radix Dialog with variants `center`, `right`, `bottom`, `fullscreen`; `size` sets the dialog width (center) or content width (fullscreen). Full-screen and right sheets get a back arrow on phones; `dismissible=false` blocks outside-click close. `ResponsiveModal` defaults to `fullscreen` on every breakpoint. |
| `confirm-dialog.tsx` — `ConfirmDialog` | Small centred confirmation with Cancel / Confirm (optionally destructive, with loading state). |
| `date-picker.tsx` — `DatePicker`, `DateRangePicker` | Popover + react-day-picker (weeks start Monday); the range picker has a clear ✕ and a Done button. |
| `image-thumb.tsx` — `ImageThumb`, `Lightbox` | Lazy thumbnail with a pulse placeholder and fallback icon; tapping opens a full-screen lightbox that loads the **full** image only then. |
| `image-upload.tsx` — `ImageDropzone`, `ImagePickButton`, `uploadImage`, `validateImage` | Client-side type/size check (10 MB) and upload to `/api/uploads`, with toasts on failure. The dropzone supports drag-drop and tap (camera/gallery); the pick button supports `multiple`. |
| `status-badge.tsx` — `StatusBadge` | Pill with a coloured dot; colours and label come from the status config. |
| `checkbox.tsx` — `Checkbox` | Radix checkbox in primary colours. |
| `dropdown-menu.tsx` — `DropdownMenu*` | Radix dropdown menu wrappers (used by the profile menu). |
| `tabs.tsx` — `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Radix tabs in a segmented-control style. |
| `tooltip.tsx` — `Tooltip`, `TooltipProvider` | Radix tooltip that also opens on tap for touch devices. |
| `empty-state.tsx` — `EmptyState` | Centred icon + title + description + optional action. |
| `skeleton.tsx` — `Skeleton` | Pulsing grey block. |

Other shared components:
- **`components/list-parts.tsx`:** `SearchBar` (search input with clear ✕), `LoadMore` (infinite-scroll sentinel,
  "Load more" fallback button and "Showing X of Y"), `ErrorState` ("Couldn't load this" + Retry), `Fab` (phone-only
  floating + above the bottom nav), `FetchingIndicator` (small spinner).
- **Layout (`components/layout/`):** `AppLayout` (sidebar/rail + top bar + bottom nav), `ProfileMenu`, `RoleTag`,
  `Avatar`, `Logo`, `PageSkeleton`, `PageTitleProvider` / `usePageTitle`, `NAV_ITEMS`.
- **Feature-level reusables:** `MasterToolbar` / `MasterList` (table on md+, cards on phone, row actions, all states),
  `useDeleteFlow` (confirm + soft delete), `DesignCard` / `DesignGridSkeleton`, and `useCodeAvailability` /
  `designCodeField`.

---

## 7. Differences from the original spec (`rivoora-claude-code-prompt.md`)

### Data model / naming

| Spec | Current code |
|---|---|
| Variation `code` "auto-generated" as design code + `N` + number, "shown read-only", generated on the server | **Typed in by the user** when adding a variation. `variationCode()` only supplies the placeholder (and seed codes). `variation_no` is still auto-assigned. Variation codes are **not** renamed if the design code changes. |
| Design code unique among designs | Design codes **and** variation codes share one namespace (checked in app code); codes are normalized (upper-case, spaces removed, `A-Z0-9_-/.` only). |
| designs: `code, name, image_url, thumb_url, notes` | **Added `designs.material_id`** (optional default material, migration 0001). Picking such a design on a new order pre-selects the material. Deleting a material unlinks it from designs. |
| Indexes listed in §5 | All present. **Extra:** partial unique indexes for material name / design code, `orders_design_idx`, `design_variations_code_idx`, `design_variations(design_id, variation_no)` unique, `designs_material_idx`. |
| Thumbnail "~300px" | 320×320 (cover crop). |
| Customer phone "10-digit Indian number" | Stricter: must start with 6–9 after `+91`/`0` is stripped. |

### UI flow changes

| Spec | Current code |
|---|---|
| Orders on desktop: **table** (Order No, Client, Date, Quantity, Status, Quality, Action), sticky header; cards only on mobile | **Card grid on every breakpoint** (1–5 columns). No table. |
| Order cards: `#N`+status, client, material · qty, date, action | Adds a **64px design thumbnail + design/variation code**; details in a labelled 2-column grid. |
| Search: client, quantity, order no, material | **Also searches design and variation codes**; a leading `#` is ignored. |
| Filters: modal on desktop, **bottom sheet on mobile** | **Full-screen dialog on every breakpoint.** The Status filter is hidden when the role can see only one status (Gaurang). |
| Master add/edit forms: modal on desktop, full screen on mobile | **Full screen on every breakpoint** (content centred at a readable width). Confirmations stay small centred dialogs. |
| Saved designs drawer: right drawer on desktop, full screen on mobile | As specified, but the right drawer starts at **md (768px)**, so tablets get it too. |
| Master lists: desktop table / mobile cards | Tables start at **md (768px)**, so tablets use the table too. **Designs** use a thumbnail grid on every breakpoint. |
| Add Order: sticky bottom bar with Save + Cancel | As specified, **plus** a duplicate "Save order" button in the header on md+. |
| Add Order ➕ opens the Add Customer flow and returns | Implemented as the same `CustomerFormDialog` opened on top of the Add Order page (no navigation), so the form state is kept. |
| Uploaded design: ask for a design code | Adds a **live availability check** of the code while typing. |
| Previous-orders tab "paginated / infinite scroll" | Not paginated: max 60 items. Search is client-side. Items show a "N×" times-used count. The library tab is paginated. |
| Order details: order no, status, client name/phone, material, design, qty, rate, date, notes, note images, created, sent-to-production, history | All present. **Also shows** client city, material code, "Variation of <design>" line, the role that made each history change, and date **and time** for created/sent. |
| Select all pending | Selects only pending orders **on pages already loaded**, not all pending orders on the server. |
| Tablet sidebar "collapsible" | Icon rail that expands; the state is remembered in localStorage. |
| Masters: open a row | Clicking a customer/material opens its edit form (Jemish) or a read-only details form (Gaurang). Designs have a dedicated detail route `/designs/:id`. |

### Added features (not in spec)
- Design default material (see above) and the material shown on design cards and detail.
- `GET /designs/check-code` and live code checks (Add Order upload, variation form).
- URL-persisted order filters; back navigation keeps the list state.
- Role switch shows a toast and navigates to `/orders`; the router re-mounts per role.
- The `RouteError` page detects a stale-deploy chunk error.
- `Button` has `soft` and `link` variants.
- `GET /api/health`.
- In production, the Express server serves the built client.

### Removed / not implemented from spec
- **Optimistic updates:** the spec asked for them "where safe". Send-to-production only patches the cache **after**
  the server responds; there are no true optimistic updates.
- **Bottom-sheet variant:** exists in `Modal` (`variant="bottom"`) but nothing uses it.
- Everything else in the Sprint 1 checklist is present.

---

## 8. Known issues, TODOs and shortcuts

### 8.1 Repository state
- **Uncommitted work in the tree:** design default material, typed variation codes, the variation form, and
  orders/drawer tweaks (15 modified files, `+292/−96`). Also untracked: `client/src/features/masters/designs/variation-form.tsx`,
  `server/drizzle/0001_curious_mulholland_black.sql` and `server/drizzle/meta/0001_snapshot.json`. Commit these
  together (migration + code) and make sure `npm run db:migrate` has been run against Turso.
- No automated tests, no ESLint/Prettier setup (the code has `eslint-disable` comments, but ESLint isn't installed).
- `CLAUDE.md` says "desktop ≥1024 … master lists still use tables". In the code, master tables start at **768px**.

### 8.2 Not built yet (planned for next sprints)
- Login/auth: the role is just a client-chosen `X-Role` header, so **anyone can impersonate any role** by setting
  it. There is no CORS config or rate limiting.
- Statuses after Ready for production (In production … Completed) and their transition endpoints.
- Further order actions: **no edit or delete of orders** (and no UI or endpoint to change an order's
  design/quantity after creation).
- Voice notes: the mic icon is a placeholder (tooltip "Voice notes coming soon"). This is the only "coming soon"
  marker in the code; there are no `TODO`/`FIXME` comments.
- **Orphaned uploads are never cleaned up:** images uploaded then abandoned (form cancelled, image replaced or
  removed, design soft-deleted, variation hard-deleted) stay on disk.
- No endpoint or UI to **edit a variation** (image or code); you have to delete it and add it again (only if unused).

### 8.3 Shortcuts / risks in the current implementation
- **Order number race:** `MAX(order_no)+1` runs inside the transaction, with a unique index as the backstop. Two
  truly concurrent creates could collide; the loser gets a generic **409 "A record with the same value already
  exists"**. There's no retry.
- **Variation / design code uniqueness across the two tables is app-level only.** Concurrent requests could create
  duplicates, because there's no DB constraint on `design_variations.code`.
- The generic UNIQUE-constraint handler in `middleware/error.ts` hides which field conflicted (no `field` in the
  response).
- **Uploads are stored on local disk** (`server/uploads`). They aren't in git or the DB, so moving or redeploying
  the server loses user images. There's a driver interface ready for R2/S3 (`server/src/storage/index.ts`).
- **HEIC/HEIF** are accepted by the filter, but they only work if the installed sharp/libvips supports HEIF;
  otherwise the user gets "This image could not be read…".
- `previous-designs` isn't filtered by the caller's role or status visibility (Gaurang could see designs from a
  client's pending orders through this endpoint, though not the orders themselves). The UI only calls it from the
  Add Order page (Jemish).
- `design-form.tsx` (design edit/create) has no live code check; the conflict shows only after submit (409 inline).
- The lookup endpoints return at most 30 customers / 50 materials with no paging. Beyond that, users must type to
  search.
- `drizzle.config.ts` loads `.env` from the current directory. That works through `npm run db:generate`
  (cwd = `server/`), but not if drizzle-kit is run from the repo root directly.
- Deleting a variation doesn't check whether its parent design is soft-deleted (harmless: the design page 404s first).
- `order_status_history` has both `changed_at` and `created_at` (redundant).
- Rate is visible to both current roles by config. Any new role must keep `canSeeRate: false` unless allowed; the
  list endpoint never returns rate regardless of role.

---

## 9. Sprint 2 — Machines + jobsheets

Spec: `rivoora-sprint2-jobsheets-prompt.md`. Built in one go (no plan-approval stop, at the user's request).

### Data
- `machines`: `machine_no` (int ≥1, unique among non-deleted via `machines_machine_no_active_unique`), `name` ≤80, `notes`,
  `is_active`, `is_deleted`. Seed adds machines 1–12 when missing.
- `jobsheets`: `jobsheet_no` (UNIQUE, global, never reused), `order_id` (indexed), `frames`, `picks` ≤20 text,
  `created_by` role, `is_deleted`. `jobsheet_machines (jobsheet_id cascade, machine_id)` composite PK + machine index.
- `counters (name PK, value)`: numbers are reserved with an upsert `value = value + n RETURNING value` inside the write
  transaction (verified: create 3, delete the last, create 1 → the new one gets the next number, not the deleted one).
- `orders.jobsheet_pieces`, `target_frames` (default 0) and `frames_per_jobsheet` (nullable) = the order's jobsheet plan.

### Shared logic (`shared/src/jobsheets.ts`, tests in `jobsheets.test.ts`)
`planJobsheets` (7.1), `planFramesEdit` (7.4 auto-adjust: last absorbs −delta; splits into new jobsheets of ≤F when it grows
past F; only the last is removed when it drops to ≤0; F = null → just grows; editing the last changes nothing else),
`coverageWarnings` (7.5, none while an order has 0 jobsheets), `jobsheetQuantityWarning`, `remainingPieces`,
`describeFrameGroups`. `SECTIONS_PER_BEAM` is in `shared/src/production.ts`. `MAX_JOBSHEETS_PER_RUN = 500` guards typos.

### API (see CLAUDE.md for the list)
Services in `server/src/services/jobsheets.ts` and `machines.ts`. Generate, single add, edit+adjust and delete(+plan reset
+ status back) are each one transaction. Lists are one query (jobsheets ⟕ machines, grouped in JS); details/print use
`db.batch`. Status: first jobsheet on a Ready order → `jobsheet_created`; last active jobsheet deleted → plan reset and
back to `ready_production` (history written with the role). Undo send-for-production returns 409 while jobsheets exist.

### Screens
- **Machines** (`/machines`, nav item after Designs, `Factory` icon): `MasterList` table (Machine No, Name, Status pill,
  Notes) / phone cards; full-screen form (number*, name, Active switch — new `components/ui/switch.tsx`, notes).
  `useDeleteFlow` got an optional `options.description`. Bottom nav now has 5 tabs (labels fit at 360px).
- **Order details → Jobsheets card** (only Ready or later; non-pcs → "coming soon" EmptyState): Create jobsheets /
  Add single jobsheet / Print all, 5 stat tiles, amber warnings, then a **card grid** (jobsheet number, status badge —
  "Pending" by default from `JOBSHEET_STATUSES`, frames, picks, machines). Cards have no date or icons; tapping one
  opens the details page. On desktop the card sits in the left column under Dates (beside Status history); on
  phone/tablet it comes right after Order details. Undo send is hidden when `jobsheetCount > 0`.
- **Create jobsheets** / **Add jobsheet** full-screen forms with live preview + quantity warning (shared functions).
  Machines use `MultiSelect` (client-side search over active machines) plus removable chips.
- **`/jobsheets/:id`**: back link to the order, Print / Edit / Delete, coverage warnings, details (incl. status) + design
  cards, 404 state.
  **Edit** dialog shows "What will change" from `planFramesEdit` and toasts each server change.
- **`/print/jobsheets?ids=`** (outside the layout): sticky Back/Print toolbar, grey A4 preview scaled to the screen width,
  Print waits for all images + Noto Sans Devanagari. 2 pages per jobsheet (front form + design back with code and a
  small "Jobsheet N" tag; "No design attached" when there's none).

### Verified
API flows exercised with curl against a local SQLite copy (generate, single, edit with adjust/split/remove, delete + reset,
number reuse, 404/409 cases, Gaurang visibility). UI checked in Chrome at 1280px and at 360px (no horizontal overflow on
orders, order details, machines, jobsheet details, print preview). **Not verified:** a real printout from Chrome
desktop / Android (check the A4 pairs on paper once).

### Known gaps
- `frames_per_jobsheet` is only set by multi runs; single adds don't change it.
- Deleting a jobsheet leaves `jobsheet_pieces` / `target_frames` unchanged unless it was the last one (by spec).
- Machine dropdown shows up to 200 active machines (client-side search).

---

## 10. Sprint 3 — Supervisor, machine production flow, Machine view

Spec: `rivoora-sprint3-supervisor-prompt.md`. Built in one go at the user's request (no plan-approval stop).

### Data (migration `0003_jobsheet_workflow.sql`)
- `jobsheets` + `status` (default `pending`, indexed; existing rows backfilled as pending), `sent_at`, `started_at`,
  `completed_at`, `running_machine_id` → machines (indexed), `completed_frames`, `parent_jobsheet_id` → jobsheets,
  `suggested_machine_id` → machines.
- New `jobsheet_events` (`jobsheet_id` cascade + index, `event`, `machine_id`, `frames`, `note`, `role`, timestamps).
  The migration also inserts a `created` event for every existing jobsheet so their Activity isn't empty.
- **Not yet applied to Turso** — run `npm run db:migrate` (additive only: one new table, new nullable/defaulted columns).

### Config
- Order status `ready_production` is now labelled **Jobsheet pending** (key unchanged). New `in_production` (40, sky)
  and `production_completed` (50, teal), visible to Jemish + Gaurang.
- `JOBSHEET_STATUSES`: pending (slate) · sent ("Sent to supervisor", amber; supervisor label "Pending") · ongoing (blue)
  · completed (green). `jobsheetStatusLabel(status, role)`; `StatusBadge kind="jobsheet"` uses it.
- Role `supervisor` ("Supervisor — Production", initial S, landing `/jobsheets`). Permissions added:
  `canViewOrders`, `canViewMasters` (jemish/gaurang ✅, supervisor ❌ — used to lock him out of order and master
  endpoints), `canViewJobsheetsModule`, `canRunJobsheets` (supervisor only), `canPrintJobsheets`, `canViewMachineView`
  (all three). Every role has a `landing` route.

### Shared logic (tests in `jobsheets.test.ts`, 18 new)
- `planFramesEdit` only adjusts Pending jobsheets (last = highest-numbered Pending; refuses a non-Pending edit).
- `effectiveFrames` / `coverageFrames`: Completed jobsheets count `completed_frames`.
- `orderStatusForJobsheets(statuses)` — the pure rules behind the server's `recomputeOrderStatus`.
- Change machine: `MAX_FRAMES_PICK = 100`, `nextFramesMax`, `remainingFrames` (≥1), `nextFramesAfterCompletedChange`
  (prefill follows "completed" until the user picks), `changeMachineSummary`, `completedFramesNote`.

### Server
- `recomputeOrderStatus(orderId, role, tx)` in `services/jobsheets.ts`, called at the end of generate / single add /
  edit / delete / send / pull back / start / complete / change machine. History only on a real change; never touches
  pending_production orders.
- Edit / delete: 409 unless Pending ("…Pull it back from the supervisor first."). Auto-adjust updates are conditional on
  the last jobsheet still being Pending.
- New endpoints: `POST /orders/:id/jobsheets/send`, `POST /jobsheets/:id/pull-back|start|complete|change-machine`,
  `GET /jobsheets` (supervisor list + tab counts, one batch), `GET /machine-view`. `GET /jobsheets/:id` is role-aware and
  now returns status fields, running machine, parent/children, events and `design`; for the supervisor `order`,
  `coverage` are null and `siblings` empty. Print is allowed for the supervisor (Sent/Ongoing/Completed only).
- Change machine refuses completed > assigned (400 `completedFrames`) and the same machine (400 `newMachineId`).
- Supervisor lockout: `router.use(requirePermission('canViewOrders'|'canViewMasters'))` on orders, customers,
  materials, designs, machines; customer/material lookups also need `canViewMasters`.

### Client
- Nav: Machine view after Orders for Jemish/Gaurang; the supervisor sees Jobsheets + Machine view only. Phone bottom
  nav: main items + **More** (bottom sheet listing the masters) — 3 tabs for Jemish/Gaurang, 2 for the supervisor.
  `RequirePermission` guards every route (redirect to the role's landing).
- Order details → Jobsheets card: ⬆ "Send to supervisor" icon (disabled with tooltip when nothing is Pending) →
  selection mode (only Pending selectable, banner, action bar "N selected · Select all pending · Cancel · Send for
  machine production (N)" / "Send (N)" on phones, Escape exits) → confirm → toast. Cards: status badge, actual/assigned
  frames (amber when short), "Running on Machine 7", "continued from 319". Tiles: + **Completed X of Y**. Card grids
  use `auto-fill` columns so they fit the narrow desktop column.
- Jobsheet details: Pull back (Sent), Edit/Delete (Pending only), supervisor actions (Start / Complete / Change
  machine), running machine + started time, continued from/as links, **Activity** timeline (`activity.tsx`).
- `/jobsheets` (supervisor): search (number or design code), tabs with counts (URL-kept), 1/2/3/4-col cards with a
  16:10 design image (lightbox), actions at the bottom (48px). Dialogs: Start (square machine chips, suggested
  pre-selected, "busy · 321" notes), Complete (− / number / + stepper, difference note), Change machine (three
  `Select`s + live summary; toast with a **Print** action for the new jobsheet).
- `/machine-view`: All / Running / Idle stat pills (filters), "Last updated hh:mm" + refresh, tile board 2/3/4/5/6 cols,
  pulsing green "Running" tiles with jobsheet rows (thumb, number, code, frames, running time; +N more), muted idle
  tiles ("since 3h"), collapsed "Inactive machines (N)". 30 s auto-refresh + on focus; times tick via `useNow`.
- Renamed texts: "No orders pending for jobsheets yet", send-for-production confirm, delete toast, server messages.

### Verified
- API: a 62-check script against a local SQLite copy (`TURSO_DATABASE_URL=file:…`, migrated + seeded) — supervisor
  403s on every order/master endpoint, 404 on Pending jobsheets, send/pull-back/409 rules, Pending-only auto-adjust,
  start/complete/change-machine incl. conditional-update 409s, actual-frame coverage, order status through
  jobsheet_created → in_production → production_completed without duplicate history, machine view, tab sorting/search.
- UI (Chrome, local dev): no horizontal overflow at 360 / 768 / 1024 / 1280 for all new screens as supervisor and
  Gaurang; redirects for forbidden routes; send selection flow; Start and Change machine dialogs end to end.
  **Not verified:** a real tablet/phone device, and printing the new jobsheet from the toast on paper.

### Known gaps / decisions
- "Select all pending" in the order Jobsheets card covers that order's jobsheets (all are loaded; no pagination there).
- Tab counts on `/jobsheets` respect the current search.
- A change-machine child's machine list is **all** active machines at that moment (by spec).
- Change machine keeps `jobsheet_pieces` / `target_frames` unchanged; any difference only shows as a coverage warning.
- The machine view shows every active machine in one response (no pagination) — fine for a mill-sized floor.

---

## 11. Sprint 4 — Taka entry role, QR scan, takas on orders

Spec: `rivoora-sprint4-taka-entry-prompt.md`. Built in one go at the user's request (no plan-approval stop).

### Data (migration `0004_takas.sql`, applied to Turso on 2026-09-30)
- New `takas`: `jobsheet_id` → jobsheets (index), `order_id` → orders (index, denormalized), `taka_no` TEXT (index,
  **not unique**), `is_damaged` (default 0), `damage_type` (`machine` when damaged), `entered_by` (role),
  `is_deleted`, timestamps. Partial unique index `(jobsheet_id, taka_no) WHERE is_deleted = 0`.
- `jobsheets.taka_note` (nullable). Event kinds `takas_entered` / `takas_edited` (`note` = "3 takas (1 damage)" + edit details).

### Config
- Role `taka_entry` ("Taka entry", title "टाका एंट्री", initial T, landing `/scan`, `bilingual: true`). New permissions:
  `canUseTakaModules`, `canEnterTakas` (taka_entry only), `canEditTakas` (Jemish, Gaurang), `canViewTakas` (Jemish,
  Gaurang, taka_entry). Every other permission is false for taka_entry.
- Jobsheet statuses: taka_entry sees all four (Pending included). Order status `taka_entry_done` (60, purple), Jemish + Gaurang.

### Shared logic (`shared/src/takas.ts`, tests in `takas.test.ts`, 18 new)
- `validateTakaNumbers(values, existing, { ignoreEmpty })` → per-row `required | digits | too_long | duplicate |
  already_entered`; `TAKA_ERROR_TEXT` (English + Hindi); `cleanTakaNo`, `takaSummary`, `compareTakaNo`.
- `jobsheetQrUrl(base, no)`, `parseJobsheetQr(text)` (http/https, any host, path exactly `/j/<digits>`).
- `orderStatusForJobsheets` now takes `{ status, takaCount }` items (strings still work): all Completed + each ≥1 taka
  → Taka entry done. Zod: `takaEntrySchema`, `takaEditSchema`, `takaListQuerySchema`.

### Server
- `recomputeOrderStatus` reads each active jobsheet's active taka count (`activeTakaCount` correlated subquery).
- `services/takas.ts`: `enterTakas` (validate vs existing, insert, append note, auto-complete if not Completed —
  completed_frames = frames, conditional update on the current status, `completed` event "completed at taka entry",
  `takas_entered` event, recompute), `editTakas` (replace-set: update / soft-delete / insert, two-phase renumbering,
  adding only on Completed jobsheets, `takas_edited` event, recompute), `listOrderTakas`, `listTakaJobsheets`.
- `GET /jobsheets/:id` adds `takas` + `takaNote` (null for roles without `canViewTakas`; taka events filtered for them).
- New: `GET /jobsheets/by-no/:no`, `POST|PUT /jobsheets/:id/takas`, `GET /taka/jobsheets`, `GET /orders/:id/takas`.
  `GET /lookup/machines` now needs `canViewMasters` or `canRunJobsheets` (was open to every role).
- `jobsheetSearch()` extracted from the supervisor list and reused by the Taka list.

### Client
- Section 0: the order Jobsheets card's "Send to supervisor" now starts with all Pending jobsheets selected.
- Bilingual helper `lib/bilingual.tsx` (`bi`, `<Bi>`, `useBilingual`); Noto Sans Devanagari loaded globally; nav items
  have `hi` labels (sidebar + bottom nav show both lines); `LoadMore` has a `bilingual` prop.
- `/scan`: qr-scanner (dynamic import; back camera; square guide = default 2/3 scan region; torch toggle when
  supported; vibrate + green tick on success; red "not a Rivoora jobsheet QR" and keeps scanning), friendly bilingual
  messages for insecure http / denied / no camera / other errors (+ admin note for http, Try again), manual number entry.
- `/j/:jobsheetNo`: resolves via `by-no`, redirects to `/jobsheets/:id` (all roles); bilingual not-found for taka_entry,
  "isn't available" for the supervisor.
- `/jobsheets` (taka_entry): supervisor-style cards, tabs Taka pending / Done with counts, search, "3 takas · 1 damage",
  Enter taka / Add more takas buttons.
- `/jobsheets/:id` (taka_entry): identity card, not-completed info note, Already entered chips, 6 big numeric fields +
  Damage toggles, Add more, note + disabled mic, sticky Submit, confirm dialog, success screen, secondary details.
- Order details: Takas card (summary, All / Damaged only, groups per jobsheet, Edit takas). Jobsheet details: Takas
  block + Edit. Activity shows "Takas entered — 3 takas (1 damage)" / "Takas edited".
- Print: QR (`qrcode` SVG, level M, 28 mm, "Scan · N") top-right beside the number box; Print waits for the QR codes;
  amber non-printing warning when `VITE_PUBLIC_APP_URL` isn't set (`client/.env.example`, README).
- Supervisor run mutations invalidate everything on a 409 (e.g. jobsheet completed at taka entry meanwhile).

### Verified
- API: a 41-check script against a migrated + seeded local SQLite copy — taka_entry 403 on orders / masters / lookups /
  machine view / supervisor list / order takas; by-no per role (supervisor 404 on Pending); validation (duplicates in the
  request, already entered, digits); auto-complete from Pending and Ongoing (supervisor Complete then 409, machine freed on
  the board); note append; supervisor sees no takas / taka events; order status in_production → taka_entry_done →
  production_completed (all takas removed) → taka_entry_done → in_production (new jobsheet); edit swap / remove / add;
  edit 403 for taka_entry + supervisor; list tabs, sorting, counts.
- UI (Chrome, local dev against the SQLite copy): scan screen, manual entry → `/j/3` → entry screen, duplicate error,
  damage toggle, confirm, success; list, order Takas card, jobsheet Takas block + Activity, edit form; 360px layouts of
  the three Taka entry screens; print preview QR placement and decoding the QR back to `/j/3`. No console errors.
- **Not verified:** a real phone camera scan over HTTPS, and scanning a paper printout (needs an HTTPS deployment or
  tunnel and a printer). Tablet 768px layouts were not re-checked beyond the shared card grid.

### Known gaps / decisions
- Taka numbers are compared as exact text (`0047` ≠ `47`).
- Adding takas through the office edit form is only allowed on Completed jobsheets (entry via the Taka entry role
  completes the jobsheet itself); removals / renumbering work in any status.
- An entry on a Pending (never sent) jobsheet completes it too, as the spec says "if not Completed".
- `completed_at` from taka entry = submit time; `started_at` stays empty for jobsheets that never started.
- The Taka list shows all jobsheets of every order (no order-status filter), since only ready-or-later orders have jobsheets.

---

## 12. Sprint 5 — Order dashboard (order details page)

Spec: `rivoora-sprint5-order-dashboard-prompt.md`. Built in one go at the user's request (no plan-approval stop).

### Data (migration `0005_takas_stage.sql` — **not yet applied to Turso**, run `npm run db:migrate`)
- `takas.stage` text NOT NULL DEFAULT `entered` + index `takas_stage_idx`; existing rows backfilled to `entered`.
  Nothing writes it yet — later sprints move takas through `at_butta → butta_qc → butta_done → at_mill → mill_qc → ready`.
- `Taka` DTO now carries `stage`. `OrderDetail` now carries `jobsheetPieces` (header "Jobsheet quantity").

### Config (`shared/src/pipeline.ts`)
- `MAIN_STAGES` (production · butta · mill · ready, colour, unit, `connected`), `SUB_STAGES` (key, label, mainStage, unit,
  colour, `connected`, `takaStages`), `TAKA_STAGES`, `jobsheetSubStage(status, takaCount)` (the Production rules),
  `DAMAGE_TYPES` / `DAMAGE_TYPE_CONFIG` / `DAMAGE_TYPE_LABEL` (machine · butta · mill — moved here from `takas.ts`),
  `ALERT_NOT_STARTED_HOURS = 24`, `ALERT_RULES`, `formatHours`.
- Only Production and Machine damage are `connected: true`. **To connect later** — see CLAUDE.md "Order dashboard".

### Shared logic (`shared/src/orderDashboard.ts`, tests in `orderDashboard.test.ts`, 11 new → 66 total)
- `buildOrderDashboard({ order, jobsheets, takas }, now)` — pure; takas may be aggregated rows with a `count`.
  Output: progress (woven frames/pcs vs jobsheet quantity, else order quantity), bar shares in frames per main stage,
  main-stage counts (Production = jobsheets, others = takas) + damaged, sub-stage counts + facts (frames, machines on
  loom, oldest sent, jobsheets the takas come from), production totals, damage counts per type, alerts, default stage.
- Bar shares: a jobsheet with no takas counts fully in Production; otherwise its frames (actual frames once Completed)
  are spread over its takas' main stages by taka count (`entered` = Production).
- Alerts: `not_started` (Sent and `sent_at` > 24 h ago, strictly) + the existing coverage warnings (same texts).

### Server (`server/src/services/dashboard.ts`, routes in `routes/orders.ts`)
- `GET /orders/:id/dashboard` — one `db.batch` (order, jobsheets, takas grouped by jobsheet/stage/damage) → `buildOrderDashboard`.
- `GET /orders/:id/dashboard/items?sub=` — jobsheet rows (filtered by `jobsheetSubStage`) or takas grouped by jobsheet.
- `GET /orders/:id/damages?type=` (`canViewTakas`) — damaged takas (+ jobsheet, stage, taka note) and counts per type.
- All behind `canViewOrders` and the order-status visibility (404), like `GET /orders/:id`.

### Client (`client/src/features/orders/dashboard/*`, page `order-details-page.tsx`)
- Page = back link → `OrderHeader` (clickable design thumb → Lightbox, `aria-label="View design image"`; placeholder when
  no image; detail grid 2 cols + "More details" on phones, 4/6 cols on md/xl; Undo send for production) → tabs
  **Dashboard · Jobsheets (n) · Takas (n) · Damages (n, red) · Order details · History**. Phones: scrollable pill row.
- URL state (`view-state.ts`, `useOrderView`): `?tab=&stage=&sub=&type=`, history `replace`, so Back from a jobsheet restores the view.
- Dashboard tab (`dashboard-tab.tsx`): progress card (pcs woven, stage bar + legend, %, "N need attention" → scrolls to
  `#needs-attention`), 4 main-stage buttons (2×2 on phones, chevrons between on md+), summary line, sub-stage KPI buttons
  (toggle), detail panel (table on md+, cards on phones; taka groups with chips), damage strip (→ Damages tab filtered),
  Needs attention card. Special cases: Pending for production → "Not sent for production yet" + Send for production;
  no jobsheets → "No jobsheets yet" + Create jobsheets (opens the existing dialog); non-pcs → "coming soon" in Production.
- Damages tab (`damages-tab.tsx`): tiles per type + total, filter pills (URL `type`), damaged taka cards; **Edit takas**
  opens the existing `EditTakasDialog` for that jobsheet (data from `useOrderTakas`).
- Jobsheets / Takas tabs render the existing `OrderJobsheetsSection` / `OrderTakasCard` unchanged; Order details tab =
  Notes, Dates (+ last updated), Design; History tab = the status timeline.
- Query keys `['order-dashboard', orderId, 'summary' | 'items' | 'damages', …]`; summary refetches every 60 s and on
  focus; `invalidateAfterWrite` (every jobsheet / taka mutation) and send / undo production invalidate `['order-dashboard']`.

### Verified
- `npm run typecheck`, `npm test` (66), `npm run build` pass.
- API against a migrated + seeded local SQLite copy: generate → send → start → taka entry (1 damaged) → dashboard counts,
  bar, sub-stages; `sent_at` moved back 33 h → `not_started` alert; items for `with_supervisor`, `taka_done`, a
  not-connected sub (empty, `connected: false`), invalid sub (400); damages all / machine / butta; supervisor 403; Gaurang
  404 on a Pending-for-production order.
- **Not verified in a browser** (the user asked not to use Chrome this sprint): the 360 / 768 / 1024 / 1280 layouts,
  Lightbox on phones, and the moved Jobsheets selection mode should get a manual pass.

### Known gaps / decisions
- Main-stage "pcs" for later stages = that stage's frame share × `SECTIONS_PER_BEAM` (takas have no piece count).
- Woven = actual frames of Completed jobsheets only (Ongoing jobsheets have no partial count).
- The coverage warnings show both in the Needs attention card and (unchanged) in the Jobsheets tab.
- Damages "Recorded" = the taka's `created_at` (there is no separate damaged-at timestamp).

---

## 13. Sprint 6 — Client demo feedback

Spec: `rivoora-sprint6-demo-feedback-prompt.md`. The look and patterns were kept; only the requested changes were made.
`npm run typecheck`, `npm test` (89 shared tests) and `npm run build` pass. The API flows (brokers, order type, damages,
taka pcs / number format / damage names, supervisor Order view, role restrictions — supervisor and Taka entry never get
the client name) were verified with a throwaway script against a local libSQL file DB, and the main screens in Chrome.
**Not yet done:** a real-phone check (Android + iPhone) of the taka keypad and the – / keys, and a physical printout.

### Migration 0007 (`0007_sprint6_brokers_order_type_damages.sql`) — run `npm run db:migrate` on Turso
| Table / column | Notes |
|---|---|
| `customer_brokers` | id, customer_id (FK, indexed), name (≤ 80), is_deleted, timestamps; UNIQUE `(customer_id, lower(name)) WHERE is_deleted = 0` |
| `orders.broker_id` | FK → customer_brokers, nullable, indexed |
| `orders.order_type` | `lump` \| `pcs_to_pcs`, NOT NULL DEFAULT `pcs_to_pcs` (existing orders backfilled) |
| `takas.pcs` | INTEGER, nullable (older takas); the API requires 1–9999 on new / changed takas |
| `damages` | Damage master: id, name (≤ 80), notes, is_deleted, timestamps; UNIQUE `lower(name) WHERE is_deleted = 0` |
| `takas.damage_id` | FK → damages, nullable, indexed (older damage has none → shown as "Machine damage") |

The seed adds demo brokers to three customers (only when they have none). No damage seed data.

### What changed
1. **Order number first.** `jobsheetRef()` "Order #26 (319)" / `jobsheetRefShort()` "#26 (319)" in shared; `<JobsheetRef>`
   on the client (order number bold, bracket small + muted). Used on the order Jobsheets cards, jobsheet details (title,
   parent/children, toasts), supervisor cards / dialogs / toasts / busy hints, Activity ("continued as #26 (331)" — older
   notes are reworded at display time), Taka list, Taka entry identity card / confirm / success, Takas card + Edit
   takas, dashboard drawer + alerts, Damages tab, Machine view, print. Every jobsheet response carries `orderNo`.
   Jobsheet searches (supervisor, Taka list) match order no or jobsheet no (prefix) or design; leading `#` ignored.
   `jobsheet_no`, the QR (`/j/<jobsheetNo>`), `by-no` and the Scan screen's typed number are unchanged (the Scan screen
   now hints "the number in brackets").
2. **Brokers.** Customer form: Brokers section (rows = editable names with remove, input + Add broker; duplicates blocked
   inline and by the server as `brokers.<i>.name`). Customer list: Brokers column + phone card line; search matches brokers.
   Order form: Broker select after Client name (disabled until a client is picked, "No brokers for this client",
   cleared when the client changes). Header + Order details tab + order cards show it; order search matches it.
3. **Order type** (required, not linked to the unit): segmented Lump / Pcs to pcs on the order form (nothing
   pre-selected), tag on order cards + header, Order details tab, filter `type=` with chips. `DEFAULT_UNIT = pcs`.
4. **Taka pcs + number format.** Rows: number → meters → pcs → Damage (phones: number, then meters + pcs, then Damage).
   Numbers `^\d+([-/]\d+)*$` ≤ 15; the – / helper keys appear under the focused number field only (`inputMode="numeric"`).
   Chips "6245 · 105.5 m · 12 pcs" ("— pcs" for older takas), Total pcs tile, event summaries and dashboard facts with pcs.
5. **Damage master** (`/damages`, nav "Damage master" in the masters group; `canManageDamages` for Jemish + Gaurang) and the
   **damage popup** (`DamageDialog`, Taka entry + Edit takas; master name or "Other / अन्य" + typed name; damaged rows offer
   Change / Remove). "Machine damage · Hole" everywhere a damaged taka shows; the Damages tab cards show the name large.
6. **Print**: one page per jobsheet, number box "ORDER 26 (319)", QR caption `Scan · 26 (319)`, "Assigned: 7, 9" above an
   empty LOOM NO box; back page, its CSS and the image wait removed.
7. **Supervisor**: `ongoing` = "On-loom" for him only (tab + empty state "Nothing on-loom right now"). `/jobsheets` has an
   `Order | All` toggle (`?view=all`, default Order): order cards (design, Order #N, design code, Pending / On-loom /
   Completed pills, progress bar, View jobsheets (N)) → `/jobsheets/order/:orderId` (header + the same list component
   filtered by `orderId`). API `GET /jobsheets/orders` (one GROUP BY query) and `GET /jobsheets?orderId=`.
8. **Dashboard labels**: `not_sent` "Not assigned to supervisor", `with_supervisor` "Waiting to start on loom".


---

## Sprint 7 — Butta cutting (done)

See the "Butta cutting (Sprint 7)" section and the Sprint 7 database note in CLAUDE.md. Summary: global unique taka numbers (migration stops on duplicates), Design butta flag, damages list per taka (+ pcs, resolve at QC), taka stages/events, Butta parties master, Butta cutting module (Send: pending order cards → takas drawer → challan GSM-n with party/date/eway; In butta cutting list; Receive: Taka number screen with undo + live Challans), challan details (cancel, tick-to-receive), challan print (A4 landscape, 48 takas/page), Butta QC role (bilingual), Godown supervisor role, order statuses In butta cutting / Ready for mill, order details additions (stage dots + filter, taka drawer + history, Show resolved).

Verified: typecheck (all packages), 123 shared tests, a scripted API flow on a local libSQL file DB (migration with legacy data incl. duplicate stop, send/receive/undo/cancel/QC, restricted-role 403s) and a short browser check of Send, challan print and the QC screen. Not yet done: printing a challan on real paper, 360 px / tablet visual pass of every new screen, a run against the live Turso DB (run `npm run db:migrate` yourself — it lists duplicate taka numbers first if any exist), seeding demo butta data.

---

## 14. Sprint 8 — Mill, generic challans, partial damage resolve, damage images, Docs tab

Current as of 2026-10-06; supersedes earlier butta notes. Details live in `CLAUDE.md` → "Sprint 8". Summary:
migration `0009_sprint8_mill.sql` (butta challans moved into generic `challans` / `challan_takas` with a count check;
`mill_parties`, `taka_damage_images`, `taka_damages.resolved_pcs`, `taka_events.taka_damage_id`); Mill module and Mill
parties master built from the butta components with a `kind` prop; order statuses In mill / Received from mill;
dashboard bar in pcs and Completed / Skipped stage cards; Butta QC Resolve popup with pcs + damage photos; order Docs
tab; damage details screen. `npm test` (shared): 144 tests. NOT yet run against live Turso — run `npm run db:migrate`
there first (it prints the before/after challan counts).

## Sprint 9 (done)
Mill QC role, refinish loop back to the mill, godown Orders module (final takas, tick, actual pcs, split, Ready to dispatch, Damage tab), new stages/statuses/damage type, dashboard + Takas tab additions. See the Sprint 9 section of CLAUDE.md. Run `npm run db:migrate` on Turso to apply 0010. Not done: dispatch itself, a full Inventory module, real-device check of the new phone screens.

## Sprint 10 (done) — Inventory
Inventory module (All designs / Damaged, item + damaged-item details, demo stock-clearance card) and the godown order pcs KPIs + Damage tab state badges and filters. See the Sprint 10 section of CLAUDE.md. `npm test`: 173 shared tests; typecheck clean. Verified on a local file DB with hand-seeded takas (numbers hand-checked) and desktop browser screenshots. Not done: 360 / 768 px screenshot pass (the browser window could not be narrowed), real-phone check, stock wipe-out flow (`lastClearedAt` is null).


---

## Sprint 11 (done, uncommitted) — post-demo changes, current as of 2026-10-14

Details live in `CLAUDE.md` → "Sprint 11". `npm run typecheck` clean, `npm test` (shared): 173 tests passing. API flows verified on a local libSQL file DB; **no browser / real-device check yet** of the new screens.

**Supervisor (production)**
- Jobsheet cards: quality, all assigned looms ("Assigned looms"), white print button top-right of the design image. Start dialog button is **Start & print** (starts, opens the print preview; preview has **Close**). Print page shows the order type (Lump / Pcs to pcs) under Design no.
- Change machine: no machine picker any more (`POST /jobsheets/:id/change-machine` = `{completedFrames, nextFrames}`); "Frames to make next" prefills with the remaining frames.
- **Orders module = the owner's Orders screens, read only** (`canViewProductionOrders` + `canViewTakas`, no `canViewOrders`). Client / broker / phone / client search hidden via the new `canSeeClient` (Jemish + Gaurang only; server blanks them). He sees orders from *Jobsheet created* to *Taka entry done* (`IN_PRODUCTION` visibility group in `statuses.ts`). Writes stay forbidden. `RequirePermission` / `guard` accept an array (any of).

**Taka entry**
- Taka numbers are system generated: counter `taka_no`, first number 11, skips numbers already used, never reused (`allocateTakaNumbers`); `GET /takas/next-numbers` previews. `POST /jobsheets/:id/takas` no longer takes `takaNo`. Screen opens with 3 rows (`TAKA_ENTRY_DEFAULT_ROWS`) + Add more; English/Hindi warning when pcs entered ≠ frames × 3. Edit takas (Jemish/Gaurang) still takes manual numbers.

**QC**
- Butta QC and Mill QC merged into one role `qc` (bilingual, landing `/qc`). One taka-number box routes by stage to the Butta or Mill QC screen; the QC-pending list merges both queues with a Butta / Mill tag. `/butta-qc` and `/mill-qc` redirect to `/qc`; the QC API paths are unchanged.

**Mill receive by count** (migration `0011_mill_received_count`, `challans.received_count`)
- Godown supervisor enters how many takas came back per mill challan (card on Mill → Receive and challan details; `POST /mill/challans/:id/received-count`). No taka numbers; which takas is found at Mill QC (pending list also includes `at_mill` takas on counted challans). Butta receive is unchanged.

**Fixes**: all `Select` / `MultiSelect` dropdowns scroll with wheel and touch inside dialogs (popover is `modal`, takes over the scroll lock).

**To do before using it live**
- Run `npm run db:migrate` on Turso — migrations **0010** (Sprint 9) and **0011** are additive; until 0011 is applied, `GET /api/mill/challans` returns 500.
- Browser check at 360 / 768 px: supervisor cards + Orders, Start & print flow, Taka entry (3 rows + warning), `/qc`, Mill → Receive count, dropdown scroll on a real tablet / phone.
- Still not built: login/auth, dispatch, stock wipe-out flow, voice notes, jobsheets for kg / g / meter orders. Nothing from Sprints 9–11 is committed to git.

## Sprint 12 (done, uncommitted) — current as of 2026-10-14

Rework loops (send back to butta cutting / mill), Dhruvil role (godown Orders + dispatch challans DC-n + goods return GR with revisions + Move to order), Mark as fresh, real login + Users master. Full notes, API list and decisions are in the "Sprint 12" section of CLAUDE.md; spec: rivoora-sprint12-dispatch-login-prompt.md. Migration 0012 (additive) is tested on a local file DB only — run npm run db:migrate on Turso. Not done: responsive screenshot pass of the new screens.

## Sprint 13 (done, uncommitted) — current as of 2026-10-15

Free stock + Move to inventory / Add from free stock (replaces Move to order), re-butta fix (`has_been_to_mill`, split parts inherit), damage-type radio (+ `recorded_at`, "Not marked"), Returned status (GR sends goods to free stock), Blouse option everywhere. Details, decisions and the order-counting rule are in the "Sprint 13" section of CLAUDE.md; spec: rivoora-sprint13-free-stock-blouse-prompt.md.

- Verified: `npm run typecheck` clean, `npm test` 238 passing (new `sprint13.test.ts`), `node scripts/check-sprint13.mjs` (about 55 API checks incl. the migration on a local file DB, the free-stock rule, pcs split, re-butta, GR to Returned) and `check-auth.mjs` pass; desktop browser look at inventory / Takas tab / damage popup.
- **Turso changes when you run `npm run db:migrate`** (migration `0013_sprint13_free_stock_blouse.sql`, additive only): `orders.blouse_option`; `taka_damages.recorded_at`; `takas.is_free_stock` (default 0), `free_stock_at`, `free_stock_by`, `free_stock_reason`, `allocated_order_id`, `has_been_to_mill` (default 0); indexes `takas_free_stock_idx`, `takas_allocated_order_idx`; backfills: `has_been_to_mill` (mill challan rows / `received_mill` or `mill_qc_done` events / refinish_count > 0, then split children), `taka_damages.recorded_at` from `found_at`. No data is dropped or otherwise rewritten. Migrations 0010–0012 must be applied first if they are not already.
- Deviation from the spec: "not marked" is the value `unmarked` in `taka_damages.found_at` (not NULL) so no table rebuild is needed.
- Not done: 360 / 768 px screenshots, real-phone check, clicking through the Move to inventory / Add from free stock dialogs in the browser.

## Sprint 14 (done, uncommitted) — current as of 2026-10-15

Eleven small client-feedback changes (spec: rivoora-sprint14-small-changes-prompt.md; notes in the "Sprint 14" section of CLAUDE.md): stock panel not filtered by blouse, Party filter + multi-select filters, History Overview / Detailed (`orderMilestones`), Taka entry pcs before meters, pcs totals in Send popups, challan card design thumbnails + design preview, QC pending list removed, Dispatch damage notice, "Ready for order" label, delivery challans in Docs, owner name "Jenish".

- Verified: `npm run typecheck` clean, `npm test` 249 passing (new `sprint14.test.ts`, `orderFilters.test.ts`); API checked against a local file DB (milestones, challan list designs, Docs incl. delivery challans, `party` filter, owner login shows "Jenish").
- **No schema change.** One optional Turso step, to run only when you decide: `npm run db:rename-owner` (renames the default owner user to Jenish; touches only phone 9999999999 + name 'Jemish').
- Not done: no 360 / 768 / 1280px screenshot pass and no real-phone check (design preview swipe, Taka entry order, History Overview, Dispatch notice were typechecked + logic-tested, not clicked through); nothing is committed.
