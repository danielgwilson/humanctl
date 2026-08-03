# The vault snapshot contract

The Brain view renders a **vault snapshot**: one generic, versioned JSON document
that a producer writes and humanctl reads. This page is the contract. The
machine-readable schema is [`vault-snapshot.schema.json`](./vault-snapshot.schema.json).

## Two machines, one thin contract

humanctl is a general tool. It must not encode any producer's domain ontology and
must never hold a producer's raw data. So the design splits cleanly:

```
producer (yours, private)                 humanctl (this repo, public)
─────────────────────────                 ────────────────────────────
your knowledge base + tooling  ─export─►  vault-snapshot.json  ─read─►  Brain view
  (all your opinions live here)           (generic interchange)         (renders it)
```

- **The producer** maps its own opinionated schema into this generic snapshot,
  pre-computes any derived state, drops anything private, and writes one file.
  All domain knowledge stays on the producer's side.
- **humanctl** reads that one file from a path the user configures, validates the
  envelope, and renders it. It never walks a raw vault and never learns a domain
  vocabulary.

This is the same shape as Backstage's software catalog (a generic UI over a
documented entity envelope fed by external providers) and JSON Resume (fixed data,
swappable views). The precedent is deliberate.

## The envelope

```jsonc
{
  "apiVersion": "humanctl.dev/vaultsnapshot/v1alpha1",   // version lives IN the doc
  "generatedAt": "2026-08-02T09:00:00Z",
  "vitals": { "entities": 82, "canonPages": 61, "lastIngest": "2h" },
  "entities": [{
    "kind": "person",
    "id": "person:example-one",
    "label": "Example One",
    "labels":      { "group": "inner", "lifecycle": "steady" }, // groupable values
    "annotations": { "role": "Founder, example co" },           // shown, not interpreted
    "spec": {
      "priority": 92, "lastContactAt": "2026-07-26", "cadenceDays": 14,
      "status": "on-track",                                      // producer-resolved
      "summary": "Where things were left off.",
      "sections": [{ "heading": "Open threads", "body": "..." }],
      "evidence": [{ "date": "2026-07-18", "source": "a-note.md", "quote": "..." }]
    },
    "relations": [{ "type": "connected", "targetRef": "person:example-two", "note": "co-investor" }]
  }],
  "queues": {
    "followups": [{ "entityRef": "person:example-two", "reason": "...", "overdueDays": 20 }],
    "proposals": [{ "kind": "merge", "id": "p1", "title": "...", "confidence": 0.86, "evidence": ["a.md"] }]
  },
  "views": { "people": { "columns": ["group", "priority", "lastContactAt", "status"], "sort": "priority:desc" } }
}
```

## The rules that keep it generic

1. **The version lives in the document** (`apiVersion`). The viewer keys off it and
   shows an "unsupported snapshot" state on an unknown major rather than crashing.
2. **Domain values are data, not schema.** A relationship tier, a lifecycle stage,
   anything domain-specific ships as a *value* inside `labels` (groupable) or
   `annotations` (shown, not interpreted). It is never a named column the viewer
   hardcodes. The viewer can "group or color by any label" without knowing what a
   label means.
3. **Relationships are a typed edge list** (`relations: [{ type, targetRef }]`),
   never nested documents. `targetRef` points at another entity by id.
4. **The producer pre-computes opinion.** A resolved `status`, a follow-up list, a
   proposal set: the producer decides these. The viewer never re-implements a rule.
5. **The viewer degrades gracefully.** It validates only the envelope (version
   present and supported; each entity has `id`, `kind`, `label`). Unknown entity
   kinds and unknown fields render with generic columns and a key/value fallback;
   they never fail the whole document.
6. **Presentation opinion travels as data.** A `views` hint names which keys become
   columns and the default sort, so even the presentation choice lives with the
   producer, not in viewer code.

## How humanctl reads it

- The snapshot path is a user setting. When unset, the Brain view shows an
  onboarding state; nothing is read.
- The file is read and parsed off the main process (in the reader-service), size
  capped, and envelope-validated before it reaches the UI. A missing, unreadable,
  malformed, or unsupported-version file degrades to a clear empty state, never a
  crash.
- In the browser build and screenshots, a fabricated snapshot in the fixture
  adapter stands in for a real producer, so the view is always reviewable without
  any real data.

## The one guarantee

No producer ontology or data lives in this repo. The acceptance test is literal:

```
git grep -nE "<your domain terms>" -- packages/ electron/ lib/   # returns nothing
```

Only the generic schema above and fabricated fixtures are tracked. A produced
snapshot is the operator's personal data and is git-ignored.
