import { useState } from 'react';
import { toast } from 'sonner';
import { formatPcs, sendBackSummaryLines, takaActualPcs, type Taka } from '@rivoora/shared';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useSendBackTakas } from './api';

export type SendBackTarget = 'butta' | 'mill';

/**
 * Confirm "Send back to butta cutting / the mill": the taka count, pcs, one short line per current stage and an
 * optional note. One request; the server moves them all or none.
 */
export function SendBackDialog({
  orderId,
  target,
  takas,
  onClose,
  onDone,
}: {
  orderId: number;
  target: SendBackTarget | null;
  takas: Taka[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const send = useSendBackTakas(orderId);
  const where = target === 'butta' ? 'butta cutting' : 'the mill';
  const pcs = takas.reduce((n, t) => n + (takaActualPcs(t) ?? 0), 0);
  const lines = sendBackSummaryLines(takas);

  const confirm = () => {
    if (!target) return;
    send.mutate(
      { takaIds: takas.map((t) => t.id), target, note: note.trim() || undefined },
      {
        onSuccess: (r) => {
          toast.success(`${r.sent} taka${r.sent === 1 ? '' : 's'} sent back to ${where}`);
          setNote('');
          onDone();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Modal
      open={target !== null}
      onOpenChange={(o) => !o && !send.isPending && onClose()}
      title={`Send back to ${where}`}
      size="sm"
      dismissible={!send.isPending}
      bodyClassName="py-4"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button onClick={confirm} loading={send.isPending} autoFocus>
            Send back
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-baseline gap-6">
          <p>
            <span className="text-3xl font-bold tabular-nums text-slate-900">{takas.length}</span>
            <span className="ml-1.5 text-sm text-muted-foreground">taka{takas.length === 1 ? '' : 's'}</span>
          </p>
          <p className="text-lg font-semibold tabular-nums text-slate-600">{formatPcs(pcs)}</p>
        </div>
        {lines.length > 0 && <p className="text-[15px] text-slate-600">{lines.join(', ')}</p>}
        <label className="block text-sm font-semibold text-slate-700">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
          <Textarea className="mt-1.5" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
