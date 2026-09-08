---
name: humanctl
description: Use when an agent needs a human decision or wants to tell the human something without blocking: create, update, answer, close, or wait on asks; post notes; publish artifacts; or inspect the local .humanctl workspace or the hub queue via the humanctl CLI. Triggers include needing approval, a choice between options, a review, or routing a result to the human.
---

# humanctl

Use the `humanctl` CLI instead of editing `.humanctl/` files by hand. Prefer
`--json` for anything another agent or script consumes.

## When you need a human decision

1. Write the evidence to one HTML file that reads at phone width (a table, a
   side-by-side, a screenshot, a tally with its denominator). The human will
   answer from that file, not from your prose.
2. Create the ask. The title is the question; the options are bounded; say
   which one you would take and why in one clause; say what proceeds once
   answered; attach the file:

   ```bash
   humanctl ask create \
     --title "Ship the pricing page as drafted?" \
     --prompt "Draft renders both plans; the annual toggle is new and defaults to off." \
     --option "ship|Ship it|Merge and deploy" \
     --option "hold|Hold|Leave the PR open" \
     --recommended ship --reason "copy and layout match the spec" \
     --unblocks "merge, deploy, close the ticket" \
     --attach ./pricing-preview.html --json
   ```

   `--recommended` plus `--reason` is what lets the human answer with one
   tap. Without them the ask waits for words. Read `hub.pushed` from the
   output; if it is `false` and a hub is configured, say so with
   `humanctl note --level blocked "..."`.
3. Wait for the answer:

   ```bash
   humanctl ask get <ask-id> --wait --json
   ```

   Exit 0 with `answer.choiceId` means answered. Exit 3 means still
   unanswered after the timeout (540 s by default): run the same command
   again, it is not a no. Exit 4 means the ask was closed. Never re-create
   the ask with the same title while waiting; `ask update` changes it.
4. If you proceed without an answer, close the ask first so the human's
   queue stays honest:

   ```bash
   humanctl ask close <ask-id> --status withdrawn --proceeded-with ship
   ```

## When you want to tell the human something

```bash
humanctl note --level fyi|review|blocked|done "one line" [--image proof.png] [--session <id>]
```

`review` and `blocked` notes wait in the human's queue until seen; a later
`done` note from the same session clears them. `--image` (up to 4) travels
with the note.

## Other commands

```bash
humanctl status . --json
humanctl ask list --workspace . --json
humanctl ask answer <ask-id> --choice <option-id> [--note "..."] --json   # only when the human answered you in chat
humanctl artifact put ./path/to/file.html --title "..." --kind preview --json
humanctl watch create --title "..." --condition-summary "..." --kind presence --json
humanctl hub status --json                                              # what the hub says needs the human, across machines
```

## Notes

- The workspace root is `.humanctl/` under the chosen base directory
  (`--workspace <dir>`, default `.`).
- `ask update` replaces `artifactIds` / `watchIds` when those flags are
  passed; `--attach` on update adds.
- Treat delete as destructive. Only delete when the user explicitly asks;
  `ask close` is the normal way to retire an ask.
- With a hub configured (`humanctl hub config`), `note`, `ask`, and
  `artifact put` push after their local write; `--no-hub` skips that for
  one command. The local file is always the durable record.
- Never put secrets, credentials, or private paths in an ask, a note, or an
  artifact: they leave the machine when a hub is configured.
