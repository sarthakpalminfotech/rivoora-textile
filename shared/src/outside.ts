/**
 * Sprint 16 — outside production (POs to outside weavers) and direct FG purchases: PO numbers, statuses, quantities
 * and receipt totals. Pure rules shared by the server and the client.
 */

/** PO units: pieces or meters (the PO's quantities are in its own unit). */
export const PO_UNITS = ['pcs', 'meters'] as const;
export type PoUnit = (typeof PO_UNITS)[number];
export const PO_UNIT_LABEL: Record<PoUnit, string> = { pcs: 'pcs', meters: 'meters' };

/** The `counters` row PO numbers come from (never reused). */
export const OUTSIDE_PO_COUNTER = 'outside_po_no';

/** "PO-12" */
export const poLabel = (poNo: number) => `PO-${poNo}`;

/** "12", "PO-12", "po 12" → 12 (else null). */
export function parsePoNo(text: string): number | null {
  const m = /^(?:PO[\s-]*)?(\d{1,9})$/i.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/**
 * open → partly_received → received (by what came), or closed (by hand, or when the order closes). `cancelled` = it
 * was cancelled before anything came (kept for the record, counts for nothing).
 */
export const PO_STATUSES = ['open', 'partly_received', 'received', 'closed', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_CONFIG: Record<PoStatus, { label: string; badge: { bg: string; text: string; dot: string } }> = {
  open: { label: 'Open', badge: { bg: '#E0F2FE', text: '#0369A1', dot: '#0284C7' } },
  partly_received: { label: 'Partly received', badge: { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' } },
  received: { label: 'Received', badge: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' } },
  closed: { label: 'Closed', badge: { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' } },
  cancelled: { label: 'Cancelled', badge: { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' } },
};

/** A PO can still receive goods. */
export const poIsOpen = (status: string) => status === 'open' || status === 'partly_received';

/** The status after receipts (a closed / cancelled PO keeps its status). */
export function poStatusFor(p: { status: string; quantity: number; receivedQty: number }): PoStatus {
  if (p.status === 'closed' || p.status === 'cancelled') return p.status;
  if (p.receivedQty <= 0) return 'open';
  return p.receivedQty + 1e-9 >= p.quantity ? 'received' : 'partly_received';
}

/** What is still to come on a PO, in its own unit (0 once it is closed / cancelled / fully received). */
export function poPendingQty(p: { status: string; quantity: number; receivedQty: number }): number {
  if (!poIsOpen(p.status)) return 0;
  return Math.max(0, Math.round((p.quantity - p.receivedQty) * 100) / 100);
}

/** The PO's received quantity from its takas: pcs POs sum the pcs, meters POs sum the meters. */
export function receivedQtyOf(unit: string, takas: readonly { pcs: number | null; meters: number | null }[]): number {
  const sum = takas.reduce((s, t) => s + ((unit === 'meters' ? t.meters : t.pcs) ?? 0), 0);
  return Math.round(sum * 100) / 100;
}

/** Edit / cancel are allowed only while nothing has been received. */
export const poCanEdit = (p: { status: string; receivedTakas: number }) => p.status === 'open' && p.receivedTakas === 0;

/** "120 pcs" / "450.5 meters" */
export function formatPoQty(qty: number, unit: string): string {
  return `${qty.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit === 'meters' ? 'm' : 'pcs'}`;
}

/** The figures of all POs of an order (the Outside production card / tab). */
export interface OutsidePoTotals {
  /** POs that are not cancelled. */
  pos: number;
  openPos: number;
  /** pcs POs: ordered / received / still pending. */
  pcsOrdered: number;
  pcsReceived: number;
  pcsPending: number;
  /** pcs the jobsheets of an in-house order don't need to cover (see `outsidePoCommittedPcs`). */
  pcsCommitted: number;
  /** meters POs. */
  metersOrdered: number;
  metersReceived: number;
  metersPending: number;
  /** Takas received on the order's POs. */
  takasReceived: number;
}

export const EMPTY_OUTSIDE_TOTALS: OutsidePoTotals = {
  pos: 0,
  openPos: 0,
  pcsOrdered: 0,
  pcsReceived: 0,
  pcsPending: 0,
  pcsCommitted: 0,
  metersOrdered: 0,
  metersReceived: 0,
  metersPending: 0,
  takasReceived: 0,
};

export function outsidePoTotals(pos: readonly { unit: string; quantity: number; receivedQty: number; receivedTakas: number; status: string }[]): OutsidePoTotals {
  const t = { ...EMPTY_OUTSIDE_TOTALS };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const p of pos) {
    if (p.status === 'cancelled') continue;
    t.pos += 1;
    if (poIsOpen(p.status)) t.openPos += 1;
    t.takasReceived += p.receivedTakas;
    const pending = poPendingQty(p);
    if (p.unit === 'meters') {
      t.metersOrdered = r2(t.metersOrdered + p.quantity);
      t.metersReceived = r2(t.metersReceived + p.receivedQty);
      t.metersPending = r2(t.metersPending + pending);
    } else {
      t.pcsOrdered += p.quantity;
      t.pcsReceived += p.receivedQty;
      t.pcsPending += pending;
      t.pcsCommitted += p.status === 'closed' ? p.receivedQty : Math.max(p.quantity, p.receivedQty);
    }
  }
  return t;
}

/** "Ordered 300 pcs · Received 120 · Pending 180" — the quantities line of the Outside production card. */
export function outsideQtyLine(t: OutsidePoTotals): string {
  const parts: string[] = [];
  if (t.pcsOrdered > 0) parts.push(`${t.pcsOrdered.toLocaleString('en-IN')} pcs ordered · ${t.pcsReceived.toLocaleString('en-IN')} received · ${t.pcsPending.toLocaleString('en-IN')} pending`);
  if (t.metersOrdered > 0) parts.push(`${formatPoQty(t.metersOrdered, 'meters')} ordered · ${formatPoQty(t.metersReceived, 'meters')} received · ${formatPoQty(t.metersPending, 'meters')} pending`);
  return parts.join(' | ');
}

/** "120 pcs given outside (PO-3)" / "120 pcs given outside (PO-3, PO-5)" — the quiet line in the Jobsheets section. */
export function givenOutsideLine(pos: readonly { poNo: number; pcs: number }[]): string | null {
  const list = pos.filter((p) => p.pcs > 0);
  if (!list.length) return null;
  const pcs = list.reduce((s, p) => s + p.pcs, 0);
  return `${pcs.toLocaleString('en-IN')} pcs given outside (${list.map((p) => poLabel(p.poNo)).join(', ')})`;
}

/** What a receipt of an FG pcs-to-pcs order creates: one "Received lot" taka with the good + damaged pcs. */
export function receivedLot(receivedPcs: number, damagedPcs: number): { pcs: number; damagedPcs: number } {
  const pcs = Math.max(0, Math.floor(receivedPcs));
  return { pcs, damagedPcs: Math.min(pcs, Math.max(0, Math.floor(damagedPcs))) };
}

/** Kinds of receipts: against an outside PO, or a direct FG purchase. */
export const RECEIPT_KINDS = ['outside_po', 'fg'] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

/** "Challan 445 · PO-3" / "Challan 445 · Shree Traders" — the heading of a receipt group. */
export function receiptLabel(r: { challanNo: string; poNo?: number | null; supplierName?: string | null }): string {
  return [`Challan ${r.challanNo}`, r.poNo ? poLabel(r.poNo) : r.supplierName ?? null].filter(Boolean).join(' · ');
}
