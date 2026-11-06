import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AddStockInput,
  DamagedFreeTaka,
  DamagedLotDetail,
  DamagedLotInput,
  DamagedLotRow,
  DesignQuantities,
  Paginated,
  PartyReturnCard,
  PartyReturnDetail,
  PartyReturnHeaderInput,
  PartyReturnLinesInput,
  QualityCard,
  RemovableTaka,
  RemoveStockInput,
  StockAdjustmentRow,
  StockDesignCard,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';

/** Sprint 22 queries: finished stock, damaged lots and the goods return against the party. Keys start with ['inventory'] / ['party-returns']. */
export const stockKeys = {
  qualities: (p: object) => ['inventory', 'qualities', p] as const,
  qualityDesigns: (id: number, p: object) => ['inventory', 'quality-designs', id, p] as const,
  quantities: (key: string) => ['inventory', 'quantities', key] as const,
  adjustments: ['inventory', 'stock-adjustments'] as const,
  lots: ['inventory', 'damaged-lots'] as const,
  returns: ['party-returns'] as const,
};

function invalidateStock(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['inventory'] });
  void qc.invalidateQueries({ queryKey: ['takas'] });
  void qc.invalidateQueries({ queryKey: ['orders'] });
  void qc.invalidateQueries({ queryKey: ['order-dashboard'] });
  void qc.invalidateQueries({ queryKey: stockKeys.returns });
}

const live = { refetchOnWindowFocus: true, staleTime: 15_000 } as const;

export function useQualities(params: { search?: string; flag?: string; fgType?: string }) {
  return useQuery({
    queryKey: stockKeys.qualities(params),
    queryFn: ({ signal }) => api.get<QualityCard[]>('/inventory/qualities', params, signal),
    placeholderData: keepPreviousData,
    ...live,
  });
}

export function useQualityDesigns(materialId: number, params: { search?: string; flag?: string; fgType?: string; sort?: string }) {
  return useQuery({
    queryKey: stockKeys.qualityDesigns(materialId, params),
    queryFn: ({ signal }) => api.get<{ quality: string; items: StockDesignCard[] }>(`/inventory/qualities/${materialId}/designs`, params, signal),
    enabled: materialId > 0,
    placeholderData: keepPreviousData,
    ...live,
  });
}

export function useDesignQuantities(key: string) {
  return useQuery({
    queryKey: stockKeys.quantities(key),
    queryFn: ({ signal }) => api.get<DesignQuantities>(`/inventory/items/${key}/quantities`, undefined, signal),
    enabled: !!key,
    ...live,
  });
}

/* ---------- manual stock ---------- */

export function useAddStock() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: AddStockInput) => api.post<{ takaId: number; takaNo: string; unit: 'pcs' | 'meters'; quantity: number; damaged: number }>('/inventory/stock/add', data),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useRemoveStock() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: RemoveStockInput) => api.post<{ takas: number; pcs: number; meters: number; split: boolean; reasonText: string }>('/inventory/stock/remove', data),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useRemovableTakas(designId: number | null, materialId: number | null) {
  return useQuery({
    queryKey: ['inventory', 'removable', designId, materialId] as const,
    queryFn: ({ signal }) => api.get<RemovableTaka[]>('/inventory/stock/removable', { designId, materialId }, signal),
    enabled: !!designId && !!materialId,
    staleTime: 0,
  });
}

export function useStockAdjustments(filters: { kind?: string; from?: string; to?: string; designId?: number; userId?: number }) {
  return useInfiniteList<StockAdjustmentRow>(stockKeys.adjustments, '/inventory/stock-adjustments', filters);
}

/* ---------- damaged lots ---------- */

export function useDamagedFreeTakas(filters: { materialId?: number; designId?: number; type?: string }) {
  return useQuery({
    queryKey: ['inventory', 'damaged-free-takas', filters] as const,
    queryFn: ({ signal }) => api.get<DamagedFreeTaka[]>('/inventory/damaged/free-takas', filters, signal),
    staleTime: 0,
  });
}

export function useSellDamagedLot() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: DamagedLotInput) => api.post<{ lotId: number; label: string; takas: number; pcs: number; meters: number }>('/inventory/damaged/lots', data),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useDamagedLots() {
  return useInfiniteList<DamagedLotRow>(stockKeys.lots, '/inventory/damaged/lots', {});
}

export function useDamagedLot(id: number) {
  return useQuery({
    queryKey: [...stockKeys.lots, id] as const,
    queryFn: ({ signal }) => api.get<DamagedLotDetail>(`/inventory/damaged/lots/${id}`, undefined, signal),
    enabled: id > 0,
  });
}

/* ---------- goods return against the party ---------- */

export function usePartyReturns(status: 'pending' | 'completed', search: string) {
  const list = useInfiniteList<PartyReturnCard>([...stockKeys.returns, 'list'], '/party-returns', { status, search });
  const counts = (list.data?.pages[0] as (Paginated<PartyReturnCard> & { counts?: { pending: number; completed: number } }) | undefined)?.counts;
  return { ...list, counts };
}

export function usePartyReturn(id: number) {
  return useQuery({
    queryKey: [...stockKeys.returns, 'detail', id] as const,
    queryFn: ({ signal }) => api.get<PartyReturnDetail>(`/party-returns/${id}`, undefined, signal),
    enabled: id > 0,
    staleTime: 0,
  });
}

export function useReturnParties(search: string, enabled = true) {
  return useQuery({
    queryKey: [...stockKeys.returns, 'parties', search] as const,
    queryFn: ({ signal }) => api.get<{ id: number; name: string }[]>('/party-returns/customers', { search }, signal),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 30_000,
  });
}

export interface DispatchedTaka {
  id: number;
  takaNo: string;
  orderNo: number;
  unit: string;
  pcs: number | null;
  meters: number | null;
  designCode: string | null;
  quality: string;
}
export function useDispatchedTakasOfParty(customerId: number | null, search: string) {
  return useQuery({
    queryKey: [...stockKeys.returns, 'dispatched-takas', customerId, search] as const,
    queryFn: ({ signal }) => api.get<DispatchedTaka[]>('/party-returns/dispatched-takas', { customerId, search }, signal),
    enabled: !!customerId,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

export function useCreatePartyReturn() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: PartyReturnHeaderInput) => api.post<{ id: number; label: string }>('/party-returns', data),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useUpdatePartyReturn(id: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: PartyReturnHeaderInput) => api.put<{ id: number }>(`/party-returns/${id}`, data),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useSavePartyReturnLines(id: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: PartyReturnLinesInput) => api.put<{ id: number; organised: number; left: number }>(`/party-returns/${id}/lines`, data),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useCompletePartyReturn(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ id: number; label: string; takas: number; freshTakas: number; damagedTakas: number }>(`/party-returns/${id}/complete`),
    onSuccess: () => invalidateStock(qc),
  });
}
