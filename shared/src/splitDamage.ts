/**
 * Sprint 15 — the Split screen: a part marked "Damage" can take over one of the order's earlier open damages.
 * Pure helpers (picker order, single use, pcs mismatch) so the client and the server agree.
 */
import { DAMAGE_TYPE_LABEL, isDamageType } from './pipeline';
import { formatMeters } from './takas';

export interface SplitDamageOption {
  /** `taka_damages.id` */
  id: number;
  takaId: number;
  takaNo: string;
  foundAt: string;
  damageName: string | null;
  /** Open pcs = pcs − resolved pcs (0 when the damage never had a count). */
  openPcs: number;
  /** Original damaged pcs. */
  pcs: number | null;
  /** Sprint 19: the meter twins (set instead, for a meter order's damage). */
  openMeters?: number;
  meters?: number | null;
  /** ISO time the damage was marked. */
  markedAt: string;
  recordedAt: string | null;
  images: { id: number; url: string; thumbUrl: string }[];
}

/** dd-MM-yyyy out of an ISO timestamp. */
export function formatMarkedDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/** "Mill damage · Hole · 2 pcs · 14-10-2026 · Taka 1101" (Sprint 19: metres instead for a meter order's damage). */
export function splitDamageLabel(o: Pick<SplitDamageOption, 'foundAt' | 'damageName' | 'openPcs' | 'openMeters' | 'markedAt' | 'takaNo'>): string {
  const where = DAMAGE_TYPE_LABEL[isDamageType(o.foundAt) ? o.foundAt : 'machine'];
  const qty = o.openMeters != null ? formatMeters(o.openMeters) : `${o.openPcs} pcs`;
  return [where, o.damageName, qty, formatMarkedDate(o.markedAt), `Taka ${o.takaNo}`].filter(Boolean).join(' · ');
}

/**
 * The picker list: the split taka's OWN open damages first, then the other open damages of the order; each group by
 * marked date (oldest first), then id. A damage already picked for another part is left out (`usedIds`), except the
 * one this part currently holds (`keepId`).
 */
export function splitPickerOptions(
  options: readonly SplitDamageOption[],
  splitTakaId: number,
  usedIds: ReadonlySet<number>,
  keepId?: number | null,
): SplitDamageOption[] {
  return options
    .filter((o) => (o.openMeters ?? o.openPcs) > 0 && (!usedIds.has(o.id) || o.id === keepId))
    .sort((a, b) => {
      const own = Number(b.takaId === splitTakaId) - Number(a.takaId === splitTakaId);
      return own || (a.markedAt < b.markedAt ? -1 : a.markedAt > b.markedAt ? 1 : a.id - b.id);
    });
}

export interface MovedPcsCheck {
  /** Blocks saving: more pcs than the part has, or none. */
  error: string | null;
  /** Amber, non-blocking: differs from the original damage. */
  mismatch: string | null;
}

/** The damaged pcs typed for a moved damage vs the damage's open pcs and the part's pcs. */
export function movedDamagePcsCheck(p: { originalOpenPcs: number; entered: number | null; partPcs: number | null }): MovedPcsCheck {
  if (p.entered === null || !Number.isInteger(p.entered) || p.entered < 1) return { error: 'Enter the damaged pcs (at least 1).', mismatch: null };
  if (p.partPcs !== null && p.entered > p.partPcs) return { error: `Can't be more than the part's ${p.partPcs} pcs.`, mismatch: null };
  if (p.entered !== p.originalOpenPcs) {
    return { error: null, mismatch: `Original damage was ${p.originalOpenPcs} pcs — you entered ${p.entered}.` };
  }
  return { error: null, mismatch: null };
}

/** Sprint 19: the meter twin of `movedDamagePcsCheck` — the damaged metres typed for a moved damage on a meter order's split. */
export function movedDamageMetersCheck(p: { originalOpenMeters: number; entered: number | null; partMeters: number | null }): MovedPcsCheck {
  if (p.entered === null || p.entered <= 0) return { error: 'Enter the damaged metres (more than 0).', mismatch: null };
  if (p.partMeters !== null && p.entered > p.partMeters) return { error: `Can't be more than the part's ${p.partMeters} m.`, mismatch: null };
  if (Math.round((p.entered - p.originalOpenMeters) * 100) / 100 !== 0) {
    return { error: null, mismatch: `Original damage was ${p.originalOpenMeters} m — you entered ${p.entered}.` };
  }
  return { error: null, mismatch: null };
}

/** Ids picked more than once across the parts (each existing damage can be moved to ONE part only). */
export function duplicateMovedDamages(parts: readonly (readonly number[])[]): number[] {
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const ids of parts) for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}
