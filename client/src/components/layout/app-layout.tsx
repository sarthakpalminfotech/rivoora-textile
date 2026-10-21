import { ChevronRight, Ellipsis } from 'lucide-react';
import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/modal';
import { ROLES } from '@/config/roles';
import { useRole } from '@/hooks/useRole';
import { Bi } from '@/lib/bilingual';
import { cn } from '@/lib/utils';
import { isMasterPath, navItemsFor, type NavItem } from './nav-items';
import { usePageTitleValue } from './page-title';
import { ProfileMenu, RoleTag } from './profile-menu';
import { PageSkeleton } from './page-skeleton';

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
  const { can } = useRole();
  const { pathname } = useLocation();
  const items = navItemsFor(can);

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r border-border bg-white lg:flex">
      <div className="flex h-16 items-center border-b border-border px-4">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main">
        {items.map(({ to, label, hi, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={hi ? `${label} / ${hi}` : label}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-1 text-[15px] font-medium text-slate-600 transition-colors hover:bg-muted hover:text-slate-900',
                (to === '/masters' ? isMasterPath(pathname) : isActive) && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
              )
            }
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="min-w-0">{hi ? <Bi en={label} hi={hi} hiClassName="text-[13px]" /> : label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

/** A subtle bar while a role-switching user (Jenish, Gaurang) acts as another role. */
function ActingAsBar() {
  const { config, user, isActingAs, setRole } = useRole();
  const navigate = useNavigate();
  if (!user || !isActingAs) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-accent/30 bg-accent-soft px-4 py-1.5 text-[13px] text-accent-foreground">
      <span>
        Viewing as <b>{config.name}</b>
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        className="font-semibold underline underline-offset-2 hover:no-underline"
        onClick={() => {
          setRole(user.role);
          navigate(ROLES[user.role].landing);
        }}
      >
        Back to {user.name}
      </button>
    </div>
  );
}

function TopBar() {
  const title = usePageTitleValue();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="flex h-14 items-center gap-3 px-4 md:h-16 md:px-6 lg:px-8">
        <div className="lg:hidden">
          <img src="/favicon.svg" alt="Rivoora Textile" className="size-8" />
        </div>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900 md:text-xl">{title}</h1>
        <RoleTag />
        <ProfileMenu />
      </div>
    </header>
  );
}

const tabClass = 'flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 transition-colors';

function TabIcon({ icon: Icon, active }: { icon: NavItem['icon']; active: boolean }) {
  return (
    <span className={cn('flex h-7 w-11 items-center justify-center rounded-full transition-colors', active && 'bg-primary-soft')}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

/** Everything that does not fit the 4-tab bar (phones and tablets). */
function MoreSheet({ items, open, onOpenChange }: { items: NavItem[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { pathname } = useLocation();
  return (
    <Modal open={open} onOpenChange={onOpenChange} variant="bottom" title="More" bodyClassName="px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1">
      <ul className="space-y-1">
        {items.map(({ to, label, icon: Icon }) => {
          const active = to === '/masters' ? isMasterPath(pathname) : pathname === to || pathname.startsWith(`${to}/`);
          return (
            <li key={to}>
              <Link
                to={to}
                onClick={() => onOpenChange(false)}
                className={cn(
                  'flex h-14 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold text-slate-700 transition-colors hover:bg-muted',
                  active && 'bg-primary-soft text-primary hover:bg-primary-soft',
                )}
              >
                <span className={cn('flex size-10 items-center justify-center rounded-xl bg-slate-100', active && 'bg-white')}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="flex-1">{label}</span>
                <ChevronRight className="size-4 text-slate-400" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function BottomNav() {
  const { can } = useRole();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = navItemsFor(can);
  // At most 4 tabs: when the bar is full, the last main items (e.g. Mill) move into the More sheet.
  const allMain = [...items].sort((x, y) => (x.phoneOrder ?? 99) - (y.phoneOrder ?? 99));
  const maxMain = allMain.length > 4 ? 3 : 4;
  const main = allMain.slice(0, maxMain);
  const more = allMain.slice(maxMain);
  const moreActive = more.some((i) => (i.to === '/masters' ? isMasterPath(pathname) : pathname === i.to || pathname.startsWith(`${i.to}/`)));
  const columns = main.length + (more.length ? 1 : 0);

  return (
    <nav
      aria-label="Main"
      className="kb-hide-on-keyboard fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 pb-safe backdrop-blur lg:hidden"
    >
      <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {main.map(({ to, label, hi, icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cn(tabClass, hi && 'gap-0.5', isActive && 'text-primary')}>
            {({ isActive }) => (
              <>
                <TabIcon icon={icon} active={isActive} />
                {hi ? (
                  <span className="flex max-w-full flex-col items-center px-1 leading-tight">
                    <span className="max-w-full truncate">{label}</span>
                    <span lang="hi" className="max-w-full truncate text-[10px] font-medium">
                      {hi}
                    </span>
                  </span>
                ) : (
                  <span className="max-w-full truncate px-1">{label}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
        {more.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(tabClass, (moreActive || moreOpen) && 'text-primary')}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <TabIcon icon={Ellipsis} active={moreActive} />
            More
          </button>
        )}
      </div>
      {more.length > 0 && <MoreSheet items={more} open={moreOpen} onOpenChange={setMoreOpen} />}
    </nav>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-[100dvh]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <ActingAsBar />
        <TopBar />
        <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-10">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
