#!/bin/bash
# One round of the iOS journeys under Maestro, for ios-journeys' "Journeys" and "Journeys again" steps:
#   scripts/journey-maestro.sh <output dir> <openurl stream file> <openurl log file>
# The link-open stand-in (journey-xcrun.sh) goes first on Maestro's PATH, with its own log stream of lsd's timeouts and
# the app's received links (neither holds a link; both files stay on the runner), and the journeys tagged needs-key run
# when KID_KEY is set (FAMILY_LINK, KID_KEY, COOK_KEY and journey 5's KID5_KEY from the environment, already masked).
# Exits with Maestro's code.
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
# The trustd wait the flows ask before a fresh launch and journey 4's "I'm done" (journey-trust-wait.mjs): 127.0.0.1 only,
# one budget for the job across both attempts, each wait that held one line in its log. Stopped with this script.
node scripts/journey-trust-wait.mjs serve --stream "$RUNNER_TEMP/trustd-stream.log" --log "$RUNNER_TEMP/trustd-wait.log" \
  --budget "$RUNNER_TEMP/trustd-wait-budget.json" > /dev/null 2>&1 &
WAITSERVER=$!
trap 'kill $OPENSTREAM $WAITSERVER 2>/dev/null || true' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null --max-time 1 http://127.0.0.1:47231/ && break; sleep 0.5; done
curl -s -o /dev/null --max-time 1 http://127.0.0.1:47231/ \
  || echo "::warning title=Trust wait::the trustd wait didn't start, so the journeys won't wait out a pinning database rebuild"
if [ -n "${JOURNEY_OPENURL_FAKE:-}" ]; then echo "openurl_fault: the first link open the app gets on its own counts as one iOS gave up on"; fi
KEYED=(--exclude-tags needs-key)
if [ -n "${KID_KEY:-}" ]; then KEYED=(-e "FAMILY_LINK=$FAMILY_LINK" -e "KID_KEY=$KID_KEY" -e "COOK_KEY=$COOK_KEY" -e "KID5_KEY=${KID5_KEY:-}"); fi
PATH="$RUNNER_TEMP/xcrun:$PATH" maestro --device "$UDID" test app/e2e/journeys --format junit \
  --output "$OUT/report.xml" --test-output-dir "$OUT" -e APP_ID="$APP_ID" "${KEYED[@]}"
