# `humanctl`

`humanctl` is a control plane for the human bottleneck.

When agents get blocked on human context, feedback, approval, or missing taste, `humanctl` gives them a better surface to escalate, show, ask, and resume. Instead of scattering HTML files, screenshots, side notes, and half-answered questions across chat threads, agents can write to a shared local surface with durable state.

## Why this exists

Current human-in-the-loop workflows are usually bad in the same predictable ways:

- chat is linear and thread-local
- previews are disposable
- feedback arrives out of band
- active sessions miss updates
- future sessions have to reconstruct context from scraps

`humanctl` is meant to fix that with a local-first model:

- agents write rich artifacts and requests into `.humanctl/`
- humans respond through a shared surface instead of a single chat thread
- updates are persisted to files and also emitted as events
- active sessions can consume those updates as steers
- future sessions can resume from the same durable state

## Core thesis

Humans are scarce reviewers, not infinitely available chat partners.

`humanctl` helps agents package blockers into the smallest possible unit of human attention, keep all supporting context attached, and resume immediately after the answer lands.

## V1 scope

The first version stays deliberately small:

- a project-local `.humanctl/` workspace on disk
- tabs as the main navigation unit
- things as flexible renderable objects
- an append-only event queue for steers and answers
- a local app surface that can render HTML, markdown, images, diffs, files, and forms
- a tiny CLI that agents and automations can write to

## Repo layout

```text
humanctl/
  .humanctl/
  bin/
    humanctl.js
  docs/
    v1.md
  src/
    app/
      globals.css
      layout.tsx
      page.tsx
  project.dgkit.json
  next.config.ts
  tsconfig.json
  package.json
  README.md
```

## Local preview

```bash
cd /Users/danielgwilson/local_git/humanctl
npm install
npm run dev
```

This starts the Next.js app locally. The CLI workspace is still separate and lives in `.humanctl/`.

## Current CLI

The CLI is intentionally tiny right now:

- `humanctl init [dir]`
- `humanctl status [dir]`
- `humanctl ask [dir] --title "..." --prompt "..." --option "id:Label:Description" ...`
- `humanctl serve [dir] --port 4173`

`init` creates a starter `.humanctl/` workspace. `status` summarizes what is there. `ask` creates a file-backed request Thing that the app can render and collect an answer for. `serve` remains available for simple static previews, but the main app now runs on Next.js.

## Next milestones

1. Finalize the `.humanctl/` object model and event schema.
2. Build the first real app surface around tabs, asks, and artifacts.
3. Add agent-first commands for `put`, `watch`, and `focus`.
4. Support live steer delivery on top of the persisted queue.

## Product line

`humanctl`: a control plane for the human bottleneck.

## License

`humanctl` is licensed under Apache-2.0. See [LICENSE](./LICENSE).

## Contributions

Unless explicitly agreed otherwise, submitted contributions are expected to be made under the same Apache-2.0 terms as the rest of the project.

## Publishing (maintainers)

This package is scaffolded for npm trusted publishing from GitHub Actions.

- CI workflow: `.github/workflows/ci.yml`
- publish workflow: `.github/workflows/publish.yml`
- maintainer notes: `humanctl-trusted-publishing-notes.md`

The npm package is intentionally CLI-only. The published tarball is limited by the `files` field in `package.json`, so the Next.js site is not published to npm.
