import type { VaultEntity, VaultSnapshot } from "./vault-snapshot"

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
// ISO 8601 calendar date, optionally followed ("T" or a space) by a time with
// optional fractional seconds and an optional "Z" or UTC offset.
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Epoch milliseconds for an ISO 8601 date or date-time, or null for anything
 * else (a relative label like "2h", free text, a non-string, an impossible
 * date). One rule for every freshness value, so the tile, the banner, and the
 * header always agree:
 *
 * - a date-only value is local midnight of that calendar day;
 * - a date-time with "Z" or a UTC offset is that exact instant;
 * - a date-time with no offset is read as the viewer's local time.
 */
export function parseVaultInstant(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = ISO_RE.exec(value.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s, frac, zone] = match
  const year = Number(y), month = Number(mo) - 1, day = Number(d)
  const hour = Number(h || 0), minute = Number(mi || 0), second = Number(s || 0)
  const ms = frac ? Math.floor(Number(`0.${frac}`) * 1000) : 0
  const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  if (month > 11 || day < 1 || day > monthDays || hour > 23 || minute > 59 || second > 59) return null
  if (!zone) return new Date(year, month, day, hour, minute, second, ms).getTime()
  let offset = 0
  if (zone.toUpperCase() !== "Z") {
    const digits = zone.slice(1).replace(":", "")
    const hours = Number(digits.slice(0, 2)), minutes = Number(digits.slice(2) || 0)
    if (hours > 23 || minutes > 59) return null
    offset = (zone[0] === "-" ? -1 : 1) * (hours * 60 + minutes)
  }
  return Date.UTC(year, month, day, hour, minute, second, ms) - offset * MINUTE_MS
}

export function formatVaultDate(
  text: string,
  locale?: Intl.LocalesArgument,
): string | null {
  const at = parseVaultInstant(text)
  return at == null ? null : new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric" })
}

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

function localDayNumber(atMs: number): number {
  const date = new Date(atMs)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
}

/**
 * Age of an ISO value as shown beside it, or null when the value is not an
 * ISO date. A date-only value carries no time of day, so it ages in whole local
 * calendar days from local midnight ("today", "yesterday", "3d ago"), never in
 * hours. A date-time ages with formatVaultAge.
 */
export function formatVaultValueAge(value: unknown, now: number = Date.now()): string | null {
  const at = parseVaultInstant(value)
  if (at == null) return null
  if (!DATE_ONLY_RE.test(String(value).trim())) return formatVaultAge(at, now)
  const days = Math.round(localDayNumber(now) - localDayNumber(at))
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`
}

// A snapshot without `vitals.staleAfter` is flagged once it is this old, even
// when its own vitals claim health: a producer that stopped running cannot
// report that it stopped. This is a presentation fallback, not a domain rule;
// a producer that declares `staleAfter` sets its own cadence.
export const VAULT_SNAPSHOT_STALE_AFTER_MS = DAY_MS

// The banner lists at most this many sources, one line each. The rest stay in
// the collapsed source detail.
export const VAULT_BANNER_SOURCE_CAP = 3

// Source statuses that mean "current". Any other value is surfaced as-is.
const SOURCE_OK_STATUSES = new Set(["ok", "healthy"])
// Display order for statuses that are not current: broken first, then behind,
// then incomplete, then anything else. Ties keep the producer's order.
const SOURCE_STATUS_RANK: Record<string, number> = { blocked: 0, error: 0, failed: 0, stale: 1, partial: 2 }

export type VaultIngestState = "clean" | "stale" | "unknown"

export interface VaultSourceIssue {
  label: string
  status: string
  /** "data through Sep 22, 16d ago", "last success Sep 22, 16d ago", or null. */
  through: string | null
  /** The producer's note, collapsed to one line, or null. */
  note: string | null
  /** True when this source feeds the producer's ingest verdict. */
  affectsIngest: boolean
}

export interface VaultFreshness {
  /** Producer-reported ingest state. Missing `ingestOk` is "unknown", never "clean". */
  ingestState: VaultIngestState
  /** Health-strip "Last ingest" tile. `tone` is null when nothing needs attention. */
  lastIngest: { value: string; hint: string; tone: "warn" | "notice" | null }
  /** Header snapshot time, its age, and whether the snapshot is past its refresh time. */
  snapshot: { label: string; age: string; stale: boolean } | null
  /** Every source that is not current: ingest-affecting ones first, then by severity. */
  sources: VaultSourceIssue[]
  /**
   * Banner: shown when ingest is stale or the snapshot is past its refresh
   * time. `sources` holds at most VAULT_BANNER_SOURCE_CAP ingest-affecting
   * sources; `more` counts the ingest-affecting ones left out.
   */
  banner: { message: string; sources: VaultSourceIssue[]; more: number } | null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function datedPhrase(prefix: string, value: unknown, now: number, locale?: Intl.LocalesArgument): string | null {
  const age = formatVaultValueAge(value, now)
  return age == null ? null : `${prefix} ${formatVaultDate(String(value), locale)}, ${age}`
}

function sourceEntries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : []
}

// A producer that predates `affectsIngest` cannot say which inputs feed its
// verdict. When no entry declares it, every source counts for the banner, as
// it did before the field existed.
function declaresIngestSources(entries: Record<string, unknown>[]): boolean {
  return entries.some((source) => typeof source.affectsIngest === "boolean")
}

function sourceIssues(entries: Record<string, unknown>[], declared: boolean, now: number, locale?: Intl.LocalesArgument): VaultSourceIssue[] {
  const issues: VaultSourceIssue[] = []
  for (const source of entries) {
    const status = nonEmptyString(source.status) || "unknown"
    if (SOURCE_OK_STATUSES.has(status.toLowerCase())) continue
    issues.push({
      label: nonEmptyString(source.label) || "Unnamed source",
      status,
      through: datedPhrase("data through", source.dataThrough, now, locale)
        || datedPhrase("last success", source.lastSuccessAt, now, locale),
      note: nonEmptyString(source.note)?.replace(/\s+/g, " ") ?? null,
      affectsIngest: declared ? source.affectsIngest === true : true,
    })
  }
  const rank = (issue: VaultSourceIssue) => SOURCE_STATUS_RANK[issue.status.toLowerCase()] ?? 3
  // Array.prototype.sort is stable, so equal ranks keep the producer's order.
  return issues.sort((a, b) => Number(b.affectsIngest) - Number(a.affectsIngest) || rank(a) - rank(b))
}

function issueSummary(issues: VaultSourceIssue[]): string {
  const statuses = new Set(issues.map((issue) => issue.status.toLowerCase()))
  const noun = issues.length === 1 ? "source" : "sources"
  return `${issues.length} ${noun} ${statuses.size === 1 ? issues[0].status : "not current"}`
}

/**
 * Everything the Brain view shows about how current a snapshot is, derived
 * once so the header, health strip, banner, and source detail can never
 * disagree. Pure: pass `now` (and a locale) to make it deterministic.
 *
 * The viewer does not judge a producer's sources. It surfaces the producer's
 * own `ingestOk`, `notice`, and `sources[]`, honors the producer's
 * `staleAfter`, and adds one generic rule of its own: without `staleAfter`, a
 * snapshot older than VAULT_SNAPSHOT_STALE_AFTER_MS is flagged.
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
  const entries = sourceEntries(vitals.sources)
  const declared = declaresIngestSources(entries)
  const sources = sourceIssues(entries, declared, now, locale)
  const ingestIssues = sources.filter((source) => source.affectsIngest)

  const generatedAt = parseVaultInstant(snapshot.generatedAt)
  const staleAfter = parseVaultInstant(vitals.staleAfter)
  const expired = staleAfter != null
    ? now > staleAfter
    : generatedAt != null && now - generatedAt > VAULT_SNAPSHOT_STALE_AFTER_MS
  const snapshotInfo = generatedAt != null
    ? {
      label: new Date(generatedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      age: formatVaultAge(generatedAt, now),
      stale: expired,
    }
    : null

  const rawIngest = nonEmptyString(vitals.lastIngest)
  const ingestDate = rawIngest ? formatVaultDate(rawIngest, locale) : null
  const ingestAge = rawIngest ? formatVaultValueAge(rawIngest, now) : null
  // The quiet hint needs the producer to mark its ingest sources; without the
  // marks a healthy verdict stays "clean", as before.
  const noticeIssues = declared && ingestState === "clean" && !expired && ingestIssues.length > 0
  const word = ingestState === "stale" ? "stale"
    : expired ? "unverified"
      : noticeIssues ? issueSummary(ingestIssues) : ingestState
  const lastIngest = {
    value: ingestDate || rawIngest || "n/a",
    hint: [ingestAge, word].filter(Boolean).join(" · "),
    tone: ingestState === "stale" || expired ? "warn" as const : noticeIssues ? "notice" as const : null,
  }

  let banner: VaultFreshness["banner"] = null
  if (ingestState === "stale") {
    const message = nonEmptyString(vitals.notice)
      || (ingestDate ? `Sources are stale since ${ingestDate}.` : rawIngest ? `Sources are stale. Last ingest: ${rawIngest}.` : "Sources are stale.")
    const shown = ingestIssues.slice(0, VAULT_BANNER_SOURCE_CAP)
    banner = { message, sources: shown, more: ingestIssues.length - shown.length }
  } else if (expired) {
    // The sources are not why this fires, so the banner lists none of them.
    const age = snapshotInfo && snapshotInfo.age !== "just now" ? ` ${snapshotInfo.age.replace(/ ago$/, "")} old and` : ""
    banner = { message: `This snapshot is${age} past its refresh time. The producer may have stopped running.`, sources: [], more: 0 }
  }

  return { ingestState, lastIngest, snapshot: snapshotInfo, sources, banner }
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
