export const UNITS = ['meters', 'kg', 'pcs', 'g'] as const;
export type Unit = (typeof UNITS)[number];
/** New orders default to pcs (most orders are woven in pieces). */
export const DEFAULT_UNIT: Unit = 'pcs';
