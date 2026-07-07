# DESIGN.md (draft for the public repo root; builder copies verbatim after critic pass)

humanctl is an attention router for a scarce human running many coding-agent sessions. Every design decision serves one job: route the human to the next bounded decision with the least noise possible. When in doubt, subtract.

## The one rule

**One owner per signal.** Every piece of information has exactly one home per screen. Adding a second home for a signal requires deleting the first. If a review adds a count, digest, or status that already renders elsewhere on the same screen, the PR is wrong by definition.

Signal ownership (updated in shell v3's chrome pass, 0.16.0a):

| Signal | Owner | Exception |
|---|---|---|
| Fleet digest (counts) | bottom context bar | none (sole home; removed from the header and from the chief-of-staff drawer, both former second homes) |
| What needs the human, ranked | Inbox list order | none |
| Session state + reason | row chip in lists; header chip in detail | none |
| Spend, tokens, quota | Metrics view | bottom bar shows Codex + Claude quota always (not gated to >80 percent); Claude quota renders "n/a" honestly (Claude Code transcripts expose no rate-limit data) |
| Complete fleet | Sessions view | none |
| Chief-of-staff chat | right drawer (chat only) | none (resources and digest were removed from this drawer; it is chat-only) |
| Chat with one session | session detail composer | Inbox reply is the same composer |
| Context fill | bottom context bar (when a session is open); session detail meta | none |
| Notes stream | Inbox | per-session slice in detail |
| Navigation | left nav strip (visible icon strip, hover-expands, pins) | none |
| Settings + theme | the user/settings picker at the foot of the nav strip | Settings remains a routable `app.set-view('settings')` destination; the picker is its entry point, not a second, independent home |

## Information architecture

Chrome (shell v3): a slim header (wordmark + version + the right-drawer sidebar-toggle icon only) / a VISIBLE left nav icon-strip with a user-settings picker at its foot / the active view / a toggled right chief-of-staff drawer / a persistent bottom context bar.

Nav (a visible icon strip by default -- NOT hidden; hovering the strip itself for >=150ms expands it to show labels as an overlay; Cmd+backslash pins the widened rail as a fixed column): Inbox (default, unread badge), Metrics, Fleet, Sessions; keys 1/2/3/4 switch between them. Settings is reached through the user/settings picker's "All settings," not a nav-strip icon. Opening any session from any view shows the full-width session detail with a back breadcrumb; Esc returns. The chief-of-staff drawer is a summonable right-side overlay (key: a, or the header's sidebar-toggle icon), chat only, default closed, state persisted.

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
- Idle: zero self-triggered refresh; only the declared poll cadence may cause work. Files the system writes must never live under directories the system watches. lib/commands.ts isInboxRelevantChange is the current enforcement point; extend it whenever a new system-written file is introduced.
- DOM rebuilds are signature-gated: unchanged data must not rebuild.
- Heap: steady state after 20 refresh cycles must not grow monotonically.

## Public-repo (born clean) UI rules

- No third-party brand assets (Claude, Codex, or any vendor icons) are ever committed. Harness icons are extracted at runtime from locally installed apps, with neutral built-in glyph fallbacks used in fixture mode and screenshots.
- All committed screenshots use synthetic fixture data only.
- No real session titles, paths, transcripts, or personal data in code, fixtures, docs, or commit messages.

## Bespoke controls and accessibility (hardline, 0.16.1)

No native or OS-default interactive control ships in this app. Every
interactive element is bespoke, tokenized, keyboard-navigable, ARIA-labeled,
carries a visible focus ring, and meets an adequate hit target. Specifically:

- No bare `<select>`. Filter and sort dropdowns are the shared `HcSelect`
  component (`electron/renderer/hc-select.js`): a button trigger plus a
  popover listbox styled in the same panel language as the context menu and
  the user picker (panel2 background, radius, rule, hover), never the OS's
  own control chrome.
- No native context menu and no native tooltip where a bespoke one already
  exists (`contextmenu.js`'s custom menu; the `[data-tip]` pure-CSS tooltip).
- Every interactive control is keyboard-operable: buttons and the bespoke
  select use native `<button>` semantics; anything else that is clickable
  (session/inbox rows, custom dropdowns) carries `role`, `tabindex="0"`, and
  Enter/Space activation, plus an `aria-label` that summarizes what a sighted
  user reads visually (state, title, the message to the human).
- Every focusable element shows a visible `:focus-visible` ring (one shared
  rule in the `a11y-base` stylesheet, `index.html`); no interactive element
  relies on hover alone to reveal itself to a keyboard user (a control that is
  `opacity:0` until hover must also reveal on `:focus-visible`).
- Every overlay (the chief-of-staff drawer, the user/settings picker, the
  context menu) moves focus in on open, closes and returns focus to its
  trigger on Esc or an outside interaction, and the drawer keeps a basic focus
  trap (Tab/Shift+Tab cycle within it while open).
- Hit targets are at least ~28px in the smaller dimension for anything a
  pointer or touch is expected to activate, even where the visible glyph is
  smaller (padding-box sizing, not a visual resize).
- Text and essential UI meet WCAG AA contrast against every surface it can
  render on in this app (4.5:1 body text, 3:1 large text/essential UI
  elements); the muted `--ink3`/`--ink4` tokens are calibrated against the
  darkest/lightest surface in each theme, not just the page background.
- Transitions and animations are gated behind `prefers-reduced-motion:
  reduce` (one rule, `a11y-base`), never per-component.

UI PRs that touch any interactive control must keyboard-test it (Tab to it,
operate it without a mouse) and state the contrast ratio for any new or
changed text/background pairing.

## Component contract (renderer-vite, stage 2a)

Commodity controls use the shadcn primitive, restyled onto the humanctl
tokens above, never a bespoke reimplementation and never stock shadcn
zinc/new-york look:

- **A small labeled pill is `Chip`** (`components/ui/chip.tsx`, built on
  shadcn Badge), covering session-state chips, note-level chips
  (fyi/review/blocked/done), and mono section/stream-tag labels. One
  component, one cva variant set, one hue-per-axis map -- never a raw
  `font-mono text-[9px] uppercase ...` span and never a second chip dialect.
- **A button is a `Button` cva variant** (`components/ui/button.tsx`), never
  an inline `className` restyle and never a raw `<button>`. `iris` is the
  primary accent action; `done` and `accent-outline` are the accent-outline
  "ask" actions. The same conceptual button must render identically wherever
  it appears.
- **A scroll region is `ScrollArea`** (`components/ui/scroll-area.tsx`),
  never a raw `overflow-y-auto` div. No native or OS-default scrollbar ships
  in this app (this is the bespoke-controls hardline above, applied to
  scrolling specifically).
- **A divider is `Separator`** (`components/ui/separator.tsx`), never a
  bespoke `h-Npx w-px bg-<token>` span.
- Select, Sheet, ContextMenu, and Tooltip follow the same rule already
  (adopted in the shell v3 pass): use the shadcn primitive, restyled onto the
  humanctl palette via the `--color-*` token bridge in `globals.css`, not a
  hand-rolled popover/overlay.

Every new view built on renderer-vite inherits this vocabulary rather than
deriving a new one-off dialect. Extend the shared primitive (add a cva
variant, a Chip variant) before reaching for an inline `className` override.

## Process rules for UI changes

1. Register commands before wiring UI (see AGENTS.md CommandRegistry invariant).
2. Every UI PR attaches full-app screenshots of all views in both themes (fixture mode).
3. Every UI PR states, per new visible element: what signal it shows and why it owns it here (one-owner audit).
4. perf:selftest must pass; new timers, watchers, or pollers require a line in the PR body declaring their cadence and lifecycle.
5. UI PRs touching interactive controls must keyboard-test and check contrast (see "Bespoke controls and accessibility" above).
