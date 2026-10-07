import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  JobsheetActionResult,
  JobsheetChangeMachineInput,
  JobsheetChangeMachineResult,
  JobsheetCreateResult,
  JobsheetDeleteResult,
  JobsheetDetail,
  JobsheetGenerateInput,
  JobsheetPrintItem,
  JobsheetSendResult,
  JobsheetSingleInput,
  JobsheetTab,
  JobsheetUpdateInput,
  JobsheetUpdateResult,
  MachineViewData,
  OrderJobsheets,
  SupervisorJobsheetItem,
  SupervisorJobsheetPage,
  SupervisorOrderItem,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api, ApiError } from '@/lib/api';
import { orderKeys } from '../orders/api';

export const jobsheetKeys = {
  all: ['jobsheets'] as const,
  order: (orderId: number) => ['jobsheets', 'order', orderId] as const,
  detail: (id: number) => ['jobsheets', 'detail', id] as const,
  print: (ids: number[]) => ['jobsheets', 'print', ids.join(',')] as const,
  /** The supervisor's module list. */
  list: ['jobsheets', 'list'] as const,
  /** The supervisor's Order view (jobsheets grouped by order). */
  supervisorOrders: ['jobsheets', 'orders'] as const,
  /** The Taka entry list. */
  takaList: ['jobsheets', 'taka-list'] as const,
};

export const machineViewKey = ['machine-view'] as const;

/**
 * Every jobsheet write can change the jobsheets, the order's status and coverage, the supervisor's list and the
 * machine board, the order dashboard — refresh all of them.
 */
export function invalidateAfterWrite(qc: QueryClient, orderId?: number) {
  void qc.invalidateQueries({ queryKey: jobsheetKeys.all });
  void qc.invalidateQueries({ queryKey: ['takas'] });
  // Order dashboard: counts, sub-stage items and damages.
  void qc.invalidateQueries({ queryKey: ['order-dashboard'] });
  void qc.invalidateQueries({ queryKey: ['inventory'] });
  if (orderId) void qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
  else void qc.invalidateQueries({ queryKey: ['orders', 'detail'] });
  void qc.invalidateQueries({ queryKey: orderKeys.lists });
  void qc.invalidateQueries({ queryKey: machineViewKey });
}

export function useOrderJobsheets(orderId: number, enabled = true) {
  return useQuery({
    queryKey: jobsheetKeys.order(orderId),
    queryFn: ({ signal }) => api.get<OrderJobsheets>(`/orders/${orderId}/jobsheets`, undefined, signal),
    enabled: enabled && orderId > 0,
  });
}

export function useJobsheet(id: number) {
  return useQuery({
    queryKey: jobsheetKeys.detail(id),
    queryFn: ({ signal }) => api.get<JobsheetDetail>(`/jobsheets/${id}`, undefined, signal),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useJobsheetPrint(ids: number[]) {
  return useQuery({
    queryKey: jobsheetKeys.print(ids),
    queryFn: ({ signal }) => api.get<JobsheetPrintItem[]>('/jobsheets/print', { ids }, signal),
    enabled: ids.length > 0,
    staleTime: 0,
  });
}

/**
 * The supervisor's Jobsheets module: one tab + search, paginated, with tab counts on every page. With `orderId`:
 * one order's jobsheets (Order view), plus the order's header (number + design).
 */
export function useSupervisorJobsheets(tab: JobsheetTab, search: string, orderId?: number) {
  const q = useInfiniteList<SupervisorJobsheetItem>(jobsheetKeys.list, '/jobsheets', { tab, search, orderId });
  const first = q.data?.pages[0] as SupervisorJobsheetPage | undefined;
  return { ...q, counts: first?.counts, order: first?.order ?? null };
}

/** The supervisor's Order view: orders with their jobsheet counts (Pending / On-loom first). */
export const useSupervisorOrders = (search: string) =>
  useInfiniteList<SupervisorOrderItem>(jobsheetKeys.supervisorOrders, '/jobsheets/orders', { search });

export function useMachineView() {
  return useQuery({
    queryKey: machineViewKey,
    queryFn: ({ signal }) => api.get<MachineViewData>('/machine-view', undefined, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useGenerateJobsheets(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: JobsheetGenerateInput) =>
      api.post<JobsheetCreateResult>(`/orders/${orderId}/jobsheets/generate`, data),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}

export function useAddJobsheet(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: JobsheetSingleInput) => api.post<JobsheetCreateResult>(`/orders/${orderId}/jobsheets`, data),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}

export function useUpdateJobsheet(id: number, orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: JobsheetUpdateInput) => api.put<JobsheetUpdateResult>(`/jobsheets/${id}`, data),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}

export function useDeleteJobsheet(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<JobsheetDeleteResult>(`/jobsheets/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: jobsheetKeys.detail(id) });
      invalidateAfterWrite(qc, orderId);
    },
  });
}

/** Pending → Sent (to the supervisor). */
export function useSendJobsheets(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobsheetIds: number[]) =>
      api.post<JobsheetSendResult>(`/orders/${orderId}/jobsheets/send`, { jobsheetIds }),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}

export function usePullBackJobsheet(orderId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<JobsheetActionResult>(`/jobsheets/${id}/pull-back`),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}

/**
 * A 409 on a supervisor action means the jobsheet changed elsewhere (e.g. completed at taka entry):
 * refresh his list and details so the stale buttons disappear.
 */
function refreshOnConflict(qc: QueryClient) {
  return (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) invalidateAfterWrite(qc);
  };
}

export function useStartJobsheet() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, machineId }: { id: number; machineId: number }) =>
      api.post<JobsheetActionResult>(`/jobsheets/${id}/start`, { machineId }),
    onSuccess: () => invalidateAfterWrite(qc),
    onError: refreshOnConflict(qc),
  });
}

export function useCompleteJobsheet() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, completedFrames }: { id: number; completedFrames: number }) =>
      api.post<JobsheetActionResult>(`/jobsheets/${id}/complete`, { completedFrames }),
    onSuccess: () => invalidateAfterWrite(qc),
    onError: refreshOnConflict(qc),
  });
}

export function useChangeMachine() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, ...data }: JobsheetChangeMachineInput & { id: number }) =>
      api.post<JobsheetChangeMachineResult>(`/jobsheets/${id}/change-machine`, data),
    onSuccess: () => invalidateAfterWrite(qc),
    onError: refreshOnConflict(qc),
  });
}

export const printUrl = (ids: number[]) => `/print/jobsheets?ids=${ids.join(',')}`;
