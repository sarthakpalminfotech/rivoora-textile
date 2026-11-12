import type { RoleKey } from '@rivoora/shared';

/**
 * Sprint 26 — the in-memory model the demo simulation builds before any row is written. Times are timeline `x` values
 * (see `Clock`). A taka's stage history is its `moves`; everything that already happened has `x <= H`.
 */

export type Kind = 'pbm' | 'pm' | 'p' | 'outside' | 'fg';

export interface SimDamage {
  id: number;
  damageId: number;
  foundAt: 'machine' | 'butta' | 'mill' | 'godown' | 'unmarked';
  recordedAt: string;
  pcs: number | null;
  meters: number | null;
  x: number;
  createdBy: RoleKey;
  resolvedX: number | null;
  resolvedStage: string | null;
  resolvedBy: RoleKey | null;
  resolvedPcs: number;
  photo: boolean;
}

export interface Trip {
  kind: 'butta' | 'mill';
  partyId: number;
  taka: SimTaka;
  sendX: number;
  receiveX: number | null;
  qcX: number | null;
  isRefinish: boolean;
  lostX: number | null;
  /** Set when the challans are grouped. */
  challanId: number;
  challanTakaId: number;
}

export interface Move {
  x: number;
  stage: string;
  event: string;
  role: RoleKey;
  trip?: Trip;
  dcId?: number;
  note?: string;
}

export interface SimTaka {
  id: number;
  no: string;
  order: SimOrder;
  js: SimJs;
  pcs: number | null;
  meters: number | null;
  createdX: number;
  moves: Move[];
  source: 'production' | 'outside_po' | 'fg_purchase';
  weaverId: number | null;
  weaverTakaNo: string | null;
  receiptId: number | null;
  isReceivedLot: boolean;
  enteredBy: RoleKey;
  freeX: number | null;
  freeReason: 'moved' | 'goods_return' | 'order_closed' | 'manual_add' | null;
  freeBy: RoleKey | null;
  deletedX: number | null;
  removedReason: string | null;
  lostX: number | null;
  parentId: number | null;
  actualPcs: number | null;
  actualMeters: number | null;
  checkedX: number | null;
  refinishCount: number;
  reworkCount: number;
  hasBeenToMill: boolean;
  stageBeforeRework: string | null;
  returnedX: number | null;
  returnedFromChallanId: number | null;
  isReturnLot: boolean;
  damages: SimDamage[];
  trips: Trip[];
}

export interface SimJs {
  id: number;
  no: number;
  order: SimOrder;
  external: boolean;
  frames: number;
  meters: number | null;
  sections: number;
  createdX: number;
  sentX: number | null;
  startX: number | null;
  endX: number | null;
  entryX: number | null;
  deletedX: number | null;
  machineId: number | null;
  assigned: number[];
  parentId: number | null;
  /** Frames really woven when it ended early (machine change / hold); null = all. */
  partialFrames: number | null;
  changedMachine: boolean;
  completedOnHold: boolean;
  /** Who started / completed it on the floor. */
  floorUser: 'supervisor' | 'gaurang' | 'jemish';
  takas: SimTaka[];
}

export interface Dispatch {
  id: number;
  no: number;
  revision: number;
  parentId: number | null;
  order: SimOrder;
  x: number;
  takas: SimTaka[];
  status: 'active' | 'revised' | 'cancelled';
  cancelledX: number | null;
  cancelReason: string | null;
  transport: string;
  lrNo: string;
  vehicleNo: string | null;
}

export interface SimOrder {
  id: number;
  no: number;
  kind: Kind;
  customerIdx: number;
  customerId: number;
  brokerId: number | null;
  designIdx: number;
  designId: number;
  materialId: number;
  unit: 'pcs' | 'meters';
  qty: number;
  rate: number;
  orderType: 'lump' | 'pcs_to_pcs';
  fgType: 'saree' | 'suit';
  blouse: 'with_blouse' | 'without_blouse' | null;
  promisedDay: string | null;
  createdX: number;
  sentX: number | null;
  hasProduction: boolean;
  hasButta: boolean;
  hasMill: boolean;
  sections: number;
  looms: number[];
  buttaParty: number;
  millParty: number;
  holdX: number | null;
  holdBy: 'jemish' | 'gaurang' | null;
  /** before_start = held right after its jobsheets were sent (they wait, Sent); mid = held during production. */
  holdMode?: 'before_start' | 'mid';
  /** Jobsheets planned for only part of the order (or more) — the coverage card. */
  phased?: number;
  /** Outside PO that delivered once and then stopped (late, partly received). */
  slowWeaver?: boolean;
  /** Its butta / mill party is slow (challans out past 3 / 8 days). */
  slowParty?: boolean;
  /** Waits at one step now (so every order status has an order in it today). */
  stall?: 'entry' | 'butta_send' | 'butta_qc' | 'mill_send' | 'mill_qc' | 'godown' | 'dispatch' | 'dispatch_half';
  pastHold: { x: number; releasedX: number; by: 'jemish' | 'gaurang' } | null;
  closeX: number | null;
  closeEarly: boolean;
  short: boolean;
  isOutside: boolean;
  outsideParty: string | null;
  jobsheets: SimJs[];
  takas: SimTaka[];
  dispatches: Dispatch[];
  grX: number | null;
  notes: string | null;
  isHolder: boolean;
  /** Orders of the zero-stock quality: nothing of them may stay in stock. */
  noFreeStock?: boolean;
  /** Status computed at the end (and its history). */
  status: string;
  history: { x: number; from: string | null; to: string }[];
}
