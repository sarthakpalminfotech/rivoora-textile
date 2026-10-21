import { AlertTriangle, ArrowLeft, CheckCircle2, Info, List, Mic, Plus, ScanLine, SearchX } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  cleanMeters,
  cleanPcs,
  formatMeters,
  formatPcs,
  JOBSHEET_STATUS,
  jobsheetRef,
  METERS_ERROR_TEXT,
  parseMeters,
  parsePcs,
  PCS_ERROR_TEXT,
  SECTIONS_PER_BEAM,
  TAKA_ENTRY_DEFAULT_ROWS,
  totalMeters,
  totalPcs,
  type JobsheetDetail,
  type Taka,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Textarea } from '@/components/ui/input';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { ApiError, errorMessage } from '@/lib/api';
import { Bi, bi } from '@/lib/bilingual';
import { formatDateTime, formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useJobsheet } from '../jobsheets/api';
import { FramesValue, machineNumbers } from '../jobsheets/parts';
import { useEnterTakas, useNextTakaNumbers } from './api';
import { entryLabel, entryPayload, TakaDamageControl, type DamageEntry } from './damage-dialog';
import { TakaChip } from './taka-chip';
import { BlouseTag } from '../free-stock/blouse';

interface Row {
  key: number;
  /** Meters as typed (optional). */
  meters: string;
  /** Pcs as typed (required once the row has a number). */
  pcs: string;
  /** The user left the pcs field (its error shows from then on). */
  pcsTouched: boolean;
  /** Every damage of the taka (one or more; each with its damaged pcs). */
  damages: DamageEntry[];
}

let rowKey = 0;
const emptyRows = (n: number): Row[] =>
  Array.from({ length: n }, () => ({ key: ++rowKey, meters: '', pcs: '', pcsTouched: false, damages: [] }));

/** A row is in use as soon as something is typed in it (its number is system generated). */
const isUsed = (r: Row) => r.pcs !== '' || r.meters !== '' || r.damages.length > 0;

/** "3 takas · 203.75 m · 36 pcs" (English) for a list of takas / rows. */
function totalsLine(list: { meters?: number | null; pcs?: number | null }[]) {
  const m = totalMeters(list);
  const p = totalPcs(list);
  return [m !== null && formatMeters(m), p !== null && formatPcs(p)].filter(Boolean).join(' · ');
}

function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5', className)}>
      <h2 className="mb-3 text-[15px] font-bold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

/** 6.1 — the jobsheet at a glance, to match with the paper before typing. Order number first. */
function IdentityCard({ js }: { js: JobsheetDetail }) {
  const machine =
    js.runningMachine && js.status !== JOBSHEET_STATUS.PENDING && js.status !== JOBSHEET_STATUS.SENT
      ? `Machine ${js.runningMachine.machineNo}`
      : js.machines.length
        ? `Machine ${machineNumbers(js.machines)}`
        : null;
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft">
      <div className="flex items-start gap-4">
        <ImageThumb
          thumbUrl={js.design?.thumbUrl}
          fullUrl={js.design?.imageUrl}
          alt={js.design ? `Design ${js.design.code}` : 'No design'}
          className="size-24 shrink-0 md:size-28"
          rounded="rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">
            Order (jobsheet) / <span lang="hi">ऑर्डर (जॉबशीट)</span>
          </p>
          <h2 className="text-4xl font-extrabold leading-none tracking-tight text-slate-900 md:text-5xl">
            <JobsheetRef orderNo={js.orderNo} jobsheetNo={js.jobsheetNo} variant="short" bracketClassName="text-[0.55em] font-bold" />
          </h2>
          <p className="mt-2 truncate text-xl font-bold text-primary">{js.design?.code ?? 'No design'}</p>
          <BlouseTag option={js.blouseOption} hindi className="mt-1.5" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-sm text-slate-600">
        <StatusBadge kind="jobsheet" status={js.status} />
        <span className="font-semibold text-slate-800">
          <FramesValue status={js.status} frames={js.frames} completedFrames={js.completedFrames} withUnit />
        </span>
        {machine && <span>{machine}</span>}
      </div>
    </section>
  );
}

/** 6.6 — secondary details, below the entry. */
function DetailsCard({ js }: { js: JobsheetDetail }) {
  const item = (en: string, hi: string, value: ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">
        {en} / <span lang="hi">{hi}</span>
      </dt>
      <dd className="mt-0.5 break-words text-[15px] font-semibold text-slate-900">{value}</dd>
    </div>
  );
  return (
    <Section title={<Bi en="Jobsheet details" hi="जॉबशीट की जानकारी" layout="inline" />}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {item('Order', 'ऑर्डर', formatOrderNo(js.orderNo))}
          {item('Jobsheet', 'जॉबशीट', js.jobsheetNo)}
          {item('Frames', 'फ्रेम', <FramesValue status={js.status} frames={js.frames} completedFrames={js.completedFrames} withUnit />)}
          {item('Machines', 'मशीन', machineNumbers(js.machines))}
          {js.runningMachine && item('Made on', 'बनी मशीन', `Machine ${js.runningMachine.machineNo}`)}
          {js.startedAt && item('Started', 'शुरू', formatDateTime(js.startedAt))}
          {js.completedAt && item('Completed', 'पूरी', formatDateTime(js.completedAt))}
          {item('Design', 'डिज़ाइन', js.design?.code ?? '—')}
        </dl>
        {js.design && (
          <ImageThumb
            thumbUrl={js.design.thumbUrl}
            fullUrl={js.design.imageUrl}
            alt={`Design ${js.design.code}`}
            className="aspect-square w-full max-w-[220px]"
            rounded="rounded-xl"
          />
        )}
      </div>
    </Section>
  );
}

function SuccessView({ js, saved, autoCompleted, onAddMore }: { js: JobsheetDetail; saved: Taka[]; autoCompleted: boolean; onAddMore: () => void }) {
  const totals = totalsLine(saved);
  return (
    <div className="page-container max-w-xl py-8 text-center">
      <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-green-500 text-white shadow-pop animate-in zoom-in-50">
        <CheckCircle2 className="size-14" strokeWidth={2.5} aria-hidden />
      </div>
      <h2 className="mt-5 text-3xl font-extrabold text-green-700">Saved</h2>
      <p lang="hi" className="text-2xl font-bold text-green-700">
        सेव हो गया
      </p>
      <p className="mt-3 text-lg font-semibold text-slate-700">
        <JobsheetRef orderNo={js.orderNo} jobsheetNo={js.jobsheetNo} /> · {saved.length} {saved.length === 1 ? 'taka' : 'takas'} /{' '}
        <span lang="hi">{saved.length} टाका</span>
      </p>
      {totals && (
        <p className="text-base font-semibold text-slate-600">
          Total / <span lang="hi">कुल</span>: {totals}
        </p>
      )}
      <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label={bi('Saved takas', 'सेव हुए टाका')}>
        {saved.map((t) => (
          <TakaChip key={t.id} taka={t} size="lg" bilingual />
        ))}
      </ul>
      {autoCompleted && (
        <p className="mt-4 text-sm font-medium text-slate-500">
          Jobsheet marked Completed · <span lang="hi">जॉबशीट पूरी हो गई</span>
        </p>
      )}
      <div className="mt-8 space-y-3">
        <Button asChild size="lg" className="h-16 w-full text-lg">
          <Link to="/scan">
            <ScanLine className="!size-6" />
            <Bi en="Scan next" hi="अगला स्कैन करें" className="items-start" />
          </Link>
        </Button>
        <Button asChild variant="secondary" size="lg" className="h-14 w-full">
          <Link to="/jobsheets">
            <List />
            <Bi en="Back to list" hi="लिस्ट पर वापस" className="items-start" />
          </Link>
        </Button>
        <Button variant="ghost" size="lg" className="h-12 w-full" onClick={onAddMore}>
          <Plus />
          <Bi en="Add more to this jobsheet" hi="इसी जॉबशीट में और जोड़ें" layout="inline" />
        </Button>
      </div>
    </div>
  );
}

/** Small warning (English + Hindi): the pcs entered don't match what the frames should make. */
function PcsMismatchNote({ entered, expected, frames, className }: { entered: number; expected: number; frames: number; className?: string }) {
  return (
    <p
      className={cn('mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900', className)}
      role="status"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
      <span>
        Pcs entered: {entered}. Expected {expected} ({frames} frames × {SECTIONS_PER_BEAM}). Please check.
        <span lang="hi" className="block">
          दर्ज पीस: {entered}। अपेक्षित {expected} ({frames} फ्रेम × {SECTIONS_PER_BEAM})। कृपया जाँच लें।
        </span>
      </span>
    </p>
  );
}

const fieldBox = (invalid: boolean) =>
  cn(
    'h-14 w-full rounded-xl border bg-white tabular-nums text-slate-900 transition-colors placeholder:text-slate-300 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60',
    invalid ? 'border-destructive focus:ring-destructive/20' : 'border-input focus:border-primary focus:ring-primary/15',
  );

/** `/jobsheets/:id` for the Taka entry role: taka entry first, jobsheet details after. */
export default function TakaEntryPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data: js, isPending, isError, error, refetch } = useJobsheet(id);
  const enter = useEnterTakas(id);
  const [rows, setRows] = useState<Row[]>(() => emptyRows(TAKA_ENTRY_DEFAULT_ROWS));
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<{ key: number; field: 'pcs' | 'damages' | 'other'; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saved, setSaved] = useState<{ takas: Taka[]; autoCompleted: boolean } | null>(null);
  /** The taka number field that has focus (its – / helper keys are shown). */
  const [showAllErrors, setShowAllErrors] = useState(false);
  const meterInputs = useRef(new Map<number, HTMLInputElement>());
  const pcsInputs = useRef(new Map<number, HTMLInputElement>());
  const existing = useMemo(() => js?.takas ?? [], [js]);
  usePageTitle(
    js ? bi(jobsheetRef(js.orderNo, js.jobsheetNo), `ऑर्डर #${js.orderNo} (${js.jobsheetNo})`) : bi('Taka entry', 'टाका एंट्री'),
  );

  // Taka numbers are system generated (auto incremental, from 11). Shown before saving; confirmed on save.
  const nextNumbers = useNextTakaNumbers(rows.length);
  const meterErrors = useMemo(() => rows.map((r) => parseMeters(r.meters).error), [rows]);
  // Pcs are required on every row that is in use.
  const pcsErrors = useMemo(() => rows.map((r) => (isUsed(r) ? parsePcs(r.pcs).error : null)), [rows]);
  const filled = rows.filter(isUsed);
  // The numbers follow the order the rows are saved in: used rows first, then the free ones.
  const numberOf = useMemo(() => {
    const map = new Map<number, string>();
    let used = 0;
    let free = filled.length;
    for (const r of rows) {
      const no = nextNumbers.data?.numbers[isUsed(r) ? used++ : free++];
      if (no) map.set(r.key, no);
    }
    return map;
  }, [rows, filled.length, nextNumbers.data]);
  const canSubmit = filled.length > 0 && meterErrors.every((e) => e === null) && !!nextNumbers.data;
  // Expected pcs for the frames of this jobsheet (frames × sections per beam) vs. everything entered.
  const expectedPcs = js ? (js.completedFrames ?? js.frames) * SECTIONS_PER_BEAM : 0;
  const enteredPcs = (totalPcs(existing) ?? 0) + (totalPcs(filled.map((r) => ({ pcs: parsePcs(r.pcs).pcs }))) ?? 0);
  const pcsMismatch = filled.some((r) => parsePcs(r.pcs).pcs !== null) && enteredPcs !== expectedPcs;

  const back = (
    <button
      type="button"
      onClick={() => navigate('/jobsheets')}
      className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary"
    >
      <ArrowLeft className="size-4" /> Jobsheets / <span lang="hi">जॉबशीट</span>
    </button>
  );

  if (isPending) {
    return (
      <div className="page-container max-w-2xl space-y-4 py-4">
        {back}
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (isError || !js) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page-container max-w-2xl py-4">
        {back}
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive-soft text-destructive">
            {notFound ? <SearchX className="size-7" aria-hidden /> : <AlertTriangle className="size-7" aria-hidden />}
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{notFound ? 'Jobsheet not found' : "Couldn't load this jobsheet"}</h2>
          <p lang="hi" className="font-semibold text-slate-700">
            {notFound ? 'जॉबशीट नहीं मिली' : 'जॉबशीट लोड नहीं हो पाई'}
          </p>
          {!notFound && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{errorMessage(error)}</p>}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {!notFound && (
              <Button variant="secondary" size="lg" onClick={() => void refetch()}>
                <Bi en="Try again" hi="फिर कोशिश करें" layout="inline" />
              </Button>
            )}
            <Button asChild size="lg">
              <Link to="/scan">
                <ScanLine />
                <Bi en="Scan jobsheet" hi="जॉबशीट स्कैन करें" layout="inline" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (saved) {
    return (
      <SuccessView
        js={js}
        saved={saved.takas}
        autoCompleted={saved.autoCompleted}
        onAddMore={() => {
          setSaved(null);
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }

  const isCompleted = js.status === JOBSHEET_STATUS.COMPLETED;
  const setRow = (key: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (serverError?.key === key) setServerError(null);
  };
  const addRow = () => {
    const [row] = emptyRows(1);
    setRows((prev) => [...prev, row]);
    // Focus the new field once it has rendered.
    window.setTimeout(() => pcsInputs.current.get(row.key)?.focus(), 0);
  };
  const focusNext = (index: number) => {
    const next = rows[index + 1];
    if (next) pcsInputs.current.get(next.key)?.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  };

  const trySubmit = () => {
    // Missing pcs: show every pcs error and go to the first one.
    const firstPcs = pcsErrors.findIndex((e) => e !== null);
    if (firstPcs >= 0) {
      setShowAllErrors(true);
      pcsInputs.current.get(rows[firstPcs].key)?.focus();
      return;
    }
    setConfirmOpen(true);
  };

  const submit = () => {
    const toSave = filled.map((r) => ({
      meters: parseMeters(r.meters).meters,
      pcs: parsePcs(r.pcs).pcs!,
      damages: r.damages.map(entryPayload),
    }));
    enter.mutate(
      { takas: toSave, note: note.trim() || null },
      {
        onSuccess: (res) => {
          setConfirmOpen(false);
          setSaved({ takas: res.added, autoCompleted: res.autoCompleted });
          setRows(emptyRows(TAKA_ENTRY_DEFAULT_ROWS));
          setNote('');
          setShowAllErrors(false);
          toast.success(bi('Saved', 'सेव हो गया'));
          window.scrollTo({ top: 0 });
        },
        onError: (err) => {
          setConfirmOpen(false);
          // `takas.3.takaNo` / `takas.3.pcs` / `takas.3.damages.0.pcs` → the 4th filled row.
          const m = err instanceof ApiError && err.field ? /^takas\.(\d+)\.(\w+)/.exec(err.field) : null;
          const row = m ? filled[Number(m[1])] : undefined;
          if (row) {
            const field = m![2] === 'pcs' || m![2] === 'damages' ? m![2] : 'other';
            setServerError({ key: row.key, field, message: err.message });
            pcsInputs.current.get(row.key)?.focus();
          }
        },
      },
    );
  };

  const filledTotals = totalsLine(filled.map((r) => ({ meters: parseMeters(r.meters).meters, pcs: parsePcs(r.pcs).pcs })));

  return (
    <div className="page-container max-w-2xl space-y-4 pt-3 md:pt-5">
      {back}
      <IdentityCard js={js} />

      {!isCompleted && (
        <p className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[15px] text-sky-900" role="note">
          <Info className="mt-0.5 size-5 shrink-0 text-sky-500" aria-hidden />
          <span>
            This jobsheet will be marked Completed when you submit.
            <span lang="hi" className="block font-medium">
              जमा करने पर यह जॉबशीट पूरी मानी जाएगी।
            </span>
          </span>
        </p>
      )}

      {existing.length > 0 && (
        <Section
          title={
            <span className="flex flex-wrap items-center justify-between gap-2">
              <Bi en="Already entered" hi="पहले से डाले गए" layout="inline" />
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-bold text-slate-600">
                {existing.length}
                {totalsLine(existing) && ` · ${totalsLine(existing)}`}
              </span>
            </span>
          }
        >
          <ul className="flex flex-wrap gap-2">
            {existing.map((t) => (
              <TakaChip key={t.id} taka={t} size="lg" bilingual />
            ))}
          </ul>
        </Section>
      )}

      <Section title={<Bi en="New takas" hi="नए टाका" layout="inline" />}>
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const no = numberOf.get(r.key);
            const meterErr = meterErrors[i];
            const pcsErr = pcsErrors[i];
            const server = serverError?.key === r.key ? serverError : null;
            const showPcsErr = !!pcsErr && (r.pcsTouched || showAllErrors);
            const pcsMessage = server?.field === 'pcs' ? server.message : null;
            const otherMessage = server && server.field !== 'pcs' ? server.message : null;
            const metersId = `taka-${r.key}-m`;
            const pcsId = `taka-${r.key}-p`;
            return (
              <li
                key={r.key}
                className={cn('-mx-2 rounded-xl px-2 py-1.5 transition-colors', r.damages.length > 0 && 'bg-red-50 ring-1 ring-red-200')}
              >
                {/* Phones: number on its own line, then pcs + meters side by side, then Damage. md+: one row. */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 md:grid-cols-[minmax(0,1fr)_96px_112px_156px]">
                  <span className="col-span-2 text-sm font-semibold text-slate-600 md:col-span-1 md:row-start-1">
                    Taka number / <span lang="hi">टाका नंबर</span>
                  </span>
                  <div
                    className={cn(
                      fieldBox(false),
                      'col-span-2 flex items-center bg-slate-50 px-4 text-[24px] font-bold tracking-wide md:col-span-1 md:row-start-2',
                    )}
                    aria-label={bi(`Taka number ${no ?? ''}`, `टाका नंबर ${no ?? ''}`)}
                  >
                    {no ?? '…'}
                  </div>
                  <label htmlFor={pcsId} className="mt-1 text-sm font-semibold text-slate-600 md:row-start-1 md:mt-0">
                    Pcs / <span lang="hi">पीस</span>
                    <span className="text-destructive">*</span>
                  </label>
                  <label htmlFor={metersId} className="mt-1 text-sm font-semibold text-slate-600 md:row-start-1 md:mt-0">
                    Meters / <span lang="hi">मीटर</span>
                  </label>
                  <input
                    ref={(el) => {
                      if (el) pcsInputs.current.set(r.key, el);
                      else pcsInputs.current.delete(r.key);
                    }}
                    id={pcsId}
                    value={r.pcs}
                    onChange={(e) => setRow(r.key, { pcs: cleanPcs(e.target.value) })}
                    onBlur={() => isUsed(r) && !r.pcsTouched && setRow(r.key, { pcsTouched: true })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        meterInputs.current.get(r.key)?.focus();
                      }
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="next"
                    aria-required
                    aria-invalid={showPcsErr || !!pcsMessage || undefined}
                    aria-describedby={showPcsErr || pcsMessage ? `${pcsId}-err` : undefined}
                    className={cn(fieldBox(showPcsErr || !!pcsMessage), 'self-start px-3 text-[20px] font-bold md:row-start-2')}
                    placeholder="0"
                  />
                  <div className="relative self-start md:row-start-2">
                    <input
                      ref={(el) => {
                        if (el) meterInputs.current.set(r.key, el);
                        else meterInputs.current.delete(r.key);
                      }}
                      id={metersId}
                      value={r.meters}
                      onChange={(e) => setRow(r.key, { meters: cleanMeters(e.target.value) })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          focusNext(i);
                        }
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      enterKeyHint={i === rows.length - 1 ? 'done' : 'next'}
                      aria-invalid={!!meterErr || undefined}
                      aria-describedby={meterErr ? `${metersId}-err` : undefined}
                      className={cn(fieldBox(!!meterErr), 'pl-3 pr-7 text-[20px] font-bold')}
                      placeholder="0.0"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base font-semibold text-slate-400" aria-hidden>
                      m
                    </span>
                  </div>
                  <TakaDamageControl
                    entries={r.damages}
                    onChange={(damages) => setRow(r.key, { damages })}
                    takaLabel={bi(`Taka ${no ?? ''}`, `टाका ${no ?? ''}`)}
                    takaPcs={parsePcs(r.pcs).pcs}
                    disabled={parsePcs(r.pcs).error !== null}
                    className="col-span-2 mt-1 md:col-span-1 md:row-start-2 md:mt-0"
                  />
                </div>
                {otherMessage && (
                  <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
                    {otherMessage}
                  </p>
                )}
                {meterErr && (
                  <p id={`${metersId}-err`} role="alert" className="mt-1 text-sm font-semibold text-destructive">
                    {METERS_ERROR_TEXT[meterErr].en} / <span lang="hi">{METERS_ERROR_TEXT[meterErr].hi}</span>
                  </p>
                )}
                {(showPcsErr || pcsMessage) && (
                  <p id={`${pcsId}-err`} role="alert" className="mt-1 text-sm font-semibold text-destructive">
                    {pcsMessage ?? (
                      <>
                        {PCS_ERROR_TEXT[pcsErr!].en} / <span lang="hi">{PCS_ERROR_TEXT[pcsErr!].hi}</span>
                      </>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <Button variant="secondary" size="lg" className="mt-4 h-14 w-full border-dashed text-base" onClick={addRow}>
          <Plus className="!size-5" />
          <Bi en="Add more" hi="और जोड़ें" layout="inline" />
        </Button>
        {pcsMismatch && <PcsMismatchNote entered={enteredPcs} expected={expectedPcs} frames={js.completedFrames ?? js.frames} />}
      </Section>

      <Section title={<Bi en="Note" hi="नोट" layout="inline" />}>
        {js.takaNote && (
          <div className="mb-3 rounded-xl bg-slate-50 px-3.5 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Saved note / <span lang="hi">सेव नोट</span>
            </p>
            <p className="whitespace-pre-line text-[15px] text-slate-700">{js.takaNote}</p>
          </div>
        )}
        <div className="flex items-start gap-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder={js.takaNote ? bi('Add to the note…', 'नोट में जोड़ें…') : bi('Note (optional)', 'नोट (ज़रूरी नहीं)')}
            aria-label={bi('Note', 'नोट')}
            className="min-h-[88px] flex-1 text-base"
          />
          <Tooltip content={bi('Coming soon', 'जल्द आ रहा है')}>
            <button
              type="button"
              aria-disabled="true"
              aria-label={bi('Voice note (coming soon)', 'आवाज़ नोट (जल्द आ रहा है)')}
              className="flex size-12 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 text-slate-300"
            >
              <Mic className="size-6" />
            </button>
          </Tooltip>
        </div>
      </Section>

      {/* Sticky submit: above the phone bottom nav, at the bottom of the window on md+. */}
      <div className="kb-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-t-2xl lg:border-x">
        <Button size="lg" className="h-14 w-full text-lg" disabled={!canSubmit} onClick={trySubmit}>
          <Bi en={filled.length ? `Submit (${filled.length})` : 'Submit'} hi="जमा करें" className="items-center" />
        </Button>
      </div>

      <DetailsCard js={js} />

      <ResponsiveModal
        open={confirmOpen}
        onOpenChange={(o) => !enter.isPending && setConfirmOpen(o)}
        title={bi('Save these takas?', 'ये टाका जमा करें?')}
        desktopVariant="center"
        mobileVariant="bottom"
        size="md"
        dismissible={!enter.isPending}
        footer={
          <div className="grid w-full grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" className="h-14" onClick={() => setConfirmOpen(false)} disabled={enter.isPending}>
              <Bi en="Cancel" hi="रद्द करें" className="items-center" />
            </Button>
            <Button size="lg" className="h-14" onClick={submit} loading={enter.isPending}>
              <Bi en="Submit" hi="जमा करें" className="items-center" />
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-[15px] font-semibold text-slate-600">
          <JobsheetRef orderNo={js.orderNo} jobsheetNo={js.jobsheetNo} /> · {filled.length} {filled.length === 1 ? 'taka' : 'takas'} /{' '}
          <span lang="hi">{filled.length} टाका</span>
          {filledTotals && ` · ${filledTotals}`}
        </p>
        {pcsMismatch && <PcsMismatchNote entered={enteredPcs} expected={expectedPcs} frames={js.completedFrames ?? js.frames} className="mb-3 mt-0" />}
        <ul className="divide-y divide-border rounded-xl border border-border">
          {filled.map((r) => {
            const meters = parseMeters(r.meters).meters;
            const pcs = parsePcs(r.pcs).pcs;
            return (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
                <span className={cn('text-2xl font-bold tabular-nums', r.damages.length ? 'text-red-600' : 'text-slate-900')}>
                  {numberOf.get(r.key)}
                  {meters !== null && <span className="ml-2 text-lg font-semibold text-slate-500">{formatMeters(meters)}</span>}
                  {pcs !== null && <span className="ml-2 text-lg font-semibold text-slate-500">· {formatPcs(pcs)}</span>}
                </span>
                {r.damages.length > 0 && (
                  <ul className="basis-full space-y-0.5">
                    {r.damages.map((d) => (
                      <li key={d.key} className="flex min-w-0 items-center gap-1 text-base font-bold text-red-600">
                        <AlertTriangle className="size-5 shrink-0" aria-hidden />
                        <span className="truncate">{entryLabel(d)}</span>
                        <span lang="hi" className="shrink-0 text-sm">
                          / खराबी
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {note.trim() && (
          <div className="mt-3 rounded-xl bg-slate-50 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Note / <span lang="hi">नोट</span>
            </p>
            <p className="whitespace-pre-line text-base text-slate-700">{note.trim()}</p>
          </div>
        )}
        {!isCompleted && (
          <p className="mt-3 text-sm text-slate-500">
            The jobsheet will be marked Completed. <span lang="hi">जॉबशीट पूरी मानी जाएगी।</span>
          </p>
        )}
      </ResponsiveModal>
    </div>
  );
}
