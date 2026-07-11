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
2. run `npm run build:lib && npm run package:check && npm run publish:check`
3. update changelog/docs as needed
4. push commit to `main`
5. push tag `vX.Y.Z`
6. let GitHub Actions publish via OIDC

## Important note

The published npm file surface is intentionally CLI-only. The tarball is constrained
by the `files` field in `package.json`, and `npm run package:check` verifies,
installs, and smokes the exact tarball before publication. The Next.js site
source, docs, Electron output, and source maps are not shipped. The root
Next.js and React runtime dependencies remain declared to preserve `npm start`;
splitting them from the CLI is separate packaging work. Electron Builder injects
the desktop entry point through `build.extraMetadata`; it is not npm package
metadata.
