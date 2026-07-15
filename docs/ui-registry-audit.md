# UI Registry audit

Date: 2026-07-15

Status: foundation correction implemented and verified locally. The UI,
Registry payload, renderer, browser, Electron startup, and packaged-app gates
below are current. The remote Registry endpoint is not published yet, and the
pre-existing main-process event-loop gate remains red on both this branch and
clean `main`; neither is represented as passing.

## Decision

Humanctl uses public open-source shadcn Registry components as its primitive
layer. Official components are installed into `packages/ui/src/components`,
adapted once to Humanctl tokens, exported explicitly, and listed in
`packages/ui/registry.json`. Product-specific anatomy stays in
`packages/ui/src/blocks`.

The repo-local shadcn skill is installed at `.agents/skills/shadcn`. The skill
lock records the public source. No private repository or external product is a
runtime, build, or design dependency.

Registry source keeps package-local imports. `npm run registry:build` rewrites
generated payloads to portable consumer aliases such as `@/components/ui` and
`@/lib/cn`; verification rejects any emitted `@humanctl/ui` import.

## Current component map

| Product surface | Registry primitives | Humanctl owner |
|---|---|---|
| Left navigation | Sidebar, SidebarProvider, SidebarMenu, SidebarTrigger | `blocks/app-shell.tsx` and product navigation composition |
| Chief-of-staff rail | right-side Sidebar on desktop; Sheet at compact widths | `blocks/app-shell.tsx` and `product/chief-of-staff.tsx` |
| Task transcript | MessageScroller, Message, Bubble, Marker | `blocks/conversation.tsx` and `blocks/detail-pane.tsx` |
| Rich message prose | Typeset, MessageScroller, Message, Bubble, Marker | shared conversation block |
| Reply and ask composer | InputGroup, Textarea, Button, Spinner | `blocks/composer.tsx` |
| Inbox and session rows | Item | `blocks/list-row.tsx` |
| Search and filters | InputGroup, Select | `blocks/filter-toolbar.tsx` and view state |
| Settings | Field, InputGroup, ToggleGroup, Button | `product/settings-view.tsx` |
| Usage and skill data | Table | `product/metrics-view.tsx` |
| Loading, empty, and failure | Skeleton, Spinner, Empty, Alert, Badge | package components and shared product state |
| Menus and choices | MenuGroup, SelectGroup | package components and view composition |

Task detail now has one message scroll owner and one composer. If an unanswered
question exists, the composer changes to Answer mode. Otherwise it stays in Ask
mode. The transcript, inbox updates, tool-count markers, and delivery receipts
share one conversation anatomy.

Desktop navigation defaults open for a new install. Existing persisted user
preference remains authoritative. A shell-only local cache mirrors theme,
view, and both rail states for first paint; durable `app.state` remains the
authority. The application shell remains a Humanctl block because it owns
macOS traffic-light clearance, persisted rail state, the 864px compact
boundary, and the 1224px boundary while the right rail is docked.

The bounded virtual list remains product code because it owns row
virtualization, roving keyboard focus, and scroll stability for large local
fleets. It composes Registry Item and ScrollArea instead of replacing their
behavior.

## Deliberate deferrals

These components should be added only when their data contract exists:

- Attachment, when task artifacts expose real file, image, or link metadata.
- Rich tool panels, when timeline events expose tool name, state, input, output,
  and failure instead of only a tool count.
- Source panels, when answers expose stable citations.
- Reasoning panels, only for user-visible summaries. Hidden model reasoning is
  never displayed.
- Rich prompt controls, when Humanctl supports attachments, model selection, or
  tool selection in the composer.

Installing those components before the product can supply honest data would
add dependencies and controls that do not work.

## Acceptance

Every added primitive must have all of the following:

1. A file under `packages/ui/src/components` or `packages/ui/src/blocks`.
2. An explicit export in `packages/ui/package.json`.
3. A dependency and file entry in `packages/ui/registry.json`.
4. An executable catalog state when it changes visible anatomy.
5. Typecheck, Registry build, ownership, browser, bundle, and performance proof.

## Current acceptance receipt

The 2026-07-15 acceptance run verified:

- 50 explicit package exports across 8 Registry items.
- A full local shadcn 4.13 scratch install of the 8-item dependency graph,
  followed by TypeScript and Vite production builds. Absolute dependency URLs
  were rebased to the local test server; generated source required no edits.
- 543.40 kB initial and 689.80 kB total renderer JavaScript against 600 kB and
  700 kB limits.
- 80.95 kB initial and 99.90 kB total renderer CSS against 84 kB and 104 kB
  limits. Typeset remains route-lazy in the product shell.
- 76.42 kB of emitted Geist font assets against a 120 kB limit.
- 22 inspected light/dark browser screenshots in
  `screenshots/registry-foundation-v4`.
- Browser assertions for Geist, no launch focus artifact, 52px task rows,
  275px left rail and compact Sheet, 360px right rail and compact Sheet,
  exact Command+B / Command+Option+B routing, and minimum-viewport fit.
- Real Electron cold open at 675ms, click-to-paint at 20.3ms maximum, zero
  idle mutation batches, zero signature-gate mutations, and 0% measured heap
  growth. The Electron launch frame had `BODY` focus, no `:focus-visible`
  element, and Geist loaded.
- A fresh unsigned macOS package build and smoke boot from
  `dist/mac-arm64/humanctl.app`.

The generated files depend on `https://humanctl.com/r/*.json`. Those URLs
currently return 404 because this branch has not published the Registry. Local
installability is proven; remote installability is not. Do not advertise a
remote install command until every dependency URL is deployed.

The heavy-corpus `perf:eventloop` release gate is also not green. This branch
reproduced a 30.6ms stall and then 75.6ms on its required re-measure. Clean
`main` also failed repeatedly (44.5ms, then 33.5ms / 39.3ms after rebuild), and
the event-loop gate, reader service, and session reader are unchanged by this
foundation work. Keep the 16.7ms budget; treat the failure as a separate
pre-existing main-process performance issue.

## Historical snapshot

The 2026-07-14 acceptance run verified the previous foundation:

- 47 explicit package exports across 8 Registry items.
- 532.86 kB of initial renderer JavaScript against a 600 kB limit.
- 71.34 kB of renderer CSS, including the lazy catalog delta, against a 72 kB limit.
- 752 expected catalog selectors, with no missing or extra selectors.
- 16 browser screenshots across both themes in `screenshots/registry-component-audit-v3`.

These numbers and screenshots are retained only to show the superseded
baseline.
