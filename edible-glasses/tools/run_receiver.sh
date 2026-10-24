#!/bin/bash
# The one command for a cooking day: keeps the receiver running until you close the window.
#
#   ~/edible-glasses/tools/run_receiver.sh            (extra flags go to receiver.py, e.g. --auto-job)
#
# - caffeinate keeps the Mac awake (a sleeping laptop stops the recording); plug it in.
# - If the receiver ever exits or crashes, it starts again 3 s later and carries on with the same
#   recording (meta.json keeps the pairing). Ctrl+C stops the receiver; a second Ctrl+C within 3 s quits.
# - Only one receiver can run (it owns port 7070). If one is already running, this says where and quits,
#   instead of failing again and again.
# - Demo settings: --cloud (pairing, backup to GCS, the phone's live picture, the full video saved for the
#   phone on "I'm done"), --no-live (no Gemini while she cooks), --relay-fps 0 (nothing to the VM).
cd "$(dirname "$0")/.." || exit 1

running() { lsof -nP -t -iTCP:7070 -sTCP:LISTEN 2>/dev/null | head -1; }

pid=$(running)
if [ -n "$pid" ]; then
  echo "A receiver is already running (pid $pid), so there's nothing to start. Use its window."
  echo "To restart it, close that window (or: kill $pid), then run this again."
  exit 1
fi

exec caffeinate -is bash -c '
  running() { lsof -nP -t -iTCP:7070 -sTCP:LISTEN 2>/dev/null | head -1; }
  while true; do
    .venv/bin/python receiver/receiver.py --cloud --no-live --relay-fps 0 "$@"
    code=$?
    pid=$(running)
    if [ -n "$pid" ]; then
      echo "Another receiver (pid $pid) has port 7070, so this one stops. Use that one."
      exit 1
    fi
    echo "receiver stopped (exit $code); restarting in 3 s. Press Ctrl+C again to quit."
    sleep 3
  done' _ "$@"
