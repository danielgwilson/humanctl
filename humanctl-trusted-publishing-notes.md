# humanctl trusted publishing notes

This package is set up for npm trusted publishing from GitHub Actions.

## Expected repository assets

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

## npm trusted publisher setup

In npm, configure a Trusted Publisher for the GitHub repository that owns this package.

Expected settings:

- provider: `GitHub Actions`
- repository owner: `danielgwilson`
- repository name: `humanctl`
- workflow filename: `publish.yml`
- environment: none required
- registry: npm public registry

## Release flow

Bootstrap is already complete:

1. package published once manually to claim the npm name
2. package metadata points at the GitHub repo
3. GitHub Actions workflows exist for CI and publishing

After GitHub + npm trusted publisher are connected:

1. bump version in `package.json`
2. update changelog/docs as needed
3. push commit to `main`
4. push tag `vX.Y.Z`
5. let GitHub Actions publish via OIDC

## Important note

The npm package is intentionally CLI-only. The published tarball is constrained by the `files` field in `package.json`, so the Next.js site source and build output are not shipped to npm.
