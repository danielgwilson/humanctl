import * as React from "react"

const DEFAULT_MOBILE_BREAKPOINT = 768

export function useIsMobile(breakpoint = DEFAULT_MOBILE_BREAKPOINT) {
  const subscribe = React.useCallback((onChange: () => void) => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [breakpoint])
  const getSnapshot = React.useCallback(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint,
    [breakpoint],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
