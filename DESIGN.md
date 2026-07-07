# DESIGN.md (draft for the public repo root; builder copies verbatim after critic pass)

humanctl is an attention router for a scarce human running many coding-agent sessions. Every design decision serves one job: route the human to the next bounded decision with the least noise possible. When in doubt, subtract.

## The one rule

**One owner per signal.** Every piece of information has exactly one home per screen. Adding a second home for a signal requires deleting the first. If a review adds a count, digest, or status that already renders elsewhere on the same screen, the PR is wrong by definition.

Signal ownership (updated in stage 2d's real-views pass, 0.17.2):

| Signal | Owner | Exception |
|---|---|---|
| Fleet digest (counts) | bottom context bar | Fleet view's headline (need-you/moving/total stat tiles) restates the same three numbers, read from the same `status` object rather than a re-derivation that could drift; presented as the view's own headline framing, not a second digest sentence. Mirrors the quota exception below. |
| What needs the human, ranked | Inbox list order | none |
| Session state + reason | row chip in lists; header chip in detail | none |
| Spend, tokens, quota | Metrics view | bottom bar shows Codex + Claude quota always (not gated to >80 percent); Claude quota renders "n/a" honestly (Claude Code transcripts expose no rate-limit data) |
| Complete fleet | Sessions view | none |
| Fleet shape (session counts by state / harness / tier) | Fleet view | Metrics' harness row is fused with dollars ($ spend + session count per harness in one stat row), a distinct spend-context signal, not a bare count duplicate of Fleet's shape bars |
| Chief-of-staff chat | right drawer (chat only) | none (resources and digest were removed from this drawer; it is chat-only) |
| Chat with one session | session detail composer | Inbox reply is the same composer |
| Context fill | bottom context bar (when a session is open); session detail meta | none |
| Notes stream | Inbox | per-session slice in detail |
| Navigation | left full-height sidebar (offcanvas: fully hidden by default, header toggle or left-edge hover reveals it, Cmd+\ toggle, persisted) | none |
| Settings + theme | the user/settings picker at the foot of the sidebar | Settings remains a routable `app.set-view('settings')` destination; the picker is its entry point, not a second, independent home |

## Information architecture

Chrome (shell v4, stage 2b; header compacted and given a matching left-sidebar toggle in stage 2e; sidebar switched from a collapsible icon rail to offcanvas in 0.17.4): a full-height left sidebar (collapsible offcanvas: fully hidden by default, with a user-settings picker at its foot) / a compact inset header (a left-side sidebar-toggle icon, wordmark + version, and the right-drawer toggle icon on the far right -- both toggles share the same bespoke icon-button treatment). Whichever element occupies the window's top-left corner in the current state owns the macOS traffic-light band, and that band is deliberately rule-free so no border crosses the lights: the sidebar's own top-left header band when expanded (header is inset to its right, plain symmetric padding, normal border); the header itself when collapsed (it spans from x=0, gets left padding that clears the lights instead, and drops its own border). The active view / a toggled right chief-of-staff drawer / a persistent bottom context bar sit within the inset, full width of the content column.

Nav (a full-height sidebar, offcanvas: fully hidden by default, NOT an icon rail -- collapsed means zero rail and full-width content): Inbox (default, unread badge), Metrics, Fleet, Sessions; keys 1/2/3/4 switch between them. The header's PanelLeft toggle or Cmd+backslash reveals/hides it (state persists); hovering the very left edge of the window also peeks it open (see "Deliberate deviations" below). Labels are always shown as text next to each icon whenever the sidebar is visible at all (there is no partially-visible icon-only state left to tooltip over). Settings is reached through the user/settings picker's "All settings," not a sidebar icon. Opening any session from any view shows the full-width session detail with a back breadcrumb; Esc returns. The chief-of-staff drawer is a summonable right-side overlay (key: a, or the header's sidebar-toggle icon), chat only, default closed, state persisted.

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

- No bare `<select>`. Filter and sort dropdowns are shadcn's `Select` (Radix
  Select underneath), restyled onto the humanctl tokens: a button trigger plus
  a popover listbox styled in the same panel language as the context menu and
  the user picker (panel2 background, radius, rule, hover), never the OS's
  own control chrome.
- No native context menu and no native tooltip where a bespoke one already
  exists (shadcn's `ContextMenu` and `Tooltip`, both Radix primitives restyled
  onto the humanctl tokens, replacing the old pure-CSS `[data-tip]` tooltip
  and the hand-rolled context menu).
- Every interactive control is keyboard-operable: buttons and the bespoke
  select use native `<button>` semantics; anything else that is clickable
  (session/inbox rows, custom dropdowns) carries `role`, `tabindex="0"`, and
  Enter/Space activation, plus an `aria-label` that summarizes what a sighted
  user reads visually (state, title, the message to the human).
- Every focusable element shows a visible `:focus-visible` ring (one shared
  rule in `electron/renderer-vite/src/styles/globals.css`); no interactive
  element relies on hover alone to reveal itself to a keyboard user (a control
  that is `opacity:0` until hover must also reveal on `:focus-visible`).
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

## Deliberate deviations

- **Nav: whole-rail hover-expand (shell v3) -> shadcn Sidebar, tooltip-on-hover
  (stage 2b).** Shell v3 mandated a nav strip that hover-expands as a whole
  after >=150ms and pins via Cmd+backslash. Stage 2b replaces this with the
  shadcn `Sidebar` primitive (`collapsible="icon"`) in a full-height layout:
  the rail stays an icon strip and shows a per-item tooltip on hover instead
  of expanding the whole rail; Cmd+backslash still toggles a widened rail,
  but the state is a persisted boolean (`AppState.navPinned`) rather than a
  hover-then-pin gesture. This deletes the bespoke fixed-position/hover-timer/
  pin code entirely and gets keyboard navigation, focus management, and
  ARIA wiring for the rail from Radix for free. It also moves the rail from
  a fixed-position overlay spanning header-to-context-bar to a genuine
  full-height column (Linear/Slack style), with the header and context bar
  now insets to its right rather than full-width bars the rail floats over.
- **Nav: icon rail (stage 2b) -> offcanvas + hover-peek (0.17.4, Linear/Attio
  reference).** The collapsed icon rail was 48px (`SIDEBAR_WIDTH_ICON`), but
  the macOS `hiddenInset` traffic-light cluster's own footprint is ~80-90px
  including its left inset, so the lights always spilled past the rail's
  right edge -- no amount of border-tweaking fixed a rail narrower than the
  lights it had to clear. `collapsible="icon"` is replaced with
  `collapsible="offcanvas"`: collapsed (default) now means the sidebar is
  fully hidden and content is full width, removing the too-narrow-rail
  problem by construction. Traffic-light ownership becomes state-aware
  instead of sidebar-only: whichever element occupies the window's top-left
  corner in the current state (the sidebar's own header when expanded, the
  compact Header when collapsed, since `SidebarInset` now spans from x=0)
  clears the lights and stays borderless there; never both, never a rule
  crossing the lights. A new pointer-only affordance, a thin fixed strip at
  the window's true left edge (below the traffic-light band, rendered only
  while collapsed), opens the sidebar on a ~120ms debounced hover -- Linear's
  "move to the edge to reveal" gesture -- layered on top of, not instead of,
  the accessible paths (the header's `PanelLeft` toggle, Cmd+backslash). This
  also retires the per-item tooltip-on-hover pattern from stage 2b: there is
  no longer a partially-visible icon-only rail to hover over, so labels are
  simply always shown as text whenever the sidebar is visible at all.

## Process rules for UI changes

1. Register commands before wiring UI (see AGENTS.md CommandRegistry invariant).
2. Every UI PR attaches full-app screenshots of all views in both themes (fixture mode).
3. Every UI PR states, per new visible element: what signal it shows and why it owns it here (one-owner audit).
4. perf:selftest must pass; new timers, watchers, or pollers require a line in the PR body declaring their cadence and lifecycle.
5. UI PRs touching interactive controls must keyboard-test and check contrast (see "Bespoke controls and accessibility" above).
