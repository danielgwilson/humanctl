import type { VaultEntity, VaultSnapshot } from "./vault-snapshot"

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/

export function formatVaultDate(
  text: string,
  locale?: Intl.LocalesArgument,
): string | null {
  if (!DATE_PREFIX_RE.test(text)) return null
  const dateOnly = DATE_ONLY_RE.test(text)
  const date = new Date(dateOnly ? `${text}T00:00:00Z` : text)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  })
}

/**
 * Epoch milliseconds for an ISO 8601 date or date-time, or null for anything
 * else (a relative label like "2h", free text, a non-string). A date-only value
 * is read as UTC midnight, matching formatVaultDate's calendar-day rule.
 */
export function parseVaultInstant(value: unknown): number | null {
  if (typeof value !== "string" || !DATE_PREFIX_RE.test(value)) return null
  const time = Date.parse(DATE_ONLY_RE.test(value) ? `${value}T00:00:00Z` : value)
  return Number.isFinite(time) ? time : null
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Compact age of a past instant, floored so it never overstates freshness:
 * "just now", "5m ago", "2h ago", "16d ago". A future instant (clock skew)
 * reads as "just now".
 */
export function formatVaultAge(atMs: number, now: number = Date.now()): string {
  const delta = now - atMs
  if (!Number.isFinite(delta) || delta < MINUTE_MS) return "just now"
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m ago`
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h ago`
  return `${Math.floor(delta / DAY_MS)}d ago`
}

// A snapshot the producer has not rewritten for this long is flagged even when
// its own vitals claim health: a producer that stopped running cannot report
// that it stopped. This is a presentation threshold, not a domain rule.
export const VAULT_SNAPSHOT_STALE_AFTER_MS = DAY_MS

// Source statuses that mean "current". Any other value is surfaced as-is.
const SOURCE_OK_STATUSES = new Set(["ok", "healthy"])

export type VaultIngestState = "clean" | "stale" | "unknown"

export interface VaultSourceIssue {
  label: string
  status: string
  /** "data through Sep 22, 16d ago", "last success Sep 22, 16d ago", or null. */
  through: string | null
  note: string | null
}

export interface VaultFreshness {
  /** Producer-reported ingest state. Missing `ingestOk` is "unknown", never "clean". */
  ingestState: VaultIngestState
  /** Health-strip "Last ingest" tile. */
  lastIngest: { value: string; hint: string; warn: boolean }
  /** Header snapshot time, its age, and whether that age is past the threshold. */
  snapshot: { label: string; age: string; stale: boolean } | null
  /** Banner: shown when ingest is stale or the snapshot itself is old. */
  banner: { message: string; sources: VaultSourceIssue[] } | null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function sourceIssues(value: unknown, now: number, locale?: Intl.LocalesArgument): VaultSourceIssue[] {
  if (!Array.isArray(value)) return []
  const issues: VaultSourceIssue[] = []
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue
    const source = entry as Record<string, unknown>
    const status = nonEmptyString(source.status) || "unknown"
    if (SOURCE_OK_STATUSES.has(status.toLowerCase())) continue
    const dataThrough = parseVaultInstant(source.dataThrough)
    const lastSuccess = parseVaultInstant(source.lastSuccessAt)
    let through: string | null = null
    if (dataThrough != null) {
      through = `data through ${formatVaultDate(String(source.dataThrough), locale)}, ${formatVaultAge(dataThrough, now)}`
    } else if (lastSuccess != null) {
      through = `last success ${formatVaultDate(String(source.lastSuccessAt), locale)}, ${formatVaultAge(lastSuccess, now)}`
    }
    issues.push({
      label: nonEmptyString(source.label) || "Unnamed source",
      status,
      through,
      note: nonEmptyString(source.note),
    })
  }
  return issues
}

/**
 * Everything the Brain view shows about how current a snapshot is, derived
 * once so the header, health strip, and banner can never disagree. Pure: pass
 * `now` (and a locale) to make it deterministic.
 *
 * The viewer does not judge a producer's sources. It surfaces the producer's
 * own `ingestOk`, `notice`, and `sources[]`, and adds one generic rule of its
 * own: a snapshot older than VAULT_SNAPSHOT_STALE_AFTER_MS is flagged.
 */
export function deriveVaultFreshness(
  snapshot: VaultSnapshot,
  now: number = Date.now(),
  locale?: Intl.LocalesArgument,
): VaultFreshness {
  const vitals = typeof snapshot.vitals === "object" && snapshot.vitals !== null && !Array.isArray(snapshot.vitals)
    ? snapshot.vitals as Record<string, unknown>
    : {}
  const ingestState: VaultIngestState = vitals.ingestOk === false ? "stale" : vitals.ingestOk === true ? "clean" : "unknown"

  const rawIngest = nonEmptyString(vitals.lastIngest)
  const ingestAt = parseVaultInstant(rawIngest)
  const ingestDate = ingestAt != null && rawIngest ? formatVaultDate(rawIngest, locale) : null
  const ingestAge = ingestAt != null ? formatVaultAge(ingestAt, now) : null
  const lastIngest = {
    value: ingestDate || rawIngest || "n/a",
    hint: [ingestAge, ingestState].filter(Boolean).join(" · "),
    warn: ingestState === "stale",
  }

  const generatedAt = parseVaultInstant(snapshot.generatedAt)
  const snapshotInfo = generatedAt != null
    ? {
      label: new Date(generatedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      age: formatVaultAge(generatedAt, now),
      stale: now - generatedAt > VAULT_SNAPSHOT_STALE_AFTER_MS,
    }
    : null

  let message: string | null = null
  if (ingestState === "stale") {
    message = nonEmptyString(vitals.notice)
      || (ingestDate ? `Sources are stale since ${ingestDate}.` : rawIngest ? `Sources are stale. Last ingest: ${rawIngest}.` : "Sources are stale.")
  } else if (snapshotInfo?.stale) {
    message = `This snapshot is ${snapshotInfo.age.replace(/ ago$/, "")} old. The producer has not written a new one since ${formatVaultDate(String(snapshot.generatedAt), locale)}.`
  }

  return {
    ingestState,
    lastIngest,
    snapshot: snapshotInfo,
    banner: message ? { message, sources: sourceIssues(vitals.sources, now, locale) } : null,
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function scalarValues(value: unknown): string[] {
  return Object.values(record(value))
    .filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    .map(String)
}

function sectionValues(value: unknown): string[] {
  const section = record(value)
  const items = Array.isArray(section.items)
    ? section.items.filter((item) => typeof item === "string").map(String)
    : []
  return [section.heading, section.body, ...items].filter((item): item is string => typeof item === "string")
}

export function vaultEntitySearchText(entity: VaultEntity): string {
  const spec = record(entity.spec)
  const annotations = record(entity.annotations)
  const sections = Array.isArray(spec.sections) ? spec.sections : []
  const evidence = Array.isArray(spec.evidence) ? spec.evidence : []
  const relations = Array.isArray(entity.relations) ? entity.relations : []
  return [
    entity.label,
    entity.id,
    entity.kind,
    ...scalarValues(entity.labels),
    ...scalarValues(annotations),
    ...scalarValues(spec),
    ...sections.flatMap(sectionValues),
    ...evidence.flatMap(scalarValues),
    ...relations.flatMap(scalarValues),
  ].filter(Boolean).join(" ").toLowerCase()
}

export function filterVaultEntities(
  entities: ReadonlyArray<VaultEntity>,
  query: string,
): VaultEntity[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return entities.slice()
  return entities.filter((entity) => {
    const haystack = vaultEntitySearchText(entity)
    return terms.every((term) => haystack.includes(term))
  })
}
