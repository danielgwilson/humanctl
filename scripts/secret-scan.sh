#!/usr/bin/env bash
# Fail if anything that looks like a committed credential is tracked in the repo.
# Zero-dependency. Runs in CI and locally. Scans tracked + not-yet-ignored files;
# .gitignored paths (node_modules, build output, local state) are skipped.
set -euo pipefail
cd "$(dirname "$0")/.."

# High-signal patterns, chosen for low false-positive rate.
patterns=(
  'BEGIN [A-Z ]*PRIVATE KEY'
  'AKIA[0-9A-Z]{16}'
  'gh[pousr]_[A-Za-z0-9]{36,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'sk-ant-[A-Za-z0-9_-]{20,}'
  'sk-[A-Za-z0-9]{32,}'
)

found=""
for p in "${patterns[@]}"; do
  # --untracked catches WIP files too; git grep still honors .gitignore.
  # Exclude this script so its own patterns do not match.
  matches=$(git grep -nIE --untracked "$p" -- ':!scripts/secret-scan.sh' || true)
  if [ -n "$matches" ]; then
    found="${found}"$'\n'"pattern: ${p}"$'\n'"${matches}"
  fi
done

if [ -n "$found" ]; then
  echo "secret-scan: potential credentials found in tracked files:"
  echo "$found"
  exit 1
fi

echo "secret-scan: clean ($(git ls-files | wc -l | tr -d ' ') tracked files)"
