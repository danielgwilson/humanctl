# UI foundation contract

Status: normative for the renderer reset.

This contract replaces the renderer implementation, not the application
contract. The backend, command registry, reader process, preload bridge, and
packaged Electron shell remain authoritative. The new renderer is a thin
viewport adapter over a Humanctl-owned Registry foundation.

## 1. Ownership

There are three modules and two seams:

```text
packages/ui/
  components.json
  package.json
  src/
    components/       official Registry primitives, adapted once
    blocks/           Humanctl product anatomy
    product/          application surface and UI-facing model contract
    styles/           tokens, fonts, motion, accessibility
    lib/              UI-only helpers

electron/renderer-vite/src/
  main.tsx             bootstrap only
  runtime/             the only window.humanctl adapter
  viewport/            model and intent wiring only
  index.html
```

`packages/ui` owns every visible decision: markup, primitives, blocks, icons,
tokens, typography, spacing, layout, responsive behavior, motion, loading
states, empty states, and accessibility behavior.

`runtime` is the only adapter allowed to read `window.humanctl`. It owns data
loading, subscriptions, command invocation, persisted state hydration, fixture
selection, and conversion from bridge results to the UI interface. It renders
no DOM and imports no visual implementation. Type-only imports from
`packages/ui` are allowed when the runtime adapter implements a UI-owned model.

`viewport` connects the runtime interface to package exports. It may import
`packages/ui`, the runtime interface, and React. It may not contain intrinsic
DOM elements, `className`, inline style, CSS, primitive-library imports,
durable side effects, polling, or bridge access.

`main.tsx` mounts the viewport and imports the package stylesheet. It owns no
product behavior or visual implementation.

The external seam is one model plus one dispatcher:

```ts
type HumanctlViewportProps = {
  model: HumanctlViewportModel;
  dispatch: (intent: HumanctlIntent) => void | Promise<void>;
};
```

The model may contain serializable data, resource states, selection, and
ephemeral view state. The dispatcher accepts product intents such as
`navigate`, `open-session`, `mark-read`, `answer-ask`, and `load-older`. It does
not expose bridge method names, file paths as commands, or Electron objects.

The deletion test is mandatory. Deleting a block should force its visual and
interaction complexity back into multiple callers. A pass-through wrapper that
only renames props is shallow and must be removed.

## 2. Registry foundation

The initial Registry configuration is:

- ShadCN Registry schema
- `base-nova` style
- Base UI behavior
- React client rendering, not RSC
- Tailwind CSS variables
- neutral base color
- Lucide as the package-owned icon source

Official Registry primitives are the first choice. Product anatomy belongs in
Humanctl blocks. A new primitive is accepted only when the official item cannot
meet the interface after token and variant adaptation.

Every consumed Registry item must have all of the following before a viewport
uses it:

1. Source under `packages/ui/src/components` or `packages/ui/src/blocks`.
2. An explicit package export.
3. A Registry item or source manifest entry.
4. A catalog fixture covering default, hover, focus, disabled, loading, error,
   empty, overflow, and reduced-motion states where applicable.
5. Keyboard and interaction tests at the package interface.

Wildcard exports may exist only for CLI routing. Product code imports explicit
leaf paths. Applications do not deep-import package source files.

Mandatory upstream copyright and license notices stay in a tracked license or
third-party-notices file. They do not appear in product copy, navigation,
fixtures, comments, or package names.

## 3. Humanctl visual law

This is a new system. The deleted renderer's graphite palette, violet identity,
mono-first typography, and primitive implementations are not compatibility
requirements.

### 3.1 Palette and surfaces

- Neutral gray carries structure. Blue owns selection, focus, links, and the
  primary action.
- Session states have a text label plus a semantic mark. Color is never the
  only state signal.
- Content surfaces are flat. Lists use rows and hairline rules, not cards.
- Shadows are reserved for floating overlays: menus, tooltips, command
  palette, sheets, and toasts. In-flow content has no shadow.
- A screen region has at most one filled primary action.
- Light and dark themes are both first-class. Neither is produced by a simple
  inversion of the other.

### 3.2 Typography

- Geist Variable is the sans face for navigation, labels, titles, controls,
  rows, messages, and Typeset long-form text.
- The system mono stack is limited to paths, IDs, raw payloads, and other text
  whose machine-readable shape matters. Numeric telemetry uses tabular figures
  without becoming mono by default.
- Body and control text starts at 14px. Compact labels and metadata start at
  12px with a 16px line height.
- Weight 400 is normal. Weight 500 is used for controls and labels. Weight 600
  is reserved for titles.
  Weight 700 and italic are not part of the system.
- Hierarchy comes from placement, size, and ink contrast, not repeated bold
  text.

### 3.3 Geometry

All dimensions derive from a 4px grid.

| Token | Value | Owner |
|---|---:|---|
| Window default | 1240 x 840px | Electron shell |
| Window minimum | 760 x 500px | Electron shell |
| Top chrome | 48px | application shell |
| Toolbar band | 40px | page frame |
| Column header | 32px | list or table block |
| Bottom status band | 32px | application shell |
| Navigation rail | 275px | Registry Sidebar |
| Chief-of-staff rail | 360px | Registry Sidebar, right side |
| Split list pane | clamp(360px, 26vw, 460px) | inbox or sessions block |
| Detail side rail | 320px | detail block |
| Page gutter | 16px | page frame |
| Compact control | 28px, radius 8px | primitive |
| Large input or action | 32px, radius 10px | primitive |
| Single-line row | 36px | list block |
| Decision row | 56px minimum | compact two-line decision block |
| List row | 46px | compact two-line Inbox and Sessions list row (loading skeletons 52px) |
| Floating panel | radius 12px | overlay primitive |
| Command palette | 672px max width | command block |

The application shell is `100dvh` and clips at the root. Each visible pane has
exactly one vertical scroll owner. Nested vertical scrolling is forbidden
unless the inner region is an editor or bounded log with an explicit keyboard
escape path.

At widths below 1040px, list-detail surfaces show one pane at a time and the
chief-of-staff rail becomes a Sheet. The left rail becomes a Sheet below 864px,
or below 1224px while the docked right rail is open. Manual rail state remains
persisted. Session detail is left-aligned in both split and full-width modes;
only prose receives a reading-width cap.

Traffic-light clearance belongs to the package shell. No rule, control, or
drag-disabled region crosses the macOS traffic-light area.

### 3.4 Motion

- Color and opacity transitions: 120ms.
- Overlay entrance and shape transitions: 180ms.
- Overlay exit: 120ms.
- Entrance easing: `cubic-bezier(0.2, 0, 0, 1)`.
- Shape easing: `cubic-bezier(0.42, 0, 0.58, 1)`.
- Exit easing: `cubic-bezier(0.4, 0, 1, 1)`.
- Press feedback may translate by 1px. No spring, bounce, or transition longer
  than 200ms ships in the application shell.
- One global `prefers-reduced-motion: reduce` rule removes nonessential motion.

### 3.5 Loading

The viewport shell renders before any fleet resource resolves. Sessions,
inbox, status, quota, skills, budget, and timeline are independent resources.
One slow resource must not hold another resource's first paint.

Each resource has `idle | loading | ready | error` status, data, an optional
error, and its last update time. A ready empty value is the empty state. A
ready resource with an error keeps last-known data visible and marks it stale;
operation state identifies an active refresh. Loading uses package-owned
skeletons that match final geometry. A real app launch never shows fixture or
sample labeling while version or status loads.

## 4. Accessibility

- Every interactive item uses a Registry primitive or native semantic element
  owned by `packages/ui`.
- Pointer targets are at least 28px in the smaller dimension.
- Every focusable item has a visible 2px focus outline with a 2px offset.
  `outline: none` is forbidden unless the same package rule supplies an equal
  or stronger visible replacement.
- Text meets WCAG AA: 4.5:1 for normal text and 3:1 for large text and essential
  UI marks.
- Menus, popovers, dialogs, sheets, and the command palette support expected
  arrow keys, Tab behavior, Escape, outside interaction, focus entry, and focus
  return.
- Hover-only disclosure is forbidden. Every hover action has a keyboard path.
- Live updates do not steal focus, reset selection, move the reader's scroll
  position, or announce unchanged content.
- Skeletons are hidden from assistive technology. Resource errors use concise
  text and an explicit retry action where retry is possible.

## 5. One owner and zero debt

Every signal has one visible owner per screen. A digest may link to a detailed
owner, but it cannot restate the full detail.

| Signal | Owner |
|---|---|
| Ranked work requiring the human | Inbox list |
| Complete recent session inventory | Sessions view |
| Spend, tokens, and quota detail | Metrics view |
| Fleet distribution by state, harness, and tier | Fleet view |
| Current session transcript and asks | Session detail |
| Global fleet and quota digest | Bottom status band |
| Persisted preferences | Settings view |
| Chief-of-staff conversation | Chief-of-staff right rail |

The reset starts at zero visual debt. There is no allowlisted count to ratchet
down later.

The following fail the ownership gate:

- visual source outside `packages/ui`
- `className`, inline style, or CSS in the viewport adapter
- intrinsic DOM in the viewport adapter
- direct Base UI, Radix, icon, animation, toast, chart, or ShadCN imports
  outside `packages/ui`
- bridge access outside `runtime`
- app-local `components`, `ui`, `blocks`, `styles`, or visual helper trees
- raw controls or visual variants recreated by a consumer
- package source importing the Electron renderer or runtime adapter

If two screens repeat anatomy, deepen the package block. Do not add a second
copy and promise to consolidate it later.

## 6. Performance contract

The existing release budgets remain hard requirements:

- cold open to interactive under 1500ms on fixture data
- click to paint under 100ms
- worst steady-state main-process stall under 16.7ms
- no self-triggered refresh at idle
- unchanged resource identities do not rebuild the DOM
- heap reaches steady state across 20 refresh cycles
- one declared 20-second fleet poll, with event-driven refresh sharing the
  same coalesced read path

The shell, navigation, active route frame, and correctly sized skeletons must
paint before sessions, notes, quota, or skills resolve. Heavy route-specific
reads run only while their route is active. Quota never blocks fleet first
paint.

## 7. Gates

Run these directly until package scripts wire them into CI:

```bash
node scripts/ui-foundation-hygiene.mjs
node scripts/ui-foundation-ownership.mjs
node scripts/ui-foundation-hygiene.mjs --selftest
node scripts/ui-foundation-ownership.mjs --selftest
```

The hygiene gate scans tracked public source surfaces case-insensitively. The
ownership gate scans the working tree, including untracked renderer source, so
new local debt cannot hide before staging.

Every visible change also requires fixture screenshots in both themes,
keyboard verification, a one-owner review, renderer typecheck, package catalog
tests, bundle checks, and the local performance gates.
