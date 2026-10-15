import { Boxes } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cleanPcs, formatMeters, movePcsConfirmText, takaActualPcs } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { useMoveToInventory } from './api';

export interface MovableTaka {
  id: number;
  takaNo: string;
  pcs: number | null;
  actualPcs?: number | null;
  meters: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderNo: number;
  designCode: string | null;
  /** Lump orders: the ticked takas. Pcs-to-pcs orders: omit and pass `availablePcs`. */
  takas?: MovableTaka[];
  /** Pcs-to-pcs: the pcs in the order's godown stages (final + ready for dispatch). */
  availablePcs?: number;
  onDone?: () => void;
}

/**
 * Move to inventory. Lump: confirm the ticked takas (count, pcs, meters). Pcs to pcs: "How many pcs to move to
 * inventory?" (1 to the pcs in the godown) and confirm with pcs only — the system picks (and splits) the takas.
 */
export function MoveToInventoryDialog({ open, onOpenChange, orderId, orderNo, designCode, takas, availablePcs = 0, onDone }: Props) {
  const lump = !!takas;
  const move = useMoveToInventory(orderId);
  const [pcsText, setPcsText] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (open) {
      setPcsText('');
      setStep('enter');
      setNote('');
      setError(undefined);
    }
  }, [open]);

  const pcs = /^\d+$/.test(pcsText) ? Number(pcsText) : 0;
  const totalPcs = (takas ?? []).reduce((n, t) => n + (takaActualPcs(t) ?? 0), 0);
  const totalMeters = (takas ?? []).reduce((n, t) => n + (t.meters ?? 0), 0);
  const showConfirm = lump || step === 'confirm';
  const item = designCode ?? 'this design';

  const review = () => {
    if (pcs < 1) return setError('Enter how many pcs');
    if (pcs > availablePcs) return setError(availablePcs > 0 ? `Only ${availablePcs.toLocaleString('en-IN')} pcs are in the godown` : 'There are no pcs in the godown for this order');
    setError(undefined);
    setStep('confirm');
  };

  const save = () => {
    move.mutate(lump ? { takaIds: takas!.map((t) => t.id), note: note.trim() || undefined } : { pcs, note: note.trim() || undefined }, {
      onSuccess: (r) => {
        toast.success(lump ? `${r.takas} ${r.takas === 1 ? 'taka' : 'takas'} moved to inventory` : `${r.pcs} pcs moved to inventory`);
        onOpenChange(false);
        onDone?.();
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !move.isPending && onOpenChange(o)}
      title="Move to inventory"
      description={`Order #${orderNo}`}
      desktopVariant="center"
      mobileVariant="bottom"
      size="md"
      dismissible={!move.isPending}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button
            variant="secondary"
            size="lg"
            className="h-12"
            disabled={move.isPending}
            onClick={() => (!lump && step === 'confirm' ? setStep('enter') : onOpenChange(false))}
          >
            {!lump && step === 'confirm' ? 'Back' : 'Cancel'}
          </Button>
          {showConfirm ? (
            <Button size="lg" className="h-12" onClick={save} loading={move.isPending} disabled={lump && takas!.length === 0}>
              <Boxes /> Move to inventory
            </Button>
          ) : (
            <Button size="lg" className="h-12" onClick={review}>
              Continue
            </Button>
          )}
        </div>
      }
    >
      {showConfirm ? (
        <div className="space-y-4 pb-1">
          {lump ? (
            <dl className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
              <div>
                <dt className="text-[12px] text-muted-foreground">Takas</dt>
                <dd className="text-2xl font-bold tabular-nums text-slate-900">{takas!.length}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Pcs</dt>
                <dd className="text-2xl font-bold tabular-nums text-slate-900">{totalPcs.toLocaleString('en-IN')}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Meters</dt>
                <dd className="text-2xl font-bold tabular-nums text-slate-900">{totalMeters > 0 ? formatMeters(totalMeters).replace(/\s*m$/, '') : '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="rounded-xl bg-slate-50 p-4 text-center text-3xl font-bold tabular-nums text-slate-900">
              {pcs.toLocaleString('en-IN')} <span className="text-base font-semibold text-slate-500">pcs</span>
            </p>
          )}
          <p className="text-[15px] font-medium text-slate-700">
            {lump ? `These takas will leave Order #${orderNo} and become free stock for ${item}` : `${movePcsConfirmText(pcs, orderNo)} for ${item}`}
          </p>
          <p className="text-[13px] text-slate-500">Free stock is not attached to any order. You can use it later for any order of the same design.</p>
          <Field label="Note" hint="Optional">
            <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="space-y-3 pb-1">
          <Field
            label="How many pcs to move to inventory?"
            htmlFor="move-pcs"
            required
            error={error}
            hint={availablePcs > 0 ? `1 to ${availablePcs.toLocaleString('en-IN')} (pcs in the godown)` : undefined}
          >
            <Input
              id="move-pcs"
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
                  review();
                }
              }}
            />
          </Field>
        </div>
      )}
    </ResponsiveModal>
  );
}
