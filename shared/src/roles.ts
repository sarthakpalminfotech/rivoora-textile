/**
 * Central role configuration. The client re-exports this from
 * client/src/config/roles.ts and the server from server/src/config/roles.ts.
 * To add a role: add its key to ROLE_KEYS, give it a config below and
 * add it to `visibleTo` of the statuses it may see (see statuses.ts).
 */
export const ROLE_KEYS = ['jemish', 'gaurang', 'supervisor', 'taka_entry', 'godown_supervisor', 'qc', 'dhruvil'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RolePermissions {
  /** Orders module (list, details, order endpoints). */
  canViewOrders: boolean;
  /** Master data (customers, materials, designs, machine master) — read access. */
  canViewMasters: boolean;
  /** Can see the rate of an order (details screen / add form only, never the list). */
  canSeeRate: boolean;
  /** Can see client / broker names and contact details on orders. */
  canSeeClient: boolean;
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
  /** The supervisor opens the Orders screens (list, details, dashboard, takas…) read-only, without client or money. */
  canViewProductionOrders: boolean;
  /** Inventory module (/inventory): design-wise pcs, damaged stock. Jenish + Gaurang only (order lists show client names). */
  canViewInventory: boolean;
  /** Send takas back to butta cutting / the mill from the order's Takas tab (Jenish, Gaurang). */
  canReworkTakas: boolean;
  /** Dispatch module: create dispatch challans (DC-n), the Dispatched screens. */
  canDispatch: boolean;
  /** Goods return (GR) on a dispatch challan. */
  canGoodsReturn: boolean;
  /** Sprint 13: Move to inventory (free stock) and Add from free stock / Assign to order. */
  canMoveToInventory: boolean;
  /** Inventory → Damaged → Mark as fresh. */
  canMarkFresh: boolean;
  /** Act as another role (the profile menu's Switch role, X-Act-As header). */
  canSwitchRoles: boolean;
  /** The Users master. */
  canManageUsers: boolean;
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

/** Sprint 12 permissions — everything off (spread into every role, then switched on where needed). */
const NO_SPRINT12 = {
  canReworkTakas: false,
  canDispatch: false,
  canGoodsReturn: false,
  canMoveToInventory: false,
  canMarkFresh: false,
  canSwitchRoles: false,
  canManageUsers: false,
};
/** Jenish + Gaurang: all the Sprint 12 owner permissions. */
const OWNER_SPRINT12 = {
  canReworkTakas: true,
  canDispatch: true,
  canGoodsReturn: true,
  canMoveToInventory: true,
  canMarkFresh: true,
  canSwitchRoles: true,
  canManageUsers: true,
};

const NO_TAKAS = { canUseTakaModules: false, canEnterTakas: false, canEditTakas: false, canViewTakas: false };
const NO_BUTTA = { canUseButtaModule: false, canCancelChallan: false, canManageButtaParties: false, canButtaQc: false };
const NO_MILL = {
  canUseMillModule: false,
  canManageMillParties: false,
  canMillQc: false,
  canUseGodownOrders: false,
  canViewInventory: false,
  canViewProductionOrders: false,
};
/** Everything off — the base of the two Sprint 7 roles, which only get what they need. */
const NOTHING = {
  canViewOrders: false,
  canViewMasters: false,
  canSeeRate: false,
  canSeeClient: false,
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
  ...NO_SPRINT12,
};

export const ROLES: Record<RoleKey, RoleConfig> = {
  jemish: {
    key: 'jemish',
    name: 'Jenish',
    title: 'Owner',
    initials: 'J',
    landing: '/orders',
    permissions: {
      canViewOrders: true,
      canViewMasters: true,
      canSeeRate: true,
      canSeeClient: true,
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
      canViewProductionOrders: false,
      ...OWNER_SPRINT12,
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
      canSeeClient: true,
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
      canViewProductionOrders: false,
      ...OWNER_SPRINT12,
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
      canSeeClient: false,
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
      canViewTakas: true,
      ...NO_BUTTA,
      ...NO_MILL,
      ...NO_SPRINT12,
      canViewProductionOrders: true,
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
      canSeeClient: false,
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
      ...NO_SPRINT12,
    },
  },
  godown_supervisor: {
    key: 'godown_supervisor',
    name: 'Godown supervisor',
    title: 'Godown',
    initials: 'GS',
    landing: '/butta',
    // Restricted view: order numbers, design and quality only (no client, rate or other order details).
    // Sprint 12: the godown Orders module moved to Dhruvil — he keeps Butta cutting and Mill.
    permissions: { ...NOTHING, canUseButtaModule: true, canUseMillModule: true },
  },
  // One person does both QCs: the Butta QC and the Mill QC share this role and one screen (/qc).
  qc: {
    key: 'qc',
    name: 'QC',
    title: 'क्यूसी',
    initials: 'Q',
    landing: '/qc',
    bilingual: true,
    // Restricted view: order number, design and quality only (never the client).
    permissions: { ...NOTHING, canButtaQc: true, canMillQc: true },
  },
  // Dispatch (Sprint 12): the godown Orders module, dispatch challans, goods return, move to order. Sees client + rate.
  dhruvil: {
    key: 'dhruvil',
    name: 'Dhruvil',
    title: 'Dispatch',
    initials: 'D',
    landing: '/godown/orders',
    permissions: {
      ...NOTHING,
      canSeeClient: true,
      canSeeRate: true,
      canUseGodownOrders: true,
      canDispatch: true,
      canGoodsReturn: true,
      canMoveToInventory: true,
    },
  },
};

export const DEFAULT_ROLE: RoleKey = 'jemish';
export const ROLE_HEADER = 'X-Role';
/** Header a role-switching user (Jenish, Gaurang) sends to act with another role's permissions. */
export const ACT_AS_HEADER = 'X-Act-As';

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}

export function can(role: RoleKey, permission: keyof RolePermissions): boolean {
  return ROLES[role].permissions[permission];
}

export function landingRoute(role: RoleKey): string {
  return ROLES[role].landing;
}
