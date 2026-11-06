import { Clock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { END_WARNING_MS, HEARTBEAT_MS, istParts, timeLabel, timeLabelHi } from '@rivoora/shared';
import { useRole } from '@/hooks/useRole';
import { api } from '@/lib/api';
import { authStore } from '@/lib/auth-store';
import { getDeviceLocation } from './api';

const hhmm = (iso: string): string => {
  const m = istParts(new Date(iso)).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Sprint 23 (C10) — for the QC role only: a bar "Logged in until 7:20 pm / शाम 7:20 तक", a heartbeat with the device
 * location every 5 minutes (and when the app gets focus again) and a toast 10 minutes before the time ends. The server does
 * the real checking: when the time is over (or the device left the place twice in a row) every call answers 401 and the
 * app returns to the login screen with the reason.
 */
export function QcSessionBar() {
  const { user } = useRole();
  const isQc = user?.role === 'qc';
  const until = user?.limitUntil ?? null;
  const warned = useRef<string | null>(null);

  useEffect(() => {
    if (!isQc) return;
    let stopped = false;
    const beat = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      const location = await getDeviceLocation();
      if (stopped) return;
      try {
        const res = await api.post<{ validUntil: string | null; outside: boolean }>('/auth/heartbeat', { location });
        authStore.setLimitUntil(res.validUntil);
        if (res.outside) toast.warning('You seem to be away from the factory. / आप फैक्ट्री से दूर लगते हैं।');
      } catch {
        /* a 401 signs out by itself (lib/api); other errors: try again at the next beat */
      }
    };
    const first = window.setTimeout(() => void beat(), 3_000);
    const timer = window.setInterval(() => void beat(), HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [isQc]);

  // 10 minutes before the end: one warning toast per end time.
  useEffect(() => {
    if (!isQc || !until) return;
    const at = new Date(until).getTime() - END_WARNING_MS - Date.now();
    const fire = () => {
      if (warned.current === until) return;
      warned.current = until;
      toast.warning(`Your login ends at ${timeLabel(hhmm(until))}. / आपका लॉगिन ${timeLabelHi(hhmm(until))} को समाप्त होगा।`, { duration: 15_000 });
    };
    if (at <= 0) {
      if (new Date(until).getTime() > Date.now()) fire();
      return;
    }
    const t = window.setTimeout(fire, at);
    return () => window.clearTimeout(t);
  }, [isQc, until]);

  if (!isQc || !until) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-sky-200 bg-sky-50 px-4 py-1.5 text-[13px] font-medium text-sky-900" role="status">
      <Clock className="size-4 shrink-0" aria-hidden />
      <span>
        Logged in until {timeLabel(hhmm(until))} / <span lang="hi">{timeLabelHi(hhmm(until))} तक</span>
      </span>
    </div>
  );
}
