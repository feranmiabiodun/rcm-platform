import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // Initialize from matchMedia if available (SSR-safe)
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    // Handler supports both MediaQueryListEvent (modern) and fallback
    const onChange = (e?: MediaQueryListEvent | MediaQueryList) => {
      // if event provided use its matches, otherwise read from mql
      const matches = e && "matches" in e ? e.matches : mql.matches;
      setIsMobile(!!matches);
    };

    // Attach listener with cross-browser support
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange as EventListener);
    } else {
      // @ts-ignore - legacy addListener
      mql.addListener(onChange);
    }

    // visualViewport helps capture mobile browser chrome (address bar) changes
    const vv = (window as any).visualViewport;
    const onVvResize = () =>
      setIsMobile(window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches);
    vv?.addEventListener?.("resize", onVvResize);

    // Run once to sync initial state
    onChange();

    return () => {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", onChange as EventListener);
      } else {
        // @ts-ignore - legacy removeListener
        mql.removeListener(onChange);
      }
      vv?.removeEventListener?.("resize", onVvResize);
    };
  }, []);

  return isMobile;
}
