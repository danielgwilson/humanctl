# DESIGN.md (draft for the public repo root; builder copies verbatim after critic pass)

humanctl is an attention router for a scarce human running many coding-agent sessions. Every design decision serves one job: route the human to the next bounded decision with the least noise possible. When in doubt, subtract.

## The one rule

**One owner per signal.** Every piece of information has exactly one home per screen. Adding a second home for a signal requires deleting the first. If a review adds a count, digest, or status that already renders elsewhere on the same screen, the PR is wrong by definition.

Signal ownership:

| Signal | Owner | Exception |
|---|---|---|
| Fleet digest (counts) | header | Atlas drawer reuses the same component |
| What needs the human, ranked | Inbox list order | Atlas drawer may repeat the queue and digest because it is a summoned transient overlay, not an ambient surface |
| Session state + reason | row chip in lists; header chip in detail | none |
| Spend, tokens, quota | Metrics view (Atlas drawer summarizes) | header chip only when quota exceeds 80 percent |
| Complete fleet | Sessions view | none |
| Fleet chat | Atlas drawer | none |
| Chat with one session | session detail composer | Inbox reply is the same composer |
| Context fill | session detail meta | none |
| Notes stream | Inbox | per-session slice in detail |

## Information architecture

Nav (hidden rail; hover left edge reveals as overlay; Cmd+backslash pins): Inbox (default), Metrics, Fleet, Sessions, Settings. Opening any session from any view shows the full-width session detail with a back breadcrumb; Esc returns. Atlas is a summonable right-side drawer (key: a), never a permanent column.

## Vocabulary (one, everywhere)

Session states: `running`, `needs input`, `needs approval`, `blocked`, `stalled`, `stale`, `finished`, `archived`. The needs-* and blocked states carry a reason string rendered on hover or in detail ("asks a question", "interrupted", "note: blocked"). Note levels (`fyi`, `review`, `blocked`, `done`) appear only as chips on note items, never as session states. No other status words may be introduced.

Colors are semantic and fixed per axis: state colors follow the existing map (needs-* amber family, blocked red family, running green family, finished/neutral gray, stale/archived dim). Harness identity is conveyed by icon, never by color.

## Row anatomy (session rows, inbox threads)

Line 1: harness icon + custom session title + relative time.
Line 2: state chip + the message to the human (the detected ask or newest note, first sentence).
Line 3: working-directory basename + PR chip (merged/total, colored by state) when PRs exist.
No avatars. No context bars. No raw last-message snippets when an ask or note exists.

Time ladder: `now`, `Nm`, `Nh`, weekday for this week, `M/D` beyond. Absolute timestamps only inside detail views.

## Type, surface, density

Existing tokens are law: Space Grotesk display, JetBrains Mono labels/metadata, the established accent and dark/light palettes. Flat surfaces, no cards, no shadows-as-hierarchy. Calm density: fewer, larger, complete rows beat many truncated ones. Every count renders with a noun. Empty states are quiet and instructive, never celebratory.

## Performance SLOs (enforced by perf:selftest in CI)

- Cold open to interactive: under 1500 ms on fixture data.
- Click to paint (row select, view switch): under 100 ms.
- Idle: zero self-triggered refresh; only the declared poll cadence may cause work. Files the system writes must never live under directories the system watches. lib/commands.js isInboxRelevantChange is the current enforcement point; extend it whenever a new system-written file is introduced.
- DOM rebuilds are signature-gated: unchanged data must not rebuild.
- Heap: steady state after 20 refresh cycles must not grow monotonically.

## Public-repo (born clean) UI rules

- No third-party brand assets (Claude, Codex, or any vendor icons) are ever committed. Harness icons are extracted at runtime from locally installed apps, with neutral built-in glyph fallbacks used in fixture mode and screenshots.
- All committed screenshots use synthetic fixture data only.
- No real session titles, paths, transcripts, or personal data in code, fixtures, docs, or commit messages.

## Process rules for UI changes

1. Register commands before wiring UI (see AGENTS.md CommandRegistry invariant).
2. Every UI PR attaches full-app screenshots of all views in both themes (fixture mode).
3. Every UI PR states, per new visible element: what signal it shows and why it owns it here (one-owner audit).
4. perf:selftest must pass; new timers, watchers, or pollers require a line in the PR body declaring their cadence and lifecycle.
