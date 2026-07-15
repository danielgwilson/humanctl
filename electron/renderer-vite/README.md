# Electron renderer

This is Humanctl's only desktop renderer. React, Vite, and electron-vite mount
a thin viewport over the Humanctl UI package.

## Architecture

```text
packages/ui/                         visual and interaction owner

electron/renderer-vite/src/
  runtime/                            preload and fixture adapters, resources,
                                      subscriptions, state, intent dispatch
  viewport/                           model-to-package wiring only
  main.tsx                            mount point and package stylesheet import
  index.html
```

`packages/ui` starts from the ShadCN Registry `base-nova` foundation with Base
UI behavior. It owns primitives, product blocks, Geist Variable and semantic
system mono,
tokens, responsive layout, loading states, motion, and accessibility.

`src/runtime` is the only renderer code allowed to access `window.humanctl`.
The desktop and fixture adapters implement the same interface. Runtime code
does not render DOM.

`src/viewport` receives the runtime model, renders package exports, and emits
intents. It has no intrinsic DOM, CSS, primitive-library import, polling, or
direct bridge access.

The compiled application version is injected at build time and is available on
the first paint. A real Electron launch never shows fixture labeling while an
asynchronous status read completes.

See [DESIGN.md](../../DESIGN.md),
[ui-foundation-contract.md](../../docs/ui-foundation-contract.md), and
[frontend-reset-behavior-ledger.md](../../docs/frontend-reset-behavior-ledger.md).

## Commands

From this directory:

```bash
npm run dev
npm run build
npm run preview
npm run typecheck
```

From the repository root:

```bash
npm run renderer
npm run renderer:build
npm run renderer:serve
npm run desktop
```

For Electron HMR, run the renderer and desktop separately:

```bash
# terminal 1
npm run renderer

# terminal 2
HUMANCTL_DEV_URL=http://localhost:5183 npm run desktop
```

## Fixture mode

When the preload bridge is absent, `src/runtime/fixture-adapter.ts` supplies
public-safe synthetic data. It has no real session IDs, paths, transcripts, or
vendor assets. Independent one-shot delays make resource skeletons and
progressive loading observable in a browser.

The browser is the default visual development loop. Use the real Electron app
only for preload behavior, native window chrome, runtime-resolved icons,
real-session reads, and packaged performance.

## UI ownership

Renderer source does not own visual implementation. New controls and product
anatomy go into `packages/ui`, receive explicit leaf exports, and are exercised
in the package catalog before viewport consumption.

Run the ownership and hygiene gates from the repository root:

```bash
node scripts/ui-foundation-ownership.mjs
node scripts/ui-foundation-hygiene.mjs
```

Every visible change also requires synthetic full-application screenshots in
both themes, keyboard and focus verification, bundle checks, and the local
performance gates in `docs/perf.md`.
