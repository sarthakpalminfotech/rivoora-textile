import { useParams } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { PageSkeleton } from '@/components/layout/page-skeleton';
import { ErrorState } from '@/components/list-parts';
import { useFgReceiptForm } from './api';
import { FgPcsReceiptPage } from './fg-pcs-receipt-page';
import { ReceiptEntryPage } from './receipt-entry-page';

/** `/orders/:id/receive-fg` — a direct FG purchase: lump rows, or the simple pcs-to-pcs form. */
export default function FgReceivePage() {
  const orderId = Number(useParams().id);
  const form = useFgReceiptForm(orderId);

  if (form.isPending) return <PageSkeleton />;
  if (form.isError || !form.data) {
    if (form.error instanceof ApiError && form.error.status === 404) {
      return (
        <div className="page-container py-5">
          <p className="text-sm text-muted-foreground">Order not found.</p>
        </div>
      );
    }
    return (
      <div className="page-container py-5">
        <ErrorState error={form.error} onRetry={() => void form.refetch()} />
      </div>
    );
  }
  return form.data.orderType === 'lump' ? <ReceiptEntryPage kind="fg" id={orderId} /> : <FgPcsReceiptPage orderId={orderId} />;
}
