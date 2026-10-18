# AGENTS.md

Operator notes for agents working in this repo. Start with `README.md` for what
`humanctl` is; this file covers how to move around and how to test.

This repo is the CLI, its file formats, and the humanctl.com site. It is
stable and low-activity. The desktop app that used to live here was removed in
0.21.0; comments in `lib/` that mention `electron/main.ts`, the renderer, or
the desktop describe that app and are kept as context.

## Layout

- `bin/humanctl.ts` is the CLI, compiled to `dist/bin/humanctl.js` (the
  package's `bin` entry: `npm i -g humanctl` ships compiled JS, never runtime
  TypeScript).
- `lib/` holds strict TypeScript modules (`tsconfig.backend.json`), compiled
  by tsup to `dist/lib/*.js`: `commands.ts` is the command registry (see
  below and `docs/commands.md`), `sessions.ts` the read-only cross-harness
  session reader (Codex + Claude Code logs), `pricing.ts` its pricing table,
  `pulse.ts` the read-only reconciliation engine behind `humanctl pulse` (see
  `docs/pulse.md`), `span.ts` the span-of-control counter behind
  `humanctl span` (see `docs/span.md`), `claude-quota.ts` the Claude
  subscription-quota read, and `summary-budget.ts` the AI-summary dollar
  budget. `*.selftest.ts` files run directly via `tsx`.
- `src/` is the humanctl.com site (Next.js), deployed from `main`. `.humanctl/`
  is the sample workspace it renders.
- `.agents/skills/humanctl/` is the agent skill shipped in the npm package.
- `scripts/` holds the hygiene gates: `secret-scan.sh`, `leak-scan.mjs` with
  its denylist `leak-patterns.js`, the commit hook, and
  `package-hygiene-check.js`.

## Command registry

Every mutation of durable state, every process spawn, and every cross-session
observation is a registered command, declared once in `lib/commands.ts` and
logged as one event line in `~/.humanctl/events.jsonl`. Commands marked
`direct` run in-process from the CLI (`humanctl note`, `pulse`, `span`, and
`humanctl app <name>`). App-only commands stay declared and return an honest
"needs the desktop app" error. Register a command in `lib/commands.ts` before
wiring anything to it. See `docs/commands.md`.

## Testing

Toolchain is Node-ecosystem only, on the repo's Node (`.nvmrc`: 24). CI
(`.github/workflows/ci.yml`) requires all of these:

    npm run lint                # Next site
    npm run typecheck           # tsc over lib/ and bin/
    npm run build:lib           # tsup compile, then node --check on dist/
    npm run pulse:selftest      # reconciler against synthetic fixtures
    npm run reader:selftest     # timeline paging + cursor math incl. rotation
    npm run commands:selftest   # registry, event log, socket round-trip
    npm run quota:selftest      # /usage parser, zero process spawns
    npm run span:selftest       # daily counts + span.jsonl upsert
    npm run package:check       # CLI-only npm artifact + tarball smoke
    npm run build               # Next site + CLI

Every selftest that touches `~/.humanctl` runs inside a temp dir pointed at by
`process.env.HOME`, so none of them read or write real data. Print the real
recent-session table with `npm run sessions:table`.

## Hygiene

This repo is public. Real session data, secrets, tokens, personal absolute
paths, and private operating notes are not allowed in tracked files or
release artifacts. Do not use em dashes in any file. See
`docs/repo-hygiene.md`.

Leaks are blocked at commit time: `npm install` arms the tracked pre-commit
hook (`scripts/git-hooks/pre-commit`), which runs
`node scripts/leak-scan.mjs --staged` against one shared denylist
(`scripts/leak-patterns.js`). The same list backs `npm run package:check` and
the CI secret-scan job. Extend patterns only in `scripts/leak-patterns.js`,
with split string literals so the guard never matches its own source, and
keep `npm run leak:selftest` passing. If the hook blocks your commit, the
content is the problem; never bypass it with --no-verify.
