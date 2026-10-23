import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './auth';
import { ROLE_KEYS } from './roles';
import { normalizeCode } from './codes';
import { ORDER_TYPES } from './orderTypes';
import { BLOUSE_FILTERS, BLOUSE_OPTIONS, CHOOSABLE_DAMAGE_TYPES } from './freeStock';
import { UNITS } from './units';
import { workFilterQueryFields } from './workFilters';
import {
  DAMAGE_NAME_MAX_LENGTH,
  MAX_TAKAS_PER_JOBSHEET,
  MAX_TAKAS_PER_SUBMIT,
  RESERVED_WEAVER_CODES,
  TAKA_METERS_MAX,
  TAKA_NO_MAX_LENGTH,
  TAKA_NO_REGEX,
  TAKA_PCS_MAX,
  WEAVER_CODE_REGEX,
  WEAVER_TAKA_NO_REGEX,
} from './takas';
import { PO_UNITS } from './outside';

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

export const BROKER_NAME_MAX_LENGTH = 80;
export const MAX_BROKERS_PER_CUSTOMER = 50;

/**
 * A customer's brokers (just names). Rows with an `id` are existing brokers (renamed if the name changed), rows
 * without one are new, missing ids are soft-deleted. Empty names are dropped; duplicates (case-insensitive) are an
 * error on the later row (`brokers.<i>.name`).
 */
const brokers = z
  .array(
    z.object({
      id: z.number().int().positive().optional(),
      name: z.string().trim().max(BROKER_NAME_MAX_LENGTH, `Broker name must be at most ${BROKER_NAME_MAX_LENGTH} characters`),
    }),
  )
  .max(MAX_BROKERS_PER_CUSTOMER, `At most ${MAX_BROKERS_PER_CUSTOMER} brokers`)
  .default([])
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((b, i) => {
      const key = b.name.toLowerCase();
      if (!key) return;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: 'This broker is already added' });
      seen.add(key);
    });
  })
  .transform((list) => list.filter((b) => b.name));

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  phone,
  alternatePhone: phone,
  email,
  address: optText(500),
  city: optText(80),
  gstNumber: optText(20).transform((v) => (v ? v.toUpperCase() : null)),
  notes: optText(1000),
  brokers,
});
export type CustomerInput = z.input<typeof customerInputSchema>;

/** Damage master: what the damage is (Hole, Oil stain…). */
export const damageInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(DAMAGE_NAME_MAX_LENGTH, `Name must be at most ${DAMAGE_NAME_MAX_LENGTH} characters`),
  notes: optText(1000),
});
export type DamageInput = z.input<typeof damageInputSchema>;

export const materialInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
  code: optText(30),
  notes: optText(1000),
});
export type MaterialInput = z.input<typeof materialInputSchema>;

const buttaCuttingChoice = z.boolean({
  required_error: 'Choose Yes or No',
  invalid_type_error: 'Choose Yes or No',
});

export const designInputSchema = z.object({
  code: codeSchema,
  name: optText(120),
  notes: optText(1000),
  imageUrl: imageUrl.nullish().transform((v) => v ?? null),
  thumbUrl: imageUrl.nullish().transform((v) => v ?? null),
  /** Fixed material for this design (optional) — pre-selected when the design is picked on an order. */
  materialId: z.number().int().positive().nullish().transform((v) => v ?? null),
  /** Goes for butta cutting? Required (no default) — decides where takas go after taka entry. */
  buttaCutting: buttaCuttingChoice,
});
export type DesignInput = z.input<typeof designInputSchema>;

export const variationInputSchema = z.object({
  code: codeSchema,
  imageUrl,
  thumbUrl: imageUrl,
});
export type VariationInput = z.input<typeof variationInputSchema>;

/** Sprint 16: the three steps of an order (all ticked by default on a new order). */
const stepFlag = z.boolean({ invalid_type_error: 'Tick or untick the step' });

const orderBaseShape = {
    customerId: z.number().int().positive('Select a client'),
    /** Optional broker — must be one of the customer's brokers (checked by the server). */
    brokerId: z.number().int().positive().nullish().transform((v) => v ?? null),
    orderType: z.enum(ORDER_TYPES, {
      required_error: 'Pick the order type',
      invalid_type_error: 'Pick the order type',
    }),
    /** Sprint 13: optional blouse option; null = not set. */
    blouseOption: z.enum(BLOUSE_OPTIONS).nullish().transform((v) => v ?? null),
    materialId: z.number().int().positive('Select a material'),
    designId: z.number().int().positive().nullish().transform((v) => v ?? null),
    variationId: z.number().int().positive().nullish().transform((v) => v ?? null),
    newDesign: z
      .object({ code: codeSchema, imageUrl, thumbUrl: imageUrl, buttaCutting: buttaCuttingChoice })
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
};

const designOk = (v: { newDesign: unknown; designId: unknown }) => !(v.newDesign && v.designId);
const variationOk = (v: { variationId: unknown; designId: unknown }) => !v.variationId || !!v.designId;
const DESIGN_REFINE = { message: 'Pick either a saved design or upload a new one', path: ['designId'] };
const VARIATION_REFINE = { message: 'Variation needs a design', path: ['variationId'] };

/** POST /orders — Sprint 16: + the steps (an old client that sends none gets all three, the old flow). */
export const orderCreateSchema = z
  .object({
    ...orderBaseShape,
    hasProduction: stepFlag.default(true),
    hasButta: stepFlag.default(true),
    hasMill: stepFlag.default(true),
  })
  .refine(designOk, DESIGN_REFINE)
  .refine(variationOk, VARIATION_REFINE);
export type OrderCreateInput = z.input<typeof orderCreateSchema>;

/**
 * Editing an order sends the same fields as creating one (note images = the full new set). The steps are optional
 * here — only sent (and only applied, by a role with `canEditOrderSteps`) when they change.
 */
export const orderUpdateSchema = z
  .object({
    ...orderBaseShape,
    hasProduction: stepFlag.optional(),
    hasButta: stepFlag.optional(),
    hasMill: stepFlag.optional(),
  })
  .refine(designOk, DESIGN_REFINE)
  .refine(variationOk, VARIATION_REFINE);

/** PUT /orders/:id/steps */
export const orderStepsSchema = z.object({ hasProduction: stepFlag, hasButta: stepFlag, hasMill: stepFlag });
export type OrderStepsInput = z.input<typeof orderStepsSchema>;

/** POST /orders/:id/close — an optional note + "Frames completed" for every jobsheet on the loom (like Hold). */
export const orderCloseSchema = z.object({
  note: optText(300),
  ongoing: z
    .array(
      z.object({
        jobsheetId: z.number().int().positive(),
        completedFrames: z
          .number({ required_error: 'Enter the frames completed', invalid_type_error: 'Enter the frames completed' })
          .int('Use a whole number')
          .min(0, 'Cannot be negative')
          .max(100_000, 'Must be at most 1,00,000'),
      }),
    )
    .max(500)
    .default([]),
});
export type OrderCloseInput = z.input<typeof orderCloseSchema>;

/** POST /orders/:id/hold (Sprint 15) — an optional note + "Frames completed" for every jobsheet that is on the loom. */
export const orderHoldSchema = z.object({
  note: optText(300),
  ongoing: z
    .array(
      z.object({
        jobsheetId: z.number().int().positive(),
        completedFrames: z
          .number({ required_error: 'Enter the frames completed', invalid_type_error: 'Enter the frames completed' })
          .int('Use a whole number')
          .min(0, 'Cannot be negative')
          .max(100_000, 'Must be at most 1,00,000'),
      }),
    )
    .max(500)
    .default([]),
});
export type OrderHoldInput = z.input<typeof orderHoldSchema>;
export type OrderUpdateInput = z.input<typeof orderUpdateSchema>;

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

const machineIds = z
  .array(z.number().int().positive(), { required_error: 'Select at least one machine' })
  .min(1, 'Select at least one machine')
  .max(50, 'At most 50 machines')
  .transform((ids) => [...new Set(ids)]);

/** Upper limit for one multi-jobsheet run, so a typo can't create thousands of jobsheets. */
export const MAX_JOBSHEETS_PER_RUN = 500;

export const jobsheetGenerateSchema = z.object({
  pieces: posInt('the number of pieces', 10_000_000),
  framesPerJobsheet: posInt('frames per jobsheet', 100_000),
  machineIds,
});
export type JobsheetGenerateInput = z.input<typeof jobsheetGenerateSchema>;

export const jobsheetSingleSchema = z.object({
  frames: posInt('the frames', 100_000),
  machineIds,
});
export type JobsheetSingleInput = z.input<typeof jobsheetSingleSchema>;

export const jobsheetUpdateSchema = z.object({
  frames: posInt('the frames', 100_000),
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
  completedFrames: framesDone,
  nextFrames: posInt('the frames to make next', 100_000),
});
export type JobsheetChangeMachineInput = z.input<typeof jobsheetChangeMachineSchema>;

export const JOBSHEET_TABS = ['all', 'pending', 'ongoing', 'completed'] as const;
export type JobsheetTab = (typeof JOBSHEET_TABS)[number];

const listSearch = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => v || undefined);

/** GET /jobsheets — the supervisor's module (`orderId` = one order's jobsheets, from the Order view). */
export const jobsheetListQuerySchema = z.object({
  tab: z.enum(JOBSHEET_TABS).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: listSearch,
  orderId: z.coerce.number().int().positive().optional(),
  ...workFilterQueryFields,
});
export type JobsheetListQuery = z.infer<typeof jobsheetListQuerySchema>;

/** GET /jobsheets/orders — the supervisor's Order view (jobsheets grouped by order). */
export const supervisorOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: listSearch,
  ...workFilterQueryFields,
});
export type SupervisorOrderListQuery = z.infer<typeof supervisorOrderListQuerySchema>;

/* ---------- takas (Taka entry) ---------- */

const takaNo = z
  .string({ required_error: 'Enter the taka number', invalid_type_error: 'Enter the taka number' })
  .trim()
  .min(1, 'Enter the taka number')
  .max(TAKA_NO_MAX_LENGTH, `At most ${TAKA_NO_MAX_LENGTH} characters`)
  .regex(TAKA_NO_REGEX, 'Use digits, - or / (letters only as a short code at the start)');

/** Pcs of a taka: a whole number 1–9999 (required on new takas). */
const takaPcs = z
  .number({ required_error: 'Enter the pcs', invalid_type_error: 'Enter the pcs' })
  .int('Use a whole number')
  .min(1, 'Pcs must be at least 1')
  .max(TAKA_PCS_MAX, `At most ${TAKA_PCS_MAX} pcs`);

const otherDamageName = z
  .string({ required_error: 'Write the damage name', invalid_type_error: 'Write the damage name' })
  .trim()
  .min(1, 'Write the damage name')
  .max(DAMAGE_NAME_MAX_LENGTH, `At most ${DAMAGE_NAME_MAX_LENGTH} characters`);

/** Damaged pcs of one damage: a whole number from 1 (the server also checks it against the taka's pcs). */
const damagePcs = z
  .number({ required_error: 'Enter the damaged pcs', invalid_type_error: 'Enter the damaged pcs' })
  .int('Use a whole number')
  .min(1, 'Pcs must be at least 1')
  .max(TAKA_PCS_MAX, `At most ${TAKA_PCS_MAX} pcs`);

/** The damage TYPE chosen with the radio (Machine / Butta cutting / Mill). Required wherever damage is marked. */
const damageTypeRequired = z.enum(CHOOSABLE_DAMAGE_TYPES, {
  required_error: 'Choose the damage type',
  invalid_type_error: 'Choose the damage type',
});
/** Goods return: the type is optional — nothing chosen is saved as "Damage type not marked". */
const damageTypeOptional = z.enum(CHOOSABLE_DAMAGE_TYPES).nullish().transform((v) => v ?? null);

/**
 * One damage of a taka: a Damage master entry or a typed "Other" name (the server finds it case-insensitively or
 * adds it to the master in the same transaction) + the damaged pcs.
 */
export const takaDamageSchema = z.union([
  z.object({ type: damageTypeRequired, damageId: z.number().int().positive(), pcs: damagePcs }).strict(),
  z.object({ type: damageTypeRequired, otherName: otherDamageName, pcs: damagePcs }).strict(),
]);
export type TakaDamageInput = z.input<typeof takaDamageSchema>;

const MAX_DAMAGES_PER_TAKA = 10;
const takaDamages = z.array(takaDamageSchema).max(MAX_DAMAGES_PER_TAKA, `At most ${MAX_DAMAGES_PER_TAKA} damages per taka`).default([]);

/**
 * Edit takas: the OPEN damages of a taka after editing. Rows with an `id` are existing open damages (edited if they
 * changed; open damages that are missing are removed); rows without one are new machine damages. An older damage
 * that has no name / pcs yet keeps them as `damageId: null` / `pcs: null` (the server allows that only when it is
 * unchanged). Resolved damages are never sent — they are read-only.
 */
const takaEditDamage = z.union([
  // `type` is required on NEW rows (no `id`) — the server checks that; an existing damage keeps its type.
  z.object({ id: z.number().int().positive().optional(), type: damageTypeRequired.optional(), damageId: z.number().int().positive().nullable(), pcs: damagePcs.nullable() }).strict(),
  z.object({ id: z.number().int().positive().optional(), type: damageTypeRequired.optional(), otherName: otherDamageName, pcs: damagePcs }).strict(),
]);
export type TakaEditDamageInput = z.input<typeof takaEditDamage>;

/** Optional length of a taka in meters (> 0, ≤ 9999.99, rounded to 2 decimals). */
const takaMeters = z
  .number({ invalid_type_error: 'Enter the meters as a number' })
  .positive('Meters must be more than 0')
  .max(TAKA_METERS_MAX, `At most ${TAKA_METERS_MAX} m`)
  .nullish()
  .transform((v) => (v == null ? null : Math.round(v * 100) / 100));

const takaNote = z
  .string()
  .trim()
  .max(2000, 'Must be at most 2000 characters')
  .nullish()
  .transform((v) => (v ? v : null));

/** POST /jobsheets/:id/takas — adds new takas only (Taka entry). Taka numbers are generated by the server. */
export const takaEntrySchema = z.object({
  takas: z
    .array(z.object({ meters: takaMeters, pcs: takaPcs, damages: takaDamages }), { required_error: 'Enter at least one taka' })
    .min(1, 'Enter at least one taka')
    .max(MAX_TAKAS_PER_SUBMIT, `At most ${MAX_TAKAS_PER_SUBMIT} takas at a time`),
  note: takaNote,
});
export type TakaEntryInput = z.input<typeof takaEntrySchema>;

/**
 * PUT /jobsheets/:id/takas — the full set after editing (rows without `id` are new; missing ids are removed).
 * `pcs` may stay null only on an unchanged older taka that never had pcs (the server checks); new and changed
 * takas need it.
 */
export const takaEditSchema = z.object({
  takas: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        takaNo,
        meters: takaMeters,
        pcs: takaPcs.nullish().transform((v) => v ?? null),
        damages: z.array(takaEditDamage).max(MAX_DAMAGES_PER_TAKA, `At most ${MAX_DAMAGES_PER_TAKA} damages per taka`).default([]),
        /** Sprint 16: an outside taka's weaver number (Edit takas of a receipt). */
        weaverTakaNo: z.string().trim().max(TAKA_NO_MAX_LENGTH).nullish().transform((v) => v || null),
      }),
    )
    .max(MAX_TAKAS_PER_JOBSHEET, `At most ${MAX_TAKAS_PER_JOBSHEET} takas per jobsheet`),
  note: takaNote,
  /** Sprint 16: edit only the takas of this receipt (outside / FG takas live on the order's hidden external jobsheet). */
  receiptId: z.number().int().positive().optional(),
});
export type TakaEditInput = z.input<typeof takaEditSchema>;

export const TAKA_TABS = ['pending', 'done'] as const;
export type TakaTab = (typeof TAKA_TABS)[number];

/** GET /taka/jobsheets — the Taka entry list. */
export const takaListQuerySchema = z.object({
  tab: z.enum(TAKA_TABS).default('pending'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: listSearch,
});
export type TakaListQuery = z.infer<typeof takaListQuerySchema>;

/* ---------- butta cutting (Sprint 7) + mill (Sprint 8) ---------- */

export const BUTTA_PARTY_NAME_MAX_LENGTH = 120;
export const PARTY_NAME_MAX_LENGTH = BUTTA_PARTY_NAME_MAX_LENGTH;

/** Butta / mill party master (same fields): the name is printed as "M/s. …" on the challan. */
export const partyInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(BUTTA_PARTY_NAME_MAX_LENGTH, 'Name is too long'),
  address: optText(500),
  mobile: optText(20),
  gstin: optText(20).transform((v) => (v ? v.toUpperCase() : null)),
  notes: optText(1000),
});
export const buttaPartyInputSchema = partyInputSchema;
export type PartyInput = z.input<typeof partyInputSchema>;
export type ButtaPartyInput = PartyInput;

/** POST /butta/challans and POST /mill/challans */
export const challanCreateSchema = z.object({
  takaIds: z
    .array(z.number().int().positive(), { required_error: 'Select at least one taka' })
    .min(1, 'Select at least one taka')
    .max(2000, 'At most 2000 takas on one challan')
    .transform((ids) => [...new Set(ids)]),
  partyId: z.number({ required_error: 'Select the party', invalid_type_error: 'Select the party' }).int().positive('Select the party'),
  challanDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  ewayNo: optText(40),
});
export type ChallanCreateInput = z.input<typeof challanCreateSchema>;

/** POST /butta/receive and /mill/receive — one taka number (the Taka number screen) or taka ids (ticked rows on a challan). */
export const challanReceiveSchema = z
  .object({
    takaNo,
    takaIds: z.array(z.number().int().positive()).min(1).max(2000).optional(),
  })
  .partial()
  .refine((v) => (v.takaNo !== undefined) !== (v.takaIds !== undefined), { message: 'Send either takaNo or takaIds' });
export const buttaReceiveSchema = challanReceiveSchema;
export type ChallanReceiveInput = z.input<typeof challanReceiveSchema>;
export type ButtaReceiveInput = ChallanReceiveInput;

export const CHALLAN_FILTERS = ['open', 'received', 'all'] as const;
export type ChallanFilter = (typeof CHALLAN_FILTERS)[number];

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: listSearch,
};

/** GET /butta/pending-orders and GET /butta-qc/pending */
export const buttaListQuerySchema = z.object({ ...pageQuery, ...workFilterQueryFields });
export type ButtaListQuery = z.infer<typeof buttaListQuerySchema>;

/** GET /butta/challans */
export const challanListQuerySchema = z.object({ filter: z.enum(CHALLAN_FILTERS).default('open'), ...pageQuery, ...workFilterQueryFields });
/** GET /<kind>/pending-orders/:orderId/takas — the same work filters as the list (loom / quality …). */
export const pendingTakasQuerySchema = z.object(workFilterQueryFields);
export type ChallanListQuery = z.infer<typeof challanListQuerySchema>;

/** GET /takas/check?no= */
export const takaCheckQuerySchema = z.object({ no: z.string().trim().max(40).default('') });

/**
 * Butta QC: the decision for each damage that was open when the taka was received — how many pcs were resolved
 * (0 = not resolved; the server checks it against the pcs still open).
 */
export const qcDecisionSchema = z.object({
  takaDamageId: z.number().int().positive(),
  resolvedPcs: z
    .number({ required_error: 'Enter how many pcs were resolved', invalid_type_error: 'Enter how many pcs were resolved' })
    .int('Use a whole number')
    .min(0, 'Pcs cannot be negative')
    .max(TAKA_PCS_MAX, `At most ${TAKA_PCS_MAX} pcs`),
  /** Needed only for an older damage that has no pcs yet. */
  pcs: damagePcs.nullish().transform((v) => v ?? null),
});

export const MAX_DAMAGE_IMAGES = 10;

/** A photo of a damage (already uploaded to `/uploads?folder=damages`). */
export const damageImageSchema = z.object({ url: z.string().trim().min(1).max(500), thumbUrl: z.string().trim().min(1).max(500) });
export type DamageImageInput = z.input<typeof damageImageSchema>;

const damageImages = z.array(damageImageSchema).max(MAX_DAMAGE_IMAGES, `At most ${MAX_DAMAGE_IMAGES} images per damage`).default([]);

/** A NEW damage found at the Butta QC: like a taka damage + optional images. */
export const qcNewDamageSchema = z.union([
  z.object({ type: damageTypeRequired, damageId: z.number().int().positive(), pcs: damagePcs, images: damageImages }).strict(),
  z.object({ type: damageTypeRequired, otherName: otherDamageName, pcs: damagePcs, images: damageImages }).strict(),
]);
export type QcNewDamageInput = z.input<typeof qcNewDamageSchema>;

/** Goods return: the same, but the damage type is optional (saved as "Damage type not marked" when empty). */
export const grDamageSchema = z.union([
  z.object({ type: damageTypeOptional, damageId: z.number().int().positive(), pcs: damagePcs, images: damageImages }).strict(),
  z.object({ type: damageTypeOptional, otherName: otherDamageName, pcs: damagePcs, images: damageImages }).strict(),
]);
export type GrDamageInput = z.input<typeof grDamageSchema>;

/**
 * POST /butta-qc/:takaId. Sprint 15: meters and pcs are read-only for QC — they are not part of the body any more
 * (an old client that still sends them is ignored; the taka keeps the values it was entered with).
 */
export const qcSubmitSchema = z.object({
  damageDecisions: z.array(qcDecisionSchema).max(50).default([]),
  newDamages: z.array(qcNewDamageSchema).max(MAX_DAMAGES_PER_TAKA, `At most ${MAX_DAMAGES_PER_TAKA} new damages`).default([]),
});
export type QcSubmitInput = z.input<typeof qcSubmitSchema>;

/* ---------- Mill QC, refinish, godown (Sprint 9) ---------- */

export const MILL_QC_RESULTS = ['final', 'refinish'] as const;
export type MillQcResultKind = (typeof MILL_QC_RESULTS)[number];

/**
 * POST /mill-qc/:takaId — like Butta QC (meters / pcs, a decision per open damage, new damages with photos), plus the
 * result: `final` (Fresh or Done → the godown's final takas) or `refinish` (back to the mill, with an optional note).
 * With `refinish` the open damages need no answer.
 */
export const millQcSubmitSchema = qcSubmitSchema.extend({
  result: z.enum(MILL_QC_RESULTS).default('final'),
  refinishNote: optText(300),
});
export type MillQcSubmitInput = z.input<typeof millQcSubmitSchema>;

/** GET /godown/orders */
export const godownListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  search: listSearch,
});
export type GodownListQuery = z.infer<typeof godownListQuerySchema>;

/** PATCH /godown/takas/:id — tick / untick, and/or the actual pcs counted. */
export const godownTakaPatchSchema = z
  .object({
    checked: z.boolean().optional(),
    actualPcs: z
      .number({ invalid_type_error: 'Enter the pcs' })
      .int('Use a whole number')
      .min(1, 'Pcs must be at least 1')
      .max(TAKA_PCS_MAX, `At most ${TAKA_PCS_MAX} pcs`)
      .optional(),
  })
  .refine((v) => v.checked !== undefined || v.actualPcs !== undefined, { message: 'Nothing to change' });
export type GodownTakaPatchInput = z.input<typeof godownTakaPatchSchema>;

/** POST /godown/takas/:id/refinish */
export const godownRefinishSchema = z.object({ note: optText(300) });

/** POST /godown/takas/:id/resolve — resolve one damage (`takaDamageId`) or, without it, every open damage of the taka. */
export const godownResolveSchema = z.object({ takaDamageId: z.number().int().positive().optional() });

/** Sprint 15: an EARLIER open damage of the order moved onto a part (its pcs are editable). */
export const splitMovedDamageSchema = z.object({ fromTakaDamageId: z.number().int().positive(), pcs: damagePcs }).strict();
export type SplitMovedDamageInput = z.input<typeof splitMovedDamageSchema>;

/** One part of a split: the first part keeps the original number. `damages` = new damages or moved earlier ones. */
export const splitPartSchema = z.object({
  takaNo,
  pcs: z
    .number({ required_error: 'Enter the pcs', invalid_type_error: 'Enter the pcs' })
    .int('Use a whole number')
    .min(1, 'Pcs must be at least 1')
    .max(TAKA_PCS_MAX, `At most ${TAKA_PCS_MAX} pcs`),
  damages: z.array(z.union([splitMovedDamageSchema, qcNewDamageSchema])).max(MAX_DAMAGES_PER_TAKA).default([]),
  refinish: z.boolean().default(false),
});

/** POST /godown/takas/:id/split */
export const godownSplitSchema = z.object({
  parts: z.array(splitPartSchema).min(2, 'A split needs at least 2 parts').max(27, 'At most 27 parts'),
});
export type GodownSplitInput = z.input<typeof godownSplitSchema>;

/** POST /godown/orders/:orderId/ready-dispatch */
export const readyDispatchSchema = z.object({
  takaIds: z
    .array(z.number().int().positive(), { required_error: 'Select at least one taka' })
    .min(1, 'Select at least one taka')
    .max(2000)
    .transform((ids) => [...new Set(ids)]),
});

/** POST /mill/challans/:id/received-count */
export const challanReceivedCountSchema = z.object({
  count: z.number({ required_error: 'Enter how many takas were received', invalid_type_error: 'Enter how many takas were received' }).int('Use a whole number').min(0, 'Cannot be negative').max(10_000),
});
export type ChallanReceivedCountInput = z.input<typeof challanReceivedCountSchema>;

/* ---------- Login + users (Sprint 12) ---------- */

export const loginSchema = z.object({
  phone: z.string().trim().regex(/^\d{10}$/, 'Wrong number or password'),
  password: z.string().min(1, 'Wrong number or password').max(MAX_PASSWORD_LENGTH),
});
export type LoginInput = z.input<typeof loginSchema>;

const userPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `At most ${MAX_PASSWORD_LENGTH} characters`);

const userFields = {
  name: z.string().trim().min(1, 'Enter the name').max(80, 'At most 80 characters'),
  phone: z.string().trim().regex(/^\d{10}$/, 'Enter a 10-digit mobile number'),
  role: z.enum(ROLE_KEYS, { errorMap: () => ({ message: 'Pick a role' }) }),
  isActive: z.boolean().default(true),
};

/** POST /users — no password = the default password (Rivoora@ + the first 3 digits of the phone). */
export const userCreateSchema = z.object({ ...userFields, password: userPassword.optional() });
export type UserCreateInput = z.input<typeof userCreateSchema>;

/** PUT /users/:id (no password here — use reset-password). */
export const userUpdateSchema = z.object(userFields);
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

/** POST /users/:id/reset-password — no password = the default password. */
export const userResetPasswordSchema = z.object({ password: userPassword.optional() });
export type UserResetPasswordInput = z.input<typeof userResetPasswordSchema>;

/* ---------- Rework, dispatch, GR, move, mark fresh (Sprint 12) ---------- */

const takaIdList = (what: string) =>
  z
    .array(z.number().int().positive(), { required_error: `Select at least one ${what}` })
    .min(1, `Select at least one ${what}`)
    .max(2000)
    .transform((ids) => [...new Set(ids)]);

/** POST /orders/:id/takas/send-back */
export const sendBackSchema = z.object({
  takaIds: takaIdList('taka'),
  target: z.enum(['butta', 'mill']),
  note: optText(300),
});
export type SendBackInput = z.input<typeof sendBackSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');

/** POST /godown/orders/:id/dispatch */
export const dispatchSchema = z.object({
  challanDate: isoDate,
  transport: optText(80),
  lrNo: optText(40),
  ewayNo: optText(40),
});
export type DispatchInput = z.input<typeof dispatchSchema>;

/** A damage on a returned item: master name or Other, damaged pcs, optional photos (like the QC damages). */
const grDamage = grDamageSchema;

/**
 * POST /dispatch/challans/:id/goods-return — lump: the returned takas (each with optional damages);
 * pcs to pcs: returned + damaged pcs (and the damage when damaged > 0). Plus the date and a note.
 */
export const goodsReturnSchema = z.union([
  z.object({
    returns: z
      .array(z.object({ takaId: z.number().int().positive(), damages: z.array(grDamage).max(MAX_DAMAGES_PER_TAKA).default([]) }))
      .min(1, 'Tick at least one returned taka')
      .max(2000),
    date: isoDate,
    note: optText(300),
  }),
  z.object({
    returnedPcs: z.number({ invalid_type_error: 'Enter the returned pcs' }).int('Use a whole number').min(1, 'At least 1 pcs').max(100000),
    damagedPcs: z.number({ invalid_type_error: 'Enter the damaged pcs' }).int('Use a whole number').min(0).max(100000).default(0),
    damage: grDamage.optional(),
    date: isoDate,
    note: optText(300),
  }),
]);
export type GoodsReturnInput = z.input<typeof goodsReturnSchema>;

/**
 * POST /orders/:id/takas/move-to-inventory — lump: the takas that leave the order; pcs to pcs: how many pcs
 * (the server picks the takas and splits one when needed). Optional note.
 */
export const moveToInventorySchema = z.union([
  z.object({ takaIds: takaIdList('taka'), note: optText(300) }).strict(),
  z.object({ pcs: z.number({ required_error: 'Enter the pcs', invalid_type_error: 'Enter the pcs' }).int('Use a whole number').min(1, 'At least 1 pcs').max(1_000_000), note: optText(300) }).strict(),
]);
export type MoveToInventoryInput = z.input<typeof moveToInventorySchema>;

/** POST /orders/:id/takas/add-from-free-stock — lump: the free takas; pcs to pcs: how many pcs. */
export const addFromFreeStockSchema = z.union([
  z.object({ takaIds: takaIdList('taka') }).strict(),
  z
    .object({
      pcs: z.number({ required_error: 'Enter the pcs', invalid_type_error: 'Enter the pcs' }).int('Use a whole number').min(1, 'At least 1 pcs').max(1_000_000),
      /** Only take free stock with this blouse option (default: any). */
      blouse: z.enum(BLOUSE_FILTERS).optional(),
    })
    .strict(),
]);
export type AddFromFreeStockInput = z.input<typeof addFromFreeStockSchema>;

/* ---------- Sprint 16: weavers, outside POs, receipts, FG purchase ---------- */

/** Weaver master: name + a 1–4 letter short code (unique among active weavers, `FG` reserved). */
export const weaverInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(PARTY_NAME_MAX_LENGTH, 'Name is too long'),
  shortCode: z
    .string({ required_error: 'Enter the short code' })
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v.length > 0, 'Enter the short code')
    .refine((v) => WEAVER_CODE_REGEX.test(v), 'Use 1 to 4 letters (A–Z)')
    .refine((v) => !RESERVED_WEAVER_CODES.includes(v), 'FG is reserved for FG purchases'),
  mobile: optText(20),
  address: optText(500),
  gstin: optText(20).transform((v) => (v ? v.toUpperCase() : null)),
  notes: optText(1000),
});
export type WeaverInput = z.input<typeof weaverInputSchema>;

/** POST /orders/:id/outside-pos and PUT /outside-pos/:id */
export const outsidePoInputSchema = z.object({
  weaverId: z.number({ required_error: 'Select the weaver', invalid_type_error: 'Select the weaver' }).int().positive('Select the weaver'),
  materialId: z.number({ required_error: 'Select the quality', invalid_type_error: 'Select the quality' }).int().positive('Select the quality'),
  quantity: z
    .number({ required_error: 'Enter the quantity', invalid_type_error: 'Enter the quantity' })
    .positive('Quantity must be more than 0')
    .max(10_000_000),
  unit: z.enum(PO_UNITS, { errorMap: () => ({ message: 'Pick pcs or meters' }) }),
  orderType: z.enum(ORDER_TYPES, { required_error: 'Pick the order type', invalid_type_error: 'Pick the order type' }),
  rate: z.number().min(0, 'Rate cannot be negative').max(100_000_000).nullish().transform((v) => v ?? null),
  poDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the PO date'),
  notes: optText(1000),
});
export type OutsidePoInput = z.input<typeof outsidePoInputSchema>;

const receiptHeader = {
  challanNo: z.string({ required_error: "Enter the challan number" }).trim().min(1, "Enter the challan number").max(40, 'At most 40 characters'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date'),
  notes: optText(1000),
};

/** A damage on a received taka: like a QC damage (type, name, pcs, photos) — the type is usually Weaver damage. */
const receiptDamage = qcNewDamageSchema;

/** One received taka: the weaver's / supplier's number (required), OUR number (optional), pcs, meters, damages. */
export const receiptRowSchema = z.object({
  weaverTakaNo: z
    .string({ required_error: 'Enter the weaver taka number' })
    .trim()
    .min(1, 'Enter the weaver taka number')
    .max(TAKA_NO_MAX_LENGTH - 4, 'Too long')
    .regex(WEAVER_TAKA_NO_REGEX, 'Use digits, - or / only'),
  ourTakaNo: z
    .string()
    .trim()
    .max(TAKA_NO_MAX_LENGTH)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || TAKA_NO_REGEX.test(v), 'Use digits, - or / (letters only as a short code at the start)'),
  pcs: takaPcs,
  meters: takaMeters,
  damages: z.array(receiptDamage).max(MAX_DAMAGES_PER_TAKA).default([]),
});
export type ReceiptRowInput = z.input<typeof receiptRowSchema>;
/** A receipt row after parsing (defaults filled in). */
export type ReceiptRow = z.infer<typeof receiptRowSchema>;

const receiptRows = z
  .array(receiptRowSchema, { required_error: 'Enter at least one taka' })
  .min(1, 'Enter at least one taka')
  .max(MAX_TAKAS_PER_SUBMIT, `At most ${MAX_TAKAS_PER_SUBMIT} takas at a time`);

/** POST /outside-pos/:id/receipts */
export const outsideReceiptSchema = z.object({ ...receiptHeader, rows: receiptRows });
export type OutsideReceiptInput = z.input<typeof outsideReceiptSchema>;

const supplierName = z.string({ required_error: 'Enter the supplier name' }).trim().min(1, 'Enter the supplier name').max(PARTY_NAME_MAX_LENGTH, 'Name is too long');

/** POST /orders/:id/fg-receipts — lump: taka rows (FG + number when ours is not typed); pcs to pcs: received pcs only. */
export const fgReceiptSchema = z.union([
  z.object({ ...receiptHeader, supplierName, rows: receiptRows }).strict(),
  z
    .object({
      ...receiptHeader,
      supplierName,
      pcs: z.number({ required_error: 'Enter the received pcs', invalid_type_error: 'Enter the received pcs' }).int('Use a whole number').min(1, 'At least 1 pcs').max(1_000_000),
      damagedPcs: z.number({ invalid_type_error: 'Enter the damaged pcs' }).int('Use a whole number').min(0).max(1_000_000).default(0),
      damage: receiptDamage.optional(),
    })
    .strict(),
]);
export type FgReceiptInput = z.input<typeof fgReceiptSchema>;

/** GET /takas/lookup?no= */
export const takaLookupQuerySchema = z.object({ no: z.string().trim().min(1, 'Enter the taka number').max(40) });

/** GET /dispatched */
export const DISPATCHED_STATUS_FILTERS = ['partly_dispatched', 'dispatched', 'returned'] as const;
export const dispatchedListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: listSearch,
  /** Sprint 13: only orders in this status (Partly dispatched / Dispatched / Returned). */
  status: z.enum(DISPATCHED_STATUS_FILTERS).optional().catch(undefined),
});
export type DispatchedListQuery = z.infer<typeof dispatchedListQuerySchema>;
