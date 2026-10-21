import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrderHoldInput } from '@rivoora/shared';
import { api } from '@/lib/api';
import { invalidateAfterWrite } from '../../jobsheets/api';

/** Result of POST /orders/:id/hold. */
export interface HoldResult {
  orderId: number;
  orderNo: number;
  completed: number;
  created: { id: number; jobsheetNo: number; frames: number }[];
}

/** Hold / release change the order, its jobsheets, the dashboard and every list that hides held orders. */
export function useHoldOrder(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: OrderHoldInput) => api.post<HoldResult>(`/orders/${orderId}/hold`, data),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}

export function useReleaseOrder(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ orderId: number; orderNo: number }>(`/orders/${orderId}/release`),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}
