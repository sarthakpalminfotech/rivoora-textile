import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CHALLAN_KIND_CONFIG, type ChallanFilter, type ChallanKind } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { SearchBar } from '@/components/list-parts';
import { Segmented } from '@/components/ui/segmented';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { useKindCounts } from './api';
import { ChallanList } from './challan-cards';
import { ReceiveTakaNumber } from './receive-screen';
import { SendPending } from './send-pending';

type Tab = 'send' | 'receive';
type SendSub = 'pending' | 'sent';
type ReceiveSub = 'taka' | 'challans';

const FILTERS: { key: ChallanFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'received', label: 'Fully received' },
  { key: 'all', label: 'All' },
];

/** A small taka-count pill for the Send sub-tabs (neutral, so it reads on both the idle and the selected tab). */
function CountPill({ n }: { n: number | undefined }) {
  if (n === undefined) return null;
  return <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-black/10 px-1.5 text-xs font-bold tabular-nums">{n.toLocaleString('en-IN')}</span>;
}

/**
 * Butta cutting and Mill module (Jemish, Gaurang, Godown supervisor): the SAME screens, parameterised by the challan
 * kind. Two top tabs, kept in the URL: Send (Pending · In butta cutting / In mill, with taka counts) and Receive
 * (Taka number · Challans). Tablet-first with 48px tap targets.
 */
export default function ChallanModulePage({ kind }: { kind: ChallanKind }) {
  const cfg = CHALLAN_KIND_CONFIG[kind];
  usePageTitle(cfg.label);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'receive' ? 'receive' : 'send';
  const sendSub: SendSub = params.get('sub') === 'sent' ? 'sent' : 'pending';
  const receiveSub: ReceiveSub = params.get('sub') === 'challans' ? 'challans' : 'taka';
  const sub = tab === 'send' ? sendSub : receiveSub;
  const filterParam = params.get('filter');
  const filter: ChallanFilter = filterParam === 'received' || filterParam === 'all' ? filterParam : 'open';
  const counts = useKindCounts(kind);

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

  const showSearch = tab === 'send' || (tab === 'receive' && receiveSub === 'challans');
  const from = `${cfg.route}?${params.toString()}`;

  const sendOptions = [
    {
      value: 'pending',
      label: (
        <>
          Pending
          <CountPill n={counts.data?.pending} />
        </>
      ),
    },
    {
      value: 'sent',
      label: (
        <>
          {cfg.inLabel}
          <CountPill n={counts.data?.inKind} />
        </>
      ),
    },
  ] as const;

  return (
    <div className="page-container space-y-4 pb-28 pt-4 md:py-5">
      <Segmented
        options={[
          { value: 'send', label: 'Send' },
          { value: 'receive', label: 'Receive' },
        ]}
        value={tab}
        onChange={(t) => update({ tab: t, sub: null, filter: null })}
        size="lg"
        aria-label={cfg.label}
        className="w-full"
      />
      <div className="space-y-3">
        <Segmented
          options={
            tab === 'send'
              ? [...sendOptions]
              : [
                  { value: 'taka', label: 'Taka number' },
                  { value: 'challans', label: 'Challans' },
                ]
          }
          value={sub}
          onChange={(s) => update({ sub: s, filter: null })}
          size="lg"
          aria-label={tab === 'send' ? 'Send' : 'Receive'}
          className="w-full"
        />
        {tab === 'send' && sendSub === 'sent' && (
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

      {tab === 'send' && sendSub === 'pending' && <SendPending key={`${kind}-pending`} kind={kind} search={search} />}
      {tab === 'send' && sendSub === 'sent' && <ChallanList key={`${kind}-sent-${filter}`} kind={kind} filter={filter} search={search} from={from} />}
      {tab === 'receive' && receiveSub === 'taka' && <ReceiveTakaNumber key={`${kind}-receive`} kind={kind} />}
      {tab === 'receive' && receiveSub === 'challans' && <ChallanList key={`${kind}-receive-list`} kind={kind} filter="open" search={search} live from={from} />}
    </div>
  );
}
