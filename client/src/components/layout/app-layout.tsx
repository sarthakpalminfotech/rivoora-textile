import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Suspense, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';
import { usePageTitleValue } from './page-title';
import { ProfileMenu, RoleTag } from './profile-menu';
import { PageSkeleton } from './page-skeleton';

const RAIL_KEY = 'rivoora.sidebar.expanded';

function readExpanded() {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-9 shrink-0" />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-bold tracking-tight text-slate-900">Rivoora Textile</p>
          <p className="truncate text-[11px] font-medium uppercase tracking-wider text-accent-foreground/70">Order management</p>
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  // Tablet (768–1023px): icon rail that can be expanded. Desktop: always expanded.
  const [expanded, setExpanded] = useState(readExpanded);
  const toggle = () => {
    setExpanded((e) => {
      try {
        localStorage.setItem(RAIL_KEY, e ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !e;
    });
  };

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-r border-border bg-white transition-[width] duration-200 md:flex lg:w-64',
        expanded ? 'w-64' : 'w-[76px]',
      )}
    >
      <div className={cn('flex h-16 items-center border-b border-border px-4', !expanded && 'justify-center px-0 lg:justify-start lg:px-4')}>
        <div className={cn(!expanded && 'lg:hidden')}>
          <Logo collapsed />
        </div>
        <div className={cn(!expanded ? 'hidden lg:block' : 'block')}>
          <Logo />
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              cn(
                'flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-slate-600 transition-colors hover:bg-muted hover:text-slate-900',
                !expanded && 'justify-center px-0 lg:justify-start lg:px-3',
                isActive && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
              )
            }
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className={cn(!expanded && 'sr-only lg:not-sr-only')}>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-3 lg:hidden">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-sm font-medium text-slate-500 hover:bg-muted',
            !expanded && 'justify-center px-0',
          )}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {expanded ? <PanelLeftClose className="size-5" /> : <PanelLeftOpen className="size-5" />}
          {expanded && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}

function TopBar() {
  const title = usePageTitleValue();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="flex h-14 items-center gap-3 px-4 md:h-16 md:px-6 lg:px-8">
        <div className="md:hidden">
          <img src="/favicon.svg" alt="Rivoora Textile" className="size-8" />
        </div>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900 md:text-xl">{title}</h1>
        <RoleTag />
        <ProfileMenu />
      </div>
    </header>
  );
}

function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 pb-safe backdrop-blur md:hidden"
    >
      <div className="grid h-16 grid-cols-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 transition-colors',
                isActive && 'text-primary',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-primary-soft')}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-[100dvh]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-10">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
