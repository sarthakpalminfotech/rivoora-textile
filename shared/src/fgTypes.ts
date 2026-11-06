/** Sprint 21 (CR-01): the finished-goods type of an order. Only these two; no master screen. */
export const FG_TYPES = ['saree', 'suit'] as const;
export type FgType = (typeof FG_TYPES)[number];
export const DEFAULT_FG_TYPE: FgType = 'saree';

export const FG_TYPE_LABEL: Record<FgType, string> = {
  saree: 'Saree',
  suit: 'Suit',
};

export function isFgType(value: unknown): value is FgType {
  return typeof value === 'string' && (FG_TYPES as readonly string[]).includes(value);
}
