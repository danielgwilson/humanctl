# renderer-vite (migration spike)

This is a MIGRATION SPIKE, not a replacement renderer. It lives on
`spike/electron-vite-shadcn` and proves out electron-vite + React +
TypeScript + Tailwind + shadcn/ui as a second renderer, next to the existing
static `electron/renderer/`. It does not merge to main and does not ship in a
release. The old renderer is untouched and stays the default.

## Scope

Ported to parity: the shell (header, visible left nav icon strip, user
picker, bottom context bar) and the Inbox view (two-pane thread list +
thread detail, search/state/harness/sort filters, notes/asks/qa stream, ask
composer). Sessions, Metrics, Fleet, Settings, the full-width session-detail
overlay, the live-timeline incremental reader, and the always-on summary
engine UI are explicitly out of scope; see the spike's final report for the
effort estimate on the rest.

The backend is completely untouched: `electron/main.js` and
`electron/preload.js` are the same files the static renderer uses. The only
change to `main.js` is a `rendererTarget()` branch that loads this app's
built output (or dev server URL) when `HUMANCTL_VITE=1` is set; without that
flag, boot is byte-identical to main.

## Run it

Browser, fixture data (fast loop, no Electron, matches the static renderer's
`npm run renderer` workflow):

    npm --prefix electron/renderer-vite run dev
    # open http://localhost:5183

Real Electron, real local session data, through this renderer:

    cd electron/renderer-vite && npm run build && cd ../..
    HUMANCTL_VITE=1 ./electron/renderer-vite/node_modules/.bin/electron electron/main.js

Real Electron, vite dev server (HMR against real data):

    npm --prefix electron/renderer-vite run dev &   # leave running
    HUMANCTL_VITE=1 HUMANCTL_VITE_DEV_URL=http://localhost:5183 \
      ./electron/renderer-vite/node_modules/.bin/electron electron/main.js

Default boot (no flag) is unchanged: static `electron/renderer/index.html`.

## Design system

`src/styles/globals.css` ports DESIGN.md's token set verbatim (colors, both
themes, Space Grotesk/JetBrains Mono stacks, radii) into a Tailwind v4
`@theme` block, then maps shadcn's semantic tokens (`--background`,
`--primary`, `--ring`, etc.) onto those humanctl values so shadcn primitives
render in the app's own language, not default shadcn zinc.

## Stack

React 19, TypeScript, Tailwind v4, shadcn/ui (new-york style, Radix base),
electron-vite 5 (pinned to Vite 7.x; electron-vite 5 does not yet support
Vite 8), all scoped to this directory's own `package.json` -- the root CLI's
`bin/` stays zero-dep.
