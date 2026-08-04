import { useEffect } from "react"

import type { HumanctlDispatch, HumanctlSession, HumanctlSessionState } from "./contracts"

// Move DOM focus into the reply composer. The composer form carries
// data-slot="composer" (blocks/composer.tsx) and wraps a single textarea.
export function focusComposer() {
  const el = document.querySelector<HTMLTextAreaElement>('[data-slot="composer"] textarea')
  if (el && !el.disabled) el.focus()
}

type WorkLoopRow = { id: string; state?: HumanctlSessionState }

// The operator work-loop keys for a list view: j/k move the selection, "/"
// focuses that view's search, Enter or e drops into the composer for the
// selected session, r resumes it. Modifier combos and typing in an
// input/textarea are ignored, so the global palette/nav shortcuts and normal
// text entry are untouched. This is a pure keydown listener (no timers, no
// fs/IPC), so it never blocks the main process.
export function useWorkLoopKeys(opts: {
  ordered: ReadonlyArray<WorkLoopRow>
  selectedId: string | undefined
  selectedSession: HumanctlSession | null
  onSelect: (id: string) => void
  onFocusSearch: () => void
  dispatch: HumanctlDispatch
}) {
  const { ordered, selectedId, selectedSession, onSelect, onFocusSearch, dispatch } = opts
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return
      if (event.key === "j" || event.key === "k") {
        if (ordered.length === 0) return
        event.preventDefault()
        const index = selectedId ? ordered.findIndex((row) => row.id === selectedId) : -1
        const base = index < 0 ? (event.key === "j" ? -1 : 0) : index
        const next = Math.max(0, Math.min(ordered.length - 1, base + (event.key === "j" ? 1 : -1)))
        const row = ordered[next]
        if (row) onSelect(row.id)
      } else if (event.key === "/") {
        event.preventDefault()
        onFocusSearch()
      } else if ((event.key === "Enter" || event.key === "e") && selectedSession) {
        event.preventDefault()
        focusComposer()
      } else if (event.key === "r" && selectedSession) {
        event.preventDefault()
        void dispatch({ type: "session.resume", session: selectedSession })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [ordered, selectedId, selectedSession, onSelect, onFocusSearch, dispatch])
}
