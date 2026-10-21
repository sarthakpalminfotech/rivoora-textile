import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

export type ModalVariant = 'center' | 'right' | 'bottom' | 'fullscreen';

const variantClass: Record<ModalVariant, string> = {
  // `kb-modal-*`: lifted above the on-screen keyboard (index.css, hooks/useKeyboardInset.ts).
  center:
    'kb-modal-center left-1/2 top-1/2 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-2rem)] rounded-xl border border-border data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  right:
    'kb-modal-full inset-y-0 right-0 h-[100dvh] w-full border-l border-border md:max-w-[540px] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  bottom:
    'kb-modal-bottom inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  fullscreen: 'kb-modal-full inset-0 h-[100dvh] w-full data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4',
};

const sizeClass = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;
/** Content width inside a full-screen modal, so forms stay readable on wide screens. */
const fullscreenWidthClass = { sm: 'max-w-xl', md: 'max-w-2xl', lg: 'max-w-3xl', xl: 'max-w-6xl' } as const;

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: ModalVariant;
  size?: keyof typeof sizeClass;
  headerExtra?: ReactNode;
  bodyClassName?: string;
  className?: string;
  /** Prevent closing on outside click (e.g. forms). */
  dismissible?: boolean;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  variant = 'center',
  size = 'md',
  headerExtra,
  bodyClassName,
  className,
  dismissible = true,
  onEscapeKeyDown,
}: ModalProps) {
  const full = variant === 'fullscreen' || variant === 'right';
  const inner = variant === 'fullscreen' ? cn('mx-auto w-full', fullscreenWidthClass[size]) : undefined;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          onEscapeKeyDown={onEscapeKeyDown}
          onPointerDownOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          className={cn(
            'fixed z-50 flex flex-col bg-white shadow-pop outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out',
            variantClass[variant],
            variant === 'center' && sizeClass[size],
            className,
          )}
        >
          {variant === 'bottom' && <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-300" aria-hidden />}
          <div
            className={cn(
              'flex shrink-0 items-start gap-3 border-b border-border px-4 py-3.5 md:px-5',
              variant === 'bottom' && 'border-b-0 pb-1',
            )}
          >
            <div className={cn('flex min-w-0 flex-1 items-start gap-3', inner)}>
            {full && (
              <DialogPrimitive.Close
                className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-muted md:hidden"
                aria-label="Back"
              >
                <ArrowLeft className="size-5" />
              </DialogPrimitive.Close>
            )}
            <div className="min-w-0 flex-1 self-center">
              <DialogPrimitive.Title className="truncate text-lg font-semibold text-slate-900">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
              )}
            </div>
            {headerExtra}
            <DialogPrimitive.Close
              className={cn(
                '-mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-muted hover:text-slate-800',
                full && 'hidden md:flex',
              )}
              aria-label="Close"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
            </div>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5', bodyClassName)}>
            {inner ? <div className={cn(inner, 'h-full')}>{children}</div> : children}
          </div>
          {footer && (
            <div className="shrink-0 border-t border-border bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-5">
              <div className={cn('flex flex-wrap items-center justify-end gap-2', inner)}>{footer}</div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface ResponsiveModalProps extends Omit<ModalProps, 'variant'> {
  desktopVariant?: ModalVariant;
  mobileVariant?: ModalVariant;
}

/** Forms and pickers open full screen on every breakpoint by default (confirmations use `Modal` directly). */
export function ResponsiveModal({ desktopVariant = 'fullscreen', mobileVariant = 'fullscreen', ...props }: ResponsiveModalProps) {
  const isMobile = useIsMobile();
  return <Modal {...props} variant={isMobile ? mobileVariant : desktopVariant} />;
}
