import * as Menu from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof Menu.Content>,
  ComponentPropsWithoutRef<typeof Menu.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <Menu.Portal>
    <Menu.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={12}
      className={cn(
        'z-50 min-w-[220px] overflow-hidden rounded-xl border border-border bg-white p-1.5 shadow-pop animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  </Menu.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuLabel = ({ className, ...props }: ComponentPropsWithoutRef<typeof Menu.Label>) => (
  <Menu.Label className={cn('px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)} {...props} />
);

export const DropdownMenuSeparator = () => <Menu.Separator className="my-1 h-px bg-border" />;

const itemClass =
  'relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-800 outline-none data-[highlighted]:bg-slate-100 data-[disabled]:opacity-50';

export const DropdownMenuItem = forwardRef<ElementRef<typeof Menu.Item>, ComponentPropsWithoutRef<typeof Menu.Item>>(
  ({ className, ...props }, ref) => <Menu.Item ref={ref} className={cn(itemClass, className)} {...props} />,
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof Menu.RadioItem>,
  ComponentPropsWithoutRef<typeof Menu.RadioItem>
>(({ className, ...props }, ref) => (
  <Menu.RadioItem
    ref={ref}
    className={cn(itemClass, 'data-[state=checked]:bg-primary-soft data-[state=checked]:text-primary', className)}
    {...props}
  />
));
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';
