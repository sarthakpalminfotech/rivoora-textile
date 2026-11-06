import { Loader2, SearchX } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/useRole';
import { ApiError } from '@/lib/api';
import { Bi, bi, useBilingual } from '@/lib/bilingual';
import { HoldNotice, isOnHoldError } from '../orders/hold/hold-notice';
import { useJobsheetByNo } from './api';

/**
 * `/j/:jobsheetNo` — the target of the QR code printed on a jobsheet. Resolves the number and redirects:
 * Taka entry → his taka entry screen, everyone else → their jobsheet details (all live at `/jobsheets/:id`).
 */
export default function JobsheetQrPage() {
  const params = useParams();
  const raw = params.jobsheetNo ?? '';
  const fy = /^\d{4}-\d{2}$/.test(params.fy ?? '') ? (params.fy as string) : null;
  const no = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const bilingual = useBilingual();
  const { role, config } = useRole();
  const { data, isError, error, refetch } = useJobsheetByNo(no, fy);
  usePageTitle(bilingual ? bi(`Jobsheet ${raw}`, `जॉबशीट ${raw}`) : `Jobsheet ${raw}`);

  if (data?.candidates && data.candidates.length > 1) {
    // Sprint 23: an old QR (no year) matches jobsheets of several financial years — "Which one?"
    return (
      <div className="page-container max-w-xl py-6">
        <h2 className="text-xl font-bold text-slate-900">{bilingual ? bi(`Which jobsheet ${raw}?`, `कौन सी जॉबशीट ${raw}?`) : `Which jobsheet ${raw}?`}</h2>
        <p className="mb-3 text-sm text-slate-600">{bilingual ? bi('More than one year has this number.', 'इस नंबर की एक से ज़्यादा साल की जॉबशीट हैं।') : 'More than one financial year has a jobsheet with this number.'}</p>
        <ul className="space-y-2">
          {data.candidates.map((c) => (
            <li key={c.id}>
              <Link to={`/jobsheets/${c.id}`} replace className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3 hover:border-primary/40 hover:bg-primary-soft/40">
                <span className="text-lg font-bold tabular-nums text-slate-900">{c.jobsheetNo} · Order #{c.orderNo}</span>
                <span className="text-sm font-semibold text-slate-600">{c.designCode ? `${c.designCode} · ` : ''}{c.fy}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (data) return <Navigate to={`/jobsheets/${data.id}`} replace />;

  const notFound = !Number.isInteger(no) || no < 1 || (isError && error instanceof ApiError && error.status === 404);
  if (!notFound && !isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-slate-500" role="status">
        <Loader2 className="size-8 animate-spin" aria-hidden />
        {bilingual ? (
          <Bi en={`Opening jobsheet ${raw}…`} hi={`जॉबशीट ${raw} खुल रही है…`} className="items-center text-center" />
        ) : (
          <p>Opening jobsheet {raw}…</p>
        )}
      </div>
    );
  }
  if (isError && isOnHoldError(error)) {
    return (
      <div className="page-container py-6">
        <HoldNotice
          error={error}
          bilingual={bilingual}
          backTo={bilingual ? '/scan' : config.landing}
          backLabel={bilingual ? 'Scan again' : 'Go back'}
          backLabelHi={bilingual ? 'फिर से स्कैन करें' : undefined}
        />
      </div>
    );
  }
  if (!notFound) {
    return (
      <div className="page-container py-6">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  const back = bilingual ? '/scan' : config.landing;
  return (
    <div className="page-container flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-destructive-soft text-destructive">
        <SearchX className="size-8" aria-hidden />
      </div>
      {bilingual ? (
        <>
          <h2 className="text-xl font-bold text-slate-900">Jobsheet {raw} not found</h2>
          <p lang="hi" className="text-lg font-semibold text-slate-700">
            जॉबशीट {raw} नहीं मिली
          </p>
          <p className="mt-2 max-w-sm text-[15px] text-muted-foreground">
            Check the number on the paper and try again.
            <span lang="hi" className="block">
              कागज़ पर लिखा नंबर देखकर फिर कोशिश करें।
            </span>
          </p>
          <Button asChild size="lg" className="mt-6 h-14 w-full max-w-xs">
            <Link to={back}>
              <Bi en="Scan again" hi="फिर से स्कैन करें" className="items-center" />
            </Link>
          </Button>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-slate-900">
            {role === 'supervisor' ? `Jobsheet ${raw} isn't available` : `Jobsheet ${raw} not found`}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {role === 'supervisor'
              ? "It hasn't been sent to you yet, or it doesn't exist."
              : 'It may have been deleted, or the number is wrong.'}
          </p>
          <Button asChild variant="secondary" className="mt-5">
            <Link to={back}>Go back</Link>
          </Button>
        </>
      )}
    </div>
  );
}
