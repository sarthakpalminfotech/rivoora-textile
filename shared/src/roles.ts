/**
 * Central role configuration. The client re-exports this from
 * client/src/config/roles.ts and the server from server/src/config/roles.ts.
 * To add a role: add its key to ROLE_KEYS, give it a config below and
 * add it to `visibleTo` of the statuses it may see (see statuses.ts).
 */
export const ROLE_KEYS = ['jemish', 'gaurang', 'supervisor', 'taka_entry', 'godown_supervisor', 'butta_qc', 'mill_qc'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RolePermissions {
  /** Orders module (list, details, order endpoints). */
  canViewOrders: boolean;
  /** Master data (customers, materials, designs, machine master) — read access. */
  canViewMasters: boolean;
  /** Can see the rate of an order (details screen / add form only, never the list). */
  canSeeRate: boolean;
  canAddOrder: boolean;
  /** Edit an existing order (client, material, design, quantity, rate, date, notes) from its details screen. */
  canEditOrder: boolean;
  canSendToProduction: boolean;
  canUndoProduction: boolean;
  /** Add / edit / delete customers, materials and designs. */
  canManageMasters: boolean;
  /** Add / edit / delete names in the Damage master. */
  canManageDamages: boolean;
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
  /** Butta cutting module (`/butta`): send takas on a challan + receive them back. */
  canUseButtaModule: boolean;
  /** Cancel a challan (only while nothing on it has been received). */
  canCancelChallan: boolean;
  /** Butta parties master. */
  canManageButtaParties: boolean;
  /** Butta QC screens (`/butta-qc`): check the takas received back from butta cutting. */
  canButtaQc: boolean;
  /** Mill module (`/mill`): send takas to the mill on a challan + receive them back. */
  canUseMillModule: boolean;
  /** Mill parties master. */
  canManageMillParties: boolean;
  /** Mill QC screens (/mill-qc): the last check of the takas that came back from the mill. */
  canMillQc: boolean;
  /** Godown Orders module (/godown/orders): final takas, split, ready to dispatch. */
  canUseGodownOrders: boolean;
  /** Inventory module (/inventory): design-wise pcs, damaged stock. Jemish + Gaurang only (order lists show client names). */
  canViewInventory: boolean;
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
  /** Order details open on the Jobsheets tab (instead of Dashboard) while the order is Jobsheet pending. */
  jobsheetsTabWhenPending?: boolean;
  permissions: RolePermissions;
}

const NO_TAKAS = { canUseTakaModules: false, canEnterTakas: false, canEditTakas: false, canViewTakas: false };
const NO_BUTTA = { canUseButtaModule: false, canCancelChallan: false, canManageButtaParties: false, canButtaQc: false };
const NO_MILL = { canUseMillModule: false, canManageMillParties: false, canMillQc: false, canUseGodownOrders: false, canViewInventory: false };
/** Everything off — the base of the two Sprint 7 roles, which only get what they need. */
const NOTHING = {
  canViewOrders: false,
  canViewMasters: false,
  canSeeRate: false,
  canAddOrder: false,
  canEditOrder: false,
  canSendToProduction: false,
  canUndoProduction: false,
  canManageMasters: false,
  canManageDamages: false,
  canManageJobsheets: false,
  canManageMachines: false,
  canViewJobsheetsModule: false,
  canRunJobsheets: false,
  canPrintJobsheets: false,
  canViewMachineView: false,
  ...NO_TAKAS,
  ...NO_BUTTA,
  ...NO_MILL,
};

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
      canEditOrder: true,
      canSendToProduction: true,
      canUndoProduction: true,
      canManageMasters: true,
      canManageDamages: true,
      canManageJobsheets: true,
      canManageMachines: true,
      canViewJobsheetsModule: false,
      canRunJobsheets: false,
      canPrintJobsheets: true,
      canViewMachineView: true,
      ...NO_TAKAS,
      canEditTakas: true,
      canViewTakas: true,
      canUseButtaModule: true,
      canCancelChallan: true,
      canManageButtaParties: true,
      canButtaQc: false,
      canUseMillModule: true,
      canManageMillParties: true,
      canMillQc: false,
      canUseGodownOrders: true,
      canViewInventory: true,
    },
  },
  gaurang: {
    key: 'gaurang',
    name: 'Gaurang',
    title: 'Partner',
    initials: 'G',
    landing: '/orders',
    jobsheetsTabWhenPending: true,
    permissions: {
      canViewOrders: true,
      canViewMasters: true,
      canSeeRate: true,
      canAddOrder: false,
      canEditOrder: true,
      canSendToProduction: false,
      canUndoProduction: false,
      canManageMasters: false,
      canManageDamages: true,
      canManageJobsheets: true,
      canManageMachines: true,
      canViewJobsheetsModule: false,
      canRunJobsheets: false,
      canPrintJobsheets: true,
      canViewMachineView: true,
      ...NO_TAKAS,
      canEditTakas: true,
      canViewTakas: true,
      canUseButtaModule: true,
      canCancelChallan: true,
      canManageButtaParties: true,
      canButtaQc: false,
      canUseMillModule: true,
      canManageMillParties: true,
      canMillQc: false,
      canUseGodownOrders: true,
      canViewInventory: true,
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
      canEditOrder: false,
      canSendToProduction: false,
      canUndoProduction: false,
      canManageMasters: false,
      canManageDamages: false,
      canManageJobsheets: false,
      canManageMachines: false,
      canViewJobsheetsModule: true,
      canRunJobsheets: true,
      canPrintJobsheets: true,
      canViewMachineView: true,
      ...NO_TAKAS,
      ...NO_BUTTA,
      ...NO_MILL,
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
      canEditOrder: false,
      canSendToProduction: false,
      canUndoProduction: false,
      canManageMasters: false,
      canManageDamages: false,
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
      ...NO_BUTTA,
      ...NO_MILL,
    },
  },
  godown_supervisor: {
    key: 'godown_supervisor',
    name: 'Godown supervisor',
    title: 'Godown',
    initials: 'GS',
    landing: '/butta',
    // Restricted view: order numbers, design and quality only (no client, rate or other order details).
    permissions: { ...NOTHING, canUseButtaModule: true, canUseMillModule: true, canUseGodownOrders: true },
  },
  butta_qc: {
    key: 'butta_qc',
    name: 'Butta QC',
    title: 'बुट्टा QC',
    initials: 'Q',
    landing: '/butta-qc',
    bilingual: true,
    permissions: { ...NOTHING, canButtaQc: true },
  },
  mill_qc: {
    key: 'mill_qc',
    name: 'Mill QC',
    title: 'मिल QC',
    initials: 'MQ',
    landing: '/mill-qc',
    bilingual: true,
    // Restricted view: order number, design and quality only (never the client).
    permissions: { ...NOTHING, canMillQc: true },
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
