import { z } from 'zod';
import {
  BEAM_REMARK_MAX_LENGTH,
  BEAM_ZONES,
  BEAM_STATUSES,
  WITHDRAW_PURPOSES,
  WITHDRAW_ZONES,

  BOX_STATUSES,
  hasKgPrecision,
  isMoveFilter,
  isYarnPoStatus,
  MAX_BEAMS_PER_JOB,
  MAX_BOXES_PER_STOP,
  MAX_KG,
  MAX_PENDING_PROGRAMS,
  MAX_PROGRAM_SECTIONS,
  MAX_PO_LINES,
  MAX_PALTI_INPUTS,
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

/** kg > 0 (or ≥ 0), at most 4 decimals. */
const kg = (msg: string, { allowZero = false } = {}) =>
  z
    .number({ required_error: msg, invalid_type_error: msg })
    .refine((v) => (allowZero ? v >= 0 : v > 0), allowZero ? 'Cannot be negative' : 'Must be more than 0 kg')
    .refine((v) => v <= MAX_KG, `At most ${MAX_KG.toLocaleString('en-IN')} kg`)
    .refine(hasKgPrecision, 'Use at most 4 decimals');

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
  /** Sprint 25: optional minimum available kg — below it the quality shows on the Low yarn card. */
  minKg: kg('Enter the minimum kg').nullish().transform((v) => v ?? null),
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

/**
 * Sprint 24 (CR-17): every withdraw says why — Sell (party required, rate per kg optional) or Use in-house (note only).
 * Spread into each `what` branch below.
 */
const withdrawPurposeFields = {
  purpose: z.enum(WITHDRAW_PURPOSES, { errorMap: () => ({ message: 'Pick Sell or Use in-house' }) }),
  partyName: optText(YARN_NAME_MAX_LENGTH),
  /** ₹ per kg, optional (Sell only). */
  rate: z
    .number({ invalid_type_error: 'Enter the rate' })
    .min(0, 'Rate cannot be negative')
    .max(1_000_000, 'Rate is too high')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimals')
    .nullish()
    .transform((v) => v ?? null),
};

/**
 * POST /yarn/withdrawals — Sprint 24: every zone. Direct consumption (yarn, part of a box, beams), TFO (raw yarn, whole
 * boxes), Warping (raw yarn, whole boxes, beams); always with a purpose.
 */
export const yarnWithdrawSchema = z
  .discriminatedUnion('what', [
    z.object({
      what: z.literal('raw'),
      zone: z.enum(WITHDRAW_ZONES, { errorMap: () => ({ message: 'Pick the zone' }) }),
      qualityId: id('Select the quality'),
      lotId: lotIdField,
      qtyKg: kg('Enter the kg'),
      note: optText(1000),
      ...withdrawPurposeFields,
    }),
    z.object({
      what: z.literal('twisted'),
      zone: z.enum(WITHDRAW_ZONES, { errorMap: () => ({ message: 'Pick the zone' }) }),
      /** Sprint 20c: `qtyKg` null = the whole box (always the whole box outside Direct consumption). */
      boxes: z
        .array(z.object({ boxId: boxIdField, qtyKg: kg('Enter the kg').nullish().transform((v) => v ?? null) }))
        .max(200)
        .default([]),
      noBox: noBoxInput.nullish(),
      note: optText(1000),
      ...withdrawPurposeFields,
    }),
    z.object({
      what: z.literal('beams'),
      zone: z.enum(BEAM_ZONES, { errorMap: () => ({ message: 'Beams are kept in Direct consumption or Warping' }) }),
      beamIds,
      note: optText(1000),
      ...withdrawPurposeFields,
    }),
  ])
  .superRefine((v, ctx) => {
    if (v.purpose === 'sell' && !v.partyName) ctx.addIssue({ code: 'custom', path: ['partyName'], message: 'Enter the party' });
    if (v.what !== 'twisted') return;
    const hasBoxes = v.boxes.length > 0;
    const hasNoBox = !!v.noBox;
    if (hasBoxes === hasNoBox) {
      ctx.addIssue({ code: 'custom', path: ['boxes'], message: hasBoxes ? 'Pick boxes or enter "No box" kg, not both' : 'Pick at least one box, or enter "No box" kg' });
    }
  })
  // Use in-house keeps no party / rate.
  .transform((v) => (v.purpose === 'in_house' ? { ...v, partyName: null, rate: null } : v));
export type YarnWithdrawInput = z.input<typeof yarnWithdrawSchema>;

/* ---------- Sprint 20: manual add / remove (owners) ---------- */

/** POST /yarn/adjustments/add — goes in as "No lot" raw (yarn quality) / "No box" twisted (warping quality). */
export const yarnManualAddSchema = z
  .object({
    zone: z.enum(YARN_ZONES, { errorMap: () => ({ message: 'Pick the zone' }) }),
    item: z.enum(['raw', 'twisted'], { errorMap: () => ({ message: 'Pick raw or twisted' }) }),
    qualityId: id('Select the quality').nullish(),
    warpingQualityId: id('Select the quality').nullish(),
    qtyKg: kg('Enter the kg'),
    remark: optText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.item === 'raw' && !v.qualityId) ctx.addIssue({ code: 'custom', path: ['qualityId'], message: 'Select the yarn quality' });
    if (v.item === 'twisted' && !v.warpingQualityId) ctx.addIssue({ code: 'custom', path: ['warpingQualityId'], message: 'Select the warping quality' });
  });
export type YarnManualAddInput = z.input<typeof yarnManualAddSchema>;

const remarkRequired = z.string({ required_error: 'Enter the remark' }).trim().min(1, 'Enter the remark').max(1000, 'Must be at most 1000 characters');

/** POST /yarn/adjustments/remove — raw (quality + lot), twisted (boxes + kg, or No box), beams; the remark is required. */
export const yarnManualRemoveSchema = z
  .discriminatedUnion('what', [
    z.object({ what: z.literal('raw'), zone: z.enum(YARN_ZONES), qualityId: id('Select the quality'), lotId: lotIdField, qtyKg: kg('Enter the kg'), remark: remarkRequired }),
    z.object({
      what: z.literal('twisted'),
      zone: z.enum(YARN_ZONES),
      boxes: z.array(z.object({ boxId: boxIdField, qtyKg: kg('Enter the kg') })).max(200).default([]),
      noBox: noBoxInput.nullish(),
      remark: remarkRequired,
    }),
    z.object({
      what: z.literal('beams'),
      zone: z.enum(BEAM_ZONES, { errorMap: () => ({ message: 'Beams are kept in Direct consumption or Warping' }) }),
      beamIds,
      remark: remarkRequired,
    }),
  ])
  .superRefine((v, ctx) => {
    if (v.what !== 'twisted') return;
    if ((v.boxes.length > 0) === !!v.noBox) ctx.addIssue({ code: 'custom', path: ['boxes'], message: v.boxes.length ? 'Pick boxes or enter "No box" kg, not both' : 'Pick at least one box, or enter "No box" kg' });
    const seen = new Set<number>();
    v.boxes.forEach((b, i) => {
      if (seen.has(b.boxId)) ctx.addIssue({ code: 'custom', path: ['boxes', i, 'boxId'], message: 'A box appears twice' });
      seen.add(b.boxId);
    });
  });
export type YarnManualRemoveInput = z.input<typeof yarnManualRemoveSchema>;

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
  /** Sprint 24: withdrawals of one purpose only (Sell / In-house). */
  purpose: z.enum(WITHDRAW_PURPOSES).optional().catch(undefined),
});
export type YarnMovesQuery = z.infer<typeof yarnMovesQuerySchema>;

export const beamsQuerySchema = z.object({
  zone: z.enum(BEAM_ZONES).optional().catch(undefined),
  status: z.enum(BEAM_STATUSES).optional().catch(undefined),
});

/* ---------- TFO ---------- */

/**
 * Sprint 20 → 20b — a pending program (no machine yet): raw quality + LOT (null = "No lot") + rolls × winding kg (= raw
 * kg, worked out by the server) are reserved in TFO raw stock until someone starts it. No output quality any more —
 * the boxes' quality is named at stop (`tfoOutputQualityName`).
 */
export const tfoPendingProgramInputSchema = z.object({
  rawQualityId: id('Select the raw yarn quality'),
  lotId: lotIdField,
  rolls: z.number({ required_error: 'Enter the rolls', invalid_type_error: 'Enter the rolls' }).int('Use a whole number').min(1, 'At least 1').max(1_000_000),
  windingKg: kg('Enter the winding kg'),
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

/** POST /yarn/tfo/pending/:id/start — Sprint 20b: one or more idle sections (any machines, both sections of one machine allowed). */
export const tfoPendingStartSchema = z
  .object({
    sections: z
      .array(z.object({ machineId: id('Pick the machine'), section: z.enum(TFO_SECTIONS, { errorMap: () => ({ message: 'Pick the section' }) }) }), {
        required_error: 'Pick at least one machine section',
      })
      .min(1, 'Pick at least one machine section')
      .max(MAX_PROGRAM_SECTIONS, `At most ${MAX_PROGRAM_SECTIONS} sections`),
    /** Sprint 20c: start only this many rolls now (the rest stays pending). Omitted / null = the whole program. */
    rolls: z
      .number({ invalid_type_error: 'Enter the rolls' })
      .int('Use a whole number')
      .min(1, 'At least 1')
      .max(100_000)
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.sections.forEach((s, i) => {
      const k = `${s.machineId}|${s.section}`;
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['sections', i], message: 'This section is picked twice' });
      seen.add(k);
    });
  });
export type TfoPendingStartInput = z.input<typeof tfoPendingStartSchema>;

const stopBoxInput = z.object({
  rolls: z.number({ required_error: 'Enter the rolls', invalid_type_error: 'Enter the rolls' }).int('Use a whole number').min(1, 'At least 1').max(100_000),
  grossKg: kg('Enter the gross kg'),
  /** Optional. */
  avgKg: kg('Enter the avg kg').nullish().transform((v) => v ?? null),
  /** Only for S + Z programs: which twist this box is (S or Z). */
  direction: z.enum(['S', 'Z']).nullish().transform((v) => v ?? null),
});
export type TfoStopBoxInput = z.input<typeof stopBoxInput>;

/**
 * Sprint 20 → 20b — Stop: boxes (numbered by the system) with rolls + gross kg; net = gross − roll weight × rolls
 * (one roll weight for the stop). TFO output = total net; every box stays in TFO. Raw returned goes back to TFO raw stock
 * with the program's lot.
 */
export const tfoProgramStopSchema = z
  .object({
    rollWeightKg: kg('Enter the roll weight', { allowZero: true }),
    boxes: z.array(stopBoxInput).max(MAX_BOXES_PER_STOP, `At most ${MAX_BOXES_PER_STOP} boxes`).default([]),
    twistedMeters: optNumber(100_000_000),
    returnedRawKg: kg('Enter the raw yarn returned', { allowZero: true }).nullish().transform((v) => v ?? 0),
    note: optText(1000),
  })
  .superRefine((v, ctx) => {
    v.boxes.forEach((b, i) => {
      if (!(b.grossKg - v.rollWeightKg * b.rolls > 1e-9)) ctx.addIssue({ code: 'custom', path: ['boxes', i, 'grossKg'], message: 'Gross kg must be more than roll weight × rolls' });
    });
    if (!v.boxes.length && !(v.returnedRawKg > 0)) ctx.addIssue({ code: 'custom', path: ['boxes'], message: 'Add at least one box' });
  });
export type TfoProgramStopInput = z.input<typeof tfoProgramStopSchema>;

/** A reason / note typed in the shared reason box (min 3, max 300) — optional here. */
const optReason = z
  .string()
  .trim()
  .max(300, 'Must be at most 300 characters')
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || v.length >= 3, 'Write at least 3 characters');

/**
 * Sprint 24 (CR-20) — POST /yarn/tfo/programs/:id/hold: rolls made so far + rolls left (= rolls started; required when the
 * program has rolls), optional reason. The sections are freed.
 */
export const tfoProgramHoldSchema = z.object({
  rollsMade: z.number({ invalid_type_error: 'Enter the rolls made' }).int('Use a whole number').min(0, 'Cannot be negative').max(1_000_000).nullish().transform((v) => v ?? null),
  rollsLeft: z.number({ invalid_type_error: 'Enter the rolls left' }).int('Use a whole number').min(0, 'Cannot be negative').max(1_000_000).nullish().transform((v) => v ?? null),
  reason: optReason,
});
export type TfoProgramHoldInput = z.input<typeof tfoProgramHoldSchema>;

/** Sprint 24 — POST /yarn/tfo/programs/:id/resume: idle sections (any machines), like Start (`rolls` is not used here). */
export const tfoProgramResumeSchema = tfoPendingStartSchema;
export type TfoProgramResumeInput = z.input<typeof tfoProgramResumeSchema>;

/**
 * Sprint 24 (CR-20) — POST /yarn/tfo/programs/:id/part: "Complete made part" — boxes for the rolls already made (same box
 * form as Stop, no raw returned); the program keeps going with the rest.
 */
export const tfoProgramPartSchema = z
  .object({
    rollWeightKg: kg('Enter the roll weight', { allowZero: true }),
    boxes: z.array(stopBoxInput, { required_error: 'Add at least one box' }).min(1, 'Add at least one box').max(MAX_BOXES_PER_STOP, `At most ${MAX_BOXES_PER_STOP} boxes`),
    twistedMeters: optNumber(100_000_000),
    note: optText(1000),
  })
  .superRefine((v, ctx) => {
    v.boxes.forEach((b, i) => {
      if (!(b.grossKg - v.rollWeightKg * b.rolls > 1e-9)) ctx.addIssue({ code: 'custom', path: ['boxes', i, 'grossKg'], message: 'Gross kg must be more than roll weight × rolls' });
    });
  });
export type TfoProgramPartInput = z.input<typeof tfoProgramPartSchema>;

/** Sprint 24 (CR-21) — POST /yarn/tfo/programs/:id/stop-later: stop now, enter the boxes later ("Box details pending"). */
export const tfoProgramStopLaterSchema = z.object({ note: optText(1000) });
export type TfoProgramStopLaterInput = z.input<typeof tfoProgramStopLaterSchema>;


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

/** Sprint 24 (CR-24): the denier of the yarn — required number > 0, one per job. */
const denierField = z
  .number({ required_error: 'Enter the denier', invalid_type_error: 'Enter the denier' })
  .positive('Enter the denier')
  .max(100_000, 'Denier is too high');

/** POST /yarn/warping/pending/:id/start — Sprint 24: the denier is entered when the job starts. */
export const warpingStartSchema = z.object({ denier: denierField });
export type WarpingStartInput = z.input<typeof warpingStartSchema>;

/**
 * POST /yarn/warping/jobs/:id/done — one or more beams (auto numbers, kept in Warping). Sprint 24: `denier` only for jobs
 * started before it was asked at start.
 */
export const warpingJobDoneSchema = z.object({
  denier: denierField.nullish().transform((v) => v ?? null),
  beams: z
    .array(
      z.object({
        warpingQualityId: id('Select the warping quality'),
        taar: z.number({ required_error: 'Enter the taar', invalid_type_error: 'Enter the taar' }).int('Use a whole number').min(1, 'At least 1').max(1_000_000),
        panna: z.number({ required_error: 'Enter the panna', invalid_type_error: 'Enter the panna' }).positive('Enter the panna').max(100_000),
        meters: z.number({ required_error: 'Enter the meters', invalid_type_error: 'Enter the meters' }).positive('Enter the meters').max(10_000_000),
        remark: optText(BEAM_REMARK_MAX_LENGTH),
      }),
      { required_error: 'Add at least one beam' },
    )
    .min(1, 'Add at least one beam')
    .max(MAX_BEAMS_PER_JOB, `At most ${MAX_BEAMS_PER_JOB} beams`),
  note: optText(1000),
});
export type WarpingJobDoneInput = z.input<typeof warpingJobDoneSchema>;


/** GET /yarn/no-box — "No box" twisted stock of a zone. */
export const noBoxQuerySchema = z.object({ zone: z.enum(YARN_ZONES) });

export const warpingJobsQuerySchema = z.object({
  status: z.enum(WARPING_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/* ---------- Sprint 24 (CR-25): Palti ---------- */

/** One Palti input: stock from ANY zone — a box (whole: `qtyKg` null, or part), "No box" twisted kg, or raw kg of a lot. */
const paltiInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), zone: z.enum(YARN_ZONES), boxId: boxIdField, qtyKg: kg('Enter the kg').nullish().transform((v) => v ?? null) }),
  z.object({ kind: z.literal('no_box'), zone: z.enum(YARN_ZONES), qualityId: id('Select the quality').nullish(), warpingQualityId: id('Select the quality').nullish(), qtyKg: kg('Enter the kg') }),
  z.object({ kind: z.literal('raw'), zone: z.enum(YARN_ZONES), qualityId: id('Select the quality'), lotId: lotIdField, qtyKg: kg('Enter the kg') }),
]);
export type PaltiInputInput = z.input<typeof paltiInput>;

/**
 * POST /yarn/palti — leftover yarn re-wound into ONE new box: inputs (stock leaves at save) and the output box (automatic
 * number, warping quality, rolls / spindles optional, gross optional, net required, the zone it is kept in). Net may be less
 * than the inputs (the difference is recorded as waste), never more.
 */
export const paltiCreateSchema = z
  .object({
    date: isoDate('Pick the date'),
    inputs: z.array(paltiInput, { required_error: 'Add at least one input' }).min(1, 'Add at least one input').max(MAX_PALTI_INPUTS, `At most ${MAX_PALTI_INPUTS} inputs`),
    output: z.object({
      warpingQualityId: id('Select the warping quality'),
      rolls: z.number({ invalid_type_error: 'Enter the rolls' }).int('Use a whole number').min(0, 'Cannot be negative').max(100_000).nullish().transform((v) => v ?? null),
      grossKg: kg('Enter the gross kg').nullish().transform((v) => v ?? null),
      netKg: kg('Enter the net kg'),
      zone: z.enum(YARN_ZONES, { errorMap: () => ({ message: 'Pick where the box is kept' }) }),
    }),
    note: optText(1000),
  })
  .superRefine((v, ctx) => {
    const boxes = new Set<number>();
    v.inputs.forEach((i, idx) => {
      if (i.kind === 'no_box' && !!i.qualityId === !!i.warpingQualityId) ctx.addIssue({ code: 'custom', path: ['inputs', idx, 'qualityId'], message: 'Select the quality' });
      if (i.kind === 'box') {
        if (boxes.has(i.boxId)) ctx.addIssue({ code: 'custom', path: ['inputs', idx, 'boxId'], message: 'This box is already an input' });
        boxes.add(i.boxId);
      }
    });
    if (v.output.grossKg !== null && v.output.grossKg + 1e-9 < v.output.netKg) ctx.addIssue({ code: 'custom', path: ['output', 'grossKg'], message: 'Gross can’t be less than net' });
  });
export type PaltiCreateInput = z.input<typeof paltiCreateSchema>;

export const paltiListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /yarn/boxes/print?ids= — Sprint 24 (CR-18): the boxes to print stickers for. */
export const boxPrintQuerySchema = z.object({ ids: z.unknown().transform(idList).refine((v) => v.length > 0, 'Pick at least one box') });
