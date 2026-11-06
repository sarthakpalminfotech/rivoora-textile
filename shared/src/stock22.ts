/**
 * Sprint 22 — finished stock: dummy taka numbers, manual Add / Remove stock, damaged lots sold, goods return against the
 * party, and the dual (pcs AND metres, never mixed) stock figures of the Inventory screens. Pure rules + request schemas.
 */
import { z } from 'zod';
import { BLOUSE_OPTIONS } from './freeStock';
import { UNITS } from './units';

/* ------------------------------------------------------------------ */
/* Dummy taka numbers (CR-12)                                           */
/* ------------------------------------------------------------------ */

/** Stock that has no taka of its own gets D01, D02 … D99, D100 … (system created, never typed by a user). */
export const DUMMY_TAKA_PREFIX = 'D';
export const DUMMY_TAKA_NO_REGEX = /^D\d{2,}$/;
export const isDummyTakaNo = (no: string | null | undefined): boolean => !!no && DUMMY_TAKA_NO_REGEX.test(no);
export const formatDummyTakaNo = (n: number): string => `${DUMMY_TAKA_PREFIX}${String(n).padStart(2, '0')}`;
/** Counter row for dummy numbers — Sprint 23 makes every counter restart each financial year in ONE helper. */
export const DUMMY_TAKA_COUNTER = 'dummy_taka_no';

/* ------------------------------------------------------------------ */
/* Dual stock figures: pcs and metres are NEVER added together          */
/* ------------------------------------------------------------------ */

export interface StockQty {
  ordered: number;
  inMaking: number;
  /** In the godown: final + ready for dispatch. */
  ready: number;
  refinish: number;
  /** Free stock (belongs to no order), fresh + damaged. */
  free: number;
  /** Open damaged quantity in the godown / free stock. */
  damaged: number;
}
export interface DualStock {
  pcs: StockQty;
  meters: StockQty;
}
export const emptyQty = (): StockQty => ({ ordered: 0, inMaking: 0, ready: 0, refinish: 0, free: 0, damaged: 0 });
export const emptyDual = (): DualStock => ({ pcs: emptyQty(), meters: emptyQty() });

const r2 = (n: number) => Math.round(n * 100) / 100;
export function addQty(a: StockQty, b: StockQty): StockQty {
  return {
    ordered: r2(a.ordered + b.ordered),
    inMaking: r2(a.inMaking + b.inMaking),
    ready: r2(a.ready + b.ready),
    refinish: r2(a.refinish + b.refinish),
    free: r2(a.free + b.free),
    damaged: r2(a.damaged + b.damaged),
  };
}
export function addDual(a: DualStock, b: DualStock): DualStock {
  return { pcs: addQty(a.pcs, b.pcs), meters: addQty(a.meters, b.meters) };
}
/** True when the figure has nothing in either unit. */
export const dualIsEmpty = (d: DualStock): boolean => (Object.values(d.pcs) as number[]).every((n) => n === 0) && (Object.values(d.meters) as number[]).every((n) => n === 0);

/** "1,240 pcs · 860.50 m" — each unit only when it has something; "0 pcs" when both are empty. */
export function dualText(pcs: number, meters: number): string {
  const parts: string[] = [];
  if (pcs > 0 || meters <= 0) parts.push(`${pcs.toLocaleString('en-IN')} pcs`);
  if (meters > 0) parts.push(`${meters.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`);
  return parts.join(' · ');
}

/**
 * Meter twin of `orderInventoryPcs` for ONE meter order. `takas` rows are aggregated per jobsheet and stage (metres =
 * actual metres). Loom metres not yet turned into takas count as "in making" (Completed: actual loom metres).
 */
export function orderInventoryMeters(
  order: { unit: string; quantity: number },
  jobsheets: readonly { id: number; status: string; meters: number | null; completedMeters: number | null; sections?: number | null }[],
  takas: readonly { jobsheetId: number; stage: string; count?: number; meters: number | null; damagedMeters?: number | null }[],
): StockQty | null {
  if (order.unit !== 'meters') return null;
  const hasTakas = new Set<number>();
  for (const t of takas) if ((t.count ?? 1) > 0) hasTakas.add(t.jobsheetId);
  let inMaking = 0;
  for (const j of jobsheets) {
    if (hasTakas.has(j.id)) continue;
    const loom = j.status === 'completed' && j.completedMeters != null ? j.completedMeters : (j.meters ?? 0);
    // loom metres × sections = cloth metres (the same rule as the dashboard bar)
    inMaking += loom * (j.sections && j.sections > 0 ? j.sections : 3);
  }
  const q = emptyQty();
  q.ordered = order.quantity;
  let ready = 0;
  let refinish = 0;
  let damaged = 0;
  for (const t of takas) {
    if ((t.count ?? 1) <= 0) continue;
    const m = t.meters ?? 0;
    if (['entered', 'rework_butta', 'at_butta', 'butta_qc', 'waiting_mill', 'at_mill', 'mill_qc'].includes(t.stage)) inMaking += m;
    else if (t.stage === 'final' || t.stage === 'ready_dispatch') ready += m;
    else if (t.stage === 'refinish') refinish += m;
    if (t.stage === 'final' || t.stage === 'ready_dispatch') damaged += t.damagedMeters ?? 0;
  }
  q.inMaking = r2(inMaking);
  q.ready = r2(ready);
  q.refinish = r2(refinish);
  q.damaged = r2(damaged);
  return q;
}

/* ------------------------------------------------------------------ */
/* Manual Add / Remove stock                                            */
/* ------------------------------------------------------------------ */

/** All four damage types are offered when stock is added by hand (the origin is unknown). */
export const STOCK_DAMAGE_TYPES = ['machine', 'butta', 'mill', 'godown'] as const;
export type StockDamageType = (typeof STOCK_DAMAGE_TYPES)[number];
export const STOCK_DAMAGE_TYPE_LABEL: Record<StockDamageType, string> = {
  machine: 'Machine damage',
  butta: 'Butta cutting damage',
  mill: 'Mill damage',
  godown: 'Supervisor marked',
};

export const STOCK_REMOVE_REASONS = ['sold', 'sample', 'lost', 'scrap', 'other'] as const;
export type StockRemoveReason = (typeof STOCK_REMOVE_REASONS)[number];
export const STOCK_REMOVE_REASON_LABEL: Record<StockRemoveReason, string> = {
  sold: 'Sold',
  sample: 'Sample',
  lost: 'Lost',
  scrap: 'Damaged / scrap',
  other: 'Other',
};

/** The remark text stored with the removal ("Sample" / "Other: sent to exhibition"). */
export function removeRemark(reason: StockRemoveReason, note: string | null): string {
  const label = STOCK_REMOVE_REASON_LABEL[reason];
  return note ? `${label}: ${note}` : label;
}

export const MANUAL_STOCK_REASON = 'manual_add';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));
const qty = (label: string, unit: 'pcs' | 'meters') =>
  unit === 'pcs'
    ? z.number({ required_error: `Enter ${label}`, invalid_type_error: `Enter ${label}` }).int('Use a whole number').min(1, 'Must be at least 1').max(1_000_000)
    : z.number({ required_error: `Enter ${label}`, invalid_type_error: `Enter ${label}` }).positive('Must be more than 0').max(1_000_000);

const damageName = z.union([
  z.object({ damageId: z.number().int().positive() }),
  z.object({ otherName: z.string().trim().min(1, 'Enter the damage name').max(60, 'At most 60 characters') }),
]);
const damageRow = z.intersection(damageName, z.object({ type: z.enum(STOCK_DAMAGE_TYPES, { required_error: 'Choose the damage type', invalid_type_error: 'Choose the damage type' }), qty: z.number().positive('Enter the damaged quantity') }));
export type StockDamageRow = z.infer<typeof damageRow>;

/** POST /inventory/stock/add */
export const addStockSchema = z
  .object({
    materialId: z.number({ required_error: 'Select the quality', invalid_type_error: 'Select the quality' }).int().positive('Select the quality'),
    designId: z.number({ required_error: 'Select the design', invalid_type_error: 'Select the design' }).int().positive('Select the design'),
    unit: z.enum(['pcs', 'meters'] as const, { errorMap: () => ({ message: 'Pick pcs or meters' }) }),
    quantity: z.number({ required_error: 'Enter the quantity', invalid_type_error: 'Enter the quantity' }).positive('Quantity must be more than 0').max(1_000_000),
    condition: z.enum(['fresh', 'damaged'] as const),
    damage: damageRow.nullish().transform((v) => v ?? null),
    blouseOption: z.enum(BLOUSE_OPTIONS).nullish().transform((v) => v ?? null),
    remark: optText(300),
  })
  .superRefine((v, ctx) => {
    if (v.unit === 'pcs' && !Number.isInteger(v.quantity)) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Use a whole number of pcs' });
    if (v.condition === 'damaged') {
      if (!v.damage) ctx.addIssue({ code: 'custom', path: ['damage'], message: 'Enter the damage' });
      else if (v.damage.qty > v.quantity) ctx.addIssue({ code: 'custom', path: ['damage', 'qty'], message: "Damaged quantity can't be more than the quantity" });
      else if (v.unit === 'pcs' && !Number.isInteger(v.damage.qty)) ctx.addIssue({ code: 'custom', path: ['damage', 'qty'], message: 'Use a whole number of pcs' });
    }
  });
export type AddStockInput = z.input<typeof addStockSchema>;

/** POST /inventory/stock/remove — tick takas (whole) or, for pcs stock, a pcs amount of one design + quality. */
export const removeStockSchema = z
  .object({
    takaIds: z.array(z.number().int().positive()).min(1).max(500).optional(),
    designId: z.number().int().positive().optional(),
    materialId: z.number().int().positive().optional(),
    pcs: qty('the pcs', 'pcs').optional(),
    reason: z.enum(STOCK_REMOVE_REASONS, { required_error: 'Pick the reason', invalid_type_error: 'Pick the reason' }),
    note: optText(300),
  })
  .superRefine((v, ctx) => {
    const byPcs = v.pcs !== undefined;
    if (!byPcs && !v.takaIds) ctx.addIssue({ code: 'custom', path: ['takaIds'], message: 'Tick the takas to remove' });
    if (byPcs && (!v.designId || !v.materialId)) ctx.addIssue({ code: 'custom', path: ['pcs'], message: 'Pick the design and quality' });
    if (byPcs && v.takaIds) ctx.addIssue({ code: 'custom', path: ['pcs'], message: 'Send either takas or pcs' });
    if (v.reason === 'other' && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Write the reason' });
  });
export type RemoveStockInput = z.input<typeof removeStockSchema>;

export const STOCK_ADJUSTMENT_KINDS = ['add', 'remove'] as const;

/* ------------------------------------------------------------------ */
/* Damaged lots sold (C9)                                               */
/* ------------------------------------------------------------------ */

export const damagedLotLabel = (no: number) => `DL-${no}`;
export const DAMAGED_LOT_COUNTER = 'damaged_lot_no';

/** POST /inventory/damaged/lots */
export const damagedLotSchema = z.object({
  takaIds: z.array(z.number().int().positive(), { required_error: 'Pick the damaged takas' }).min(1, 'Pick at least one taka').max(500),
  lotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date'),
  buyer: optText(120),
  /** Lump-sum amount in rupees (optional). */
  amount: z.number().min(0, 'Amount cannot be negative').max(1_000_000_000).nullish().transform((v) => v ?? null),
  note: optText(300),
});
export type DamagedLotInput = z.input<typeof damagedLotSchema>;

/* ------------------------------------------------------------------ */
/* Goods return against the party (CR-13 + C8)                          */
/* ------------------------------------------------------------------ */

export const PARTY_RETURN_COUNTER = 'party_return_no';
export const partyReturnLabel = (no: number) => `GR-${no}`;
export const RETURN_RECEIVED_AS = ['pcs', 'meters', 'takas'] as const;
export type ReturnReceivedAs = (typeof RETURN_RECEIVED_AS)[number];
export const RETURN_RECEIVED_AS_LABEL: Record<ReturnReceivedAs, string> = { pcs: 'Pcs', meters: 'Meters', takas: 'Takas' };
export const RETURN_STATUSES = ['pending', 'completed'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date');
const imageRef = z.object({ url: z.string().trim().min(1).max(500), thumbUrl: z.string().trim().min(1).max(500) });

/** POST /party-returns (Mark goods received) and PUT /party-returns/:id (edit while Pending). */
export const partyReturnHeaderSchema = z
  .object({
    customerId: z.number({ required_error: 'Select the party', invalid_type_error: 'Select the party' }).int().positive('Select the party'),
    receivedDate: isoDate,
    receivedAs: z.enum(RETURN_RECEIVED_AS, { required_error: 'Choose how it was received', invalid_type_error: 'Choose how it was received' }),
    /** Pcs or metres received (not used for Takas — the picked takas decide). */
    receivedQty: z.number().positive('Enter the quantity').max(10_000_000).nullish().transform((v) => v ?? null),
    /** Takas mode: our dispatched takas that came back. */
    takaIds: z.array(z.number().int().positive()).max(500).default([]),
    note: optText(300),
    images: z.array(imageRef).max(10, 'At most 10 photos').default([]),
  })
  .superRefine((v, ctx) => {
    if (v.receivedAs === 'takas') {
      if (v.takaIds.length === 0) ctx.addIssue({ code: 'custom', path: ['takaIds'], message: 'Pick the takas that came back' });
    } else {
      if (v.receivedQty === null) ctx.addIssue({ code: 'custom', path: ['receivedQty'], message: 'Enter the quantity received' });
      else if (v.receivedAs === 'pcs' && !Number.isInteger(v.receivedQty)) ctx.addIssue({ code: 'custom', path: ['receivedQty'], message: 'Use a whole number of pcs' });
    }
  });
export type PartyReturnHeaderInput = z.input<typeof partyReturnHeaderSchema>;

const lineDamage = z.intersection(damageName, z.object({ type: z.enum(STOCK_DAMAGE_TYPES), qty: z.number().positive('Enter the damaged quantity') }));
/** One design line while organising a Pending return. */
export const partyReturnLineSchema = z.object({
  /** Takas mode: the returned taka this line is (its design is known). */
  takaId: z.number().int().positive().nullish().transform((v) => v ?? null),
  materialId: z.number().int().positive('Select the quality'),
  designId: z.number().int().positive('Select the design'),
  qty: z.number().positive('Enter the quantity').max(10_000_000),
  blouseOption: z.enum(BLOUSE_OPTIONS).nullish().transform((v) => v ?? null),
  damages: z.array(lineDamage).max(10).default([]),
});
export type PartyReturnLineInput = z.input<typeof partyReturnLineSchema>;
export const partyReturnLinesSchema = z.object({ lines: z.array(partyReturnLineSchema).max(200) });
export type PartyReturnLinesInput = z.input<typeof partyReturnLinesSchema>;

/** Organised vs received: "Received 120 pcs · organised 96 pcs · left 24 pcs". */
export function returnOrganised(receivedQty: number, lines: readonly { qty: number }[]): { organised: number; left: number; complete: boolean } {
  const organised = r2(lines.reduce((s, l) => s + l.qty, 0));
  const left = r2(receivedQty - organised);
  return { organised, left, complete: left === 0 && lines.length > 0 };
}

/** The damaged part of a line can never be more than the line, and the damage rows add up to at most the line. */
export function lineDamagedQty(damages: readonly { qty: number }[]): number {
  return r2(damages.reduce((s, d) => s + d.qty, 0));
}
export function lineDamageError(qtyOfLine: number, damages: readonly { qty: number }[]): string | null {
  return lineDamagedQty(damages) > qtyOfLine ? "Damaged quantity can't be more than the line" : null;
}

export const UNITS_FOR_STOCK = UNITS.filter((u) => u === 'pcs' || u === 'meters');
