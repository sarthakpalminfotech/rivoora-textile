import { z } from 'zod';
import {
  BEAM_ZONES,
  BEAM_STATUSES,
  hasKgPrecision,
  isMoveFilter,
  isYarnPoStatus,
  MAX_BEAMS_PER_JOB,
  MAX_KG,
  MAX_PO_LINES,
  MAX_WARPING_INPUTS,
  TFO_SECTIONS,
  TWIST_DIRECTIONS,
  WARPING_STATUSES,
  YARN_ITEMS,
  YARN_ZONES,
  type MoveFilter,
  type YarnPoStatus,
} from './yarn';

/** Sprint 17 — request schemas of the yarn area (server validates with these). */

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

const isoDate = (msg = 'Pick a date') => z.string({ required_error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg);

const id = (msg: string) => z.number({ required_error: msg, invalid_type_error: msg }).int(msg).positive(msg);

/** kg > 0 (or ≥ 0), at most 3 decimals. */
const kg = (msg: string, { allowZero = false } = {}) =>
  z
    .number({ required_error: msg, invalid_type_error: msg })
    .refine((v) => (allowZero ? v >= 0 : v > 0), allowZero ? 'Cannot be negative' : 'Must be more than 0 kg')
    .refine((v) => v <= MAX_KG, `At most ${MAX_KG.toLocaleString('en-IN')} kg`)
    .refine(hasKgPrecision, 'Use at most 3 decimals');

const optNumber = (max: number, msg = 'Enter a number') =>
  z
    .number({ invalid_type_error: msg })
    .positive('Must be more than 0')
    .max(max, `At most ${max.toLocaleString('en-IN')}`)
    .nullish()
    .transform((v) => v ?? null);

export const YARN_NAME_MAX_LENGTH = 120;

/* ---------- masters ---------- */

export const yarnPartyInputSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(YARN_NAME_MAX_LENGTH, 'Name is too long'),
  mobile: optText(20),
  address: optText(500),
  gstin: optText(20).transform((v) => (v ? v.toUpperCase() : null)),
  notes: optText(1000),
});
export type YarnPartyInput = z.input<typeof yarnPartyInputSchema>;

export const yarnQualityInputSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(YARN_NAME_MAX_LENGTH, 'Name is too long'),
  denier: optText(30),
  filament: optText(30),
  notes: optText(1000),
});
export type YarnQualityInput = z.input<typeof yarnQualityInputSchema>;

export const tfoMachineInputSchema = z.object({
  machineNo: z
    .number({ required_error: 'Enter the machine number', invalid_type_error: 'Enter the machine number' })
    .int('Use a whole number of at least 1')
    .min(1, 'Use a whole number of at least 1')
    .max(100_000, 'Must be at most 1,00,000'),
  name: optText(80),
  isActive: z.boolean().default(true),
});
export type TfoMachineInput = z.input<typeof tfoMachineInputSchema>;

/* ---------- Yarn PO ---------- */

export const yarnPoLineInputSchema = z.object({
  /** Kept on edit so the same line keeps its id (nothing is received while lines can change). */
  id: z.number().int().positive().nullish(),
  qualityId: id('Select the yarn quality'),
  qtyKg: kg('Enter the quantity'),
  rate: z
    .number({ required_error: 'Enter the rate', invalid_type_error: 'Enter the rate' })
    .min(0, 'Rate cannot be negative')
    .max(1_000_000, 'Rate is too high')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimals'),
});
export type YarnPoLineInput = z.input<typeof yarnPoLineInputSchema>;

export const yarnPoInputSchema = z
  .object({
    poNo: z
      .number({ required_error: 'Enter the PO number', invalid_type_error: 'Enter the PO number' })
      .int('Use a whole number')
      .min(1, 'Use a whole number of at least 1')
      .max(999_999_999, 'PO number is too long'),
    poDate: isoDate('Pick the PO date'),
    partyId: id('Select the party'),
    remark: optText(2000),
    lines: z.array(yarnPoLineInputSchema, { required_error: 'Add at least one line' }).min(1, 'Add at least one line').max(MAX_PO_LINES, `At most ${MAX_PO_LINES} lines`),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<number>();
    v.lines.forEach((l, i) => {
      if (seen.has(l.qualityId)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'qualityId'], message: 'This quality is already on the PO' });
      seen.add(l.qualityId);
    });
  });
export type YarnPoInput = z.input<typeof yarnPoInputSchema>;

/** PUT /yarn-pos/:id after yarn was received: only the remark can change. */
export const yarnPoRemarkSchema = z.object({ remark: optText(2000) }).strict();
export type YarnPoRemarkInput = z.input<typeof yarnPoRemarkSchema>;

export const yarnReceiptInputSchema = z
  .object({
    challanNo: z.string({ required_error: 'Enter the challan number' }).trim().min(1, 'Enter the challan number').max(40, 'At most 40 characters'),
    date: isoDate('Pick the date'),
    zone: z.enum(YARN_ZONES, { errorMap: () => ({ message: 'Pick the zone the yarn goes to' }) }),
    notes: optText(1000),
    lines: z
      .array(
        z.object({
          poLineId: id('Line missing'),
          qtyKg: kg('Enter the received kg', { allowZero: true }),
          boxes: z.number({ invalid_type_error: 'Use a whole number' }).int('Use a whole number').min(0, 'Cannot be negative').max(100_000).nullish().transform((v) => v ?? null),
        }),
      )
      .min(1, 'Enter the received kg')
      .max(MAX_PO_LINES),
  })
  .refine((v) => v.lines.some((l) => l.qtyKg > 0), { message: 'Enter the received kg on at least one line', path: ['lines'] });
export type YarnReceiptInput = z.input<typeof yarnReceiptInputSchema>;

const idList = (v: unknown) =>
  (typeof v === 'string' ? v.split(',') : [])
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 100);

export const yarnPoListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional().transform((v) => v || undefined),
  status: z
    .unknown()
    .transform((v): YarnPoStatus[] => (typeof v === 'string' ? v.split(',').filter(isYarnPoStatus) : [])),
  party: z.unknown().transform(idList),
  quality: z.unknown().transform(idList),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});
export type YarnPoListQuery = z.infer<typeof yarnPoListQuerySchema>;

/* ---------- stock: transfers, withdrawals ---------- */

const beamIds = z.array(z.number().int().positive(), { required_error: 'Select at least one beam' }).min(1, 'Select at least one beam').max(500);

export const yarnTransferSchema = z.discriminatedUnion('what', [
  z.object({
    what: z.enum(['raw', 'twisted']),
    from: z.enum(YARN_ZONES),
    to: z.enum(YARN_ZONES, { errorMap: () => ({ message: 'Pick the zone to move to' }) }),
    qualityId: id('Select the quality'),
    qtyKg: kg('Enter the kg'),
    note: optText(1000),
  }),
  z.object({
    what: z.literal('beams'),
    from: z.enum(BEAM_ZONES, { errorMap: () => ({ message: 'Beams can move only between Direct consumption and Warping' }) }),
    to: z.enum(BEAM_ZONES, { errorMap: () => ({ message: 'Beams can move only between Direct consumption and Warping' }) }),
    beamIds,
    note: optText(1000),
  }),
]);
export type YarnTransferInput = z.input<typeof yarnTransferSchema>;

/** POST /yarn/withdrawals — Direct consumption only (TFO = Run program, Warping = Start warping). */
export const yarnWithdrawSchema = z.discriminatedUnion('what', [
  z.object({
    what: z.enum(['raw', 'twisted']),
    zone: z.literal('direct', { errorMap: () => ({ message: 'Withdraw is for Direct consumption' }) }),
    qualityId: id('Select the quality'),
    qtyKg: kg('Enter the kg'),
    note: optText(1000),
  }),
  z.object({
    what: z.literal('beams'),
    zone: z.literal('direct', { errorMap: () => ({ message: 'Withdraw is for Direct consumption' }) }),
    beamIds,
    note: optText(1000),
  }),
]);
export type YarnWithdrawInput = z.input<typeof yarnWithdrawSchema>;

export const yarnMovesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  zone: z.enum(YARN_ZONES).optional().catch(undefined),
  kind: z.unknown().transform((v): MoveFilter[] => (typeof v === 'string' ? v.split(',').filter(isMoveFilter) : [])),
  quality: z.unknown().transform(idList),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});
export type YarnMovesQuery = z.infer<typeof yarnMovesQuerySchema>;

export const beamsQuerySchema = z.object({
  zone: z.enum(BEAM_ZONES).optional().catch(undefined),
  status: z.enum(BEAM_STATUSES).optional().catch(undefined),
});

/* ---------- TFO ---------- */

export const tfoProgramStartSchema = z.object({
  machineId: id('Pick the machine'),
  section: z.enum(TFO_SECTIONS, { errorMap: () => ({ message: 'Pick the section' }) }),
  rawQualityId: id('Select the raw yarn quality'),
  rawKg: kg('Enter the raw yarn kg'),
  outputQualityId: id('Select the output quality'),
  windingMeter: optNumber(10_000_000),
  denierFilament: optText(40),
  tpm: z
    .number({ required_error: 'Enter the TPM', invalid_type_error: 'Enter the TPM' })
    .positive('Enter the TPM')
    .max(100_000, 'TPM is too high'),
  direction: z.enum(TWIST_DIRECTIONS, { errorMap: () => ({ message: 'Pick S or Z' }) }),
  note: optText(1000),
});
export type TfoProgramStartInput = z.input<typeof tfoProgramStartSchema>;

export const tfoProgramStopSchema = z.object({
  twistedKg: kg('Enter the twisted yarn produced', { allowZero: true }),
  twistedMeters: optNumber(100_000_000),
  returnedRawKg: kg('Enter the raw yarn returned', { allowZero: true }).nullish().transform((v) => v ?? 0),
  note: optText(1000),
});
export type TfoProgramStopInput = z.input<typeof tfoProgramStopSchema>;

export const tfoProgramsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  machineId: z.coerce.number().int().positive().optional().catch(undefined),
  section: z.enum(TFO_SECTIONS).optional().catch(undefined),
});

/* ---------- warping ---------- */

export const warpingJobStartSchema = z.object({
  inputs: z
    .array(
      z.object({
        item: z.enum(YARN_ITEMS, { errorMap: () => ({ message: 'Pick raw or twisted' }) }),
        qualityId: id('Select the quality'),
        qtyKg: kg('Enter the kg'),
      }),
      { required_error: 'Add at least one input' },
    )
    .min(1, 'Add at least one input')
    .max(MAX_WARPING_INPUTS, `At most ${MAX_WARPING_INPUTS} inputs`),
  note: optText(1000),
});
export type WarpingJobStartInput = z.input<typeof warpingJobStartSchema>;

export const warpingJobDoneSchema = z.object({
  beams: z
    .array(
      z.object({
        taar: z.number({ required_error: 'Enter the taar', invalid_type_error: 'Enter the taar' }).int('Use a whole number').min(1, 'At least 1').max(1_000_000),
        panna: z.number({ required_error: 'Enter the panna', invalid_type_error: 'Enter the panna' }).positive('Enter the panna').max(100_000),
        meters: z.number({ required_error: 'Enter the meters', invalid_type_error: 'Enter the meters' }).positive('Enter the meters').max(10_000_000),
        qualityId: id('Select the quality'),
        zone: z.enum(BEAM_ZONES, { errorMap: () => ({ message: 'Pick where to keep it' }) }),
      }),
      { required_error: 'Add at least one beam' },
    )
    .min(1, 'Add at least one beam')
    .max(MAX_BEAMS_PER_JOB, `At most ${MAX_BEAMS_PER_JOB} beams`),
  note: optText(1000),
});
export type WarpingJobDoneInput = z.input<typeof warpingJobDoneSchema>;

export const warpingJobsQuerySchema = z.object({
  status: z.enum(WARPING_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
