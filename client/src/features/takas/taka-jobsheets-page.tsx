import { CheckCircle2, ClipboardCheck, PackageCheck, PenLine, Plus, SearchX } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { JOBSHEET_STATUS, jobsheetRef, TAKA_TABS, type TakaJobsheetItem, type TakaTab } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { FetchingIndicator, LoadMore, SearchBar } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ImageThumb } from '@/components/ui/image-thumb';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/lib/api';
import { Bi, bi } from '@/lib/bilingual';
import { cn } from '@/lib/utils';
import { FramesValue, machineNumbers } from '../jobsheets/parts';
import { useTakaJobsheets } from './api';

const TAB_LABEL: Record<TakaTab, { en: string; hi: string }> = {
  pending: { en: 'Taka pending', hi: 'टाका बाकी' },
  done: { en: 'Done', hi: 'हो गया' },
};

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

const isTab = (v: string | null): v is TakaTab => !!v && (TAKA_TABS as readonly string[]).includes(v);

function Fact({ en, hi, children }: { en: string; hi: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {en} <span lang="hi" className="normal-case tracking-normal">/ {hi}</span>
      </dt>
      <dd className="truncate text-[15px] font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/** "3 takas · 1 damage" (bilingual). */
function TakaCount({ js }: { js: TakaJobsheetItem }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-700">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-green-700">
        <PackageCheck className="size-4" aria-hidden />
        {js.takaCount} {js.takaCount === 1 ? 'taka' : 'takas'} · <span lang="hi">{js.takaCount} टाका</span>
      </span>
      {js.damagedCount > 0 && (
        <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">
          {js.damagedCount} damage · <span lang="hi">खराबी</span>
        </span>
      )}
    </p>
  );
}

function JobsheetTile({ js, tab, onOpen }: { js: TakaJobsheetItem; tab: TakaTab; onOpen: () => void }) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={bi(`Open ${jobsheetRef(js.orderNo, js.jobsheetNo)}`, `ऑर्डर #${js.orderNo} (${js.jobsheetNo}) खोलें`)}
      className="flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-white shadow-soft outline-none transition hover:border-primary/30 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          {/* The design as a small thumbnail; clicks inside the lightbox bubble through the portal — keep them from the card. */}
          <div className="shrink-0" onClick={js.thumbUrl ? (e) => e.stopPropagation() : undefined}>
            <ImageThumb thumbUrl={js.thumbUrl} fullUrl={js.imageUrl} alt={js.designCode ? `Design ${js.designCode}` : 'No design'} className="size-16" rounded="rounded-lg" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold leading-tight text-slate-900">
              <JobsheetRef orderNo={js.orderNo} jobsheetNo={js.jobsheetNo} />
            </p>
            <p className="truncate text-sm text-slate-500">{js.designCode ? `Design ${js.designCode}` : 'No design'}</p>
            <StatusBadge kind="jobsheet" status={js.status} className="mt-1.5 text-[13px]" />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          <Fact en="Frames" hi="फ्रेम">
            <FramesValue status={js.status} frames={js.frames} completedFrames={js.completedFrames} />
          </Fact>
          <Fact en="Machine" hi="मशीन">
            {(js.status === JOBSHEET_STATUS.ONGOING || js.status === JOBSHEET_STATUS.COMPLETED) && js.runningMachine
              ? `Machine ${js.runningMachine.machineNo}`
              : machineNumbers(js.machines)}
          </Fact>
        </dl>

        {js.takaCount > 0 && <TakaCount js={js} />}
      </div>

      <div className="border-t border-border p-3">
        <Button
          size="lg"
          variant={tab === 'done' ? 'secondary' : 'primary'}
          className="h-auto min-h-12 w-full py-1.5"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {tab === 'done' ? <Plus /> : <PenLine />}
          {tab === 'done' ? (
            <Bi en="Add more takas" hi="और टाका डालें" className="items-start" />
          ) : (
            <Bi en="Enter taka" hi="टाका डालें" className="items-start" />
          )}
        </Button>
      </div>
    </article>
  );
}

function GridSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border bg-white shadow-soft">
          <div className="space-y-3 p-4">
            <div className="flex gap-3">
              <Skeleton className="size-16 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-10" />
          </div>
          <div className="border-t border-border p-3">
            <Skeleton className="h-12 rounded-[10px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Message({ icon: Icon, en, hi, action, tone = 'primary' }: { icon: typeof SearchX; en: [string, string?]; hi: [string, string?]; action?: ReactNode; tone?: 'primary' | 'error' }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div
        className={cn(
          'mb-4 flex size-14 items-center justify-center rounded-2xl',
          tone === 'error' ? 'bg-destructive-soft text-destructive' : 'bg-primary-soft text-primary',
        )}
      >
        <Icon className="size-7" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{en[0]}</h3>
      <p lang="hi" className="font-semibold text-slate-700">
        {hi[0]}
      </p>
      {en[1] && (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {en[1]}
          {hi[1] && (
            <span lang="hi" className="block">
              {hi[1]}
            </span>
          )}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** `/jobsheets` for the Taka entry role: every jobsheet, split into Taka pending / Done. */
export default function TakaJobsheetsPage() {
  usePageTitle(bi('Jobsheets', 'जॉबशीट'));
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: TakaTab = isTab(params.get('tab')) ? (params.get('tab') as TakaTab) : 'pending';
  const [searchText, setSearchText] = useState(params.get('q') ?? '');
  const search = useDebounce(searchText, 300).trim();

  // Tab + search live in the URL so opening a jobsheet and coming back keeps them.
  useEffect(() => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (search) next.set('q', search);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [search, setParams]);
  const setTab = (t: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (t === 'pending') next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: true },
    );

  const query = useTakaJobsheets(tab, search);
  const { items, total, counts, isPending, isError, error, refetch } = query;
  const open = (js: TakaJobsheetItem) => navigate(`/jobsheets/${js.id}`);

  return (
    <div className="page-container space-y-4 pb-24 pt-4 md:py-5">
      <div className="flex items-center gap-2">
        <SearchBar
          value={searchText}
          onChange={setSearchText}
          placeholder={bi('Search order no, jobsheet no or design…', 'ऑर्डर, जॉबशीट नंबर या डिज़ाइन')}
          className="md:max-w-md"
        />
        <FetchingIndicator show={query.isFetching && !isPending && !query.isFetchingNextPage} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="md:max-w-md" aria-label={bi('Taka status', 'टाका स्थिति')}>
          {TAKA_TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="group flex min-h-14 items-center justify-center gap-2 px-2 text-[15px] font-semibold">
              <Bi en={TAB_LABEL[t].en} hi={TAB_LABEL[t].hi} className="items-center" />
              {counts && (
                <span className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-600 group-data-[state=active]:bg-primary-soft group-data-[state=active]:text-primary">
                  {counts[t]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isPending ? (
        <GridSkeleton />
      ) : isError ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          <Message
            icon={SearchX}
            tone="error"
            en={["Couldn't load the jobsheets", errorMessage(error)]}
            hi={['जॉबशीट लोड नहीं हो पाईं']}
            action={
              <Button variant="secondary" size="lg" onClick={() => void refetch()}>
                <Bi en="Try again" hi="फिर कोशिश करें" layout="inline" />
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-soft">
          {search ? (
            <Message
              icon={SearchX}
              en={['No jobsheets match your search', 'Try an order number, a jobsheet number or a design code.']}
              hi={['कोई जॉबशीट नहीं मिली', 'ऑर्डर नंबर, जॉबशीट नंबर या डिज़ाइन कोड लिखें।']}
              action={
                <Button variant="secondary" size="lg" onClick={() => setSearchText('')}>
                  <Bi en="Clear search" hi="खोज हटाएं" layout="inline" />
                </Button>
              }
            />
          ) : tab === 'pending' ? (
            <Message
              icon={CheckCircle2}
              en={['No takas pending', 'Every jobsheet has its takas entered.']}
              hi={['कोई टाका बाकी नहीं', 'सभी जॉबशीट के टाका डाल दिए गए हैं।']}
            />
          ) : (
            <Message
              icon={ClipboardCheck}
              en={['No takas entered yet', 'Jobsheets with takas appear here, newest first.']}
              hi={['अभी तक कोई टाका नहीं डाला', 'टाका वाली जॉबशीट यहाँ दिखेंगी।']}
            />
          )}
        </div>
      ) : (
        <>
          <ul className={cn(GRID, query.isPlaceholderData && 'opacity-60 transition-opacity')}>
            {items.map((js) => (
              <li key={js.id} className="min-w-0">
                <JobsheetTile js={js} tab={tab} onOpen={() => open(js)} />
              </li>
            ))}
          </ul>
          <LoadMore
            hasNextPage={!!query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            fetchNextPage={() => void query.fetchNextPage()}
            shown={items.length}
            total={total}
            noun="jobsheets / जॉबशीट"
            bilingual
          />
        </>
      )}
    </div>
  );
}
