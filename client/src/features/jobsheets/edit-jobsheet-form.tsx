import { zodResolver } from '@hookform/resolvers/zod';
import { ListChecks } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  coverageWarnings,
  coverageWarningsMeters,
  formatQty,
  isMeterOrder,
  jobsheetRefShort,
  orderJobsheetMetersPlan,
  orderJobsheetPlan,
  planFramesEdit,
  planMetersEdit,
  quantityForUnits,
  type Coverage,
  type JobsheetDetail,
  type JobsheetUpdateResult,
  type MetersCoverage,
} from '@rivoora/shared';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { NumberInput } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useJobsheet, useUpdateJobsheet } from './api';
import { decimalField, intField, MachinesSelect, parseDecimalOrNull, parseIntOrNull, sectionsField, WarningList } from './parts';

const schema = z.object({
  frames: intField('the frames', 100_000),
  sections: sectionsField,
  machineIds: z.array(z.number()).min(1, 'Select at least one machine'),
});
type FormValues = z.infer<typeof schema>;

const metersSchema = z.object({
  meters: decimalField('the metres', 100_000),
  sections: sectionsField,
  machineIds: z.array(z.number()).min(1, 'Select at least one machine'),
});
type MetersFormValues = z.infer<typeof metersSchema>;

/** Human-readable "What will change" lines + coverage warnings for a frames edit (shared calculation). */
export function describeFramesEdit(js: JobsheetDetail, newFrames: number | null, newSections: number | null = js.sections) {
  const sections = newSections ?? js.sections;
  if (newFrames === null || (newFrames === js.frames && sections === js.sections) || !js.order || !js.coverage) return null;
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
    ...(sections !== js.sections ? [`Sections per beam: ${js.sections} → ${sections} (${newFrames * sections} pcs on this jobsheet)`] : []),
  ];
  // Sprint 18: the jobsheets as they will be (frames AND each one's sections), through the shared plan.
  const removed = new Set(plan.removed.map((r) => r.id));
  const lastSections = plan.last.id === js.id ? sections : (js.siblings.find((x) => x.id === plan.last.id)?.sections ?? js.sections);
  const after = [
    ...js.siblings
      .filter((x) => !removed.has(x.id))
      .map((x) => ({
        ...x,
        frames: plan.updated.find((u) => u.id === x.id)?.to ?? x.frames,
        sections: x.id === js.id ? sections : x.sections,
      })),
    ...plan.created.map((c, i) => ({ frames: c.frames, sections: lastSections, jobsheetNo: Number.MAX_SAFE_INTEGER - plan.created.length + i })),
  ];
  const afterPlan = orderJobsheetPlan((js.coverage as Coverage).orderedPieces, after);
  const warnings = coverageWarnings(afterPlan)
    // Editing the last jobsheet upwards is fine — no "more than needed" warning there.
    .filter((w) => !(plan.editedIsLast && w.kind === 'frames_over'))
    .map((w) => w.message);
  return { lines, warnings, totalAfter: plan.totalFramesAfter, pcsAfter: afterPlan.jobsheetPieces, neededFrames: afterPlan.targetFrames };
}

/** Sprint 19: the meter twin of `describeFramesEdit`. */
export function describeMetersEdit(js: JobsheetDetail, newMeters: number | null, newSections: number | null = js.sections) {
  const sections = newSections ?? js.sections;
  if (newMeters === null || (newMeters === js.meters && sections === js.sections) || !js.order || !js.coverage) return null;
  const plan = planMetersEdit({
    jobsheets: js.siblings,
    editedId: js.id,
    newMeters,
    metersPerJobsheet: js.order.metersPerJobsheet,
  });
  const lastId = plan.last.id;
  const lines = [
    ...plan.updated.map(
      (u) => `${jobsheetRefShort(js.orderNo, u.jobsheetNo)}${u.id === lastId && !u.edited ? ' (last pending)' : ''}: ${formatQty(u.from, 'meters')} → ${formatQty(u.to, 'meters')}`,
    ),
    ...plan.created.map((c) => `New jobsheet will be created with ${formatQty(c.meters, 'meters')}`),
    ...plan.removed.map((r) => `${jobsheetRefShort(js.orderNo, r.jobsheetNo)} will be removed`),
    ...(sections !== js.sections
      ? [`Sections per beam: ${js.sections} → ${sections} (${formatQty(quantityForUnits(newMeters, sections, 'meters'), 'meters')} cloth on this jobsheet)`]
      : []),
  ];
  const removed = new Set(plan.removed.map((r) => r.id));
  const lastSections = plan.last.id === js.id ? sections : (js.siblings.find((x) => x.id === plan.last.id)?.sections ?? js.sections);
  const after = [
    ...js.siblings
      .filter((x) => !removed.has(x.id))
      .map((x) => ({
        ...x,
        meters: plan.updated.find((u) => u.id === x.id)?.to ?? (x.meters ?? 0),
        sections: x.id === js.id ? sections : x.sections,
      })),
    ...plan.created.map((c, i) => ({ meters: c.meters, sections: lastSections, jobsheetNo: Number.MAX_SAFE_INTEGER - plan.created.length + i })),
  ];
  // `js.coverage.neededMeters` is already net of outside meters (computed once by the server) — pass 0 here.
  const afterPlan = orderJobsheetMetersPlan((js.coverage as MetersCoverage).neededMeters, 0, after);
  const warnings = coverageWarningsMeters(afterPlan)
    .filter((w) => !(plan.editedIsLast && w.kind === 'frames_over'))
    .map((w) => w.message);
  return { lines, warnings, totalAfter: plan.totalMetersAfter, clothAfter: afterPlan.jobsheetClothMeters, neededLoomMeters: afterPlan.targetLoomMeters };
}

/** Toasts summarising what the server changed. */
export function toastUpdateResult(res: JobsheetUpdateResult, jobsheetNo: number, meterOrder = false) {
  const qty = (n: number) => (meterOrder ? formatQty(n, 'meters') : `${n} frame${n === 1 ? '' : 's'}`);
  const messages = [
    ...res.updated.map((u) => `${jobsheetRefShort(res.orderNo, u.jobsheetNo)} changed to ${qty(u.to)}`),
    ...res.created.map((c) => `New jobsheet ${jobsheetRefShort(res.orderNo, c.jobsheetNo)} created (${qty(meterOrder ? (c.meters ?? 0) : c.frames)})`),
    ...res.removed.map((r) => `${jobsheetRefShort(res.orderNo, r.jobsheetNo)} removed`),
  ];
  if (messages.length === 0) messages.push(res.detailsChanged ? `${jobsheetRefShort(res.orderNo, jobsheetNo)} updated` : 'No changes');
  messages.forEach((m) => toast.success(m));
}

type UpdateMutation = ReturnType<typeof useUpdateJobsheet>;

function EditFormPcs({ js, onDone, formId, update }: { js: JobsheetDetail; onDone: () => void; formId: string; update: UpdateMutation }) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { frames: String(js.frames), sections: String(js.sections), machineIds: js.machines.map((m) => m.id) },
  });

  const [framesText, sectionsText] = useWatch({ control, name: ['frames', 'sections'] });
  const preview = useMemo(() => describeFramesEdit(js, parseIntOrNull(framesText), parseIntOrNull(sectionsText)), [js, framesText, sectionsText]);

  const onSubmit = handleSubmit((v) =>
    update.mutate(
      { frames: Number(v.frames), sections: Number(v.sections), machineIds: v.machineIds },
      {
        onSuccess: (res) => {
          toastUpdateResult(res, js.jobsheetNo);
          onDone();
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['frames', 'sections', 'machineIds'])) toast.error(errorMessage(err));
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
        <Field label="Sections per beam" htmlFor="jse-sections" required error={errors.sections?.message} hint="1–12 · pcs per frame">
          <NumberInput id="jse-sections" inputMode="numeric" invalid={!!errors.sections} {...register('sections')} />
        </Field>
        <Field
          label="Machines"
          htmlFor="jse-machines"
          required
          error={errors.machineIds?.message}
          hint="Machines only change this jobsheet."
          className="sm:col-span-2"
        >
          <Controller
            control={control}
            name="machineIds"
            render={({ field }) => (
              <MachinesSelect id="jse-machines" value={field.value} onChange={field.onChange} invalid={!!errors.machineIds} assigned={js.machines} />
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
            After saving: {preview.totalAfter} frames = {preview.pcsAfter} pcs (frames needed at the latest run's sections: {preview.neededFrames})
          </p>
          <WarningList messages={preview.warnings} className="mt-3" />
        </section>
      )}
    </form>
  );
}

function EditFormMeters({ js, onDone, formId, update }: { js: JobsheetDetail; onDone: () => void; formId: string; update: UpdateMutation }) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<MetersFormValues>({
    resolver: zodResolver(metersSchema),
    defaultValues: { meters: String(js.meters ?? 0), sections: String(js.sections), machineIds: js.machines.map((m) => m.id) },
  });

  const [metersText, sectionsText] = useWatch({ control, name: ['meters', 'sections'] });
  const preview = useMemo(() => describeMetersEdit(js, parseDecimalOrNull(metersText), parseIntOrNull(sectionsText)), [js, metersText, sectionsText]);

  const onSubmit = handleSubmit((v) =>
    update.mutate(
      { meters: Number(v.meters), sections: Number(v.sections), machineIds: v.machineIds },
      {
        onSuccess: (res) => {
          toastUpdateResult(res, js.jobsheetNo, true);
          onDone();
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['meters', 'sections', 'machineIds'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Metres" htmlFor="jse-meters" required error={errors.meters?.message}>
          <NumberInput id="jse-meters" inputMode="decimal" autoFocus suffix={<span className="pr-1.5 text-sm text-slate-400">m</span>} invalid={!!errors.meters} {...register('meters')} />
        </Field>
        <Field label="Sections per beam" htmlFor="jse-m-sections" required error={errors.sections?.message} hint="1–12">
          <NumberInput id="jse-m-sections" inputMode="numeric" invalid={!!errors.sections} {...register('sections')} />
        </Field>
        <Field
          label="Machines"
          htmlFor="jse-m-machines"
          required
          error={errors.machineIds?.message}
          hint="Machines only change this jobsheet."
          className="sm:col-span-2"
        >
          <Controller
            control={control}
            name="machineIds"
            render={({ field }) => (
              <MachinesSelect id="jse-m-machines" value={field.value} onChange={field.onChange} invalid={!!errors.machineIds} assigned={js.machines} />
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
            After saving: {formatQty(preview.totalAfter, 'meters')} loom = {formatQty(preview.clothAfter, 'meters')} cloth (loom metres needed: {formatQty(preview.neededLoomMeters, 'meters')})
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
      ) : isMeterOrder({ unit: ready.order?.unit ?? 'pcs' }) ? (
        <EditFormMeters key={`${ready.id}-${ready.updatedAt}`} js={ready} formId={formId} update={update} onDone={() => onOpenChange(false)} />
      ) : (
        <EditFormPcs key={`${ready.id}-${ready.updatedAt}`} js={ready} formId={formId} update={update} onDone={() => onOpenChange(false)} />
      )}
    </ResponsiveModal>
  );
}
