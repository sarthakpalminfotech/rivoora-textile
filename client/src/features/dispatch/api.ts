import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  DispatchChallanDetail,
  DispatchedOrderCard,
  DispatchedOrderDetail,
  DispatchInput,
  DispatchResult,
  GoodsReturnInput,
  GoodsReturnResult,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';
import { invalidateAfterChallanWrite } from '../challans/api';

/** Dispatch module: query keys and hooks. Every write invalidates orders, dashboards, takas, godown, challans, inventory and dispatched. */
export const dispatchKeys = {
  all: ['dispatched'] as const,
  list: ['dispatched', 'list'] as const,
  order: (orderId: number) => ['dispatched', 'order', orderId] as const,
  challan: (id: number) => ['dispatched', 'challan', id] as const,
};

export function invalidateAfterDispatch(qc: QueryClient) {
  invalidateAfterChallanWrite(qc);
  void qc.invalidateQueries({ queryKey: dispatchKeys.all });
  void qc.invalidateQueries({ queryKey: ['inventory'] });
  void qc.invalidateQueries({ queryKey: ['orders'] });
  void qc.invalidateQueries({ queryKey: ['order-dashboard'] });
  void qc.invalidateQueries({ queryKey: ['takas'] });
}

export function useDispatchChallan(id: number) {
  return useQuery({
    queryKey: dispatchKeys.challan(id),
    queryFn: ({ signal }) => api.get<DispatchChallanDetail>(`/dispatch/challans/${id}`, undefined, signal),
    enabled: id > 0,
  });
}

export const useDispatchedOrders = (search: string) => useInfiniteList<DispatchedOrderCard>(dispatchKeys.list, '/dispatched', { search });

export function useDispatchedOrder(orderId: number) {
  return useQuery({
    queryKey: dispatchKeys.order(orderId),
    queryFn: ({ signal }) => api.get<DispatchedOrderDetail>(`/dispatched/${orderId}`, undefined, signal),
    enabled: orderId > 0,
    refetchOnWindowFocus: true,
  });
}

export function useCreateDispatch(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: DispatchInput) => api.post<DispatchResult>(`/godown/orders/${orderId}/dispatch`, data),
    onSuccess: () => invalidateAfterDispatch(qc),
  });
}

export function useGoodsReturn(challanId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: GoodsReturnInput) => api.post<GoodsReturnResult>(`/dispatch/challans/${challanId}/goods-return`, data),
    onSuccess: () => invalidateAfterDispatch(qc),
  });
}
