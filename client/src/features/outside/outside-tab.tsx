import { Ban, CheckCircle2, MoreVertical, Package, PackagePlus, Pencil, Printer, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { formatPoQty, poIsOpen, type OrderOutside, type OutsidePoCard, type Unit } from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/features/jobsheets/parts';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatOrderNo } from '@/lib/format';
import { useCancelOutsidePo, useCloseOutsidePo, useOrderOutside } from './api';
import { PoFormDialog, type PoFormDefaults } from './po-form-dialog';
import { PoStatusPill } from './po-status';

function PoCard({ po, canManage, canReceive, onEdit }: { po: OutsidePoCard; canManage: boolean; canReceive: boolean; onEdit: () => void }) {
  const navigate = useNavigate();
  const cancel = useCancelOutsidePo(po.orderId);
  const close = useCloseOutsidePo(po.orderId);
  const [confirm, setConfirm] = useState<'cancel' | 'close' | null>(null);
  const open = poIsOpen(po.status);

  const act = (mutation: typeof cancel | typeof close, verb: string) =>
    mutation.mutate(po.id, {
      onSuccess: (p) => {
        toast.success(`${p.label} ${verb}`);
        setConfirm(null);
      },
      onError: (err) => {
        toast.error(errorMessage(err));
        setConfirm(null);
      },
    });

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight tabular-nums text-slate-900">{po.label}</p>
          <p className="truncate text-[15px] font-semibold text-slate-700">
            {po.weaver.name} <span className="font-normal text-slate-400">({po.weaver.shortCode})</span>
          </p>
          <p className="text-sm text-slate-500">
            {po.quality.name} · {formatDate(po.poDate)}
            {po.rate != null && ` · ${formatMoney(po.rate)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PoStatusPill status={po.status} />
          {(canManage || open) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${po.label}`}>
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigate(`/print/outside-po/${po.id}`)}>
                  <Printer className="size-4" /> Print
                </DropdownMenuItem>
                {canManage && po.canEdit && (
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil className="size-4" /> Edit
                  </DropdownMenuItem>
                )}
                {canManage && po.canEdit && (
                  <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm('cancel')}>
                    <Ban className="size-4" /> Cancel
                  </DropdownMenuItem>
                )}
                {canManage && open && (
                  <DropdownMenuItem onSelect={() => setConfirm('close')}>
                    <CheckCircle2 className="size-4" /> Close (nothing more expected)
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <p className="text-[15px] font-semibold text-slate-800">
        {formatPoQty(po.quantity, po.unit)} ordered · {formatPoQty(po.receivedQty, po.unit)} received · {formatPoQty(po.pendingQty, po.unit)} pending
        {po.receivedTakas > 0 && <span className="font-normal text-slate-500"> · {po.receivedTakas} taka{po.receivedTakas === 1 ? '' : 's'}</span>}
      </p>
      {po.notes && <p className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{po.notes}</p>}
      {canReceive && open && (
        <Button size="sm" className="w-fit" onClick={() => navigate(`/outside-pos/${po.id}/receive`)}>
          <PackagePlus /> Receive challan
        </Button>
      )}
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Cancel ${po.label}?`}
        description="Nothing has been received on it. The PO number is kept for the record."
        confirmLabel="Cancel PO"
        destructive
        loading={cancel.isPending}
        onConfirm={() => act(cancel, 'cancelled')}
      />
      <ConfirmDialog
        open={confirm === 'close'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Close ${po.label}?`}
        description="Use this when nothing more is expected on it (it stays as a record of what came)."
        confirmLabel="Close PO"
        loading={close.isPending}
        onConfirm={() => act(close, 'closed')}
      />
    </li>
  );
}

/**
 * Order details → Outside production tab: POs given to an outside weaver (Jenish, Gaurang create / edit them; the
 * godown supervisor and Dhruvil may receive against them too). Shown for orders without Production, and on in-house
 * orders as "Give part outside".
 */
export function OutsideTab({
  orderId,
  orderNo,
  material,
  orderType,
  unit,
}: {
  orderId: number;
  orderNo: number;
  material: { id: number; name: string };
  orderType: OrderOutside['pos'][number]['orderType'];
  unit: Unit;
}) {
  const { can } = useRole();
  const query = useOrderOutside(orderId);
  const canManage = can('canCreateOutsidePo');
  const canReceive = can('canReceiveOutside');
  const [form, setForm] = useState<{ open: boolean; po: OutsidePoCard | null }>({ open: false, po: null });

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  const data = query.data;
  const defaults: PoFormDefaults = { materialId: material.id, materialName: material.name, orderType, meterOrder: unit === 'meters' };

  return (
    <div className="space-y-4">
      {data.pos.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:max-w-2xl sm:grid-cols-4">
          <StatTile label="Open POs" value={data.totals.openPos} />
          <StatTile label="Pcs pending" value={data.totals.pcsPending.toLocaleString('en-IN')} />
          <StatTile label="Meters pending" value={data.totals.metersPending.toLocaleString('en-IN')} />
          <StatTile label="Takas received" value={data.totals.takasReceived} />
        </div>
      )}
      {canManage && (
        <Button onClick={() => setForm({ open: true, po: null })}>
          <Truck /> Create a PO
        </Button>
      )}
      {data.pos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-white">
          <EmptyState
            icon={Package}
            title="No outside POs yet"
            description={canManage ? `Create a PO to give part of Order ${formatOrderNo(orderNo)} to an outside weaver.` : undefined}
            className="py-10"
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
          {data.pos.map((po) => (
            <PoCard key={po.id} po={po} canManage={canManage} canReceive={canReceive} onEdit={() => setForm({ open: true, po })} />
          ))}
        </ul>
      )}
      {data.receipts.length > 0 && (
        <p className="text-sm text-slate-500">
          {data.receipts.length} receipt{data.receipts.length === 1 ? '' : 's'} so far — see the Docs tab for every challan, or the Takas tab for the takas themselves.
        </p>
      )}
      {canManage && <PoFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} orderId={orderId} defaults={defaults} po={form.po} />}
    </div>
  );
}
