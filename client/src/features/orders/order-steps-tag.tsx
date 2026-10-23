import { Check, Lock } from 'lucide-react';
import {
  ORDER_KIND_LABEL,
  orderKind,
  STEP_KEYS,
  STEP_LABEL,
  STEP_LETTER,
  stepOn,
  type OrderSteps,
  type StepKey,
  type StepLocks,
} from '@rivoora/shared';
import { cn } from '@/lib/utils';

/**
 * Sprint 16 — the "Production · Butta cutting · Mill" tappable pills (Add / Edit order). All three on by default on a
 * new order; a locked step (once a taka has reached it) shows a lock icon and can't be unticked.
 */
export function StepsPills({
  steps,
  onToggle,
  locks,
  disabled,
  className,
}: {
  steps: OrderSteps;
  onToggle: (key: StepKey) => void;
  /** Why a ticked step can't be unticked any more (null / undefined = it can). */
  locks?: StepLocks | null;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Steps that happen in our system" className={cn('flex flex-wrap gap-2', className)}>
      {STEP_KEYS.map((key) => {
        const on = stepOn(steps, key);
        const lockReason = on ? locks?.[key] : null;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            disabled={disabled || !!lockReason}
            title={lockReason ?? undefined}
            onClick={() => onToggle(key)}
            className={cn(
              'inline-flex min-h-10 items-center gap-1.5 rounded-full border-2 px-4 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-primary/40',
            )}
          >
            {lockReason ? <Lock className="size-3.5 shrink-0" aria-hidden /> : on ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
            {STEP_LABEL[key]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Compact tag for order cards / the header / Order details: an "Outside production" / "FG purchase" tag for those
 * kinds, or small "P · B · M" letters (dimmed for steps that are off) when Production is ticked but not every step is.
 * Renders nothing for a plain in-house order with all three steps (the common case needs no extra clutter).
 */
export function OrderStepsTag({ steps, className }: { steps: OrderSteps; className?: string }) {
  const kind = orderKind(steps);
  if (kind !== 'in_house') {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
          kind === 'fg_purchase' ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-sky-300 bg-sky-50 text-sky-800',
          className,
        )}
      >
        {ORDER_KIND_LABEL[kind]}
      </span>
    );
  }
  if (steps.hasButta && steps.hasMill) return null;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-bold', className)}
      title="Production · Butta cutting · Mill"
    >
      {STEP_KEYS.map((k) => (
        <span key={k} className={stepOn(steps, k) ? 'text-slate-600' : 'text-slate-300 line-through'}>
          {STEP_LETTER[k]}
        </span>
      ))}
    </span>
  );
}
