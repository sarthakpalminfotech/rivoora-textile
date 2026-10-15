import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BlouseFilter,
  DamagedItemCard,
  DamagedItemDetail,
  DamagedTakaRow,
  DamageType,
  InventoryItemCard,
  InventoryItemDetail,
  InventoryOrderRow,
  InventorySummary,
  MarkFreshResult,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';
import { invalidateAfterWrite } from '../jobsheets/api';

/**
 * Inventory queries. Keys all start with `['inventory']` — every taka / jobsheet / challan / QC / godown write
 * invalidates that prefix (see `invalidateAfterWrite` in features/jobsheets/api.ts).
 */
export const inventoryKeys = {
  all: ['inventory'] as const,
  summary: ['inventory', 'summary'] as const,
  items: ['inventory', 'items'] as const,
  item: (key: string, blouse = 'all') => ['inventory', 'item', key, blouse] as const,
  itemOrders: (key: string, search: string, filter = '', blouse = 'all') => ['inventory', 'item-orders', key, search, filter, blouse] as const,
  damaged: ['inventory', 'damaged'] as const,
  damagedItem: (key: string) => ['inventory', 'damaged-item', key] as const,
  damagedTakas: (key: string, type: string, refinish: boolean, search: string) => ['inventory', 'damaged-takas', key, type, refinish, search] as const,
};

const live = { refetchOnWindowFocus: true, staleTime: 15_000 } as const;

export function useInventorySummary() {
  return useQuery({
    queryKey: inventoryKeys.summary,
    queryFn: ({ signal }) => api.get<InventorySummary>('/inventory/summary', undefined, signal),
    ...live,
  });
}

export const useInventoryItems = (search: string, kpi = '') =>
  useInfiniteList<InventoryItemCard>(inventoryKeys.items, '/inventory/items', { search, kpi }, true, { refetchOnWindowFocus: true });

export const useDamagedItems = (search: string, enabled = true) =>
  useInfiniteList<DamagedItemCard>(inventoryKeys.damaged, '/inventory/damaged', { search }, enabled, { refetchOnWindowFocus: true });

export function useInventoryItem(key: string, blouse: BlouseFilter = 'all') {
  return useQuery({
    queryKey: inventoryKeys.item(key, blouse),
    queryFn: ({ signal }) => api.get<InventoryItemDetail>(`/inventory/items/${key}`, blouse === 'all' ? undefined : { blouse }, signal),
    ...live,
  });
}

export function useInventoryItemOrders(key: string, search: string, filter = '', blouse: BlouseFilter = 'all') {
  return useQuery({
    queryKey: inventoryKeys.itemOrders(key, search, filter, blouse),
    queryFn: ({ signal }) => api.get<InventoryOrderRow[]>(`/inventory/items/${key}/orders`, { search, filter, blouse: blouse === 'all' ? undefined : blouse }, signal),
    ...live,
  });
}

export function useDamagedItem(key: string) {
  return useQuery({
    queryKey: inventoryKeys.damagedItem(key),
    queryFn: ({ signal }) => api.get<DamagedItemDetail>(`/inventory/damaged/${key}`, undefined, signal),
    ...live,
  });
}

export function useDamagedTakas(key: string, type: DamageType | null, refinish: boolean, search: string) {
  return useQuery({
    queryKey: inventoryKeys.damagedTakas(key, type ?? '', refinish, search),
    queryFn: ({ signal }) => api.get<DamagedTakaRow[]>(`/inventory/damaged/${key}/takas`, { type, refinish: refinish ? 1 : undefined, search }, signal),
    ...live,
  });
}

/** Mark as fresh: resolves every open damage of a taka (Jemish, Gaurang). */
export function useMarkFresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (takaId: number) => api.post<MarkFreshResult>(`/inventory/takas/${takaId}/mark-fresh`),
    onSuccess: () => invalidateAfterWrite(qc),
  });
}
