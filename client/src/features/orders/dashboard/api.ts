import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DamageType, DashboardItems, OrderDamages, OrderDashboard, SubStageKey } from '@rivoora/shared';
import { api } from '@/lib/api';

/** Every key starts with `order-dashboard`, so one invalidation (in `invalidateAfterWrite`) refreshes all of them. */
export const dashboardKeys = {
  all: ['order-dashboard'] as const,
  summary: (orderId: number) => ['order-dashboard', orderId, 'summary'] as const,
  items: (orderId: number, sub: SubStageKey) => ['order-dashboard', orderId, 'items', sub] as const,
  damages: (orderId: number, type: DamageType | null, resolved: boolean) =>
    ['order-dashboard', orderId, 'damages', type ?? 'all', resolved ? 'with-resolved' : 'open'] as const,
};

/** Counts only; refetches every 60 s and on window focus. */
export function useOrderDashboard(orderId: number, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.summary(orderId),
    queryFn: ({ signal }) => api.get<OrderDashboard>(`/orders/${orderId}/dashboard`, undefined, signal),
    enabled: enabled && orderId > 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** The items of one sub-stage — fetched only once a sub-stage is opened, then cached. */
export function useDashboardItems(orderId: number, sub: SubStageKey | null, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.items(orderId, sub ?? 'not_sent'),
    queryFn: ({ signal }) => api.get<DashboardItems>(`/orders/${orderId}/dashboard/items`, { sub: sub! }, signal),
    enabled: enabled && orderId > 0 && sub !== null,
  });
}

/** Open damages by default; `resolved` ("Show resolved") also lists the resolved ones. */
export function useOrderDamages(orderId: number, type: DamageType | null, resolved = false, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.damages(orderId, type, resolved),
    queryFn: ({ signal }) =>
      api.get<OrderDamages>(`/orders/${orderId}/damages`, { ...(type ? { type } : {}), ...(resolved ? { resolved: 1 } : {}) }, signal),
    enabled: enabled && orderId > 0,
    placeholderData: keepPreviousData,
  });
}
