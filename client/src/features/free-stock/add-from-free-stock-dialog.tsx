import { Boxes, PackagePlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  blouseMismatchNote,
  cleanPcs,
  formatMeters,
  FREE_STOCK_REASON_LABEL,
  inventoryKey,
  takaStageShortLabel,
  type AssignTargetOrder,
  type BlouseFilter,
  type BlouseOption,
  type FreeStockTaka,
  type OrderType,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { TickBox } from '@/components/ui/tick-box';
import { errorMessage } from '@/lib/api';
import { formatOrderNo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { StageDot } from '../takas/taka-chip';
import { useAddFromFreeStock, useAssignTargets, useItemFreeStock } from './api';
import { BlouseTag, BlouseToggle } from './blouse';

/** The order that receives the free stock. */
export interface FreeStockTarget {
  orderId: number;
  orderNo: number;
  orderType: OrderType;
  designCode: string | null;
  blouseOption: BlouseOption | null;
  /** `d-<id>` | `v-<id>` | `none` — the inventory item whose free stock is offered. */
  itemKey: string;
}

/** Key of an order's inventory item from its design / variation ids. */
export const itemKeyOf = (designId: number | null | undefined, variationId: number | null | undefined) =>
  inventoryKey({ designId: designId ?? null, variationId: variationId ?? null });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The order that gets the stock. Omit and pass `choices` (+ `itemKey`) to pick the order first (Inventory → Assign to order). */
  order?: FreeStockTarget | null;
  choices?: { itemKey: string; designCode: string | null };
  /** Free takas ticked before opening (Inventory → Assign to order). */
  preselectIds?: number[];
  onDone?: () => void;
}

function FreeTakaRow({ t, on, onToggle, orderBlouse }: { t: FreeStockTaka; on: boolean; onToggle: () => void; orderBlouse: BlouseOption | null }) {
  const note = blouseMismatchNote(t.blouseOption, orderBlouse);
  return (
    <li>
      <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors', on ? 'border-primary/50 bg-primary-soft/40' : 'border-border bg-white hover:border-slate-300')}>
        <TickBox size="lg" checked={on} onCheckedChange={onToggle} aria-label={`Add taka ${t.takaNo}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-lg font-bold tabular-nums text-slate-900">{t.takaNo}</span>
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500">
              <StageDot stage={t.stage} className="ring-0" /> {takaStageShortLabel(t.stage)}
            </span>
            <BlouseTag option={t.blouseOption} />
            {note && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-amber-800">{note}</span>}
          </span>
          <span className="block text-[13px] tabular-nums text-slate-500">
            {t.pcs != null ? `${t.pcs} pcs` : 'no pcs'}
            {t.meters != null && ` · ${formatMeters(t.meters)}`} · from Order {formatOrderNo(t.fromOrderNo)}
            {t.reason && ` · ${FREE_STOCK_REASON_LABEL[t.reason]}`}
            {t.isDamaged && <span className="font-semibold text-red-600"> · damaged</span>}
          </span>
        </span>
      </label>
    </li>
  );
}

/**
 * Add from free stock: free stock of the same design is assigned to an order. Lump orders tick free takas (with pcs,
 * meters, stage, blouse option and origin order; a different blouse option gets an amber note); pcs-to-pcs orders enter
 * a pcs count (picked and split by the system).
 */
export function AddFromFreeStockDialog({ open, onOpenChange, order: fixed, choices, preselectIds, onDone }: Props) {
  const [chosen, setChosen] = useState<AssignTargetOrder | null>(null);
  const target: FreeStockTarget | null = fixed
    ? fixed
    : chosen && choices
      ? { orderId: chosen.orderId, orderNo: chosen.orderNo, orderType: chosen.orderType, designCode: choices.designCode, blouseOption: chosen.blouseOption, itemKey: choices.itemKey }
      : null;
  const targets = useAssignTargets(choices?.itemKey ?? '', open && !fixed && !!choices);
  const free = useItemFreeStock(target?.itemKey ?? choices?.itemKey ?? '', 'all', open && (!!target || !!choices));
  const add = useAddFromFreeStock(target?.orderId ?? 0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pcsText, setPcsText] = useState('');
  const [blouse, setBlouse] = useState<BlouseFilter>('all');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setChosen(null);
    setPicked(new Set(preselectIds ?? []));
    setPcsText('');
    setBlouse('all');
    setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lump = target?.orderType === 'lump';
  const takas = free.data?.takas ?? [];
  // The free takas of this item that are still there (a preselected one may have been taken meanwhile).
  const shown = useMemo(() => takas, [takas]);
  const pickedTakas = shown.filter((t) => picked.has(t.id));
  const pickedPcs = pickedTakas.reduce((n, t) => n + (t.pcs ?? 0), 0);
  const readyPcs = useMemo(
    () => takas.filter((t) => t.stage === 'final' && (blouse === 'all' || (blouse === 'not_set' ? !t.blouseOption : t.blouseOption === blouse))).reduce((n, t) => n + (t.pcs ?? 0), 0),
    [takas, blouse],
  );
  const pcs = /^\d+$/.test(pcsText) ? Number(pcsText) : 0;

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    if (!target) return;
    if (!lump) {
      if (pcs < 1) return setError('Enter how many pcs');
      if (pcs > readyPcs) return setError(readyPcs > 0 ? `Only ${readyPcs.toLocaleString('en-IN')} pcs of free stock are ready` : 'There is no ready free stock for this design');
    }
    add.mutate(lump ? { takaIds: [...picked] } : { pcs, ...(blouse !== 'all' ? { blouse } : {}) }, {
      onSuccess: (r) => {
        toast.success(lump ? `${r.takas} ${r.takas === 1 ? 'taka' : 'takas'} added to Order ${formatOrderNo(target.orderNo)}` : `${r.pcs} pcs added to Order ${formatOrderNo(target.orderNo)}`);
        onOpenChange(false);
        onDone?.();
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const needsOrder = !fixed && !target;

  let body;
  if (needsOrder) {
    body = targets.isPending ? (
      <div className="space-y-2">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    ) : !targets.data?.length ? (
      <p className="py-6 text-center text-sm text-slate-500">No order of this design can take free stock right now (a dispatched order can't).</p>
    ) : (
      <ul className="space-y-2 pb-1">
        {targets.data.map((o) => (
          <li key={o.orderId}>
            <button
              type="button"
              onClick={() => setChosen(o)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left shadow-soft transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
            >
              <span className="min-w-0">
                <span className="block text-lg font-bold text-slate-900">Order {formatOrderNo(o.orderNo)}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
                  {o.customerName && <span className="truncate">{o.customerName}</span>}
                  <BlouseTag option={o.blouseOption} />
                </span>
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums text-slate-600">{o.orderedPcs.toLocaleString('en-IN')} ordered</span>
            </button>
          </li>
        ))}
      </ul>
    );
  } else if (free.isPending) {
    body = (
      <div className="space-y-2">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  } else if (!takas.length) {
    body = <EmptyState icon={Boxes} title="No free stock" description="Nothing for this design is free right now." className="py-8" />;
  } else if (lump) {
    body = (
      <div className="space-y-3 pb-1">
        <p className="text-[13px] text-slate-500">Tick the free takas to add to Order {formatOrderNo(target!.orderNo)}. They keep their stage and continue from there.</p>
        <ul className="space-y-2">
          {shown.map((t) => (
            <FreeTakaRow key={t.id} t={t} on={picked.has(t.id)} onToggle={() => toggle(t.id)} orderBlouse={target!.blouseOption} />
          ))}
        </ul>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4 pb-1">
        <BlouseToggle value={blouse} onChange={setBlouse} counts={free.data?.blouseCounts ?? {}} />
        <Field
          label="How many pcs to add?"
          htmlFor="add-free-pcs"
          required
          error={error}
          hint={`${readyPcs.toLocaleString('en-IN')} pcs of ready free stock${blouse !== 'all' ? ` · ${blouse === 'not_set' ? 'blouse not set' : blouse === 'with_blouse' ? 'with blouse' : 'without blouse'}` : ''}`}
        >
          <Input
            id="add-free-pcs"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pcsText}
            invalid={!!error}
            className="h-12 text-lg font-bold tabular-nums"
            placeholder="0"
            onChange={(e) => {
              setPcsText(cleanPcs(e.target.value));
              setError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
          />
        </Field>
        {target!.blouseOption && blouse === 'all' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            This order is <strong>{target!.blouseOption === 'with_blouse' ? 'with blouse' : 'without blouse'}</strong>. Pick the matching option above to avoid mixing.
          </p>
        )}
      </div>
    );
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !add.isPending && onOpenChange(o)}
      title="Add from free stock"
      description={target ? `Order ${formatOrderNo(target.orderNo)}${target.designCode ? ` · ${target.designCode}` : ''}` : choices?.designCode ? `Design ${choices.designCode}` : undefined}
      desktopVariant="center"
      mobileVariant="bottom"
      size="md"
      dismissible={!add.isPending}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" className="h-12" disabled={add.isPending} onClick={() => (!fixed && chosen ? setChosen(null) : onOpenChange(false))}>
            {!fixed && chosen ? 'Back' : 'Cancel'}
          </Button>
          {!needsOrder && (
            <Button
              size="lg"
              className="h-12"
              onClick={save}
              loading={add.isPending}
              disabled={free.isPending || (lump ? picked.size === 0 || !pickedTakas.length : !takas.length)}
            >
              <PackagePlus /> {lump ? `Add ${pickedTakas.length || ''} ${pickedTakas.length === 1 ? 'taka' : 'takas'}${pickedPcs ? ` · ${pickedPcs} pcs` : ''}`.replace(/\s+/g, ' ').trim() : 'Add to order'}
            </Button>
          )}
        </div>
      }
    >
      {body}
    </ResponsiveModal>
  );
}
