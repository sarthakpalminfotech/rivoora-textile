import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Sprint 25 — the dashboards' own breakpoint rule (used ONLY by the dashboards):
 * - phone < 768;
 * - tablet = 768–1023 (portrait, 2 columns) OR 1024–1279 with a touch screen (`pointer: coarse`, e.g. a 1180 px landscape
 *   tablet — 3 columns with the tablet interactions);
 * - desktop = ≥ 1024 with a fine pointer (and every screen ≥ 1280).
 */
export function useIsTabletLayout(): boolean {
  const portrait = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const landscapeTouch = useMediaQuery('(min-width: 1024px) and (max-width: 1279px) and (pointer: coarse)');
  return portrait || landscapeTouch;
}

export type DashboardMode = 'phone' | 'tablet2' | 'tablet3' | 'desktop';

export function useDashboardMode(): DashboardMode {
  const phone = !useMediaQuery('(min-width: 768px)');
  const tablet = useIsTabletLayout();
  const wide = useMediaQuery('(min-width: 1024px)');
  if (phone) return 'phone';
  if (tablet) return wide ? 'tablet3' : 'tablet2';
  return 'desktop';
}
