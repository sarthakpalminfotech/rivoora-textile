import type {
  BeamStatus,
  BeamZone,
  BoxStatus,
  MoveKind,
  TfoSection,
  TwistDirection,
  WarpingInputKind,
  WarpingStatus,
  YarnItem,
  YarnPoEventKind,
  YarnPoStatus,
  YarnRefType,
  YarnZone,
} from './yarn';

/**
 * Sprint 17 — API DTOs of the yarn area. Every quantity is in GRAMS (`*G`, integers) and every money value in PAISE
 * (`*Paise`); the screens format them with `formatKg` / paise ÷ 100.
 */

export interface YarnParty {
  id: number;
  name: string;
  mobile: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface YarnQuality {
  id: number;
  name: string;
  denier: string | null;
  filament: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Sprint 20 — Warping qualities master: twisted yarn's identity from the TFO stop onward (boxes, beams). */
export interface WarpingQuality {
  id: number;
  name: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface YarnQualityLookupItem {
  id: number;
  name: string;
  denier: string | null;
  filament: string | null;
}

export interface TfoMachine {
  id: number;
  machineNo: number;
  name: string | null;
  isActive: boolean;
  /** A program runs on A or B right now (it can't be deleted then). */
  runningSections: TfoSection[];
  createdAt: string;
  updatedAt: string;
}

/** Who did something: the user's name (null for old / script rows) and the acting role. */
export interface YarnActor {
  userName: string | null;
  role: string | null;
}

/* ---------- Yarn PO ---------- */

export interface YarnPoListItem {
  id: number;
  poNo: number;
  poDate: string;
  status: YarnPoStatus;
  party: { id: number; name: string };
  /** Quality names in line order (the list shows the first + "+2"). */
  qualities: string[];
  orderedG: number;
  receivedG: number;
  pendingG: number;
  /** null for roles without the rate (`canSeeRate`). */
  amountPaise: number | null;
  createdAt: string;
}

export interface YarnPoLine {
  id: number;
  quality: { id: number; name: string };
  qtyG: number;
  /** null for roles without the rate. */
  ratePaise: number | null;
  amountPaise: number | null;
  receivedG: number;
  pendingG: number;
  overG: number;
  progress: number;
}

/** Sprint 20 — part of a receipt line's kg that went to one zone. */
export interface YarnReceiptAllocation {
  zone: YarnZone;
  qtyG: number;
}

export interface YarnReceiptLine {
  id: number;
  poLineId: number;
  quality: { id: number; name: string };
  qtyG: number;
  boxes: number | null;
  /** Sprint 20: the lot this line was received as (null on pre-Sprint-20 receipts). */
  lot: { id: number; lotNo: string } | null;
  /** Sprint 20: where this lot's kg went. Empty on pre-Sprint-20 lines — all of it went to the receipt's `zone`. */
  allocations: YarnReceiptAllocation[];
}

export interface YarnReceipt extends YarnActor {
  id: number;
  challanNo: string;
  receiptDate: string;
  /** Sprint 20: descriptive only (the biggest allocation across the whole receipt) — see each line's `allocations`. */
  zone: YarnZone;
  notes: string | null;
  totalG: number;
  lines: YarnReceiptLine[];
  createdAt: string;
}

export interface YarnPoEvent extends YarnActor {
  id: number;
  kind: YarnPoEventKind;
  note: string | null;
  createdAt: string;
}

export interface YarnPoDetail {
  id: number;
  poNo: number;
  poDate: string;
  status: YarnPoStatus;
  remark: string | null;
  party: { id: number; name: string; mobile: string | null; gstin: string | null; address: string | null };
  lines: YarnPoLine[];
  totals: { orderedG: number; receivedG: number; pendingG: number; amountPaise: number | null; progress: number };
  receipts: YarnReceipt[];
  events: YarnPoEvent[];
  createdBy: YarnActor;
  createdAt: string;
  /** What the viewer may do now (also checked on the server). */
  canEditAll: boolean;
  canEditRemark: boolean;
  canReceive: boolean;
  canClose: boolean;
  canCancel: boolean;
}

export interface YarnPoPrintData {
  poNo: number;
  poDate: string;
  status: YarnPoStatus;
  remark: string | null;
  party: { name: string; mobile: string | null; address: string | null; gstin: string | null };
  lines: { quality: string; qtyG: number; ratePaise: number; amountPaise: number }[];
  totalG: number;
  totalPaise: number;
}

export interface YarnPoWriteResult {
  id: number;
  poNo: number;
  status: YarnPoStatus;
}

export interface YarnReceiptResult {
  receiptId: number;
  poId: number;
  status: YarnPoStatus;
  totalG: number;
  /** Sprint 20: descriptive only (the biggest allocation) — see `byZone` for the real split. */
  zone: YarnZone;
  byZone: { zone: YarnZone; qtyG: number }[];
}

/* ---------- stock ---------- */

export interface YarnZoneStock {
  zone: YarnZone;
  rawG: number;
  twistedG: number;
  /** In-stock beams (0 for TFO). */
  beams: number;
  /** Sprint 20: in-stock TFO boxes kept here. */
  boxes: number;
}

export interface YarnMove extends YarnActor {
  /** `y-<id>` for yarn rows, `b-<ref>-<kind>-<zone>` for a group of beam rows of one action. */
  key: string;
  source: 'yarn' | 'beam';
  zone: YarnZone;
  kind: MoveKind;
  /** raw / twisted for yarn rows, null for beams. */
  item: YarnItem | null;
  quality: { id: number; name: string } | null;
  /** Signed grams for yarn rows; null for beams. */
  qtyG: number | null;
  /** Beams in the action (signed: + in, − out) — null for yarn rows. */
  beams: number | null;
  /** Sprint 20: the beams' codes ("BM-12", typed codes). */
  beamCodes: string[];
  refType: YarnRefType | null;
  refId: number | null;
  /** A short "what" line: "PO 104 · challan 55", "To TFO", "3A · 75D", "WJ-2"… */
  context: string | null;
  note: string | null;
  createdAt: string;
  /** Sprint 20: raw rows' lot — null = "No lot". */
  lot: { id: number; lotNo: string } | null;
  /** Sprint 20: twisted rows' box — null = "No box". */
  box: { id: number; boxNo: string } | null;
}

/** Sprint 20 — a raw-yarn lot's stock in one zone, for the lot picker (null id = "No lot"). */
export interface YarnLotStock {
  id: number | null;
  lotNo: string | null;
  partyName: string | null;
  /** Balance minus reservations (pending programs / warping jobs) — what can still be taken. */
  availableG: number;
  /** Held by pending programs / warping jobs (0 outside TFO / Warping). */
  reservedG: number;
}

/** Sprint 20 — a TFO output box, for box pickers and zone stock screens. */
export interface YarnBox {
  id: number;
  boxNo: string;
  zone: YarnZone;
  status: BoxStatus;
  warpingQuality: { id: number; name: string };
  lot: { id: number; lotNo: string; partyName: string } | null;
  rolls: number;
  grossG: number;
  netG: number;
  /** Net wt minus whatever has been withdrawn / moved out so far. */
  remainingG: number;
  /** Held by pending warping jobs (Warping zone only). */
  reservedG: number;
  programId: number;
  createdAt: string;
}

export interface YarnSummary {
  totals: { rawG: number; twistedG: number; beams: number };
  zones: YarnZoneStock[];
  tfo: { runningSections: number; activeMachines: number; pending: number };
  warping: { inProcess: number; pending: number };
  recent: YarnMove[];
}

export interface YarnQualityStock {
  quality: { id: number; name: string; denier: string | null; filament: string | null };
  rawG: number;
  twistedG: number;
}

export interface Beam {
  id: number;
  beamNo: number;
  /** Sprint 20: what is shown — typed on new beams, "BM-<n>" on older ones. */
  beamCode: string;
  zone: BeamZone;
  /** The shown quality: the warping quality on new beams, the yarn quality on older ones. */
  quality: { id: number; name: string };
  /** Sprint 20: set on beams made from Sprint 20 on. */
  warpingQuality: { id: number; name: string } | null;
  taar: number;
  panna: number;
  meters: number;
  status: BeamStatus;
  warpingJobId: number | null;
  warpingJobNo: number | null;
  createdAt: string;
  consumedAt: string | null;
  consumedNote: string | null;
}

export interface YarnZoneData {
  zone: YarnZone;
  stock: YarnZoneStock;
  /** Qualities with stock in this zone (raw or twisted ≠ 0), by name. */
  qualities: YarnQualityStock[];
  /** Sprint 20: twisted yarn recorded under a warping quality (TFO boxes, manual "No box" additions) + its boxes here. */
  warpingQualities: { quality: { id: number; name: string }; twistedG: number; boxes: number }[];
  /** In-stock beams of the zone (Direct consumption, Warping), newest first. */
  beams: Beam[];
  /** Sprint 20: raw yarn per quality + lot (null lot = "No lot"), with what pending work reserves. */
  rawLots: { quality: { id: number; name: string }; lot: { id: number; lotNo: string; partyName: string } | null; balanceG: number; reservedG: number }[];
  /** Sprint 20: in-stock boxes kept here, newest first. */
  boxes: YarnBox[];
  /** Sprint 20: "No box" twisted stock here. */
  noBox: NoBoxStock[];
}

/* ---------- TFO ---------- */

export interface TfoProgram {
  id: number;
  machineId: number;
  machineNo: number;
  section: TfoSection;
  rawQuality: { id: number; name: string };
  rawG: number;
  outputQuality: { id: number; name: string };
  windingMeter: number | null;
  denierFilament: string | null;
  tpm: number;
  direction: TwistDirection;
  note: string | null;
  status: 'running' | 'completed';
  startedAt: string;
  startedBy: YarnActor;
  stoppedAt: string | null;
  stoppedBy: YarnActor | null;
  twistedG: number | null;
  twistedMeters: number | null;
  returnedRawG: number | null;
  stopNote: string | null;
  /** Sprint 20: the raw lot issued (null = "No lot"). */
  lot: { id: number; lotNo: string; partyName: string } | null;
  /** Sprint 20: the stop quality (warping quality) of the boxes; null on older programs / while running. */
  warpingQuality: { id: number; name: string } | null;
  /** Sprint 20: boxes recorded at stop (empty for older programs). */
  boxes: TfoProgramBox[];
}

/** Sprint 20 — one box recorded at a program's stop (`zone` = where it went then; `currentZone` = where it is now). */
export interface TfoProgramBox {
  id: number;
  boxNo: string;
  rolls: number;
  grossG: number;
  netG: number;
  avgG: number;
  currentZone: YarnZone;
}

/** Sprint 20 — a TFO program waiting for a section (its raw kg reserved on its lot). */
export interface TfoPendingProgram {
  id: number;
  rawQuality: { id: number; name: string };
  lot: { id: number; lotNo: string; partyName: string } | null;
  rawG: number;
  outputQuality: { id: number; name: string };
  windingMeter: number | null;
  denierFilament: string | null;
  tpm: number;
  direction: TwistDirection;
  note: string | null;
  createdAt: string;
  createdBy: YarnActor;
}

export interface TfoBoardMachine {
  id: number;
  machineNo: number;
  name: string | null;
  sections: { section: TfoSection; program: TfoProgram | null }[];
}

export interface TfoBoard {
  machines: TfoBoardMachine[];
  runningSections: number;
  /** Sprint 20: programs waiting for a section, oldest first. */
  pending: TfoPendingProgram[];
  /** Raw stock in the TFO zone per quality (for the Create program form): balance, reserved by pending programs, available. */
  rawStock: { quality: { id: number; name: string; denier: string | null; filament: string | null }; rawG: number; reservedG: number; availableG: number }[];
}

/* ---------- warping ---------- */

/** Sprint 20 — "No box" twisted stock of a zone: under a yarn quality (old stock) or a warping quality (manual adds). */
export interface NoBoxStock {
  qualityId: number | null;
  warpingQualityId: number | null;
  name: string;
  availableG: number;
  reservedG: number;
}

export interface WarpingJobInput {
  id: number;
  item: YarnItem;
  /** Sprint 20: raw (lot) · box · no_box; older inputs are raw / no_box. */
  kind: WarpingInputKind;
  /** The shown quality (warping quality for boxes / warping-quality no-box stock, else the yarn quality). */
  quality: { id: number; name: string };
  qtyG: number;
  lot: { id: number; lotNo: string } | null;
  box: { id: number; boxNo: string } | null;
  /** Raw yarn quality id (raw / old no-box) or null. */
  qualityId: number | null;
  warpingQualityId: number | null;
}

/** Sprint 20 — a warping job waiting to start (its inputs reserved in Warping stock). */
export interface WarpingPendingJob {
  id: number;
  inputs: WarpingJobInput[];
  totalG: number;
  taar: number;
  panna: number;
  meters: number | null;
  fullMeter: boolean;
  note: string | null;
  createdAt: string;
  createdBy: YarnActor;
}

export interface WarpingJob {
  id: number;
  jobNo: number;
  status: WarpingStatus;
  note: string | null;
  inputs: WarpingJobInput[];
  totalG: number;
  /** Sprint 20: from the pending job it was started from (null on older jobs). */
  taar: number | null;
  panna: number | null;
  meters: number | null;
  fullMeter: boolean;
  startedAt: string;
  startedBy: YarnActor;
  doneAt: string | null;
  doneBy: YarnActor | null;
  beams: { id: number; beamNo: number; beamCode: string; zone: BeamZone; quality: string; taar: number; panna: number; meters: number; status: BeamStatus }[];
}

export interface WarpingDoneResult {
  jobId: number;
  beams: { id: number; beamCode: string; zone: BeamZone }[];
}
