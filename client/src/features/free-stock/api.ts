import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddFromFreeStockInput,
  AddFromFreeStockResult,
  AssignTargetOrder,
  BlouseFilter,
  ItemFreeStock,
  MoveToInventoryInput,
  MoveToInventoryResult,
} from '@rivoora/shared';
import { api } from '@/lib/api';
import { invalidateAfterDispatch } from '../dispatch/api';

/** Free stock (Sprint 13): Move to inventory, Add from free stock / Assign to order, and the free takas of an item. */

export const freeStockKeys = {
  item: (key: string, blouse: string) => ['inventory', 'free-stock', key, blouse] as const,
  targets: (key: string) => ['inventory', 'assign-targets', key] as const,
};

/** Every write moves takas between orders and free stock: refresh orders, dashboards, takas, godown, inventory, dispatched, challans. */
function onWritten(qc: ReturnType<typeof useQueryClient>) {
  invalidateAfterDispatch(qc);
  void qc.invalidateQueries({ queryKey: ['jobsheets'] });
}

export function useMoveToInventory(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: MoveToInventoryInput) => api.post<MoveToInventoryResult>(`/orders/${orderId}/takas/move-to-inventory`, data),
    onSuccess: () => onWritten(qc),
  });
}

export function useAddFromFreeStock(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: AddFromFreeStockInput) => api.post<AddFromFreeStockResult>(`/orders/${orderId}/takas/add-from-free-stock`, data),
    onSuccess: () => onWritten(qc),
  });
}

/** The free takas of one inventory item (optionally only one blouse option). */
export function useItemFreeStock(key: string, blouse: BlouseFilter = 'all', enabled = true) {
  return useQuery({
    queryKey: freeStockKeys.item(key, blouse),
    queryFn: ({ signal }) => api.get<ItemFreeStock>(`/inventory/items/${key}/free-stock`, blouse === 'all' ? undefined : { blouse }, signal),
    enabled: enabled && !!key,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** Orders of the item that can receive free stock (Inventory → Assign to order). */
export function useAssignTargets(key: string, enabled = true) {
  return useQuery({
    queryKey: freeStockKeys.targets(key),
    queryFn: ({ signal }) => api.get<AssignTargetOrder[]>(`/inventory/items/${key}/assign-targets`, undefined, signal),
    enabled: enabled && !!key,
    staleTime: 0,
  });
}
