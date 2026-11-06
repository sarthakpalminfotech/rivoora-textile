import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Clock, LocateFixed, MapPin, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_RADIUS_M,
  timeLabel,
  type LoginGrantDto,
  type LoginLimitsData,
  type LoginLocationDto,
  type LoginLogEntry,
} from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { ErrorState } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, toApiDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getDeviceLocation } from '../auth/api';

const key = ['login-limits'] as const;
const DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
] as const;

function useLimits() {
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api.get<LoginLimitsData>('/login-limits', undefined, signal), staleTime: 0 });
}
function useLog() {
  return useQuery({ queryKey: [...key, 'log'], queryFn: ({ signal }) => api.get<LoginLogEntry[]>('/login-limits/log', undefined, signal), staleTime: 0 });
}
function useWrite<TBody, TOut = unknown>(fn: (b: TBody) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({ meta: { silentFieldErrors: true }, mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: key }) });
}

function Card({ title, icon: Icon, action, children, className }: { title: string; icon: typeof Clock; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-white p-4 shadow-soft md:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Icon className="size-4 text-slate-400" aria-hidden /> {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ---------------- login hours ---------------- */

function HoursCard({ data }: { data: LoginLimitsData }) {
  const s = data.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [from, setFrom] = useState(s.fromTime);
  const [to, setTo] = useState(s.toTime);
  const [days, setDays] = useState<number[]>(s.days);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => {
    setEnabled(s.enabled);
    setFrom(s.fromTime);
    setTo(s.toTime);
    setDays(s.days);
  }, [s.enabled, s.fromTime, s.toTime, s.days.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useWrite((b: { enabled: boolean; fromTime: string; toTime: string; days: number[] }) => api.put('/login-limits/settings', b));
  const dirty = enabled !== s.enabled || from !== s.fromTime || to !== s.toTime || days.join(',') !== s.days.join(',');
  return (
    <Card title="Login hours" icon={Clock}>
      <div className="space-y-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-slate-800">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-5 accent-[var(--primary)]" />
          Limit the QC role (place and hours)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="ll-from" error={err.fromTime}>
            <Input id="ll-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Until" htmlFor="ll-to" error={err.toTime}>
            <Input id="ll-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Days" error={err.days}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Days">
            {DAYS.map(([n, label]) => (
              <button
                key={n}
                type="button"
                aria-pressed={days.includes(n)}
                onClick={() => setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()))}
                className={cn('min-h-11 min-w-12 rounded-full border px-3 text-sm font-medium', days.includes(n) ? 'border-primary bg-primary-soft text-primary' : 'border-input bg-white text-slate-600')}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <p className="text-sm text-slate-500">
          QC users are logged out automatically at {timeLabel(to)} and can log in from {timeLabel(from)}.
        </p>
        <Button
          size="lg"
          disabled={!dirty}
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              { enabled, fromTime: from, toTime: to, days },
              {
                onSuccess: () => {
                  toast.success('Login hours saved');
                  setErr({});
                },
                onError: (e) => (e instanceof ApiError && e.field ? setErr({ [e.field]: e.message }) : toast.error(errorMessage(e))),
              },
            )
          }
        >
          Save hours
        </Button>
      </div>
    </Card>
  );
}

/* ---------------- allowed locations ---------------- */

function LocationDialog({ loc, open, onOpenChange }: { loc: LoginLocationDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_M));
  const [active, setActive] = useState(true);
  const [busyLoc, setBusyLoc] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setName(loc?.name ?? '');
    setLat(loc ? String(loc.latitude) : '');
    setLng(loc ? String(loc.longitude) : '');
    setRadius(String(loc?.radiusM ?? DEFAULT_RADIUS_M));
    setActive(loc?.isActive ?? true);
    setErr({});
  }, [open, loc]);
  const save = useWrite((b: { id?: number; name: string; latitude: number; longitude: number; radiusM: number; isActive: boolean }) =>
    b.id ? api.put(`/login-limits/locations/${b.id}`, b) : api.post('/login-limits/locations', b),
  );
  const useMine = async () => {
    setBusyLoc(true);
    const p = await getDeviceLocation();
    setBusyLoc(false);
    if (!p) return toast.error("Couldn't read your location. Allow location for this site, or type the coordinates.");
    setLat(String(Math.round(p.lat * 1e6) / 1e6));
    setLng(String(Math.round(p.lng * 1e6) / 1e6));
  };
  const submit = () => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter a name';
    if (lat.trim() === '' || !Number.isFinite(latitude)) e.latitude = 'Enter the latitude';
    if (lng.trim() === '' || !Number.isFinite(longitude)) e.longitude = 'Enter the longitude';
    setErr(e);
    if (Object.keys(e).length) return;
    save.mutate(
      { id: loc?.id, name: name.trim(), latitude, longitude, radiusM: Number(radius) || DEFAULT_RADIUS_M, isActive: active },
      {
        onSuccess: () => {
          toast.success(loc ? 'Place updated' : 'Place added');
          onOpenChange(false);
        },
        onError: (er) => (er instanceof ApiError && er.field ? setErr({ [er.field]: er.message }) : toast.error(errorMessage(er))),
      },
    );
  };
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={loc ? 'Edit place' : 'Add an allowed place'}
      size="md"
      footer={
        <div className="kb-bar grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button size="lg" onClick={submit} loading={save.isPending}>Save</Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="loc-name" required error={err.name} className="sm:col-span-2">
          <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Factory" autoComplete="off" />
        </Field>
        <Button type="button" variant="secondary" className="sm:col-span-2" onClick={() => void useMine()} loading={busyLoc}>
          <LocateFixed /> Use my current location
        </Button>
        <Field label="Latitude" htmlFor="loc-lat" required error={err.latitude}>
          <Input id="loc-lat" value={lat} onChange={(e) => setLat(e.target.value.replace(/[^\d.-]/g, ''))} inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Longitude" htmlFor="loc-lng" required error={err.longitude}>
          <Input id="loc-lng" value={lng} onChange={(e) => setLng(e.target.value.replace(/[^\d.-]/g, ''))} inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Radius (metres)" htmlFor="loc-radius" error={err.radiusM}>
          <Input id="loc-radius" value={radius} onChange={(e) => setRadius(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" autoComplete="off" />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-sm font-medium text-slate-800">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-[var(--primary)]" /> Active
        </label>
      </div>
    </ResponsiveModal>
  );
}

function LocationsCard({ data }: { data: LoginLimitsData }) {
  const [editing, setEditing] = useState<LoginLocationDto | null>(null);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<LoginLocationDto | null>(null);
  const del = useWrite((id: number) => api.delete(`/login-limits/locations/${id}`));
  return (
    <Card
      title="Allowed locations"
      icon={MapPin}
      className="md:col-span-2"
      action={
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus /> Add place
        </Button>
      }
    >
      {data.locations.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900">No place added yet — the place is NOT checked until you add one (only the hours are).</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {data.locations.map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{l.name} {!l.isActive && <span className="text-xs font-medium text-slate-400">(off)</span>}</p>
                <p className="text-xs tabular-nums text-slate-500">{l.latitude.toFixed(5)}, {l.longitude.toFixed(5)} · {l.radiusM} m</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => { setEditing(l); setOpen(true); }}>Edit</Button>
              <button type="button" aria-label={`Remove ${l.name}`} className="flex size-11 items-center justify-center rounded-lg text-slate-400 hover:bg-destructive-soft hover:text-destructive" onClick={() => setRemoving(l)}>
                <Trash2 className="size-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <LocationDialog loc={editing} open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'place'}?`}
        description="QC users can no longer log in from there."
        confirmLabel="Remove"
        destructive
        loading={del.isPending}
        onConfirm={() => del.mutate(removing!.id, { onSuccess: () => { toast.success('Place removed'); setRemoving(null); }, onError: (e) => toast.error(errorMessage(e)) })}
      />
    </Card>
  );
}

/* ---------------- extra time ---------------- */

function GrantsCard({ data }: { data: LoginLimitsData }) {
  const [userId, setUserId] = useState<number | null>(null);
  const [date, setDate] = useState(toApiDate(new Date()));
  const [until, setUntil] = useState('21:00');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const create = useWrite((b: { userId: number; grantDate: string; untilTime: string; reason: string }) => api.post('/login-limits/grants', b));
  const cancel = useWrite((id: number) => api.post(`/login-limits/grants/${id}/cancel`));
  const [cancelFor, setCancelFor] = useState<LoginGrantDto | null>(null);
  const submit = () => {
    const e: Record<string, string> = {};
    if (!userId) e.userId = 'Pick the person';
    if (reason.trim().length < 3) e.reason = 'Write at least 3 characters';
    setErr(e);
    if (Object.keys(e).length) return;
    create.mutate(
      { userId: userId!, grantDate: date, untilTime: until, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success('Extra time given');
          setReason('');
        },
        onError: (er) => (er instanceof ApiError && er.field ? setErr({ [er.field]: er.message }) : toast.error(errorMessage(er))),
      },
    );
  };
  return (
    <Card title="Extra time" icon={Clock}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="QC user" htmlFor="gr-user" required error={err.userId}>
          <Select<number> id="gr-user" value={userId} onChange={setUserId} options={data.qcUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Pick the person" />
        </Field>
        <Field label="Date" htmlFor="gr-date" required error={err.grantDate}>
          <DatePicker id="gr-date" value={date} onChange={setDate} />
        </Field>
        <Field label="Until" htmlFor="gr-until" required error={err.untilTime}>
          <Input id="gr-until" type="time" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="gr-reason" required error={err.reason}>
          <Textarea id="gr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} />
        </Field>
      </div>
      <Button className="mt-3" size="lg" onClick={submit} loading={create.isPending}>Give extra time</Button>
      <ul className="mt-4 space-y-2">
        {data.grants.length === 0 && <li className="text-sm text-slate-400">No extra time given yet.</li>}
        {data.grants.slice(0, 12).map((g) => (
          <li key={g.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">{g.userName} · {formatDate(g.grantDate)} until {timeLabel(g.untilTime)}</p>
              <p className="truncate text-xs text-slate-500">{g.reason}</p>
            </div>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', g.status === 'cancelled' ? 'bg-slate-200 text-slate-600' : g.live ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500')}>
              {g.status === 'cancelled' ? 'Cancelled' : g.live ? 'Active' : 'Past'}
            </span>
            {g.status === 'active' && g.live && (
              <Button variant="ghost" size="sm" onClick={() => setCancelFor(g)}><Ban /> Cancel</Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={cancelFor !== null}
        onOpenChange={(o) => !o && setCancelFor(null)}
        title="Cancel this extra time?"
        description={cancelFor ? `${cancelFor.userName} can no longer work until ${timeLabel(cancelFor.untilTime)} on ${formatDate(cancelFor.grantDate)}.` : undefined}
        confirmLabel="Cancel extra time"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(cancelFor!.id, { onSuccess: () => { toast.success('Extra time cancelled'); setCancelFor(null); }, onError: (e) => toast.error(errorMessage(e)) })}
      />
    </Card>
  );
}

/* ---------------- log ---------------- */

const EVENT_LABEL = { login_refused: 'Login refused', forced_logout: 'Logged out', heartbeat_outside: 'Away from place' } as const;

function LogCard({ data }: { data: LoginLimitsData }) {
  const log = useLog();
  const items = log.data ?? [];
  return (
    <Card title="QC login log · last 30 days" icon={Ban} className="md:col-span-2">
      {log.isPending ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing refused or logged out.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.slice(0, 60).map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="w-44 shrink-0 text-xs text-slate-500">{formatDateTime(l.at)}</span>
              <span className="w-32 shrink-0 font-semibold text-slate-800">{EVENT_LABEL[l.event]}</span>
              <span className="min-w-0 flex-1 text-slate-700">{l.userName ?? l.phone ?? '—'} · {l.reason}</span>
              {l.distanceM !== null && <span className="text-xs tabular-nums text-slate-400">{l.distanceM} m away</span>}
            </li>
          ))}
        </ul>
      )}
      {data.changes.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">Settings history</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {data.changes.map((c) => (
              <li key={c.id}>{formatDateTime(c.createdAt)} · {c.userName ?? '—'} · {c.note}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** Settings → QC login limits (Jenish, Gaurang). Phone stacked · tablet: places full width on top, hours + extra time side by side. */
export default function LoginLimitsPage() {
  usePageTitle('QC login limits');
  const q = useLimits();
  return (
    <div className="page-container max-w-6xl space-y-4 pb-24 pt-3 md:py-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">QC login limits</h1>
        <p className="text-sm text-slate-500">The QC role can log in only at an allowed place and inside the login hours. Nobody else is limited.</p>
      </div>
      {q.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <LocationsCard data={q.data} />
          <HoursCard data={q.data} />
          <GrantsCard data={q.data} />
          <LogCard data={q.data} />
        </div>
      )}
    </div>
  );
}
