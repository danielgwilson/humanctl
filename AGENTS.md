# AGENTS.md

Operator notes for agents working in this repo. Start with `README.md` for what
`humanctl` is; this file covers how to move around and how to test.

## Layout

- `electron/` is the desktop app. `main.js` is the Electron main process (window,
  IPC, the session-dir watcher). `renderer/` is the UI: plain static
  `index.html` + `renderer.js` with no build step. `sessions.js` is the
  read-only cross-harness session reader (Codex + Claude Code logs) and runs as a
  plain Node module.
- `bin/humanctl.js` is the CLI. `docs/` holds the deeper design and desktop docs
  (`docs/desktop.md` is the desktop reference).

## Local development and testing

The renderer is static HTML/CSS/JS. When the `window.humanctl` IPC bridge is
absent (i.e. the page is opened in a plain browser), it falls back to synthetic
fixtures, so the whole UI renders and is fully driveable without launching
Electron.

Prefer the browser for UI work. It is the fast loop, needs no rebuild, and does
not read any real session data:

    npm run renderer     # serves electron/renderer/ at http://localhost:4173

Open that URL and verify layout, the Focus / Triage / Wall modes, the theme and
temperature toggles, and interactions against fixture data. This is the default
way to iterate on the interface.

Use the real Electron app only for what the browser cannot show: real session
data, the `window.humanctl` IPC surface, native window chrome (frameless drag,
the macOS traffic lights), or real-session performance.

    npm run desktop      # live dev: Electron against your real local sessions
    npm run app:install  # rebuild and refresh the installed app

The session reader is non-visual, so it runs and is measured on its own:

    npm run desktop:sessions           # print the recent-session table to stdout
    node --check electron/sessions.js  # syntax gate

## Hygiene

This repo is public. Keep it born-clean: no real session data, secrets, tokens,
or personal paths in tracked files or history. Screenshots and demos use the
synthetic fixtures in `renderer.js`, never real transcripts. Do not use em dashes
in any file. See `docs/repo-hygiene.md`.
