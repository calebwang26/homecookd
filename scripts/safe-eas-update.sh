#!/bin/bash
# The only way to publish an EAS Update: refuses a family code, checks the export, then publishes exactly what it checked.
#   scripts/safe-eas-update.sh staging "what changed" [--check-only]
# While 1.0 is in App Review, never the production channel (AGENTS.md). Values are never printed.
set -euo pipefail
CHANNEL=${1:?usage: safe-eas-update.sh <channel> <message> [--check-only]}
MESSAGE=${2:?usage: safe-eas-update.sh <channel> <message> [--check-only]}
CHECK_ONLY=${3:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

if [ -n "${EXPO_PUBLIC_FAMILY_CODE:-}" ]; then
  echo "REFUSED: EXPO_PUBLIC_FAMILY_CODE is set in this shell, and it would ship to every phone. Unset it." >&2
  exit 1
fi
if [ -f "$ROOT/app/.env" ] && grep -Eq '^EXPO_PUBLIC_FAMILY_CODE=.*[^[:space:]"'"'"']' "$ROOT/app/.env"; then
  echo "REFUSED: app/.env sets EXPO_PUBLIC_FAMILY_CODE, and it would ship to every phone. Remove it from that file." >&2
  exit 1
fi

OUT=$(mktemp -d "$ROOT/app/.safe-export.XXXXXX")
trap 'rm -rf "$OUT"' EXIT
(cd "$ROOT/app" && npx expo export --platform ios --output-dir "$(basename "$OUT")" >/dev/null)
node "$ROOT/scripts/check-merge-safe.mjs" --export "app/$(basename "$OUT")"

if [ "$CHECK_ONLY" = "--check-only" ]; then
  echo "Checked, and nothing published."
  exit 0
fi
(cd "$ROOT/app" && npx eas-cli update --channel "$CHANNEL" --message "$MESSAGE" --input-dir "$(basename "$OUT")" --skip-bundler --environment production)
