import type { RoleKey } from './roles';
import type { JobsheetStatusKey, OrderStatusKey } from './statuses';
import type { Unit } from './units';
import type { OrderType } from './orderTypes';
import type { Coverage, CoverageWarning } from './jobsheets';
import type { ChallanFilter, JobsheetTab, TakaTab } from './schemas';
import type { DamageType, SubStageKey, TakaStage } from './pipeline';
import type { DamageStatus } from './takas';
import type { ChallanKind } from './challans';
import type { BlouseOption, DamageRecordedAt, FreeStockReason, TakaSource } from './freeStock';
import type { OrderKind, OrderSteps, StepLocks } from './orderSteps';
import type { OutsidePoTotals, PoStatus, PoUnit, ReceiptKind } from './outside';

export interface ApiErrorBody {
  error: { message: string; field?: string };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface LookupItem {
  id: number;
  name: string;
  code?: string | null;
  city?: string | null;
}

/** A broker of a customer (just a name). */
export interface Broker {
  id: number;
  name: string;
}

export interface Customer {
  id: number;
  name: string;
  /** Active brokers, by name. */
  brokers: Broker[];
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  gstNumber: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Material {
  id: number;
  name: string;
  code: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Damage master entry: what the damage is (Hole, Oil stain…). */
export interface Damage {
  id: number;
  name: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Sprint 18: a quality (material) a design belongs to. */
export interface DesignQuality {
  id: number;
  name: string;
}

export interface DesignListItem {
  id: number;
  code: string;
  name: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  /** Sprint 18: every quality the design is in, by name (empty = "No quality"). */
  qualities: DesignQuality[];
  /** Goes for butta cutting (shows a "Butta" tag). */
  buttaCutting: boolean;
}

export interface Design {
  id: number;
  code: string;
  name: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  notes: string | null;
  /** Sprint 18: the qualities (materials) the design belongs to, by name — one or more (older designs may have none). */
  qualities: DesignQuality[];
  /** Goes for butta cutting — decides where takas go after taka entry (changing it affects takas entered from then on). */
  buttaCutting: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Sprint 18: one quality group of the design library (`GET /designs/qualities`): the Design master's first level and
 * the Saved designs drawer. `materialId: null` = "No quality" (designs that have none yet).
 */
export interface DesignQualityGroup {
  materialId: number | null;
  name: string;
  /** Designs in the group (matching the search, if any). */
  designCount: number;
  /** The first designs of the group (newest first) — the card's thumbnail strip / the drawer's tiles. */
  designs: DesignListItem[];
}

/** Sprint 18: POST /designs/bulk — the designs saved by "Upload many" (all in one transaction). */
export interface DesignBulkResult {
  created: { id: number; code: string }[];
}

export interface OrderListItem {
  id: number;
  orderNo: number;
  customerName: string;
  materialName: string;
  quantity: number;
  unit: Unit;
  orderType: OrderType;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  brokerName: string | null;
  status: OrderStatusKey;
  /** Sprint 15: on hold (only Jenish / Gaurang ever receive a held order). */
  isOnHold: boolean;
  orderDate: string;
  designCode: string | null;
  /** Thumbnail of the design — the list never returns full images. */
  designThumbUrl: string | null;
  /** Sprint 18: Outside order (made for another party) + that party's name (blank for roles that don't see the client). */
  isOutsideOrder: boolean;
  outsidePartyName: string | null;
  /** Sprint 16: the order's steps (the card shows "P · B · M" or an Outside production / FG purchase tag). */
  hasProduction: boolean;
  hasButta: boolean;
  hasMill: boolean;
  isClosed: boolean;
}

/** Sprint 16: a "Steps changed: …" / "Order closed" entry of the History tab. */
export interface OrderEventEntry {
  id: number;
  event: 'steps_changed' | 'order_closed';
  note: string | null;
  role: RoleKey;
  userName: string | null;
  createdAt: string;
}

/** Sprint 15: a "Put on hold" / "Released from hold" entry of the History tab. */
export interface OrderHoldEvent {
  id: number;
  event: 'held' | 'released';
  note: string | null;
  role: RoleKey;
  /** Name of the real user, when known. */
  userName: string | null;
  createdAt: string;
}

export interface OrderStatusHistoryEntry {
  id: number;
  fromStatus: OrderStatusKey | null;
  toStatus: OrderStatusKey;
  role: RoleKey;
  changedAt: string;
}

export interface OrderImage {
  id: number;
  imageUrl: string;
  thumbUrl: string;
}

/** Sprint 13: what came back from the customer on an order ("Dispatched · 3 takas / 120 pcs returned to stock"). */
export interface OrderReturnSummary {
  takas: number;
  pcs: number;
  /** The latest revision of the dispatch challan the GR created (link to the GR). */
  challanId: number;
  challanLabel: string;
}

export interface OrderDetail {
  id: number;
  orderNo: number;
  status: OrderStatusKey;
  orderType: OrderType;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  quantity: number;
  unit: Unit;
  /** Omitted entirely for roles that may not see rate. */
  rate?: number | null;
  orderDate: string;
  notes: string | null;
  sentToProductionAt: string | null;
  /** Active jobsheets of this order (undo send-for-production is only allowed at 0). */
  jobsheetCount: number;
  /** Pieces planned in the jobsheets (live: frames in the active jobsheets × 3; 0 while there are none). */
  jobsheetPieces: number;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; phone: string | null; city: string | null };
  /** The order's broker (one of the customer's brokers), if any — also when that broker was removed later. */
  broker: Broker | null;
  material: { id: number; name: string; code: string | null };
  design: { id: number; code: string; name: string | null; imageUrl: string | null; thumbUrl: string | null } | null;
  /** Sprint 18: Outside order (made for another party) + the party's name (null / blank for roles without the client). */
  isOutsideOrder: boolean;
  outsidePartyName: string | null;
  noteImages: OrderImage[];
  history: OrderStatusHistoryEntry[];
  /** Sprint 15: hold state + its timeline entries (empty / false for roles that never see held orders). */
  isOnHold: boolean;
  heldAt: string | null;
  holdNote: string | null;
  holdEvents: OrderHoldEvent[];
  /** Sprint 13: set once goods came back (the order shows "Returned"); only for roles that see the dispatch statuses. */
  returned: OrderReturnSummary | null;
  /** Sprint 16: the order's steps + kind. */
  hasProduction: boolean;
  hasButta: boolean;
  hasMill: boolean;
  kind: OrderKind;
  /** Why a ticked step can't be removed any more (null = it can) — the Edit order form shows the reason. */
  stepLocks: StepLocks;
  /** Outside POs of the order (not cancelled) and receipts (outside + FG). */
  outsidePoCount: number;
  receiptCount: number;
  /** Sprint 16: Close order. */
  isClosed: boolean;
  closedAt: string | null;
  closeNote: string | null;
  /** "Steps changed" / "Order closed" History entries. */
  orderEvents: OrderEventEntry[];
}

export interface PreviousDesign {
  key: string;
  designId: number;
  code: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  orderId: number;
  orderNo: number;
  orderDate: string;
  /** Notes of that (latest) order, if any. */
  notes: string | null;
  timesUsed: number;
  /** Sprint 18: the design's qualities (one → pre-selected on the order; several → the user picks one). */
  qualities: DesignQuality[];
}

export interface UploadResult {
  url: string;
  thumbUrl: string;
}

export interface SendToProductionResult {
  updated: number;
  orderIds: number[];
}

/* ---------- machines ---------- */

export interface Machine {
  id: number;
  machineNo: number;
  name: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MachineLookupItem {
  id: number;
  machineNo: number;
  name: string | null;
}

/* ---------- jobsheets ---------- */

export interface JobsheetMachine {
  id: number;
  machineNo: number;
  name: string | null;
  isActive: boolean;
}

export interface MachineRef {
  id: number;
  machineNo: number;
  name: string | null;
}

export interface JobsheetListItem {
  id: number;
  jobsheetNo: number;
  orderNo: number;
  status: JobsheetStatusKey;
  /** Assigned frames. */
  frames: number;
  /** Actual frames made (Completed only). */
  completedFrames: number | null;
  /** Sprint 18: sections per beam (pcs per frame). */
  sections: number;
  machines: JobsheetMachine[];
  /** The machine it was started on (Ongoing / Completed). */
  runningMachine: MachineRef | null;
  /** Number of the jobsheet this one continues (created by Change machine). */
  parentJobsheetNo: number | null;
  sentAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** GET /orders/:id/jobsheets */
export interface OrderJobsheets {
  orderId: number;
  orderNo: number;
  unit: Unit;
  status: OrderStatusKey;
  framesPerJobsheet: number | null;
  jobsheets: JobsheetListItem[];
  /** Completed jobsheets among the active ones. */
  completedCount: number;
  coverage: Coverage;
  warnings: CoverageWarning[];
  /** Sprint 16: pcs POs of the order — the "120 pcs given outside (PO-3)" line; the coverage already leaves them out. */
  outsidePos: { poNo: number; pcs: number }[];
}

export type JobsheetEventKind =
  | 'created'
  | 'sent'
  | 'pulled_back'
  | 'started'
  | 'completed'
  | 'machine_changed'
  | 'takas_entered'
  | 'takas_edited'
  // Sprint 16: Close order cancels the Pending / Sent jobsheets.
  | 'cancelled';

export interface JobsheetEvent {
  id: number;
  event: JobsheetEventKind;
  machineNo: number | null;
  frames: number | null;
  note: string | null;
  role: RoleKey;
  createdAt: string;
}

/** Order information on a jobsheet — only for Jenish / Gaurang (the supervisor gets `null`). */
export interface JobsheetOrderInfo {
  id: number;
  orderNo: number;
  status: OrderStatusKey;
  quantity: number;
  unit: Unit;
  jobsheetPieces: number;
  targetFrames: number;
  framesPerJobsheet: number | null;
  customer: { id: number; name: string; city: string | null };
  material: { id: number; name: string; code: string | null };
}

export interface JobsheetSibling {
  id: number;
  jobsheetNo: number;
  frames: number;
  status: JobsheetStatusKey;
  completedFrames: number | null;
  /** Sprint 18: sections per beam. */
  sections: number;
}

export interface JobsheetDesign {
  code: string;
  imageUrl: string | null;
  thumbUrl: string | null;
}

export interface JobsheetDetail {
  id: number;
  jobsheetNo: number;
  /** Sprint 15: the order is on hold (only Jenish / Gaurang can open such a jobsheet). */
  orderOnHold: boolean;
  status: JobsheetStatusKey;
  frames: number;
  completedFrames: number | null;
  /** Sprint 18: sections per beam this jobsheet was made with (pcs per frame; editable while Pending). */
  sections: number;
  createdBy: RoleKey;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  machines: JobsheetMachine[];
  runningMachine: MachineRef | null;
  /** Machine chosen in Change machine — pre-selected at Start. */
  suggestedMachineId: number | null;
  parent: { id: number; jobsheetNo: number } | null;
  children: { id: number; jobsheetNo: number }[];
  /** Activity timeline, oldest first. */
  events: JobsheetEvent[];
  /** Always present (the supervisor sees it as plain text). */
  orderNo: number;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  /** Sprint 16: the order's steps (the damage types at taka entry follow them). */
  orderSteps: OrderSteps;
  design: JobsheetDesign | null;
  /** Null for the supervisor: no client, rate or order details. */
  order: JobsheetOrderInfo | null;
  /** All active jobsheets of the order (for the edit preview), by number. Empty for the supervisor. */
  siblings: JobsheetSibling[];
  /** Null for the supervisor. */
  coverage: Coverage | null;
  warnings: CoverageWarning[];
  /** Active takas, sorted by number — null for roles that can't see takas (the supervisor). */
  takas: Taka[] | null;
  /** The common taka-entry note (null when none, or for roles that can't see takas). */
  takaNote: string | null;
}

export interface JobsheetRef {
  id: number;
  jobsheetNo: number;
  frames: number;
}

export interface JobsheetCreateResult {
  orderNo: number;
  created: JobsheetRef[];
  /** The order status changed. */
  statusChanged: boolean;
}

export interface JobsheetUpdateResult {
  orderNo: number;
  updated: { id: number; jobsheetNo: number; from: number; to: number; edited: boolean }[];
  created: JobsheetRef[];
  removed: JobsheetRef[];
  /** Picks or machines of the edited jobsheet changed. */
  detailsChanged: boolean;
  coverage: Coverage;
  warnings: CoverageWarning[];
}

export interface JobsheetDeleteResult {
  orderId: number;
  /** It was the last active jobsheet: the plan was reset and the order moved back to Jobsheet pending. */
  orderReset: boolean;
}

export interface JobsheetSendResult {
  updated: number;
  jobsheetIds: number[];
}

/** Result of pull back / start / complete. */
export interface JobsheetActionResult {
  id: number;
  jobsheetNo: number;
  orderNo: number;
  status: JobsheetStatusKey;
  machineNo: number | null;
}

export interface JobsheetChangeMachineResult {
  orderNo: number;
  completed: JobsheetRef;
  created: JobsheetRef;
  newMachineNo?: number | null;
}

/** One card of the supervisor's Jobsheets module. */
export interface SupervisorJobsheetItem {
  id: number;
  jobsheetNo: number;
  status: JobsheetStatusKey;
  frames: number;
  completedFrames: number | null;
  orderNo: number;
  /** The order's quality (material name). */
  quality: string;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  machines: JobsheetMachine[];
  runningMachine: MachineRef | null;
  suggestedMachineId: number | null;
  parentJobsheetNo: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export type JobsheetTabCounts = Record<JobsheetTab, number>;

export interface SupervisorJobsheetPage extends Paginated<SupervisorJobsheetItem> {
  counts: JobsheetTabCounts;
  /** With `?orderId=`: the order's header (number + design only — never the client). */
  order: SupervisorOrderHeader | null;
}

/** What the supervisor sees of an order: its number and design, nothing else. */
export interface SupervisorOrderHeader {
  orderId: number;
  orderNo: number;
  designCode: string | null;
  designThumbUrl: string | null;
  designImageUrl: string | null;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
}

/** One card of the supervisor's Order view (only Sent / Ongoing / Completed jobsheets count). */
export interface SupervisorOrderItem extends SupervisorOrderHeader {
  /** Sprint 15: the order's quality (material name). */
  quality: string;
  /** Sprint 15: every machine assigned to the order's visible jobsheets — merged, unique, sorted. */
  machineNos: number[];
  counts: { pending: number; ongoing: number; completed: number; total: number };
  lastCompletedAt: string | null;
}

export type SupervisorOrderPage = Paginated<SupervisorOrderItem>;

export interface JobsheetPrintItem {
  id: number;
  jobsheetNo: number;
  orderNo: number;
  frames: number;
  machineNos: number[];
  /** The order's jobsheet quantity (pcs). */
  jobsheetPieces: number;
  /** Sprint 18: sections per beam of this jobsheet (printed small: "Sections: 4"). */
  sections: number;
  designCode: string | null;
  /** Lump or Pcs to pcs — printed under the design number. */
  orderType: OrderType;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
}

/* ---------- machine view ---------- */

export interface MachineViewJobsheet {
  id: number;
  jobsheetNo: number;
  orderNo: number;
  frames: number;
  designCode: string | null;
  thumbUrl: string | null;
  startedAt: string | null;
}

export interface MachineViewMachine {
  id: number;
  machineNo: number;
  name: string | null;
  isActive: boolean;
  /** Ongoing jobsheets on this machine, oldest start first. */
  ongoing: MachineViewJobsheet[];
  /** When the last jobsheet on this machine was completed (null if it never ran). */
  lastCompletedAt: string | null;
}

export interface MachineViewData {
  /** Active machines, by number. */
  machines: MachineViewMachine[];
  /** Inactive machines (collapsed section on the board). */
  inactive: MachineViewMachine[];
  generatedAt: string;
}

/* ---------- takas ---------- */

/** One damage of a taka (the source of truth is `taka_damages`). */
export interface TakaDamage {
  id: number;
  /** WHAT the damage is (Damage master); null on an older damage recorded without a name. */
  damageId: number | null;
  damageName: string | null;
  /** The damage TYPE (machine / butta / mill; `unmarked` = "Damage type not marked"; older: godown / customer_return). */
  foundAt: DamageType;
  /** Sprint 13: WHERE it was recorded (taka entry, butta QC, godown, goods return …); null on older damages. */
  recordedAt: DamageRecordedAt | null;
  /** Damaged pcs; null on an older (migrated) damage. */
  pcs: number | null;
  /** Pcs of the damage that were resolved (a partial resolve keeps the damage open with fewer open pcs). */
  resolvedPcs: number;
  status: DamageStatus;
  resolvedAt: string | null;
  resolvedBy: RoleKey | null;
  /** e.g. `butta_qc` */
  resolvedStage: string | null;
  createdAt: string;
  /** Photos (only the taka details drawer and the damage details screen fill this in). */
  images?: DamageImage[];
}

/** A photo of a damage (added at the Butta QC). */
export interface DamageImage {
  id: number;
  url: string;
  thumbUrl: string;
  createdAt: string;
}

export interface Taka {
  id: number;
  /** Digits (with - /), kept as text (leading zeros matter). Unique across the whole system since Sprint 7. */
  takaNo: string;
  /** Length in meters, when entered. */
  meters: number | null;
  /** Pieces in the taka (required since Sprint 6; older takas have none). */
  pcs: number | null;
  /** The taka has at least one OPEN damage (denormalized from `taka_damages`). No open damage = "Fresh". */
  isDamaged: boolean;
  /** Every damage of the taka — open ones and resolved ones. */
  damages: TakaDamage[];
  /** Where the taka is (`entered` = Taka entry done · waiting for butta cutting). See `TAKA_STAGES`. */
  stage: TakaStage;
  /** The latest active challan of the taka (butta cutting / mill, also after it came back). */
  challanId: number | null;
  challanNo: number | null;
  challanKind: ChallanKind | null;
  /** Pcs counted by the godown supervisor; null = same as pcs. */
  actualPcs: number | null;
  /** How many times the taka was sent to refinish. */
  refinishCount: number;
  /** The taka this one was split from ("1101A" → "1101"). */
  parentTakaId: number | null;
  parentTakaNo: string | null;
  /** Ticked by the godown supervisor. */
  godownCheckedAt: string | null;
  godownCheckedBy: RoleKey | null;
  /** Sprint 12: how many times the owner sent it back to butta cutting ("Re-butta ×2"). */
  reworkCount: number;
  /** Sprint 12: a return lot (pcs-to-pcs goods return) — shown with a "Return lot" tag. */
  isReturnLot: boolean;
  /** Sprint 12: set when the taka came back from a customer (GR). */
  returnedAt: string | null;
  /** Sprint 12: the order the taka was moved here from ("from Order #A"). */
  originOrderId: number | null;
  originOrderNo: number | null;
  /** Sprint 13: free stock (belongs to no order). Normally false on order screens. */
  isFreeStock: boolean;
  freeStockReason: FreeStockReason | null;
  /** Sprint 13: the taka was assigned from this jobsheet's order to ANOTHER order (its number) — it is counted there. */
  allocatedOrderNo: number | null;
  /** Sprint 16: where it came from, the weaver's own number ("W 1101") and whether our number was typed for it. */
  source: TakaSource;
  weaverTakaNo: string | null;
  hasOwnNumber: boolean;
  /** Sprint 16: the receipt it came on (outside / FG takas). */
  outsideReceiptId: number | null;
  /** Sprint 16: the one taka made for an FG pcs-to-pcs receipt ("Received lot"). */
  isReceivedLot: boolean;
  enteredBy: RoleKey;
  createdAt: string;
}

/** Sprint 16: the takas of one receipt (outside weaver challan / FG purchase) — a group on the Takas tab. */
export interface ReceiptTakaGroup {
  receiptId: number;
  kind: ReceiptKind;
  /** The weaver's / supplier's challan number. */
  challanNo: string;
  receiptDate: string;
  poId: number | null;
  poNo: number | null;
  /** The weaver (outside PO) or the supplier (FG purchase). */
  partyName: string | null;
  /** The external jobsheet the takas are on (Edit takas of this receipt uses it). */
  jobsheetId: number;
  takas: Taka[];
  /** Sprint 16: the external jobsheet's note — shared by every receipt of this order; Edit takas reads it back unchanged. */
  note: string | null;
  /** Sprint 16: the weaver's short code (outside PO) or `FG` — the prefix of a taka received without our own number. */
  prefix: string;
}

/** One jobsheet's takas (a group on the order's Takas card, or the block on the jobsheet details). */
export interface JobsheetTakaGroup {
  jobsheetId: number;
  jobsheetNo: number;
  orderNo: number;
  status: JobsheetStatusKey;
  frames: number;
  completedFrames: number | null;
  /** The machine it ran on, else its assigned machines. */
  runningMachine: MachineRef | null;
  machines: JobsheetMachine[];
  note: string | null;
  takas: Taka[];
}

/** GET /orders/:id/takas */
export interface OrderTakas {
  orderId: number;
  orderNo: number;
  total: number;
  damaged: number;
  /** Sum of the meters entered on the order's takas (null when none has meters). */
  totalMeters: number | null;
  /** Sum of the pcs entered on the order's takas (null when none has pcs). */
  totalPcs: number | null;
  /** Every active jobsheet of the order, by number (groups without takas included). */
  groups: JobsheetTakaGroup[];
  /** Sprint 16: outside / FG takas grouped by the receipt they came on (newest first). */
  receipts: ReceiptTakaGroup[];
}

/** GET /takas/next-numbers — the numbers the next takas would get (not reserved until saved). */
export interface TakaNextNumbers {
  numbers: string[];
}

/** POST /jobsheets/:id/takas */
export interface TakaEntryResult {
  jobsheetId: number;
  jobsheetNo: number;
  orderNo: number;
  orderId: number;
  added: Taka[];
  /** The jobsheet wasn't Completed yet and was completed by this entry. */
  autoCompleted: boolean;
}

/** PUT /jobsheets/:id/takas */
export interface TakaEditResult {
  jobsheetId: number;
  orderId: number;
  added: number;
  removed: number;
  changed: number;
  noteChanged: boolean;
  takas: Taka[];
}

/** One card of the Taka entry Jobsheets list. */
export interface TakaJobsheetItem {
  id: number;
  jobsheetNo: number;
  status: JobsheetStatusKey;
  frames: number;
  completedFrames: number | null;
  orderNo: number;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  machines: JobsheetMachine[];
  runningMachine: MachineRef | null;
  completedAt: string | null;
  takaCount: number;
  damagedCount: number;
  lastTakaAt: string | null;
}

export interface TakaJobsheetPage extends Paginated<TakaJobsheetItem> {
  counts: Record<TakaTab, number>;
}

/** GET /jobsheets/by-no/:no */
export interface JobsheetByNo {
  id: number;
  jobsheetNo: number;
  orderNo: number;
}

/* ---------- order dashboard ---------- */

/** One jobsheet row of a jobsheet sub-stage (GET /orders/:id/dashboard/items). */
export interface DashboardJobsheetItem {
  id: number;
  jobsheetNo: number;
  orderNo: number;
  status: JobsheetStatusKey;
  frames: number;
  completedFrames: number | null;
  machines: JobsheetMachine[];
  runningMachine: MachineRef | null;
  parentJobsheetNo: number | null;
  createdAt: string;
  sentAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** One jobsheet's takas in a taka sub-stage. */
export interface DashboardTakaGroup {
  jobsheetId: number;
  jobsheetNo: number;
  orderNo: number;
  status: JobsheetStatusKey;
  frames: number;
  completedFrames: number | null;
  takas: Taka[];
}

/** GET /orders/:id/dashboard/items?sub= */
export type DashboardItems =
  | { sub: SubStageKey; kind: 'jobsheets'; connected: boolean; jobsheets: DashboardJobsheetItem[] }
  | { sub: SubStageKey; kind: 'takas'; connected: boolean; groups: DashboardTakaGroup[] }
  // Sprint 16: the open outside POs ("At outside weaver" / "Given outside").
  | { sub: SubStageKey; kind: 'pos'; connected: boolean; pos: OutsidePoCard[] };

/** One damaged taka on the Damages tab, with the damages that match the filter. */
export interface DamagedTaka {
  id: number;
  takaNo: string;
  meters: number | null;
  pcs: number | null;
  stage: TakaStage;
  jobsheetId: number;
  jobsheetNo: number;
  orderNo: number;
  jobsheetStatus: JobsheetStatusKey;
  /** The jobsheet's common taka note. */
  note: string | null;
  createdAt: string;
  /** Damages of this taka that match the `type` / `resolved` filter. */
  damages: TakaDamage[];
}

/** GET /orders/:id/damages?type=&resolved= */
export interface OrderDamages {
  orderId: number;
  /** OPEN damages by where they were found, with their damaged pcs. */
  counts: { type: DamageType; count: number; pcs: number | null }[];
  /** Open damages in total. */
  total: number;
  /** Resolved damages (shown when "Show resolved" is on). */
  resolvedTotal: number;
  /** Filtered by `type` when given; resolved damages only when asked for. */
  items: DamagedTaka[];
}

/* ---------- taka details + history ---------- */

export const TAKA_EVENT_KINDS = [
  'entered',
  'sent_butta',
  'received_butta',
  'sent_mill',
  'received_mill',
  'receive_undone',
  'butta_qc_done',
  'damage_added',
  'damage_partly_resolved',
  'damage_resolved',
  'damage_kept',
  'edited',
  'challan_cancelled',
  // Sprint 9
  'mill_qc_done',
  'sent_refinish',
  'split',
  'godown_checked',
  'godown_unchecked',
  'actual_pcs_changed',
  'ready_dispatch',
  // Sprint 12
  'sent_back',
  'dispatched',
  'goods_returned',
  'moved_order',
  // Sprint 13
  'moved_to_inventory',
  'allocated_from_free_stock',
  // Sprint 16
  'received_outside',
  'received_fg',
] as const;
export type TakaEventKind = (typeof TAKA_EVENT_KINDS)[number];

export interface TakaEvent {
  id: number;
  event: TakaEventKind;
  challanId: number | null;
  challanNo: number | null;
  challanKind: ChallanKind | null;
  /** The damage the event is about (damage events only). */
  takaDamageId: number | null;
  note: string | null;
  role: RoleKey;
  /** Sprint 12: the real user who did it (name), when known. */
  userName?: string | null;
  /** Sprint 12: the dispatch challan a dispatched / goods_returned event is about. */
  dispatchChallanId?: number | null;
  dispatchChallanLabel?: string | null;
  createdAt: string;
}

/** Design of a taka's order — image + code, never the client. */
export interface TakaDesignInfo {
  code: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
}

/** GET /takas/:id and GET /takas/by-no/:no (restricted roles get no client / rate — only these fields). */
export interface TakaDetail {
  id: number;
  takaNo: string;
  meters: number | null;
  pcs: number | null;
  actualPcs: number | null;
  refinishCount: number;
  parentTakaNo: string | null;
  godownCheckedAt: string | null;
  /** Sprint 12 */
  reworkCount: number;
  isReturnLot: boolean;
  returnedAt: string | null;
  originOrderNo: number | null;
  isDamaged: boolean;
  damages: TakaDamage[];
  stage: TakaStage;
  orderId: number;
  orderNo: number;
  jobsheetId: number;
  jobsheetNo: number;
  /** The quality = the order's material. */
  quality: string | null;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  /** Sprint 13: the taka is free stock (no order; `orderNo` is the order it was made for). */
  isFreeStock: boolean;
  /** Sprint 16: where it came from + the weaver's number; the order's steps; where it has been (damage types follow). */
  source: TakaSource;
  weaverTakaNo: string | null;
  hasOwnNumber: boolean;
  orderSteps: OrderSteps;
  beenToButta: boolean;
  hasBeenToMill: boolean;
  design: TakaDesignInfo;
  /** The challans of the taka (butta cutting, mill) — the active row of each kind, also after it came back. */
  challans: TakaChallanRef[];
  /** Taka history — Jenish / Gaurang only (empty for the new roles). */
  events: TakaEvent[];
  createdAt: string;
}

/** One challan a taka is on. */
export interface TakaChallanRef {
  id: number;
  kind: ChallanKind;
  challanNo: number;
  sentAt: string;
  receivedAt: string | null;
  /** The QC after butta cutting has been completed (the taka moved on to waiting for the mill). */
  qcDone: boolean;
}

/** One damage on the damage details screen: its pcs, photos and its own timeline. */
export interface TakaDamageFull extends TakaDamage {
  createdBy: RoleKey;
  images: DamageImage[];
  /** Events of this damage (added, kept, partly resolved, resolved…), oldest first. */
  events: TakaEvent[];
}

/** GET /takas/:id/damages — the damage details screen (Jenish / Gaurang). */
export interface TakaDamagesDetail {
  taka: {
    id: number;
    takaNo: string;
    meters: number | null;
    pcs: number | null;
    stage: TakaStage;
    isDamaged: boolean;
    orderId: number;
    orderNo: number;
    jobsheetId: number;
    jobsheetNo: number;
    quality: string | null;
    design: TakaDesignInfo;
    challans: TakaChallanRef[];
  };
  /** Open damages first, then resolved ones. */
  damages: TakaDamageFull[];
}

/** GET /takas/check?no= */
export interface TakaAvailability {
  available: boolean;
  usedBy?: { orderNo: number; jobsheetNo: number };
}

/* ---------- butta parties + challans ---------- */

/** A party of a challan kind (butta party / mill party — same fields). */
export interface ChallanParty {
  id: number;
  name: string;
  address: string | null;
  mobile: string | null;
  gstin: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ButtaParty = ChallanParty;
export type MillParty = ChallanParty;

/** An order with takas ready to send (Send → Pending card). */
export interface ChallanPendingOrder {
  orderId: number;
  orderNo: number;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  quality: string | null;
  /** Takas that are READY to send (butta: waiting for butta cutting · mill: waiting for the mill). */
  takaCount: number;
  /** Meters of the ready takas. */
  totalMeters: number;
  /** The order's active takas not yet sent on a challan of this kind (ready ones included) — the "20" of "18 / 20 ready". */
  notSentCount: number;
  /**
   * Mill only: approx takas still to come from jobsheets with no takas entered yet (frames × 3). Already INCLUDED in
   * `notSentCount`, so "18 / ~30 expected" counts the whole order, not only the takas that exist.
   */
  expectedMore?: number;
}

export type ChallanPendingOrderPage = Paginated<ChallanPendingOrder>;

export interface ChallanPendingTaka {
  id: number;
  takaNo: string;
  meters: number | null;
  pcs: number | null;
  /** Has an open damage. */
  isDamaged: boolean;
  /** The current stage of the taka (a not-ready taka shows it greyed out). */
  stage: TakaStage;
  /** Can go on a challan of this kind now. */
  ready: boolean;
  /** Refinish takas: how many times it was sent to refinish (the "x2" tag). */
  refinishCount?: number;
  /** Sprint 12: how many times the owner sent it back to butta cutting ("Re-butta"). */
  reworkCount?: number;
  /** Sprint 12: a refinish taka the OWNER sent back to the mill ("Re-mill · Sent back by owner"). */
  sentBackByOwner?: boolean;
}

/** GET /butta|mill/pending-orders/:orderId/takas — every not-yet-sent taka of the order, ready ones flagged. */
export interface ChallanPendingOrderTakas {
  order: ChallanPendingOrder;
  takas: ChallanPendingTaka[];
}

export type ButtaPendingOrder = ChallanPendingOrder;
export type ButtaPendingOrderPage = ChallanPendingOrderPage;
export type ButtaPendingTaka = ChallanPendingTaka;
export type ButtaPendingOrderTakas = ChallanPendingOrderTakas;

export type ChallanStatus = 'active' | 'cancelled';

/** A design on a challan card: one entry per order + design (the thumbnails and the design preview). */
export interface ChallanDesign {
  orderNo: number;
  /** The design code. */
  designCode: string;
  thumbUrl: string | null;
  /** Full image — loaded only in the design preview. */
  imageUrl: string | null;
}

/** One challan card (Send → In butta cutting, Receive → Challans). */
export interface ChallanListItem {
  /** Distinct designs of the challan's orders, by order number. */
  designs: ChallanDesign[];
  id: number;
  kind: ChallanKind;
  challanNo: number;
  status: ChallanStatus;
  partyName: string;
  challanDate: string;
  ewayNo: string | null;
  totalTakas: number;
  totalMeters: number;
  receivedCount: number;
  /** Sprint 15: a mill challan whose takas are ALL refinish trips ("For refinish"). Never mixed with normal takas. */
  isRefinish: boolean;
  createdAt: string;
}

export interface ChallanPage extends Paginated<ChallanListItem> {
  filter: ChallanFilter;
}

export interface ChallanTakaRow {
  id: number;
  takaNo: string;
  /** Meters / pcs at the time of sending. */
  meters: number | null;
  pcs: number | null;
  receivedAt: string | null;
  /** Butta QC done. */
  qcDone: boolean;
  isDamaged: boolean;
}

export interface ChallanOrderGroup {
  orderId: number;
  orderNo: number;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  quality: string | null;
  takaCount: number;
  totalMeters: number;
  /** In butta cutting first, then received. */
  takas: ChallanTakaRow[];
}

/** GET /butta/challans/:id */
export interface ChallanDetail {
  id: number;
  kind: ChallanKind;
  challanNo: number;
  status: ChallanStatus;
  party: { id: number; name: string; address: string | null; mobile: string | null; gstin: string | null };
  challanDate: string;
  ewayNo: string | null;
  createdBy: RoleKey;
  createdAt: string;
  cancelledAt: string | null;
  totalTakas: number;
  totalMeters: number;
  receivedCount: number;
  pendingCount: number;
  /** Sprint 15: all takas are refinish trips (mill challans only). */
  isRefinish: boolean;
  /** Cancel is allowed while nothing was received (and the challan is active). */
  canCancel: boolean;
  orders: ChallanOrderGroup[];
}

/** GET /butta/challans/:id/print — no order number and no client anywhere. */
export interface ChallanPrintData {
  kind: ChallanKind;
  challanNo: number;
  status: ChallanStatus;
  challanDate: string;
  ewayNo: string | null;
  party: { name: string; address: string | null; mobile: string | null; gstin: string | null };
  /** Sprint 15: printed "FOR REFINISH" at the right end of the Quality Name row. */
  isRefinish: boolean;
  /** The qualities (materials) of the takas, in order. */
  qualities: string[];
  /** By order, then taka number — meters at the time of sending. */
  takas: { takaNo: string; meters: number | null }[];
}

export interface ChallanCreateResult {
  challanId: number;
  kind: ChallanKind;
  challanNo: number;
  totalTakas: number;
  totalMeters: number;
}

export type ReceiveCode = 'received' | 'not_found' | 'not_sent' | 'already_received' | 'changed' | 'ambiguous';

export interface ReceiveResult {
  takaId: number | null;
  takaNo: string;
  ok: boolean;
  code: ReceiveCode;
  /** Sprint 16 (`ambiguous`): several takas carry this (weaver) number — the "Which one?" picker. */
  candidates?: TakaLookupCandidate[];
  /** Plain-English reason (alerts) — filled for every result. */
  message: string;
  orderNo: number | null;
  challanId: number | null;
  challanNo: number | null;
  challanKind?: ChallanKind | null;
  meters: number | null;
  receivedAt: string | null;
}

/** POST /butta/receive */
export interface ReceiveResponse {
  results: ReceiveResult[];
  received: number;
}

/** One taka in the Butta QC "QC pending" list. */
export interface QcPendingTaka {
  id: number;
  takaNo: string;
  orderNo: number;
  meters: number | null;
  pcs: number | null;
  challanNo: number | null;
  receivedAt: string | null;
  isDamaged: boolean;
}

export type QcPendingPage = Paginated<QcPendingTaka>;

/** POST /butta-qc/:takaId */
export interface QcResult {
  takaId: number;
  takaNo: string;
  /** Mill QC: where the taka went (final = the godown, refinish = back to the mill). Butta QC: always final. */
  result?: 'final' | 'refinish';
  /** No open damage left = Fresh. */
  fresh: boolean;
  resolved: number;
  kept: number;
  added: number;
}

/** One challan on the order's Docs → Challans tab: a challan (butta or mill, also cancelled) with takas of this order. */
export interface OrderChallan {
  id: number;
  kind: ChallanKind;
  challanNo: number;
  status: ChallanStatus;
  partyName: string;
  challanDate: string;
  /** This order's takas on the challan, and their meters (at the time of sending). */
  orderTakas: number;
  orderMeters: number;
  /** The whole challan. */
  totalTakas: number;
  receivedCount: number;
  /** Sprint 15: a refinish challan (mill). */
  isRefinish: boolean;
}

/** A delivery (dispatch) challan on the Docs tab: every revision is its own row (DC-12, DC-12 R1). */
export interface OrderDeliveryChallan {
  id: number;
  kind: 'delivery';
  challanNo: number;
  revision: number;
  /** `DC-12` / `DC-12 R1` */
  label: string;
  /** active = the latest revision · revised = replaced by a later one. */
  status: 'active' | 'revised';
  challanDate: string;
  takas: number;
  pcs: number;
  meters: number;
}

/** GET /orders/:id/challans — butta + mill challans, plus delivery challans for roles that can dispatch. */
export interface OrderChallans {
  orderId: number;
  items: (OrderChallan | OrderDeliveryChallan)[];
  /** Sprint 16: the order's outside POs (print) and the receipts (outside weaver / FG challans). */
  pos: OutsidePoCard[];
  receipts: OutsideReceiptRow[];
}

/* ---------- Mill QC (Sprint 9) ---------- */

/** GET /mill-qc/taka/:no — the taka (restricted view) plus what the Mill QC may do with it. */
export interface MillQcTaka {
  taka: TakaDetail;
  /** See `millQcOpenState` in godown.ts. */
  state: 'qc' | 'qc_not_received' | 'checked' | 'never_sent';
}

/* ---------- Godown Orders (Sprint 9) ---------- */

/** One card of the godown Orders list: design, order number, ordered pcs (never the client or the rate). */
export interface GodownOrderCard {
  orderId: number;
  orderNo: number;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  orderedPcs: number;
  /** Final takas not ticked yet (orders with some come first). */
  uncheckedCount: number;
  /** Sprint 12: the client (Dhruvil only). */
  customerName: string | null;
  /** Sprint 12: takas ready for dispatch (the Dispatch button is enabled when > 0). */
  readyDispatchCount: number;
  /** Sprint 15: on hold (only Jenish / Gaurang ever receive held orders). */
  isOnHold: boolean;
}

export type GodownOrderPage = Paginated<GodownOrderCard>;

/** One final taka (or one ready to dispatch) on the godown order screen. */
export interface GodownTaka {
  id: number;
  takaNo: string;
  meters: number | null;
  /** Expected pcs. */
  pcs: number | null;
  /** Counted pcs; null = same as the expected pcs. */
  actualPcs: number | null;
  stage: TakaStage;
  checked: boolean;
  checkedAt: string | null;
  parentTakaNo: string | null;
  refinishCount: number;
  /** Open damages (name · where · open pcs) — the red D badge. */
  isDamaged: boolean;
  jobsheetId: number;
  /** Sprint 12 */
  isReturnLot: boolean;
  returnedAt: string | null;
  originOrderNo: number | null;
  /** Sprint 16 */
  source: TakaSource;
  weaverTakaNo: string | null;
  hasOwnNumber: boolean;
  isReceivedLot: boolean;
  beenToButta: boolean;
  hasBeenToMill: boolean;
}

/** GET /godown/orders/:orderId */
export interface GodownOrder {
  orderId: number;
  orderNo: number;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  quality: string | null;
  orderedPcs: number;
  /** Sprint 12: Dhruvil sees the client and the rate (null for roles without canSeeClient / canSeeRate). */
  customer: { id: number; name: string; phone: string | null; address: string | null; gstin: string | null } | null;
  brokerName: string | null;
  rate: number | null;
  /** `d-<id>` | `v-<id>` | `none` - the inventory item of the order's design (free stock lookups). */
  inventoryKey: string;
  orderType: OrderType;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  status: OrderStatusKey;
  /** Sprint 15: on hold. */
  isOnHold: boolean;
  /** Sprint 16: the order's steps (damage types) + kind (FG purchase / outside tags). */
  orderSteps: OrderSteps;
  kind: OrderKind;
  kpis: import('./godown').GodownKpis;
  /** Sprint 10: pcs tiles (ready for dispatch / refinish / damaged). */
  pcsKpis: GodownPcsKpis;
  /** Final takas (in the godown) and the ones already ready to dispatch, by taka number. */
  takas: GodownTaka[];
  /** Every active taka number of the order (the split screen suggests the next free letter from these). */
  orderTakaNos: string[];
}

/** POST /godown/takas/:id/split */
export interface GodownSplitResult {
  parentId: number;
  orderId: number;
  parts: { id: number; takaNo: string; pcs: number; meters: number | null; stage: TakaStage }[];
}

/** POST /godown/orders/:orderId/ready-dispatch */
export interface ReadyDispatchResult {
  orderId: number;
  confirmed: number;
  pcs: number;
}


/* ---------- Inventory (Sprint 10) ---------- */

/** The pcs figures of one item / of everything (see `orderInventoryPcs` in inventory.ts). */
export type InventoryFigures = import('./inventory').InventoryPcs;

/** GET /inventory/summary — the top KPIs. */
export interface InventorySummary {
  totals: InventoryFigures;
  /** Sprint 13: free stock (belongs to no order), pcs. */
  freePcs: number;
  /** Ready for dispatch + in godown. */
  totalInGodown: number;
  /** Orders in meters / kg / g that are left out. */
  excludedOrders: number;
}

/** The header of an inventory item (a design, or "Without design"). */
export interface InventoryItemHeader {
  /** `d-<designId>` | `none` (an old `v-<variationId>` link is answered with the key of the design it became). */
  key: string;
  /** Null for "Without design". */
  code: string | null;
  name: string | null;
  /** Sprint 18: the design's qualities, comma-separated (null when it has none). */
  quality: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
}

/** One card of the All designs grid. */
export interface InventoryItemCard extends InventoryItemHeader {
  pcs: InventoryFigures;
  /** Sprint 13: free stock pcs of this item (the card shows "Free 120" when > 0). */
  freePcs: number;
}

/** GET /inventory/items/:key */
export interface InventoryItemDetail extends InventoryItemHeader {
  pcs: InventoryFigures;
  /** Sprint 13: free stock of the item (after the blouse filter). */
  free: FreeStockFigures;
  /** Sprint 13: pcs per blouse option (ordered pcs + free pcs), unfiltered — for the segmented toggle. */
  blouseCounts: BlouseCounts;
  /** Sprint 13: STOCK pcs per blouse option (made / being made + free), unfiltered. */
  blouseStock: BlouseCounts;
}

/** One order of an item (GET /inventory/items/:key/orders). */
export interface InventoryOrderRow {
  orderId: number;
  orderNo: number;
  customerName: string;
  status: OrderStatusKey;
  orderedPcs: number;
  /** Ready for dispatch pcs. */
  readyPcs: number;
  /** Ready for order pcs (final takas in the godown, not yet ready for dispatch). */
  godownPcs: number;
  /** In making pcs. */
  makingPcs: number;
  orderDate: string;
  blouseOption: BlouseOption | null;
  /** Sprint 15: on hold. */
  isOnHold: boolean;
}

/** Inventory → item → Dispatched history: one fully dispatched (Dispatched / Returned) order of the design. */
export interface InventoryDispatchedOrderRow {
  orderId: number;
  orderNo: number;
  customerName: string;
  status: OrderStatusKey;
  orderDate: string;
  orderedPcs: number;
  /** Pcs of the order's dispatched takas (actual pcs). */
  dispatchedPcs: number;
  /** Date (yyyy-MM-dd) of the latest delivery challan, null when none. */
  lastDispatchDate: string | null;
  /** Delivery challans of the order (revisions not counted twice). */
  challanCount: number;
  blouseOption: BlouseOption | null;
}

/** One card of the Damaged grid. */
export interface DamagedItemCard extends InventoryItemHeader {
  damaged: number;
  inRefinish: number;
  /** Null until the stock wipe-out flow exists (a later sprint). */
  lastClearedAt: string | null;
}

/** GET /inventory/damaged/:key */
export interface DamagedItemDetail extends InventoryItemHeader {
  damaged: number;
  inRefinish: number;
  lastClearedAt: string | null;
  /** Damaged takas with an OPEN damage of this type (types with 0 included; the client hides them). */
  typeCounts: { type: DamageType; count: number }[];
  /** All listed takas (damaged stock + refinish). */
  totalTakas: number;
  refinishTakas: number;
}

/** One row of the damaged item's taka list. */
export interface DamagedTakaRow {
  id: number;
  takaNo: string;
  orderId: number;
  orderNo: number;
  stage: TakaStage;
  /** When the latest open damage was recorded (the taka's date when it has none). */
  recordedAt: string;
  /** Types of the open damages, e.g. ['machine', 'mill']. */
  types: DamageType[];
  /** Open damage names (for the search and a tooltip). */
  names: string[];
  isRefinish: boolean;
  /** Sprint 13: the taka is free stock (it belongs to no order; `orderNo` is the order it was made for). */
  isFreeStock: boolean;
}

/* Godown order screen (Sprint 10): pcs KPIs + the Damage tab's state per taka. */

export interface GodownPcsKpis {
  readyDispatchPcs: number;
  readyDispatchTakas: number;
  refinishPcs: number;
  refinishTakas: number;
  /** Open damaged pcs on the order's final / ready-for-dispatch takas. */
  damagedPcs: number;
}

/** The state shown on a damaged taka card of the godown Damage tab. */
export type GodownDamageState = 'final' | 'ready_dispatch' | 'refinish';

/** GET /godown/orders/:orderId/damages — the order's damages + the numbers behind the filter chips. */
export interface GodownDamages extends OrderDamages {
  /** Damaged takas per state (final / ready for dispatch / refinish). */
  stateCounts: { state: GodownDamageState; count: number }[];
  /** Damaged takas per damage type (takas with an OPEN damage of that type). */
  typeCounts: { type: DamageType; count: number }[];
}

/* ---------- Login + users (Sprint 12) ---------- */

/** One row of the Users master (never carries a password or hash). */
export interface UserRow {
  id: number;
  name: string;
  phone: string;
  role: RoleKey;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** GET /auth/me and POST /auth/login */
export interface AuthSession {
  user: import('./auth').AuthUser;
}

/* ---------- Rework (Sprint 12) ---------- */

/** POST /orders/:id/takas/send-back */
export interface SendBackResult {
  orderId: number;
  target: 'butta' | 'mill';
  sent: number;
  pcs: number;
}

/* ---------- Dispatch (Sprint 12) ---------- */

/** POST /godown/orders/:orderId/dispatch → the new challan. */
export interface DispatchResult {
  challanId: number;
  challanNo: number;
  orderId: number;
  takas: number;
  pcs: number;
  meters: number;
}

export interface DispatchTakaRow {
  id: number;
  takaId: number;
  takaNo: string;
  /** Sprint 16: the number printed on the challan (`printTakaNo`: ours, else the weaver's own number). */
  printNo: string;
  meters: number | null;
  pcs: number | null;
}

/** GET /dispatch/challans/:id (any revision) — also feeds the print. */
export interface DispatchChallanDetail {
  id: number;
  challanNo: number;
  revision: number;
  /** "DC-12" / "DC-12 R1" */
  label: string;
  /** Revisions: "DC-12" (the label of the revision it replaces). */
  replacesLabel: string | null;
  status: 'active' | 'revised';
  challanDate: string;
  transport: string | null;
  lrNo: string | null;
  ewayNo: string | null;
  order: {
    orderId: number;
    orderNo: number;
    orderType: OrderType;
    blouseOption: BlouseOption | null;
    status: OrderStatusKey;
    quality: string | null;
    designCode: string | null;
    thumbUrl: string | null;
  };
  customer: { name: string; address: string | null; phone: string | null; gstin: string | null };
  brokerName: string | null;
  /** Lump orders: the taka grid. */
  takas: DispatchTakaRow[];
  /** Pcs-to-pcs orders: Sr | Quality | Design | Pcs. */
  lines: { quality: string; design: string; pcs: number }[];
  totals: { takas: number; pcs: number; meters: number };
  createdAt: string;
}

/** One challan of the order dispatch screen. */
export interface DispatchChallanListItem {
  id: number;
  challanNo: number;
  revision: number;
  label: string;
  status: 'active' | 'revised';
  challanDate: string;
  takas: number;
  pcs: number;
  meters: number;
  /** A GR can still be made (active revision with something on it). */
  canGoodsReturn: boolean;
}

/** One order card of the Dispatched list. */
export interface DispatchedOrderCard {
  orderId: number;
  orderNo: number;
  /** Sprint 15: on hold (shown with a badge to Jenish / Gaurang). */
  isOnHold: boolean;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  customerName: string;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  quality: string | null;
  status: OrderStatusKey;
  orderedPcs: number;
  dispatchedPcs: number;
  latestChallanLabel: string;
  latestChallanDate: string;
}
export type DispatchedOrderPage = Paginated<DispatchedOrderCard>;

/** GET /dispatched/:orderId */
export interface DispatchedOrderDetail {
  orderId: number;
  orderNo: number;
  /** Sprint 15: on hold. */
  isOnHold: boolean;
  orderType: OrderType;
  /** Sprint 13: the order's blouse option (null = not set). */
  blouseOption: BlouseOption | null;
  status: OrderStatusKey;
  customerName: string;
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  quality: string | null;
  orderedPcs: number;
  dispatchedPcs: number;
  challans: DispatchChallanListItem[];
  /** Sprint 13: goods that came back to stock (null when there was no goods return). */
  returned: OrderReturnSummary | null;
}

/** POST /dispatch/challans/:id/goods-return */
export interface GoodsReturnResult {
  goodsReturnId: number;
  /** The revision the GR created. */
  challanId: number;
  label: string;
  returnedTakas: number;
  returnedPcs: number;
  damagedPcs: number;
  orderId: number;
}

/* ---------- Free stock (Sprint 13) ---------- */

/** POST /orders/:id/takas/move-to-inventory */
export interface MoveToInventoryResult {
  orderId: number;
  /** Takas that became free stock (a split counts its moved part). */
  takas: number;
  pcs: number;
  meters: number;
  /** pcs-to-pcs: a taka was split to move only part of it. */
  split: boolean;
}

/** POST /orders/:id/takas/add-from-free-stock */
export interface AddFromFreeStockResult {
  orderId: number;
  takas: number;
  pcs: number;
  split: boolean;
}

/** One free-stock taka (inventory item details, the Add from free stock picker). */
export interface FreeStockTaka {
  id: number;
  takaNo: string;
  stage: TakaStage;
  pcs: number | null;
  meters: number | null;
  /** The order it was made for (`takas.order_id`). */
  fromOrderId: number;
  fromOrderNo: number;
  reason: import('./freeStock').FreeStockReason | null;
  freeStockAt: string | null;
  isDamaged: boolean;
  /** Open damaged pcs. */
  damagedPcs: number;
  /** Blouse option of the origin order. */
  blouseOption: import('./freeStock').BlouseOption | null;
}

/** The free-stock figures of an item (pcs). */
export interface FreeStockFigures {
  /** Ready in the godown (`final`). */
  ready: number;
  /** Every other stage (still being made / finished). */
  making: number;
  /** Open damaged pcs on the ready free stock. */
  damaged: number;
  /** ready + making. */
  total: number;
}

/** pcs per blouse bucket (for the segmented toggle and the Add order panel). */
export type BlouseCounts = Partial<Record<'with_blouse' | 'without_blouse' | 'not_set', number>>;

/** GET /inventory/items/:key/free-stock?blouse= */
export interface ItemFreeStock {
  figures: FreeStockFigures;
  takas: FreeStockTaka[];
  /** Free pcs per blouse option (unfiltered). */
  blouseCounts: BlouseCounts;
}

/** An order a free taka can be assigned to (Inventory → Assign to order). */
export interface AssignTargetOrder {
  orderId: number;
  orderNo: number;
  customerName: string | null;
  orderType: OrderType;
  status: OrderStatusKey;
  orderedPcs: number;
  blouseOption: import('./freeStock').BlouseOption | null;
}

/** POST /inventory/takas/:id/mark-fresh */
export interface MarkFreshResult {
  takaId: number;
  resolved: number;
}

/* ---------- Sprint 16: weavers, outside POs, receipts, FG purchase, Close order ---------- */

/** An outside weaver (Weaver master). */
export interface Weaver {
  id: number;
  name: string;
  /** 1–4 capital letters; the prefix of the weaver's takas without our number (S1101). */
  shortCode: string;
  mobile: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeaverLookupItem {
  id: number;
  name: string;
  shortCode: string;
}

/** One outside PO (the order's Outside production tab, Receive goods, the Docs tab). */
export interface OutsidePoCard {
  id: number;
  poNo: number;
  /** "PO-12" */
  label: string;
  orderId: number;
  orderNo: number;
  weaver: WeaverLookupItem;
  quality: { id: number; name: string };
  quantity: number;
  unit: PoUnit;
  orderType: OrderType;
  /** Null for roles without `canSeeRate`. */
  rate: number | null;
  poDate: string;
  notes: string | null;
  status: PoStatus;
  receivedQty: number;
  receivedTakas: number;
  pendingQty: number;
  /** Edit / cancel are possible (nothing received yet). */
  canEdit: boolean;
  createdAt: string;
}

/** GET /orders/:id/outside-pos — the Outside production tab. */
export interface OrderOutside {
  orderId: number;
  orderNo: number;
  kind: OrderKind;
  totals: OutsidePoTotals;
  pos: OutsidePoCard[];
  receipts: OutsideReceiptRow[];
}

/** One receipt (a weaver's / supplier's challan received). */
export interface OutsideReceiptRow {
  id: number;
  kind: ReceiptKind;
  challanNo: string;
  receiptDate: string;
  poId: number | null;
  poNo: number | null;
  partyName: string | null;
  takas: number;
  pcs: number;
  meters: number;
  damagedPcs: number;
  notes: string | null;
  createdAt: string;
}

/** GET /outside-pos/:id/print */
export interface OutsidePoPrintData {
  poNo: number;
  label: string;
  poDate: string;
  status: PoStatus;
  weaver: { name: string; address: string | null; mobile: string | null; gstin: string | null };
  quality: string;
  quantity: number;
  unit: PoUnit;
  orderType: OrderType;
  rate: number | null;
  notes: string | null;
  orderNo: number;
  designCode: string | null;
  blouseOption: BlouseOption | null;
}

/** One open PO / FG order on the Receive goods module. Restricted roles get no client / rate. */
export interface ReceiveGoodsPo extends OutsidePoCard {
  designCode: string | null;
  thumbUrl: string | null;
  blouseOption: BlouseOption | null;
}

export interface ReceiveGoodsFgOrder {
  orderId: number;
  orderNo: number;
  orderType: OrderType;
  quantity: number;
  unit: Unit;
  quality: string;
  designCode: string | null;
  thumbUrl: string | null;
  blouseOption: BlouseOption | null;
  /** Null for roles without `canSeeClient`. */
  customerName: string | null;
  /** Takas received so far (0 = awaiting goods). */
  receivedTakas: number;
  receivedPcs: number;
}

/** GET /receive-goods */
export interface ReceiveGoodsData {
  pos: ReceiveGoodsPo[];
  fgOrders: ReceiveGoodsFgOrder[];
}

/** What the receipt form needs for one PO / FG order (GET /outside-pos/:id/receipt-form, /orders/:id/fg-receipt-form). */
export interface ReceiptFormData {
  kind: ReceiptKind;
  orderId: number;
  orderNo: number;
  orderType: OrderType;
  orderSteps: OrderSteps;
  quality: string;
  designCode: string | null;
  thumbUrl: string | null;
  blouseOption: BlouseOption | null;
  po: OutsidePoCard | null;
  /** The weaver's short code (outside PO) or `FG` (FG purchase) — the prefix of takas without our number. */
  prefix: string;
}

/** POST /outside-pos/:id/receipts and POST /orders/:id/fg-receipts */
export interface ReceiptResult {
  receiptId: number;
  orderId: number;
  orderNo: number;
  takas: { id: number; takaNo: string; weaverTakaNo: string | null; pcs: number | null }[];
  pcs: number;
  meters: number;
}

/** GET /takas/lookup?no= — every active taka whose number OR weaver number is this one ("Which one?" picker). */
export interface TakaLookupCandidate {
  id: number;
  takaNo: string;
  weaverTakaNo: string | null;
  weaverName: string | null;
  orderNo: number;
  stage: TakaStage;
  /** The number typed matched our system number exactly (it wins over weaver numbers). */
  exact: boolean;
}

/** POST /orders/:id/close */
export interface CloseOrderResult {
  orderId: number;
  orderNo: number;
  /** Ongoing jobsheets completed with the frames entered. */
  completed: number;
  /** Pending / Sent jobsheets cancelled. */
  cancelled: number;
  /** Open outside POs closed. */
  closedPos: number;
  /** Takas with us that became free stock (and their pcs). */
  freeTakas: number;
  freePcs: number;
  /** Takas still at butta cutting / the mill (they become free stock when they come back). */
  outTakas: number;
}

/** What Close order will do (GET /orders/:id/close-preview) — the summary of the confirm dialog. */
export interface ClosePreview {
  ongoing: { id: number; jobsheetNo: number; frames: number; machineNo: number | null }[];
  pendingJobsheets: number;
  openPos: number;
  freeTakas: number;
  freePcs: number;
  outTakas: number;
  dispatchedTakas: number;
}
