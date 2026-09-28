import { Check, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_KEYS, ROLES, isRoleKey } from '@/config/roles';
import { useRole } from '@/hooks/useRole';
import { cn } from '@/lib/utils';

export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground ring-2 ring-accent/60',
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function RoleTag({ className }: { className?: string }) {
  const { config } = useRole();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-foreground',
        className,
      )}
    >
      {config.title}
    </span>
  );
}

export function ProfileMenu({ compact }: { compact?: boolean }) {
  const { role, config, setRole } = useRole();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-muted data-[state=open]:bg-muted"
          aria-label={`Profile: ${config.name} (${config.title}). Switch role`}
        >
          <Avatar initials={config.initials} />
          {!compact && (
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-sm font-semibold text-slate-900">{config.name}</span>
              <span className="block text-xs text-muted-foreground">{config.title}</span>
            </span>
          )}
          {!compact && <ChevronDown className="hidden size-4 text-slate-500 sm:block" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar initials={config.initials} className="size-10" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{config.name}</p>
            <p className="text-xs text-muted-foreground">Signed in as {config.title}</p>
          </div>
        </div>
        <div className="my-1 h-px bg-border" />
        <DropdownMenuLabel>Switch role</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={role}
          onValueChange={(v) => {
            if (!isRoleKey(v) || v === role) return;
            setRole(v);
            toast.success(`Switched to ${ROLES[v].name} — ${ROLES[v].title}`);
            navigate('/orders');
          }}
        >
          {ROLE_KEYS.map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              <Avatar initials={ROLES[key].initials} className="size-7 text-xs ring-0" />
              <span className="flex-1">
                {ROLES[key].name} — {ROLES[key].title}
              </span>
              {key === role && <Check className="size-4" aria-hidden />}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
