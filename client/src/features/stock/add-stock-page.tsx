import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BLOUSE_LABEL, BLOUSE_OPTIONS, type BlouseOption } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BackLink } from '../inventory/parts';
import { useAddStock } from './api';
import { damageRowPayload, DamageRowFields, emptyDamageRow, QualityDesignFields } from './parts';

/** Inventory → Add stock (Jenish, Gaurang): ONE free-stock taka with a dummy number, shown as "Manual stock". Full screen. */
export default function AddStockPage() {
  usePageTitle('Add stock');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const n = (k: string) => (/^\d+$/.test(params.get(k) ?? '') ? Number(params.get(k)) : null);
  const [materialId, setMaterialId] = useState<number | null>(n('materialId') ?? n('qualityId'));
  const [designId, setDesignId] = useState<number | null>(n('designId'));
  const [unit, setUnit] = useState<'pcs' | 'meters'>('pcs');
  const [quantity, setQuantity] = useState('');
  const [condition, setCondition] = useState<'fresh' | 'damaged'>('fresh');
  const [damage, setDamage] = useState(emptyDamageRow());
  const [blouse, setBlouse] = useState<BlouseOption | null>(null);
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useAddStock();

  const qty = Number(quantity);
  const submit = () => {
    const next: Record<string, string> = {};
    if (!materialId) next.materialId = 'Select the quality';
    if (!designId) next.designId = 'Select the design';
    if (!quantity || !(qty > 0)) next.quantity = 'Enter the quantity';
    const dmg = condition === 'damaged' ? damageRowPayload(damage) : null;
    if (condition === 'damaged' && !dmg) next.damage = 'Fill in the damage: type, name and quantity';
    if (dmg && dmg.qty > qty) next.damage = "Damaged quantity can't be more than the quantity";
    setErrors(next);
    if (Object.keys(next).length) return;
    add.mutate(
      { materialId: materialId!, designId: designId!, unit, quantity: qty, condition, damage: dmg, blouseOption: unit === 'pcs' ? blouse : null, remark: remark.trim() || null },
      {
        onSuccess: (r) => {
          toast.success(`Stock added · taka ${r.takaNo} (Manual stock)`);
          navigate(designId ? `/inventory/items/d-${designId}` : '/inventory');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.field) setErrors({ [err.field.split('.')[0]]: err.message });
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <div className="page-container max-w-5xl space-y-4 pb-28 pt-2 md:py-4">
      <BackLink />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Add stock</h1>
        <p className="text-sm text-slate-500">Finished goods with no order. It becomes one free-stock taka with a dummy number (D01, D02 …), shown as “Manual stock”.</p>
      </div>
      <section className="space-y-5 rounded-xl border border-border bg-white p-4 shadow-soft md:p-5">
        {/* phone 1 column · tablet 2 · desktop 3 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <QualityDesignFields
            materialId={materialId}
            designId={designId}
            onChange={(v) => {
              setMaterialId(v.materialId);
              setDesignId(v.designId);
            }}
            qualityError={errors.materialId}
            designError={errors.designId}
          />
          <Field label="Unit" required>
            <Segmented<'pcs' | 'meters'> aria-label="Unit" size="lg" value={unit} onChange={setUnit} options={[{ value: 'pcs', label: 'Pcs' }, { value: 'meters', label: 'Meters' }]} />
          </Field>
          <Field label={unit === 'pcs' ? 'Quantity (pcs)' : 'Quantity (metres)'} htmlFor="add-qty" required error={errors.quantity}>
            <Input
              id="add-qty"
              value={quantity}
              onChange={(e) => setQuantity(unit === 'pcs' ? e.target.value.replace(/[^\d]/g, '') : e.target.value.replace(/[^\d.]/g, ''))}
              inputMode={unit === 'pcs' ? 'numeric' : 'decimal'}
              autoComplete="off"
              className="h-12 text-lg font-bold"
            />
          </Field>
          <Field label="Condition" required>
            <Segmented<'fresh' | 'damaged'> aria-label="Condition" size="lg" value={condition} onChange={setCondition} options={[{ value: 'fresh', label: 'Fresh' }, { value: 'damaged', label: 'Damaged' }]} />
          </Field>
          {unit === 'pcs' && (
            <Field label="Blouse" hint="Optional">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Blouse">
                {BLOUSE_OPTIONS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={blouse === b}
                    onClick={() => setBlouse(blouse === b ? null : b)}
                    className={cn('min-h-11 rounded-full border px-4 text-sm font-medium', blouse === b ? 'border-primary bg-primary-soft text-primary' : 'border-input bg-white text-slate-700 hover:bg-muted')}
                  >
                    {BLOUSE_LABEL[b]}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>
        {condition === 'damaged' && (
          <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
            <p className="mb-3 text-sm font-semibold text-red-900">Damage</p>
            <DamageRowFields row={damage} onChange={setDamage} unit={unit} idPrefix="add-dmg" error={errors.damage} />
          </div>
        )}
        <Field label="Remark" htmlFor="add-remark" hint="Optional" error={errors.remark}>
          <Textarea id="add-remark" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={300} rows={2} />
        </Field>
      </section>
      <div className="kb-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex gap-2 border-t border-border bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-t-2xl lg:border-x">
        <Button variant="secondary" size="lg" className="h-12 flex-1 sm:flex-none" onClick={() => navigate(-1)} disabled={add.isPending}>
          Cancel
        </Button>
        <Button size="lg" className="h-12 flex-1 sm:flex-none" onClick={submit} loading={add.isPending}>
          Add stock
        </Button>
      </div>
    </div>
  );
}
