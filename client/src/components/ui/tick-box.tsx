import { Check, Minus } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface TickBoxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  /** Some (not all) of a group are ticked. */
  partial?: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** `lg` = a 28px box for tablets (the touch area is larger still). */
  size?: 'md' | 'lg';
}

/** A tick box (button with role=checkbox) in the primary colour, with a partial state. */
export const TickBox = forwardRef<HTMLButtonElement, TickBoxProps>(
  ({ checked, partial, onCheckedChange, size = 'md', className, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={partial && !checked ? 'mixed' : checked}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
        onCheckedChange(!checked);
      }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'lg' ? 'size-7' : 'size-5',
        checked || partial ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-transparent hover:border-primary/60',
        className,
      )}
      {...props}
    >
      {partial && !checked ? <Minus className="size-4" strokeWidth={3} aria-hidden /> : <Check className="size-4" strokeWidth={3} aria-hidden />}
    </button>
  ),
);
TickBox.displayName = 'TickBox';
