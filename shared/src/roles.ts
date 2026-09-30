/**
 * Central role configuration. The client re-exports this from
 * client/src/config/roles.ts and the server from server/src/config/roles.ts.
 * To add a role: add its key to ROLE_KEYS, give it a config below and
 * add it to `visibleTo` of the statuses it may see (see statuses.ts).
 */
export const ROLE_KEYS = ['jemish', 'gaurang', 'supervisor', 'taka_entry'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RolePermissions {
  /** Orders module (list, details, order endpoints). */
  canViewOrders: boolean;
  /** Master data (customers, materials, designs, machine master) — read access. */
  canViewMasters: boolean;
  /** Can see the rate of an order (details screen / add form only, never the list). */
  canSeeRate: boolean;
  canAddOrder: boolean;
  canSendToProduction: boolean;
  canUndoProduction: boolean;
  /** Add / edit / delete customers, materials and designs. */
  canManageMasters: boolean;
  /** Create, edit, delete, send to the supervisor and pull back jobsheets. */
  canManageJobsheets: boolean;
  /** Add / edit / delete machines (looms). */
  canManageMachines: boolean;
  /** The supervisor's Jobsheets module (`/jobsheets`). */
  canViewJobsheetsModule: boolean;
  /** Start / complete / change machine on a jobsheet. */
  canRunJobsheets: boolean;
  canPrintJobsheets: boolean;
  /** The machine floor board (`/machine-view`). */
  canViewMachineView: boolean;
  /** Taka entry modules: Scan jobsheet (`/scan`) and the Taka jobsheets list (`/jobsheets`). */
  canUseTakaModules: boolean;
  /** Add new takas to a jobsheet (completes the jobsheet if it isn't yet). */
  canEnterTakas: boolean;
  /** Edit or remove submitted takas and edit the taka note. */
  canEditTakas: boolean;
  /** See takas on order and jobsheet details (the Taka entry role: on his own screens only). */
  canViewTakas: boolean;
}

export interface RoleConfig {
  key: RoleKey;
  name: string;
  title: string;
  initials: string;
  /** Where `/` and a role switch land. */
  landing: string;
  /** Screens of this role show English + Hindi labels. */
  bilingual?: boolean;
  permissions: RolePermissions;
}

const NO_TAKAS = { canUseTakaModules: false, canEnterTakas: false, canEditTakas: false, canViewTakas: false };

export const ROLES: Record<RoleKey, RoleConfig> = {
  jemish: {
    key: 'jemish',
    name: 'Jemish',
    title: 'Owner',
    initials: 'J',
    landing: '/orders',
    permissions: {
      canViewOrders: true,
      canViewMasters: true,
      canSeeRate: true,
      canAddOrder: true,
      canSendToProduction: true,
      canUndoProduction: true,
      canManageMasters: true,
      canManageJobsheets: true,
      canManageMachines: true,
      canViewJobsheetsModule: false,
      canRunJobsheets: false,
      canPrintJobsheets: true,
      canViewMachineView: true,
      ...NO_TAKAS,
      canEditTakas: true,
      canViewTakas: true,
    },
  },
  gaurang: {
    key: 'gaurang',
    name: 'Gaurang',
    title: 'Partner',
    initials: 'G',
    landing: '/orders',
    permissions: {
      canViewOrders: true,
      canViewMasters: true,
      canSeeRate: true,
      canAddOrder: false,
      canSendToProduction: false,
      canUndoProduction: false,
      canManageMasters: false,
      canManageJobsheets: true,
      canManageMachines: true,
      canViewJobsheetsModule: false,
      canRunJobsheets: false,
      canPrintJobsheets: true,
      canViewMachineView: true,
      ...NO_TAKAS,
      canEditTakas: true,
      canViewTakas: true,
    },
  },
  supervisor: {
    key: 'supervisor',
    name: 'Supervisor',
    title: 'Production',
    initials: 'S',
    landing: '/jobsheets',
    permissions: {
      canViewOrders: false,
      canViewMasters: false,
      canSeeRate: false,
      canAddOrder: false,
      canSendToProduction: false,
      canUndoProduction: false,
      canManageMasters: false,
      canManageJobsheets: false,
      canManageMachines: false,
      canViewJobsheetsModule: true,
      canRunJobsheets: true,
      canPrintJobsheets: true,
      canViewMachineView: true,
      ...NO_TAKAS,
    },
  },
  taka_entry: {
    key: 'taka_entry',
    name: 'Taka entry',
    title: 'टाका एंट्री',
    initials: 'T',
    landing: '/scan',
    bilingual: true,
    permissions: {
      canViewOrders: false,
      canViewMasters: false,
      canSeeRate: false,
      canAddOrder: false,
      canSendToProduction: false,
      canUndoProduction: false,
      canManageMasters: false,
      canManageJobsheets: false,
      canManageMachines: false,
      canViewJobsheetsModule: false,
      canRunJobsheets: false,
      canPrintJobsheets: false,
      canViewMachineView: false,
      canUseTakaModules: true,
      canEnterTakas: true,
      canEditTakas: false,
      canViewTakas: true,
    },
  },
};

export const DEFAULT_ROLE: RoleKey = 'jemish';
export const ROLE_HEADER = 'X-Role';

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}

export function can(role: RoleKey, permission: keyof RolePermissions): boolean {
  return ROLES[role].permissions[permission];
}

export function landingRoute(role: RoleKey): string {
  return ROLES[role].landing;
}
