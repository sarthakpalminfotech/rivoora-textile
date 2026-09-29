import type { RoleKey } from './roles';
import type { OrderStatusKey } from './statuses';
import type { Unit } from './units';

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
