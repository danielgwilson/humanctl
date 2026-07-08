import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { cn } from "@/lib/utils"

// humanctl themes by toggling a `.light` class on <html> (App.tsx), not
// next-themes or `prefers-color-scheme` -- the theme can be pinned to
// dark/light regardless of the OS preference (DESIGN.md: "the theme is not
// driven by the OS prefers-color-scheme unless the theme is set to
// system"). Reading next-themes' `useTheme()` here would silently disagree
// with the app's own resolved theme, so this reads the SAME source of truth
// (the <html> class) instead of adding a second theme system as a
// dependency.
function useResolvedTheme(): "light" | "dark" {
  const [light, setLight] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("light")
  )
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setLight(root.classList.contains("light")))
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return light ? "light" : "dark"
}

// The one toast surface for the app, restoring the OLD renderer's action
// feedback (theme/engine/budget changes, mark-all-read, resume, command-
// palette actions) that the React port silently dropped. Flat panel2
// surface, mono type, hairline border -- `unstyled` + `classNames` below
// replaces sonner's stock rounded-shadow card and colored success/error
// iconography entirely (this app only ever calls the plain `toast(message)`
// form, never `toast.success`/`toast.error`, so no built-in colored icon
// ever renders); never a shadow-as-hierarchy card (DESIGN.md: "flat
// surfaces, no cards, no shadows-as-hierarchy").
const Toaster = ({ className, ...props }: ToasterProps) => {
  const theme = useResolvedTheme()

  return (
    <Sonner
      theme={theme}
      className={cn("toaster group", className)}
      position="bottom-right"
      gap={8}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2.5 rounded-md border border-border bg-panel2 px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground shadow-none data-[type=error]:border-block/45 data-[type=error]:text-block",
          title: "font-medium",
          description: "text-ink3",
          actionButton:
            "ml-auto rounded-[5px] border border-iris-dim bg-transparent px-2 py-1 font-mono text-[10px] text-iris hover:bg-iris/10",
          cancelButton: "rounded-[5px] px-2 py-1 font-mono text-[10px] text-ink3 hover:text-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
