import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { TooltipProvider } from "@humanctl/ui/components/tooltip"

import {
  CATALOG_ENTRIES,
  groupedEntries,
  matchesQuery,
  type CatalogEntry,
} from "./registry"

function useHashSelection(entries: CatalogEntry[]): [string, (id: string) => void] {
  const first = entries[0]?.id ?? ""
  const [id, setId] = useState<string>(() => {
    const hash = window.location.hash.replace(/^#/, "")
    return entries.some((entry) => entry.id === hash) ? hash : first
  })
  const select = useCallback((next: string) => {
    setId(next)
    if (window.location.hash.replace(/^#/, "") !== next) {
      history.replaceState(null, "", `#${next}`)
    }
  }, [])
  useEffect(() => {
    function onHash() {
      const hash = window.location.hash.replace(/^#/, "")
      if (entries.some((entry) => entry.id === hash)) setId(hash)
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [entries])
  return [id, select]
}

function ThemeToggle() {
  const [light, setLight] = useState(() => document.documentElement.classList.contains("light"))
  const toggle = useCallback(() => {
    setLight((prev) => {
      const next = !prev
      document.documentElement.classList.toggle("light", next)
      return next
    })
  }, [])
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-[6px] border border-border px-2.5 py-1 font-mono text-[11px] tracking-wide text-ink-2 transition-colors hover:bg-overlay hover:text-ink"
    >
      {light ? "Light" : "Dark"}
    </button>
  )
}

function NavRail({
  entries,
  selectedId,
  onSelect,
  query,
  onQuery,
}: {
  entries: CatalogEntry[]
  selectedId: string
  onSelect: (id: string) => void
  query: string
  onQuery: (value: string) => void
}) {
  const groups = useMemo(() => groupedEntries(entries), [entries])
  const flat = useMemo(() => groups.flatMap((group) => group.entries), [groups])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      event.preventDefault()
      const index = flat.findIndex((entry) => entry.id === selectedId)
      const nextIndex =
        event.key === "ArrowDown"
          ? Math.min(flat.length - 1, index + 1)
          : Math.max(0, index - 1)
      const next = flat[nextIndex]
      if (next) onSelect(next.id)
    },
    [flat, onSelect, selectedId],
  )

  return (
    <nav
      aria-label="Catalog"
      className="flex w-64 flex-none flex-col border-r border-border bg-sunken"
      onKeyDown={onKeyDown}
    >
      <div className="border-b border-border p-3">
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.currentTarget.value)}
          placeholder="Search components"
          aria-label="Search components"
          className="h-8 w-full rounded-[6px] border border-border bg-background px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-4 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {flat.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-ink-4">No components match.</p>
        ) : (
          groups.map((group) => (
            <div key={group.category} className="mb-1 last:mb-0">
              <div className="px-4 pt-3 pb-1 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
                {group.category}
              </div>
              {group.entries.map((entry) => {
                const active = entry.id === selectedId
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onSelect(entry.id)}
                    aria-current={active}
                    className={
                      "flex w-full items-center gap-2 px-4 py-1.5 text-left text-[13px] transition-colors " +
                      (active
                        ? "bg-accent-soft text-ink shadow-[inset_2px_0_0_0_var(--color-primary)]"
                        : "text-ink-2 hover:bg-overlay hover:text-ink")
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.kind === "block" ? (
                      <span className="font-mono text-[9px] tracking-wide text-ink-4 uppercase">
                        block
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
    </nav>
  )
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    // one-shot: clears the copied affordance 1.4s after a click, no recurring timer
    timer.current = setTimeout(() => setCopied(false), 1400)
  }, [text])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-border bg-sunken px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">{text}</code>
      <button
        type="button"
        onClick={copy}
        className="flex-none rounded-[6px] px-2 py-0.5 font-mono text-[11px] text-ink-3 transition-colors hover:bg-overlay hover:text-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-[10px] tracking-[0.08em] text-ink-3 uppercase">
      {children}
    </h2>
  )
}

function PreviewStage({
  name,
  description,
  children,
}: {
  name: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-3.5 py-2">
        <span className="font-mono text-[10px] tracking-[0.08em] text-ink-3 uppercase">{name}</span>
        <span className="truncate text-[11px] text-ink-4">{description}</span>
      </div>
      <div className="flex min-h-28 items-center justify-center p-8">{children}</div>
    </div>
  )
}

function DetailPane({ entry }: { entry: CatalogEntry }) {
  return (
    <article className="mx-auto flex max-w-4xl flex-col gap-9 px-10 py-10 max-[900px]:px-6">
      <header className="flex flex-col gap-2.5">
        <div className="font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
          {entry.category} · {entry.kind}
        </div>
        <h1 className="text-[26px] leading-[30px] font-semibold tracking-[-0.02em] text-ink">
          {entry.name}
        </h1>
        <p className="max-w-[62ch] text-[15px] leading-6 text-ink-2">{entry.blurb}</p>
        {entry.tags.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-[5px] bg-overlay px-2 py-0.5 font-mono text-[10px] tracking-wide text-ink-3"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <section>
        <SectionLabel>Import</SectionLabel>
        <CopyLine text={`import { ${entry.exports.join(", ")} } from "@humanctl/ui/${entry.importPath}"`} />
      </section>

      <section>
        <SectionLabel>{entry.states.length > 1 ? "States" : "Preview"}</SectionLabel>
        <div className="flex flex-col gap-4">
          {entry.states.map((state) => (
            <PreviewStage key={state.name} name={state.name} description={state.description}>
              {state.render()}
            </PreviewStage>
          ))}
        </div>
      </section>

      {entry.props && entry.props.length > 0 ? (
        <section>
          <SectionLabel>Props</SectionLabel>
          <div className="overflow-hidden rounded-[10px] border border-border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3.5 py-2 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">Prop</th>
                  <th className="px-3.5 py-2 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">Type</th>
                  <th className="px-3.5 py-2 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">Note</th>
                </tr>
              </thead>
              <tbody>
                {entry.props.map((prop) => (
                  <tr key={prop.name} className="border-b border-border last:border-b-0 align-top">
                    <td className="px-3.5 py-2.5 font-mono text-[12px] text-ink"><span className="whitespace-nowrap">{prop.name}</span></td>
                    <td className="px-3.5 py-2.5 font-mono text-[12px] text-accent-contrast">{prop.type}</td>
                    <td className="px-3.5 py-2.5 text-[13px] leading-5 text-ink-2">{prop.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {entry.accessibility && entry.accessibility.length > 0 ? (
        <section>
          <SectionLabel>Accessibility</SectionLabel>
          <ul className="flex max-w-[64ch] flex-col gap-2">
            {entry.accessibility.map((item, index) => (
              <li key={index} className="relative pl-4 text-[13px] leading-5 text-ink-2">
                <span className="absolute top-[9px] left-0 h-px w-2 bg-ink-4" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionLabel>Usage</SectionLabel>
        <pre className="overflow-x-auto rounded-[10px] border border-border bg-sunken p-4 font-mono text-[12px] leading-5 text-ink-2">
          <code>{entry.usage}</code>
        </pre>
      </section>
    </article>
  )
}

export function CatalogApp() {
  const [query, setQuery] = useState("")
  const filtered = useMemo(
    () => CATALOG_ENTRIES.filter((entry) => matchesQuery(entry, query)),
    [query],
  )
  const [selectedId, setSelectedId] = useHashSelection(CATALOG_ENTRIES)
  const selected =
    CATALOG_ENTRIES.find((entry) => entry.id === selectedId) ?? CATALOG_ENTRIES[0]

  // Keep the selection valid while filtering, without stealing an explicit pick.
  const detailKey = selected?.id

  return (
    <TooltipProvider>
      <div data-slot="catalog-app" className="flex h-dvh flex-col bg-background text-ink">
        <header className="flex h-12 flex-none items-center gap-3 border-b border-border px-4">
          <span className="font-mono text-[13px] font-semibold text-ink">humanctl</span>
          <span className="font-mono text-[11px] text-ink-4">ui foundation</span>
          <span className="ml-auto font-mono text-[11px] text-ink-4">
            {CATALOG_ENTRIES.length} entries
          </span>
          <ThemeToggle />
        </header>
        <div className="flex min-h-0 flex-1">
          <NavRail
            entries={filtered}
            selectedId={selectedId}
            onSelect={setSelectedId}
            query={query}
            onQuery={setQuery}
          />
          <main className="min-w-0 flex-1 overflow-y-auto">
            {selected ? <DetailPane key={detailKey} entry={selected} /> : null}
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
