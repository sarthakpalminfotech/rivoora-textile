import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClosePreview, CloseOrderResult, OrderCloseInput } from '@rivoora/shared';
import { api } from '@/lib/api';
import { invalidateAfterWrite } from '../../jobsheets/api';

/** GET /orders/:id/close-preview — the Close order confirm dialog's summary. */
export function useClosePreview(orderId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['orders', 'close-preview', orderId] as const,
    queryFn: ({ signal }) => api.get<ClosePreview>(`/orders/${orderId}/close-preview`, undefined, signal),
    enabled: enabled && orderId > 0,
    staleTime: 0,
  });
}

export function useCloseOrder(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: OrderCloseInput) => api.post<CloseOrderResult>(`/orders/${orderId}/close`, data),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}
