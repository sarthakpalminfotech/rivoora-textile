import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { TakaLookupCandidate } from '@rivoora/shared';
import type { DbOrTx } from '../db/client';
import { orders, takas, weavers } from '../db/schema';
import { takaOrderId } from './free-stock';

/**
 * Sprint 16 — THE taka lookup by a typed number. The physical taka of an outside weaver may carry only the weaver's own
 * number, so a typed number matches our system number OR the weaver number. Used by Butta / Mill receive, the QC open
 * screens, `/takas/by-no`, the split / GR screens and `GET /takas/lookup` (the "Which one?" picker).
 * Existing data has no weaver numbers, so it always finds exactly what it found before.
 */
export async function lookupTakas(tx: DbOrTx, no: string): Promise<TakaLookupCandidate[]> {
  const v = no.trim();
  if (!v) return [];
  const rows = await tx
    .select({
      id: takas.id,
      takaNo: takas.takaNo,
      weaverTakaNo: takas.weaverTakaNo,
      weaverName: weavers.name,
      supplierName: sql<string | null>`(SELECT r.supplier_name FROM outside_receipts r WHERE r.id = "takas"."outside_receipt_id")`,
      orderNo: orders.orderNo,
      stage: takas.stage,
    })
    .from(takas)
    .innerJoin(orders, eq(orders.id, takaOrderId))
    .leftJoin(weavers, eq(weavers.id, takas.weaverId))
    .where(and(eq(takas.isDeleted, false), or(eq(takas.takaNo, v), eq(takas.weaverTakaNo, v))))
    .orderBy(asc(takas.id))
    .limit(20);
  return rows
    .map(({ supplierName, weaverName, ...r }) => ({ ...r, weaverName: weaverName ?? supplierName, exact: r.takaNo === v }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.orderNo - b.orderNo);
}

export type TakaResolution = { kind: 'one'; id: number; takaNo: string } | { kind: 'none' } | { kind: 'many'; candidates: TakaLookupCandidate[] };

/** One taka for a typed number: exactly one match → it; none; or several → the picker's candidates. */
export async function resolveTakaNumber(tx: DbOrTx, no: string): Promise<TakaResolution> {
  const list = await lookupTakas(tx, no);
  if (list.length === 0) return { kind: 'none' };
  if (list.length === 1) return { kind: 'one', id: list[0].id, takaNo: list[0].takaNo };
  return { kind: 'many', candidates: list };
}
