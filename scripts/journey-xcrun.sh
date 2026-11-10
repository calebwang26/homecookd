#!/bin/bash
# `xcrun` for Maestro in ios-journeys: the Journeys step puts a link to this file first on Maestro's PATH. Every call
# goes straight to the real xcrun (exec: the same process, so Maestro's log streams stop as before), except
# `simctl openurl`: an open that works only gets a line in the open log (when it started, how long simctl took), and one
# that fails is checked as below.
#
# Why: iOS sometimes gives up on a link open after 10 s (lsd: _LSDispatchWithTimeout, Code=60) while SpringBoard still
# delivers it seconds later (docs/build/IOS-JOURNEYS.md, "A link open iOS gives up on"). simctl then fails, Maestro's
# openLink throws an error its retry and optional don't catch (they catch only Maestro's own), and the journey ends on a
# link that landed. So a failed open counts as opened only when the simulator's log shows lsd giving up and the app
# receiving a link within 30 s of the open, the time open-link.yaml would wait for its screen anyway: then it exits 0
# and the flow goes on to check that screen. journey-openurl.mjs decides, and writes one line for the job summary's
# "Journey retry" warning, passed or not. Anything else fails exactly as before, with simctl's own error output.
#
# The link carries keys: it goes to simctl and nowhere else (its error output reaches Maestro only on a failure, as
# without this file). JOURNEY_OPENURL_FAKE=first (the openurl_fault input) treats the first open as one iOS gave up on,
# to check the landing check on a real simulator.
REAL=${XCRUN_REAL:-/usr/bin/xcrun}
if [ "${1:-}" != simctl ] || [ "${2:-}" != openurl ] || [ -z "${JOURNEY_OPENURL_STREAM:-}" ]; then exec "$REAL" "$@"; fi
HERE=$(cd "$(dirname "$(readlink "$0" || echo "$0")")" && pwd)
SINCE=$(node -e 'console.log(Date.now())')
{ ERR=$("$REAL" "$@" 2>&1 1>&3 3>&-); CODE=$?; } 3>&1
SIMULATED=
if [ "$CODE" -eq 0 ] && [ "${JOURNEY_OPENURL_FAKE:-}" = first ] && [ -n "${JOURNEY_OPENURL_LOG:-}" ] \
  && [ ! -e "$JOURNEY_OPENURL_LOG.faked" ]; then
  : > "$JOURNEY_OPENURL_LOG.faked"; SIMULATED=--simulated; CODE=1
fi
if [ "$CODE" -eq 0 ]; then
  [ -z "$ERR" ] || printf '%s\n' "$ERR" >&2
  node "$HERE/journey-openurl.mjs" --since "$SINCE" --stream "$JOURNEY_OPENURL_STREAM" --log "${JOURNEY_OPENURL_LOG:-/dev/null}" \
    --exit 0 >/dev/null 2>&1 || true
  exit 0
fi
if node "$HERE/journey-openurl.mjs" --since "$SINCE" --stream "$JOURNEY_OPENURL_STREAM" --log "${JOURNEY_OPENURL_LOG:-/dev/null}" \
  --exit "$CODE" --wait "${JOURNEY_OPENURL_WAIT_S:-30}" $SIMULATED; then
  exit 0
fi
[ -z "$ERR" ] || printf '%s\n' "$ERR" >&2
exit "$CODE"
