import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** < 768px */
export const useIsMobile = () => !useMediaQuery('(min-width: 768px)');
/** ≥ 1024px */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
