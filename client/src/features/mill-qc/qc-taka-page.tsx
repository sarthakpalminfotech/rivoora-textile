import { AlertTriangle, ArrowLeft, CheckCircle2, Plus, RotateCcw, SearchX, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  cleanMeters,
  cleanPcs,
  damageLabelOf,
  damageOpenPcs,
  damageResolvedText,
  damageResolveSummary,
  formatMeters,
  METERS_ERROR_TEXT,
  MILL_QC_TEXT,
  parseMeters,
  parsePcs,
  PCS_ERROR_TEXT,
  validateQcDecisions,
  type MillQcSubmitInput,
  type QcResult,
  type TakaDetail,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { Bi, bi } from '@/lib/bilingual';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { IdentityCard, ResolveDialog, Section, fieldBox } from '../butta-qc/qc-taka-page';
import { DamageDialog, entryLabel, nextEntryKey, qcEntryPayload, type DamageEntry } from '../takas/damage-dialog';
import { FreshTag } from '../takas/taka-chip';
import { useMillQcTaka, useSubmitMillQc } from './api';

type Confirm = 'fresh' | 'done' | 'refinish' | null;

const BackLink = () => (
  <Link to="/qc" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
    <ArrowLeft className="size-4" /> QC / <span lang="hi">क्यूसी</span>
  </Link>
);

/** The calm amber alert for a taka the mill sent back but nobody marked received yet. */
function NotReceivedAlert() {
  return (
    <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] font-semibold text-amber-800">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <span>
        {MILL_QC_TEXT.notReceived.en}
        <span lang="hi" className="block">
          {MILL_QC_TEXT.notReceived.hi}
        </span>
      </span>
    </p>
  );
}

/** Saved / सेव हो गया — the result and "Next taka". */
function SuccessScreen({ taka, result }: { taka: TakaDetail; result: QcResult }) {
  const refinish = result.result === 'refinish';
  return (
    <div className="page-container max-w-2xl space-y-4 pt-4">
      <section className="rounded-2xl border border-border bg-white p-6 text-center shadow-soft">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-green-100 text-green-700">
          <CheckCircle2 className="size-8" aria-hidden />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          <Bi en="Saved" hi="सेव हो गया" layout="inline" />
        </h2>
        <p className="mt-1 text-4xl font-extrabold tabular-nums tracking-tight text-slate-900">{taka.takaNo}</p>
        <p className="mt-3 flex justify-center">
          {refinish ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-100 px-3 py-1 text-sm font-bold text-pink-700">
              <RotateCcw className="size-4" aria-hidden /> Refinish / रीफिनिश
            </span>
          ) : result.fresh ? (
            <FreshTag bilingual />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-700">
              <AlertTriangle className="size-4" aria-hidden /> Damaged / खराब
            </span>
          )}
        </p>
      </section>
      <Button asChild size="lg" className="h-14 w-full">
        <Link to="/qc" replace>
          <Bi en="Next taka" hi="अगला टाका" className="items-center" />
        </Link>
      </Button>
    </div>
  );
}

/** Already final / ready to dispatch: a read-only summary. */
function ReadOnlySummary({ taka }: { taka: TakaDetail }) {
  const mill = taka.challans.find((c) => c.kind === 'mill');
  return (
    <div className="page-container max-w-2xl space-y-4 pt-3 md:pt-5">
      <IdentityCard taka={taka} kind="mill" />
      <p className="flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[15px] font-semibold text-green-800" role="status">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          {MILL_QC_TEXT.checked.en}
          <span lang="hi" className="block">
            {MILL_QC_TEXT.checked.hi}
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
          {mill?.receivedAt && (
            <div className="col-span-2">
              <dt className="text-[13px] text-muted-foreground">Received / वापस आया</dt>
              <dd className="font-semibold text-slate-900">{formatDateTime(mill.receivedAt)}</dd>
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
                    className={cn('rounded-lg border px-3 py-2 text-[15px] font-semibold', r ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-red-200 bg-red-50 text-red-700')}
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
        <Link to="/qc">
          <Bi en="Next taka" hi="अगला टाका" className="items-center" />
        </Link>
      </Button>
    </div>
  );
}

function QcForm({ taka, notReceived }: { taka: TakaDetail; notReceived: boolean }) {
  const navigate = useNavigate();
  const submitQc = useSubmitMillQc(taka.id);
  const open = useMemo(() => taka.damages.filter((d) => d.status === 'open'), [taka]);
  const [meters, setMeters] = useState(taka.meters != null ? String(taka.meters) : '');
  const [pcs, setPcs] = useState(taka.pcs != null ? String(taka.pcs) : '');
  /** damage id → pcs resolved now. No entry = not resolved (it stays open). */
  const [decisions, setDecisions] = useState<Map<number, number>>(new Map());
  const [resolving, setResolving] = useState<number | null>(null);
  const [damagePcs, setDamagePcs] = useState<Map<number, string>>(new Map());
  const [added, setAdded] = useState<DamageEntry[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<QcResult | null>(null);

  const metersParsed = parseMeters(meters);
  const pcsParsed = parsePcs(pcs);
  const takaPcs = pcsParsed.pcs ?? taka.pcs ?? null;
  const typedPcs = (id: number) => {
    const raw = damagePcs.get(id) ?? '';
    return /^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : null;
  };
  const pcsOpen = (d: (typeof open)[number]) => damageOpenPcs(d) ?? typedPcs(d.id) ?? 0;
  // Every open damage gets an answer: what was resolved now (0 = it stays open).
  const allDecisions = open.map((d) => ({ takaDamageId: d.id, resolvedPcs: decisions.get(d.id) ?? 0, pcs: d.pcs === null ? typedPcs(d.id) : null }));
  const issues = validateQcDecisions(
    open.map((d) => ({ id: d.id, pcs: d.pcs, resolvedPcs: d.resolvedPcs })),
    allDecisions,
    takaPcs ?? 9999,
  );
  const newTooBig = added.some((e) => takaPcs !== null && (e.pcs ?? 0) > takaPcs);
  const fieldsOk = metersParsed.error === null && pcsParsed.error === null && !newTooBig;
  const stillOpen = open.filter((d) => (decisions.get(d.id) ?? 0) < pcsOpen(d));
  const willBeFresh = stillOpen.length === 0 && added.length === 0;
  const touched = open.length > 0 || added.length > 0;

  const resolvedN = open.filter((d) => (decisions.get(d.id) ?? 0) > 0 && decisions.get(d.id) === pcsOpen(d)).length;
  const partialN = open.filter((d) => (decisions.get(d.id) ?? 0) > 0 && decisions.get(d.id)! < pcsOpen(d)).length;
  const keptN = open.length - resolvedN - partialN;
  const metersChanged = (metersParsed.meters ?? null) !== taka.meters;
  const pcsChanged = pcsParsed.pcs !== null && pcsParsed.pcs !== taka.pcs;

  const tryConfirm = (kind: Exclude<Confirm, null>) => {
    setShowErrors(true);
    if (!fieldsOk || (kind !== 'refinish' && !issues.ok) || (kind === 'refinish' && issues.pcsMissing.length > 0)) return;
    setConfirm(kind);
  };

  const submit = () => {
    const refinish = confirm === 'refinish';
    const body: MillQcSubmitInput = {
      meters: metersParsed.meters,
      pcs: pcsParsed.pcs!,
      damageDecisions: refinish ? allDecisions.filter((d) => d.resolvedPcs > 0) : allDecisions,
      newDamages: added.map(qcEntryPayload),
      result: refinish ? 'refinish' : 'final',
      refinishNote: refinish ? note.trim() || null : null,
    };
    submitQc.mutate(body, {
      onSuccess: (res) => {
        setConfirm(null);
        setSaved(res);
      },
      onError: (err) => {
        setConfirm(null);
        setServerError(err instanceof ApiError ? err.message : 'Something went wrong');
      },
    });
  };

  if (saved) return <SuccessScreen taka={taka} result={saved} />;

  return (
    <div className="page-container max-w-2xl space-y-4 pt-3 md:pt-5">
      <button type="button" onClick={() => navigate('/qc')} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> QC / <span lang="hi">क्यूसी</span>
      </button>
      <IdentityCard taka={taka} kind="mill" />
      {notReceived && <NotReceivedAlert />}

      {/* meters and pcs, prefilled */}
      <Section title={<Bi en="Meters and pcs" hi="मीटर और पीस" layout="inline" />}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mqc-meters" className="mb-1 block text-sm font-semibold text-slate-600">
              Meters / <span lang="hi">मीटर</span>
            </label>
            <div className="relative">
              <input
                id="mqc-meters"
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
            <label htmlFor="mqc-pcs" className="mb-1 block text-sm font-semibold text-slate-600">
              Pcs / <span lang="hi">पीस</span>
              <span className="text-destructive">*</span>
            </label>
            <input
              id="mqc-pcs"
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

      {/* open damages: Resolve each one */}
      {open.length > 0 && (
        <section className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 shadow-soft md:p-5" aria-label={bi('Damaged taka', 'खराब टाका')}>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-red-700">
            <AlertTriangle className="size-6 shrink-0" aria-hidden />
            <Bi en="Damaged taka" hi="खराब टाका" layout="inline" />
          </h2>
          <ul className="space-y-3">
            {open.map((d) => {
              const answer = decisions.get(d.id);
              const open0 = pcsOpen(d);
              const needsPcs = d.pcs === null;
              const pcsMissing = showErrors && issues.pcsMissing.includes(d.id);
              const tooBig = issues.pcsTooBig.includes(d.id);
              const total = d.pcs ?? typedPcs(d.id);
              const full = answer !== undefined && answer > 0 && answer >= open0;
              const summary = answer && answer > 0 && total !== null ? damageResolveSummary({ pcs: total, resolvedPcs: d.resolvedPcs + answer, status: 'open' }) : null;
              return (
                <li key={d.id} className={cn('rounded-xl border bg-white p-3.5', pcsMissing || tooBig ? 'border-destructive' : 'border-red-200')}>
                  <p className="text-lg font-bold text-red-700">{d.damageName ?? 'No damage name'}</p>
                  <p className="text-sm font-semibold text-slate-600">
                    {damageLabelOf({ foundAt: d.foundAt })}
                    {d.pcs != null && (
                      <span className="ml-2 text-red-600">
                        · {open0} pcs{d.resolvedPcs > 0 && ` (${d.resolvedPcs} resolved)`}
                      </span>
                    )}
                  </p>
                  {needsPcs && (
                    <div className="mt-2">
                      <label htmlFor={`mqc-dpcs-${d.id}`} className="mb-1 block text-sm font-semibold text-slate-700">
                        How many pcs damaged? / <span lang="hi">कितने पीस खराब?</span>
                        <span className="text-destructive">*</span>
                      </label>
                      <input
                        id={`mqc-dpcs-${d.id}`}
                        value={damagePcs.get(d.id) ?? ''}
                        onChange={(e) => {
                          setDamagePcs((prev) => new Map(prev).set(d.id, cleanPcs(e.target.value)));
                          setDecisions((prev) => {
                            const next = new Map(prev);
                            next.delete(d.id);
                            return next;
                          });
                        }}
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
                  {answer === undefined || answer === 0 ? (
                    <button
                      type="button"
                      disabled={open0 <= 0}
                      onClick={() => setResolving(d.id)}
                      className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-green-300 bg-white px-3 text-base font-bold text-green-700 transition-colors hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CheckCircle2 className="size-5 shrink-0" aria-hidden />
                      <Bi en="Resolve" hi="ठीक करें" layout="inline" />
                    </button>
                  ) : (
                    <div className={cn('mt-3 flex items-center gap-2 rounded-xl border px-3 py-2.5', full ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50')}>
                      <p className={cn('min-w-0 flex-1 text-[15px] font-bold', full ? 'text-green-700' : 'text-amber-700')}>{summary ?? `Resolved ${answer} pcs`}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-10"
                        onClick={() =>
                          setDecisions((prev) => {
                            const next = new Map(prev);
                            next.delete(d.id);
                            return next;
                          })
                        }
                      >
                        <Bi en="Change" hi="बदलें" layout="inline" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* new damages found here */}
      {added.length > 0 && (
        <Section title={<Bi en="New damage" hi="नई खराबी" layout="inline" />}>
          <ul className="space-y-2">
            {added.map((e) => (
              <li key={e.key} className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <AlertTriangle className="size-5 shrink-0 text-red-600" aria-hidden />
                <span className="min-w-0 flex-1 text-[15px] font-bold text-red-700">
                  {entryLabel(e)}
                  {!!e.images?.length && (
                    <span className="ml-2 text-xs font-semibold text-slate-500">
                      · {e.images.length} {e.images.length === 1 ? 'photo' : 'photos'}
                    </span>
                  )}
                </span>
                <Button variant="ghost" size="sm" className="h-10 text-destructive hover:bg-destructive-soft" onClick={() => setAdded((prev) => prev.filter((x) => x.key !== e.key))} aria-label={bi('Remove damage', 'खराबी हटाएं')}>
                  <Trash2 /> <Bi en="Remove" hi="हटाएं" layout="inline" />
                </Button>
              </li>
            ))}
          </ul>
          {newTooBig && (
            <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
              A damage can't have more pcs than the taka / <span lang="hi">खराब पीस टाका के पीस से ज़्यादा नहीं हो सकते</span>
            </p>
          )}
        </Section>
      )}

      {/* the action */}
      {!touched ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => tryConfirm('fresh')}
            className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-green-600 px-3 text-white shadow-soft transition-colors hover:bg-green-700 active:bg-green-800"
          >
            <CheckCircle2 className="size-7" aria-hidden />
            <Bi en="Fresh" hi="ठीक है" className="items-center text-lg font-extrabold" />
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={takaPcs === null}
            className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-red-500 bg-white px-3 text-red-600 transition-colors hover:bg-red-50 active:bg-red-100 disabled:opacity-40"
          >
            <AlertTriangle className="size-7" aria-hidden />
            <Bi en="Damage" hi="खराबी" className="items-center text-lg font-extrabold" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button variant="secondary" size="lg" className="h-14 border-dashed text-base" onClick={() => setAddOpen(true)} disabled={takaPcs === null}>
            <Plus className="!size-5" />
            <Bi en="Add new damage" hi="नई खराबी" layout="inline" />
          </Button>
          <Button variant="secondary" size="lg" className="h-14 border-pink-200 text-base text-pink-700 hover:bg-pink-50" onClick={() => tryConfirm('refinish')}>
            <RotateCcw className="!size-5" />
            <Bi en="Send to refinish" hi="रीफिनिश भेजें" layout="inline" />
          </Button>
        </div>
      )}

      {serverError && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-semibold text-red-700">
          {serverError}
        </p>
      )}

      {touched && (
        <div className="kb-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-t-2xl lg:border-x">
          <Button size="lg" className="h-14 w-full text-lg" onClick={() => tryConfirm('done')}>
            <Bi en="Done" hi="पूरा" className="items-center" />
          </Button>
        </div>
      )}

      <DamageDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        takaLabel={bi(`Taka ${taka.takaNo}`, `टाका ${taka.takaNo}`)}
        takaPcs={takaPcs}
        value={null}
        allowImages
        onConfirm={(v) => setAdded((prev) => [...prev, { key: nextEntryKey(), foundAt: v.type, choice: v.choice, pcs: v.pcs, images: v.images }])}
        onRefinish={() => tryConfirm('refinish')}
      />

      <ResolveDialog
        damage={open.find((d) => d.id === resolving) ?? null}
        openPcs={(() => {
          const d = open.find((x) => x.id === resolving);
          return d ? pcsOpen(d) : 0;
        })()}
        current={resolving !== null ? decisions.get(resolving) : undefined}
        onCancel={() => setResolving(null)}
        onSave={(n) => {
          setDecisions((prev) => new Map(prev).set(resolving!, n));
          setResolving(null);
        }}
      />

      <ResponsiveModal
        open={confirm !== null}
        onOpenChange={(o) => !submitQc.isPending && !o && setConfirm(null)}
        title={confirm === 'refinish' ? bi('Send to refinish?', 'रीफिनिश भेजें?') : confirm === 'fresh' ? bi('Taka is fresh?', 'टाका ठीक है?') : bi('QC done?', 'जांच पूरी?')}
        desktopVariant="center"
        mobileVariant="bottom"
        size="md"
        dismissible={!submitQc.isPending}
        footer={
          <div className="grid w-full grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" className="h-14" onClick={() => setConfirm(null)} disabled={submitQc.isPending}>
              <Bi en="Cancel" hi="रद्द करें" className="items-center" />
            </Button>
            <Button size="lg" className={cn('h-14', confirm === 'refinish' && 'bg-pink-600 hover:bg-pink-700')} onClick={submit} loading={submitQc.isPending}>
              <Bi en={confirm === 'refinish' ? 'Send' : 'Save'} hi={confirm === 'refinish' ? 'भेजें' : 'सेव करें'} className="items-center" />
            </Button>
          </div>
        }
      >
        <div className="space-y-3 pb-1">
          <p className="text-2xl font-bold tabular-nums text-slate-900">
            Taka {taka.takaNo} <span lang="hi" className="text-lg font-semibold text-slate-500">/ टाका {taka.takaNo}</span>
          </p>
          <ul className="space-y-1.5 text-[15px] font-semibold text-slate-700">
            {(metersChanged || pcsChanged) && (
              <li>
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
              </li>
            )}
            {resolvedN > 0 && (
              <li className="text-green-700">
                Resolved / <span lang="hi">ठीक हुई</span>: {resolvedN}
              </li>
            )}
            {partialN > 0 && (
              <li className="text-amber-700">
                Partly resolved / <span lang="hi">कुछ ठीक हुई</span>: {partialN}
              </li>
            )}
            {confirm !== 'refinish' && keptN > 0 && (
              <li className="text-red-700">
                Still damaged / <span lang="hi">अब भी खराब</span>: {keptN}
              </li>
            )}
            {added.length > 0 && (
              <li className="text-red-700">
                New damage / <span lang="hi">नई खराबी</span>: {added.map(entryLabel).join(', ')}
              </li>
            )}
            {confirm !== 'refinish' && (
              <li className={willBeFresh ? 'text-green-700' : 'text-red-700'}>
                {willBeFresh ? (
                  <>
                    Result: Fresh / <span lang="hi">नतीजा: ठीक</span>
                  </>
                ) : (
                  <>
                    Result: Damaged / <span lang="hi">नतीजा: खराब</span>
                  </>
                )}
              </li>
            )}
          </ul>
          {confirm === 'refinish' && (
            <div>
              <label htmlFor="mqc-note" className="mb-1 block text-sm font-semibold text-slate-600">
                Note / <span lang="hi">नोट</span> <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <Input id="mqc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoComplete="off" className="h-12 text-base" />
            </div>
          )}
        </div>
      </ResponsiveModal>
    </div>
  );
}

/** `/mill-qc/taka/:takaNo` — Mill QC for one taka (the action first, details secondary). */
export default function MillQcTakaPage() {
  const takaNo = decodeURIComponent(useParams().takaNo ?? '');
  const query = useMillQcTaka(takaNo);
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
        <BackLink />
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
  const { taka, state } = query.data;
  if (state === 'never_sent') {
    return (
      <div className="page-container max-w-2xl space-y-4 pt-4">
        <IdentityCard taka={taka} kind="mill" />
        <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-semibold text-red-700">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            {MILL_QC_TEXT.neverSent.en}
            <span lang="hi" className="block">
              {MILL_QC_TEXT.neverSent.hi}
            </span>
          </span>
        </p>
        <Button asChild variant="secondary" size="lg" className="h-14 w-full">
          <Link to="/qc">
            <Bi en="Back" hi="वापस" className="items-center" />
          </Link>
        </Button>
      </div>
    );
  }
  if (state === 'checked') return <ReadOnlySummary taka={taka} />;
  return <QcForm key={taka.id} taka={taka} notReceived={state === 'qc_not_received'} />;
}
