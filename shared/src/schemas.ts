import { z } from 'zod';
import { normalizeCode } from './codes';
import { UNITS } from './units';

export const PHONE_REGEX = /^[6-9]\d{9}$/;

/** Optional text: empty strings become null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

export function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const cleaned = v.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');
  return cleaned || null;
}

const phone = z
  .string()
  .trim()
  .nullish()
  .transform(normalizePhone)
  .refine((v) => v === null || PHONE_REGEX.test(v), 'Enter a valid 10-digit mobile number');

const email = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'Enter a valid email address');

export const codeSchema = z
  .string()
  .trim()
  .min(1, 'Code is required')
  .max(30, 'Code must be at most 30 characters')
  .transform(normalizeCode)
  .refine((v) => /^[A-Z0-9_\-/.]+$/.test(v), 'Use only letters, numbers and - / _ .');

const imageUrl = z.string().trim().min(1).max(500);

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  phone,
  alternatePhone: phone,
  email,
  address: optText(500),
  city: optText(80),
  gstNumber: optText(20).transform((v) => (v ? v.toUpperCase() : null)),
  notes: optText(1000),
});
export type CustomerInput = z.input<typeof customerInputSchema>;

export const materialInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
  code: optText(30),
  notes: optText(1000),
});
export type MaterialInput = z.input<typeof materialInputSchema>;

export const designInputSchema = z.object({
  code: codeSchema,
  name: optText(120),
  notes: optText(1000),
  imageUrl: imageUrl.nullish().transform((v) => v ?? null),
  thumbUrl: imageUrl.nullish().transform((v) => v ?? null),
  /** Fixed material for this design (optional) — pre-selected when the design is picked on an order. */
  materialId: z.number().int().positive().nullish().transform((v) => v ?? null),
});
export type DesignInput = z.input<typeof designInputSchema>;

export const variationInputSchema = z.object({
  code: codeSchema,
  imageUrl,
  thumbUrl: imageUrl,
});
export type VariationInput = z.input<typeof variationInputSchema>;

export const orderCreateSchema = z
  .object({
    customerId: z.number().int().positive('Select a client'),
    materialId: z.number().int().positive('Select a material'),
    designId: z.number().int().positive().nullish().transform((v) => v ?? null),
    variationId: z.number().int().positive().nullish().transform((v) => v ?? null),
    newDesign: z
      .object({ code: codeSchema, imageUrl, thumbUrl: imageUrl })
      .nullish()
      .transform((v) => v ?? null),
    quantity: z.number().positive('Quantity must be more than 0').max(100_000_000),
    unit: z.enum(UNITS),
    rate: z
      .number()
      .min(0, 'Rate cannot be negative')
      .max(100_000_000)
      .nullish()
      .transform((v) => v ?? null),
    orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
    notes: optText(4000),
    noteImages: z
      .array(z.object({ url: imageUrl, thumbUrl: imageUrl }))
      .max(10, 'At most 10 images')
      .default([]),
  })
  .refine((v) => !(v.newDesign && v.designId), {
    message: 'Pick either a saved design or upload a new one',
    path: ['designId'],
  })
  .refine((v) => !v.variationId || v.designId, {
    message: 'Variation needs a design',
    path: ['variationId'],
  });
export type OrderCreateInput = z.input<typeof orderCreateSchema>;

export const sendToProductionSchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1, 'Select at least one order').max(500),
});
export type SendToProductionInput = z.infer<typeof sendToProductionSchema>;

/* ---------- machines & jobsheets ---------- */

const posInt = (label: string, max: number) =>
  z
    .number({ required_error: `Enter ${label}`, invalid_type_error: `Enter ${label}` })
    .int('Use a whole number')
    .min(1, 'Must be at least 1')
    .max(max, `Must be at most ${max.toLocaleString('en-IN')}`);

export const machineInputSchema = z.object({
  machineNo: posInt('the machine number', 100_000),
  name: optText(80),
  notes: optText(1000),
  isActive: z.boolean().default(true),
});
export type MachineInput = z.input<typeof machineInputSchema>;

const picks = optText(20);
const machineIds = z
  .array(z.number().int().positive(), { required_error: 'Select at least one machine' })
  .min(1, 'Select at least one machine')
  .max(50, 'At most 50 machines')
  .transform((ids) => [...new Set(ids)]);

/** Upper limit for one multi-jobsheet run, so a typo can't create thousands of jobsheets. */
export const MAX_JOBSHEETS_PER_RUN = 500;

export const jobsheetGenerateSchema = z.object({
  pieces: posInt('the number of pieces', 10_000_000),
  picks,
  framesPerJobsheet: posInt('frames per jobsheet', 100_000),
  machineIds,
});
export type JobsheetGenerateInput = z.input<typeof jobsheetGenerateSchema>;

export const jobsheetSingleSchema = z.object({
  frames: posInt('the frames', 100_000),
  pieces: posInt('the pieces', 10_000_000),
  picks,
  machineIds,
});
export type JobsheetSingleInput = z.input<typeof jobsheetSingleSchema>;

export const jobsheetUpdateSchema = z.object({
  frames: posInt('the frames', 100_000),
  picks,
  machineIds,
});
export type JobsheetUpdateInput = z.input<typeof jobsheetUpdateSchema>;

/* ---------- jobsheet workflow (send / start / complete / change machine) ---------- */

const jobsheetIds = z
  .array(z.number().int().positive(), { required_error: 'Select at least one jobsheet' })
  .min(1, 'Select at least one jobsheet')
  .max(500)
  .transform((ids) => [...new Set(ids)]);

export const jobsheetSendSchema = z.object({ jobsheetIds });
export type JobsheetSendInput = z.input<typeof jobsheetSendSchema>;

const machineId = z
  .number({ required_error: 'Select a machine', invalid_type_error: 'Select a machine' })
  .int()
  .positive('Select a machine');

const framesDone = z
  .number({ required_error: 'Enter the frames completed', invalid_type_error: 'Enter the frames completed' })
  .int('Use a whole number')
  .min(0, 'Cannot be negative')
  .max(100_000, 'Must be at most 1,00,000');

export const jobsheetStartSchema = z.object({ machineId });
export type JobsheetStartInput = z.input<typeof jobsheetStartSchema>;

export const jobsheetCompleteSchema = z.object({ completedFrames: framesDone });
export type JobsheetCompleteInput = z.input<typeof jobsheetCompleteSchema>;

export const jobsheetChangeMachineSchema = z.object({
  newMachineId: machineId,
  completedFrames: framesDone,
  nextFrames: posInt('the frames to make next', 100_000),
});
export type JobsheetChangeMachineInput = z.input<typeof jobsheetChangeMachineSchema>;

export const JOBSHEET_TABS = ['all', 'pending', 'ongoing', 'completed'] as const;
export type JobsheetTab = (typeof JOBSHEET_TABS)[number];

/** GET /jobsheets — the supervisor's module. */
export const jobsheetListQuerySchema = z.object({
  tab: z.enum(JOBSHEET_TABS).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
});
export type JobsheetListQuery = z.infer<typeof jobsheetListQuerySchema>;
