// Vendored verbatim from shadcn/ui's use-mobile hook (registry: new-york,
// fetched from https://ui.shadcn.com/r/styles/new-york/use-mobile.json,
// stage 2b). No repo-specific changes needed: it has no imports to rewrite.
// Backs Sidebar's mobile (Sheet) breakpoint; humanctl runs as a desktop
// Electron window so this rarely fires, but it is part of the shadcn Sidebar
// contract (see sidebar.tsx's `isMobile` usage) and keeps a narrow window
// (e.g. a resized dev window) usable.
import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener('change', onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return !!isMobile;
}
