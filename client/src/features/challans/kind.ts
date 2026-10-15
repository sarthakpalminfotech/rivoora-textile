import { CHALLAN_KIND_CONFIG, type ChallanKind } from '@rivoora/shared';
import type { RolePermissions } from '@/config/roles';

/**
 * Client side of a challan kind: butta cutting and the mill share every screen, only the config differs. The kind
 * rules (stages, prefix, labels) live in `CHALLAN_KIND_CONFIG` (shared); this adds the routes and permissions.
 */

/** Permission to use the module of a kind (Jenish, Gaurang, Godown supervisor). */
export const kindPermission = (kind: ChallanKind): keyof RolePermissions => (kind === 'butta' ? 'canUseButtaModule' : 'canUseMillModule');

/** `/butta/challans/12` or `/mill/challans/12` */
export const challanDetailsPath = (kind: ChallanKind, id: number) => `${CHALLAN_KIND_CONFIG[kind].route}/challans/${id}`;

/** The print route of a challan (A4 landscape). */
export const challanPrintPath = (kind: ChallanKind, id: number) => (kind === 'butta' ? `/print/challan/${id}` : `/print/mill-challan/${id}`);

/** Where "Send → In …" (the challan list) lives. */
export const sentListPath = (kind: ChallanKind, filter?: string) =>
  `${CHALLAN_KIND_CONFIG[kind].route}?tab=send&sub=sent${filter ? `&filter=${filter}` : ''}`;

/** "Open challans" noun for sentences: "waiting to be received". */
export const kindNoun = (kind: ChallanKind) => CHALLAN_KIND_CONFIG[kind].place;
