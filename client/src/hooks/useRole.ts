import { useCallback, useSyncExternalStore } from 'react';
import { can, ROLES, type RoleKey, type RolePermissions } from '@/config/roles';
import { authStore } from '@/lib/auth-store';
import { queryClient } from '@/lib/query-client';
import { roleStore } from '@/lib/role-store';

/**
 * `role` is the ACTING role (what the screens and the server use). `user` is the logged-in person; users whose role can
 * switch roles (Jenish, Gaurang) may act as another role (`setRole`, sent as X-Act-As).
 */
export function useRole() {
  const role = useSyncExternalStore(roleStore.subscribe, roleStore.get);
  const auth = useSyncExternalStore(authStore.subscribe, authStore.get);
  const user = auth.status === 'in' ? auth.user : null;
  const canSwitch = user ? can(user.role, 'canSwitchRoles') : false;
  const setRole = useCallback((next: RoleKey) => {
    const me = authStore.user();
    if (!me || next === roleStore.get()) return;
    roleStore.set(next, me.role);
    // Data is role-filtered on the server: drop everything cached for the old role.
    queryClient.cancelQueries();
    queryClient.removeQueries();
  }, []);
  const hasPermission = useCallback((p: keyof RolePermissions) => can(role, p), [role]);
  return { role, config: ROLES[role], user, canSwitch, isActingAs: !!user && user.role !== role, setRole, can: hasPermission };
}
