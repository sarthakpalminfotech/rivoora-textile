import {
  Bandage,
  ClipboardCheck,
  ClipboardList,
  Factory,
  LayoutGrid,
  Layers,
  Palette,
  ScanLine,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { RolePermissions } from '@/config/roles';

export interface NavItem {
  to: string;
  label: string;
  /** Hindi label, shown under the English one for bilingual roles (Taka entry). */
  hi?: string;
  icon: LucideIcon;
  /** Shown only to roles with this permission. */
  permission: keyof RolePermissions;
  /** Masters go under "More" in the phone bottom nav. */
  group: 'main' | 'masters';
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/orders', label: 'Orders', icon: ClipboardList, permission: 'canViewOrders', group: 'main' },
  { to: '/scan', label: 'Scan jobsheet', hi: 'जॉबशीट स्कैन करें', icon: ScanLine, permission: 'canUseTakaModules', group: 'main' },
  // Same path, different module: the supervisor's list or the Taka entry list (a role only ever has one).
  { to: '/jobsheets', label: 'Jobsheets', icon: ClipboardCheck, permission: 'canViewJobsheetsModule', group: 'main' },
  { to: '/jobsheets', label: 'Jobsheets', hi: 'जॉबशीट', icon: ClipboardCheck, permission: 'canUseTakaModules', group: 'main' },
  { to: '/machine-view', label: 'Machine view', icon: LayoutGrid, permission: 'canViewMachineView', group: 'main' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'canViewMasters', group: 'masters' },
  { to: '/materials', label: 'Materials', icon: Layers, permission: 'canViewMasters', group: 'masters' },
  { to: '/designs', label: 'Designs', icon: Palette, permission: 'canViewMasters', group: 'masters' },
  { to: '/machines', label: 'Machines', icon: Factory, permission: 'canViewMasters', group: 'masters' },
  { to: '/damages', label: 'Damage master', icon: Bandage, permission: 'canViewMasters', group: 'masters' },
];

export function navItemsFor(can: (p: keyof RolePermissions) => boolean): NavItem[] {
  const seen = new Set<string>();
  return NAV_ITEMS.filter((item) => {
    if (!can(item.permission) || seen.has(item.to)) return false;
    seen.add(item.to);
    return true;
  });
}
