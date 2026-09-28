import { useEffect, useRef } from 'react';

/** Calls `onLoadMore` when the returned sentinel element scrolls into view. */
export function useInfiniteScroll(onLoadMore: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onLoadMore);
  cb.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  return ref;
}
