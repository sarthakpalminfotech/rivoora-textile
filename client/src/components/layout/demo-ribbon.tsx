import { useDemoMode } from '@/lib/demo-mode';

/** Sprint 26 — shown on every screen while the server runs on the local demo database. */
export function DemoRibbon() {
  const demo = useDemoMode();
  if (!demo) return null;
  return (
    <div
      role="note"
      data-demo-ribbon
      className="flex items-center justify-center gap-2 border-b border-amber-300 bg-[repeating-linear-gradient(135deg,#fef3c7_0,#fef3c7_12px,#fde68a_12px,#fde68a_24px)] px-4 py-1 text-[12px] font-semibold uppercase tracking-wide text-amber-900"
    >
      <span>Demo data</span>
      <span aria-hidden>·</span>
      <span className="font-medium normal-case tracking-normal">local demo database, not the live one</span>
    </div>
  );
}
