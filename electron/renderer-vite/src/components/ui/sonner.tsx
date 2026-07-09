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
          // Toast copy is one of docs/design-system.md 2.1's enumerated sans
          // call sites verbatim ("toasts") -- the one transient-feedback
          // surface for a mutation, and the message inside it is language
          // addressed to the human, not a machine value.
          toast:
            // eslint-disable-next-line design-system/spacing-steps -- stage 5 (#71) item 8: Toast primitive rewrite owns this padding; zero-visual-delta this stage.
            "flex w-full items-center gap-2.5 rounded-md hairline bg-surface-2 px-3.5 py-2.5 font-sans text-prose text-ink shadow-none data-[type=error]:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)] data-[type=error]:text-block-contrast",
          title: "font-medium",
          description: "text-ink-3",
          // Buttons keep `row`, the one label role every Button/IconButton
          // size resolves to (section 6) -- these sit inside sans-language
          // toast copy, so the family must be re-asserted explicitly.
          actionButton:
            // eslint-disable-next-line design-system/no-arbitrary-length -- stage 5 (#71) item 8: Toast primitive rewrite owns this radius.
            "ml-auto rounded-[5px] shadow-[inset_0_0_0_var(--hairline-w)_var(--iris-contrast)] bg-transparent px-2 py-1 font-mono text-row text-iris-contrast hover:bg-iris-soft",
          // eslint-disable-next-line design-system/no-arbitrary-length -- stage 5 (#71) item 8: Toast primitive rewrite owns this radius.
          cancelButton: "rounded-[5px] px-2 py-1 font-mono text-row text-ink-3 hover:text-ink",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
