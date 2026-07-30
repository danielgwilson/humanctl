import type { ReactNode } from "react"

// The catalog registry is the single source of truth for the docs viewer.
// One entry per documented leaf export of @humanctl/ui. scripts/verify-catalog.mjs
// asserts this list and the package exports map agree in both directions, so a
// new primitive cannot ship undocumented and a renamed export cannot rot a page.

export type CatalogKind = "component" | "block"

export type CatalogCategory =
  | "Actions"
  | "Inputs"
  | "Overlays"
  | "Navigation"
  | "Disclosure"
  | "Feedback"
  | "Data"
  | "Messaging"
  | "Typography"
  | "Surfaces"

export type CatalogProp = {
  name: string
  type: string
  note: string
}

export type CatalogState = {
  name: string
  description: string
  render: () => ReactNode
}

export type CatalogEntry = {
  /** URL slug and stable id. */
  id: string
  /** Display name, matches the primary export. */
  name: string
  kind: CatalogKind
  category: CatalogCategory
  /** The leaf export subpath, e.g. "components/button". Checked against package.json. */
  importPath: string
  /** The named exports a consumer imports from importPath. */
  exports: string[]
  /** One sentence: what it is and what it owns. */
  blurb: string
  tags: string[]
  /** Named live-preview variants, rendered one per stage in order. */
  states: CatalogState[]
  props?: CatalogProp[]
  accessibility?: string[]
  /** Copyable usage snippet. */
  usage: string
}

export type CatalogGroup = {
  category: CatalogCategory
  entries: CatalogEntry[]
}

// Entries are registered per source module below, then flattened. Keeping the
// per-file arrays makes it obvious which module a doc page belongs to.
import { actionEntries } from "./entries/actions"
import { inputEntries } from "./entries/inputs"
import { overlayEntries } from "./entries/overlays"
import { navigationEntries } from "./entries/navigation"
import { disclosureEntries } from "./entries/disclosure"
import { feedbackEntries } from "./entries/feedback"
import { dataEntries } from "./entries/data"
import { messagingEntries } from "./entries/messaging"
import { typographyEntries } from "./entries/typography"
import { surfaceEntries } from "./entries/surfaces"

export const CATALOG_ENTRIES: CatalogEntry[] = [
  ...actionEntries,
  ...inputEntries,
  ...overlayEntries,
  ...navigationEntries,
  ...disclosureEntries,
  ...feedbackEntries,
  ...dataEntries,
  ...messagingEntries,
  ...typographyEntries,
  ...surfaceEntries,
]

const CATEGORY_ORDER: CatalogCategory[] = [
  "Actions",
  "Inputs",
  "Overlays",
  "Navigation",
  "Disclosure",
  "Feedback",
  "Data",
  "Messaging",
  "Typography",
  "Surfaces",
]

export function groupedEntries(entries: CatalogEntry[]): CatalogGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    entries: entries
      .filter((entry) => entry.category === category)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.entries.length > 0)
}

export function matchesQuery(entry: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === "") return true
  const haystack = [entry.name, entry.category, entry.blurb, entry.importPath, ...entry.tags]
    .join(" ")
    .toLowerCase()
  return haystack.includes(q)
}
