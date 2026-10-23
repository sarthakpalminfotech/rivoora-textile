import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  FgReceiptInput,
  OrderOutside,
  OutsidePoCard,
  OutsidePoInput,
  OutsidePoPrintData,
  OutsideReceiptInput,
  ReceiptFormData,
  ReceiptResult,
  ReceiveGoodsData,
} from '@rivoora/shared';
import { api } from '@/lib/api';
import { invalidateAfterWrite } from '../jobsheets/api';

/**
 * Sprint 16 — outside production (POs to outside weavers) and direct FG purchases: the order's Outside production
 * tab, the receipt forms and the Receive goods module. Every write changes the order, its dashboard, docs, takas and
 * (for the godown supervisor / Dhruvil) the Receive goods lists — `invalidateOutside` covers all of them.
 */

export const outsideKeys = {
  order: (orderId: number) => ['outside', 'order', orderId] as const,
  poPrint: (id: number) => ['outside', 'po', id, 'print'] as const,
  receiptForm: (kind: 'outside_po' | 'fg', id: number) => ['outside', 'receipt-form', kind, id] as const,
  receiveGoods: (search: string) => ['receive-goods', search] as const,
};

function invalidateOutside(qc: QueryClient, orderId: number) {
  void qc.invalidateQueries({ queryKey: ['outside'] });
  void qc.invalidateQueries({ queryKey: ['receive-goods'] });
  invalidateAfterWrite(qc, orderId);
}

/** GET /orders/:id/outside-pos — the order's Outside production tab (POs + receipts + totals). */
export function useOrderOutside(orderId: number, enabled = true) {
  return useQuery({
    queryKey: outsideKeys.order(orderId),
    queryFn: ({ signal }) => api.get<OrderOutside>(`/orders/${orderId}/outside-pos`, undefined, signal),
    enabled: enabled && orderId > 0,
  });
}

export function useCreateOutsidePo(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: OutsidePoInput) => api.post<OutsidePoCard>(`/orders/${orderId}/outside-pos`, data),
    onSuccess: () => invalidateOutside(qc, orderId),
  });
}

export function useUpdateOutsidePo(id: number, orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: OutsidePoInput) => api.put<OutsidePoCard>(`/outside-pos/${id}`, data),
    onSuccess: () => invalidateOutside(qc, orderId),
  });
}

export function useCancelOutsidePo(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<OutsidePoCard>(`/outside-pos/${id}/cancel`),
    onSuccess: () => invalidateOutside(qc, orderId),
  });
}

export function useCloseOutsidePo(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<OutsidePoCard>(`/outside-pos/${id}/close`),
    onSuccess: () => invalidateOutside(qc, orderId),
  });
}

/** GET /outside-pos/:id/print — the printable PO (A4 portrait). */
export function useOutsidePoPrint(id: number) {
  return useQuery({
    queryKey: outsideKeys.poPrint(id),
    queryFn: ({ signal }) => api.get<OutsidePoPrintData>(`/outside-pos/${id}/print`, undefined, signal),
    enabled: id > 0,
  });
}

/** GET /outside-pos/:id/receipt-form — what the receipt form of a PO needs. */
export function useOutsideReceiptForm(poId: number, enabled = true) {
  return useQuery({
    queryKey: outsideKeys.receiptForm('outside_po', poId),
    queryFn: ({ signal }) => api.get<ReceiptFormData>(`/outside-pos/${poId}/receipt-form`, undefined, signal),
    enabled: enabled && poId > 0,
    staleTime: 0,
  });
}

/** GET /orders/:id/fg-receipt-form — a direct FG purchase's receipt form. */
export function useFgReceiptForm(orderId: number, enabled = true) {
  return useQuery({
    queryKey: outsideKeys.receiptForm('fg', orderId),
    queryFn: ({ signal }) => api.get<ReceiptFormData>(`/orders/${orderId}/fg-receipt-form`, undefined, signal),
    enabled: enabled && orderId > 0,
    staleTime: 0,
  });
}

export function useCreateOutsideReceipt(poId: number, orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: OutsideReceiptInput) => api.post<ReceiptResult>(`/outside-pos/${poId}/receipts`, data),
    onSuccess: () => invalidateOutside(qc, orderId),
  });
}

export function useCreateFgReceipt(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: FgReceiptInput) => api.post<ReceiptResult>(`/orders/${orderId}/fg-receipts`, data),
    onSuccess: () => invalidateOutside(qc, orderId),
  });
}

/** GET /receive-goods?search= — the Receive goods module (godown supervisor, Dhruvil; also reachable by owners). */
export function useReceiveGoods(search: string) {
  return useQuery({
    queryKey: outsideKeys.receiveGoods(search),
    queryFn: ({ signal }) => api.get<ReceiveGoodsData>('/receive-goods', { search: search || undefined }, signal),
    refetchOnWindowFocus: true,
  });
}
