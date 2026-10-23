import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  STATUS,
  type OrderCreateInput,
  type OrderDetail,
  type OrderListItem,
  type OrderMilestoneInput,
  type OrderUpdateInput,
  type Paginated,
  type PreviousDesign,
  type SendToProductionResult,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { useRole } from '@/hooks/useRole';
import { api } from '@/lib/api';
import { masterKeys } from '../masters/api';
import type { OrderFilters } from './filters';

export const orderKeys = {
  all: ['orders'] as const,
  lists: ['orders', 'list'] as const,
  detail: (id: number) => ['orders', 'detail', id] as const,
  previousDesigns: (customerId: number) => ['orders', 'previous-designs', customerId] as const,
};

export function useOrders(filters: OrderFilters) {
  const { role } = useRole();
  return useInfiniteList<OrderListItem>([...orderKeys.lists, role], '/orders', {
    search: filters.search,
    status: filters.statuses,
    material: filters.materials,
    party: filters.parties,
    type: filters.types,
    kind: filters.kinds,
    from: filters.from,
    to: filters.to,
  });
}

/** History → Overview: raw times of the main steps (fed to the shared `orderMilestones`). */
export function useOrderMilestones(id: number) {
  return useQuery({
    queryKey: ['orders', 'milestones', id] as const,
    queryFn: ({ signal }) => api.get<OrderMilestoneInput>(`/orders/${id}/milestones`, undefined, signal),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useOrder(id: number) {
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: ({ signal }) => api.get<OrderDetail>(`/orders/${id}`, undefined, signal),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function usePreviousDesigns(customerId: number | null) {
  return useQuery({
    queryKey: orderKeys.previousDesigns(customerId ?? 0),
    queryFn: ({ signal }) => api.get<PreviousDesign[]>(`/customers/${customerId}/previous-designs`, undefined, signal),
    enabled: !!customerId,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: OrderCreateInput) => api.post<{ id: number; orderNo: number }>('/orders', data),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: orderKeys.lists });
      void qc.invalidateQueries({ queryKey: orderKeys.previousDesigns(vars.customerId) });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      if (vars.newDesign) void qc.invalidateQueries({ queryKey: masterKeys.designs });
    },
  });
}

export function useUpdateOrder(id: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: OrderUpdateInput) => api.put<OrderDetail>(`/orders/${id}`, data),
    onSuccess: (order, vars) => {
      qc.setQueryData(orderKeys.detail(id), order);
      void qc.invalidateQueries({ queryKey: orderKeys.lists });
      void qc.invalidateQueries({ queryKey: ['orders', 'previous-designs'] });
      // Jobsheet details / print and the dashboard show the order's design, quantity and client.
      void qc.invalidateQueries({ queryKey: ['jobsheets'] });
      void qc.invalidateQueries({ queryKey: ['order-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      if (vars.newDesign) void qc.invalidateQueries({ queryKey: masterKeys.designs });
    },
  });
}

type ListCache = InfiniteData<Paginated<OrderListItem>>;

export function useSendToProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderIds: number[]) =>
      api.post<SendToProductionResult>('/orders/send-to-production', { orderIds }),
    onSuccess: (res) => {
      // Update the visible rows immediately, then refetch in the background.
      const updated = new Set(res.orderIds);
      qc.setQueriesData<ListCache>({ queryKey: orderKeys.lists }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                items: p.items.map((o) => (updated.has(o.id) ? { ...o, status: STATUS.READY_PRODUCTION } : o)),
              })),
            }
          : data,
      );
      res.orderIds.forEach((id) => void qc.invalidateQueries({ queryKey: orderKeys.detail(id) }));
      void qc.invalidateQueries({ queryKey: ['order-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: orderKeys.lists });
    },
  });
}

export function useUndoProduction(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OrderDetail>(`/orders/${id}/undo-production`),
    onSuccess: (order) => {
      qc.setQueryData(orderKeys.detail(id), order);
      void qc.invalidateQueries({ queryKey: ['order-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: orderKeys.lists });
    },
  });
}
