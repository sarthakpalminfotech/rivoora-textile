import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ButtaPendingOrder,
  ButtaPendingOrderTakas,
  ChallanCreateInput,
  ChallanCreateResult,
  ChallanDetail,
  ChallanFilter,
  ChallanListItem,
  ChallanPrintData,
  QcPendingTaka,
  QcResult,
  QcSubmitInput,
  ReceiveResponse,
  ReceiveResult,
  TakaDetail,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';
import { invalidateAfterWrite } from '../jobsheets/api';

export const buttaKeys = {
  all: ['butta'] as const,
  pending: ['butta', 'pending-orders'] as const,
  pendingTakas: (orderId: number) => ['butta', 'pending-takas', orderId] as const,
  challans: ['butta', 'challans'] as const,
  challan: (id: number) => ['butta', 'challan', id] as const,
  print: (id: number) => ['butta', 'print', id] as const,
  qc: ['butta-qc'] as const,
};

/**
 * Every butta / QC write can change takas, challans, the order status, the order dashboard and the butta lists —
 * refresh all of them (the Receive screen relies on this for its live lists).
 */
export function invalidateAfterButtaWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: buttaKeys.all });
  void qc.invalidateQueries({ queryKey: buttaKeys.qc });
  invalidateAfterWrite(qc);
}

/* ---------- Send ---------- */

export const usePendingOrders = (search: string) =>
  useInfiniteList<ButtaPendingOrder>(buttaKeys.pending, '/butta/pending-orders', { search });

export function usePendingOrderTakas(orderId: number | null) {
  return useQuery({
    queryKey: buttaKeys.pendingTakas(orderId ?? 0),
    queryFn: ({ signal }) => api.get<ButtaPendingOrderTakas>(`/butta/pending-orders/${orderId}/takas`, undefined, signal),
    enabled: orderId !== null && orderId > 0,
    staleTime: 0,
  });
}

/** Fetches an order's pending takas on demand (ticking an order's checkbox selects all of them). */
export const fetchPendingOrderTakas = (qc: QueryClient, orderId: number) =>
  qc.fetchQuery({
    queryKey: buttaKeys.pendingTakas(orderId),
    queryFn: ({ signal }) => api.get<ButtaPendingOrderTakas>(`/butta/pending-orders/${orderId}/takas`, undefined, signal),
    staleTime: 0,
  });

export function useCreateChallan() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: ChallanCreateInput) => api.post<ChallanCreateResult>('/butta/challans', data),
    onSuccess: () => invalidateAfterButtaWrite(qc),
  });
}

/* ---------- challans ---------- */

/** `live` = the Receive screen: refetch every 10 s and on focus (it is also invalidated after any receive). */
export function useChallans(filter: ChallanFilter, search: string, live = false) {
  return useInfiniteList<ChallanListItem>(buttaKeys.challans, '/butta/challans', { filter, search }, true, {
    refetchInterval: live ? 10_000 : undefined,
    refetchOnWindowFocus: true,
  });
}

export function useChallan(id: number) {
  return useQuery({
    queryKey: buttaKeys.challan(id),
    queryFn: ({ signal }) => api.get<ChallanDetail>(`/butta/challans/${id}`, undefined, signal),
    enabled: id > 0,
    refetchOnWindowFocus: true,
  });
}

export function useChallanPrint(id: number) {
  return useQuery({
    queryKey: buttaKeys.print(id),
    queryFn: ({ signal }) => api.get<ChallanPrintData>(`/butta/challans/${id}/print`, undefined, signal),
    enabled: id > 0,
  });
}

export function useCancelChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<{ challanId: number; challanNo: number }>(`/butta/challans/${id}/cancel`),
    onSuccess: () => invalidateAfterButtaWrite(qc),
  });
}

/* ---------- Receive ---------- */

/** `{ takaNo }` or `{ takaIds }`. Use `mutateAsync` (several can be in flight while typing fast). */
export function useReceive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { takaNo: string } | { takaIds: number[] }) => api.post<ReceiveResponse>('/butta/receive', data),
    onSuccess: () => invalidateAfterButtaWrite(qc),
  });
}

export function useUndoReceive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (takaId: number) => api.post<ReceiveResult>(`/butta/receive/${takaId}/undo`),
    onSuccess: () => invalidateAfterButtaWrite(qc),
  });
}

/* ---------- Butta QC ---------- */

export const useQcPending = (search: string) => useInfiniteList<QcPendingTaka>(buttaKeys.qc, '/butta-qc/pending', { search });

/** The one active taka with this number (Receive / Butta QC). Encoded: numbers can contain `/`. */
export const fetchTakaByNo = (no: string) => api.get<TakaDetail>(`/takas/by-no/${encodeURIComponent(no)}`);

export function useTakaByNo(no: string) {
  return useQuery({
    queryKey: ['butta-qc', 'taka', no],
    queryFn: ({ signal }) => api.get<TakaDetail>(`/takas/by-no/${encodeURIComponent(no)}`, undefined, signal),
    enabled: no.length > 0,
    staleTime: 0,
    retry: false,
  });
}

export function useSubmitQc(takaId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: QcSubmitInput) => api.post<QcResult>(`/butta-qc/${takaId}`, data),
    onSuccess: () => invalidateAfterButtaWrite(qc),
  });
}
