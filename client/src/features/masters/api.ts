import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Customer,
  CustomerInput,
  Design,
  DesignInput,
  DesignListItem,
  DesignVariation,
  LookupItem,
  Material,
  MaterialInput,
  VariationInput,
} from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';

export const masterKeys = {
  customers: ['customers'] as const,
  materials: ['materials'] as const,
  designs: ['designs'] as const,
  design: (id: number) => ['designs', 'detail', id] as const,
  lookupCustomers: ['lookup', 'customers'] as const,
  lookupMaterials: ['lookup', 'materials'] as const,
};

/* ---------- lookups (dropdowns) ---------- */

export function useCustomerLookup(search: string) {
  return useQuery({
    queryKey: [...masterKeys.lookupCustomers, search],
    queryFn: ({ signal }) => api.get<LookupItem[]>('/lookup/customers', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useMaterialLookup(search = '') {
  return useQuery({
    queryKey: [...masterKeys.lookupMaterials, search],
    queryFn: ({ signal }) => api.get<LookupItem[]>('/lookup/materials', { search }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/* ---------- customers ---------- */

export const useCustomers = (search: string) =>
  useInfiniteList<Customer>([...masterKeys.customers, 'list'], '/customers', { search });

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: CustomerInput }) =>
      id ? api.put<Customer>(`/customers/${id}`, data) : api.post<Customer>('/customers', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.customers });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupCustomers });
      // Customer names appear in order lists / details.
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.customers });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupCustomers });
    },
  });
}

/* ---------- materials ---------- */

export const useMaterials = (search: string) =>
  useInfiniteList<Material>([...masterKeys.materials, 'list'], '/materials', { search });

export function useSaveMaterial() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: MaterialInput }) =>
      id ? api.put<Material>(`/materials/${id}`, data) : api.post<Material>('/materials', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.materials });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupMaterials });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useDeleteMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/materials/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: masterKeys.materials });
      void qc.invalidateQueries({ queryKey: masterKeys.lookupMaterials });
    },
  });
}

/* ---------- designs ---------- */

export const useDesigns = (search: string, enabled = true) =>
  useInfiniteList<DesignListItem>([...masterKeys.designs, 'list'], '/designs', { search }, enabled);

export function useDesign(id: number | null) {
  return useQuery({
    queryKey: masterKeys.design(id ?? 0),
    queryFn: ({ signal }) => api.get<Design>(`/designs/${id}`, undefined, signal),
    enabled: id !== null && id > 0,
  });
}

export function useSaveDesign() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: DesignInput }) =>
      id ? api.put<Design>(`/designs/${id}`, data) : api.post<Design>('/designs', data),
    onSuccess: (design) => {
      qc.setQueryData(masterKeys.design(design.id), design);
      void qc.invalidateQueries({ queryKey: [...masterKeys.designs, 'list'] });
      void qc.invalidateQueries({ queryKey: ['orders', 'detail'] });
    },
  });
}

export function useDeleteDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/designs/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: masterKeys.design(id) });
      void qc.invalidateQueries({ queryKey: [...masterKeys.designs, 'list'] });
    },
  });
}

export function useAddVariation(designId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: VariationInput) => api.post<DesignVariation>(`/designs/${designId}/variations`, data),
    onSuccess: (variation) => {
      qc.setQueryData<Design>(masterKeys.design(designId), (d) =>
        d ? { ...d, variations: [...d.variations, variation] } : d,
      );
      void qc.invalidateQueries({ queryKey: [...masterKeys.designs, 'list'] });
    },
  });
}

export function useDeleteVariation(designId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variationId: number) => api.delete(`/designs/${designId}/variations/${variationId}`),
    onSuccess: (_r, variationId) => {
      qc.setQueryData<Design>(masterKeys.design(designId), (d) =>
        d ? { ...d, variations: d.variations.filter((v) => v.id !== variationId) } : d,
      );
      void qc.invalidateQueries({ queryKey: [...masterKeys.designs, 'list'] });
    },
  });
}
