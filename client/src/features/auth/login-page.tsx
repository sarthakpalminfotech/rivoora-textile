import { useState, type FormEvent } from 'react';
import { cleanPhone, defaultPassword, isValidPhone } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { authStore } from '@/lib/auth-store';
import { DemoRibbon } from '@/components/layout/demo-ribbon';
import { login } from './api';

/**
 * The "Autofill" shortcut fills the default password (Rivoora@ + the first 3 digits of the phone) — handy while the
 * app is being tried out. Switch it off before real use: set VITE_LOGIN_AUTOFILL=false at build time (see README).
 */
const AUTOFILL_ENABLED = import.meta.env.VITE_LOGIN_AUTOFILL !== 'false';

/** `/login`, and what any page shows while nobody is logged in (the URL stays, so the user lands back on it). */
export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  // Sprint 23: why a QC session ended (login time over …), shown once.
  const [endedMessage] = useState(() => authStore.takeSignedOutMessage());

  const phoneOk = isValidPhone(phone);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!phoneOk) {
      setError('Enter your 10-digit mobile number');
      return;
    }
    if (!password) {
      setError('Enter your password');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(phone, password, setLocating);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="absolute inset-x-0 top-0">
        <DemoRibbon />
      </div>
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/favicon.svg" alt="" className="size-14" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rivoora Textile</h1>
            <p className="mt-0.5 text-[13px] font-medium uppercase tracking-wider text-accent-foreground/70">Order management</p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-soft sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Log in</h2>
          <Field label="Mobile number" htmlFor="login-phone">
            <Input
              id="login-phone"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              autoFocus
              maxLength={10}
              placeholder="10-digit number"
              value={phone}
              onChange={(e) => {
                setPhone(cleanPhone(e.target.value));
                setError(null);
              }}
              className="tabular-nums"
            />
          </Field>
          <Field
            label={
              <span className="flex w-full items-center justify-between gap-2">
                <span>Password</span>
                {AUTOFILL_ENABLED && (
                  <button
                    type="button"
                    onClick={() => {
                      setPassword(defaultPassword(phone));
                      setError(null);
                    }}
                    disabled={!phoneOk}
                    className="text-[13px] font-semibold text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                  >
                    Autofill
                  </button>
                )}
              </span>
            }
            htmlFor="login-password"
          >
            {/* Always dots: no "show password", no "forgot password". */}
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
            />
          </Field>
          {endedMessage && !error && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-900">
              {endedMessage}
            </p>
          )}
          {locating && (
            <p role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-[13px] font-medium text-sky-900">
              Checking your location… allow it when asked. / लोकेशन जाँच रही है… पूछने पर अनुमति दें।
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-[13px] font-medium text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Log in
          </Button>
          <p className="text-center text-[12px] text-slate-500">
            QC login needs your location at the factory. / क्यूसी लॉगिन के लिए फैक्ट्री में लोकेशन चाहिए।
          </p>
        </form>
      </div>
    </div>
  );
}
