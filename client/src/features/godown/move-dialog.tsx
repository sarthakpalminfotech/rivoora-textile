import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { moveTotals, type GodownTaka, type MoveTarget } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMoveTakas, useMoveTargets } from './api';

/**
 * Move to order: pick one of the orders of the same design that is not fully dispatched, then confirm
 * ("N takas · P pcs, from Order #A → Order #B").
 */
export function MoveDialog({
  open,
  onOpenChange,
  fromOrderId,
  fromOrderNo,
  takas,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromOrderId: number;
  fromOrderNo: number;
  takas: GodownTaka[];
  onMoved: () => void;
}) {
  const targets = useMoveTargets(fromOrderId, open);
  const move = useMoveTakas();
  const [target, setTarget] = useState<MoveTarget | null>(null);
  useEffect(() => {
    if (!open) setTarget(null);
  }, [open]);
  const totals = moveTotals(takas);

  const confirm = () => {
    if (!target) return;
    move.mutate(
      { takaIds: takas.map((t) => t.id), targetOrderId: target.orderId },
      {
        onSuccess: (res) => {
          toast.success(`${res.moved} ${res.moved === 1 ? 'taka' : 'takas'} moved to Order ${formatOrderNo(target.orderNo)}`);
          onOpenChange(false);
          onMoved();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !move.isPending && onOpenChange(o)}
      title={target ? 'Move takas?' : 'Move to order'}
      desktopVariant="center"
      mobileVariant="bottom"
      size="md"
      dismissible={!move.isPending}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" className="h-12" onClick={() => (target ? setTarget(null) : onOpenChange(false))} disabled={move.isPending}>
            {target ? 'Back' : 'Cancel'}
          </Button>
          {target && (
            <Button size="lg" className="h-12" onClick={confirm} loading={move.isPending}>
              Move
            </Button>
          )}
        </div>
      }
    >
      {target ? (
        <div className="space-y-3 pb-1">
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-center">
            <div>
              <dt className="text-[12px] text-muted-foreground">Takas</dt>
              <dd className="text-3xl font-bold tabular-nums text-slate-900">{totals.takas}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted-foreground">Pcs</dt>
              <dd className="text-3xl font-bold tabular-nums text-slate-900">{totals.pcs.toLocaleString('en-IN')}</dd>
            </div>
          </dl>
          <p className="text-center text-[15px] font-semibold text-slate-700">
            Order {formatOrderNo(fromOrderNo)} → Order {formatOrderNo(target.orderNo)}
          </p>
        </div>
      ) : targets.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : !targets.data?.length ? (
        <p className="py-6 text-center text-sm text-slate-500">No other order of this design can take these takas (a fully dispatched order can't).</p>
      ) : (
        <ul className="space-y-2 pb-1">
          {targets.data.map((o) => (
            <li key={o.orderId}>
              <button
                type="button"
                onClick={() => setTarget(o)}
                className={cn('flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left shadow-soft transition-colors hover:border-primary/40 hover:bg-primary-soft/40')}
              >
                <span className="min-w-0">
                  <span className="block text-lg font-bold text-slate-900">Order {formatOrderNo(o.orderNo)}</span>
                  {o.customerName && <span className="block truncate text-sm text-slate-500">{o.customerName}</span>}
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums text-slate-600">
                  <span className="block">{o.orderedPcs.toLocaleString('en-IN')} ordered</span>
                  <span className="block font-semibold text-emerald-700">{o.readyPcs.toLocaleString('en-IN')} ready</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ResponsiveModal>
  );
}
