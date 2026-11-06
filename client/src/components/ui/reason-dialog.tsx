import { useEffect, useState, type ReactNode } from 'react';
import { REASON_MAX, REASON_MIN } from '@rivoora/shared';
import { Button } from './button';
import { Field } from './field';
import { Textarea } from './input';
import { Modal } from './modal';

/**
 * Sprint 21: THE dialog every "why?" action uses (undo send back, undo QC, cancel refinish, remove from challan, mark
 * lost, undo dispatch …): a short explanation of what will happen, and a required reason (min 3, max 300 characters).
 * `onConfirm` gets the trimmed reason; keep the dialog open on failure and pass `error`.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  destructive,
  loading,
  error,
  reasonLabel = 'Reason',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen (lines, counts …). */
  children?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  error?: string | null;
  reasonLabel?: string;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);
  const trimmed = reason.trim();
  const tooShort = trimmed.length < REASON_MIN;
  const submit = () => {
    setTouched(true);
    if (tooShort) return;
    onConfirm(trimmed);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !loading && onOpenChange(o)}
      title={title}
      size="sm"
      dismissible={!loading}
      bodyClassName="py-4"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={submit} loading={loading} disabled={touched && tooShort}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {children && <div className="text-[15px] leading-relaxed text-slate-700">{children}</div>}
        <Field
          label={reasonLabel}
          htmlFor="reason-text"
          required
          error={touched && tooShort ? `Write at least ${REASON_MIN} characters` : (error ?? undefined)}
          hint={`${trimmed.length}/${REASON_MAX}`}
        >
          <Textarea
            id="reason-text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={REASON_MAX}
            rows={3}
            disabled={loading}
            autoFocus
            aria-invalid={(touched && tooShort) || undefined}
          />
        </Field>
      </div>
    </Modal>
  );
}
