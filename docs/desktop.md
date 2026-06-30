# Desktop App

`humanctl` desktop is a local-first control room for agent sessions. It reads
recent Codex and Claude Code transcripts on this machine and shows them in one
list: which harness, which repo, the opening prompt, who the turn is waiting on,
and how long ago it moved.

It is read-only and offline. It never writes to your transcripts and never sends
anything off the machine.

## Run it

```bash
npm install
npm run desktop
```

Quick checks without the GUI:

```bash
npm run desktop:sessions          # print the recent-session table to stdout
HUMANCTL_SMOKE=1 npm run desktop  # boot the window, print a marker, quit (CI-safe)
```

## How it is built

No build step, no bundler. The renderer is plain HTML and JS.

- `electron/sessions.js` is the reader. It scans `~/.codex/sessions` and
  `~/.claude/projects`, reads each transcript by bounded head/tail slices (never
  the whole file), and returns metadata only. It never writes and never makes a
  network call. It is a plain Node module, so it runs and tests on its own.
- `electron/main.js` owns the window and exposes two read-only IPC handlers:
  `sessions:list` and `sessions:reveal` (reveal opens a transcript in Finder).
- `electron/preload.js` is the locked bridge. The renderer gets exactly
  `listSessions` and `revealSession`, nothing else. No fs, no network.
- `electron/renderer/` is the UI. When the Electron bridge is absent (for
  example when the page is opened in a plain browser for a screenshot), the
  renderer falls back to synthetic fixture rows, so demo captures never contain
  real session content.

## Privacy posture (born clean)

This repo is public. The rules that keep it safe:

- The code reads transcripts but never copies them into the repo.
- Screenshots and demos use the synthetic fixture in `renderer.js`, never real
  sessions. See [repo-hygiene.md](./repo-hygiene.md).
- `scripts/secret-scan.sh` fails the build if anything that looks like a
  credential is tracked.

## Status

- Shipped: recent-session list across both harnesses, with turn-state
  (`working` vs `needs you`) and reveal-in-Finder.
- Next: per-session context map (blocks by kind), and token / spend / quota
  per harness.

## Notch

The native macOS notch shell is parked under `attic/notch/` while the desktop
surface is the focus. Its build scripts are the `notch:*` npm scripts. It is
kept, not deleted.
