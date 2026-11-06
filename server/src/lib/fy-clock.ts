/**
 * Sprint 23 — the server's financial-year clock. Self-contained on purpose: `db/schema.ts` (loaded by drizzle-kit, which
 * cannot resolve the workspace package at runtime) uses it for the `fy` column default. The rule is the same as
 * `shared/src/fy.ts` (`fyOf`): India FY, 1 April – 31 March, Asia/Kolkata time.
 *
 * `FY_NOW=2027-04-05` (env) pretends it is that day — the smoke script uses it to simulate a year change.
 */
function fyOfDate(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() + 1 >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The current date for numbering (the real clock, or the `FY_NOW` test override). */
export function numberingNow(): Date {
  const o = process.env.FY_NOW;
  if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return new Date(`${o}T06:30:00Z`); // noon IST of that day
  return new Date();
}

/** The financial year new numbered records belong to. */
export function currentFyNow(): string {
  return fyOfDate(numberingNow());
}

/** The FY whose numbering continues the old global counters (config; default 2026-27 = the live data's year). */
export function numberingStartFy(): string {
  const v = process.env.NUMBERING_START_FY;
  return v && /^\d{4}-\d{2}$/.test(v) ? v : '2026-27';
}
