#!/bin/bash
# The only way to publish an EAS Update. It checks the export, then publishes exactly what it checked. Values are never printed.
#   scripts/safe-eas-update.sh staging "what changed" [--check-only]
#   scripts/safe-eas-update.sh aws-staging "what changed" [--check-only]
# An update doesn't read eas.json's build env: the bundle is exported here, from this shell and app/.env. So the AWS
# switch is set here for the aws-staging channel and refused for every other one. Never the production channel while
# 1.0 is in App Review (AGENTS.md).
set -euo pipefail
CHANNEL=${1:?usage: safe-eas-update.sh <channel> <message> [--check-only]}
MESSAGE=${2:?usage: safe-eas-update.sh <channel> <message> [--check-only]}
CHECK_ONLY=${3:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
AWS_STAGING_URL=https://d2zh46br3dalyf.cloudfront.net
AWS_STAGING_HOST=d2zh46br3dalyf.cloudfront.net

if [ "$CHANNEL" = "production" ]; then
  echo "REFUSED: no updates to the production channel while 1.0 is in App Review (it reaches the reviewed build)." >&2
  exit 1
fi
# The 1.1 build on production AWS (CUTOVER step 8). Its updates would need the switch and production's URL, which this
# script doesn't set yet, and an update there reaches the build Apple reviews: refused until that's added with Caleb's OK.
if [ "$CHANNEL" = "production-aws" ]; then
  echo "REFUSED: no updates to production-aws yet (the 1.1 review build). Build again from main instead." >&2
  exit 1
fi
if [ -n "${EXPO_PUBLIC_FAMILY_CODE:-}" ]; then
  echo "REFUSED: EXPO_PUBLIC_FAMILY_CODE is set in this shell, and it would ship to every phone. Unset it." >&2
  exit 1
fi
if [ -f "$ROOT/app/.env" ] && grep -Eq '^EXPO_PUBLIC_FAMILY_CODE=.*[^[:space:]"'"'"']' "$ROOT/app/.env"; then
  echo "REFUSED: app/.env sets EXPO_PUBLIC_FAMILY_CODE, and it would ship to every phone. Remove it from that file." >&2
  exit 1
fi
if [ -f "$ROOT/app/.env" ] && grep -Eq '^EXPO_PUBLIC_(BACKEND|AWS_URL)=' "$ROOT/app/.env"; then
  echo "REFUSED: app/.env sets the AWS switch. This script sets it for aws-staging itself; remove it from that file." >&2
  exit 1
fi

if [ "$CHANNEL" = "aws-staging" ]; then
  EXPORT_ENV=(env EXPO_PUBLIC_BACKEND=aws "EXPO_PUBLIC_AWS_URL=$AWS_STAGING_URL")
  CHECK=(--aws "$AWS_STAGING_HOST")
else
  if [ -n "${EXPO_PUBLIC_BACKEND:-}" ] || [ -n "${EXPO_PUBLIC_AWS_URL:-}" ]; then
    echo "REFUSED: the AWS switch is set in this shell, and only the aws-staging channel's phones are on AWS. Unset it." >&2
    exit 1
  fi
  EXPORT_ENV=(env -u EXPO_PUBLIC_BACKEND -u EXPO_PUBLIC_AWS_URL)
  CHECK=(--no-aws "$AWS_STAGING_HOST")
fi

OUT=$(mktemp -d "$ROOT/app/.safe-export.XXXXXX")
trap 'rm -rf "$OUT"' EXIT
# --clear: Metro's cache keeps the last export's env, so a switch-on bundle could come back on a switch-off export.
(cd "$ROOT/app" && "${EXPORT_ENV[@]}" npx expo export --clear --platform ios --output-dir "$(basename "$OUT")" >/dev/null)
node "$ROOT/scripts/check-app-export.mjs" "app/$(basename "$OUT")" "${CHECK[@]}"

if [ "$CHECK_ONLY" = "--check-only" ]; then
  echo "Checked, and nothing published."
  exit 0
fi
(cd "$ROOT/app" && npx eas-cli update --channel "$CHANNEL" --message "$MESSAGE" --input-dir "$(basename "$OUT")" --skip-bundler --environment production)
