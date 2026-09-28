import { useCallback, useSyncExternalStore } from 'react';
import { can, ROLES, type RoleKey, type RolePermissions } from '@/config/roles';
import { queryClient } from '@/lib/query-client';
import { roleStore } from '@/lib/role-store';

export function useRole() {
  const role = useSyncExternalStore(roleStore.subscribe, roleStore.get);
  const setRole = useCallback((next: RoleKey) => {
    if (next === roleStore.get()) return;
    roleStore.set(next);
    // Data is role-filtered on the server: drop everything cached for the old role.
    queryClient.cancelQueries();
    queryClient.removeQueries();
  }, []);
  const hasPermission = useCallback((p: keyof RolePermissions) => can(role, p), [role]);
  return { role, config: ROLES[role], setRole, can: hasPermission };
}
