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
  "generatedAt": "2026-08-02T09:00:00-07:00",               // carry an offset (or Z)
  "vitals": {
    "entities": 82, "canonPages": 61,
    "lastIngest": "2026-08-02T07:00:00-07:00", "ingestOk": true, // measured, never a constant
    "notice": "One sentence, only when ingestOk is false.",
    "staleAfter": "2026-08-02T12:00:00-07:00",                 // producer's refresh deadline
    "sources": [{ "label": "Notes folder", "status": "ok", "affectsIngest": true,
                  "lastSuccessAt": "2026-08-02T08:50:00-07:00", "dataThrough": "2026-08-02" }]
  },
  "entities": [{
    "kind": "person",
    "id": "person:example-one",
    "label": "Example One",
    "labels":      { "group": "inner", "lifecycle": "steady" }, // groupable values
    "annotations": { "role": "Founder, example co" },           // shown, not interpreted
    "spec": {
      "priority": 92, "lastContactAt": "2026-07-26", "cadenceDays": 14,
      "status": "on-track",                                      // producer-resolved
      "summary": "The 60-second brief: where things were left off.",
      "nextTouch": "The next concrete action.",
      "sections": [
        { "heading": "Open threads", "body": "...", "level": 2 },
        { "heading": "Decision rights", "level": 3, "items": ["Owns releases", "Escalates scope changes"] }
      ],
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

## Brief versus dossier

`spec.summary` is the short brief. `spec.nextTouch` is the next concrete action.
Neither replaces the dossier.

`spec.sections` carries the producer's ordered, curated depth. A section has a
required plain-text `heading`, an optional plain-text `body`, an optional heading
`level` (`2`, `3`, or `4`), and optional plain-text `items`. This preserves a
useful hierarchy and lists without sending trusted HTML or requiring humanctl to
parse a producer's Markdown. Existing `{ heading, body }` sections remain valid.

The producer owns the privacy boundary. It should export only the facts and
evidence appropriate for this local viewer, remove secrets, and avoid duplicating
the summary inside the sections. humanctl reads only the configured snapshot; it
does not inspect the source vault.

## Freshness

A snapshot can be written on schedule while the data inside it stopped moving
days ago. The `generatedAt` time alone cannot show that, so the producer
reports ingest health in `vitals`, and the viewer shows it without judging it.
All of these fields are optional and additive under `v1alpha1`.

| Field | Meaning |
|---|---|
| `generatedAt` | When the producer wrote the snapshot. Write it with `Z` or a UTC offset. A value with no offset is read as the viewer's local time, which is only right when producer and viewer share a timezone. |
| `vitals.ingestOk` | The producer's measured verdict that its sources are current. Compute it from a measurement (for example, newest ingested item versus now, against the producer's own threshold). A hardcoded value is worse than omitting it. |
| `vitals.lastIngest` | When data last arrived. ISO 8601 is preferred; a short relative label like `"2h"` is still accepted and shown as-is. |
| `vitals.notice` | One sentence the producer writes when `ingestOk` is `false`, saying what is behind and what that means for the data. Omit it when healthy. |
| `vitals.staleAfter` | ISO 8601 instant after which the viewer treats this snapshot as stale, even when `ingestOk` is `true`. The producer sets it from its own cadence, for example write time plus a few runs. When it is absent, the viewer falls back to 24 hours after `generatedAt`. |
| `vitals.sources[]` | One entry per producer input: `label` and `status` (required), plus optional `lastSuccessAt`, `dataThrough` (ISO 8601), `note`, and `affectsIngest`. `status` is `ok` (or `healthy`) when current; any other value, such as `stale`, `partial`, `blocked`, or `error`, is shown as written. |
| `vitals.sources[].affectsIngest` | `true` when this source feeds `ingestOk`. Only these sources reach the banner and the Last ingest hint. A source marked `false`, or left unmarked while another source is marked, is background: it is listed only in the collapsed source detail. When no source declares the field, every source counts for the banner, as it did before the field existed, and the hint stays off. |

Times follow one rule everywhere: a date-only value (`YYYY-MM-DD`) is that
calendar day in the viewer's timezone and ages in whole days from local
midnight ("today", "yesterday", "3d ago"), never in hours. A date-time with
`Z` or an offset is that exact instant; one without an offset is local time.

What the Brain view does with them:

- **`ingestOk: false`** shows a warning banner above the People list and on
  every person page. Its text is `vitals.notice`, falling back to "Sources are
  stale since <date>." Under it, up to three ingest-affecting sources that are
  not `ok` are listed, one line each, most severe first (`blocked` and `error`,
  then `stale`, then `partial`, then anything else; ties keep the producer's
  order). A "+N more" line counts the rest.
- **`ingestOk: true` with an ingest-affecting source not `ok`** raises no
  banner. The Last ingest tile names it instead of reading `clean`, for
  example "1 source partial", in a quieter notice tone.
- **The source detail** is a collapsed "N sources not current" line under the
  health strip on the People list. It lists every source that is not `ok`,
  ingest-affecting ones first, with full notes. It is the only place
  background sources appear.
- **The Last ingest tile** shows an ISO `lastIngest` as a date plus its age.
  It turns to the warning tone and reads `stale` when `ingestOk` is `false`,
  and `unverified` when the snapshot is past its refresh time. A missing
  `ingestOk` reads `unknown`, never `clean`.
- **The header** shows `generatedAt` with its age. Once the snapshot is past
  `vitals.staleAfter` (or older than 24 hours when the producer gives none),
  the header turns to the warning tone and the banner appears even if
  `ingestOk` is `true`: a producer that stopped running cannot report that it
  stopped. That banner lists no sources, because they are not why it fires.
  The 24 hour fallback is the one freshness rule the viewer applies itself,
  and it is a presentation threshold, not a domain rule.

## How humanctl reads it

- The snapshot path is a user setting. When unset, the Brain view shows an
  onboarding state; nothing is read.
- The file is read and parsed off the main process (in the reader-service), size
  capped, and envelope-validated before it reaches the UI. A missing, unreadable,
  malformed, or unsupported-version file degrades to a clear empty state, never a
  crash.
- The snapshot is reread every time the Brain view is entered and whenever
  the window regains focus while Brain is open; a reread already in flight is
  joined, not repeated, and an unchanged file causes no re-render. The header
  shows the snapshot generation time and age and offers an explicit reload. A
  failed reload keeps the prior snapshot visible with a warning.
  People search is local to the loaded snapshot and matches rendered names,
  stable IDs, roles, labels, summaries, sections, evidence, and relationships.
- In the browser build and screenshots, a fabricated snapshot in the fixture
  adapter stands in for a real producer, so the view is always reviewable without
  any real data. Add `?brain=<variant>` to the dev-server URL to review a
  freshness path: `stale` (ingest behind), `partial-other` (a background source
  partial), `partial-ingest` (an ingest source partial while `ingestOk` is
  `true`), or `expired` (past `staleAfter`).

## The one guarantee

No producer ontology or data lives in this repo. The acceptance test is literal:

```
git grep -nE "<your domain terms>" -- packages/ electron/ lib/   # returns nothing
```

Only the generic schema above and fabricated fixtures are tracked. A produced
snapshot is the operator's personal data and is git-ignored.
