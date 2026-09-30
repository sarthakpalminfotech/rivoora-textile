import { ClipboardCheck, ClipboardList, Factory, LayoutGrid, Layers, Palette, Users, type LucideIcon } from 'lucide-react';
import type { RolePermissions } from '@/config/roles';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to roles with this permission. */
  permission: keyof RolePermissions;
  /** Masters go under "More" in the phone bottom nav. */
  group: 'main' | 'masters';
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/orders', label: 'Orders', icon: ClipboardList, permission: 'canViewOrders', group: 'main' },
  { to: '/jobsheets', label: 'Jobsheets', icon: ClipboardCheck, permission: 'canViewJobsheetsModule', group: 'main' },
  { to: '/machine-view', label: 'Machine view', icon: LayoutGrid, permission: 'canViewMachineView', group: 'main' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'canViewMasters', group: 'masters' },
  { to: '/materials', label: 'Materials', icon: Layers, permission: 'canViewMasters', group: 'masters' },
  { to: '/designs', label: 'Designs', icon: Palette, permission: 'canViewMasters', group: 'masters' },
  { to: '/machines', label: 'Machines', icon: Factory, permission: 'canViewMasters', group: 'masters' },
];

export function navItemsFor(can: (p: keyof RolePermissions) => boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => can(item.permission));
}
