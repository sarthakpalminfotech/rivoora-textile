import { sql } from 'drizzle-orm';
import { compareTakaNo, isDamageType, type ChallanKind, type JobsheetEventKind, type Taka, type TakaDamage } from '@rivoora/shared';
import { takas } from '../db/schema';

/**
 * The taka's damages as a JSON array (all of them: open and resolved) — one query for a whole list, like
 * `machinesJson`. Outer column written explicitly — see the Drizzle gotcha.
 */
export const takaDamagesJson = sql<string | null>`(SELECT json_group_array(json_object('id', d.id, 'damageId', d.damage_id, 'damageName', n.name, 'foundAt', d.found_at, 'pcs', d.pcs, 'resolvedPcs', d.resolved_pcs, 'status', d.status, 'resolvedAt', d.resolved_at, 'resolvedBy', d.resolved_by, 'resolvedStage', d.resolved_stage, 'createdAt', d.created_at)) FROM taka_damages d LEFT JOIN damages n ON n.id = d.damage_id WHERE d.taka_id = "takas"."id" AND d.is_deleted = 0)`;

/** The latest challan the taka is on (the newest active challan row: butta cutting, later the mill), if any. */
export const takaChallanId = sql<number | null>`(SELECT ct.challan_id FROM challan_takas ct WHERE ct.taka_id = "takas"."id" AND ct.is_active = 1 ORDER BY ct.id DESC LIMIT 1)`;
export const takaChallanNo = sql<number | null>`(SELECT c.challan_no FROM challan_takas ct JOIN challans c ON c.id = ct.challan_id WHERE ct.taka_id = "takas"."id" AND ct.is_active = 1 ORDER BY ct.id DESC LIMIT 1)`;
export const takaChallanKind = sql<ChallanKind | null>`(SELECT ct.kind FROM challan_takas ct WHERE ct.taka_id = "takas"."id" AND ct.is_active = 1 ORDER BY ct.id DESC LIMIT 1)`;

/** Columns of a `Taka` DTO (select from `takas`; run the rows through `mapTaka`). */
export const takaColumns = {
  id: takas.id,
  takaNo: takas.takaNo,
  meters: takas.meters,
  pcs: takas.pcs,
  isDamaged: takas.isDamaged,
  damagesJson: takaDamagesJson,
  stage: takas.stage,
  challanId: takaChallanId,
  challanNo: takaChallanNo,
  challanKind: takaChallanKind,
  enteredBy: takas.enteredBy,
  createdAt: takas.createdAt,
};

export function parseDamagesJson(raw: string | null): TakaDamage[] {
  if (!raw) return [];
  const list = JSON.parse(raw) as {
    id: number | null;
    damageId: number | null;
    damageName: string | null;
    foundAt: string | null;
    pcs: number | null;
    resolvedPcs: number | null;
    status: string;
    resolvedAt: string | null;
    resolvedBy: TakaDamage['resolvedBy'];
    resolvedStage: string | null;
    createdAt: string;
  }[];
  return list
    .filter((d) => d.id !== null)
    .map(
      (d): TakaDamage => ({
        id: d.id!,
        damageId: d.damageId,
        damageName: d.damageName,
        foundAt: isDamageType(d.foundAt) ? d.foundAt : 'machine',
        pcs: d.pcs,
        resolvedPcs: d.resolvedPcs ?? 0,
        status: d.status === 'resolved' ? 'resolved' : 'open',
        resolvedAt: d.resolvedAt,
        resolvedBy: d.resolvedBy,
        resolvedStage: d.resolvedStage,
        createdAt: d.createdAt,
      }),
    )
    .sort((a, b) => a.id - b.id);
}

type TakaRow = Omit<Taka, 'damages'> & { damagesJson: string | null };

/** A row selected with `takaColumns` → the `Taka` DTO. */
export function mapTaka<T extends TakaRow>({ damagesJson, ...rest }: T): Omit<T, 'damagesJson'> & { damages: TakaDamage[] } {
  return { ...rest, damages: parseDamagesJson(damagesJson) };
}

/** Activity entries hidden from roles without `canViewTakas`. */
export const TAKA_EVENTS: ReadonlySet<JobsheetEventKind> = new Set(['takas_entered', 'takas_edited']);

export function sortTakas<T extends Pick<Taka, 'takaNo'>>(list: T[]): T[] {
  return [...list].sort((a, b) => compareTakaNo(a.takaNo, b.takaNo));
}
