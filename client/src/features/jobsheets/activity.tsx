import type { JobsheetEvent, JobsheetEventKind } from '@rivoora/shared';
import { ROLES } from '@/config/roles';
import { formatDateTime } from '@/lib/format';

const DOT: Record<JobsheetEventKind, string> = {
  created: '#94A3B8',
  sent: '#F59E0B',
  pulled_back: '#64748B',
  started: '#3B82F6',
  completed: '#22C55E',
  machine_changed: '#8B5CF6',
  takas_entered: '#14B8A6',
  takas_edited: '#A855F7',
};

const fr = (n: number) => `${n} frame${n === 1 ? '' : 's'}`;

/** "Started on Machine 7", "Completed — 8 of 10 frames", … */
export function eventTitle(e: JobsheetEvent, assignedFrames: number): string {
  const machine = e.machineNo !== null ? `Machine ${e.machineNo}` : null;
  switch (e.event) {
    case 'created':
      return e.frames !== null ? `Created with ${fr(e.frames)}` : 'Created';
    case 'sent':
      return 'Sent to supervisor';
    case 'pulled_back':
      return 'Pulled back from supervisor';
    case 'started':
      return machine ? `Started on ${machine}` : 'Started';
    case 'completed':
      return e.frames !== null ? `Completed — ${e.frames} of ${fr(assignedFrames)}` : 'Completed';
    case 'machine_changed':
      return `Moved from ${machine ?? 'the machine'}${e.frames !== null ? ` after ${fr(e.frames)}` : ''}`;
    case 'takas_entered':
      return e.note ? `Takas entered — ${e.note}` : 'Takas entered';
    case 'takas_edited':
      return 'Takas edited';
    default:
      return e.event;
  }
}

/** Activity timeline, newest first (same look as the order status history). */
export function ActivityTimeline({ events, assignedFrames }: { events: JobsheetEvent[]; assignedFrames: number }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  const entries = [...events].reverse();
  return (
    <ol className="relative space-y-5 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-slate-200">
      {entries.map((e, i) => (
        <li key={e.id} className="relative">
          <span
            className="absolute -left-6 top-1 size-4 rounded-full border-[3px] border-white shadow"
            style={{ backgroundColor: i === 0 ? DOT[e.event] : '#CBD5E1' }}
            aria-hidden
          />
          <p className="text-[15px] font-semibold text-slate-900">{eventTitle(e, assignedFrames)}</p>
          {/* The takas_entered summary is already in the title. */}
          {e.note && e.event !== 'takas_entered' && <p className="text-sm text-slate-600">{e.note}</p>}
          <p className="text-sm text-slate-500">
            {formatDateTime(e.createdAt)} · by {ROLES[e.role]?.name ?? e.role}
          </p>
        </li>
      ))}
    </ol>
  );
}
