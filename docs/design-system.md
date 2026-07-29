# Humanctl design system

`packages/ui` is the implementation authority for Humanctl's visual and
interaction system. This document explains the active rules. Exact token
values live in `packages/ui/src/styles/tokens.css`; package ownership and
acceptance rules live in [ui-foundation-contract.md](./ui-foundation-contract.md).

## Foundation

The UI package starts from the ShadCN Registry `base-nova` foundation with Base
UI behavior. Official Registry primitives are adapted once inside
`packages/ui/src/components`. Reusable anatomy lives in
`packages/ui/src/blocks`; the package-owned application surface and its model
contract live in `packages/ui/src/product`.

Consumers import explicit `@humanctl/ui/*` leaves. They do not import Base UI,
icons, styling helpers, animation libraries, or Registry source directly. The
renderer viewport composes package blocks and dispatches intents. It contains
no intrinsic DOM or styling.

## Color

Neutral gray owns the application field, rails, rows, and rules. Blue owns:

- selection
- keyboard focus
- links
- the primary action

Semantic state colors are limited to running, needs-input, blocked, finished,
and idle marks. Every state also has a text label. Harnesses do not receive
interface colors.

The surface ladder is:

| Token | Use |
|---|---|
| `--surface-0` | application ground and rail |
| `--surface-1` | continuous content field |
| `--surface-2` | floating overlay |
| `--surface-sunken` | inputs, tracks, and inset wells |
| `--surface-inverted` | high-contrast tooltip |

Ink has one solid value plus three alpha steps. Muted text is produced by ink
contrast, not by introducing more neutral hues. Light and dark themes define
their own values and are verified separately.

Blue selection, hover, and press are composable overlays. Hover must not erase
selection. A filled action keeps its own fill while hover and press overlays
modify it.

## Typography

Geist Variable is the primary face. It covers navigation, titles, controls,
list rows, messages, detail content, empty states, and toasts.

The system mono stack is limited to:

- paths and repository identifiers
- session IDs
- timestamps and durations
- raw payloads and code-like machine metadata

Numeric telemetry and keyboard hints use tabular figures without becoming mono
by default. The default interface text is 14px at weight 400. Controls and
labels use weight 500. Titles may use weight 600. Weight 700 and italic are not
part of the product system.

Both fonts are bundled through the UI package. The desktop renderer makes no
network font request.

## Geometry

The system uses a 4px spacing grid.

| Token | Value | Use |
|---|---:|---|
| `--control-sm` | 28px | compact buttons, filters, nav actions |
| `--control` | 32px | inputs and primary actions |
| `--chrome` | 48px | top chrome and native traffic-light band |
| `--toolbar` | 40px | page toolbar band |
| `--column-header` | 32px | list and table headers |
| `--status-band` | 32px | global status band |
| `--row` | 36px | single-line operator row |
| `--row-decision` | 56px | row requiring a second content line |
| `--row-task` | 52px | compact Inbox and Sessions row |
| `--rail` | 275px | desktop navigation rail |
| `--assistant-rail` | 360px | desktop chief-of-staff rail |
| `--split-list` | 340px | list pane in a split view |
| `--detail` | 320px | detail side rail |
| `--palette` | 672px | command palette maximum width |
| `--measure-prose` | 560px | readable long-form text |

Radius grows with size:

- 6px for compact marks and key hints
- 8px for 28px controls
- 10px for 32px controls
- 12px for floating panels and bounded editors

The root shell fills `100dvh` and clips overflow. Each pane has one vertical
scroll owner. At narrow widths, list-detail views show one pane at a time and
the rail becomes an overlay. Session detail stays aligned to its pane; only
prose receives a reading-width cap.

## Surfaces and elevation

Humanctl does not use cards. Repeated information uses continuous rows with
hairline separators. Section changes use spacing, a label, or one legal rule.

In-flow rows, controls, list containers, progress tracks, and status bands have
no drop shadow. Shadow is reserved for floating menus, popovers, tooltips,
sheets, dialogs, the command palette, and toasts.

The macOS traffic-light area is part of package shell geometry. No control,
rule, or drag-disabled island crosses it.

## Motion

The package defines three durations:

- `--duration-color`: 120ms for color, opacity, hover, and press
- `--duration-overlay-enter`: 180ms for overlay entrance and shape
- `--duration-overlay-exit`: 120ms for overlay exit

Entrance decelerates, exit accelerates, and shape changes use a symmetric ease.
Press feedback may translate by 1px. No decorative spring or bounce ships.

One package-level `prefers-reduced-motion: reduce` rule removes nonessential
animation and smooth scrolling.

## Primitive contract

The initial Registry inventory includes:

- Button and IconButton
- Input, Textarea, InputGroup, Field, and Label
- Select, Menu, Popover, Tooltip, Dialog, and Sheet
- Command
- Tabs, Toggle, and ToggleGroup
- Item and Table
- Message, Bubble, Marker, and MessageScroller
- Alert, Badge, Empty, Spinner, Progress, Separator, ScrollArea, and Skeleton

Product blocks include the application shell, page frame, list row, filters,
detail pane, composer, conversation, status, and quota. A second screen with
the same anatomy extends the existing block. It does not copy the markup.

Every consumed item needs an explicit package export, Registry manifest entry,
catalog fixture, keyboard proof, and relevant loading, empty, error, overflow,
and reduced-motion states.

## Progressive loading

The shell is usable before fleet data resolves. Status, sessions, Inbox, quota,
skills, budget, and timeline are independent resources.

- Skeletons match final row and control geometry.
- One slow resource does not hold another resource's first paint.
- Refresh keeps last-known data visible.
- An error replaces only the affected resource.
- Empty and error are distinct states.
- Skeletons are hidden from assistive technology.
- The compiled application version is present on the first real-app paint.
  Fixture labeling appears only when the preload bridge is actually absent.

## Accessibility

- Normal text clears 4.5:1 contrast. Large text and essential UI clear 3:1.
- State is not communicated by color alone.
- Pointer targets are at least 28px in the smaller dimension.
- Every focusable item has a visible 2px focus outline with a 2px offset.
- Overlays move focus in, handle Escape and outside interaction, and return
  focus to the trigger.
- Composite controls support expected arrow-key navigation.
- Hover-only actions are forbidden.
- Live updates preserve focus, selection, draft text, and scroll position.

## Enforcement

Run:

```bash
node scripts/ui-foundation-hygiene.mjs
node scripts/ui-foundation-ownership.mjs
```

The ownership gate enforces the `packages/ui`, `runtime`, and `viewport` seams.
The reset starts with zero app-local visual debt. There is no baseline of
exceptions to grow or defer.

Every visible change also needs the package catalog checks, renderer typecheck,
fixture screenshots in both themes, keyboard verification, bundle check, and
the local performance gates in [perf.md](./perf.md).
