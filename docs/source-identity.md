# Source Identity

This doc defines how `humanctl` should identify the thing asking for attention.

The key distinction is:

- `harness` = who is asking for attention
- `host` = where that harness is running

This matters because a terminal window is not the real source of attention.

Example:

- Codex running in Terminal is still **Codex**
- Claude Code running in Warp is still **Claude Code**

The host is secondary context, not the primary identity.

## Core Model

```ts
type SourceIdentity = {
  harness: HarnessKind;
  host?: HostKind;
  threadCount?: number;
  confidence: "explicit" | "inferred" | "fallback";
};
```

```ts
type HarnessKind =
  | "codex"
  | "claude-code"
  | "opencode"
  | "gemini-cli"
  | "copilot-coding-agent"
  | "cursor-agent"
  | "cline"
  | "roo-code"
  | "aider"
  | "unknown";
```

```ts
type HostKind =
  | "codex-app"
  | "terminal"
  | "warp"
  | "iterm"
  | "cursor"
  | "vscode"
  | "browser"
  | "github"
  | "unknown";
```

## Visual Hierarchy

Ambient left shoulder should render identity in this order:

1. primary harness mark
2. tiny host badge
3. optional thread-count badge

Example:

- Codex in Terminal -> Codex mark + tiny terminal badge
- Claude Code in Warp -> Claude mark + tiny Warp badge
- Copilot coding agent on GitHub -> Copilot mark + tiny GitHub/browser badge

Rules:

- the harness mark is primary
- the host badge is secondary
- the count badge is tertiary
- if space is tight, hide count first
- if space is very tight, show harness only

## What Is Not A Harness

These are **not** coding-agent harnesses and should not be treated as primary identity:

- Raycast
- Terminal
- Warp
- iTerm
- Chrome
- Safari

Those are hosts, shells, or launch surfaces.

They can still appear as host badges.

## Initial Harness Support Matrix

This is the recommended starting set for `humanctl`.

### Tier 1

Support these first:

- `codex`
- `claude-code`
- `opencode`
- `gemini-cli`
- `copilot-coding-agent`
- `cursor-agent`

Why:

- they are major current coding-agent surfaces
- they map cleanly to the product use case
- they are likely to be present in actual `humanctl` workflows

### Tier 2

Support soon after if needed:

- `cline`
- `roo-code`
- `aider`

Why:

- real agentic coding harnesses
- important enough to account for
- slightly less central to the immediate `humanctl` direction

### Out Of Scope For Now

Do not optimize the first pass around:

- general productivity apps
- AI chat apps without coding-agent workflow semantics
- generic browsers as primary identity

## Asset Policy

For a public OSS repo, the safest default is:

- commit our own internal monochrome harness glyph set
- resolve host app icons locally at runtime when available
- avoid committing third-party vendor logos by default

Why:

- trademark and brand usage is inconsistent across vendors
- local runtime host badges are easy to source on user machines
- internal harness glyphs keep the UI coherent and legally cleaner

This means:

- `Codex`, `Claude Code`, `OpenCode`, etc. get `humanctl`-owned harness glyphs
- `Terminal`, `Warp`, `Chrome`, etc. can supply tiny runtime host badges locally

## Local Host Resolution

On this machine, the obvious host app surfaces already exist:

- `Codex.app`
- `Claude.app`
- `Warp.app`
- `Cursor.app`
- `Google Chrome.app`
- `Safari.app`
- `Raycast.app`

Useful host badges can be resolved from local app bundles where present.

Examples found locally:

- `Terminal.app` -> `/System/Applications/Utilities/Terminal.app`
- `Warp.app` -> `/Applications/Warp.app`
- `Google Chrome.app` -> `/Applications/Google Chrome.app`
- `Safari.app` -> `/Applications/Safari.app`

## Practical Recommendation

The first implementation should do this:

1. define `SourceIdentity`
2. ship internal monochrome harness glyphs for Tier 1 harnesses
3. add host badge support for terminal / Warp / browser / editor
4. only later consider optional vendor-logo enhancement

That keeps the notch identity system robust even when:

- the harness is not open as a desktop app
- the harness is running in a terminal
- branding assets are unavailable or legally unclear
