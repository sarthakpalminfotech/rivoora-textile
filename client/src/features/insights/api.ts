import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DashboardCardsResult, DashboardKey, DashboardLayout, DashboardLayoutResult, DashboardSettings, PeriodKey } from '@rivoora/shared';
import { api } from '@/lib/api';

/**
 * Sprint 25 — insight dashboards. Keys start with 'insights'; a layout save / reset only touches that dashboard's layout,
 * a refresh only its cards.
 */
export const insightKeys = {
  all: ['insights'] as const,
  cards: (key: DashboardKey) => ['insights', 'cards', key] as const,
  batch: (key: DashboardKey, period: PeriodKey, ids: string) => ['insights', 'cards', key, period, ids] as const,
  layout: (key: DashboardKey) => ['insights', 'layout', key] as const,
  settings: ['insights', 'settings'] as const,
};

/** One batch per screen: every visible card of the dashboard for the period. Refreshes every 5 minutes and on focus. */
export function useDashboardCards(key: DashboardKey, ids: string[], period: PeriodKey, enabled = true) {
  const joined = ids.join(',');
  return useQuery({
    queryKey: insightKeys.batch(key, period, joined),
    queryFn: ({ signal }) => api.get<DashboardCardsResult>(`/dashboard/${key}/cards`, { ids: joined, period }, signal),
    enabled: enabled && ids.length > 0,
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
  });
}

/** A single card with its own period (the card's ⋯ → Change period). */
export function useCardWithPeriod(key: DashboardKey, id: string, period: PeriodKey | null) {
  return useQuery({
    queryKey: insightKeys.batch(key, period ?? '30d', id),
    queryFn: ({ signal }) => api.get<DashboardCardsResult>(`/dashboard/${key}/cards`, { ids: id, period: period ?? undefined }, signal),
    enabled: period !== null,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardLayout(key: DashboardKey) {
  return useQuery({
    queryKey: insightKeys.layout(key),
    queryFn: ({ signal }) => api.get<DashboardLayoutResult>(`/dashboard/${key}/layout`, undefined, signal),
    staleTime: 60_000,
  });
}

export function useSaveLayout(key: DashboardKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (layout: DashboardLayout) => api.put<DashboardLayoutResult>(`/dashboard/${key}/layout`, layout),
    onSuccess: (data) => qc.setQueryData(insightKeys.layout(key), data),
  });
}

export function useResetLayout(key: DashboardKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<DashboardLayoutResult>(`/dashboard/${key}/layout`),
    onSuccess: (data) => qc.setQueryData(insightKeys.layout(key), data),
  });
}

export function useDashboardSettings(enabled = true) {
  return useQuery({
    queryKey: insightKeys.settings,
    queryFn: ({ signal }) => api.get<DashboardSettings>('/dashboard-settings', undefined, signal),
    enabled,
  });
}

export function useSaveDashboardSettings() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: (data: DashboardSettings) => api.put<DashboardSettings>('/dashboard-settings', data),
    onSuccess: (data) => {
      qc.setQueryData(insightKeys.settings, data);
      // Loom utilisation / idle looms use the working hours.
      void qc.invalidateQueries({ queryKey: ['insights', 'cards'] });
    },
  });
}
