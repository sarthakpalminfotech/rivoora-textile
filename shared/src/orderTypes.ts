/**
 * Order type (required on new orders, editable later). Not linked to the unit: jobsheets work for every pcs order
 * whatever its type. Existing orders were backfilled as `pcs_to_pcs`.
 */
export const ORDER_TYPES = ['lump', 'pcs_to_pcs'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  lump: 'Lump',
  pcs_to_pcs: 'Pcs to pcs',
};

export function isOrderType(value: unknown): value is OrderType {
  return typeof value === 'string' && (ORDER_TYPES as readonly string[]).includes(value);
}
