import { ArrowLeft, Package, Plus, RotateCw, Waves, X, type LucideIcon } from 'lucide-react';
import { forwardRef, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  cleanKgText,
  formatKg,
  formatKgNumber,
  YARN_PO_STATUS_CONFIG,
  YARN_ZONE_CONFIG,
  YARN_ZONES,
  type YarnActor,
  type YarnPoStatus,
  type YarnQualityLookupItem,
  type YarnZone,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Input, type InputProps } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLotStock, useYarnQualityLookup } from './api';

/** Sprint 17 — small building blocks shared by the yarn screens. */

export const ZONE_ICON: Record<YarnZone, LucideIcon> = { direct: Package, tfo: RotateCw, warping: Waves };

/** ₹ from paise. */
export const money = (paise: number | null | undefined) => (paise === null || paise === undefined ? '—' : formatMoney(paise / 100));

export function ZoneTag({ zone, className, short }: { zone: YarnZone; className?: string; /** "Direct" instead of "Direct consumption" on narrow columns. */ short?: boolean }) {
  const c = YARN_ZONE_CONFIG[zone];
  const Icon = ZONE_ICON[zone];
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', className)}
      style={{ backgroundColor: c.accent.soft, color: c.accent.text, borderColor: c.accent.border }}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{short ? c.label.split(' ')[0] : c.label}</span>
    </span>
  );
}

export function YarnPoStatusBadge({ status, className }: { status: YarnPoStatus; className?: string }) {
  const s = YARN_PO_STATUS_CONFIG[status];
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', className)}
      style={{ backgroundColor: s.badge.bg, color: s.badge.text }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.badge.dot }} aria-hidden />
      <span className="truncate">{s.label}</span>
    </span>
  );
}

/** "1,234.5 kg" (tabular). `signed` adds + / − for ledger rows. */
export function Kg({ g, signed, unit = true, className }: { g: number; signed?: boolean; unit?: boolean; className?: string }) {
  const text = unit ? formatKg(Math.abs(g)) : formatKgNumber(Math.abs(g));
  return (
    <span className={cn('whitespace-nowrap tabular-nums', signed && (g < 0 ? 'text-rose-700' : 'text-emerald-700'), className)}>
      {signed ? (g < 0 ? '−' : '+') : g < 0 ? '−' : ''}
      {text}
    </span>
  );
}

export function ProgressBar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'green' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full', pct >= 100 || tone === 'green' ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** "by Jenish" / "by Supervisor". */
export const actorText = (a: YarnActor | null | undefined) => (a ? a.userName ?? (a.role ? a.role.replace(/_/g, ' ') : null) : null);

/** A kg field: numeric keyboard, digits + one dot, at most 3 decimals, "kg" suffix. */
export const KgInput = forwardRef<HTMLInputElement, Omit<InputProps, 'onChange' | 'value'> & { value: string; onValueChange: (v: string) => void }>(
  ({ value, onValueChange, className, ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => onValueChange(cleanKgText(e.target.value))}
      className={cn('pr-10 text-right tabular-nums', className)}
      suffix={<span className="pr-1.5 text-sm font-medium text-slate-400">kg</span>}
      {...props}
    />
  ),
);
KgInput.displayName = 'KgInput';

/** A plain decimal field (rate, TPM, taar, panna, meters): keeps digits and one dot. */
export function cleanDecimal(text: string, decimals = 2, intDigits = 9): string {
  const s = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (decimals === 0 || i < 0) return s.replace(/\./g, '').slice(0, intDigits);
  return `${s.slice(0, Math.min(i, intDigits))}.${s.slice(i + 1).replace(/\./g, '').slice(0, decimals)}`;
}

/** Number from a cleaned decimal text (null when empty / not a number). */
export const numOrNull = (text: string): number | null => (text.trim() === '' || text === '.' ? null : Number(text));

interface QualitySelectProps {
  value: number | null;
  onChange: (id: number, q: YarnQualityLookupItem | null) => void;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  /** Only these qualities (e.g. those with stock in a zone) — with the available grams shown under the name. */
  only?: { id: number; name: string; availableG: number }[];
  /** Qualities that can't be picked again (already on another line). */
  taken?: number[];
  /** A ➕ beside the select (quick-add). */
  onAdd?: () => void;
  disabled?: boolean;
  className?: string;
  /** Name to show while the picked quality isn't in the list. */
  selectedLabel?: string;
}

const qualityDescription = (q: { denier?: string | null; filament?: string | null }) => [q.denier && `Denier ${q.denier}`, q.filament && `Filament ${q.filament}`].filter(Boolean).join(' · ') || null;

/** The yarn quality dropdown (searchable). With `only`, it lists the given qualities with their available kg. */
export function QualitySelect({ value, onChange, id, invalid, placeholder = 'Select quality', only, taken = [], onAdd, disabled, className, selectedLabel }: QualitySelectProps) {
  const lookup = useYarnQualityLookup('', !only);
  const all = lookup.data ?? [];
  const options = useMemo(
    () =>
      only
        ? only.map((q) => ({ value: q.id, label: q.name, description: `${formatKg(q.availableG)} available`, disabled: q.availableG <= 0 || (taken.includes(q.id) && q.id !== value) }))
        : all.map((q) => ({ value: q.id, label: q.name, description: qualityDescription(q), disabled: taken.includes(q.id) && q.id !== value })),
    [only, all, taken, value],
  );
  return (
    <Select
      id={id}
      value={value}
      onChange={(v) => onChange(v, all.find((q) => q.id === v) ?? null)}
      options={options}
      placeholder={placeholder}
      searchable
      searchPlaceholder="Search qualities…"
      loading={!only && lookup.isPending}
      emptyText={only ? 'No stock here' : 'No qualities yet'}
      invalid={invalid}
      disabled={disabled}
      className={className}
      panelClassName="min-w-[min(300px,calc(100vw-24px))]"
      selectedLabel={selectedLabel}
      aria-label={placeholder}
      action={
        onAdd && (
          <Button variant="secondary" size="icon" className="shrink-0" onClick={onAdd} aria-label="Add yarn quality" title="Add yarn quality">
            <Plus className="!size-5" />
          </Button>
        )
      }
    />
  );
}

/**
 * Sprint 20 — the lot picker for raw yarn moves ("No lot" first, then lots by number). `value` is the lot id, or
 * `0` to mean "No lot" (lot ids are never 0).
 */
export function LotSelect({
  zone,
  qualityId,
  value,
  onChange,
  invalid,
  disabled,
  className,
}: {
  zone: YarnZone;
  qualityId: number | null;
  value: number;
  onChange: (lotId: number) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const lots = useLotStock(zone, qualityId, !!qualityId);
  const options = (lots.data ?? []).map((l) => ({
    value: l.id ?? 0,
    label: l.id === null ? 'No lot' : l.lotNo!,
    description: [l.partyName, `${formatKg(l.availableG)} available`].filter(Boolean).join(' · '),
  }));
  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      placeholder={qualityId ? 'Select lot' : 'Pick a quality first'}
      searchable
      searchPlaceholder="Search lots…"
      loading={lots.isPending}
      emptyText="No stock here"
      invalid={invalid}
      disabled={disabled || !qualityId}
      className={className}
      aria-label="Lot"
    />
  );
}

/** Big tappable zone options (Receive challan, Transfer To, Mark done Keep in). */
export function ZoneChoice({
  value,
  onChange,
  zones = YARN_ZONES as unknown as YarnZone[],
  invalid,
  compact,
  'aria-label': ariaLabel = 'Zone',
}: {
  value: YarnZone | null;
  onChange: (z: YarnZone) => void;
  zones?: YarnZone[];
  invalid?: boolean;
  compact?: boolean;
  'aria-label'?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-invalid={invalid || undefined} className={cn('grid gap-2', zones.length === 3 ? 'sm:grid-cols-3' : 'grid-cols-2')}>
      {zones.map((z) => {
        const c = YARN_ZONE_CONFIG[z];
        const Icon = ZONE_ICON[z];
        const on = value === z;
        return (
          <button
            key={z}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(z)}
            className={cn(
              'flex min-w-0 items-center gap-3 rounded-xl border-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              compact ? 'min-h-12 px-3 py-2' : 'min-h-16 px-3.5 py-3',
              on ? 'shadow-sm' : 'border-input bg-white hover:bg-muted',
              invalid && !on && 'border-destructive/60',
            )}
            style={on ? { borderColor: c.accent.solid, backgroundColor: c.accent.soft } : undefined}
          >
            <span
              className={cn('flex shrink-0 items-center justify-center rounded-lg', compact ? 'size-8' : 'size-10')}
              style={{ backgroundColor: on ? c.accent.solid : c.accent.soft, color: on ? '#fff' : c.accent.text }}
            >
              <Icon className={compact ? 'size-4' : 'size-5'} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className={cn('block truncate font-semibold text-slate-900', compact ? 'text-sm' : 'text-[15px]')}>{c.label}</span>
              {!compact && <span className="block truncate text-xs text-slate-500">{c.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A labelled card section (forms, details). */
export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-800">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** The header of a full-screen yarn form (✕ closes, the Save button sits here on tablets / desktop too). */
export function FormHeader({ title, onClose, action }: { title: ReactNode; onClose: () => void; action?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-2 md:h-16 md:px-4">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="!size-5" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900">{title}</h1>
        {action}
      </div>
    </header>
  );
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg pr-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}

/** A tappable on / off pill (filters). */
export function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'min-h-10 rounded-full border px-3.5 text-sm font-medium transition-colors',
        on ? 'border-primary bg-primary-soft text-primary' : 'border-input bg-white text-slate-700 hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

/** Two attached tappable options (S / Z, Raw / Twisted). */
export function Toggle2<V extends string>({ value, onChange, options, invalid, id }: { value: V | null; onChange: (v: V) => void; options: { value: V; label: ReactNode }[]; invalid?: boolean; id?: string }) {
  return (
    <div id={id} role="radiogroup" className={cn('inline-flex h-11 w-full overflow-hidden rounded-[10px] border bg-white p-0.5', invalid ? 'border-destructive' : 'border-input')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('flex min-w-0 flex-1 items-center justify-center rounded-lg px-2 text-sm font-semibold transition-colors', value === o.value ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Keeps the latest value of a quick-add (a new quality picked from its form). */
export function useQuickAdd<T>() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<T | null>(null);
  return {
    open,
    target,
    start: (t: T) => {
      setTarget(t);
      setOpen(true);
    },
    setOpen,
  };
}
