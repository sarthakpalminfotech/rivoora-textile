import type { RoleKey } from './roles';
import type { JobsheetStatusKey, OrderStatusKey } from './statuses';
import type { Unit } from './units';
import type { OrderType } from './orderTypes';
import type { Coverage, CoverageWarning } from './jobsheets';
import type { ChallanFilter, JobsheetTab, TakaTab } from './schemas';
import type { DamageType, SubStageKey, TakaStage } from './pipeline';
import type { DamageStatus } from './takas';
import type { ChallanKind } from './challans';

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

export interface DesignVariation {
  id: number;
  designId: number;
  variationNo: number;
  code: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  createdAt: string;
}

export interface DesignListItem {
  id: number;
  code: string;
  name: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  variationCount: number;
  materialName: string | null;
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
  /** Fixed material for this design, if any. */
  material: { id: number; name: string } | null;
  /** Goes for butta cutting — decides where takas go after taka entry (changing it affects takas entered from then on). */
  buttaCutting: boolean;
  createdAt: string;
  updatedAt: string;
  variations: DesignVariation[];
}

export interface OrderListItem {
  id: number;
  orderNo: number;
  customerName: string;
  materialName: string;
  quantity: number;
  unit: Unit;
  orderType: OrderType;
  brokerName: string | null;
  status: OrderStatusKey;
  orderDate: string;
  /** Variation code if the order uses one, otherwise the design code. */
  designCode: string | null;
  /** Thumbnail of the variation (or design) — the list never returns full images. */
  designThumbUrl: string | null;
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

export interface OrderDetail {
  id: number;
  orderNo: number;
  status: OrderStatusKey;
  orderType: OrderType;
  quantity: number;
  unit: Unit;
  /** Omitted entirely for roles that may not see rate. */
  rate?: number | null;
  orderDate: string;
  notes: string | null;
  sentToProductionAt: string | null;
  /** Active jobsheets of this order (undo send-for-production is only allowed at 0). */
  jobsheetCount: number;
  /** Pieces planned in the jobsheets (`orders.jobsheet_pieces`; 0 while there are none). */
  jobsheetPieces: number;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; phone: string | null; city: string | null };
  /** The order's broker (one of the customer's brokers), if any — also when that broker was removed later. */
  broker: Broker | null;
  material: { id: number; name: string; code: string | null };
  design: { id: number; code: string; name: string | null; imageUrl: string | null; thumbUrl: string | null } | null;
  variation: { id: number; code: string; imageUrl: string | null; thumbUrl: string | null } | null;
  noteImages: OrderImage[];
  history: OrderStatusHistoryEntry[];
}

export interface PreviousDesign {
  key: string;
  designId: number;
  variationId: number | null;
  code: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  orderId: number;
  orderNo: number;
  orderDate: string;
  /** Notes of that (latest) order, if any. */
  notes: string | null;
  timesUsed: number;
  /** The design's fixed material, if any. */
  material: { id: number; name: string } | null;
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
  picks: string | null;
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
}

export type JobsheetEventKind =
  | 'created'
  | 'sent'
  | 'pulled_back'
  | 'started'
  | 'completed'
  | 'machine_changed'
  | 'takas_entered'
  | 'takas_edited';

export interface JobsheetEvent {
  id: number;
  event: JobsheetEventKind;
  machineNo: number | null;
  frames: number | null;
  note: string | null;
  role: RoleKey;
  createdAt: string;
}

/** Order information on a jobsheet — only for Jemish / Gaurang (the supervisor gets `null`). */
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
}

export interface JobsheetDesign {
  /** Variation code if the order has one, otherwise the design code. */
  code: string;
  /** Base design code when `code` is a variation. */
  baseCode: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
}

export interface JobsheetDetail {
  id: number;
  jobsheetNo: number;
  status: JobsheetStatusKey;
  frames: number;
  completedFrames: number | null;
  picks: string | null;
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
  newMachineNo: number;
}

/** One card of the supervisor's Jobsheets module. */
export interface SupervisorJobsheetItem {
  id: number;
  jobsheetNo: number;
  status: JobsheetStatusKey;
  frames: number;
  completedFrames: number | null;
  picks: string | null;
  orderNo: number;
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
}

/** One card of the supervisor's Order view (only Sent / Ongoing / Completed jobsheets count). */
export interface SupervisorOrderItem extends SupervisorOrderHeader {
  counts: { pending: number; ongoing: number; completed: number; total: number };
  lastCompletedAt: string | null;
}

export type SupervisorOrderPage = Paginated<SupervisorOrderItem>;

export interface JobsheetPrintItem {
  id: number;
  jobsheetNo: number;
  orderNo: number;
  frames: number;
  picks: string | null;
  machineNos: number[];
  /** The order's jobsheet quantity (pcs). */
  jobsheetPieces: number;
  /** Variation code if the order has one, otherwise the design code. */
  designCode: string | null;
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
  /** WHERE it was found. */
  foundAt: DamageType;
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
  enteredBy: RoleKey;
  createdAt: string;
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
  picks: string | null;
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
  | { sub: SubStageKey; kind: 'takas'; connected: boolean; groups: DashboardTakaGroup[] };

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
  isDamaged: boolean;
  damages: TakaDamage[];
  stage: TakaStage;
  orderId: number;
  orderNo: number;
  jobsheetId: number;
  jobsheetNo: number;
  /** The quality = the order's material. */
  quality: string | null;
  design: TakaDesignInfo;
  /** The challans of the taka (butta cutting, mill) — the active row of each kind, also after it came back. */
  challans: TakaChallanRef[];
  /** Taka history — Jemish / Gaurang only (empty for the new roles). */
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

/** GET /takas/:id/damages — the damage details screen (Jemish / Gaurang). */
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

/** One challan card (Send → In butta cutting, Receive → Challans). */
export interface ChallanListItem {
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

export type ReceiveCode = 'received' | 'not_found' | 'not_sent' | 'already_received' | 'changed';

export interface ReceiveResult {
  takaId: number | null;
  takaNo: string;
  ok: boolean;
  code: ReceiveCode;
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
}

/** GET /orders/:id/challans */
export interface OrderChallans {
  orderId: number;
  items: OrderChallan[];
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
  designCode: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
  orderedPcs: number;
  /** Final takas not ticked yet (orders with some come first). */
  uncheckedCount: number;
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
  /** Ready for dispatch + in godown. */
  totalInGodown: number;
  /** Orders in meters / kg / g that are left out. */
  excludedOrders: number;
}

/** The header of an inventory item (a design or a variation, or "Without design"). */
export interface InventoryItemHeader {
  /** `d-<designId>` | `v-<variationId>` | `none` */
  key: string;
  /** Null for "Without design". */
  code: string | null;
  name: string | null;
  /** The base design's code when the item is a variation. */
  variationOf: string | null;
  /** The design's default quality (material), if any. */
  quality: string | null;
  thumbUrl: string | null;
  imageUrl: string | null;
}

/** One card of the All designs grid. */
export interface InventoryItemCard extends InventoryItemHeader {
  pcs: InventoryFigures;
}

/** GET /inventory/items/:key */
export interface InventoryItemDetail extends InventoryItemHeader {
  pcs: InventoryFigures;
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
  orderDate: string;
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
