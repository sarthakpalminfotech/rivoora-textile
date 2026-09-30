import { AlertTriangle, X } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { z } from 'zod';
import { JOBSHEET_STATUS, type JobsheetMachine } from '@rivoora/shared';
import { MultiSelect, type SelectOption } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useMachineLookup } from '../masters/api';

/** Text field holding a whole number ≥ 1 (forms keep numbers as strings). */
export const intField = (label: string, max = 10_000_000) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1, 'Use a whole number of at least 1')
    .refine((v) => Number(v) <= max, `Must be at most ${max.toLocaleString('en-IN')}`);

/** Parses a whole number ≥ 1, otherwise null (for live previews). */
export function parseIntOrNull(v: string | undefined): number | null {
  if (!v || !/^\s*\d+\s*$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 ? n : null;
}

/** "7, 9" */
export function machineNumbers(machines: Pick<JobsheetMachine, 'machineNo'>[]): string {
  return machines.length ? machines.map((m) => m.machineNo).join(', ') : '—';
}

export function machineLabel(m: { machineNo: number; name: string | null }) {
  return m.name ? `Machine ${m.machineNo} · ${m.name}` : `Machine ${m.machineNo}`;
}

/**
 * Frames of a jobsheet: "10" — or "8/10" (actual/assigned) once Completed, in amber when fewer frames were made.
 * `withUnit` appends "frames".
 */
export function FramesValue({
  status,
  frames,
  completedFrames,
  withUnit,
  className,
}: {
  status: string;
  frames: number;
  completedFrames: number | null;
  withUnit?: boolean;
  className?: string;
}) {
  const unit = withUnit ? ` frame${frames === 1 ? '' : 's'}` : '';
  if (status !== JOBSHEET_STATUS.COMPLETED || completedFrames === null) {
    return (
      <span className={className}>
        {frames}
        {unit}
      </span>
    );
  }
  const short = completedFrames < frames;
  return (
    <span
      className={cn(short && 'text-amber-600', className)}
      title={short ? `${frames - completedFrames} fewer than assigned` : undefined}
    >
      {completedFrames}/{frames}
      {unit}
    </span>
  );
}

/** Amber, non-blocking warnings. */
export function WarningList({ messages, className }: { messages: string[]; className?: string }) {
  if (messages.length === 0) return null;
  return (
    <ul className={cn('space-y-2', className)}>
      {messages.map((m) => (
        <li
          key={m}
          role="status"
          className="flex items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <span>{m}</span>
        </li>
      ))}
    </ul>
  );
}

/** Small stat tile, styled like the detail fields. */
export function StatTile({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-[10px] border border-border bg-slate-50/70 px-3.5 py-3', className)}>
      <p className="text-[13px] leading-snug text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

interface MachinesSelectProps {
  value: number[];
  onChange: (ids: number[]) => void;
  invalid?: boolean;
  id?: string;
  /** Machines already on the jobsheet — kept selectable even when they are inactive now. */
  assigned?: JobsheetMachine[];
}

/** Multi-select of active machines (the list is small, so it's filtered client-side). */
export function MachinesSelect({ value, onChange, invalid, id, assigned = [] }: MachinesSelectProps) {
  const lookup = useMachineLookup();
  const options = useMemo<SelectOption<number>[]>(() => {
    const byId = new Map<number, SelectOption<number> & { no: number }>();
    for (const m of lookup.data ?? []) byId.set(m.id, { value: m.id, label: machineLabel(m), no: m.machineNo });
    for (const m of assigned) {
      if (!byId.has(m.id)) {
        byId.set(m.id, {
          value: m.id,
          label: machineLabel(m),
          description: m.isActive ? null : 'Inactive — already on this jobsheet',
          no: m.machineNo,
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.no - b.no).map(({ no: _no, ...o }) => o);
  }, [lookup.data, assigned]);

  const selected = options.filter((o) => value.includes(o.value));

  return (
    <div className="space-y-2">
      <MultiSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        placeholder="Select machines"
        searchable
        searchPlaceholder="Search machine number or name…"
        loading={lookup.isPending}
        emptyText={lookup.isError ? "Couldn't load machines" : 'No active machines'}
        invalid={invalid}
      />
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected machines">
          {selected.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== o.value))}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-primary-soft pl-3 pr-2 text-[13px] font-semibold text-primary hover:bg-primary/10 disabled:pointer-events-none"
                aria-label={`Remove ${o.label}`}
              >
                {o.label.replace(/^Machine /, 'M')}
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
