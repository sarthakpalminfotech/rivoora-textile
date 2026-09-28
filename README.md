# Rivoora Textile — Order Management

Web app for managing and tracking orders at Rivoora Textile: orders, send-for-production workflow, and the
Customer / Material / Design masters. It works on phones, tablets and desktops.

- **Client:** React 18 + Vite + TypeScript + Tailwind + Radix, TanStack Query, react-hook-form + zod
- **Server:** Node + Express + TypeScript, Drizzle ORM on Turso (libSQL), multer + sharp for images

## Setup

Requires Node 20+.

1. **Install**
   ```bash
   npm install
   ```
2. **Configure the database.** Copy the example env file and fill in your Turso URL and token:
   ```bash
   cp server/.env.example server/.env
   ```
   ```
   TURSO_DATABASE_URL=libsql://<your-db>.turso.io
   TURSO_AUTH_TOKEN=<token>
   PORT=4000
   ```
   `server/.env` is gitignored. The token is only used by the server and never reaches the browser.
3. **Create the tables**
   ```bash
   npm run db:migrate
   ```
4. **Load demo data** (optional; safe to run again)
   ```bash
   npm run db:seed
   ```
   This adds 8 customers, 6 materials, 6 designs (D101–D106) with generated pattern images and variations, and
   25 orders. Orders are only seeded when the orders table is empty.
5. **Run**
   ```bash
   npm run dev
   ```
   Open http://localhost:5180. The API runs on http://localhost:4000, and Vite proxies `/api` and `/uploads` to it.
   To test on a phone, open the "Network" URL that Vite prints; the phone must be on the same Wi-Fi.

## Roles

There is no login yet. Use the profile menu (top right) to switch between **Jemish — Owner** (everything) and
**Gaurang — Partner** (only orders that are Ready for production or later, read-only masters). The server
enforces what each role can see and do.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API + web app with hot reload |
| `npm run build` | Production build (server → `server/dist`, client → `client/dist`) |
| `npm start` | Run the built server; it also serves `client/dist` |
| `npm run typecheck` | TypeScript checks for shared, server and client |
| `npm run db:generate` | Create a migration after editing `server/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Insert demo data |

## Uploads

Images are converted to WebP (max 1600px wide) plus a 320px thumbnail and stored in `server/uploads/`. The
database stores only their URLs. To move to cloud storage later, add a driver in `server/src/storage/` and switch
it in `storage/index.ts`.

See `CLAUDE.md` for architecture and conventions.
