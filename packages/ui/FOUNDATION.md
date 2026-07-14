# Humanctl UI foundation

This package is the visual and interaction owner for the desktop viewport.
The renderer adapts runtime state into props and dispatches intents. It does
not recreate controls, geometry, loading states, or product blocks.

## Rules

- One owner per signal on each screen.
- No cards. Use continuous fields, rules, rows, rails, and floating overlays.
- Base UI owns keyboard, focus, dismissal, and overlay behavior.
- Every reusable visual module has one explicit leaf export.
- Product blocks may compose primitives. Application code may compose blocks.
- Views may own focus, selection, drafts, scroll, and open state only.
- Skeletons preserve final geometry. Loading one resource never blocks another.
- State is never communicated by color alone.
- Floating surfaces are the only surfaces allowed to cast a shadow.
- Reduced-motion users get no ornamental transition.

## Geometry

Controls are 28 or 32 pixels high. Single-line rows are 36 pixels high and
decision rows are 56 pixels high. Top chrome is 44 pixels high; toolbars are
40 pixels and the bottom status band is 32 pixels. The navigation rail is 256
pixels wide and the detail rail is 320 pixels wide. Radius grows sublinearly
with object size.

## Registry workflow

`registry.json` is the source manifest. Add a component only when a real
viewport needs it. Every item must include its dependencies and source files.
Run `npm run verify` after changing the manifest or package exports.
