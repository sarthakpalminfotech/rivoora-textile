import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  godownKpis,
  type GodownOrder,
  type GodownOrderCard,
  type GodownSplitInput,
  type GodownSplitResult,
  type GodownTaka,
  type GodownDamages,
  type QcNewDamageInput,
  type ReadyDispatchResult,
} from '@rivoora/shared';
import { toast } from 'sonner';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api, errorMessage } from '@/lib/api';
import { invalidateAfterChallanWrite } from '../challans/api';

/** Godown Orders module: query keys and hooks. Every write invalidates the godown, mill, dashboard, takas, damages and orders queries. */
export const godownKeys = {
  all: ['godown'] as const,
  orders: ['godown', 'orders'] as const,
  order: (orderId: number) => ['godown', 'order', orderId] as const,
  damages: (orderId: number) => ['godown', 'damages', orderId] as const,
};

export const useGodownOrders = (search: string) => useInfiniteList<GodownOrderCard>(godownKeys.orders, '/godown/orders', { search });

export function useGodownOrder(orderId: number) {
  return useQuery({
    queryKey: godownKeys.order(orderId),
    queryFn: ({ signal }) => api.get<GodownOrder>(`/godown/orders/${orderId}`, undefined, signal),
    enabled: orderId > 0,
    refetchOnWindowFocus: true,
  });
}

export function useGodownDamages(orderId: number, enabled = true) {
  return useQuery({
    queryKey: godownKeys.damages(orderId),
    queryFn: ({ signal }) => api.get<GodownDamages>(`/godown/orders/${orderId}/damages`, undefined, signal),
    enabled: enabled && orderId > 0,
    refetchOnWindowFocus: true,
  });
}

/** The KPIs after a local change to the final takas (the takas of other stages keep their counts). */
function kpisAfter(order: GodownOrder, takas: GodownTaka[]) {
  const next = godownKpis(takas.map((t) => ({ stage: t.stage, pcs: t.pcs, actualPcs: t.actualPcs, checked: t.checked })));
  return { ...next, total: order.kpis.total, refinish: order.kpis.refinish };
}

/**
 * Tick / untick and the actual pcs: saves at once. The cache is updated first (the optimistic tick) and rolled back with
 * a toast when the save fails.
 */
export function usePatchGodownTaka(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; checked?: boolean; actualPcs?: number }) => api.patch<GodownTaka>(`/godown/takas/${id}`, body),
    onMutate: async ({ id, checked, actualPcs }) => {
      await qc.cancelQueries({ queryKey: godownKeys.order(orderId) });
      const before = qc.getQueryData<GodownOrder>(godownKeys.order(orderId));
      if (before) {
        const takas = before.takas.map((t) =>
          t.id === id
            ? {
                ...t,
                ...(checked !== undefined ? { checked, checkedAt: checked ? new Date().toISOString() : null } : {}),
                ...(actualPcs !== undefined ? { actualPcs: actualPcs === t.pcs ? null : actualPcs } : {}),
              }
            : t,
        );
        qc.setQueryData<GodownOrder>(godownKeys.order(orderId), { ...before, takas, kpis: kpisAfter(before, takas) });
      }
      return { before };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(godownKeys.order(orderId), ctx.before);
      toast.error(errorMessage(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: godownKeys.all });
      // Actual pcs feed the Inventory numbers.
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useReadyDispatch(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (takaIds: number[]) => api.post<ReadyDispatchResult>(`/godown/orders/${orderId}/ready-dispatch`, { takaIds }),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}

export function useSplitTaka(takaId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: GodownSplitInput) => api.post<GodownSplitResult>(`/godown/takas/${takaId}/split`, data),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}

export function useMarkGodownDamage() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, damage }: { id: number; damage: QcNewDamageInput }) => api.post<{ takaId: number }>(`/godown/takas/${id}/damage`, damage),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}

export function useGodownRefinish() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, note }: { id: number; note?: string | null }) => api.post<{ takaId: number }>(`/godown/takas/${id}/refinish`, { note: note ?? null }),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}

/** Resolve one damage (`takaDamageId`) or every open damage of a final taka. */
export function useResolveGodownDamage() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, takaDamageId }: { id: number; takaDamageId?: number }) =>
      api.post<{ takaId: number; resolved: number }>(`/godown/takas/${id}/resolve`, takaDamageId ? { takaDamageId } : {}),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}
