import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatValue, type BarPoint, type CardUnit, type DonutPart } from '@rivoora/shared';
import { cn } from '@/lib/utils';

/**
 * Sprint 25 — hand-made, dependency-free charts for the insight cards: calm and minimal (one maroon hue, a faint baseline,
 * no gridlines, rounded bar tops, direct labels where they fit). Hover (desktop) / tap (touch) shows the exact value; a tap
 * outside closes it.
 */

/** The maroon series colour in shades (100 → 700): the selected / top item darkest. */
export const shade = (i: number, n: number) => {
  const alpha = n <= 1 ? 1 : 1 - (i / (n - 1)) * 0.72;
  return `hsl(var(--primary) / ${alpha.toFixed(2)})`;
};
export const SERIES = ['hsl(var(--primary))', 'hsl(var(--primary) / 0.32)'];

const compactFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
/** "1.2k", "4.8 L", "1.3 Cr" — short labels above bars. */
export function compact(v: number, unit: CardUnit): string {
  const a = Math.abs(v);
  const pre = unit === 'rs' ? '₹' : '';
  const suf = unit === 'pct' ? '%' : '';
  if (a >= 1e7) return `${pre}${compactFmt.format(v / 1e7)} Cr`;
  if (a >= 1e5) return `${pre}${compactFmt.format(v / 1e5)} L`;
  if (a >= 1e3) return `${pre}${compactFmt.format(v / 1e3)}k`;
  return `${pre}${compactFmt.format(v)}${suf}`;
}

/** Tooltip state: open index; a pointer-down outside the chart closes it (tap-to-open on touch). */
function useTipState() {
  const [active, setActive] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active === null) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [active]);
  return { active, setActive, ref };
}

function Tip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="tooltip" className={cn('pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg', className)}>
      {children}
    </div>
  );
}

/**
 * Columns (1 or 2 series). `maxVisible` (tablet: 6) keeps the last N in view and lets the rest scroll sideways (swipe).
 * Value labels: on every bar when they fit, else on the latest bar and the highest one.
 */
export function ColumnChart({
  points,
  unit,
  series,
  maxVisible,
  large,
  height = 140,
  onPick,
}: {
  points: BarPoint[];
  unit: CardUnit;
  series: string[];
  maxVisible?: number;
  /** Larger value labels (tablet). */
  large?: boolean;
  height?: number;
  onPick?: (p: BarPoint) => void;
}) {
  const { active, setActive, ref } = useTipState();
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // Swipe for the older months: start scrolled to the latest ones.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && maxVisible && points.length > 3) el.scrollLeft = el.scrollWidth;
  }, [maxVisible, points.length, width]);
  const max = Math.max(1, ...points.flatMap((p) => p.values));
  // Sprint 26: never fewer than ~52 px per column on touch (a bar stays a comfortable tap target in a narrow card)
  const visible = maxVisible && width ? Math.max(3, Math.min(maxVisible, Math.floor(width / 52))) : maxVisible;
  const scrolls = !!visible && points.length > visible;
  const colW = scrolls ? width / visible! : width / Math.max(1, points.length);
  const allLabels = colW >= (large ? 56 : 44);
  const maxIdx = points.reduce((best, p, i) => (p.values[0] > points[best].values[0] ? i : best), 0);
  const two = series.length > 1;

  return (
    <div ref={ref} className="relative">
      {two && (
        <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-600" aria-hidden>
          {series.map((s, i) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: SERIES[i] }} /> {s}
            </span>
          ))}
        </div>
      )}
      <div ref={scroller} className={cn('scrollbar-none', scrolls && 'snap-x overflow-x-auto overscroll-x-contain')}>
        <div className="flex items-end border-b border-slate-200" style={{ height, width: scrolls ? `${(points.length / visible!) * 100}%` : '100%' }} role="list">
          {points.map((p, i) => {
            const showLabel = allLabels || i === points.length - 1 || i === maxIdx;
            return (
              <div key={`${p.label}-${i}`} role="listitem" className="relative flex h-full min-w-0 flex-1 snap-end items-end justify-center">
                <button
                  type="button"
                  className="absolute inset-0 z-10 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label={`${p.hint ?? p.label}: ${p.values.map((v, k) => `${two ? `${series[k]} ` : ''}${formatValue(v, unit)}`).join(', ')}`}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
                  onPointerLeave={(e) => e.pointerType === 'mouse' && setActive((a) => (a === i ? null : a))}
                  onClick={() => (active === i && onPick && p.href ? onPick(p) : setActive(active === i ? null : i))}
                  onDoubleClick={() => onPick && p.href && onPick(p)}
                />
                {/* the bars take 64 % of their own column (a % padding would be a share of the whole chart) */}
                <div className="flex h-full w-[64%] max-w-[72px] items-end justify-center gap-[3px]">
                {p.values.map((v, k) => (
                  <div
                    key={k}
                    className="relative min-w-0 max-w-[34px] flex-1 rounded-t-[5px] transition-[height] duration-200"
                    style={{ height: `${Math.max(v > 0 ? 2 : 0, (v / max) * (height - 22))}px`, backgroundColor: two ? SERIES[k] : i === points.length - 1 ? SERIES[0] : 'hsl(var(--primary) / 0.55)' }}
                  >
                    {showLabel && !two && v > 0 && (
                      <span className={cn('absolute -top-[18px] left-1/2 -translate-x-1/2 whitespace-nowrap font-semibold tabular-nums text-slate-700', large ? 'text-xs' : 'text-[10.5px]')}>{compact(v, unit)}</span>
                    )}
                  </div>
                ))}
                </div>
                {active === i && (
                  // Inside a sideways scroller the tip stays inside the chart (it would be clipped above it).
                  <Tip className={cn(scrolls ? 'top-0' : 'bottom-full mb-1', i > points.length / 2 ? 'right-0' : 'left-0')}>
                    <span className="block text-white/70">{p.hint ?? p.label}</span>
                    {p.values.map((v, k) => (
                      <span key={k} className="block tabular-nums">
                        {two ? `${series[k]}: ` : ''}
                        {formatValue(v, unit)}
                      </span>
                    ))}
                    {p.note && <span className="block text-white/70">{p.note}</span>}
                    {p.href && onPick && <span className="block text-white/60">Tap again to open</span>}
                  </Tip>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex" style={{ width: scrolls ? `${(points.length / visible!) * 100}%` : '100%' }} aria-hidden>
          {points.map((p, i) => (
            <span key={i} className={cn('line-clamp-2 min-w-0 flex-1 text-center leading-tight tabular-nums text-slate-500', large ? 'text-xs' : 'text-[11px]', !allLabels && points.length > 8 && i % 2 === 1 && i !== points.length - 1 && 'invisible')}>
              {p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Horizontal bars (stages, age buckets): label · bar · value; 2 series as two thin bars. */
export function BarRows({ points, unit, series, large }: { points: BarPoint[]; unit: CardUnit; series: string[]; large?: boolean }) {
  const max = Math.max(1, ...points.flatMap((p) => p.values));
  const two = series.length > 1;
  return (
    <div>
      {two && (
        <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-600" aria-hidden>
          {series.map((s, i) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: SERIES[i] }} /> {s}
            </span>
          ))}
        </div>
      )}
      <ul className="space-y-2.5">
        {points.map((p, i) => (
          <li key={`${p.label}-${i}`} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3" title={p.note ?? undefined}>
            <span className={cn('truncate text-slate-600', large ? 'text-sm' : 'text-[13px]')}>{p.label}</span>
            <span className="grid gap-1">
              {p.values.map((v, k) => (
                <span key={k} className="block h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full transition-[width] duration-200" style={{ width: `${(v / max) * 100}%`, backgroundColor: two ? SERIES[k] : SERIES[0] }} />
                </span>
              ))}
            </span>
            <span className={cn('text-right font-semibold tabular-nums text-slate-800', large ? 'text-sm' : 'text-[13px]')}>
              {p.values.map((v) => compact(v, unit) + (unit === 'days' ? ' d' : '')).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Donut for 2–5 parts with the total in the centre; the legend carries the direct labels. */
export function Donut({ parts, total, unit, size = 132 }: { parts: DonutPart[]; total: number; unit: CardUnit; size?: number }) {
  const { active, setActive, ref } = useTipState();
  const r = 42;
  const c = 2 * Math.PI * r;
  const sorted = [...parts].sort((a, b) => b.value - a.value);
  let offset = 0;
  return (
    <div ref={ref} className="flex flex-wrap items-center justify-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={sorted.map((p) => `${p.label} ${formatValue(p.value, unit)}`).join(', ')}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(241 245 249)" strokeWidth="13" />
          {sorted.map((p, i) => {
            const len = total > 0 ? (p.value / total) * c : 0;
            const seg = (
              <circle
                key={p.label}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={shade(i, sorted.length)}
                strokeWidth={active === i ? 15 : 13}
                strokeDasharray={`${Math.max(0, len - 0.8)} ${c}`}
                strokeDashoffset={-offset}
                className="cursor-pointer transition-[stroke-width] duration-150"
                onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
                onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
              />
            );
            offset += len;
            return seg;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {active !== null ? (
            <>
              <span className="text-lg font-semibold tabular-nums text-slate-900">{compact(sorted[active].value, unit)}</span>
              <span className="max-w-[80%] truncate text-[11px] text-slate-500">{sorted[active].label}</span>
            </>
          ) : (
            <>
              <span className="text-xl font-semibold tabular-nums text-slate-900">{compact(total, unit)}</span>
              <span className="text-[11px] text-slate-500">{unit === 'pcs' ? 'pcs total' : 'total'}</span>
            </>
          )}
        </div>
      </div>
      {/* the legend sits beside the donut, or under it when the card is narrow (it never overflows) */}
      <ul className="min-w-[13rem] flex-1 space-y-1.5">
        {sorted.map((p, i) => (
          <li key={p.label}>
            <button
              type="button"
              className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors [@media(pointer:coarse)]:min-h-11', active === i ? 'bg-slate-100' : 'hover:bg-slate-50')}
              onClick={() => setActive(active === i ? null : i)}
            >
              <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: shade(i, sorted.length) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-slate-700">{p.label}</span>
              <span className="font-semibold tabular-nums text-slate-900">{formatValue(p.value, unit)}</span>
              <span className="w-11 text-right text-xs tabular-nums text-slate-500">{total > 0 ? `${Math.round((p.value / total) * 100)}%` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A 2 px line with an end dot — next to a figure where a trend helps. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-8 w-24', className)} role="img" aria-label={label ?? 'Trend'}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="hsl(var(--primary))" />
    </svg>
  );
}

/** The thin bar under a ranked row. */
export function InlineBar({ value, max, tone }: { value: number; max: number; tone?: 'red' | 'amber' | 'green' | 'neutral' }) {
  const color = tone === 'red' ? 'rgb(225 29 72)' : tone === 'amber' ? 'rgb(217 119 6)' : 'hsl(var(--primary) / 0.7)';
  return (
    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
      <span className="block h-full rounded-full transition-[width] duration-200" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, backgroundColor: color }} />
    </span>
  );
}
