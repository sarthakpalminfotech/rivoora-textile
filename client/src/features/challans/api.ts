import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  CHALLAN_KIND_CONFIG,
  type ChallanCreateInput,
  type ChallanCreateResult,
  type ChallanDetail,
  type ChallanFilter,
  type ChallanKind,
  type ChallanListItem,
  type ChallanPendingOrder,
  type ChallanPendingOrderTakas,
  type ChallanPrintData,
  type OrderChallans,
  type ReceiveResponse,
  type ReceiveResult,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';
import { invalidateAfterWrite } from '../jobsheets/api';

/** The Send tab lists: `send` = Pending, `refinish` = the mill's Refinish sub-tab (takas marked for refinish). */
export type SendMode = 'send' | 'refinish';
const listPath = (mode: SendMode) => (mode === 'refinish' ? 'refinish-orders' : 'pending-orders');

/** `/butta` or `/mill` — the API base of a kind. */
const base = (kind: ChallanKind) => CHALLAN_KIND_CONFIG[kind].route;

export const challanKeys = {
  all: ['challans'] as const,
  kind: (kind: ChallanKind) => ['challans', kind] as const,
  counts: (kind: ChallanKind) => ['challans', kind, 'counts'] as const,
  pending: (kind: ChallanKind, mode: SendMode = 'send') => ['challans', kind, mode === 'refinish' ? 'refinish-orders' : 'pending-orders'] as const,
  pendingTakas: (kind: ChallanKind, orderId: number, mode: SendMode = 'send') => ['challans', kind, mode === 'refinish' ? 'refinish-takas' : 'pending-takas', orderId] as const,
  list: (kind: ChallanKind) => ['challans', kind, 'list'] as const,
  challan: (kind: ChallanKind, id: number) => ['challans', kind, 'challan', id] as const,
  print: (kind: ChallanKind, id: number) => ['challans', kind, 'print', id] as const,
  /** Docs → Challans on the order details page. */
  order: (orderId: number) => ['challans', 'order', orderId] as const,
  qc: ['butta-qc'] as const,
};

/**
 * Every send / receive / cancel / QC write can change takas, challans, the order status, the order dashboard and the
 * lists of BOTH kinds — refresh all of them (the Receive screen relies on this for its live lists).
 */
export function invalidateAfterChallanWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: challanKeys.all });
  void qc.invalidateQueries({ queryKey: challanKeys.qc });
  void qc.invalidateQueries({ queryKey: ['mill-qc'] });
  void qc.invalidateQueries({ queryKey: ['godown'] });
  invalidateAfterWrite(qc);
}

/* ---------- Send ---------- */

export const usePendingOrders = (kind: ChallanKind, search: string, mode: SendMode = 'send') =>
  useInfiniteList<ChallanPendingOrder>(challanKeys.pending(kind, mode), `${base(kind)}/${listPath(mode)}`, { search });

/** The Send tab counts: takas ready to send · takas currently with the party (the pills on the sub-tabs). */
export function useKindCounts(kind: ChallanKind) {
  return useQuery({
    queryKey: challanKeys.counts(kind),
    queryFn: ({ signal }) => api.get<{ pending: number; inKind: number; refinish: number }>(`${base(kind)}/counts`, undefined, signal),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}

export function usePendingOrderTakas(kind: ChallanKind, orderId: number | null, mode: SendMode = 'send') {
  return useQuery({
    queryKey: challanKeys.pendingTakas(kind, orderId ?? 0, mode),
    queryFn: ({ signal }) => api.get<ChallanPendingOrderTakas>(`${base(kind)}/${listPath(mode)}/${orderId}/takas`, undefined, signal),
    enabled: orderId !== null && orderId > 0,
    staleTime: 0,
  });
}

/** Fetches an order's not-yet-sent takas on demand (ticking an order's checkbox selects all its READY ones). */
export const fetchPendingOrderTakas = (qc: QueryClient, kind: ChallanKind, orderId: number, mode: SendMode = 'send') =>
  qc.fetchQuery({
    queryKey: challanKeys.pendingTakas(kind, orderId, mode),
    queryFn: ({ signal }) => api.get<ChallanPendingOrderTakas>(`${base(kind)}/${listPath(mode)}/${orderId}/takas`, undefined, signal),
    staleTime: 0,
  });

export function useCreateChallan(kind: ChallanKind) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: ChallanCreateInput) => api.post<ChallanCreateResult>(`${base(kind)}/challans`, data),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}

/* ---------- challans ---------- */

/** `live` = the Receive screen: refetch every 10 s and on focus (it is also invalidated after any receive). */
export function useChallans(kind: ChallanKind, filter: ChallanFilter, search: string, live = false) {
  return useInfiniteList<ChallanListItem>(challanKeys.list(kind), `${base(kind)}/challans`, { filter, search }, true, {
    refetchInterval: live ? 10_000 : undefined,
    refetchOnWindowFocus: true,
  });
}

export function useChallan(kind: ChallanKind, id: number) {
  return useQuery({
    queryKey: challanKeys.challan(kind, id),
    queryFn: ({ signal }) => api.get<ChallanDetail>(`${base(kind)}/challans/${id}`, undefined, signal),
    enabled: id > 0,
    refetchOnWindowFocus: true,
  });
}

export function useChallanPrint(kind: ChallanKind, id: number) {
  return useQuery({
    queryKey: challanKeys.print(kind, id),
    queryFn: ({ signal }) => api.get<ChallanPrintData>(`${base(kind)}/challans/${id}/print`, undefined, signal),
    enabled: id > 0,
  });
}

export function useCancelChallan(kind: ChallanKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<{ challanId: number; challanNo: number }>(`${base(kind)}/challans/${id}/cancel`),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}

/* ---------- Receive ---------- */

/** `{ takaNo }` or `{ takaIds }`. Use `mutateAsync` (several can be in flight while typing fast). */
export function useReceive(kind: ChallanKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { takaNo: string } | { takaIds: number[] }) => api.post<ReceiveResponse>(`${base(kind)}/receive`, data),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}

export function useUndoReceive(kind: ChallanKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (takaId: number) => api.post<ReceiveResult>(`${base(kind)}/receive/${takaId}/undo`),
    onSuccess: () => invalidateAfterChallanWrite(qc),
  });
}

/* ---------- Order → Docs → Challans ---------- */

export function useOrderChallans(orderId: number) {
  return useQuery({
    queryKey: challanKeys.order(orderId),
    queryFn: ({ signal }) => api.get<OrderChallans>(`/orders/${orderId}/challans`, undefined, signal),
    enabled: orderId > 0,
    refetchOnWindowFocus: true,
  });
}
