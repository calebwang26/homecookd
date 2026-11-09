#!/bin/bash
# The only way to publish an EAS Update. It checks the export, then publishes exactly what it checked. Values are never printed.
#   scripts/safe-eas-update.sh staging "what changed" [--check-only]
#   scripts/safe-eas-update.sh aws-staging "what changed" [--check-only]
#   scripts/safe-eas-update.sh production-aws "what changed" --check-only | --caleb-ok
# An update doesn't read eas.json's build env: the bundle is exported here, from this shell and app/.env. So the AWS
# switch is set here for the aws-staging channel, and for production-aws exactly as that build profile bakes it, and
# refused for every other one. Never the production channel: it reaches public 1.0 (build 6, the old backend).
set -euo pipefail
CHANNEL=${1:?usage: safe-eas-update.sh <channel> <message> [--check-only]}
MESSAGE=${2:?usage: safe-eas-update.sh <channel> <message> [--check-only]}
CHECK_ONLY=${3:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
AWS_STAGING_URL=https://d2zh46br3dalyf.cloudfront.net
AWS_STAGING_HOST=d2zh46br3dalyf.cloudfront.net

if [ "$CHANNEL" = "production" ]; then
  echo "REFUSED: no updates to the production channel: it reaches public 1.0 (build 6), on the old backend." >&2
  exit 1
fi
# 1.1 in the App Store (build 18, released Nov 8) listens on production-aws with runtime 1.1.0 (its Expo.plist). An
# update there reaches every 1.1 phone on its next launch, so publishing needs --caleb-ok; --check-only is always fine.
# Apple closed the 1.1.0 train once 1.1.0 was approved (build 20 failed processing, 90062 and 90186): no new 1.1.0
# binary can reach TestFlight, so a 1.1.0 update can't be tried on a 1.1.0 TestFlight build first. A 1.1.1 build is a
# different runtime; publish 1.1.0 phones' update from a checkout whose app.json still says 1.1.0 (this check refuses
# anything else).
# Undo (eas-cli 27.5.0): the phones go back to build 18's own JS on a launch after they fetch it.
#   cd app && npx eas-cli update:roll-back-to-embedded --channel production-aws --runtime-version 1.1.0 --platform ios \
#     --message "Back to build 18's own JS" --non-interactive
# Main says 1.1.1 since Nov 8 (Apple closed the 1.1.0 train once it was released, so new binaries are 1.1.1), so an
# update for today's 1.1.0 phones is published from a 1.1.0 commit (690bf30c3 has #402), never from main. Once 1.1.1
# is in the store, this becomes 1.1.1.
PRODUCTION_AWS_RUNTIME=1.1.0
if [ "$CHANNEL" = "production-aws" ]; then
  if [ "$CHECK_ONLY" != "--check-only" ] && [ "$CHECK_ONLY" != "--caleb-ok" ]; then
    echo "REFUSED: production-aws reaches every 1.1 phone. Run with --check-only, or --caleb-ok once Caleb has said yes." >&2
    exit 1
  fi
  RUNTIME=$(node -p "require('$ROOT/app/app.json').expo.version")
  if [ "$RUNTIME" != "$PRODUCTION_AWS_RUNTIME" ]; then
    echo "REFUSED: app.json says $RUNTIME, but the production-aws build in the store runs $PRODUCTION_AWS_RUNTIME. An update for another runtime reaches nobody. Publish from a $PRODUCTION_AWS_RUNTIME commit (a worktree at 690bf30c3), not from main." >&2
    exit 1
  fi
  if env | grep -q '^EXPO_PUBLIC_'; then
    echo "REFUSED: an EXPO_PUBLIC_ value is set in this shell. production-aws takes exactly its build profile's values; unset them." >&2
    exit 1
  fi
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
elif [ "$CHANNEL" = "production-aws" ]; then
  # Exactly what eas.json's production-aws profile bakes (production's env, then its own), and no app/.env: EAS
  # builds from git, where app/.env isn't, so build 18 never saw it.
  PROFILE_ENV=$(node -e "const b=require('$ROOT/app/eas.json').build;const e={...b.production.env,...b['production-aws'].env};console.log(Object.entries(e).map(([k,v])=>k+'='+v).join('\n'))")
  EXPORT_ENV=(env EXPO_NO_DOTENV=1)
  while IFS= read -r kv; do EXPORT_ENV+=("$kv"); done <<< "$PROFILE_ENV"
  CHECK=(--aws api.homecookd.app --also media.homecookd.app --not "$AWS_STAGING_HOST")
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
