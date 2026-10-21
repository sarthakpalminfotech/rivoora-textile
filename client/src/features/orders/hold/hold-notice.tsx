import { PauseCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ORDER_ON_HOLD_HI } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

/** A 409 from the server hold guard ("Order #26 is on hold"). */
export function isOnHoldError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && /on hold/i.test(err.message);
}

/** The order number out of the server message ("Order #26 is on hold …"), when there is one. */
export function holdOrderNo(err: unknown): string | null {
  return err instanceof ApiError ? (/#(\d+)/.exec(err.message)?.[1] ?? null) : null;
}

/**
 * Full-page notice for a jobsheet / taka of an order that is on hold (Sprint 15). English-only, or bilingual (English +
 * Hindi) on the Taka entry and QC screens. Entry / QC is blocked — there is nothing else to do here but go back.
 */
export function HoldNotice({
  error,
  bilingual,
  backTo,
  backLabel,
  backLabelHi,
}: {
  error: unknown;
  bilingual?: boolean;
  backTo: string;
  backLabel: string;
  backLabelHi?: string;
}) {
  const no = holdOrderNo(error);
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center" role="alert">
      <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <PauseCircle className="size-8" aria-hidden />
      </div>
      <h2 className="text-xl font-bold text-slate-900">{no ? `Order #${no} is on hold` : 'This order is on hold'}</h2>
      {bilingual && (
        <p lang="hi" className="text-lg font-semibold text-slate-700">
          {ORDER_ON_HOLD_HI}
        </p>
      )}
      <p className="mt-2 max-w-sm text-[15px] text-muted-foreground">
        Work on it has stopped until it is released.
        {bilingual && (
          <span lang="hi" className="block">
            इसे चालू करने तक काम बंद है।
          </span>
        )}
      </p>
      <Button asChild size="lg" className="mt-6 h-14 w-full max-w-xs">
        <Link to={backTo}>
          {backLabel}
          {bilingual && backLabelHi ? (
            <span lang="hi" className="ml-2 font-semibold">
              / {backLabelHi}
            </span>
          ) : null}
        </Link>
      </Button>
    </div>
  );
}
