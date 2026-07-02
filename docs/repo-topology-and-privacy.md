# Repo Topology And Privacy

Status: resolved (option 3: public OSS core plus a separate private lab)  
Date: 2026-06-26

## Current State

Observed locally:

- main repo path: `~/local_git/humanctl`
- empty container candidate: `~/local_git/humanctl-repo`
- remote: `https://github.com/danielgwilson/humanctl.git`
- GitHub visibility: public
- homepage: `https://humanctl.com`
- default branch: `main`
- local branch: `main`
- local working tree: dirty before this spec work started

The repo also contains public-facing assumptions:

- `docs/repo-hygiene.md` says the repo is public.
- `package.json` uses public npm publishing metadata.
- `README.md` and the live site position the project as open source infrastructure.

## Decision Needed

The next product direction creates a privacy fork:

1. Public OSS product.
2. Private personal operating layer.
3. Public OSS core plus private personal lab.

The third option is probably best.

## Recommended Shape

Use two layers:

```text
public humanctl
  local-first CLI, docs, file schema, app shell, public-safe samples

private humanctl lab
  Daniel-specific Linear boards, session IDs, local pulse adapters, private proof state, personal automations
```

This preserves the value of the public product while keeping real operating traces out of a public repo.

## Local Directory Recommendation

Daniel's newer repo pattern is:

```text
~/local_git/projectname-repo/
  AGENTS.md
  projectname/
  worktrees/
```

`humanctl` is not in that shape yet. Because the current repo is dirty and already has a remote, do not move it mid-task.

Recommended migration when ready:

```text
~/local_git/humanctl-repo/
  AGENTS.md
  humanctl/
  worktrees/
```

Migration should happen only after:

1. current dirty changes are reviewed
2. remote privacy decision is made
3. local dev server and native build paths are updated
4. docs using absolute paths are updated

## Above-Repo AGENTS.md

When the repo is moved into `humanctl-repo/humanctl`, add an above-repo `AGENTS.md` with these rules:

- Use `humanctl/` as main.
- Use `worktrees/` for feature work.
- Do not commit private Linear URLs, private session IDs, real patient/company data, or personal operating traces.
- Keep public product docs in `humanctl/docs/`.
- Keep public-safe research in `humanctl/research/`.
- Keep private scratch outside the public repo or under ignored `.notes/`.
- Treat native notch code as an attention surface, not product core.
- Prefer CLI, schema, daemon, and Next app work before native shell expansion.

## Visibility Recommendation

If `danielgwilson/humanctl` is going to contain Daniel-specific operating-layer work, make it private before committing that work.

If the repo should remain public:

- keep source captures public-safe
- keep examples synthetic
- avoid private Linear links and session IDs
- avoid local personal state
- move private adapters and automations into a separate private repo

## Immediate Safe Path

For now:

1. keep writing public-safe specs and research into the current repo
2. do not push until privacy is decided
3. do not move directories while the repo is dirty
4. do not expand the native app before `humanctl pulse` exists
5. use `humanctl-repo/` as the target container once the migration is intentional
