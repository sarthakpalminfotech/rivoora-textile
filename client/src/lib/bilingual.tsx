import type { ReactNode } from 'react';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';

/**
 * English + Hindi labels for the Taka entry role's screens (other roles stay English-only).
 * `bi('Submit', 'जमा करें')` → "Submit / जमा करें" for plain strings (toasts, titles, aria labels);
 * `<Bi en hi />` for buttons and headings.
 */
export const bi = (en: string, hi: string) => `${en} / ${hi}`;

/** True when the current role's screens are bilingual. */
export function useBilingual() {
  return !!useRole().config.bilingual;
}

interface BiProps {
  en: ReactNode;
  hi: ReactNode;
  /** `stack` (default): Hindi on its own line below. `inline`: "English / हिंदी" on one line (wraps at the slash). */
  layout?: 'stack' | 'inline';
  className?: string;
  hiClassName?: string;
}

export function Bi({ en, hi, layout = 'stack', className, hiClassName }: BiProps) {
  if (layout === 'inline') {
    return (
      <span className={className}>
        {en}
        <span className="opacity-60"> / </span>
        <span lang="hi" className={cn('inline-block', hiClassName)}>
          {hi}
        </span>
      </span>
    );
  }
  return (
    <span className={cn('inline-flex min-w-0 flex-col leading-tight', className)}>
      <span className="truncate">{en}</span>
      <span lang="hi" className={cn('truncate text-[0.85em] font-medium opacity-80', hiClassName)}>
        {hi}
      </span>
    </span>
  );
}
