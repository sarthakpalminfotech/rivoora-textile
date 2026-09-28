import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

/** Hover tooltip on desktop; also opens on tap for touch devices. */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen} delayDuration={150}>
      <TooltipPrimitive.Trigger
        asChild
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          onPointerDownOutside={() => setOpen(false)}
          className={cn(
            'z-[70] max-w-[240px] rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-pop animate-in fade-in-0 zoom-in-95',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-slate-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
