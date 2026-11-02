#!/bin/bash
# Creates a Convex key that only reaches grand-dragon-649, for the backups, and puts it straight into Secrets Manager. It
# never appears on screen. Run it yourself, once, after infra/backups is applied: infra/scripts/create-backup-key.sh
# Undo: Convex's delete_deploy_key with the name homecookd-aws-backup.
set -euo pipefail
ENV_FILE=/Users/calebwang/GitHub/homecookd/homecookd/.env
TOKEN=$(grep '^CONVEX_OVERRIDE_ACCESS_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
RESPONSE=$(curl -sf -X POST https://api.convex.dev/v1/deployments/grand-dragon-649/create_deploy_key \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"homecookd-aws-backup"}')
python3 -c 'import json,sys; sys.stdout.write(json.loads(sys.argv[1])["deployKey"])' "$RESPONSE" \
  | aws secretsmanager put-secret-value --profile homecookd --region us-west-2 \
      --secret-id homecookd/backups/CONVEX_DEPLOY_KEY --secret-string file:///dev/stdin >/dev/null
echo "Key created and stored. Its value was not shown."
