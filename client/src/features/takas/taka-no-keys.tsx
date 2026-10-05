import { cleanTakaNo } from '@rivoora/shared';
import { cn } from '@/lib/utils';

/**
 * Inserts `char` at the cursor of a taka number field (cleaned like typing) and keeps the field focused with the
 * cursor after it. Used by the – and / helper keys, because phone number keypads have no dash or slash.
 */
export function insertIntoTakaNo(input: HTMLInputElement | null | undefined, char: '-' | '/', onValue: (value: string) => void) {
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = cleanTakaNo(input.value.slice(0, start) + char);
  const value = cleanTakaNo(before + input.value.slice(end));
  onValue(value);
  const caret = Math.min(before.length, value.length);
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(caret, caret);
  });
}

/**
 * The two small – and / keys shown under the FOCUSED taka number field only. `onPointerDown` prevents the default,
 * so the field keeps focus (and the phone keypad stays open).
 */
export function TakaNoKeys({
  input,
  onValue,
  className,
  size = 'lg',
}: {
  input: () => HTMLInputElement | null | undefined;
  onValue: (value: string) => void;
  className?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div className={cn('flex gap-2', className)}>
      {(['-', '/'] as const).map((char) => (
        <button
          key={char}
          type="button"
          tabIndex={-1}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => insertIntoTakaNo(input(), char, onValue)}
          aria-label={char === '-' ? 'Insert dash' : 'Insert slash'}
          className={cn(
            'flex items-center justify-center rounded-lg border border-slate-300 bg-slate-100 font-bold text-slate-700 shadow-sm active:bg-slate-200',
            size === 'lg' ? 'h-10 min-w-14 px-4 text-xl' : 'h-8 min-w-11 px-3 text-lg',
          )}
        >
          {char === '-' ? '–' : '/'}
        </button>
      ))}
    </div>
  );
}
