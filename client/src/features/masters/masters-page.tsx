import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { mastersFor } from '@/components/layout/nav-items';
import { usePageTitle } from '@/components/layout/page-title';
import { useRole } from '@/hooks/useRole';

const DESCRIPTIONS: Record<string, string> = {
  '/customers': 'Clients and their brokers',
  '/materials': 'Cloth materials',
  '/designs': 'Designs and variations',
  '/machines': 'Looms and their status',
  '/damages': 'Damage names used on takas',
  '/butta-parties': 'Butta cutting parties',
  '/mill-parties': 'Mill (dyeing) parties',
  '/weavers': 'Outside weavers',
  '/yarn-parties': 'Parties yarn is bought from',
  '/yarn-qualities': 'Raw and twisted yarn qualities',
  '/tfo-machines': 'TFO machines (sections A / B)',
  '/users': 'People who can log in',
};

/** One page that lists every master the role may open. */
export default function MastersPage() {
  usePageTitle('Masters');
  const { can } = useRole();
  const items = mastersFor(can);

  return (
    <div className="page-container space-y-4 pb-24 pt-5 lg:pb-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-4 rounded-2xl border border-border bg-white p-4 shadow-card transition-colors hover:bg-muted"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Icon className="size-6" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold text-slate-900">{label}</span>
              {DESCRIPTIONS[to] && <span className="block truncate text-sm text-slate-500">{DESCRIPTIONS[to]}</span>}
            </span>
            <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}
