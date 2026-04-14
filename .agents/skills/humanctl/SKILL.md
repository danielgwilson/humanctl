---
name: humanctl
description: Use when working with the local humanctl workspace and you need to create, read, update, answer, or delete asks, artifacts, or watches via the humanctl CLI. Triggers include requests to publish an artifact into humanctl, create or answer an ask, inspect the current humanctl queue, update a watch, or route an agent result into the shared local .humanctl workspace.
---

# humanctl

Use the local `humanctl` CLI instead of editing `.humanctl/` files by hand.

## Use this skill when

- an agent needs to publish a result into `humanctl`
- an agent needs to create or update an ask
- an agent needs to list or inspect asks, artifacts, or watches
- a human answer needs to be written back into the workspace
- a task refers to the shared local `.humanctl/` workspace

## Workflow

1. Work from the repo root or pass `--workspace <dir>` explicitly.
2. Prefer `--json` for agent-consumable reads and mutations.
3. Use semantic commands:
   - `humanctl ask create|get|list|update|answer|delete`
   - `humanctl artifact put|get|list|delete`
   - `humanctl watch create|get|list|update|delete`
4. Treat delete as destructive. Only delete when the user explicitly asks.
5. Prefer `artifact put` over hand-writing manifests or copying files into `.humanctl/`.

## Command patterns

```bash
humanctl status . --json
humanctl ask list --workspace . --json
humanctl ask create --workspace . --title "..." --prompt "..." --artifact some-artifact --json
humanctl ask answer ask-id --workspace . --choice looks-good --note "..." --json
humanctl artifact put ./path/to/file.html --workspace . --title "..." --kind preview --json
humanctl watch create --workspace . --title "..." --condition-summary "..." --kind presence --json
```

## Notes

- The workspace root is `.humanctl/` under the chosen base directory.
- `artifact get --json` returns the manifest plus file content.
- `ask answer` writes the human response and appends an inbox event.
- `ask update` replaces `artifactIds` / `watchIds` when those flags are passed.
- `watch create` and `watch update` use `--condition-summary` for the durable condition text.
