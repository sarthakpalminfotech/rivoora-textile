import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Plus, UserCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { cleanPhone, defaultPassword, MIN_PASSWORD_LENGTH, ROLE_KEYS, ROLES, type RoleKey, type UserRow } from '@rivoora/shared';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ResponsiveModal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/hooks/useRole';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MasterList, MasterToolbar, type Column } from '../master-list';
import { useResetPassword, useSaveUser, useUsers } from './api';

const roleOptions = ROLE_KEYS.map((key) => ({ value: key, label: `${ROLES[key].name} — ${ROLES[key].title}` }));
const roleLabel = (role: RoleKey) => `${ROLES[role].name}`;

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the name').max(80, 'At most 80 characters'),
  phone: z.string().regex(/^\d{10}$/, 'Enter a 10-digit mobile number'),
  role: z.enum(ROLE_KEYS, { errorMap: () => ({ message: 'Pick a role' }) }),
  isActive: z.boolean(),
  // Only used when adding. Empty = the default password.
  password: z.string().max(100).refine((v) => v === '' || v.length >= MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`),
});
type FormValues = z.infer<typeof schema>;

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600')}>
      <span className={cn('size-1.5 rounded-full', active ? 'bg-green-500' : 'bg-slate-400')} aria-hidden />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

/** Reset password: a new password, or the default one (Rivoora@ + the first 3 digits of the phone). */
function ResetPasswordDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPassword('');
    setError(null);
  }, [user]);
  if (!user) return null;
  const submit = (useDefault: boolean) => {
    if (!useDefault && password.length < MIN_PASSWORD_LENGTH) {
      setError(`At least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    reset.mutate(
      { id: user.id, data: useDefault ? {} : { password } },
      {
        onSuccess: () => {
          toast.success(`Password reset for ${user.name}. They are logged out.`);
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && !reset.isPending && onClose()}
      title={`Reset password · ${user.name}`}
      size="sm"
      bodyClassName="py-4"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button onClick={() => submit(false)} loading={reset.isPending}>
            Set password
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="New password" htmlFor="u-reset" error={error ?? undefined}>
          <Input
            id="u-reset"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <button type="button" onClick={() => submit(true)} disabled={reset.isPending} className="w-fit text-[13px] font-semibold text-primary underline-offset-4 hover:underline">
          Use default password ({defaultPassword(user.phone).replace(/.(?=.{3}$)/g, (c) => c)})
        </button>
        <p className="text-[13px] text-muted-foreground">The user is logged out everywhere and signs in with the new password.</p>
      </div>
    </Modal>
  );
}

function UserFormDialog({ open, onOpenChange, user, selfId }: { open: boolean; onOpenChange: (o: boolean) => void; user: UserRow | null; selfId: number | null }) {
  const save = useSaveUser();
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const isSelf = !!user && user.id === selfId;
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const phone = watch('phone');

  useEffect(() => {
    if (open) reset({ name: user?.name ?? '', phone: user?.phone ?? '', role: user?.role ?? 'supervisor', isActive: user?.isActive ?? true, password: '' });
  }, [open, user, reset]);

  const onSubmit = handleSubmit((v) =>
    save.mutate(
      { id: user?.id, data: user ? { name: v.name, phone: v.phone, role: v.role, isActive: v.isActive } : { name: v.name, phone: v.phone, role: v.role, isActive: v.isActive, password: v.password || undefined } },
      {
        onSuccess: (u) => {
          toast.success(user ? 'User updated' : `${u.name} added`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['name', 'phone', 'role', 'isActive', 'password'])) toast.error(errorMessage(err));
        },
      },
    ),
  );

  return (
    <>
      <ResponsiveModal
        open={open}
        onOpenChange={(o) => !save.isPending && onOpenChange(o)}
        title={user ? 'Edit user' : 'Add user'}
        mobileVariant="fullscreen"
        dismissible={!isDirty}
        footer={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="user-form" loading={save.isPending}>
              {user ? 'Save changes' : 'Add user'}
            </Button>
          </div>
        }
      >
        <form id="user-form" onSubmit={onSubmit} noValidate className="grid gap-4">
          <Field label="Name" htmlFor="u-name" required error={errors.name?.message}>
            <Input id="u-name" autoFocus autoComplete="off" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Mobile number" htmlFor="u-phone" required error={errors.phone?.message} hint="10 digits — this is the login">
            <Input
              id="u-phone"
              type="tel"
              inputMode="tel"
              maxLength={10}
              autoComplete="off"
              className="tabular-nums"
              invalid={!!errors.phone}
              {...register('phone', { onChange: (e) => setValue('phone', cleanPhone(e.target.value)) })}
            />
          </Field>
          <Field label="Role" htmlFor="u-role" required error={errors.role?.message} hint={isSelf ? "You can't change your own role" : 'Roles are fixed — they decide which screens the user sees'}>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select id="u-role" options={roleOptions} value={field.value} onChange={(v) => field.onChange(v)} disabled={isSelf} invalid={!!errors.role} />
              )}
            />
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-slate-50/60 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Active</p>
              <p className="text-[13px] text-muted-foreground">{isSelf ? "You can't deactivate yourself" : 'Inactive users can not log in'}</p>
            </div>
            <Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isSelf} aria-label="Active" />} />
          </div>
          {user ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Password</p>
                <p className="text-[13px] text-muted-foreground">Last login: {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'never'}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setResetFor(user)}>
                <KeyRound /> Reset password
              </Button>
            </div>
          ) : (
            <Field label="Password" htmlFor="u-password" error={errors.password?.message} hint={`Leave empty for the default password${phone?.length >= 3 ? ` (${defaultPassword(phone)})` : ''}`}>
              <div className="flex items-center gap-2">
                <Input id="u-password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
                <button type="button" onClick={() => setValue('password', '', { shouldDirty: true })} className="shrink-0 text-[13px] font-semibold text-primary underline-offset-4 hover:underline">
                  Use default
                </button>
              </div>
            </Field>
          )}
        </form>
      </ResponsiveModal>
      <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />
    </>
  );
}

const columns: Column<UserRow>[] = [
  { header: 'Name', cell: (u) => <span className="font-semibold text-slate-900">{u.name}</span>, className: 'w-[26%]' },
  { header: 'Phone', cell: (u) => <span className="tabular-nums">{u.phone}</span>, className: 'w-[16%]' },
  { header: 'Role', cell: (u) => roleLabel(u.role), className: 'w-[22%]' },
  { header: 'Status', cell: (u) => <StatusPill active={u.isActive} />, className: 'w-[14%]' },
  { header: 'Last login', cell: (u) => <span className="text-slate-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</span> },
];

/** Users master (Jenish, Gaurang): who can log in, with which role. Roles themselves are fixed in code. */
export default function UsersPage() {
  usePageTitle('Users');
  const { user: me } = useRole();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const query = useUsers(debounced);
  const [form, setForm] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const openForm = (user: UserRow | null) => setForm({ open: true, user });

  return (
    <div className="page-container space-y-4 pb-24 pt-5 md:pb-5">
      <MasterToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search name or phone…"
        addLabel="Add User"
        onAdd={() => openForm(null)}
        fetching={query.isFetching && !query.isPending && !query.isFetchingNextPage}
      />
      <MasterList
        query={query}
        columns={columns}
        noun="users"
        searching={!!debounced}
        onClearSearch={() => setSearch('')}
        onOpen={openForm}
        onEdit={openForm}
        empty={{
          icon: UserCog,
          title: 'No users yet',
          action: (
            <Button onClick={() => openForm(null)}>
              <Plus /> Add User
            </Button>
          ),
        }}
        card={(u) => (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-semibold text-slate-900">{u.name}</p>
              <StatusPill active={u.isActive} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              <span className="tabular-nums">{u.phone}</span> · {roleLabel(u.role)}
            </p>
            <p className="mt-0.5 text-[13px] text-slate-400">Last login: {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'never'}</p>
          </>
        )}
      />
      <UserFormDialog open={form.open} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} user={form.user} selfId={me?.id ?? null} />
    </div>
  );
}
