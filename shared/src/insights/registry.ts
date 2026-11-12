import type { RoleKey } from '../roles';
import type { CardWidth, DashboardKey, DashboardLayout, LayoutSection } from './types';

/**
 * Sprint 25 (C11 / C12) — every card of the three dashboards, in the order of the prompt (the DEFAULT layout). Only the
 * "considered" cards exist; nothing marked "not considered" is defined. Ids carry the dashboard (`o.` owner, `p.` partner,
 * `s.` supervisor) so the same idea on two dashboards stays two cards.
 */

export interface CardDef {
  id: string;
  section: string;
  title: string;
  /** One muted sentence: the question the card answers. */
  answer: string;
  width: CardWidth;
  /** Uses the global period selector (else it has its own fixed window). */
  periodic: boolean;
  /** Shows money — empty for roles without `canSeeRate`. */
  needsRate?: boolean;
  /** Built behind a hidden flag (`app_settings`), off by default. */
  flag?: 'insight_stock_match';
  /** Rendered as the pinned Needs attention panel under the Today strip. */
  pinned?: boolean;
}

export interface SectionDef {
  key: string;
  title: string;
  line: string;
}

export interface StripDef {
  id: string;
  label: string;
}

export interface DashboardDef {
  key: DashboardKey;
  title: string;
  strip: StripDef[];
  sections: SectionDef[];
  cards: CardDef[];
}

const c = (section: string, id: string, title: string, answer: string, width: CardWidth, periodic: boolean, extra: Partial<CardDef> = {}): CardDef => ({
  id,
  section,
  title,
  answer,
  width,
  periodic,
  ...extra,
});

const OWNER: DashboardDef = {
  key: 'owner',
  title: 'Owner dashboard',
  strip: [
    { id: 'o.s.open', label: 'Open orders' },
    { id: 'o.s.production', label: 'In production' },
    { id: 'o.s.ready', label: 'Ready to dispatch' },
    { id: 'o.s.dispatched', label: 'Dispatched today' },
    { id: 'o.s.attention', label: 'Needs attention' },
  ],
  sections: [
    { key: 'pulse', title: 'Business pulse', line: 'Orders and money coming in' },
    { key: 'clients', title: 'Clients', line: 'Who the business depends on' },
    { key: 'brokers', title: 'Brokers & designs', line: 'Where the orders come from and what sells' },
    { key: 'speed', title: 'Speed', line: 'How fast orders reach the client' },
    { key: 'quality', title: 'Quality & damage', line: 'Damage found and what it costs' },
    { key: 'returns', title: 'Returns & rework', line: 'Goods coming back and work done twice' },
    { key: 'stock', title: 'Stock', line: 'Free stock lying in the godown' },
    { key: 'vendors', title: 'Vendors', line: 'Our goods at butta, mill and weavers' },
    { key: 'looms', title: 'Looms & yarn', line: 'How the looms and the yarn are used' },
    { key: 'attention', title: 'Attention & team', line: 'What needs you and what the team did today' },
  ],
  cards: [
    c('pulse', 'o.glance', 'Business at a glance', 'Open orders, production, ready, dispatched and booked this month', 'wide', false),
    c('pulse', 'o.booked_month', 'Orders booked per month', 'Quantity booked each month over the last 12 months', 'wide', false),
    c('pulse', 'o.value_month', 'Order value booked', 'Rupees booked each month, this month vs last', 'normal', false, { needsRate: true }),
    c('pulse', 'o.open_status', 'Where the open orders are right now', 'Open orders by status', 'normal', false),
    c('clients', 'o.top3', 'How much depends on the top 3', 'Share of the value booked in 6 months from the top 3 clients', 'normal', false, { needsRate: true }),
    c('clients', 'o.quiet', 'Clients gone quiet', 'Clients whose usual gap between orders has passed by more than 50 %', 'wide', false),
    c('brokers', 'o.brokers', 'Business by broker', 'Value and quantity booked through each broker', 'normal', true),
    c('brokers', 'o.repeat_designs', 'Designs that sell again', 'Designs ordered 2 or more times in 12 months', 'normal', false),
    c('brokers', 'o.quality_demand', 'Quality demand', 'Quantity booked per quality', 'normal', true),
    c('speed', 'o.to_dispatch', 'Days from order to dispatch', 'Median and 90th percentile days, orders dispatched in the period', 'normal', true),
    c('speed', 'o.stage_days', 'Where the days go', 'Average days an order spends in each step', 'wide', false),
    c('speed', 'o.oldest_open', 'Oldest open orders', 'The 10 open orders waiting the longest, with their step', 'wide', false),
    c('speed', 'o.on_time', 'On-time delivery', 'Orders dispatched on or before the promised date', 'normal', true),
    c('quality', 'o.damage_pct', 'Damage % of pcs', 'Damaged pcs out of the pcs entered', 'normal', true),
    c('quality', 'o.damage_type', 'Damage by type', 'Where the damage happened', 'normal', true),
    c('quality', 'o.damage_money', 'Damage money at stake', 'Open damaged pcs at the order rate', 'normal', false, { needsRate: true }),
    c('quality', 'o.damage_reasons', 'Top damage reasons', 'The 5 damages seen most', 'normal', true),
    c('quality', 'o.damage_designs', 'Designs with most damage', 'Top 5 designs by damage % (at least 50 pcs entered)', 'normal', true),
    c('returns', 'o.returns_month', 'Goods returned by month', 'Quantity clients sent back each month', 'wide', false),
    c('returns', 'o.returns_client', 'Returns by client', 'Returned quantity and its share of what was dispatched', 'normal', true),
    c('returns', 'o.rework', 'Work done twice', 'Takas sent back to butta / refinish each month', 'normal', false),
    c('stock', 'o.stock_glance', 'Stock at a glance', 'Free stock, fresh and damaged, and its value at the last order rate', 'wide', false),
    c('stock', 'o.dead_stock', 'Dead stock', 'Free stock untouched for 60+ days with no open order of that design', 'normal', false),
    c('stock', 'o.stock_match', 'Stock that matches an open order', 'Free stock whose design has an open order still needing quantity', 'normal', false, { flag: 'insight_stock_match' }),
    c('vendors', 'o.job_parties', 'Job-work parties', 'Per party: goods out now, days out, damage % and overdue', 'wide', false),
    c('vendors', 'o.challans_late', 'Challans out for too long', 'Butta challans past 3 days, mill challans past 8 days', 'normal', false),
    c('vendors', 'o.outside_goods', 'Our goods lying outside', 'Everything at butta and mill parties right now', 'normal', false),
    c('looms', 'o.utilisation', 'Loom utilisation', 'Running hours out of the working hours, per loom', 'normal', true),
    c('looms', 'o.frames_month', 'Frames woven per month', 'Frames completed each month', 'wide', false),
    c('looms', 'o.yarn_month', 'Yarn bought vs used', 'Kg received vs kg issued to TFO, warping and withdrawn', 'wide', false),
    c('looms', 'o.idle_looms', 'Looms idle the most', 'Top 5 looms by idle hours this month', 'normal', false),
    c('attention', 'o.attention', 'Needs your attention now', 'Overdue work, orders sent short, long holds, old damage, jobsheets not started', 'full', false, { pinned: true }),
    c('attention', 'o.team_today', 'Team activity today', 'What each person did today', 'wide', false),
    c('attention', 'o.dispatch_weeks', 'Dispatch expected next 4 weeks', 'Estimated from where the cloth is now', 'normal', false),
    c('attention', 'o.today_numbers', 'Today in numbers', 'Booked, woven, entered, checked and dispatched today', 'wide', false),
  ],
};

const PARTNER: DashboardDef = {
  key: 'partner',
  title: 'Production partner dashboard',
  strip: [
    { id: 'p.s.on_loom', label: 'On loom' },
    { id: 'p.s.waiting_js', label: 'Waiting jobsheets' },
    { id: 'p.s.qc_backlog', label: 'QC backlog' },
    { id: 'p.s.outside_open', label: 'Outside POs open' },
    { id: 'p.s.tfo_running', label: 'TFO running' },
  ],
  sections: [
    { key: 'planning', title: 'Planning', line: 'Orders to plan and jobsheets to push' },
    { key: 'floor', title: 'Floor', line: 'What happened on the looms today' },
    { key: 'reliability', title: 'Reliability', line: 'Looms and jobsheets that went wrong' },
    { key: 'after', title: 'After the loom', line: 'Cloth between the loom and the godown' },
    { key: 'outside', title: 'Outside & FG', line: 'Weavers and bought-in goods' },
    { key: 'yarn', title: 'Yarn', line: 'TFO, beams and low stock' },
  ],
  cards: [
    c('planning', 'p.queue', 'Planning queue', 'Orders at Jobsheet pending / Jobsheet created, oldest first', 'wide', false),
    c('planning', 'p.waiting_js', 'Orders waiting for jobsheets', 'Jobsheet pending orders and the days they have waited', 'normal', false),
    c('planning', 'p.coverage', 'Jobsheets don’t cover the order', 'Orders whose jobsheets (and outside POs) differ from the need by more than ±10 %', 'wide', false),
    c('planning', 'p.not_started', 'Sent but not started', 'Jobsheets sent more than 24 hours ago, not on a loom yet', 'normal', false),
    c('floor', 'p.floor_today', 'Started & completed today', 'Jobsheets started and completed today, by loom', 'wide', false),
    c('reliability', 'p.damage_per_100', 'Machine damage per 100 frames', 'Per loom, last 30 days — red above the factory average + 50 %', 'normal', false),
    c('reliability', 'p.completed_short', 'Completed short', 'Completed jobsheets whose taka-based frames / m differ from assigned by more than ±10 %', 'wide', true),
    c('after', 'p.cloth_stage', 'Cloth by stage right now', 'Quantity at each step after the loom', 'wide', false),
    c('after', 'p.qc_backlog', 'QC backlog by age', 'Takas waiting for Butta / Mill QC', 'normal', false),
    c('after', 'p.rework_open', 'Rework & refinish open', 'Takas in re-butta / refinish now, by age', 'normal', false),
    c('after', 'p.waiting_send', 'Waiting to be sent out', 'Takas waiting for butta / mill, by order', 'wide', false),
    c('outside', 'p.outside_month', 'Outside work this month', 'Outside POs given and received this month', 'normal', false),
    c('outside', 'p.outside_weaver', 'Outside POs by weaver', 'Quantity still open with each weaver', 'normal', false),
    c('outside', 'p.late_pos', 'Late POs', 'Outside POs past their due date', 'normal', false),
    c('outside', 'p.weaver_quality', 'Weaver quality', 'Damage % per weaver, last 90 days', 'normal', false),
    c('outside', 'p.fg_awaiting', 'FG purchase awaiting goods', 'FG purchases not fully received', 'normal', false),
    c('yarn', 'p.tfo', 'TFO machines', 'Sections running, on hold and idle now', 'normal', false),
    c('yarn', 'p.beams_needed', 'Beams ready vs needed', 'Beams in stock vs jobsheets pending / sent (a side-by-side count)', 'normal', false),
    c('yarn', 'p.low_yarn', 'Low yarn', 'Qualities with less available than their minimum', 'normal', false),
  ],
};

const SUPERVISOR: DashboardDef = {
  key: 'supervisor',
  title: 'Supervisor dashboard',
  strip: [
    { id: 's.s.running', label: 'Looms running' },
    { id: 's.s.idle', label: 'Looms idle' },
    { id: 's.s.started', label: 'Started today' },
    { id: 's.s.completed', label: 'Completed today' },
    { id: 's.s.damage', label: 'Damage today' },
  ],
  sections: [
    { key: 'floor', title: 'Floor today', line: 'Looms and damage right now' },
    { key: 'performance', title: 'Performance', line: 'Jobsheets that came out short' },
    { key: 'priority', title: 'Priority', line: 'What to start next and what to leave' },
    { key: 'yarn', title: 'Yarn', line: 'Beams, TFO, warping and yarn coming' },
  ],
  cards: [
    c('floor', 's.floor_today', 'Today on the floor', 'Looms running / idle, jobsheets on loom, started / completed today', 'wide', false),
    c('floor', 's.damage_today', 'Damage from my looms today', 'Machine damage pcs today, by loom', 'normal', false),
    c('performance', 's.completed_short', 'Completed short', 'My completed jobsheets that differ by more than ±10 % (taka-based)', 'wide', true),
    c('priority', 's.waiting_longest', 'Orders waiting longest', 'Sent jobsheets by waiting time', 'normal', false),
    c('priority', 's.on_hold', 'On hold — don’t start', 'Held orders that have sent jobsheets', 'normal', false),
    c('priority', 's.damage_week', 'Damage from looms this week', 'Machine damage pcs per loom, last 7 days', 'normal', false),
    c('priority', 's.lined_up', 'Lined up per loom', 'Sent jobsheets assigned to each loom', 'normal', false),
    c('yarn', 's.beams', 'Beams ready', 'Beams in stock by warping quality', 'normal', false),
    c('yarn', 's.tfo', 'TFO machines', 'Sections running, on hold and idle now', 'normal', false),
    c('yarn', 's.warping', 'Warping in process', 'Warping jobs in process and pending', 'normal', false),
    c('yarn', 's.yarn_coming', 'Yarn coming', 'Yarn PO quantity still to come, by quality', 'normal', false),
  ],
};

export const DASHBOARDS: Record<DashboardKey, DashboardDef> = { owner: OWNER, partner: PARTNER, supervisor: SUPERVISOR };

/** The permission that opens each dashboard (Jenish + Gaurang: all three; the supervisor: his own). */
export const DASHBOARD_PERMISSION = {
  owner: 'canViewOwnerDashboard',
  partner: 'canViewPartnerDashboard',
  supervisor: 'canViewSupervisorDashboard',
} as const;

/** The dashboard a role opens from the nav (Jenish → owner, Gaurang → partner, supervisor → supervisor). */
export function homeDashboard(role: RoleKey): DashboardKey | null {
  if (role === 'jemish') return 'owner';
  if (role === 'gaurang') return 'partner';
  if (role === 'supervisor') return 'supervisor';
  return null;
}

export const cardDef = (dashboard: DashboardKey, id: string): CardDef | undefined => DASHBOARDS[dashboard].cards.find((x) => x.id === id);
export const isStripId = (dashboard: DashboardKey, id: string) => DASHBOARDS[dashboard].strip.some((s) => s.id === id);

/** The layout in the prompt's order (every card shown, default widths). */
export function defaultLayout(dashboard: DashboardKey): DashboardLayout {
  const d = DASHBOARDS[dashboard];
  return {
    sections: d.sections.map((s) => ({
      key: s.key,
      title: s.title,
      cards: d.cards.filter((x) => x.section === s.key && !x.pinned).map((x) => ({ id: x.id, width: x.width, hidden: false })),
    })),
  };
}

/**
 * A saved layout joined with today's cards: unknown / pinned / duplicate cards are dropped, cards added later go to the end
 * of their default section, missing sections are added back. The order and widths saved by the client win.
 */
export function mergeLayout(dashboard: DashboardKey, saved: DashboardLayout | null | undefined): DashboardLayout {
  const base = defaultLayout(dashboard);
  if (!saved || !Array.isArray(saved.sections)) return base;
  const d = DASHBOARDS[dashboard];
  const known = new Map(d.cards.filter((x) => !x.pinned).map((x) => [x.id, x]));
  const seen = new Set<string>();
  const sections: LayoutSection[] = [];
  for (const s of saved.sections) {
    const def = d.sections.find((x) => x.key === s.key);
    if (!def || sections.some((x) => x.key === s.key)) continue;
    const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 60) : def.title;
    const cards = (Array.isArray(s.cards) ? s.cards : []).flatMap((card) => {
      const k = known.get(card?.id);
      if (!k || seen.has(card.id)) return [];
      seen.add(card.id);
      const width: CardWidth = ['small', 'normal', 'wide', 'full'].includes(card.width) ? card.width : k.width;
      return [{ id: card.id, width, hidden: !!card.hidden }];
    });
    sections.push({ key: s.key, title, cards });
  }
  for (const s of base.sections) if (!sections.some((x) => x.key === s.key)) sections.push({ ...s, cards: [] });
  for (const card of d.cards) {
    if (card.pinned || seen.has(card.id)) continue;
    sections.find((x) => x.key === card.section)!.cards.push({ id: card.id, width: card.width, hidden: false });
  }
  return { sections };
}

/** Every card id the screen asks for: the strip, the pinned panel and the visible cards of the layout. */
export function visibleCardIds(dashboard: DashboardKey, layout: DashboardLayout): string[] {
  const d = DASHBOARDS[dashboard];
  return [...d.strip.map((s) => s.id), ...d.cards.filter((x) => x.pinned).map((x) => x.id), ...layout.sections.flatMap((s) => s.cards.filter((x) => !x.hidden).map((x) => x.id))];
}
