#!/bin/bash
# The end of a real-models window on staging: overwrites the real keys with a dummy. Turning real models off only closes the path to them.
set -euo pipefail
[ "${1:-}" = staging ] || { echo "usage: clear-real-keys.sh staging"; exit 2; }
export AWS_PROFILE=${AWS_PROFILE:-homecookd} AWS_REGION=us-west-2
for KEY in ANTHROPIC_API_KEY CARTESIA_API_KEY; do
  aws secretsmanager put-secret-value --secret-id "homecookd/staging/$KEY" --secret-string "window-closed" >/dev/null
  echo "cleared: $KEY"
done
