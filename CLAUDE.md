# Rivoora Textile — Order Management (CLAUDE.md)

Guide for future development sessions. Keep this file updated when architecture, conventions or setup change.

## What this is

Order management + tracking for Rivoora Textile (saree / cloth power-loom maker). Sprint 1 = orders, order tracking
(Pending → Ready for production), and the masters orders depend on (Customers, Materials, Designs + variations).
The original spec lives in `rivoora-claude-code-prompt.md`.

## Monorepo layout (npm workspaces)

```
shared/   @rivoora/shared — TS source used by BOTH client and server (no build step)
  src/roles.ts      role config + permissions (single source of truth)
  src/statuses.ts   order status config (label, sequence, badge colours, visibleTo roles)
  src/units.ts      kg | pcs | g | meters
  src/codes.ts      variationCode() — design code + "N" + number (D101 → D101N1)
  src/schemas.ts    zod request schemas (server validates with these)
  src/types.ts      API DTO types
server/   Express + Drizzle + Turso (libSQL)
  src/env.ts            loads server/.env, fails clearly if TURSO_* missing
  src/db/client.ts      the ONE shared db client
  src/db/schema.ts      Drizzle schema → `npm run db:generate` → server/drizzle/*.sql (committed)
  src/db/migrate.ts     applies migrations      src/db/seed.ts + patterns.ts   demo data + SVG patterns
  src/routes/*          thin Express routers    src/services/*   all SQL / business rules
  src/middleware/role.ts  X-Role header → req.role; requirePermission(...)
  src/middleware/error.ts consistent `{ error: { message, field? } }`
  src/storage/*         image storage driver (local disk now; swap for R2/S3 in storage/index.ts)
  uploads/              uploaded images (gitignored, except uploads/demo/ seed images)
client/   Vite + React 18 + TS + Tailwind + Radix (shadcn-style components written in-repo)
  src/components/ui/*      design system (select.tsx = THE standard dropdown, modal.tsx, date-picker, …)
  src/components/layout/*  sidebar / tablet rail / mobile bottom nav, top bar, profile menu (role switch)
  src/features/orders/*    list + selection mode, filters, add order, saved-designs drawer, details
  src/features/masters/*   customers, materials, designs (+ generic master-list scaffold)
  src/config/roles.ts, statuses.ts   re-exports from shared (client-side mirror)
  src/lib/api.ts           fetch wrapper — adds X-Role, parses error JSON into ApiError
```

## Running

```bash
npm install
npm run db:migrate      # apply migrations to Turso
npm run db:seed         # demo data (idempotent; orders only seeded when the table is empty)
npm run dev             # server :4000 + client :5180 (Vite proxies /api and /uploads)
npm run typecheck       # all three packages
npm run build           # server → server/dist (tsup), client → client/dist
npm start               # production: server also serves client/dist
```

The Vite dev server uses port **5180** (not 5173) and `host: true`, so it is reachable on the LAN for phone testing.

## Database (Turso / libSQL + Drizzle)

- Credentials only in `server/.env` (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `PORT`). Never in code or the client.
  The token is read/write — the browser only ever talks to our API.
- Schema change workflow: edit `server/src/db/schema.ts` → `npm run db:generate` → review SQL in `server/drizzle/` →
  `npm run db:migrate`. Commit the migration files.
- All tables: `id`, `created_at`, `updated_at` (ISO strings). Masters are soft-deleted (`is_deleted`); deleting is
  blocked (409) when any order references the record. Variations are hard-deleted (only if unused).
- Unique among non-deleted rows via partial indexes: `lower(materials.name)`, `designs.code`.
- `orders.order_no` is assigned inside the insert transaction: `(SELECT COALESCE(MAX(order_no),0)+1 FROM orders)`,
  plus a unique index. Never generated on the client.
- Multi-row changes use transactions (`db.transaction`); read endpoints use `db.batch` (list + count in one round trip).
- **Drizzle gotcha:** in single-table queries Drizzle renders `${table.col}` unqualified. Inside raw correlated
  subqueries write the outer column explicitly (e.g. `"designs"."id"`), otherwise it binds to the inner table.

## Roles (no login yet)

- `X-Role: jemish | gaurang` header on every `/api` call (client stores the role in localStorage `rivoora.role`).
  Missing/invalid header → 400. Permissions are enforced on the server via `requirePermission`.
- Permissions live in `shared/src/roles.ts`. Adding a role: add key + config there, then add it to `visibleTo`
  of the statuses it may see.
- Rate: returned by `GET /api/orders/:id` only when `canSeeRate`; the list endpoint never returns rate.
- Gaurang: orders from Ready for production onwards, no add/send/undo, masters read-only.
- Switching role clears the React Query cache and re-mounts the router (`App.tsx`).

## Status system

- Defined once in `shared/src/statuses.ts`: `key`, `label`, `sequence`, `badge` colours, `visibleTo` roles.
- Server filters lists by `visibleStatusKeys(role)` and 404s details the role can't see.
- Every status change writes `order_status_history` (create, send, undo). The details timeline labels a move to a
  lower sequence as "Moved back to …".
- Adding a status (e.g. `in_production`, `completed`): add an entry with a higher `sequence` and
  `visibleTo: FROM_READY`. Filters, badges, visibility and the timeline pick it up automatically.
  Add new transition endpoints in `services/orders.ts` using `changeStatus()`.

## API (all under /api, JSON)

- `GET /orders?search=&status=a,b&material=1,2&from=&to=&page=&limit=` — lean list (customer + material joined)
- `GET /orders/:id` · `POST /orders` · `POST /orders/send-to-production {orderIds}` · `POST /orders/:id/undo-production`
- `GET /customers/:id/previous-designs` — latest order per design/variation for that client
- CRUD `/customers`, `/materials`, `/designs`, `/designs/:id/variations[/:variationId]`, `GET /designs/check-code?code=`
- `GET /lookup/customers?search=`, `GET /lookup/materials?search=` — id + name for dropdowns
- `POST /uploads?folder=designs|notes` (multipart `file`) → `{ url, thumbUrl }` (WebP ≤1600px + 320px thumb)
- Errors: `{ error: { message, field? } }` with proper status codes (400 validation, 403, 404, 409 conflict).

## Client conventions

- Server data only through TanStack Query hooks in `features/*/api.ts`; invalidate only affected keys.
  Query keys: `['orders','list',role,params]`, `['orders','detail',id]`, `['customers',…]`, `['lookup',…]`.
- Paginated lists use `useInfiniteList` (20/page) + `<LoadMore>` (infinite scroll with a button fallback).
- Search inputs are debounced 300 ms (`useDebounce`). Order filters live in the URL (`useOrderFilters`).
- Every select uses `components/ui/select.tsx` (`Select`, `MultiSelect`; `searchable` + `onSearchChange` for server search).
- Forms: react-hook-form + zod with string-valued form schemas; server field errors mapped inline via
  `applyServerFieldError`. Mutations that do this set `meta: { silentFieldErrors: true }`.
- Overlays: `Modal` (`center | right | bottom | fullscreen`). Forms, filters and pickers open **full screen on every
  breakpoint** (`ResponsiveModal` defaults to `fullscreen`; content is centred at a readable width via `size`).
  Exceptions: confirmations (`ConfirmDialog`) stay centred dialogs; the Saved designs drawer slides in from the right
  on tablet/desktop (full screen on phones).
- Orders list is a **card grid** on all breakpoints (1 / 2 / 3 / 4 / 5 columns at phone / md / lg / xl / 2xl) — no table.
- `.page-container` is capped at 1920px (not 1280px) so wide monitors use the side space. Screens add `2xl: 1536px`.
- Images: lists/cards show thumbnails only (`ImageThumb`, lazy + placeholder); the full image loads in the lightbox.
- Breakpoints: phone < 768 (bottom nav, cards, FAB), tablet 768–1023 (icon rail, 2-col order cards),
  desktop ≥ 1024 (sidebar, 3–4-col order grid; master lists still use tables). Nothing may overflow at 360px.
- Formatting helpers in `lib/format.ts`: dates `dd-MM-yyyy`, money `₹1,25,000.00` (en-IN), quantity with unit, `#N`.
- Theme tokens: CSS variables in `client/src/index.css` (primary maroon #8B1E3F, accent gold #C9A227), font DM Sans.
- Pages are lazy-loaded in `App.tsx`. `/orders/new` is a full-screen route outside the app layout.

## Not built yet (next sprints)

Login/auth, statuses after Ready for production, further order actions, voice notes (the mic icon is a placeholder
with a "coming soon" tooltip), and cleanup of orphaned uploaded images.
