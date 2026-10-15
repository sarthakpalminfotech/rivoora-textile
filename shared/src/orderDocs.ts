import type { OrderChallan, OrderDeliveryChallan } from './types';

/** An entry on the order's Docs → Challans list: a butta / mill challan or a delivery (dispatch) challan. */
export type OrderChallanEntry = OrderChallan | OrderDeliveryChallan;

export const isDeliveryChallan = (c: OrderChallanEntry): c is OrderDeliveryChallan => c.kind === 'delivery';

/**
 * Butta, mill and delivery challans in ONE list, newest first (by `createdAt`, then id). Each source list is
 * expected with its `createdAt`; the ISO strings compare as text.
 */
export function mergeOrderChallans(
  challans: readonly (OrderChallan & { createdAt: string })[],
  deliveries: readonly (OrderDeliveryChallan & { createdAt: string })[],
): OrderChallanEntry[] {
  const all: ((OrderChallan | OrderDeliveryChallan) & { createdAt: string })[] = [...challans, ...deliveries];
  return all
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .map(({ createdAt: _createdAt, ...rest }) => rest as OrderChallanEntry);
}
