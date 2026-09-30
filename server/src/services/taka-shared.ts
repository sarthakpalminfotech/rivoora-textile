import { compareTakaNo, type JobsheetEventKind, type Taka } from '@rivoora/shared';
import { takas } from '../db/schema';

/** Columns of a `Taka` DTO. */
export const takaColumns = {
  id: takas.id,
  takaNo: takas.takaNo,
  isDamaged: takas.isDamaged,
  damageType: takas.damageType,
  enteredBy: takas.enteredBy,
  createdAt: takas.createdAt,
};

/** Activity entries hidden from roles without `canViewTakas`. */
export const TAKA_EVENTS: ReadonlySet<JobsheetEventKind> = new Set(['takas_entered', 'takas_edited']);

export function sortTakas<T extends Pick<Taka, 'takaNo'>>(list: T[]): T[] {
  return [...list].sort((a, b) => compareTakaNo(a.takaNo, b.takaNo));
}
