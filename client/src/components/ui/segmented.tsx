import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
}

interface SegmentedProps<V extends string> {
  options: SegmentOption<V>[];
  /** Nothing is selected while `null` (e.g. a required choice on a new form). */
  value: V | null | undefined;
  onChange: (value: V) => void;
  invalid?: boolean;
  id?: string;
  'aria-label'?: string;
  /** Tall (48px) segments for the tablet-first screens. */
  size?: 'md' | 'lg';
  className?: string;
}

/** Side-by-side attached tappable options (a radio group styled as one control). */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  invalid,
  id,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<V>) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className={cn(
        'inline-flex w-full overflow-hidden rounded-[10px] border bg-white p-0.5',
        invalid ? 'border-destructive ring-2 ring-destructive/15' : 'border-input',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = options.findIndex((x) => x.value === o.value);
              const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
              onChange(next.value);
              (e.currentTarget.parentElement?.children[options.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center rounded-lg px-3 font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
              size === 'lg' ? 'min-h-11 text-[15px]' : 'min-h-10 text-sm',
              active ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-muted',
            )}
          >
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
