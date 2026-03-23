# Repo Hygiene

`humanctl` is public.

That means we should aggressively keep notes and learnings, while also being selective about what actually belongs in the repo.

## What Should Be Committed

Commit durable, reusable project knowledge:

- product definitions
- design contracts
- implementation specs
- architecture notes
- stable research packs
- public-safe screenshots and examples that are clearly part of the project story
- source code
- intentionally curated sample data

Good rule:

If someone new joined the project next month, would this file help them understand or extend `humanctl`?

If yes, it probably belongs in the repo.

## What Should Not Be Committed

Do not commit transient or personal operating residue:

- local UI state
- generated event logs
- ad hoc scratch notes
- personal recordings or transcripts unless intentionally curated and safe
- local build output
- screenshots captured only for debugging
- duplicated failed experiments kept only for temporary reference
- private credentials, tokens, or URLs

Good rule:

If the file exists mostly because we were actively working, debugging, or thinking out loud, it probably does **not** belong in the public repo.

## Split: Durable Docs vs Private Scratch

Use:

- `docs/` for durable public documentation
- `research/` for durable public research packs
- `research/notch-baselines/` for curated before/after notch captures when we intentionally promote them as a visual baseline
- `.notes/` for local scratch notes that should stay private and untracked
- `output/` for generated captures and debugging artifacts that should stay untracked unless deliberately promoted

## Promotion Rule

A file can start life as local scratch and later be promoted into the repo.

Before promoting it, ask:

1. is it cleaned up?
2. is it understandable without local context?
3. is it safe for a public repo?
4. is it actually useful to future contributors?

If not, keep it out.

## Native Spike Rule

Native shell work is especially easy to clutter.

Keep out of git:

- derived data
- temporary project output
- stale runtime state
- archived failed spikes that no longer teach anything new

If an experiment produced a real lesson, commit the lesson in `docs/`, not every piece of wreckage.

## `humanctl` Runtime State

The local runtime should remain local-first without making the repo dirty.

That means transient state should stay ignored:

- `.humanctl/state/`
- `.humanctl/inbox/events.jsonl`

Curated sample workspace structure can be committed when it is intentionally part of the product prototype.

## Practical Standard

Default posture:

- commit product truth
- ignore local residue

If we are unsure, prefer keeping raw notes and debugging exhaust out of the repo until they are cleaned and promoted deliberately.
