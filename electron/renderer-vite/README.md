# electron/renderer-vite

STAGE 1b of the TypeScript migration (`docs/ts-migration-plan.md` in the repo
root). A second renderer: React + TypeScript + Tailwind v4 (CSS-first) +
shadcn/ui (Radix underneath), built with Vite / electron-vite. It coexists
with the existing static `electron/renderer/` behind the `HUMANCTL_VITE` env
flag; the old renderer stays the shipped default until stage 4's cutover.

Scope this stage: the shell (nav rail, header, context bar, chief-of-staff
drawer) and the Inbox view (two-pane: thread list + thread detail) plus a
full-width session detail view reached from Inbox, at parity with the
current app. Sessions / Metrics / Fleet / Settings render as quiet
"coming in stage 2" placeholders (routable, not dead links). The
live-timeline reader and the reply/suggested-responses feature are stage 3.

## Why this exists next to `electron/renderer/`

`electron/renderer/` is plain static HTML/CSS/JS with no build step (see the
root `AGENTS.md`). This directory is the replacement renderer, developed and
reviewed stage by stage without ever breaking the shipped default. It is
**not** part of the published npm package (root `package.json`'s `files`
stays CLI-only: `dist/bin`, `dist/lib`, `docs`, `README.md`, `LICENSE`);
React/Vite/Tailwind/shadcn are devDependencies of this sub-package only.

## Commands

Run from this directory (`electron/renderer-vite/`), after `npm install` here:

```
npm run dev            # vite dev server, plain browser, fixture fallback (fast loop)
npm run build          # electron-vite build: main + preload (unchanged, externalized)
                        #   + this renderer, to dist-electron-vite/
npm run preview        # vite preview of the last `vite build` output (browser only)
npm run typecheck      # tsc --noEmit, strict
```

To boot the real Electron app against this renderer instead of the default
static one:

```
# from the repo root, after `npm run build:lib` and `npm run build` here:
HUMANCTL_VITE=1 npm run desktop
```

Or point at the Vite dev server for HMR while iterating inside Electron:

```
# terminal 1 (this directory):
npm run dev
# terminal 2 (repo root):
HUMANCTL_VITE=1 HUMANCTL_VITE_DEV_URL=http://localhost:5183 npm run desktop
```

## Fixture fallback

`src/hooks/use-humanctl.ts` calls the exact same `window.humanctl` bridge the
static renderer's `renderer.js` does. When that bridge is absent (this app
opened in a plain browser, no Electron preload attached), it falls back to
the synthetic fixtures in `src/lib/fixtures.ts`: same born-clean contract as
the existing renderer (no real ids, generic demo repo names, never a vendor
harness icon).

## Design tokens

`src/styles/globals.css` ports the humanctl design tokens (colors, fonts,
radii) from `electron/renderer/index.html`'s `#kit-tokens` verbatim, and maps
them onto shadcn's semantic token names so Radix primitives (Select, Sheet,
ContextMenu, DropdownMenu, Tooltip) render in the same visual language as the
rest of the app, not default shadcn zinc. See the repo root `DESIGN.md`,
which this renderer must match exactly.
