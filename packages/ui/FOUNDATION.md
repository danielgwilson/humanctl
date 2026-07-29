# Humanctl UI foundation

This package is the visual and interaction owner for the desktop viewport.
The renderer adapts runtime state into props and dispatches intents. It does
not recreate controls, geometry, loading states, or product blocks.

## Rules

- One owner per signal on each screen.
- No cards. Use continuous fields, rules, rows, rails, and floating overlays.
- Registry behavior primitives own keyboard, focus, dismissal, message follow,
  and overlay behavior.
- Every reusable visual module has one explicit leaf export.
- Product blocks may compose primitives. Application code may compose blocks.
- Views may own focus, selection, drafts, scroll, and open state only.
- Skeletons preserve final geometry. Loading one resource never blocks another.
- State is never communicated by color alone.
- Floating surfaces are the only surfaces allowed to cast a shadow.
- Reduced-motion users get no ornamental transition.

## Geometry

Controls are 28 or 32 pixels high. Single-line rows are 36 pixels high,
decision rows are 56 pixels high, and compact task rows are 52 pixels high.
Top chrome is 48 pixels high; toolbars are 40 pixels and the bottom status band
is 32 pixels. The navigation rail is 275 pixels wide, the chief-of-staff rail
is 360 pixels wide, and the detail rail is 320 pixels wide. Radius grows sublinearly
with object size.

## Registry workflow

`registry.json` is a local source manifest for organizing and validating the
foundation. It is not an install service. Add a component only when a real
viewport needs it, and list every owned source file in exactly one coherent
item. `npm run registry:validate` checks the shadcn source schema, while
`npm run verify` checks unique ownership and export coverage. No Registry
payload belongs under `public/r`, and no remote or cross-project install
contract exists.

The repo-local shadcn skill is installed under `.agents/skills/shadcn`. The
project uses only public open-source Registry items and preserves their notices
in `THIRD_PARTY_NOTICES.md`.
