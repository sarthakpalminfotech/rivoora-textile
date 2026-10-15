import { and, eq } from 'drizzle-orm';
import type { MarkFreshResult, RoleKey } from '@rivoora/shared';
import { db } from '../db/client';
import { takas } from '../db/schema';
import { conflict, notFound } from '../lib/errors';
import { clearOpenDamages } from './godown';
import { refreshIsDamaged, writeTakaEvents } from './taka-ops';

/** Mark as fresh (Inventory). Move to order was replaced by Move to inventory (services/inventory-moves.ts) in Sprint 13. */

const now = () => new Date().toISOString();

/**
 * POST /inventory/takas/:id/mark-fresh — resolves EVERY open damage of the taka (`resolved_stage = 'inventory'`),
 * recomputes `is_damaged`. Only for stock that is with us: final, ready for dispatch or refinish.
 */
export async function markTakaFresh(role: RoleKey, id: number): Promise<MarkFreshResult> {
  return db.transaction(async (tx) => {
    const [taka] = await tx
      .select({ id: takas.id, takaNo: takas.takaNo, stage: takas.stage, orderId: takas.orderId })
      .from(takas)
      .where(and(eq(takas.id, id), eq(takas.isDeleted, false)));
    if (!taka) throw notFound('Taka');
    if (!['final', 'ready_dispatch', 'refinish'].includes(taka.stage)) throw conflict(`Taka ${taka.takaNo} is not in stock (it can't be marked fresh).`);
    const events = await clearOpenDamages(tx, role, id, undefined, 'inventory', now());
    if (!events.length) throw conflict(`Taka ${taka.takaNo} has no open damage.`);
    await refreshIsDamaged(tx, [id]);
    await writeTakaEvents(tx, role, events);
    return { takaId: id, resolved: events.length };
  });
}
