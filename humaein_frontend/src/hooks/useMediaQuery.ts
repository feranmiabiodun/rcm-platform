import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  // Initialize from matchMedia (SSR-safe)
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia(query);

    // Handler supports both MediaQueryListEvent (modern) and fallback
    const handler = (e?: MediaQueryListEvent | MediaQueryList) => {
      const matched = e && 'matches' in e ? e.matches : mql.matches;
      setMatches(!!matched);
    };

    // Attach media query listener with cross-browser fallback
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler as EventListener);
    } else {
      // @ts-ignore - legacy addListener
      mql.addListener(handler as any);
    }

    // visualViewport can change when mobile browser chrome shows/hides — handle it
    const vv = (window as any).visualViewport;
    const onVvResize = () => setMatches(window.matchMedia(query).matches);
    vv?.addEventListener?.('resize', onVvResize);

    // Sync initial state
    handler();

    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handler as EventListener);
      } else {
        // @ts-ignore - legacy removeListener
        mql.removeListener(handler as any);
      }
      vv?.removeEventListener?.('resize', onVvResize);
    };
  }, [query]);

  return matches;
}
