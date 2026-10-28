import { eq, and, inArray } from 'drizzle-orm';
import {
  applyResolve,
  damageLabel,
  MAX_DAMAGE_IMAGES,
  validateQcDecisions,
  DAMAGE_NOT_MARKED,
  DAMAGE_RECORDED_AT_LABEL,
  type ChoosableDamageType,
  type DamageRecordedAt,
  type DamageType,
  type RoleKey,
} from '@rivoora/shared';
import type { Tx } from '../db/client';
import { damages as damageMaster, takaDamageImages, takaDamages } from '../db/schema';
import { badRequest, conflict } from '../lib/errors';
import { insertTakaDamages, resolveDamageNames, type TakaEventInput } from './taka-ops';

/**
 * The damage part shared by every QC / check that works on a taka: Butta QC, Mill QC and the godown. Photos come from
 * our own upload endpoint: a local `/uploads/…` path or an https (Cloudinary) URL.
 */
export const isOurImageUrl = (url: string) => url.startsWith('/uploads/') || /^https:\/\//i.test(url);

export interface NewDamageInput {
  /** The damage type chosen with the radio; null/absent = "not marked" (goods return only). Sprint 16: + weaver. */
  type?: ChoosableDamageType | null;
  /**
   * Sprint 19: exactly one of `pcs` / `meters` is present, matching the order's unit (`pcs` for a pcs order,
   * `meters` for a meter order — the meters-bound QC logic itself is Phase 8 work; today this is only typed
   * loosely enough for the taka-entry/outside-receipt/split call sites sharing this type to compile).
   */
  pcs?: number;
  meters?: number;
  images: { url: string; thumbUrl: string }[];
  damageId?: number;
  otherName?: string;
}

/** 400 when a new damage carries bad photos or more pcs than the taka has. */
export function assertNewDamages(newDamages: readonly NewDamageInput[], takaPcs: number, field = 'newDamages') {
  newDamages.forEach((d, j) => {
    if (d.images.length > MAX_DAMAGE_IMAGES) throw badRequest(`At most ${MAX_DAMAGE_IMAGES} images per damage.`, `${field}.${j}.images`);
    if (d.images.some((i) => !isOurImageUrl(i.url) || !isOurImageUrl(i.thumbUrl))) throw badRequest('Upload the photos again.', `${field}.${j}.images`);
    if (d.pcs !== undefined && d.pcs > takaPcs) throw badRequest(`A damage can't have more pcs than the taka (${takaPcs}).`, `${field}.${j}.pcs`);
  });
}

/** Adds NEW open damages (with photos) to a taka and returns their `damage_added` events. */
export async function addNewDamages(
  tx: Tx,
  role: RoleKey,
  takaId: number,
  newDamages: readonly NewDamageInput[],
  recordedAt: DamageRecordedAt,
  at: string,
  field = 'newDamages',
): Promise<TakaEventInput[]> {
  if (!newDamages.length) return [];
  // Sprint 13: the type is the person's choice (required everywhere except goods return -> "not marked").
  const typeOf = (d: NewDamageInput, n: number): DamageType => {
    if (d.type) return d.type;
    if (recordedAt === 'goods_return') return DAMAGE_NOT_MARKED;
    throw badRequest('Choose the damage type.', `${field}.${n}.type`);
  };
  const types = newDamages.map(typeOf);
  const damageIds = await resolveDamageNames(
    tx,
    newDamages.map((d) => (d.damageId !== undefined ? { damageId: d.damageId } : { otherName: d.otherName ?? '' })),
    (n) => `${field}.${n}`,
  );
  const newIds = await insertTakaDamages(
    tx,
    role,
    newDamages.map((d, n) => ({ takaId, damageId: damageIds[n], pcs: d.pcs ?? null, meters: d.meters ?? null, foundAt: types[n], recordedAt })),
  );
  for (const [n, d] of newDamages.entries()) {
    if (!d.images.length) continue;
    await tx
      .insert(takaDamageImages)
      .values(d.images.map((i) => ({ takaDamageId: newIds[n], imageUrl: i.url, thumbUrl: i.thumbUrl, createdBy: role, createdAt: at })));
  }
  const names = new Map(
    (await tx.select({ id: damageMaster.id, name: damageMaster.name }).from(damageMaster).where(inArray(damageMaster.id, damageIds))).map((r) => [r.id, r.name]),
  );
  return newDamages.map((d, n) => ({
    takaId,
    event: 'damage_added' as const,
    takaDamageId: newIds[n],
    note: `${damageLabel(types[n], names.get(damageIds[n]), d.pcs ?? null, d.meters ?? null)} · recorded at ${DAMAGE_RECORDED_AT_LABEL[recordedAt]}${d.images.length ? ` · ${d.images.length} photo${d.images.length === 1 ? '' : 's'}` : ''}`,
  }));
}

export interface QcChangesInput {
  damageDecisions: { takaDamageId: number; resolvedPcs: number; pcs?: number | null }[];
  newDamages: readonly NewDamageInput[];
}

export interface QcChangesResult {
  events: TakaEventInput[];
  resolved: number;
  kept: number;
  added: number;
}

/**
 * A decision per open damage (pcs resolved now; 0 = not resolved) and the new damages, in the
 * caller's transaction. `requireAnswers` = every open damage must be answered (false when the taka goes to refinish:
 * unanswered damages simply stay open). `label` = "Butta QC" / "Mill QC" for the `edited` event.
 */
export async function applyQcChanges(
  tx: Tx,
  role: RoleKey,
  taka: { id: number; meters: number | null; pcs: number | null },
  data: QcChangesInput,
  opts: { recordedAt: DamageRecordedAt; resolvedStage: string; label: string; requireAnswers: boolean },
  at: string,
): Promise<QcChangesResult> {
  const takaId = taka.id;
  // Meters / pcs are read-only for QC (Sprint 15): the taka's own pcs bound the damages (older takas without pcs: no bound).
  const takaPcs = taka.pcs ?? Number.MAX_SAFE_INTEGER;
  assertNewDamages(data.newDamages, takaPcs);
  const open = await tx
    .select({
      id: takaDamages.id,
      damageId: takaDamages.damageId,
      foundAt: takaDamages.foundAt,
      pcs: takaDamages.pcs,
      resolvedPcs: takaDamages.resolvedPcs,
      name: damageMaster.name,
    })
    .from(takaDamages)
    .leftJoin(damageMaster, eq(damageMaster.id, takaDamages.damageId))
    .where(and(eq(takaDamages.takaId, takaId), eq(takaDamages.status, 'open'), eq(takaDamages.isDeleted, false)));

  const answered = new Set(data.damageDecisions.map((d) => d.takaDamageId));
  const issues = validateQcDecisions(
    opts.requireAnswers ? open : open.filter((o) => answered.has(o.id)),
    data.damageDecisions,
    takaPcs,
  );
  if (issues.unknown.length) throw conflict('This taka was just changed by someone else. Go back and open it again.');
  if (issues.unanswered.length) throw badRequest('Answer every damage: resolved or not resolved.', 'damageDecisions');
  if (issues.pcsMissing.length) throw badRequest('Enter how many pcs are damaged.', 'damageDecisions');
  if (issues.pcsTooBig.length) throw badRequest(`A damage can't have more pcs than the taka (${takaPcs}).`, 'damageDecisions');
  if (issues.resolvedTooBig.length) throw badRequest("You can't resolve more pcs than are still damaged.", 'damageDecisions');

  const events: TakaEventInput[] = [];

  const byId = new Map(data.damageDecisions.map((d) => [d.takaDamageId, d]));
  let resolved = 0;
  let kept = 0;
  for (const d of open) {
    const decision = byId.get(d.id);
    if (!decision) continue; // refinish: left as it is
    const pcs = d.pcs ?? decision.pcs ?? 0;
    if (decision.resolvedPcs <= 0) {
      if (d.pcs === null) await tx.update(takaDamages).set({ pcs }).where(eq(takaDamages.id, d.id));
      events.push({ takaId, event: 'damage_kept', takaDamageId: d.id, note: damageLabel(d.foundAt, d.name, pcs - (d.resolvedPcs ?? 0)) });
      kept += 1;
      continue;
    }
    const next = applyResolve({ pcs, resolvedPcs: d.resolvedPcs }, decision.resolvedPcs);
    await tx
      .update(takaDamages)
      .set(
        next.status === 'resolved'
          ? { status: 'resolved', resolvedPcs: next.resolvedPcs, resolvedAt: at, resolvedBy: role, resolvedStage: opts.resolvedStage, pcs }
          : { resolvedPcs: next.resolvedPcs, pcs },
      )
      .where(eq(takaDamages.id, d.id));
    events.push({
      takaId,
      event: next.status === 'resolved' ? 'damage_resolved' : 'damage_partly_resolved',
      takaDamageId: d.id,
      note: `${damageLabel(d.foundAt, d.name)} · resolved ${next.resolvedPcs} of ${pcs} pcs`,
    });
    if (next.status === 'resolved') resolved += 1;
    else kept += 1;
  }

  events.push(...(await addNewDamages(tx, role, takaId, data.newDamages, opts.recordedAt, at)));
  return { events, resolved, kept, added: data.newDamages.length };
}
