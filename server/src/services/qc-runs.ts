import { and, desc, eq } from 'drizzle-orm';
import type { RoleKey, TakaStage } from '@rivoora/shared';
import type { DbOrTx, Tx } from '../db/client';
import { qcRuns, takaDamages } from '../db/schema';
import { currentUserId } from '../lib/request-context';

/**
 * Sprint 21 (C6) — the exact record of one QC submit. `before` = every damage of the taka as it was just before the QC
 * (an Undo puts these values back); `addedIds` = the damages the QC created (an Undo soft-deletes them).
 */
export interface QcSnapshotRow {
  id: number;
  status: 'open' | 'resolved';
  pcs: number | null;
  resolvedPcs: number;
  meters: number | null;
  resolvedMeters: number;
  resolvedAt: string | null;
  resolvedBy: RoleKey | null;
  resolvedStage: string | null;
  isDamaged?: never;
}
export interface QcRunChanges {
  before: QcSnapshotRow[];
  addedIds: number[];
  stageBefore: TakaStage;
  refinishCountBefore: number;
}

export async function snapshotDamages(tx: Tx, takaId: number): Promise<QcSnapshotRow[]> {
  const rows = await tx
    .select({
      id: takaDamages.id,
      status: takaDamages.status,
      pcs: takaDamages.pcs,
      resolvedPcs: takaDamages.resolvedPcs,
      meters: takaDamages.meters,
      resolvedMeters: takaDamages.resolvedMeters,
      resolvedAt: takaDamages.resolvedAt,
      resolvedBy: takaDamages.resolvedBy,
      resolvedStage: takaDamages.resolvedStage,
    })
    .from(takaDamages)
    .where(and(eq(takaDamages.takaId, takaId), eq(takaDamages.isDeleted, false)));
  return rows;
}

/** Writes the run: compares the damages now with the snapshot taken before the QC. */
export async function recordQcRun(
  tx: Tx,
  role: RoleKey,
  args: { takaId: number; kind: 'butta' | 'mill'; result: TakaStage; before: QcSnapshotRow[]; stageBefore: TakaStage; refinishCountBefore: number },
): Promise<void> {
  const now = await snapshotDamages(tx, args.takaId);
  const had = new Set(args.before.map((r) => r.id));
  const changes: QcRunChanges = {
    before: args.before,
    addedIds: now.filter((r) => !had.has(r.id)).map((r) => r.id),
    stageBefore: args.stageBefore,
    refinishCountBefore: args.refinishCountBefore,
  };
  const at = new Date().toISOString();
  await tx.insert(qcRuns).values({
    takaId: args.takaId,
    kind: args.kind,
    result: args.result,
    changes: JSON.stringify(changes),
    doneByRole: role,
    doneByUserId: currentUserId(),
    createdAt: at,
    updatedAt: at,
  });
}

export async function latestQcRun(tx: DbOrTx, takaId: number) {
  const [row] = await tx
    .select()
    .from(qcRuns)
    .where(eq(qcRuns.takaId, takaId))
    .orderBy(desc(qcRuns.id))
    .limit(1);
  return row ?? null;
}
