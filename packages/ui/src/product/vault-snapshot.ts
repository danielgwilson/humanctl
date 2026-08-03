// Browser-side mirror of the vault snapshot contract. The Brain view and the
// application model render this shape. The node-side mirror + envelope validator
// live in lib/vault-snapshot.ts; the machine-readable schema and the contract
// prose live in docs/vault-snapshot.schema.json and docs/vault-snapshot.md.
// Keep the three in step.
//
// The viewer treats this shape defensively: it renders known keys, shows unknown
// ones generically, and never assumes a producer's domain vocabulary. Domain
// values arrive as data inside `labels`/`annotations`/`spec`, never as fields
// the viewer hardcodes.

export const CURRENT_VAULT_API_VERSION = "humanctl.dev/vaultsnapshot/v1alpha1"

export const SUPPORTED_VAULT_API_VERSIONS: ReadonlyArray<string> = [
  CURRENT_VAULT_API_VERSION,
]

export interface VaultRelation {
  type: string
  targetRef: string
  note?: string
}

export interface VaultEntitySection {
  heading: string
  body: string
}

export interface VaultEntityEvidence {
  quote: string
  date?: string
  source?: string
}

export interface VaultEntitySpec {
  priority?: number
  lastContactAt?: string
  cadenceDays?: number
  status?: string
  nextTouch?: string
  summary?: string
  sections?: VaultEntitySection[]
  evidence?: VaultEntityEvidence[]
  [key: string]: unknown
}

export interface VaultEntity {
  kind: string
  id: string
  label: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
  spec?: VaultEntitySpec
  relations?: VaultRelation[]
}

export interface VaultFollowup {
  entityRef: string
  reason?: string
  status?: string
  overdueDays?: number
}

export interface VaultProposal {
  id: string
  kind: string
  title: string
  rationale?: string
  confidence?: number
  evidence?: string[]
}

export interface VaultView {
  columns?: string[]
  sort?: string
  groupBy?: string
  labelTones?: Record<string, Record<string, string>>
}

export interface VaultVitals {
  entities?: number
  canonPages?: number
  lastIngest?: string
  ingestOk?: boolean
  [key: string]: unknown
}

export interface VaultSnapshot {
  apiVersion: string
  generatedAt?: string
  source?: string
  vitals?: VaultVitals
  entities: VaultEntity[]
  queues?: {
    followups?: VaultFollowup[]
    proposals?: VaultProposal[]
  }
  views?: Record<string, VaultView>
}

/** True when the viewer understands this snapshot's apiVersion. */
export function isSupportedVaultVersion(apiVersion: string | undefined): boolean {
  return typeof apiVersion === "string" && SUPPORTED_VAULT_API_VERSIONS.includes(apiVersion)
}
