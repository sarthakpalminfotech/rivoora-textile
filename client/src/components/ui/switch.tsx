import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** On / off toggle in the primary colour. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(({ checked, onCheckedChange, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60',
      checked ? 'bg-primary' : 'bg-slate-300',
      className,
    )}
    {...props}
  >
    <span
      className={cn(
        'pointer-events-none block size-6 rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0',
      )}
      aria-hidden
    />
  </button>
));
Switch.displayName = 'Switch';
