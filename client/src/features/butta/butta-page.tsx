import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChallanFilter } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { SearchBar } from '@/components/list-parts';
import { Segmented } from '@/components/ui/segmented';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { ChallanList } from './challan-cards';
import { ReceiveTakaNumber } from './receive-screen';
import { SendPending } from './send-pending';

type Tab = 'send' | 'receive';
type SendSub = 'pending' | 'in-butta';
type ReceiveSub = 'taka' | 'challans';

const TAB_OPTIONS = [
  { value: 'send', label: 'Send' },
  { value: 'receive', label: 'Receive' },
] as const;
const SEND_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in-butta', label: 'In butta cutting' },
] as const;
const RECEIVE_OPTIONS = [
  { value: 'taka', label: 'Taka number' },
  { value: 'challans', label: 'Challans' },
] as const;
const FILTERS: { key: ChallanFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'received', label: 'Fully received' },
  { key: 'all', label: 'All' },
];

/**
 * Butta cutting module (Jemish, Gaurang, Godown supervisor). Two top tabs, kept in the URL: Send (Pending · In butta
 * cutting) and Receive (Taka number · Challans). Tablet-first with 48px tap targets.
 */
export default function ButtaPage() {
  usePageTitle('Butta cutting');
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'receive' ? 'receive' : 'send';
  const sendSub: SendSub = params.get('sub') === 'in-butta' ? 'in-butta' : 'pending';
  const receiveSub: ReceiveSub = params.get('sub') === 'challans' ? 'challans' : 'taka';
  const sub = tab === 'send' ? sendSub : receiveSub;
  const filterParam = params.get('filter');
  const filter: ChallanFilter = filterParam === 'received' || filterParam === 'all' ? filterParam : 'open';

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText, 300).trim();
  // Each list has its own search.
  useEffect(() => setSearchText(''), [tab, sub]);

  const showSearch = (tab === 'send') || (tab === 'receive' && receiveSub === 'challans');
  const from = `/butta?${params.toString()}`;

  return (
    <div className="page-container space-y-4 pb-28 pt-4 md:py-5">
      <Segmented
        options={[...TAB_OPTIONS]}
        value={tab}
        onChange={(t) => update({ tab: t, sub: null, filter: null })}
        size="lg"
        aria-label="Butta cutting"
        className="w-full"
      />
      <div className="space-y-3">
        <Segmented
          options={tab === 'send' ? [...SEND_OPTIONS] : [...RECEIVE_OPTIONS]}
          value={sub}
          onChange={(s) => update({ sub: s, filter: null })}
          size="lg"
          aria-label={tab === 'send' ? 'Send' : 'Receive'}
          className="w-full"
        />
        {tab === 'send' && sendSub === 'in-butta' && (
          <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 scrollbar-none" role="group" aria-label="Challan filter">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => update({ filter: f.key === 'open' ? null : f.key })}
                aria-pressed={filter === f.key}
                className={cn(
                  'min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors',
                  filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-white text-slate-600 hover:bg-muted',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {showSearch && (
        <SearchBar
          value={searchText}
          onChange={setSearchText}
          placeholder={
            tab === 'send' && sendSub === 'pending' ? 'Search by order no, design code or taka no…' : 'Search by challan no, party, order no or taka no…'
          }
        />
      )}

      {tab === 'send' && sendSub === 'pending' && <SendPending key="pending" search={search} />}
      {tab === 'send' && sendSub === 'in-butta' && <ChallanList key={`butta-${filter}`} filter={filter} search={search} from={from} />}
      {tab === 'receive' && receiveSub === 'taka' && <ReceiveTakaNumber />}
      {tab === 'receive' && receiveSub === 'challans' && <ChallanList key="receive" filter="open" search={search} live from={from} />}
    </div>
  );
}
