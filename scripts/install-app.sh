#!/usr/bin/env bash
# Install the built humanctl.app.
#
# Canonical target is /Applications; falls back to ~/Applications when
# /Applications is not writable. Removes any existing copy at BOTH locations
# first so there is never a duplicate (two copies make Spotlight ambiguous).
set -euo pipefail

cd "$(dirname "$0")/.."

APP="dist/mac-arm64/humanctl.app"
if [ ! -d "$APP" ]; then
  echo "error: $APP not found. Run 'npm run app:build' first." >&2
  exit 1
fi

if [ -w /Applications ]; then
  target="/Applications"
else
  target="$HOME/Applications"
  echo "note: /Applications is not writable, falling back to $target"
fi

# Never leave two copies behind.
rm -rf "$HOME/Applications/humanctl.app"
if [ -e /Applications/humanctl.app ]; then
  if [ -w /Applications ]; then
    rm -rf /Applications/humanctl.app
  else
    echo "warning: an old copy at /Applications/humanctl.app exists and cannot be removed" >&2
  fi
fi

mkdir -p "$target"
cp -R "$APP" "$target/"
echo "installed to $target/humanctl.app"
