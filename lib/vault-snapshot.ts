// Vault snapshot: the generic, versioned interchange the Brain view renders.
// This module is the node-side type + envelope validator used by the
// reader-service before a snapshot ever reaches the renderer. It is pure (no
// fs, no electron) so it unit-tests directly and never blocks the main process.
//
// The contract and machine-readable schema live in docs/vault-snapshot.md and
// docs/vault-snapshot.schema.json. Keep this mirror and that schema in step.
// The browser-side mirror is packages/ui/src/product/vault-snapshot.ts.
//
// Validation is deliberately permissive per the contract's rule 5: validate the
// ENVELOPE (version supported; each entity has id/kind/label), pass unknown
// fields through untouched, and never reject a document for extra keys.

export const CURRENT_VAULT_API_VERSION = 'humanctl.dev/vaultsnapshot/v1alpha1';

// Every apiVersion the current viewer can render. A snapshot outside this set is
// not malformed; it is a version the viewer does not understand, which the UI
// surfaces as a distinct "unsupported snapshot" state rather than an error.
export const SUPPORTED_VAULT_API_VERSIONS: ReadonlyArray<string> = [
  CURRENT_VAULT_API_VERSION,
];

// Curated snapshots are small by construction (the producer drops bodies and
// evidence text it does not need). Cap the read so a runaway or wrong-file path
// can never hand the main/reader process an unbounded parse.
export const MAX_VAULT_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export interface VaultRelation {
  type: string;
  targetRef: string;
  note?: string;
}

export interface VaultEntitySection {
  heading: string;
  body: string;
}

export interface VaultEntityEvidence {
  quote: string;
  date?: string;
  source?: string;
}

export interface VaultEntitySpec {
  priority?: number;
  lastContactAt?: string;
  cadenceDays?: number;
  status?: string;
  nextTouch?: string;
  summary?: string;
  sections?: VaultEntitySection[];
  evidence?: VaultEntityEvidence[];
  [key: string]: unknown;
}

export interface VaultEntity {
  kind: string;
  id: string;
  label: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  spec?: VaultEntitySpec;
  relations?: VaultRelation[];
}

export interface VaultFollowup {
  entityRef: string;
  reason?: string;
  status?: string;
  overdueDays?: number;
}

export interface VaultProposal {
  id: string;
  kind: string;
  title: string;
  rationale?: string;
  confidence?: number;
  evidence?: string[];
}

export interface VaultView {
  columns?: string[];
  sort?: string;
  groupBy?: string;
  labelTones?: Record<string, Record<string, string>>;
}

export interface VaultVitals {
  entities?: number;
  canonPages?: number;
  lastIngest?: string;
  ingestOk?: boolean;
  [key: string]: unknown;
}

export interface VaultSnapshot {
  apiVersion: string;
  generatedAt?: string;
  source?: string;
  vitals?: VaultVitals;
  entities: VaultEntity[];
  queues?: {
    followups?: VaultFollowup[];
    proposals?: VaultProposal[];
  };
  views?: Record<string, VaultView>;
}

export type VaultSnapshotValidation =
  | { ok: true; snapshot: VaultSnapshot }
  | { ok: false; error: string; unsupportedVersion?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed value as a vault snapshot envelope. Pure and total: returns
 * a discriminated result, never throws. Unknown/extra fields are preserved.
 */
export function validateVaultSnapshot(input: unknown): VaultSnapshotValidation {
  if (!isRecord(input)) {
    return { ok: false, error: 'snapshot must be a JSON object' };
  }
  const { apiVersion, entities } = input;
  if (typeof apiVersion !== 'string' || apiVersion.length === 0) {
    return { ok: false, error: 'snapshot is missing a string apiVersion' };
  }
  if (!SUPPORTED_VAULT_API_VERSIONS.includes(apiVersion)) {
    return {
      ok: false,
      unsupportedVersion: true,
      error: `unsupported snapshot apiVersion "${apiVersion}"`,
    };
  }
  if (!Array.isArray(entities)) {
    return { ok: false, error: 'snapshot.entities must be an array' };
  }
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    if (!isRecord(entity)) {
      return { ok: false, error: `entities[${i}] must be an object` };
    }
    if (typeof entity.kind !== 'string' || entity.kind.length === 0) {
      return { ok: false, error: `entities[${i}] is missing a string kind` };
    }
    if (typeof entity.id !== 'string' || entity.id.length === 0) {
      return { ok: false, error: `entities[${i}] is missing a string id` };
    }
    if (typeof entity.label !== 'string' || entity.label.length === 0) {
      return { ok: false, error: `entities[${i}] is missing a string label` };
    }
  }
  // The envelope holds. Everything past this point is optional and rendered
  // defensively by the viewer, so the parsed object is a valid snapshot.
  return { ok: true, snapshot: input as unknown as VaultSnapshot };
}
