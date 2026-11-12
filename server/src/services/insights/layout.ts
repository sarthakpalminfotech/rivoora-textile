import { eq } from 'drizzle-orm';
import {
  dashboardLayoutSchema,
  dashboardSettingsSchema,
  defaultLayout,
  mergeLayout,
  type DashboardKey,
  type DashboardLayout,
  type DashboardLayoutResult,
  type DashboardSettings,
} from '@rivoora/shared';
import { db, type DbOrTx } from '../../db/client';
import { appSettings, dashboardLayouts, users } from '../../db/schema';
import { currentUserId } from '../../lib/request-context';

/**
 * Sprint 25 (C11) — the arranged layout of a dashboard (one row per dashboard, for everyone who opens it) and the small app
 * settings the cards use. No row = the default layout of the prompt.
 */

export async function getLayout(dashboard: DashboardKey): Promise<DashboardLayoutResult> {
  const [row] = await db
    .select({ layout: dashboardLayouts.layout, updatedAt: dashboardLayouts.updatedAt, userName: users.name })
    .from(dashboardLayouts)
    .leftJoin(users, eq(users.id, dashboardLayouts.updatedByUserId))
    .where(eq(dashboardLayouts.dashboard, dashboard));
  if (!row) return { dashboard, layout: defaultLayout(dashboard), isDefault: true, updatedAt: null, updatedBy: null };
  let saved: DashboardLayout | null = null;
  try {
    saved = JSON.parse(row.layout) as DashboardLayout;
  } catch {
    saved = null;
  }
  return { dashboard, layout: mergeLayout(dashboard, saved), isDefault: false, updatedAt: row.updatedAt, updatedBy: row.userName };
}

/** PUT /dashboard/:key/layout — saved as given, after dropping unknown cards (`mergeLayout`). */
export async function saveLayout(dashboard: DashboardKey, input: unknown): Promise<DashboardLayoutResult> {
  const data = dashboardLayoutSchema.parse(input);
  const layout = mergeLayout(dashboard, data);
  const at = new Date().toISOString();
  await db
    .insert(dashboardLayouts)
    .values({ dashboard, layout: JSON.stringify(layout), updatedByUserId: currentUserId(), updatedAt: at })
    .onConflictDoUpdate({ target: dashboardLayouts.dashboard, set: { layout: JSON.stringify(layout), updatedByUserId: currentUserId(), updatedAt: at } });
  return getLayout(dashboard);
}

/** DELETE /dashboard/:key/layout — Reset to default. */
export async function resetLayout(dashboard: DashboardKey): Promise<DashboardLayoutResult> {
  await db.delete(dashboardLayouts).where(eq(dashboardLayouts.dashboard, dashboard));
  return getLayout(dashboard);
}

/* ---------- app settings ---------- */

export const SETTING = { workingHours: 'working_hours_per_day', stockMatch: 'insight_stock_match' } as const;
export const DEFAULT_WORKING_HOURS = 24;

export async function readSetting(tx: DbOrTx, key: string): Promise<string | null> {
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function getDashboardSettings(): Promise<DashboardSettings> {
  const v = Number(await readSetting(db, SETTING.workingHours));
  return { workingHoursPerDay: Number.isFinite(v) && v > 0 && v <= 24 ? v : DEFAULT_WORKING_HOURS };
}

export async function saveDashboardSettings(input: unknown): Promise<DashboardSettings> {
  const data = dashboardSettingsSchema.parse(input);
  const at = new Date().toISOString();
  await db
    .insert(appSettings)
    .values({ key: SETTING.workingHours, value: String(data.workingHoursPerDay), updatedByUserId: currentUserId(), updatedAt: at })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(data.workingHoursPerDay), updatedByUserId: currentUserId(), updatedAt: at } });
  return getDashboardSettings();
}

/** The hidden "Stock that matches an open order" flag — on only when the row says `1` / `true`. */
export async function stockMatchEnabled(): Promise<boolean> {
  const v = (await readSetting(db, SETTING.stockMatch))?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
