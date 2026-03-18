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

The sharper framing now is:

`humanctl` is an attention router for a scarce human.

## Current design direction

The sharper current framing is:

`humanctl` is a local interrupt-and-response layer for the human bottleneck.

The more opinionated version is:

`humanctl` is local chief-of-staff infrastructure for agents.

The main design docs are now:

- [docs/agent-first.md](./docs/agent-first.md)
- [docs/control-layer.md](./docs/control-layer.md)
- [docs/notch-mvp.md](./docs/notch-mvp.md)
- [docs/notch-shell-contract.md](./docs/notch-shell-contract.md)
- [docs/notch-shell-lessons.md](./docs/notch-shell-lessons.md)
- [docs/mvp-plan.md](./docs/mvp-plan.md)

Together they describe the local product split, runtime components, object model, interrupt policy, the deeper control-layer framing, the narrow notch concept, the current shell contract, durable artifact/canvas model, and the current MVP execution order.

## Copy guardrail

On user-facing pages, do not leak builder notes into the copy.

- Do not narrate implementation details like "manually curated," "frozen into local data," "backed by files," or similar unless that detail is directly valuable to the user.
- Homepage and marketing copy should sell the outcome, not annotate how the page was assembled.

## V1 scope

The first version stays deliberately small:

- a project-local `.humanctl/` workspace on disk
- asks, artifacts, watches, and responses as the core durable objects
- an append-only event queue for steers, deliveries, and answers
- a local app surface built around inbox, focus, history, and a durable working canvas for artifacts
- rich payload rendering for HTML, markdown, images, diffs, files, and forms
- a tiny CLI that agents and automations can write to

## Repo layout

```text
humanctl/
  .humanctl/
  bin/
    humanctl.js
  docs/
    agent-first.md
    notch-mvp.md
    notch-shell-contract.md
    mvp-plan.md
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

## Native notch spike

There is now a narrow native macOS notch-shell spike under `native/macos/`.

It is intentionally narrow:

- menu bar runtime anchor
- one compact notch shell
- one expanded notch shell
- one fixed sample payload only
- no artifact viewer, text entry, or real `humanctl` data flow yet

Important:

- this is currently a shell-UX spike, not full `humanctl`
- the `HCTL` menu bar extra is the control path
- clicking the menu bar extra opens the standard menu, including `Toggle Notch` and `Quit HumanctlNotch`
- the notch-shell lessons and failure modes are documented in [docs/notch-shell-lessons.md](./docs/notch-shell-lessons.md)
- the current shell contract is documented in [docs/notch-shell-contract.md](./docs/notch-shell-contract.md)

Generate the project:

```bash
cd /Users/danielgwilson/local_git/humanctl
npm run native:generate
```

Build it from the terminal:

```bash
cd /Users/danielgwilson/local_git/humanctl
npm run native:build
```

Open the built app as an actual macOS app bundle:

```bash
cd /Users/danielgwilson/local_git/humanctl
npm run native:open
```

Or build and open in one step:

```bash
cd /Users/danielgwilson/local_git/humanctl
npm run native:run
```

Or open it in Xcode:

```bash
open /Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch.xcodeproj
```

## Current CLI

The CLI is intentionally tiny right now:

- `humanctl init [dir]`
- `humanctl status [dir]`
- `humanctl serve [dir] --port 4173`

`init` creates a starter `.humanctl/` workspace. `status` summarizes what is there. `serve` remains available for simple static previews, but the main app now runs on Next.js.

## Next milestones

1. Migrate the local schema from generic `Thing`s to `ask` / `artifact` / `watch`.
2. Refactor the current `/app` prototype into review queue + focus + working canvas.
3. Add `humanctl ask create` and `humanctl artifact put`.
4. Add local notification routing under policy via `humanctld`.

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
