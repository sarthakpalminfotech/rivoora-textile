import { z } from 'zod';
import {
  BEAM_CODE_MAX_LENGTH,
  beamCodeKey,
  BEAM_ZONES,
  BEAM_STATUSES,
  BOX_DESTINATIONS,
  BOX_NO_MAX_LENGTH,
  boxNoKey,
  BOX_STATUSES,
  hasKgPrecision,
  isMoveFilter,
  isYarnPoStatus,
  MAX_BEAMS_PER_JOB,
  MAX_BOXES_PER_STOP,
  MAX_KG,
  MAX_PENDING_PROGRAMS,
  MAX_PO_LINES,
  MAX_WARPING_INPUTS,
  TFO_SECTIONS,
  TWIST_DIRECTIONS,
  WARPING_STATUSES,
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

/** Sprint 20 — Warping qualities master: twisted yarn's identity from the TFO stop onward. */
export const warpingQualityInputSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(YARN_NAME_MAX_LENGTH, 'Name is too long'),
  notes: optText(1000),
});
export type WarpingQualityInput = z.input<typeof warpingQualityInputSchema>;

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

/** Sprint 20: `poNo` is no longer in the body — it's assigned by the server (counter `yarn_po_no`). */
export const yarnPoInputSchema = z
  .object({
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

/** Sprint 20 — one allocation row: part of a lot's kg going to one zone. */
const receiptAllocationInput = z.object({
  zone: z.enum(YARN_ZONES, { errorMap: () => ({ message: 'Pick a zone' }) }),
  qtyKg: kg('Enter the kg'),
});

/** Sprint 20 — one lot received in this challan: its PO line (quality), lot no, total kg, and where it's split. */
const receiptLotInput = z
  .object({
    poLineId: id('Pick the PO line'),
    lotNo: z.string({ required_error: 'Enter the lot no.' }).trim().min(1, 'Enter the lot no.').max(40, 'At most 40 characters'),
    qtyKg: kg('Enter the kg'),
    boxes: z.number({ invalid_type_error: 'Use a whole number' }).int('Use a whole number').min(0, 'Cannot be negative').max(100_000).nullish().transform((v) => v ?? null),
    /** Any kg not allocated here goes to Direct consumption. */
    allocations: z.array(receiptAllocationInput).max(YARN_ZONES.length).default([]),
  })
  .superRefine((v, ctx) => {
    const allocatedKg = v.allocations.reduce((s, a) => s + a.qtyKg, 0);
    if (allocatedKg - v.qtyKg > 1e-6) ctx.addIssue({ code: 'custom', path: ['allocations'], message: "Allocations can't exceed the lot's kg" });
    const seen = new Set<string>();
    v.allocations.forEach((a, i) => {
      if (seen.has(a.zone)) ctx.addIssue({ code: 'custom', path: ['allocations', i, 'zone'], message: 'Pick each zone at most once' });
      seen.add(a.zone);
    });
  });
export type YarnReceiptLotInput = z.input<typeof receiptLotInput>;

export const yarnReceiptInputSchema = z.object({
  challanNo: z.string({ required_error: 'Enter the challan number' }).trim().min(1, 'Enter the challan number').max(40, 'At most 40 characters'),
  date: isoDate('Pick the date'),
  notes: optText(1000),
  lots: z.array(receiptLotInput, { required_error: 'Add at least one lot' }).min(1, 'Add at least one lot').max(MAX_PO_LINES, `At most ${MAX_PO_LINES} lots`),
});
export type YarnReceiptInput = z.input<typeof yarnReceiptInputSchema>;

/** GET /yarn/lots/check — the live "lot no. is free for this party" check. */
export const checkLotNoQuerySchema = z.object({
  partyId: z.coerce.number().int().positive(),
  lotNo: z.string().trim().min(1).max(40),
});
export type CheckLotNoQuery = z.infer<typeof checkLotNoQuerySchema>;

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
/** null / undefined on the wire both mean "No lot". */
const lotIdField = z.number().int().positive().nullish();
const boxIdField = id('Select a box');
/**
 * "No box" twisted stock: pre-Sprint-20 stock is kept under a YARN quality (`qualityId`); manual additions under a
 * WARPING quality (`warpingQualityId`). Exactly one of the two.
 */
const noBoxInput = z
  .object({ qualityId: id('Select the quality').nullish(), warpingQualityId: id('Select the quality').nullish(), qtyKg: kg('Enter the kg') })
  .refine((v) => !!v.qualityId !== !!v.warpingQualityId, { message: 'Select the quality', path: ['qualityId'] });
export type NoBoxInput = z.input<typeof noBoxInput>;

/** Sprint 20: raw moves carry a lot (null = "No lot"); twisted moves are whole boxes OR a "No box" quality + kg. */
export const yarnTransferSchema = z
  .discriminatedUnion('what', [
    z.object({
      what: z.literal('raw'),
      from: z.enum(YARN_ZONES),
      to: z.enum(YARN_ZONES, { errorMap: () => ({ message: 'Pick the zone to move to' }) }),
      qualityId: id('Select the quality'),
      lotId: lotIdField,
      qtyKg: kg('Enter the kg'),
      note: optText(1000),
    }),
    z.object({
      what: z.literal('twisted'),
      from: z.enum(YARN_ZONES),
      to: z.enum(YARN_ZONES, { errorMap: () => ({ message: 'Pick the zone to move to' }) }),
      boxIds: z.array(boxIdField).max(200).default([]),
      noBox: noBoxInput.nullish(),
      note: optText(1000),
    }),
    z.object({
      what: z.literal('beams'),
      from: z.enum(BEAM_ZONES, { errorMap: () => ({ message: 'Beams can move only between Direct consumption and Warping' }) }),
      to: z.enum(BEAM_ZONES, { errorMap: () => ({ message: 'Beams can move only between Direct consumption and Warping' }) }),
      beamIds,
      note: optText(1000),
    }),
  ])
  .superRefine((v, ctx) => {
    if (v.what !== 'twisted') return;
    const hasBoxes = v.boxIds.length > 0;
    const hasNoBox = !!v.noBox;
    if (hasBoxes === hasNoBox) {
      ctx.addIssue({ code: 'custom', path: ['boxIds'], message: hasBoxes ? 'Pick boxes or enter "No box" kg, not both' : 'Pick at least one box, or enter "No box" kg' });
    }
  });
export type YarnTransferInput = z.input<typeof yarnTransferSchema>;

/** POST /yarn/withdrawals — Direct consumption only (TFO = Run program, Warping = Start warping). */
export const yarnWithdrawSchema = z
  .discriminatedUnion('what', [
    z.object({
      what: z.literal('raw'),
      zone: z.literal('direct', { errorMap: () => ({ message: 'Withdraw is for Direct consumption' }) }),
      qualityId: id('Select the quality'),
      lotId: lotIdField,
      qtyKg: kg('Enter the kg'),
      note: optText(1000),
    }),
    z.object({
      what: z.literal('twisted'),
      zone: z.literal('direct', { errorMap: () => ({ message: 'Withdraw is for Direct consumption' }) }),
      boxes: z.array(z.object({ boxId: boxIdField, qtyKg: kg('Enter the kg') })).max(200).default([]),
      noBox: noBoxInput.nullish(),
      note: optText(1000),
    }),
    z.object({
      what: z.literal('beams'),
      zone: z.literal('direct', { errorMap: () => ({ message: 'Withdraw is for Direct consumption' }) }),
      beamIds,
      note: optText(1000),
    }),
  ])
  .superRefine((v, ctx) => {
    if (v.what !== 'twisted') return;
    const hasBoxes = v.boxes.length > 0;
    const hasNoBox = !!v.noBox;
    if (hasBoxes === hasNoBox) {
      ctx.addIssue({ code: 'custom', path: ['boxes'], message: hasBoxes ? 'Pick boxes or enter "No box" kg, not both' : 'Pick at least one box, or enter "No box" kg' });
    }
  });
export type YarnWithdrawInput = z.input<typeof yarnWithdrawSchema>;

/** GET /yarn/lots — raw lots (+ "No lot") with stock of one quality in one zone. */
export const yarnLotsQuerySchema = z.object({
  zone: z.enum(YARN_ZONES),
  qualityId: z.coerce.number().int().positive(),
});
export type YarnLotsQuery = z.infer<typeof yarnLotsQuerySchema>;

/** GET /yarn/boxes — in-stock (or used) boxes, optionally filtered by zone + searched by box no / lot no. */
export const yarnBoxesQuerySchema = z.object({
  zone: z.enum(YARN_ZONES).optional().catch(undefined),
  status: z.enum(BOX_STATUSES).optional().catch(undefined),
  search: z.string().trim().max(60).optional().transform((v) => v || undefined),
});
export type YarnBoxesQuery = z.infer<typeof yarnBoxesQuerySchema>;

export const yarnMovesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  zone: z.enum(YARN_ZONES).optional().catch(undefined),
  kind: z.unknown().transform((v): MoveFilter[] => (typeof v === 'string' ? v.split(',').filter(isMoveFilter) : [])),
  quality: z.unknown().transform(idList),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  /** Sprint 20: matches a lot no or a box no. */
  search: z.string().trim().max(60).optional().transform((v) => v || undefined),
});
export type YarnMovesQuery = z.infer<typeof yarnMovesQuerySchema>;

export const beamsQuerySchema = z.object({
  zone: z.enum(BEAM_ZONES).optional().catch(undefined),
  status: z.enum(BEAM_STATUSES).optional().catch(undefined),
});

/* ---------- TFO ---------- */

/**
 * Sprint 20 — a pending program (no machine yet): raw quality + LOT (null = "No lot") + kg are reserved in TFO raw
 * stock until someone starts it on a section.
 */
export const tfoPendingProgramInputSchema = z.object({
  rawQualityId: id('Select the raw yarn quality'),
  lotId: lotIdField,
  rawKg: kg('Enter the raw yarn kg'),
  outputQualityId: id('Select the output quality'),
  windingMeter: optNumber(10_000_000),
  denierFilament: optText(40),
  tpm: z
    .number({ required_error: 'Enter the TPM', invalid_type_error: 'Enter the TPM' })
    .positive('Enter the TPM')
    .max(100_000, 'TPM is too high'),
  direction: z.enum(TWIST_DIRECTIONS, { errorMap: () => ({ message: 'Pick S, Z or S + Z' }) }),
  note: optText(1000),
});
export type TfoPendingProgramInput = z.input<typeof tfoPendingProgramInputSchema>;

/** POST /yarn/tfo/pending — one or more programs created in one go. */
export const tfoPendingProgramsCreateSchema = z.object({
  programs: z
    .array(tfoPendingProgramInputSchema, { required_error: 'Add at least one program' })
    .min(1, 'Add at least one program')
    .max(MAX_PENDING_PROGRAMS, `At most ${MAX_PENDING_PROGRAMS} programs at once`),
});
export type TfoPendingProgramsCreateInput = z.input<typeof tfoPendingProgramsCreateSchema>;

/** POST /yarn/tfo/pending/:id/start — the idle section it runs on. */
export const tfoPendingStartSchema = z.object({
  machineId: id('Pick the machine'),
  section: z.enum(TFO_SECTIONS, { errorMap: () => ({ message: 'Pick the section' }) }),
});
export type TfoPendingStartInput = z.input<typeof tfoPendingStartSchema>;

const stopBoxInput = z.object({
  boxNo: z.string({ required_error: 'Enter the box no.' }).trim().min(1, 'Enter the box no.').max(BOX_NO_MAX_LENGTH, `At most ${BOX_NO_MAX_LENGTH} characters`),
  rolls: z.number({ required_error: 'Enter the rolls', invalid_type_error: 'Enter the rolls' }).int('Use a whole number').min(1, 'At least 1').max(100_000),
  grossKg: kg('Enter the gross wt'),
  netKg: kg('Enter the net wt'),
  avgKg: kg('Enter the avg kg'),
  zone: z.enum(BOX_DESTINATIONS, { errorMap: () => ({ message: 'Pick where the box goes' }) }).default('tfo'),
});
export type TfoStopBoxInput = z.input<typeof stopBoxInput>;

/**
 * Sprint 20 — Stop: the twisted output is recorded as BOXES under one warping quality (TFO output = total net wt);
 * raw returned goes back to TFO raw stock with the program's lot.
 */
export const tfoProgramStopSchema = z
  .object({
    warpingQualityId: id('Select the stop quality'),
    boxes: z.array(stopBoxInput).max(MAX_BOXES_PER_STOP, `At most ${MAX_BOXES_PER_STOP} boxes`).default([]),
    twistedMeters: optNumber(100_000_000),
    returnedRawKg: kg('Enter the raw yarn returned', { allowZero: true }).nullish().transform((v) => v ?? 0),
    note: optText(1000),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.boxes.forEach((b, i) => {
      const k = boxNoKey(b.boxNo);
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['boxes', i, 'boxNo'], message: 'This box no. is already on this stop' });
      seen.add(k);
      if (b.netKg > b.grossKg + 1e-9) ctx.addIssue({ code: 'custom', path: ['boxes', i, 'netKg'], message: 'Net wt can’t be more than gross wt' });
    });
    if (!v.boxes.length && !(v.returnedRawKg > 0)) ctx.addIssue({ code: 'custom', path: ['boxes'], message: 'Add at least one box' });
  });
export type TfoProgramStopInput = z.input<typeof tfoProgramStopSchema>;

/** GET /yarn/boxes/check — the live "box no. is free" check (box numbers are unique across all boxes). */
export const checkBoxNoQuerySchema = z.object({ boxNo: z.string().trim().min(1).max(BOX_NO_MAX_LENGTH) });

export const tfoProgramsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  machineId: z.coerce.number().int().positive().optional().catch(undefined),
  section: z.enum(TFO_SECTIONS).optional().catch(undefined),
});

/* ---------- warping ---------- */

/** Sprint 20 — one input of a pending warping job (all from Warping stock, reserved while pending). */
const warpingInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('raw'), qualityId: id('Select the quality'), lotId: lotIdField, qtyKg: kg('Enter the kg') }),
  z.object({ kind: z.literal('box'), boxId: boxIdField, qtyKg: kg('Enter the kg') }),
  z.object({ kind: z.literal('no_box'), qualityId: id('Select the quality').nullish(), warpingQualityId: id('Select the quality').nullish(), qtyKg: kg('Enter the kg') }),
]);
export type WarpingInputInput = z.input<typeof warpingInput>;

/** POST /yarn/warping/pending · PUT /yarn/warping/pending/:id — inputs + taar + panna + meters OR Full meter. */
export const warpingPendingJobSchema = z
  .object({
    inputs: z.array(warpingInput, { required_error: 'Add at least one input' }).min(1, 'Add at least one input').max(MAX_WARPING_INPUTS, `At most ${MAX_WARPING_INPUTS} inputs`),
    taar: z.number({ required_error: 'Enter the taar', invalid_type_error: 'Enter the taar' }).int('Use a whole number').min(1, 'At least 1').max(1_000_000),
    panna: z.number({ required_error: 'Enter the panna', invalid_type_error: 'Enter the panna' }).positive('Enter the panna').max(100_000),
    meters: z.number({ invalid_type_error: 'Enter the meters' }).positive('Enter the meters').max(10_000_000).nullish().transform((v) => v ?? null),
    fullMeter: z.boolean().default(false),
    note: optText(1000),
  })
  .superRefine((v, ctx) => {
    if (!v.fullMeter && v.meters === null) ctx.addIssue({ code: 'custom', path: ['meters'], message: 'Enter the meters, or tick Full meter' });
    const boxes = new Set<number>();
    v.inputs.forEach((i, idx) => {
      if (i.kind === 'no_box' && !!i.qualityId === !!i.warpingQualityId) ctx.addIssue({ code: 'custom', path: ['inputs', idx, 'qualityId'], message: 'Select the quality' });
      if (i.kind === 'box') {
        if (boxes.has(i.boxId)) ctx.addIssue({ code: 'custom', path: ['inputs', idx, 'boxId'], message: 'This box is already an input' });
        boxes.add(i.boxId);
      }
    });
  })
  .transform((v) => (v.fullMeter ? { ...v, meters: null } : v));
export type WarpingPendingJobInput = z.input<typeof warpingPendingJobSchema>;

/** POST /yarn/warping/jobs/:id/done — one or more beams: typed beam no. (unique across all beams), warping quality, … */
export const warpingJobDoneSchema = z
  .object({
    beams: z
      .array(
        z.object({
          beamCode: z.string({ required_error: 'Enter the beam no.' }).trim().min(1, 'Enter the beam no.').max(BEAM_CODE_MAX_LENGTH, `At most ${BEAM_CODE_MAX_LENGTH} characters`),
          warpingQualityId: id('Select the warping quality'),
          taar: z.number({ required_error: 'Enter the taar', invalid_type_error: 'Enter the taar' }).int('Use a whole number').min(1, 'At least 1').max(1_000_000),
          panna: z.number({ required_error: 'Enter the panna', invalid_type_error: 'Enter the panna' }).positive('Enter the panna').max(100_000),
          meters: z.number({ required_error: 'Enter the meters', invalid_type_error: 'Enter the meters' }).positive('Enter the meters').max(10_000_000),
          zone: z.enum(BEAM_ZONES, { errorMap: () => ({ message: 'Pick where to keep it' }) }),
        }),
        { required_error: 'Add at least one beam' },
      )
      .min(1, 'Add at least one beam')
      .max(MAX_BEAMS_PER_JOB, `At most ${MAX_BEAMS_PER_JOB} beams`),
    note: optText(1000),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.beams.forEach((b, i) => {
      const k = beamCodeKey(b.beamCode);
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['beams', i, 'beamCode'], message: 'This beam no. is already on this job' });
      seen.add(k);
    });
  });
export type WarpingJobDoneInput = z.input<typeof warpingJobDoneSchema>;

/** GET /yarn/beams/check — the live "beam no. is free" check. */
export const checkBeamCodeQuerySchema = z.object({ code: z.string().trim().min(1).max(BEAM_CODE_MAX_LENGTH) });

/** GET /yarn/no-box — "No box" twisted stock of a zone. */
export const noBoxQuerySchema = z.object({ zone: z.enum(YARN_ZONES) });

export const warpingJobsQuerySchema = z.object({
  status: z.enum(WARPING_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
