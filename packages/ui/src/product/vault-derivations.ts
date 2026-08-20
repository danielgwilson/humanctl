import type { VaultEntity } from "./vault-snapshot"

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
