import type { RoleKey } from './roles';
import type { OrderStatusKey } from './statuses';
import type { Unit } from './units';
import type { Coverage, CoverageWarning } from './jobsheets';

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

export interface Customer {
  id: number;
  name: string;
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
  quantity: number;
  unit: Unit;
  /** Omitted entirely for roles that may not see rate. */
  rate?: number | null;
  orderDate: string;
  notes: string | null;
  sentToProductionAt: string | null;
  /** Active jobsheets of this order (undo send-for-production is only allowed at 0). */
  jobsheetCount: number;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; phone: string | null; city: string | null };
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

export interface JobsheetListItem {
  id: number;
  jobsheetNo: number;
  frames: number;
  picks: string | null;
  machines: JobsheetMachine[];
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
  coverage: Coverage;
  warnings: CoverageWarning[];
}

export interface JobsheetDetail {
  id: number;
  jobsheetNo: number;
  frames: number;
  picks: string | null;
  createdBy: RoleKey;
  createdAt: string;
  updatedAt: string;
  machines: JobsheetMachine[];
  order: {
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
    design: { id: number; code: string; name: string | null; imageUrl: string | null; thumbUrl: string | null } | null;
    variation: { id: number; code: string; imageUrl: string | null; thumbUrl: string | null } | null;
  };
  /** All active jobsheets of the order (for the edit preview), by number. */
  siblings: { id: number; jobsheetNo: number; frames: number }[];
  coverage: Coverage;
  warnings: CoverageWarning[];
}

export interface JobsheetRef {
  id: number;
  jobsheetNo: number;
  frames: number;
}

export interface JobsheetCreateResult {
  created: JobsheetRef[];
  /** The order moved to Jobsheet created. */
  statusChanged: boolean;
}

export interface JobsheetUpdateResult {
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
  /** It was the last active jobsheet: the plan was reset and the order moved back to Ready for production. */
  orderReset: boolean;
}

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
  /** Full image of the variation (or design). */
  imageUrl: string | null;
}
