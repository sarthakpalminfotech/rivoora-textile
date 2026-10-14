import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserCreateInput, UserResetPasswordInput, UserRow, UserUpdateInput } from '@rivoora/shared';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import { api } from '@/lib/api';

export const userKeys = { all: ['users'] as const };

export const useUsers = (search: string) => useInfiniteList<UserRow>([...userKeys.all, 'list'], '/users', { search });

export function useSaveUser() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id?: number; data: UserCreateInput | UserUpdateInput }) =>
      id ? api.put<UserRow>(`/users/${id}`, data) : api.post<UserRow>('/users', data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentFieldErrors: true },
    mutationFn: ({ id, data }: { id: number; data: UserResetPasswordInput }) => api.post<{ ok: true }>(`/users/${id}/reset-password`, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}
