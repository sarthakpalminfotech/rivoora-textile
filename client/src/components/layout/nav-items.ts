import {
  Bandage,
  Boxes,
  Database,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FlaskConical,
  BadgeCheck,
  LayoutGrid,
  Layers,
  Palette,
  PackageSearch,
  ReceiptText,
  RotateCw,
  ScanLine,
  Spool,
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
  /** Masters live on the one Masters page (/masters), not in the nav. */
  group: 'main' | 'masters';
  /** Hidden for roles that have this permission (the godown Orders item is not shown next to Jenish's own Orders). */
  hideWith?: keyof RolePermissions;
  /** Position in the phone / tablet bottom bar (lower first); unnumbered items follow, and spill into More. */
  phoneOrder?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/orders', label: 'Orders', icon: ClipboardList, permission: 'canViewOrders', group: 'main', phoneOrder: 1 },
  // The supervisor's Orders: the orders in production, view only (no client or money).
  { to: '/orders', label: 'Orders', icon: ClipboardList, permission: 'canViewProductionOrders', group: 'main' },
  // Sprint 15: the godown supervisor's read-only Orders (butta cutting onwards, no client or money).
  { to: '/orders', label: 'Orders', icon: ClipboardList, permission: 'canViewGodownOrders', group: 'main' },
  { to: '/scan', label: 'Scan jobsheet', hi: 'जॉबशीट स्कैन करें', icon: ScanLine, permission: 'canUseTakaModules', group: 'main' },
  // Same path, different module: the supervisor's list or the Taka entry list (a role only ever has one).
  { to: '/jobsheets', label: 'Jobsheets', icon: ClipboardCheck, permission: 'canViewJobsheetsModule', group: 'main' },
  { to: '/jobsheets', label: 'Jobsheets', hi: 'जॉबशीट', icon: ClipboardCheck, permission: 'canUseTakaModules', group: 'main' },
  { to: '/machine-view', label: 'Machine view', icon: LayoutGrid, permission: 'canViewMachineView', group: 'main', phoneOrder: 2 },
  // Butta cutting: Jenish, Gaurang and the Godown supervisor. Butta QC: the QC role (bilingual).
  { to: '/butta', label: 'Butta cutting', icon: Scissors, permission: 'canUseButtaModule', group: 'main' },
  { to: '/mill', label: 'Mill', icon: FlaskConical, permission: 'canUseMillModule', group: 'main' },
  { to: '/qc', label: 'QC', hi: 'क्यूसी', icon: BadgeCheck, permission: 'canButtaQc', group: 'main' },
  // Inventory: design-wise pcs and damaged stock (Jenish, Gaurang).
  { to: '/inventory', label: 'Inventory', icon: Boxes, permission: 'canViewInventory', group: 'main', phoneOrder: 3 },
  // Dhruvil (dispatch): final takas, split, ready to dispatch, dispatch challans. Jenish / Gaurang have their own Orders.
  { to: '/godown/orders', label: 'Orders', icon: Warehouse, permission: 'canUseGodownOrders', group: 'main', hideWith: 'canViewOrders' },
  { to: '/dispatched', label: 'Dispatched', icon: Truck, permission: 'canDispatch', group: 'main' },
  // Sprint 16: Receive goods (outside weavers' challans, FG purchases) — the godown supervisor and Dhruvil; Jenish /
  // Gaurang receive from the order's Outside production tab instead, so it is not in their nav.
  { to: '/receive-goods', label: 'Receive goods', icon: PackageSearch, permission: 'canReceiveOutside', group: 'main', hideWith: 'canViewOrders' },
  // Sprint 17: yarn (Jenish, Gaurang, the Supervisor, the Godown supervisor) — not in the bar, they go into More.
  { to: '/yarn', label: 'Yarn inventory', icon: Spool, permission: 'canUseYarnInventory', group: 'main' },
  { to: '/yarn-po', label: 'Yarn PO', icon: ReceiptText, permission: 'canViewYarn', group: 'main' },
  // One Masters entry; the page lists every master the role may open.
  { to: '/masters', label: 'Masters', icon: Database, permission: 'canViewMasters', group: 'main' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'canViewMasters', group: 'masters' },
  { to: '/materials', label: 'Materials', icon: Layers, permission: 'canViewMasters', group: 'masters' },
  { to: '/designs', label: 'Designs', icon: Palette, permission: 'canViewMasters', group: 'masters' },
  // Sprint 18: Dhruvil's view-only Design library (roles with masters reach it through the Masters page).
  { to: '/designs', label: 'Design library', icon: Palette, permission: 'canViewDesignLibrary', group: 'main', hideWith: 'canViewMasters' },
  { to: '/machines', label: 'Machines', icon: Factory, permission: 'canViewMasters', group: 'masters' },
  { to: '/damages', label: 'Damage master', icon: Bandage, permission: 'canViewMasters', group: 'masters' },
  { to: '/butta-parties', label: 'Butta parties', icon: Store, permission: 'canManageButtaParties', group: 'masters' },
  { to: '/mill-parties', label: 'Mill parties', icon: Store, permission: 'canManageMillParties', group: 'masters' },
  { to: '/weavers', label: 'Weavers', icon: Store, permission: 'canManageWeavers', group: 'masters' },
  // Sprint 17: yarn masters (Jenish, Gaurang).
  { to: '/yarn-parties', label: 'Yarn parties', icon: Store, permission: 'canManageYarnMasters', group: 'masters' },
  { to: '/yarn-qualities', label: 'Yarn qualities', icon: Spool, permission: 'canManageYarnMasters', group: 'masters' },
  { to: '/tfo-machines', label: 'TFO machines', icon: RotateCw, permission: 'canManageYarnMasters', group: 'masters' },
  // Sprint 20: Warping qualities (twisted yarn's identity from the TFO stop onward).
  { to: '/warping-qualities', label: 'Warping qualities', icon: Spool, permission: 'canManageYarnMasters', group: 'masters' },
  { to: '/users', label: 'Users', icon: UserCog, permission: 'canManageUsers', group: 'masters' },
];

/** Paths that belong to the Masters entry (it stays highlighted on every master screen). */
export const MASTER_PATHS = NAV_ITEMS.filter((i) => i.group === 'masters').map((i) => i.to);

export function isMasterPath(pathname: string) {
  return pathname === '/masters' || MASTER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Items for the sidebar / bottom bar (the masters themselves are reached through the Masters page). */
export function navItemsFor(can: (p: keyof RolePermissions) => boolean): NavItem[] {
  return visible(can, 'main');
}

/** Every master the role may open — the Masters page. */
export function mastersFor(can: (p: keyof RolePermissions) => boolean): NavItem[] {
  return visible(can, 'masters');
}

function visible(can: (p: keyof RolePermissions) => boolean, group: NavItem['group']): NavItem[] {
  const seen = new Set<string>();
  return NAV_ITEMS.filter((item) => {
    if (item.group !== group || !can(item.permission) || (item.hideWith && can(item.hideWith)) || seen.has(item.to)) return false;
    seen.add(item.to);
    return true;
  });
}
