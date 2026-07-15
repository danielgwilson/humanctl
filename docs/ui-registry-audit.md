# UI Registry audit

Date: 2026-07-14

Status: implemented and enforced by the package Registry, catalog, and UI
verification commands.

## Decision

Humanctl uses public open-source shadcn Registry components as its primitive
layer. Official components are installed into `packages/ui/src/components`,
adapted once to Humanctl tokens, exported explicitly, and listed in
`packages/ui/registry.json`. Product-specific anatomy stays in
`packages/ui/src/blocks`.

The repo-local shadcn skill is installed at `.agents/skills/shadcn`. The skill
lock records the public source. No private repository or external product is a
runtime, build, or design dependency.

## Current component map

| Product surface | Registry primitives | Humanctl owner |
|---|---|---|
| Task transcript | MessageScroller, Message, Bubble, Marker | `blocks/conversation.tsx` and `blocks/detail-pane.tsx` |
| Chief-of-staff chat | MessageScroller, Message, Bubble, Marker | shared conversation block |
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
preference remains authoritative. The application shell remains a Humanctl
block because it owns macOS traffic-light clearance, persisted rail state, and
the 960px overlay transition.

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

## Verified snapshot

The 2026-07-14 acceptance run verified:

- 47 explicit package exports across 8 Registry items.
- 532.86 kB of initial renderer JavaScript against a 600 kB limit.
- 71.34 kB of renderer CSS, including the lazy catalog delta, against a 72 kB limit.
- 752 expected catalog selectors, with no missing or extra selectors.
- 16 browser screenshots across both themes in `screenshots/registry-component-audit-v3`.
