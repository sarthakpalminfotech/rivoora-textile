import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useIsDesktop, useIsMobile } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

/**
 * Sprint 17 — the yarn dialogs' layout (§9):
 * - `sheet` (Transfer, Assign program, Withdraw): a right-side sheet from 1024px (landscape tablets / desktop), a centred
 *   760px dialog on portrait tablets, full screen on phones.
 * - `wide` (Start warping, Mark done, program details): a centred dialog up to 880px from 768px, full screen on phones.
 * The footer is the Modal's sticky footer, which `kb-modal-*` keeps above the on-screen keyboard.
 */
export function YarnDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  layout = 'sheet',
  busy,
  dirty,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  layout?: 'sheet' | 'wide';
  /** A save is running: the dialog can't be closed. */
  busy?: boolean;
  /** Unsaved input: an outside click doesn't close it. */
  dirty?: boolean;
}) {
  const phone = useIsMobile();
  const desktop = useIsDesktop();
  const variant = phone ? 'fullscreen' : layout === 'sheet' && desktop ? 'right' : 'center';
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      description={description}
      variant={variant}
      size={phone ? 'md' : 'xl'}
      dismissible={!dirty && !busy}
      className={cn(variant === 'right' && 'md:max-w-[600px]', variant === 'center' && (layout === 'sheet' ? 'max-w-[760px]' : 'max-w-[880px]'))}
      bodyClassName="md:px-6"
      // While it animates closed (after a save) the buttons take no more taps — no double submit.
      footer={footer && <div className={cn('contents', !open && 'pointer-events-none')}>{footer}</div>}
    >
      <div className={cn(!open && 'pointer-events-none')}>{children}</div>
    </Modal>
  );
}

/** Cancel + primary button row of a yarn dialog footer. */
export function DialogButtons({ onCancel, busy, label, disabled, form }: { onCancel: () => void; busy?: boolean; label: string; disabled?: boolean; form?: string }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" form={form} loading={busy} disabled={disabled} className="sm:min-w-32">
        {label}
      </Button>
    </div>
  );
}
