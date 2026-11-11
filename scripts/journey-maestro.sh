#!/bin/bash
# One round of the iOS journeys under Maestro, for ios-journeys' "Journeys" and "Journeys again" steps:
#   scripts/journey-maestro.sh <output dir> <openurl stream file> <openurl log file>
# The link-open stand-in (journey-xcrun.sh) goes first on Maestro's PATH, with its own log stream of lsd's timeouts and
# the app's received links (neither holds a link; both files stay on the runner), and the journeys tagged needs-key run
# when KID_KEY is set (FAMILY_LINK, KID_KEY and COOK_KEY from the environment, already masked). Exits with Maestro's code.
set -e
OUT=$1
mkdir -p "$OUT" "$RUNNER_TEMP/xcrun"
ln -sf "$PWD/scripts/journey-xcrun.sh" "$RUNNER_TEMP/xcrun/xcrun"
export JOURNEY_OPENURL_STREAM=$2 JOURNEY_OPENURL_LOG=$3
: > "$JOURNEY_OPENURL_LOG"
xcrun simctl spawn "$UDID" log stream --style syslog --predicate \
  '(process == "lsd" AND eventMessage CONTAINS "_LSDispatchWithTimeout") OR (process == "homecookd" AND eventMessage CONTAINS "UIOpenURLAction")' \
  > "$JOURNEY_OPENURL_STREAM" 2>/dev/null &
OPENSTREAM=$!
trap 'kill $OPENSTREAM 2>/dev/null || true' EXIT
if [ -n "${JOURNEY_OPENURL_FAKE:-}" ]; then echo "openurl_fault: the first link open the app gets on its own counts as one iOS gave up on"; fi
KEYED=(--exclude-tags needs-key)
if [ -n "${KID_KEY:-}" ]; then KEYED=(-e "FAMILY_LINK=$FAMILY_LINK" -e "KID_KEY=$KID_KEY" -e "COOK_KEY=$COOK_KEY"); fi
PATH="$RUNNER_TEMP/xcrun:$PATH" maestro --device "$UDID" test app/e2e/journeys --format junit \
  --output "$OUT/report.xml" --test-output-dir "$OUT" -e APP_ID="$APP_ID" "${KEYED[@]}"
