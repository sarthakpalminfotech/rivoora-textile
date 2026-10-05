import { sql } from 'drizzle-orm';
import { compareTakaNo, type JobsheetEventKind, type Taka } from '@rivoora/shared';
import { takas } from '../db/schema';

/** The taka's damage name from the Damage master (outer column written explicitly — see the Drizzle gotcha). */
export const takaDamageName = sql<string | null>`(SELECT d.name FROM damages d WHERE d.id = "takas"."damage_id")`;

/** Columns of a `Taka` DTO (select from `takas`; not usable in RETURNING because of the damage name). */
export const takaColumns = {
  id: takas.id,
  takaNo: takas.takaNo,
  meters: takas.meters,
  pcs: takas.pcs,
  isDamaged: takas.isDamaged,
  damageType: takas.damageType,
  damageId: takas.damageId,
  damageName: takaDamageName,
  stage: takas.stage,
  enteredBy: takas.enteredBy,
  createdAt: takas.createdAt,
};

/** Activity entries hidden from roles without `canViewTakas`. */
export const TAKA_EVENTS: ReadonlySet<JobsheetEventKind> = new Set(['takas_entered', 'takas_edited']);

export function sortTakas<T extends Pick<Taka, 'takaNo'>>(list: T[]): T[] {
  return [...list].sort((a, b) => compareTakaNo(a.takaNo, b.takaNo));
}
