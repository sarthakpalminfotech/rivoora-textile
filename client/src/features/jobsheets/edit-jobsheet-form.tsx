import { zodResolver } from '@hookform/resolvers/zod';
import { ListChecks } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { coverageWarnings, jobsheetRefShort, planFramesEdit, type JobsheetDetail, type JobsheetUpdateResult } from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, NumberInput } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useJobsheet, useUpdateJobsheet } from './api';
import { intField, MachinesSelect, parseIntOrNull, WarningList } from './parts';

const schema = z.object({
  frames: intField('the frames', 100_000),
  picks: z.string().trim().max(20, 'Picks must be at most 20 characters'),
  machineIds: z.array(z.number()).min(1, 'Select at least one machine'),
});
type FormValues = z.infer<typeof schema>;

/** Human-readable "What will change" lines + coverage warnings for a frames edit (shared calculation). */
export function describeFramesEdit(js: JobsheetDetail, newFrames: number | null) {
  if (newFrames === null || newFrames === js.frames || !js.order || !js.coverage) return null;
  // Only Pending jobsheets are adjusted; the last PENDING one absorbs the change.
  const plan = planFramesEdit({
    jobsheets: js.siblings,
    editedId: js.id,
    newFrames,
    framesPerJobsheet: js.order.framesPerJobsheet,
  });
  const lastId = plan.last.id;
  const lines = [
    ...plan.updated.map(
      (u) => `${jobsheetRefShort(js.orderNo, u.jobsheetNo)}${u.id === lastId && !u.edited ? ' (last pending)' : ''}: ${u.from} → ${u.to} frames`,
    ),
    ...plan.created.map((c) => `New jobsheet will be created with ${c.frames} frame${c.frames === 1 ? '' : 's'}`),
    ...plan.removed.map((r) => `${jobsheetRefShort(js.orderNo, r.jobsheetNo)} will be removed`),
  ];
  const warnings = coverageWarnings({
    ...js.coverage,
    totalFrames: plan.totalFramesAfter,
    jobsheetCount: js.siblings.length + plan.created.length - plan.removed.length,
  })
    // Editing the last jobsheet upwards is fine — no "more than needed" warning there.
    .filter((w) => !(plan.editedIsLast && w.kind === 'frames_over'))
    .map((w) => w.message);
  return { lines, warnings, totalAfter: plan.totalFramesAfter };
}

/** Toasts summarising what the server changed. */
export function toastUpdateResult(res: JobsheetUpdateResult, jobsheetNo: number) {
  const messages = [
    ...res.updated.map((u) => `${jobsheetRefShort(res.orderNo, u.jobsheetNo)} changed to ${u.to} frame${u.to === 1 ? '' : 's'}`),
    ...res.created.map((c) => `New jobsheet ${jobsheetRefShort(res.orderNo, c.jobsheetNo)} created (${c.frames} frame${c.frames === 1 ? '' : 's'})`),
    ...res.removed.map((r) => `${jobsheetRefShort(res.orderNo, r.jobsheetNo)} removed`),
  ];
  if (messages.length === 0) messages.push(res.detailsChanged ? `${jobsheetRefShort(res.orderNo, jobsheetNo)} updated` : 'No changes');
  messages.forEach((m) => toast.success(m));
}

type UpdateMutation = ReturnType<typeof useUpdateJobsheet>;

function EditForm({ js, onDone, formId, update }: { js: JobsheetDetail; onDone: () => void; formId: string; update: UpdateMutation }) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { frames: String(js.frames), picks: js.picks ?? '', machineIds: js.machines.map((m) => m.id) },
  });

  const framesText = useWatch({ control, name: 'frames' });
  const preview = useMemo(() => describeFramesEdit(js, parseIntOrNull(framesText)), [js, framesText]);

  const onSubmit = handleSubmit((v) =>
    update.mutate(
      { frames: Number(v.frames), picks: v.picks, machineIds: v.machineIds },
      {
        onSuccess: (res) => {
          toastUpdateResult(res, js.jobsheetNo);
          onDone();
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['frames', 'picks', 'machineIds'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Frames" htmlFor="jse-frames" required error={errors.frames?.message}>
          <NumberInput id="jse-frames" inputMode="numeric" autoFocus invalid={!!errors.frames} {...register('frames')} />
        </Field>
        <Field label="Picks" htmlFor="jse-picks" error={errors.picks?.message}>
          <Input id="jse-picks" placeholder="e.g. 72" invalid={!!errors.picks} {...register('picks')} />
        </Field>
        <Field
          label="Machines"
          htmlFor="jse-machines"
          required
          error={errors.machineIds?.message}
          hint="Picks and machines only change this jobsheet."
          className="sm:col-span-2"
        >
          <Controller
            control={control}
            name="machineIds"
            render={({ field }) => (
              <MachinesSelect
                id="jse-machines"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.machineIds}
                assigned={js.machines}
              />
            )}
          />
        </Field>
      </div>

      {preview && (
        <section className="rounded-xl border border-border bg-slate-50/70 p-4" aria-live="polite">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <ListChecks className="size-4" aria-hidden /> What will change
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-[15px] text-slate-700 marker:text-slate-400">
            {preview.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-slate-500">
            Frames in jobsheets after saving: {preview.totalAfter} (needed: {js.order?.targetFrames ?? 0})
          </p>
          <WarningList messages={preview.warnings} className="mt-3" />
        </section>
      )}
    </form>
  );
}

/** Full-screen edit of a jobsheet. Pass `null` to close. */
export function EditJobsheetDialog({ jobsheetId, onOpenChange }: { jobsheetId: number | null; onOpenChange: (open: boolean) => void }) {
  const open = jobsheetId !== null;
  const q = useJobsheet(jobsheetId ?? 0);
  const js = q.data;
  const update = useUpdateJobsheet(js?.id ?? 0, js?.order?.id ?? 0);
  const formId = 'jobsheet-edit-form';
  const ready = js && js.id === jobsheetId ? js : null;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !update.isPending && onOpenChange(o)}
      title={js ? `Edit jobsheet ${jobsheetRefShort(js.orderNo, js.jobsheetNo)}` : 'Edit jobsheet'}
      dismissible={false}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!ready} loading={update.isPending}>
            Save changes
          </Button>
        </div>
      }
    >
      {q.isError && !ready ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !ready ? (
        <div className="grid gap-4">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : (
        <EditForm key={`${ready.id}-${ready.updatedAt}`} js={ready} formId={formId} update={update} onDone={() => onOpenChange(false)} />
      )}
    </ResponsiveModal>
  );
}
