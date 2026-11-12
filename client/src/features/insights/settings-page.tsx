import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { NumberInput } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { useDashboardSettings, useSaveDashboardSettings } from './api';

/** Sprint 25 — Settings → Dashboard (Jenish + Gaurang): the working hours per day used by Loom utilisation / Looms idle. */
export default function DashboardSettingsPage() {
  usePageTitle('Dashboard settings');
  const q = useDashboardSettings();
  const save = useSaveDashboardSettings();
  const [hours, setHours] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setHours(String(q.data.workingHoursPerDay));
  }, [q.data]);
  const submit = () => {
    const v = Number(hours);
    if (!hours.trim() || !Number.isFinite(v) || v < 1 || v > 24 || Math.abs(v * 2 - Math.round(v * 2)) > 1e-9) {
      setErr('Enter 1 to 24 hours (whole or half hours)');
      return;
    }
    setErr(null);
    save.mutate(
      { workingHoursPerDay: v },
      {
        onSuccess: (d) => toast.success(`Working hours saved · ${d.workingHoursPerDay} h a day`),
        onError: (e) => {
          if (e instanceof ApiError && e.field) setErr(e.message);
          toast.error(errorMessage(e));
        },
      },
    );
  };
  return (
    <div className="page-container max-w-3xl space-y-4 pb-24 pt-4 lg:pb-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Dashboard settings</h1>
        <p className="text-sm text-slate-500">
          Used by the insight dashboards. <Link to="/dashboard" className="font-semibold text-primary hover:underline">Open the dashboard</Link>
        </p>
      </div>
      <section className="rounded-xl border border-border bg-white p-4 md:p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Clock className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Working hours per day</h2>
            <p className="text-sm text-slate-500">Loom utilisation = running hours ÷ (days × these hours). “Looms idle the most” uses them too. Default 24 h.</p>
          </div>
        </div>
        {q.isPending ? (
          <Skeleton className="h-11 w-48" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="Hours a day" htmlFor="ds-hours" required error={err ?? undefined} className="w-48">
              <NumberInput id="ds-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, '').slice(0, 4))} invalid={!!err} suffix={<span className="pr-1 text-sm text-slate-400">h</span>} />
            </Field>
            <Button type="submit" loading={save.isPending} className="min-h-11">
              Save
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
