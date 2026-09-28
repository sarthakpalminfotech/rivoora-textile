import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const fieldBase =
  'w-full rounded-[10px] border border-input bg-slate-50/60 text-[15px] text-foreground placeholder:text-slate-400 transition-colors hover:border-slate-300 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus:ring-destructive/15';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  invalid?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, prefix, suffix, wrapperClassName, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(fieldBase, 'h-11 px-3.5', prefix && 'pl-9', suffix && 'pr-10', className)}
        {...props}
      />
    );
    if (!prefix && !suffix) return input;
    return (
      <div className={cn('relative', wrapperClassName)}>
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400 [&_svg]:size-4">
            {prefix}
          </span>
        )}
        {input}
        {suffix && <span className="absolute inset-y-0 right-2 flex items-center">{suffix}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';

/** Decimal number input with a numeric keyboard on mobile; value stays a string. */
export const NumberInput = forwardRef<HTMLInputElement, InputProps>(({ ...props }, ref) => (
  <Input ref={ref} type="text" inputMode="decimal" autoComplete="off" {...props} />
));
NumberInput.displayName = 'NumberInput';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(fieldBase, 'min-h-[96px] resize-y px-3.5 py-2.5 leading-relaxed', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
