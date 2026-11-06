import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  JobsheetByNo,
  OrderShrinkage,
  OrderTakas,
  TakaDetail,
  TakaEditInput,
  TakaEditResult,
  TakaOwnEditData,
  TakaOwnEditInput,
  TakaEntryInput,
  TakaEntryResult,
  TakaNextNumbers,
  TakaDamagesDetail,
  TakaJobsheetItem,
  TakaJobsheetPage,
  TakaTab,
  SendBackResult,
  UndoSendBackResult,
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

/** The numbers the next `count` takas would get (system generated; confirmed when saved). */
export function useNextTakaNumbers(count: number, enabled = true) {
  return useQuery({
    queryKey: ['takas', 'next-numbers', count],
    queryFn: () => api.get<TakaNextNumbers>('/takas/next-numbers', { count }),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
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

/** Jenish / Gaurang: replace a jobsheet's takas + note. */
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

/** The damage details screen: every damage of a taka with pcs, photos and its own timeline. */
export function useTakaDamages(takaId: number) {
  return useQuery({
    queryKey: [...takaKeys.detail(takaId), 'damages'] as const,
    queryFn: ({ signal }) => api.get<TakaDamagesDetail>(`/takas/${takaId}/damages`, undefined, signal),
    enabled: takaId > 0,
    refetchOnWindowFocus: true,
  });
}

/** Rework: send takas back to butta cutting / the mill (Jenish, Gaurang). */
export function useSendBackTakas(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { takaIds: number[]; target: 'butta' | 'mill'; note?: string }) =>
      api.post<SendBackResult>(`/orders/${orderId}/takas/send-back`, data),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}

/** Sprint 21 (CR-06): the Taka entry person's own edit — the takas + which are still editable. */
export function useOwnEditData(jobsheetId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['takas', 'own-edit', jobsheetId] as const,
    queryFn: ({ signal }) => api.get<TakaOwnEditData>(`/jobsheets/${jobsheetId}/takas/entry`, undefined, signal),
    enabled: enabled && jobsheetId > 0,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useEditOwnTakas(jobsheetId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: TakaOwnEditInput) => api.put<TakaEditResult>(`/jobsheets/${jobsheetId}/takas/entry`, data),
    onSuccess: (res) => {
      invalidateAfterWrite(qc, res.orderId);
      void qc.invalidateQueries({ queryKey: ['lookup', 'damages'] });
      void qc.invalidateQueries({ queryKey: ['damages'] });
    },
  });
}

/** Sprint 21 (CR-08): expected vs actual metres of the order (Order details tab). */
export function useOrderShrinkage(orderId: number, enabled = true) {
  return useQuery({
    queryKey: ['takas', 'order', orderId, 'shrinkage'] as const,
    queryFn: ({ signal }) => api.get<OrderShrinkage>(`/orders/${orderId}/shrinkage`, undefined, signal),
    enabled: enabled && orderId > 0,
  });
}

/** Sprint 21 (CR-09): undo a send back (until the taka is on a challan). */
export function useUndoSendBack(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { takaIds: number[]; reason: string }) => api.post<UndoSendBackResult>(`/orders/${orderId}/takas/undo-send-back`, data),
    onSuccess: () => invalidateAfterWrite(qc, orderId),
  });
}
