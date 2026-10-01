import { Navigate, useParams } from 'react-router-dom';
import { PageSkeleton } from '@/components/layout/page-skeleton';
import { ErrorState } from '@/components/list-parts';
import { useRole } from '@/hooks/useRole';
import { useOrder } from './api';
import { OrderForm } from './add-order-page';

/** `/orders/:id/edit` — the order form pre-filled with an existing order (Jemish / Gaurang). */
export default function EditOrderPage() {
  const id = Number(useParams().id);
  const { can } = useRole();
  const { data: order, isPending, isError, error, refetch } = useOrder(id);

  if (!can('canEditOrder')) return <Navigate to={`/orders/${id}`} replace />;
  if (isPending) return <PageSkeleton />;
  if (isError || !order) {
    return (
      <div className="page-container py-5">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  // Keyed by the order so the form re-initialises if another order's edit screen is opened.
  return <OrderForm key={order.id} order={order} />;
}
