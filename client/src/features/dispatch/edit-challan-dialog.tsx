import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { type DispatchChallanListItem } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { ApiError, errorMessage } from '@/lib/api';
import { useDispatchChallan, useEditDispatchChallan } from './api';

/**
 * Sprint 21 (C7) — edit the header of an ACTIVE delivery challan: date, transport, LR no, vehicle, e-way no, notes.
 * No new revision; a history line records the change. Phone 1 column · tablet 2 · desktop 3.
 */
export function EditDispatchChallanDialog({ challan, open, onOpenChange }: { challan: DispatchChallanListItem | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const id = challan?.id ?? 0;
  const detail = useDispatchChallan(open ? id : 0);
  const edit = useEditDispatchChallan(id);
  const [date, setDate] = useState('');
  const [transport, setTransport] = useState('');
  const [lr, setLr] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [eway, setEway] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const d = detail.data;

  useEffect(() => {
    if (!open || !d) return;
    setDate(d.challanDate);
    setTransport(d.transport ?? '');
    setLr(d.lrNo ?? '');
    setVehicle(d.vehicleNo ?? '');
    setEway(d.ewayNo ?? '');
    setNotes(d.notes ?? '');
    setErrors({});
    // fill when the details arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, d?.id]);

  const save = () =>
    edit.mutate(
      { challanDate: date, transport: transport.trim() || null, lrNo: lr.trim() || null, vehicleNo: vehicle.trim() || null, ewayNo: eway.trim() || null, notes: notes.trim() || null },
      {
        onSuccess: (res) => {
          toast.success(res.changed ? `${challan?.label} updated` : 'No changes');
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
          else toast.error(errorMessage(err));
        },
      },
    );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !edit.isPending && onOpenChange(o)}
      title={`Edit ${challan?.label ?? 'challan'}`}
      size="lg"
      dismissible={!edit.isPending}
      footer={
        <div className="kb-bar grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={edit.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={save} loading={edit.isPending} disabled={!d}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Challan date" htmlFor="dc-date" required error={errors.challanDate}>
          <DatePicker id="dc-date" value={date} onChange={setDate} />
        </Field>
        <Field label="Transport" htmlFor="dc-transport" error={errors.transport}>
          <Input id="dc-transport" value={transport} onChange={(e) => setTransport(e.target.value)} maxLength={80} autoComplete="off" />
        </Field>
        <Field label="LR no" htmlFor="dc-lr" error={errors.lrNo}>
          <Input id="dc-lr" value={lr} onChange={(e) => setLr(e.target.value)} maxLength={40} autoComplete="off" />
        </Field>
        <Field label="Vehicle no" htmlFor="dc-vehicle" error={errors.vehicleNo}>
          <Input id="dc-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} maxLength={40} autoComplete="off" />
        </Field>
        <Field label="E-way no" htmlFor="dc-eway" error={errors.ewayNo}>
          <Input id="dc-eway" value={eway} onChange={(e) => setEway(e.target.value)} maxLength={40} autoComplete="off" />
        </Field>
        <Field label="Notes" htmlFor="dc-notes" error={errors.notes} className="md:col-span-2 lg:col-span-3">
          <Textarea id="dc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} rows={2} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}
