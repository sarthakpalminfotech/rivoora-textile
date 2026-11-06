import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CHALLAN_KIND_CONFIG, challanLabel, type ChallanDetail, type ChallanKind } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { ApiError, errorMessage } from '@/lib/api';
import { usePartyLookup } from '../masters/api';
import { useEditChallan } from './api';

/**
 * Sprint 21 (C3) — edit an ACTIVE butta / mill challan: party, date, e-way no., transport, vehicle, notes.
 * Phone: one column · tablet: 2 columns · desktop: 3 columns. A history line records what changed.
 */
export function EditChallanDialog({ challan, open, onOpenChange }: { challan: ChallanDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const kind: ChallanKind = challan.kind;
  const cfg = CHALLAN_KIND_CONFIG[kind];
  const edit = useEditChallan(kind, challan.id);
  const [partyId, setPartyId] = useState<number | null>(challan.party.id);
  const [partyLabel, setPartyLabel] = useState(challan.party.name);
  const [partySearch, setPartySearch] = useState('');
  const [date, setDate] = useState(challan.challanDate);
  const [eway, setEway] = useState(challan.ewayNo ?? '');
  const [transport, setTransport] = useState(challan.transport ?? '');
  const [vehicle, setVehicle] = useState(challan.vehicleNo ?? '');
  const [notes, setNotes] = useState(challan.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const parties = usePartyLookup(kind, useDebounce(partySearch.trim(), 250), open);

  useEffect(() => {
    if (!open) return;
    setPartyId(challan.party.id);
    setPartyLabel(challan.party.name);
    setDate(challan.challanDate);
    setEway(challan.ewayNo ?? '');
    setTransport(challan.transport ?? '');
    setVehicle(challan.vehicleNo ?? '');
    setNotes(challan.notes ?? '');
    setErrors({});
    // reset when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    if (!partyId) return setErrors({ partyId: `Select the ${cfg.partyLabel.toLowerCase()}` });
    edit.mutate(
      { partyId, challanDate: date, ewayNo: eway.trim() || null, transport: transport.trim() || null, vehicleNo: vehicle.trim() || null, notes: notes.trim() || null },
      {
        onSuccess: (res) => {
          toast.success(res.changed ? `Challan ${challanLabel(challan.challanNo, kind)} updated` : 'No changes');
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !edit.isPending && onOpenChange(o)}
      title={`Edit challan ${challanLabel(challan.challanNo, kind)}`}
      size="lg"
      dismissible={!edit.isPending}
      footer={
        <div className="kb-bar grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={edit.isPending}>
            Cancel
          </Button>
          <Button size="lg" onClick={save} loading={edit.isPending}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label={cfg.partyLabel} htmlFor="edit-party" required error={errors.partyId}>
          <Select
            id="edit-party"
            value={partyId}
            onChange={(id, opt) => {
              setPartyId(id);
              setPartyLabel(opt.label);
              setErrors({});
            }}
            selectedLabel={partyLabel}
            options={(parties.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Select party"
            searchable
            searchPlaceholder="Search parties…"
            onSearchChange={setPartySearch}
            loading={parties.isFetching}
          />
        </Field>
        <Field label="Challan date" htmlFor="edit-date" required error={errors.challanDate}>
          <DatePicker id="edit-date" value={date} onChange={setDate} />
        </Field>
        <Field label="E-way no" htmlFor="edit-eway" error={errors.ewayNo}>
          <Input id="edit-eway" value={eway} onChange={(e) => setEway(e.target.value)} maxLength={40} autoComplete="off" />
        </Field>
        <Field label="Transport" htmlFor="edit-transport" error={errors.transport}>
          <Input id="edit-transport" value={transport} onChange={(e) => setTransport(e.target.value)} maxLength={80} autoComplete="off" />
        </Field>
        <Field label="Vehicle no" htmlFor="edit-vehicle" error={errors.vehicleNo}>
          <Input id="edit-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} maxLength={40} autoComplete="off" />
        </Field>
        <Field label="Notes" htmlFor="edit-notes" error={errors.notes} className="md:col-span-2 lg:col-span-3">
          <Textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} rows={2} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}
