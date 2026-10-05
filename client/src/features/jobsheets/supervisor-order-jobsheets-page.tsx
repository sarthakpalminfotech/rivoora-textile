import { ArrowLeft } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { SupervisorOrderHeader } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { ImageThumb } from '@/components/ui/image-thumb';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { formatOrderNo } from '@/lib/format';
import { SupervisorJobsheetList } from './supervisor-jobsheets-page';

/**
 * `/jobsheets/order/:orderId` — the supervisor's Order view, level 2: one order's jobsheets with the same tabs,
 * search, cards and actions as the All view. The header shows only the order number and design.
 */
export default function SupervisorOrderJobsheetsPage() {
  const orderId = Number(useParams().orderId);
  const navigate = useNavigate();
  const location = useLocation();
  const [order, setOrder] = useState<SupervisorOrderHeader | null>(null);
  const [notFound, setNotFound] = useState(false);
  usePageTitle(order ? `Order ${formatOrderNo(order.orderNo)}` : 'Jobsheets');

  const onOrder = useCallback((o: SupervisorOrderHeader | null, error: unknown) => {
    if (o) setOrder(o);
    setNotFound(error instanceof ApiError && error.status === 404);
  }, []);

  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/jobsheets');
  };

  return (
    <div className="page-container space-y-4 pb-24 pt-4 md:py-5">
      <button type="button" onClick={goBack} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> Orders
      </button>

      {notFound ? (
        <div className="py-16 text-center">
          <h2 className="text-lg font-semibold text-slate-900">No jobsheets for this order</h2>
          <p className="mt-1 text-sm text-muted-foreground">It has no jobsheets sent to you, or it doesn't exist.</p>
          <Button variant="secondary" className="mt-5" onClick={() => navigate('/jobsheets')}>
            Back to orders
          </Button>
        </div>
      ) : (
        <>
          <section className="flex items-center gap-4 rounded-xl border border-border bg-white p-4 shadow-soft">
            {order ? (
              <>
                <ImageThumb
                  thumbUrl={order.designThumbUrl}
                  fullUrl={order.designImageUrl}
                  alt={order.designCode ? `Design ${order.designCode}` : 'No design'}
                  className="size-16 shrink-0 md:size-20"
                  rounded="rounded-xl"
                />
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold leading-tight text-slate-900 md:text-[28px]">Order {formatOrderNo(order.orderNo)}</h2>
                  <p className="truncate text-sm text-slate-500">{order.designCode ? `Design ${order.designCode}` : 'No design'}</p>
                </div>
              </>
            ) : (
              <>
                <Skeleton className="size-16 shrink-0 rounded-xl md:size-20" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-7 w-40" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </>
            )}
          </section>
          <SupervisorJobsheetList orderId={orderId} onOrder={onOrder} />
        </>
      )}
    </div>
  );
}
