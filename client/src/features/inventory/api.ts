import { useQuery } from '@tanstack/react-query';
import type {
  DamagedItemCard,
  DamagedItemDetail,
  DamagedTakaRow,
  DamageType,
  InventoryItemCard,
  InventoryItemDetail,
  InventoryOrderRow,
  InventorySummary,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';

/**
 * Inventory queries. Keys all start with `['inventory']` — every taka / jobsheet / challan / QC / godown write
 * invalidates that prefix (see `invalidateAfterWrite` in features/jobsheets/api.ts).
 */
export const inventoryKeys = {
  all: ['inventory'] as const,
  summary: ['inventory', 'summary'] as const,
  items: ['inventory', 'items'] as const,
  item: (key: string) => ['inventory', 'item', key] as const,
  itemOrders: (key: string, search: string) => ['inventory', 'item-orders', key, search] as const,
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

export const useInventoryItems = (search: string) =>
  useInfiniteList<InventoryItemCard>(inventoryKeys.items, '/inventory/items', { search }, true, { refetchOnWindowFocus: true });

export const useDamagedItems = (search: string, enabled = true) =>
  useInfiniteList<DamagedItemCard>(inventoryKeys.damaged, '/inventory/damaged', { search }, enabled, { refetchOnWindowFocus: true });

export function useInventoryItem(key: string) {
  return useQuery({
    queryKey: inventoryKeys.item(key),
    queryFn: ({ signal }) => api.get<InventoryItemDetail>(`/inventory/items/${key}`, undefined, signal),
    ...live,
  });
}

export function useInventoryItemOrders(key: string, search: string) {
  return useQuery({
    queryKey: inventoryKeys.itemOrders(key, search),
    queryFn: ({ signal }) => api.get<InventoryOrderRow[]>(`/inventory/items/${key}/orders`, { search }, signal),
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
