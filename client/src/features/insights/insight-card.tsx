import { ArrowDown, ArrowRight, ArrowUp, Eye, EyeOff, GripVertical, Maximize2, Minimize2, MoreHorizontal, RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { forwardRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  formatValue,
  isCardError,
  PERIOD_KEYS,
  PERIOD_SHORT,
  splitValue,
  type BarsBody,
  type CardBody,
  type CardDef,
  type CardError,
  type CardPayload,
  type Change,
  type DashboardKey,
  type Drawer,
  type FigureBody,
  type PeriodKey,
  type RankedBody,
  type SplitItem,
  type TableBody,
  type Tone,
} from '@rivoora/shared';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCardWithPeriod } from './api';
import { BarRows, ColumnChart, Donut, InlineBar, Sparkline } from './charts';
import type { DashboardMode } from './layout-mode';

/**
 * Sprint 25 — ONE card component for every insight card (§2A "card anatomy"): header (title · period chip · status badge ·
 * ⋯ menu), the muted answer line, the body by variant (figure · split · bars · donut · ranked · table), an optional
 * "Open list →" footer; skeleton / friendly empty / inline-retry states; and the Arrange controls.
 */

export const TONE_BADGE: Record<Tone, string> = {
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
};
const TONE_TEXT: Record<Tone, string> = { red: 'text-rose-700', amber: 'text-amber-700', green: 'text-emerald-700', neutral: 'text-slate-700' };

export interface CardActions {
  /** A figure was tapped: its short list (drawer / bottom sheet) or its link. */
  openDrawer: (d: Drawer) => void;
  go: (href: string) => void;
  /** Change period → focus the global period selector (the card can also take its own period). */
  focusPeriod: () => void;
}

export interface ArrangeProps {
  hidden: boolean;
  wide: boolean;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggleHidden: () => void;
  onToggleWide: () => void;
  draggable: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

/* ------------------------------------------------------------------ */
/* small parts                                                          */
/* ------------------------------------------------------------------ */

function ChangeLine({ c }: { c: Change }) {
  if (c.pct === null || !Number.isFinite(c.pct)) return null;
  const up = c.pct > 0;
  const flat = Math.abs(c.pct) < 0.5;
  const good = flat ? null : up === c.upIsGood;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', good === null ? 'text-slate-500' : good ? 'text-emerald-700' : 'text-rose-700')}>
      {!flat && <Icon className="size-3.5" aria-hidden />}
      {flat ? 'Same' : `${up ? '▲' : '▼'} ${Math.abs(c.pct).toFixed(0)} %`} <span className="font-medium text-slate-500">{c.label}</span>
    </span>
  );
}

/** The big number with its unit beside it (tabular). */
function BigNumber({ value, unit, size = 'lg', tone }: { value: number | null; unit: SplitItem['unit']; size?: 'lg' | 'md' | 'sm'; tone?: Tone }) {
  const { num, unit: u } = splitValue(value, unit);
  const rupee = unit === 'rs';
  return (
    <span className={cn('inline-flex items-baseline gap-1 whitespace-nowrap font-semibold tabular-nums tracking-tight', tone && tone !== 'neutral' ? TONE_TEXT[tone] : 'text-slate-900')}>
      {rupee && <span className={cn('font-medium text-slate-500', size === 'lg' ? 'text-lg' : 'text-sm')}>₹</span>}
      <span className={cn(size === 'lg' ? 'text-[26px] leading-none md:text-[27px] lg:text-[30px]' : size === 'md' ? 'text-[22px] leading-none lg:text-[24px]' : 'text-lg leading-none')}>{num}</span>
      {!rupee && u && <span className={cn('font-medium text-slate-500', size === 'lg' ? 'text-sm' : 'text-xs')}>{u}</span>}
    </span>
  );
}

/** A tappable region (figure → drawer / link). */
function Tap({ onTap, label, children, className }: { onTap: (() => void) | null; label: string; children: ReactNode; className?: string }) {
  if (!onTap) return <div className={className}>{children}</div>;
  return (
    <button type="button" onClick={onTap} aria-label={label} className={cn('-m-1.5 block rounded-lg p-1.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30', className)}>
      {children}
    </button>
  );
}

const tapOf = (actions: CardActions, drawer?: Drawer | null, href?: string | null) => (drawer ? () => actions.openDrawer(drawer) : href ? () => actions.go(href) : null);

/* ------------------------------------------------------------------ */
/* bodies                                                               */
/* ------------------------------------------------------------------ */

function FigureView({ b, href, actions, title }: { b: FigureBody; href: string | null | undefined; actions: CardActions; title: string }) {
  return (
    <Tap onTap={tapOf(actions, b.drawer, href)} label={`${title}: ${formatValue(b.value, b.unit)} — open the list`}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <BigNumber value={b.value} unit={b.unit} />
          {b.caption && <span className="ml-1.5 text-sm font-medium text-slate-500">{b.caption}</span>}
        </div>
        {b.spark && <Sparkline values={b.spark} label="Last 6 months" />}
      </div>
      {b.sub && <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{b.sub}</p>}
      {b.change && (
        <p className="mt-1.5">
          <ChangeLine c={b.change} />
        </p>
      )}
    </Tap>
  );
}

export function SplitView({ items, actions, dense }: { items: SplitItem[]; actions: CardActions; dense?: boolean }) {
  return (
    <div className={cn('grid gap-x-4 gap-y-4', items.length >= 4 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2', items.length === 5 && !dense && 'xl:grid-cols-3', items.length === 3 && 'sm:grid-cols-3', items.length === 4 && 'xl:grid-cols-4')}>
      {items.map((it) => (
        <Tap key={it.label} onTap={tapOf(actions, it.drawer, it.href)} label={`${it.label}: ${formatValue(it.value, it.unit)}`} className="min-w-0">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-slate-500">{it.label}</p>
          <p className="mt-1">
            <BigNumber value={it.value} unit={it.unit} size="md" tone={it.tone} />
          </p>
          {it.sub && <p className="mt-1 line-clamp-2 text-[11.5px] text-slate-500">{it.sub}</p>}
        </Tap>
      ))}
    </div>
  );
}

function BarsView({ b, mode, actions }: { b: BarsBody; mode: DashboardMode; actions: CardActions }) {
  const touch = mode !== 'desktop';
  return (
    <div className="flex flex-1 flex-col">
      {b.horizontal ? (
        <BarRows points={b.points} unit={b.unit} series={b.series} large={touch} />
      ) : (
        <ColumnChart fill points={b.points} unit={b.unit} series={b.series} maxVisible={touch ? 6 : undefined} large={touch} onPick={(p) => p.href && actions.go(p.href)} />
      )}
      {(b.change || b.summary) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {b.change && <ChangeLine c={b.change} />}
          {b.summary && <span>{b.summary}</span>}
        </p>
      )}
    </div>
  );
}

const RANKED_SHOWN = 8;

function RankedView({ b, actions }: { b: RankedBody; actions: CardActions }) {
  const max = Math.max(0, ...b.rows.map((r) => r.value));
  const [all, setAll] = useState(false);
  const rows = all ? b.rows : b.rows.slice(0, RANKED_SHOWN);
  return (
    <div>
      {b.head && b.head.length > 0 && (
        <div className="mb-3 border-b border-slate-100 pb-3">
          <SplitView items={b.head} actions={actions} dense />
        </div>
      )}
      {b.rows.length === 0 ? (
        <EmptyLine text="Nothing to show for this view" />
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.label}-${i}`}>
              <Tap onTap={r.href ? () => actions.go(r.href!) : null} label={`${r.label}: ${r.valueText ?? formatValue(r.value, r.unit)}`} className="w-full [@media(pointer:coarse)]:min-h-12">
                <span className="flex items-baseline gap-2">
                  <span title={r.label} className={cn('min-w-0 flex-1 truncate text-[13px] font-medium', r.tone && r.tone !== 'neutral' ? TONE_TEXT[r.tone] : 'text-slate-800')}>{r.label}</span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-900">{r.valueText ?? formatValue(r.value, r.unit)}</span>
                </span>
                {r.sub && <span className="block truncate text-[11.5px] text-slate-500">{r.sub}</span>}
                <InlineBar value={r.value} max={max} tone={r.tone} />
              </Tap>
            </li>
          ))}
        </ol>
      )}
      {b.rows.length > RANKED_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2.5 inline-flex min-h-8 items-center text-xs font-semibold text-primary hover:underline [@media(pointer:coarse)]:min-h-12">
          {all ? 'Show fewer' : `Show all ${b.rows.length}`}
        </button>
      )}
      <MoreLink more={b.more} href={b.moreHref ?? null} actions={actions} />
    </div>
  );
}

function TableView({ b, actions }: { b: TableBody; actions: CardActions }) {
  return (
    <div>
      {b.head && b.head.length > 0 && (
        <div className="mb-3 border-b border-slate-100 pb-3">
          <SplitView items={b.head} actions={actions} dense />
        </div>
      )}
      {b.rows.length === 0 ? (
        <EmptyLine text="Nothing to show for this view" />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {b.columns.map((c) => (
                  <th key={c.key} className={cn('px-1 pb-1.5 font-semibold', c.align === 'right' && 'text-right')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr
                  key={i}
                  className={cn('border-t border-slate-100', r.href && 'cursor-pointer hover:bg-slate-50')}
                  onClick={r.href ? () => actions.go(r.href!) : undefined}
                  tabIndex={r.href ? 0 : undefined}
                  onKeyDown={r.href ? (e) => e.key === 'Enter' && actions.go(r.href!) : undefined}
                >
                  {b.columns.map((c, k) => (
                    <td key={c.key} className={cn('px-1 py-2 align-top', c.align === 'right' ? 'whitespace-nowrap text-right tabular-nums text-slate-700' : 'text-slate-700', k === 0 && 'font-medium text-slate-900')}>
                      {k === 0 && r.tone && r.tone !== 'neutral' && <span className={cn('mr-1.5 inline-block size-1.5 rounded-full align-middle', r.tone === 'red' ? 'bg-rose-500' : r.tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')} aria-hidden />}
                      {r.cells[c.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreLink more={b.more} href={b.moreHref ?? null} actions={actions} />
    </div>
  );
}

function MoreLink({ more, href, actions }: { more: number; href: string | null; actions: CardActions }) {
  if (!more) return null;
  const text = `+ ${more} more`;
  return href ? (
    <button type="button" onClick={() => actions.go(href)} className="mt-2.5 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-primary hover:underline [@media(pointer:coarse)]:min-h-12">
      {text} <ArrowRight className="size-3.5" aria-hidden />
    </button>
  ) : (
    <p className="mt-2.5 text-xs text-slate-500">{text}</p>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-3 text-sm text-slate-500">
      <Sparkles className="size-4 shrink-0 text-slate-300" aria-hidden />
      {text}
    </p>
  );
}

export function CardBodyView({ body, payload, mode, actions, title }: { body: CardBody; payload: CardPayload; mode: DashboardMode; actions: CardActions; title: string }) {
  switch (body.kind) {
    case 'figure':
      return <FigureView b={body} href={payload.href} actions={actions} title={title} />;
    case 'split':
      return <SplitView items={body.items} actions={actions} />;
    case 'bars':
      return <BarsView b={body} mode={mode} actions={actions} />;
    case 'donut':
      return <Donut parts={body.parts} total={body.total} unit={body.unit} size={mode === 'desktop' ? 132 : 140} />;
    case 'ranked':
      return <RankedView b={body} actions={actions} />;
    case 'table':
      return <TableView b={body} actions={actions} />;
  }
}

/* ------------------------------------------------------------------ */
/* the card                                                             */
/* ------------------------------------------------------------------ */

function SkeletonBody({ wide }: { wide: boolean }) {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-8 w-28" />
      <Skeleton className={cn('h-20', wide ? 'w-full' : 'w-11/12')} />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

export const InsightCard = forwardRef<
  HTMLElement,
  {
    dashboard: DashboardKey;
    def: CardDef;
    payload: CardPayload | CardError | undefined;
    loading: boolean;
    mode: DashboardMode;
    actions: CardActions;
    onRetry: () => void;
    arrange?: ArrangeProps | null;
    /** Pinned Needs attention panel styling. */
    panel?: boolean;
    className?: string;
    style?: CSSProperties;
  }
>(function InsightCard({ dashboard, def, payload: batchPayload, loading, mode, actions, onRetry, arrange, panel, className, style }, ref) {
  const [ownPeriod, setOwnPeriod] = useState<PeriodKey | null>(null);
  const own = useCardWithPeriod(dashboard, def.id, ownPeriod);
  const payload = ownPeriod ? (own.data?.cards[def.id] ?? batchPayload) : batchPayload;
  const ok = payload && !isCardError(payload) ? payload : null;
  const [view, setView] = useState<string | null>(null);
  const viewKey = ok?.switch ? (view && ok.switch.options.some((o) => o.value === view) ? view : ok.switch.value) : null;
  const body = ok ? (viewKey && ok.views ? ok.views[viewKey] : ok.body) : null;
  const touch = mode !== 'desktop';
  const tone = ok?.badge?.tone;
  const periodText = ownPeriod ? PERIOD_SHORT[ownPeriod] : ok?.periodLabel;

  return (
    <article
      ref={ref}
      id={panel ? 'attention' : undefined}
      aria-label={def.title}
      style={style}
      tabIndex={arrange ? 0 : undefined}
      onKeyDown={arrange?.onKeyDown}
      draggable={arrange?.draggable}
      onDragStart={arrange?.onDragStart}
      onDragEnd={arrange?.onDragEnd}
      onDragOver={arrange?.onDragOver}
      onDrop={arrange?.onDrop}
      className={cn(
        'group/card flex h-full min-w-0 flex-col rounded-xl border bg-white p-4 transition-[box-shadow,opacity,border-color] duration-200 lg:p-5',
        panel ? (tone === 'red' ? 'border-rose-200 bg-rose-50/40' : tone === 'amber' ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/30') : 'border-border',
        !touch && !arrange && 'hover:shadow-soft',
        arrange && 'outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        arrange?.hidden && 'border-dashed opacity-55',
        arrange?.dragging && 'opacity-40',
        arrange?.dropTarget && 'ring-2 ring-primary/50',
        className,
      )}
    >
      {/* 1 · header */}
      <header className="flex items-start gap-2">
        {arrange?.draggable && (
          <span className="-ml-1 mt-0.5 hidden cursor-grab text-slate-300 group-hover/card:text-slate-500 lg:inline" aria-hidden>
            <GripVertical className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-semibold leading-snug text-slate-800">
            <span className="min-w-0">{def.title}</span>
            {periodText && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{periodText}</span>}
          </h3>
        </div>
        {ok?.badge && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', TONE_BADGE[ok.badge.tone])}>{ok.badge.text}</span>}
        {!arrange && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn('-mr-1.5 -mt-1 flex shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700', touch ? 'size-11' : 'size-8')} aria-label={`${def.title} — more`}>
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ok?.href && <DropdownMenuItem onSelect={() => actions.go(ok.href!)}>Open list</DropdownMenuItem>}
              {def.periodic ? (
                <>
                  <DropdownMenuLabel>Period of this card</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={ownPeriod ?? 'page'} onValueChange={(v) => setOwnPeriod(v === 'page' ? null : (v as PeriodKey))}>
                    <DropdownMenuRadioItem value="page">Same as the page</DropdownMenuRadioItem>
                    {PERIOD_KEYS.map((k) => (
                      <DropdownMenuRadioItem key={k} value={k}>
                        {PERIOD_SHORT[k]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              ) : (
                <DropdownMenuItem onSelect={actions.focusPeriod} disabled>
                  Fixed period — {ok?.periodLabel ?? 'own window'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRetry}>
                <RefreshCw className="size-4" /> Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      {/* 2 · answer line */}
      <p className="mt-0.5 text-xs leading-snug text-slate-500">{def.answer}</p>
      {/* 3 · switch (Pcs | m, Butta | Mill | Weavers …) + body + footer + Arrange controls — one part, it fills the card */}
      <div className="flex min-w-0 flex-1 flex-col">
      {ok?.switch && !arrange && (
        <div className="mt-3">
          <Segmented
            fit
            size={touch ? 'lg' : 'md'}
            value={viewKey}
            onChange={setView}
            options={ok.switch.options}
            aria-label={`${def.title} — show`}
            className={cn('w-full', !touch && 'sm:w-auto')}
          />
        </div>
      )}
      <div className="mt-4 flex min-w-0 flex-1 flex-col">
        {arrange ? (
          <p className="text-xs text-slate-400">{arrange.hidden ? 'Hidden on the dashboard' : 'Shown'} · {arrange.wide ? 'wide' : 'normal'}</p>
        ) : loading && !payload ? (
          <SkeletonBody wide={def.width !== 'normal' && def.width !== 'small'} />
        ) : !payload || isCardError(payload) ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            Couldn’t load this card.
            <button type="button" onClick={onRetry} className="font-semibold text-primary hover:underline">
              Retry
            </button>
          </p>
        ) : ok?.hidden ? (
          <EmptyLine text={ok.hidden} />
        ) : !body || ok?.empty ? (
          <EmptyLine text={ok?.empty ?? 'Nothing to show yet'} />
        ) : (
          <CardBodyView body={body} payload={ok!} mode={mode} actions={actions} title={def.title} />
        )}
      </div>
      {/* 4 · footer */}
      {!arrange && ok?.href && body && body.kind !== 'figure' && (
        <footer className="mt-4 border-t border-slate-100 pt-3">
          <button type="button" onClick={() => actions.go(ok.href!)} className={cn('inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline', touch && 'min-h-11')}>
            Open list <ArrowRight className="size-3.5" aria-hidden />
          </button>
        </footer>
      )}
      {/* Arrange controls: ↑ ↓ always (drag is never the only way), hide / show, wide / normal. */}
      {arrange && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <ArrangeButton label="Move up" onClick={arrange.onUp} disabled={!arrange.canUp} touch={touch}>
            <ArrowUp className="size-4" />
          </ArrangeButton>
          <ArrangeButton label="Move down" onClick={arrange.onDown} disabled={!arrange.canDown} touch={touch}>
            <ArrowDown className="size-4" />
          </ArrangeButton>
          <ArrangeButton label={arrange.hidden ? 'Show card' : 'Hide card'} onClick={arrange.onToggleHidden} touch={touch} wideLabel>
            {arrange.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            <span>{arrange.hidden ? 'Show' : 'Hide'}</span>
          </ArrangeButton>
          {mode !== 'phone' && (
            <ArrangeButton label={arrange.wide ? 'Make normal' : 'Make wide'} onClick={arrange.onToggleWide} touch={touch} wideLabel>
              {arrange.wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              <span>{arrange.wide ? 'Normal' : 'Wide'}</span>
            </ArrangeButton>
          )}
          {touch && arrange.draggable && (
            <span className="ml-auto flex size-12 cursor-grab items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden>
              <GripVertical className="size-5" />
            </span>
          )}
        </div>
      )}
      </div>
    </article>
  );
});

function ArrangeButton({ label, onClick, disabled, children, touch, wideLabel }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; touch: boolean; wideLabel?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border border-input bg-white text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-35',
        touch ? 'h-12 min-w-12' : 'h-9 min-w-9',
        wideLabel && 'px-3',
      )}
    >
      {children}
    </button>
  );
}

/** A small figure card of the Today strip. */
export function StripCard({ label, payload, loading, actions, mode }: { label: string; payload: CardPayload | CardError | undefined; loading: boolean; actions: CardActions; mode: DashboardMode }) {
  const ok = payload && !isCardError(payload) ? payload : null;
  const b = ok?.body && ok.body.kind === 'figure' ? ok.body : null;
  const onTap = ok ? tapOf(actions, b?.drawer, ok.href) : null;
  const inner = (
    <>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-500">{label}</span>
        {ok?.badge && <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold ring-1 ring-inset', TONE_BADGE[ok.badge.tone])}>{ok.badge.text}</span>}
      </span>
      <span className="mt-1.5 block">
        {loading && !payload ? (
          <Skeleton className="h-7 w-16" />
        ) : b ? (
          <>
            <BigNumber value={b.value} unit={b.unit} size="md" />
            {b.caption && <span className="ml-1 text-xs font-medium text-slate-500">{b.caption}</span>}
          </>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        )}
      </span>
      <span className="mt-1 block truncate text-[11.5px] text-slate-500">{b?.sub ?? ok?.periodLabel ?? ' '}</span>
    </>
  );
  const base = cn('flex h-full min-w-0 flex-col rounded-xl border border-border bg-white px-4 py-3.5 text-left', mode === 'phone' ? 'min-h-[88px]' : 'min-h-[96px]');
  return onTap ? (
    <button type="button" onClick={onTap} className={cn(base, 'transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30')} aria-label={`${label}: ${b ? formatValue(b.value, b.unit) : '—'}`}>
      {inner}
    </button>
  ) : (
    <div className={base}>{inner}</div>
  );
}
