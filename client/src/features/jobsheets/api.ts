import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  JobsheetCreateResult,
  JobsheetDeleteResult,
  JobsheetDetail,
  JobsheetGenerateInput,
  JobsheetPrintItem,
  JobsheetSingleInput,
  JobsheetUpdateInput,
  JobsheetUpdateResult,
  OrderJobsheets,
} from '@rivoora/shared';
import { api } from '@/lib/api';
import { orderKeys } from '../orders/api';

export const jobsheetKeys = {
  all: ['jobsheets'] as const,
  order: (orderId: number) => ['jobsheets', 'order', orderId] as const,
  detail: (id: number) => ['jobsheets', 'detail', id] as const,
  print: (ids: number[]) => ['jobsheets', 'print', ids.join(',')] as const,
};

/** Every jobsheet write can change the order's status and coverage. */
function invalidateAfterWrite(qc: QueryClient, orderId: number) {
  void qc.invalidateQueries({ queryKey: jobsheetKeys.all });
  void qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
  void qc.invalidateQueries({ queryKey: orderKeys.lists });
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

export const printUrl = (ids: number[]) => `/print/jobsheets?ids=${ids.join(',')}`;
