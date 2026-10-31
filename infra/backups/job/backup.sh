#!/bin/bash
# Needs CONVEX_DEPLOY_KEY (made by infra/scripts/create-backup-key.sh) and BACKUP_BUCKET. A failure exits non-zero, which
# emails Caleb; the metric at the end is what the "no backup today" alarm watches.
set -euo pipefail
STAMP=$(date -u +%Y-%m-%dT%H%M)
SNAPSHOT=/tmp/convex-$STAMP.zip

npx convex export --include-file-storage --path "$SNAPSHOT"
node -e "process.exit(require('fs').statSync(process.argv[1]).size > 1000 ? 0 : 1)" "$SNAPSHOT"

aws s3 cp --only-show-errors "$SNAPSHOT" "s3://$BACKUP_BUCKET/convex/$STAMP.zip"
aws cloudwatch put-metric-data --namespace homecookd/backups --metric-name ConvexBackupDone --value 1
echo "backup done: convex/$STAMP.zip, $(stat -c %s "$SNAPSHOT") bytes"
