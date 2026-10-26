import { zodResolver } from '@hookform/resolvers/zod';
import { Calculator } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  describeFrameGroups,
  formatExactFrames,
  framesForPieces,
  jobsheetQuantityWarning,
  jobsheetRefShort,
  MAX_JOBSHEETS_PER_RUN,
  piecesForFrames,
  planJobsheets,
  remainingPieces,
  SECTIONS_PER_BEAM,
  type OrderJobsheets,
} from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { NumberInput } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { formatOrderNo } from '@/lib/format';
import { applyServerFieldError } from '@/lib/form';
import { useAddJobsheet, useGenerateJobsheets } from './api';
import { intField, MachinesSelect, parseIntOrNull, WarningList } from './parts';

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The order's jobsheets + coverage (from GET /orders/:id/jobsheets). */
  data: OrderJobsheets;
}

const machinesField = z.array(z.number()).min(1, 'Select at least one machine');

function FormFooter({ formId, onCancel, pending, disabled, label }: { formId: string; onCancel: () => void; pending: boolean; disabled: boolean; label: string }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
      <Button variant="secondary" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={pending} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create jobsheets (multi)                                             */
/* ------------------------------------------------------------------ */

const multiSchema = z
  .object({
    pieces: intField('the number of pieces'),
    framesPerJobsheet: intField('the frames per jobsheet', 100_000),
    machineIds: machinesField,
  })
  .superRefine((v, ctx) => {
    const plan = planJobsheets(Number(v.pieces), Number(v.framesPerJobsheet));
    if (plan && plan.jobsheetCount > MAX_JOBSHEETS_PER_RUN) {
      ctx.addIssue({
        code: 'custom',
        path: ['framesPerJobsheet'],
        message: `That makes ${plan.jobsheetCount} jobsheets (max ${MAX_JOBSHEETS_PER_RUN}). Increase the frames per jobsheet.`,
      });
    }
  });
type MultiValues = z.infer<typeof multiSchema>;

export function CreateJobsheetsDialog({ open, onOpenChange, data }: FormDialogProps) {
  const generate = useGenerateJobsheets(data.orderId);
  const { coverage } = data;
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isValid },
  } = useForm<MultiValues>({ resolver: zodResolver(multiSchema), mode: 'onChange' });

  useEffect(() => {
    if (!open) return;
    const prefill = remainingPieces(coverage.orderedPieces, coverage.jobsheetPieces);
    reset({
      pieces: prefill ? String(prefill) : '',
      framesPerJobsheet: data.framesPerJobsheet ? String(data.framesPerJobsheet) : '',
      machineIds: [],
    });
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [piecesText, fpjText] = useWatch({ control, name: ['pieces', 'framesPerJobsheet'] });
  const pieces = parseIntOrNull(piecesText);
  const plan = pieces && parseIntOrNull(fpjText) ? planJobsheets(pieces, Number(fpjText)) : null;
  // Live: the frames already in the active jobsheets + the frames of this run (Sprint 15).
  const qtyWarning = pieces ? jobsheetQuantityWarning(coverage.orderedPieces, coverage.jobsheetPieces, framesForPieces(pieces)) : null;

  const onSubmit = handleSubmit((v) =>
    generate.mutate(
      { pieces: Number(v.pieces), framesPerJobsheet: Number(v.framesPerJobsheet), machineIds: v.machineIds },
      {
        onSuccess: ({ created, orderNo }) => {
          const first = created[0]?.jobsheetNo;
          const last = created[created.length - 1]?.jobsheetNo;
          toast.success(
            created.length === 1
              ? `1 jobsheet created (${jobsheetRefShort(orderNo, first)})`
              : `${created.length} jobsheets created (#${orderNo}: ${first}–${last})`,
          );
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['pieces', 'framesPerJobsheet', 'machineIds'])) {
            toast.error(errorMessage(err));
          }
        },
      },
    ),
  );

  const count = plan?.jobsheetCount;
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !generate.isPending && onOpenChange(o)}
      title={`Create jobsheets — Order ${formatOrderNo(data.orderNo)}`}
      dismissible={!isDirty}
      footer={
        <FormFooter
          formId="jobsheets-create-form"
          onCancel={() => onOpenChange(false)}
          pending={generate.isPending}
          disabled={!isValid}
          label={count ? `Create ${count} jobsheet${count === 1 ? '' : 's'}` : 'Create jobsheets'}
        />
      }
    >
      <form id="jobsheets-create-form" onSubmit={onSubmit} noValidate className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Number of pieces"
            htmlFor="js-pieces"
            required
            error={errors.pieces?.message}
            hint={`Order quantity: ${coverage.orderedPieces} pcs`}
          >
            <NumberInput id="js-pieces" inputMode="numeric" autoFocus placeholder="e.g. 300" suffix={<span className="pr-1.5 text-sm text-slate-400">pcs</span>} invalid={!!errors.pieces} {...register('pieces')} />
          </Field>
          <Field
            label="Number of frames per jobsheet"
            htmlFor="js-fpj"
            required
            error={errors.framesPerJobsheet?.message}
            className="sm:col-span-2"
          >
            <NumberInput id="js-fpj" inputMode="numeric" placeholder="e.g. 10" invalid={!!errors.framesPerJobsheet} {...register('framesPerJobsheet')} />
          </Field>
          <Field
            label="Machines"
            htmlFor="js-machines"
            required
            error={errors.machineIds?.message}
            hint="Applied to all jobsheets; you can change machines per jobsheet later."
            className="sm:col-span-2"
          >
            <Controller
              control={control}
              name="machineIds"
              render={({ field }) => (
                <MachinesSelect id="js-machines" value={field.value ?? []} onChange={field.onChange} invalid={!!errors.machineIds} />
              )}
            />
          </Field>
        </div>

        {qtyWarning && <WarningList messages={[qtyWarning]} />}

        <section className="rounded-xl border border-border bg-slate-50/70 p-4" aria-live="polite">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <Calculator className="size-4" aria-hidden /> Preview
          </h3>
          {plan ? (
            <div className="space-y-1.5 text-[15px] text-slate-700">
              <p>
                {plan.pieces} pcs ÷ {SECTIONS_PER_BEAM} sections ={' '}
                {Number.isInteger(plan.exactFrames) ? (
                  <strong className="text-slate-900">{plan.totalFrames} frames</strong>
                ) : (
                  <>
                    {formatExactFrames(plan.exactFrames)} → <strong className="text-slate-900">{plan.totalFrames} frames</strong>
                  </>
                )}
              </p>
              <p>
                <strong className="text-slate-900">
                  {plan.jobsheetCount} jobsheet{plan.jobsheetCount === 1 ? '' : 's'}
                </strong>
                : {describeFrameGroups(plan.frames)}
              </p>
              {coverage.jobsheetCount > 0 && (
                <p className="text-slate-500">
                  Total after this run: {coverage.jobsheetCount + plan.jobsheetCount} jobsheets,{' '}
                  {coverage.totalFrames + plan.totalFrames} frames
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Enter the pieces and frames per jobsheet to see the jobsheets.</p>
          )}
        </section>
      </form>
    </ResponsiveModal>
  );
}

/* ------------------------------------------------------------------ */
/* Add single jobsheet                                                  */
/* ------------------------------------------------------------------ */

const singleSchema = z.object({
  frames: intField('the frames', 100_000),
  machineIds: machinesField,
});
type SingleValues = z.infer<typeof singleSchema>;

export function AddJobsheetDialog({ open, onOpenChange, data }: FormDialogProps) {
  const add = useAddJobsheet(data.orderId);
  const { coverage } = data;
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isValid },
  } = useForm<SingleValues>({ resolver: zodResolver(singleSchema), mode: 'onChange' });

  useEffect(() => {
    if (!open) return;
    reset({ frames: '', machineIds: [] });
  }, [open, reset]);

  // Pieces are read-only: frames × sections per beam, so the stored numbers can never disagree.
  const framesText = useWatch({ control, name: 'frames' });
  const frames = parseIntOrNull(framesText);
  const qtyWarning = frames ? jobsheetQuantityWarning(coverage.orderedPieces, coverage.jobsheetPieces, frames) : null;

  const onSubmit = handleSubmit((v) =>
    add.mutate(
      { frames: Number(v.frames), machineIds: v.machineIds },
      {
        onSuccess: ({ created, orderNo }) => {
          toast.success(`Jobsheet ${jobsheetRefShort(orderNo, created[0]?.jobsheetNo)} created`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['frames', 'machineIds'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !add.isPending && onOpenChange(o)}
      title={`Add jobsheet — Order ${formatOrderNo(data.orderNo)}`}
      dismissible={!isDirty}
      footer={
        <FormFooter
          formId="jobsheet-add-form"
          onCancel={() => onOpenChange(false)}
          pending={add.isPending}
          disabled={!isValid}
          label="Add jobsheet"
        />
      }
    >
      <form id="jobsheet-add-form" onSubmit={onSubmit} noValidate className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Frames" htmlFor="js1-frames" required error={errors.frames?.message}>
            <NumberInput id="js1-frames" inputMode="numeric" autoFocus placeholder="e.g. 10" invalid={!!errors.frames} {...register('frames')} />
          </Field>
          <Field label="Pieces" htmlFor="js1-pieces" hint={`Frames × ${SECTIONS_PER_BEAM}`}>
            <NumberInput
              id="js1-pieces"
              readOnly
              tabIndex={-1}
              value={frames ? String(piecesForFrames(frames)) : ''}
              placeholder="—"
              suffix={<span className="pr-1.5 text-sm text-slate-400">pcs</span>}
              className="bg-slate-50 text-slate-600"
            />
          </Field>
          <Field label="Machines" htmlFor="js1-machines" required error={errors.machineIds?.message} className="sm:col-span-2">
            <Controller
              control={control}
              name="machineIds"
              render={({ field }) => (
                <MachinesSelect id="js1-machines" value={field.value ?? []} onChange={field.onChange} invalid={!!errors.machineIds} />
              )}
            />
          </Field>
        </div>
        {qtyWarning && <WarningList messages={[qtyWarning]} />}
      </form>
    </ResponsiveModal>
  );
}
