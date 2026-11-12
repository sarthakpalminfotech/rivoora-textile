import { z } from 'zod';
import { DEFAULT_PERIOD, PERIOD_KEYS } from './period';

/** Sprint 25 — request schemas of the dashboards (the server validates with these). */

export const dashboardCardsQuerySchema = z.object({
  ids: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .refine((v) => v.length > 0 && v.length <= 80, 'Ask for 1–80 cards'),
  period: z.enum(PERIOD_KEYS).catch(DEFAULT_PERIOD).default(DEFAULT_PERIOD),
});

const layoutCard = z.object({
  id: z.string().min(1).max(60),
  width: z.enum(['small', 'normal', 'wide', 'full']),
  hidden: z.boolean().default(false),
});

/** PUT /dashboard/:key/layout — the arranged layout (unknown cards are dropped on read by `mergeLayout`). */
export const dashboardLayoutSchema = z.object({
  sections: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        title: z.string().trim().min(1, 'Enter the section name').max(60, 'At most 60 characters'),
        cards: z.array(layoutCard).max(80),
      }),
    )
    .min(1)
    .max(20),
});
export type DashboardLayoutInput = z.input<typeof dashboardLayoutSchema>;

export const dashboardSettingsSchema = z.object({
  workingHoursPerDay: z
    .number({ required_error: 'Enter the working hours', invalid_type_error: 'Enter the working hours' })
    .min(1, 'At least 1 hour')
    .max(24, 'At most 24 hours')
    .refine((v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9, 'Use whole or half hours'),
});
export type DashboardSettingsInput = z.input<typeof dashboardSettingsSchema>;
