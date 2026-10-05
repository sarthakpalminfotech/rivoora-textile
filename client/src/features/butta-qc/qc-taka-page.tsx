import { AlertTriangle, ArrowLeft, CheckCircle2, Plus, SearchX, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  challanLabel,
  cleanMeters,
  cleanPcs,
  damageLabelOf,
  damageResolvedText,
  formatMeters,
  METERS_ERROR_TEXT,
  parseMeters,
  parsePcs,
  PCS_ERROR_TEXT,
  validateQcDecisions,
  type TakaDetail,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ImageThumb } from '@/components/ui/image-thumb';
import { JobsheetRef } from '@/components/ui/jobsheet-ref';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { Bi, bi } from '@/lib/bilingual';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSubmitQc, useTakaByNo } from '../butta/api';
import { DamageDialog, entryLabel, entryPayload, nextEntryKey, type DamageEntry } from '../takas/damage-dialog';
import { FreshTag } from '../takas/taka-chip';

type Decision = 'resolved' | 'kept';

const fieldBox = (invalid: boolean) =>
  cn(
    'h-14 w-full rounded-xl border bg-white tabular-nums text-slate-900 transition-colors placeholder:text-slate-300 focus:outline-none focus:ring-2',
    invalid ? 'border-destructive focus:ring-destructive/20' : 'border-input focus:border-primary focus:ring-primary/15',
  );

function Section({ title, children, className }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5', className)}>
      {title && <h2 className="mb-3 text-[15px] font-bold text-slate-800">{title}</h2>}
      {children}
    </section>
  );
}

/** 1 — the taka at a glance (the QC action comes right after it). */
function IdentityCard({ taka }: { taka: TakaDetail }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-soft">
      <div className="flex items-start gap-4">
        <ImageThumb
          thumbUrl={taka.design.thumbUrl}
          fullUrl={taka.design.imageUrl}
          alt={taka.design.code ? `Design ${taka.design.code}` : 'No design'}
          className="size-24 shrink-0 md:size-28"
          rounded="rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">
            Taka / <span lang="hi">टाका</span>
          </p>
          <h2 className="break-all text-5xl font-extrabold leading-none tracking-tight text-slate-900 md:text-6xl">{taka.takaNo}</h2>
          <p className="mt-2 text-lg font-bold text-primary">
            <JobsheetRef orderNo={taka.orderNo} jobsheetNo={taka.jobsheetNo} variant="short" bracketClassName="text-[0.7em] font-bold" />
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-sm text-slate-600">
        <span className="font-semibold text-slate-800">{taka.design.code ?? 'No design'}</span>
        {taka.quality && <span>{taka.quality}</span>}
        {taka.challan && <span className="font-semibold text-amber-700">{challanLabel(taka.challan.challanNo)}</span>}
      </div>
    </section>
  );
}



/** Read-only summary of a taka that is already checked (or never went for butta cutting). */
function ReadOnlySummary({ taka }: { taka: TakaDetail }) {
  const checked = !!taka.challan;
  return (
    <div className="page-container max-w-2xl space-y-4 pt-3 md:pt-5">
      <IdentityCard taka={taka} />
      <p className="flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[15px] font-semibold text-green-800" role="status">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          {checked ? 'Already checked' : 'This taka did not go for butta cutting'}
          <span lang="hi" className="block">
            {checked ? 'पहले से जांचा गया' : 'यह टाका बुट्टा कटिंग के लिए नहीं गया'}
          </span>
        </span>
      </p>
      <Section title={<Bi en="Summary" hi="सारांश" layout="inline" />}>
        <dl className="grid grid-cols-2 gap-3 text-[15px]">
          <div>
            <dt className="text-[13px] text-muted-foreground">Meters / मीटर</dt>
            <dd className="font-bold text-slate-900">{taka.meters != null ? formatMeters(taka.meters) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Pcs / पीस</dt>
            <dd className="font-bold text-slate-900">{taka.pcs ?? '—'}</dd>
          </div>
          {taka.challan?.receivedAt && (
            <div className="col-span-2">
              <dt className="text-[13px] text-muted-foreground">Received / वापस आया</dt>
              <dd className="font-semibold text-slate-900">{formatDateTime(taka.challan.receivedAt)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-3">
          {taka.damages.length === 0 ? (
            <FreshTag bilingual />
          ) : (
            <ul className="space-y-1.5">
              {taka.damages.map((d) => {
                const r = damageResolvedText(d);
                return (
                  <li
                    key={d.id}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-[15px] font-semibold',
                      r ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-red-200 bg-red-50 text-red-700',
                    )}
                  >
                    <span className={cn(r && 'line-through')}>{damageLabelOf(d)}</span>
                    {r && <span className="ml-2 text-xs font-medium">· {r}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>
      <Button asChild size="lg" className="h-14 w-full">
        <Link to="/butta-qc">
          <Bi en="Next taka" hi="अगला टाका" className="items-center" />
        </Link>
      </Button>
    </div>
  );
}

function QcForm({ taka }: { taka: TakaDetail }) {
  const navigate = useNavigate();
  const submitQc = useSubmitQc(taka.id);
  const open = useMemo(() => taka.damages.filter((d) => d.status === 'open'), [taka]);
  const [meters, setMeters] = useState(taka.meters != null ? String(taka.meters) : '');
  const [pcs, setPcs] = useState(taka.pcs != null ? String(taka.pcs) : '');
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map());
  const [damagePcs, setDamagePcs] = useState<Map<number, string>>(new Map());
  const [added, setAdded] = useState<DamageEntry[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const metersParsed = parseMeters(meters);
  const pcsParsed = parsePcs(pcs);
  const takaPcs = pcsParsed.pcs ?? taka.pcs ?? null;
  // The pcs typed for an older damage that never had a count.
  const typedPcs = (id: number) => {
    const raw = damagePcs.get(id) ?? '';
    return /^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : null;
  };
  const issues = validateQcDecisions(
    open.map((d) => ({ id: d.id, pcs: d.pcs })),
    open.flatMap((d) => (decisions.has(d.id) ? [{ takaDamageId: d.id, resolved: decisions.get(d.id) === 'resolved', pcs: typedPcs(d.id) }] : [])),
    takaPcs ?? 9999,
  );
  const newTooBig = added.some((e) => takaPcs !== null && (e.pcs ?? 0) > takaPcs);
  const canSubmit = metersParsed.error === null && pcsParsed.error === null && issues.ok && !newTooBig;

  const trySubmit = () => {
    setShowErrors(true);
    if (!canSubmit) return;
    setConfirmOpen(true);
  };

  const submit = () => {
    submitQc.mutate(
      {
        meters: metersParsed.meters,
        pcs: pcsParsed.pcs!,
        damageDecisions: open.map((d) => ({ takaDamageId: d.id, resolved: decisions.get(d.id) === 'resolved', pcs: d.pcs === null ? typedPcs(d.id) : null })),
        newDamages: added.map(entryPayload),
      },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          toast.success(bi('Saved', 'सेव हो गया'));
          navigate('/butta-qc', { replace: true });
        },
        onError: (err) => {
          setConfirmOpen(false);
          setServerError(err instanceof ApiError ? err.message : 'Something went wrong');
        },
      },
    );
  };

  const resolvedN = open.filter((d) => decisions.get(d.id) === 'resolved').length;
  const keptN = open.filter((d) => decisions.get(d.id) === 'kept').length;
  const metersChanged = (metersParsed.meters ?? null) !== taka.meters;
  const pcsChanged = pcsParsed.pcs !== null && pcsParsed.pcs !== taka.pcs;

  return (
    <div className="page-container max-w-2xl space-y-4 pt-3 md:pt-5">
      <button
        type="button"
        onClick={() => navigate('/butta-qc')}
        className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary"
      >
        <ArrowLeft className="size-4" /> Butta QC / <span lang="hi">बुट्टा QC</span>
      </button>
      <IdentityCard taka={taka} />

      {/* 2 — meters and pcs, prefilled */}
      <Section title={<Bi en="Meters and pcs" hi="मीटर और पीस" layout="inline" />}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="qc-meters" className="mb-1 block text-sm font-semibold text-slate-600">
              Meters / <span lang="hi">मीटर</span>
            </label>
            <div className="relative">
              <input
                id="qc-meters"
                value={meters}
                onChange={(e) => setMeters(cleanMeters(e.target.value))}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={!!metersParsed.error || undefined}
                className={cn(fieldBox(!!metersParsed.error), 'pl-3 pr-8 text-[22px] font-bold')}
                placeholder="0.0"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base font-semibold text-slate-400" aria-hidden>
                m
              </span>
            </div>
            {metersParsed.error && (
              <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
                {METERS_ERROR_TEXT[metersParsed.error].en} / <span lang="hi">{METERS_ERROR_TEXT[metersParsed.error].hi}</span>
              </p>
            )}
          </div>
          <div>
            <label htmlFor="qc-pcs" className="mb-1 block text-sm font-semibold text-slate-600">
              Pcs / <span lang="hi">पीस</span>
              <span className="text-destructive">*</span>
            </label>
            <input
              id="qc-pcs"
              value={pcs}
              onChange={(e) => setPcs(cleanPcs(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={(showErrors && !!pcsParsed.error) || undefined}
              className={cn(fieldBox(showErrors && !!pcsParsed.error), 'px-3 text-[22px] font-bold')}
              placeholder="0"
            />
            {showErrors && pcsParsed.error && (
              <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
                {PCS_ERROR_TEXT[pcsParsed.error].en} / <span lang="hi">{PCS_ERROR_TEXT[pcsParsed.error].hi}</span>
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* 3 — open damages: every one needs an answer */}
      {open.length > 0 && (
        <section className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 shadow-soft md:p-5" aria-label={bi('Damaged taka', 'खराब टाका')}>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-red-700">
            <AlertTriangle className="size-6 shrink-0" aria-hidden />
            <Bi en="Damaged taka" hi="खराब टाका" layout="inline" />
          </h2>
          <ul className="space-y-3">
            {open.map((d) => {
              const decision = decisions.get(d.id);
              const needsPcs = d.pcs === null;
              const shownPcs = d.pcs ?? typedPcs(d.id);
              const unanswered = showErrors && issues.unanswered.includes(d.id);
              const pcsMissing = showErrors && issues.pcsMissing.includes(d.id);
              const tooBig = issues.pcsTooBig.includes(d.id);
              return (
                <li key={d.id} className={cn('rounded-xl border bg-white p-3.5', unanswered || pcsMissing || tooBig ? 'border-destructive' : 'border-red-200')}>
                  <p className="text-lg font-bold text-red-700">{d.damageName ?? 'No damage name'}</p>
                  <p className="text-sm font-semibold text-slate-600">
                    {damageLabelOf({ foundAt: d.foundAt })}
                    {d.pcs != null && <span className="ml-2 text-red-600">· {d.pcs} pcs</span>}
                  </p>
                  {needsPcs && (
                    <div className="mt-2">
                      <label htmlFor={`qc-dpcs-${d.id}`} className="mb-1 block text-sm font-semibold text-slate-700">
                        How many pcs damaged? / <span lang="hi">कितने पीस खराब?</span>
                        <span className="text-destructive">*</span>
                      </label>
                      <input
                        id={`qc-dpcs-${d.id}`}
                        value={damagePcs.get(d.id) ?? ''}
                        onChange={(e) => setDamagePcs((prev) => new Map(prev).set(d.id, cleanPcs(e.target.value)))}
                        inputMode="numeric"
                        autoComplete="off"
                        aria-invalid={pcsMissing || tooBig || undefined}
                        className={cn(fieldBox(pcsMissing || tooBig), 'max-w-[10rem] px-3 text-[20px] font-bold')}
                        placeholder="0"
                      />
                      {tooBig && (
                        <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
                          At most {takaPcs} pcs / <span lang="hi">ज़्यादा से ज़्यादा {takaPcs} पीस</span>
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setDecisions((prev) => new Map(prev).set(d.id, 'resolved'))}
                      aria-pressed={decision === 'resolved'}
                      className={cn(
                        'flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-base font-bold transition-colors',
                        decision === 'resolved' ? 'border-green-600 bg-green-600 text-white' : 'border-green-300 bg-white text-green-700 hover:bg-green-50',
                      )}
                    >
                      <CheckCircle2 className="size-5 shrink-0" aria-hidden />
                      <span className="flex flex-col text-left leading-tight">
                        <span>Resolved — all {shownPcs ?? 'N'} pcs</span>
                        <span lang="hi" className="text-[13px]">
                          सब ठीक
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecisions((prev) => new Map(prev).set(d.id, 'kept'))}
                      aria-pressed={decision === 'kept'}
                      className={cn(
                        'flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-base font-bold transition-colors',
                        decision === 'kept' ? 'border-red-600 bg-red-600 text-white' : 'border-red-300 bg-white text-red-700 hover:bg-red-50',
                      )}
                    >
                      <AlertTriangle className="size-5 shrink-0" aria-hidden />
                      <span className="flex flex-col text-left leading-tight">
                        <span>Not resolved</span>
                        <span lang="hi" className="text-[13px]">
                          ठीक नहीं
                        </span>
                      </span>
                    </button>
                  </div>
                  {unanswered && (
                    <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
                      Choose one / <span lang="hi">एक चुनें</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 4 — new damage found here */}
      <Section title={<Bi en="New damage" hi="नई खराबी" layout="inline" />}>
        {added.length > 0 && (
          <ul className="mb-3 space-y-2">
            {added.map((e) => (
              <li key={e.key} className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <AlertTriangle className="size-5 shrink-0 text-red-600" aria-hidden />
                <span className="min-w-0 flex-1 text-[15px] font-bold text-red-700">{entryLabel(e)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 text-destructive hover:bg-destructive-soft"
                  onClick={() => setAdded((prev) => prev.filter((x) => x.key !== e.key))}
                  aria-label={bi('Remove damage', 'खराबी हटाएं')}
                >
                  <Trash2 /> <Bi en="Remove" hi="हटाएं" layout="inline" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" size="lg" className="h-14 w-full border-dashed text-base" onClick={() => setAddOpen(true)} disabled={takaPcs === null}>
          <Plus className="!size-5" />
          <Bi en="Add new damage" hi="नई खराबी जोड़ें" layout="inline" />
        </Button>
        {newTooBig && (
          <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
            A damage can't have more pcs than the taka / <span lang="hi">खराब पीस टाका के पीस से ज़्यादा नहीं हो सकते</span>
          </p>
        )}
      </Section>

      {serverError && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-semibold text-red-700">
          {serverError}
        </p>
      )}

      {/* Sticky submit: above the phone bottom nav, at the bottom of the window on md+. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-t-2xl md:border-x">
        <Button size="lg" className="h-14 w-full text-lg" onClick={trySubmit}>
          <Bi en="QC done" hi="जांच पूरी" className="items-center" />
        </Button>
      </div>

      <DamageDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        takaLabel={bi(`Taka ${taka.takaNo}`, `टाका ${taka.takaNo}`)}
        foundAt="butta"
        takaPcs={takaPcs}
        value={null}
        onConfirm={(v) => setAdded((prev) => [...prev, { key: nextEntryKey(), foundAt: 'butta', choice: v.choice, pcs: v.pcs }])}
      />

      <ResponsiveModal
        open={confirmOpen}
        onOpenChange={(o) => !submitQc.isPending && setConfirmOpen(o)}
        title={bi('QC done?', 'जांच पूरी?')}
        desktopVariant="center"
        mobileVariant="bottom"
        size="md"
        dismissible={!submitQc.isPending}
        footer={
          <div className="grid w-full grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" className="h-14" onClick={() => setConfirmOpen(false)} disabled={submitQc.isPending}>
              <Bi en="Cancel" hi="रद्द करें" className="items-center" />
            </Button>
            <Button size="lg" className="h-14" onClick={submit} loading={submitQc.isPending}>
              <Bi en="Submit" hi="जमा करें" className="items-center" />
            </Button>
          </div>
        }
      >
        <div className="space-y-3 pb-1">
          <p className="text-2xl font-bold tabular-nums text-slate-900">
            Taka {taka.takaNo} <span lang="hi" className="text-lg font-semibold text-slate-500">/ टाका {taka.takaNo}</span>
          </p>
          <ul className="space-y-1.5 text-[15px] font-semibold text-slate-700">
            <li>
              {metersChanged || pcsChanged ? (
                <>
                  {metersChanged && (
                    <span className="block">
                      Meters / मीटर: {taka.meters != null ? formatMeters(taka.meters) : '—'} → {metersParsed.meters != null ? formatMeters(metersParsed.meters) : '—'}
                    </span>
                  )}
                  {pcsChanged && (
                    <span className="block">
                      Pcs / पीस: {taka.pcs ?? '—'} → {pcsParsed.pcs}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-500">
                  Meters and pcs unchanged / <span lang="hi">मीटर और पीस वही</span>
                </span>
              )}
            </li>
            {resolvedN > 0 && (
              <li className="text-green-700">
                Resolved / <span lang="hi">ठीक हुई</span>: {resolvedN}
              </li>
            )}
            {keptN > 0 && (
              <li className="text-red-700">
                Not resolved / <span lang="hi">ठीक नहीं</span>: {keptN}
              </li>
            )}
            {added.length > 0 && (
              <li className="text-red-700">
                New damage / <span lang="hi">नई खराबी</span>: {added.map(entryLabel).join(', ')}
              </li>
            )}
            {open.length === 0 && added.length === 0 && (
              <li className="text-green-700">
                Fresh / <span lang="hi">ठीक</span>
              </li>
            )}
          </ul>
        </div>
      </ResponsiveModal>
    </div>
  );
}

/** `/butta-qc/taka/:takaNo` — Butta QC for one taka (the QC action first, details secondary). */
export default function QcTakaPage() {
  const takaNo = decodeURIComponent(useParams().takaNo ?? '');
  const query = useTakaByNo(takaNo);
  usePageTitle(bi(`Taka ${takaNo}`, `टाका ${takaNo}`));

  if (query.isPending) {
    return (
      <div className="page-container max-w-2xl space-y-4 py-4">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="page-container max-w-2xl py-4">
        <Link to="/butta-qc" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
          <ArrowLeft className="size-4" /> Butta QC / <span lang="hi">बुट्टा QC</span>
        </Link>
        {notFound ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive-soft text-destructive">
              <SearchX className="size-7" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Taka not found</h2>
            <p lang="hi" className="font-semibold text-slate-700">
              टाका नहीं मिला
            </p>
          </div>
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }
  const taka = query.data;
  if (taka.stage === 'entered' || taka.stage === 'at_butta') {
    return (
      <div className="page-container max-w-2xl space-y-4 pt-4">
        <IdentityCard taka={taka} />
        <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-semibold text-red-700">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            This taka has not been received from butta cutting
            <span lang="hi" className="block">
              यह टाका अभी बुट्टा से वापस नहीं आया
            </span>
          </span>
        </p>
        <Button asChild variant="secondary" size="lg" className="h-14 w-full">
          <Link to="/butta-qc">
            <Bi en="Back" hi="वापस" className="items-center" />
          </Link>
        </Button>
      </div>
    );
  }
  if (taka.stage !== 'butta_qc') return <ReadOnlySummary taka={taka} />;
  return <QcForm key={taka.id} taka={taka} />;
}
