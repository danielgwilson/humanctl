# electron/renderer-vite

The humanctl desktop renderer: React + TypeScript + Tailwind v4 (CSS-first) +
shadcn/ui (Radix underneath), built with Vite / electron-vite. It is the only
renderer; `electron/main.ts` always loads its built output.

Scope still growing: the shell (nav rail, header, context bar, chief-of-staff
drawer) and the Inbox view (two-pane: thread list + thread detail) plus a
full-width session detail view reached from Inbox are complete. Sessions /
Metrics / Fleet / Settings render as quiet "coming in a later stage"
placeholders (routable, not dead links) until they are ported.

## Why this is a separate sub-package

This directory is **not** part of the published npm package (root
`package.json`'s `files` stays CLI-only: `dist/bin`, `dist/lib`, `docs`,
`README.md`, `LICENSE`); React/Vite/Tailwind/shadcn are devDependencies of
this sub-package only, so the CLI tarball never carries them.

## Commands

Run from this directory (`electron/renderer-vite/`), after `npm install` here:

```
npm run dev            # vite dev server, plain browser, fixture fallback (fast loop)
npm run build          # electron-vite build: main + preload (unchanged, externalized)
                        #   + this renderer, to dist-electron-vite/
npm run preview        # vite preview of the last `vite build` output (browser only)
npm run typecheck      # tsc --noEmit, strict
```

From the repo root, `npm run renderer` runs the same Vite dev server as
`npm run dev` above.

To boot the real Electron app against this renderer:

```
# from the repo root, after `npm run build:lib` and `npm run build` here:
npm run desktop
```

Or point at the Vite dev server for HMR while iterating inside Electron:

```
# terminal 1 (this directory):
npm run dev
# terminal 2 (repo root):
HUMANCTL_DEV_URL=http://localhost:5183 npm run desktop
```

## Fixture fallback

`src/hooks/use-humanctl.ts` calls the `window.humanctl` bridge exposed by
`electron/preload.ts`. When that bridge is absent (this app opened in a plain
browser, no Electron preload attached), it falls back to the synthetic
fixtures in `src/lib/fixtures.ts`: born-clean by construction (no real ids,
generic demo repo names, never a vendor harness icon).

## Design tokens

`src/styles/globals.css` holds the humanctl design tokens (colors, fonts,
radii) and maps them onto shadcn's semantic token names so Radix primitives
(Select, Sheet, ContextMenu, DropdownMenu, Tooltip) render in the same visual
language throughout the app, not default shadcn zinc. See the repo root
`DESIGN.md`, which this renderer must match exactly.

## Fonts

`src/fonts/` vendors four self-hosted, latin-subset woff2 files: Space
Grotesk 500/600 and JetBrains Mono 500/600 (both SIL Open Font License 1.1,
`src/fonts/OFL.txt`). Hand-written `@font-face` blocks live in
`src/styles/globals.css`; `src/index.html` preloads all four. No font is
fetched over the network -- an Electron app must work offline (see
`docs/design-system.md` section 2.2). Do not add a font package dependency
(e.g. `@fontsource/*`): importing a package's index entry pulls extra
subsets (latin-ext, cyrillic, greek, vietnamese) that this app never needs
and that eat into the CSS budget (`scripts/bundle-size-check.js`).
