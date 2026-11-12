/**
 * Sprint 25 (C11 / C12) — insight dashboards: what a card sends to the screen. Every card is computed on request from the
 * live rows (no stored aggregates) by a pure function in `shared/src/insights/*`; the server only loads the rows.
 */

export const DASHBOARD_KEYS = ['owner', 'partner', 'supervisor'] as const;
export type DashboardKey = (typeof DASHBOARD_KEYS)[number];
export const isDashboardKey = (v: unknown): v is DashboardKey => typeof v === 'string' && (DASHBOARD_KEYS as readonly string[]).includes(v);

export const DASHBOARD_LABEL: Record<DashboardKey, string> = {
  owner: 'Owner',
  partner: 'Production partner',
  supervisor: 'Supervisor',
};

/** Status colours carry meaning only: red = needs action, amber = watch, green = fine. */
export type Tone = 'red' | 'amber' | 'green' | 'neutral';

export interface Badge {
  tone: Tone;
  text: string;
}

/** A quantity's unit as shown ("pcs", "m", "₹", "%", "days", "kg", "takas", "orders", "hours"). */
export type CardUnit = 'pcs' | 'm' | 'rs' | 'pct' | 'days' | 'kg' | 'takas' | 'orders' | 'hours' | 'count' | 'frames' | 'jobsheets' | 'sections' | 'beams';

/** One row of a drawer / ranked list / table link. */
export interface DrawerRow {
  label: string;
  sub?: string | null;
  value?: string | null;
  href?: string | null;
  tone?: Tone;
}

/** The short list a figure opens (top 20), with the full list behind "Open full list →". */
export interface Drawer {
  title: string;
  rows: DrawerRow[];
  /** Rows beyond the 20 shown. */
  more: number;
  href: string | null;
}

export interface Change {
  /** Percent vs the previous period (null = no previous value). */
  pct: number | null;
  /** "vs last month" */
  label: string;
  /** For a figure where going up is bad (damage %), the colour flips. */
  upIsGood: boolean;
}

export interface FigureBody {
  kind: 'figure';
  value: number | null;
  unit: CardUnit;
  /** "· last 30 days" etc. */
  caption?: string | null;
  change?: Change | null;
  spark?: number[] | null;
  /** A second muted line ("of 1,240 pcs entered"). */
  sub?: string | null;
  drawer?: Drawer | null;
}

export interface SplitItem {
  label: string;
  value: number | null;
  unit: CardUnit;
  sub?: string | null;
  tone?: Tone;
  href?: string | null;
  drawer?: Drawer | null;
}
export interface SplitBody {
  kind: 'split';
  items: SplitItem[];
}

export interface BarPoint {
  label: string;
  /** Full label for the tooltip ("Nov 2026"). */
  hint?: string;
  values: number[];
  /** Extra tooltip text ("12 orders"). */
  note?: string | null;
  href?: string | null;
}
export interface BarsBody {
  kind: 'bars';
  unit: CardUnit;
  /** 1 or 2 series names ("Received", "Used"). */
  series: string[];
  points: BarPoint[];
  /** Horizontal bars (stages, buckets) instead of columns. */
  horizontal?: boolean;
  /** A short line under the chart ("This month ▲ 12 % vs last month"). */
  summary?: string | null;
  change?: Change | null;
}

export interface DonutPart {
  label: string;
  value: number;
  href?: string | null;
}
export interface DonutBody {
  kind: 'donut';
  unit: CardUnit;
  parts: DonutPart[];
  total: number;
}

export interface RankedRow {
  label: string;
  sub?: string | null;
  value: number;
  unit: CardUnit;
  /** Optional text instead of the formatted value ("12 % · 3 of 25"). */
  valueText?: string | null;
  tone?: Tone;
  href?: string | null;
}
export interface RankedBody {
  kind: 'ranked';
  /** Optional totals above the rows ("All parties · 120 takas"). */
  head?: SplitItem[];
  rows: RankedRow[];
  more: number;
  moreHref?: string | null;
}

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}
export interface TableRow {
  cells: Record<string, string | number | null>;
  href?: string | null;
  tone?: Tone;
}
export interface TableBody {
  kind: 'table';
  /** Optional totals above the table. */
  head?: SplitItem[];
  columns: TableColumn[];
  rows: TableRow[];
  more: number;
  moreHref?: string | null;
}

export type CardBody = FigureBody | SplitBody | BarsBody | DonutBody | RankedBody | TableBody;

/** A card with a switch (Pcs | m, Butta | Mill | Weavers …): every view is sent at once, the screen switches locally. */
export interface CardSwitch {
  options: { value: string; label: string }[];
  value: string;
}

export interface CardPayload {
  id: string;
  /** The period the card used ("Last 30 days"), or null when it has its own fixed window. */
  periodLabel: string | null;
  badge?: Badge | null;
  /** The body, or one body per switch option. */
  body: CardBody | null;
  views?: Record<string, CardBody>;
  switch?: CardSwitch | null;
  /** Friendly line when there is nothing to show ("No damage this week"). */
  empty?: string | null;
  /** "Open list →" */
  href?: string | null;
  /** Money hidden for this role (no `canSeeRate`). */
  hidden?: string | null;
}

export interface CardError {
  id: string;
  error: string;
}

export interface DashboardCardsResult {
  dashboard: DashboardKey;
  generatedAt: string;
  period: { key: string; label: string; from: string; to: string };
  cards: Record<string, CardPayload | CardError>;
}

export const isCardError = (c: CardPayload | CardError | undefined): c is CardError => !!c && 'error' in c;

/* ---------- C11 layout ---------- */

export type CardWidth = 'small' | 'normal' | 'wide' | 'full';

export interface LayoutCard {
  id: string;
  width: CardWidth;
  hidden: boolean;
}

export interface LayoutSection {
  key: string;
  title: string;
  cards: LayoutCard[];
}

export interface DashboardLayout {
  sections: LayoutSection[];
}

export interface DashboardLayoutResult {
  dashboard: DashboardKey;
  layout: DashboardLayout;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Hidden-flag cards switched on for this install (e.g. `insight_stock_match`). */
  flags?: string[];
}

export interface DashboardSettings {
  workingHoursPerDay: number;
}
