#!/usr/bin/env bash
# Smoke-test the PACKAGED app (the asar bundle), not the unpacked dev build.
# This catches asar-packaging bugs the perf:selftest gate cannot: perf:selftest
# launches dist/electron/main.js directly (dist/lib present on disk), so it
# never exercises the asar. A missing entry in electron-builder `files` (e.g.
# dist/lib) crashes the packaged app on launch with "Cannot find module" while
# every dev-mode check stays green. Launch the real binary under HUMANCTL_SMOKE
# and assert it boots to the success marker.
set -uo pipefail

APP="${1:-/Applications/humanctl.app}"
BIN="$APP/Contents/MacOS/humanctl"
if [ ! -x "$BIN" ]; then
  echo "[smoke:packaged] FAIL: packaged binary not found or not executable: $BIN"
  exit 1
fi

echo "[smoke:packaged] launching packaged app under HUMANCTL_SMOKE=1: $BIN"
tmp="$(mktemp)"
HUMANCTL_SMOKE=1 ELECTRON_ENABLE_LOGGING=1 "$BIN" >"$tmp" 2>&1 &
pid=$!

ok=0
for _ in $(seq 1 30); do
  if grep -q "HUMANCTL_SMOKE ok" "$tmp"; then ok=1; break; fi
  if grep -qE "Cannot find module|Uncaught Exception|A JavaScript error" "$tmp"; then ok=0; break; fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done

kill -9 "$pid" 2>/dev/null
wait "$pid" 2>/dev/null

if [ "$ok" = 1 ] && ! grep -qE "Cannot find module|Uncaught Exception|A JavaScript error" "$tmp"; then
  echo "[smoke:packaged] PASS -- packaged app booted cleanly:"
  grep "HUMANCTL_SMOKE ok" "$tmp" | tail -1
  rm -f "$tmp"
  exit 0
fi

echo "[smoke:packaged] FAIL -- packaged app did not smoke-boot cleanly. Last output:"
tail -20 "$tmp"
rm -f "$tmp"
exit 1
