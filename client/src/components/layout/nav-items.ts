import {
  Bandage,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FlaskConical,
  BadgeCheck,
  LayoutGrid,
  Layers,
  Palette,
  ScanLine,
  Scissors,
  Store,
  Truck,
  UserCog,
  Users,
  Warehouse,
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
  /** Hidden for roles that have this permission (the godown Orders item is not shown next to Jemish's own Orders). */
  hideWith?: keyof RolePermissions;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/orders', label: 'Orders', icon: ClipboardList, permission: 'canViewOrders', group: 'main' },
  // The supervisor's Orders: the orders in production, view only (no client or money).
  { to: '/orders', label: 'Orders', icon: ClipboardList, permission: 'canViewProductionOrders', group: 'main' },
  { to: '/scan', label: 'Scan jobsheet', hi: 'जॉबशीट स्कैन करें', icon: ScanLine, permission: 'canUseTakaModules', group: 'main' },
  // Same path, different module: the supervisor's list or the Taka entry list (a role only ever has one).
  { to: '/jobsheets', label: 'Jobsheets', icon: ClipboardCheck, permission: 'canViewJobsheetsModule', group: 'main' },
  { to: '/jobsheets', label: 'Jobsheets', hi: 'जॉबशीट', icon: ClipboardCheck, permission: 'canUseTakaModules', group: 'main' },
  { to: '/machine-view', label: 'Machine view', icon: LayoutGrid, permission: 'canViewMachineView', group: 'main' },
  // Butta cutting: Jemish, Gaurang and the Godown supervisor. Butta QC: the QC role (bilingual).
  { to: '/butta', label: 'Butta cutting', icon: Scissors, permission: 'canUseButtaModule', group: 'main' },
  { to: '/mill', label: 'Mill', icon: FlaskConical, permission: 'canUseMillModule', group: 'main' },
  { to: '/qc', label: 'QC', hi: 'क्यूसी', icon: BadgeCheck, permission: 'canButtaQc', group: 'main' },
  // Inventory: design-wise pcs and damaged stock (Jemish, Gaurang).
  { to: '/inventory', label: 'Inventory', icon: Boxes, permission: 'canViewInventory', group: 'main' },
  // Dhruvil (dispatch): final takas, split, ready to dispatch, dispatch challans. Jemish / Gaurang have their own Orders.
  { to: '/godown/orders', label: 'Orders', icon: Warehouse, permission: 'canUseGodownOrders', group: 'main', hideWith: 'canViewOrders' },
  { to: '/dispatched', label: 'Dispatched', icon: Truck, permission: 'canDispatch', group: 'main' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'canViewMasters', group: 'masters' },
  { to: '/materials', label: 'Materials', icon: Layers, permission: 'canViewMasters', group: 'masters' },
  { to: '/designs', label: 'Designs', icon: Palette, permission: 'canViewMasters', group: 'masters' },
  { to: '/machines', label: 'Machines', icon: Factory, permission: 'canViewMasters', group: 'masters' },
  { to: '/damages', label: 'Damage master', icon: Bandage, permission: 'canViewMasters', group: 'masters' },
  { to: '/butta-parties', label: 'Butta parties', icon: Store, permission: 'canManageButtaParties', group: 'masters' },
  { to: '/mill-parties', label: 'Mill parties', icon: Store, permission: 'canManageMillParties', group: 'masters' },
  { to: '/users', label: 'Users', icon: UserCog, permission: 'canManageUsers', group: 'masters' },
];

export function navItemsFor(can: (p: keyof RolePermissions) => boolean): NavItem[] {
  const seen = new Set<string>();
  return NAV_ITEMS.filter((item) => {
    if (!can(item.permission) || (item.hideWith && can(item.hideWith)) || seen.has(item.to)) return false;
    seen.add(item.to);
    return true;
  });
}
