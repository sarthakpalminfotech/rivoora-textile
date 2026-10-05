import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  JobsheetByNo,
  OrderTakas,
  TakaDetail,
  TakaEditInput,
  TakaEditResult,
  TakaEntryInput,
  TakaEntryResult,
  TakaJobsheetItem,
  TakaJobsheetPage,
  TakaTab,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';
import { invalidateAfterWrite, jobsheetKeys } from '../jobsheets/api';

export const takaKeys = {
  all: ['takas'] as const,
  order: (orderId: number) => ['takas', 'order', orderId] as const,
  detail: (takaId: number) => ['takas', 'detail', takaId] as const,
};

/** The Taka entry Jobsheets list: one tab + search, paginated, with tab counts. */
export function useTakaJobsheets(tab: TakaTab, search: string) {
  const q = useInfiniteList<TakaJobsheetItem>(jobsheetKeys.takaList, '/taka/jobsheets', { tab, search });
  const counts = (q.data?.pages[0] as TakaJobsheetPage | undefined)?.counts;
  return { ...q, counts };
}

/** Jobsheet number (from a QR or typed) → id. */
export function useJobsheetByNo(no: number) {
  return useQuery({
    queryKey: ['jobsheets', 'by-no', no],
    queryFn: ({ signal }) => api.get<JobsheetByNo>(`/jobsheets/by-no/${no}`, undefined, signal),
    enabled: Number.isInteger(no) && no > 0,
    staleTime: 0,
  });
}

export function useOrderTakas(orderId: number, enabled = true) {
  return useQuery({
    queryKey: takaKeys.order(orderId),
    queryFn: ({ signal }) => api.get<OrderTakas>(`/orders/${orderId}/takas`, undefined, signal),
    enabled: enabled && orderId > 0,
  });
}

/** One taka with its damages and history (the taka details drawer). */
export function useTakaDetail(takaId: number | null) {
  return useQuery({
    queryKey: takaKeys.detail(takaId ?? 0),
    queryFn: ({ signal }) => api.get<TakaDetail>(`/takas/${takaId}`, undefined, signal),
    enabled: takaId !== null && takaId > 0,
  });
}

/** Taka entry: add takas (completes the jobsheet if needed). */
export function useEnterTakas(jobsheetId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: TakaEntryInput) => api.post<TakaEntryResult>(`/jobsheets/${jobsheetId}/takas`, data),
    // The jobsheet (status / note), order status, taka lists, supervisor list and machine board all change.
    onSuccess: (res) => {
      invalidateAfterWrite(qc, res.orderId);
      // An "Other" damage name may have been added to the Damage master.
      void qc.invalidateQueries({ queryKey: ['lookup', 'damages'] });
      void qc.invalidateQueries({ queryKey: ['damages'] });
    },
  });
}

/** Jemish / Gaurang: replace a jobsheet's takas + note. */
export function useEditTakas(jobsheetId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: TakaEditInput) => api.put<TakaEditResult>(`/jobsheets/${jobsheetId}/takas`, data),
    onSuccess: (res) => {
      invalidateAfterWrite(qc, res.orderId);
      // An "Other" damage name may have been added to the Damage master.
      void qc.invalidateQueries({ queryKey: ['lookup', 'damages'] });
      void qc.invalidateQueries({ queryKey: ['damages'] });
    },
  });
}
