import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { RolePermissions } from '@/config/roles';
import { useRole } from '@/hooks/useRole';

/** Routes a role may not open redirect to that role's landing page (e.g. the supervisor → /jobsheets). */
export function RequirePermission({ permission, children }: { permission: keyof RolePermissions; children: ReactNode }) {
  const { can, config } = useRole();
  if (!can(permission)) return <Navigate to={config.landing} replace />;
  return <>{children}</>;
}

/** Unknown routes: the Taka entry role is always sent back to his landing (`/scan`); others see Not found. */
export function NotFoundOrLanding({ fallback }: { fallback: ReactNode }) {
  const { can, config } = useRole();
  if (can('canUseTakaModules')) return <Navigate to={config.landing} replace />;
  return <>{fallback}</>;
}

/** `/` → the role's landing route. */
export function LandingRedirect() {
  const { config } = useRole();
  return <Navigate to={config.landing} replace />;
}
