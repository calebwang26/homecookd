#!/bin/bash
# Fills an environment's RATE_LIMIT_SALT with a random value, once, without showing it. Rate limit keys depend on it, so it
# refuses to replace one that's set.  infra/scripts/make-salt.sh staging
set -euo pipefail
ENVIRONMENT=${1:?usage: make-salt.sh staging|production}
export AWS_PROFILE=${AWS_PROFILE:-homecookd} AWS_REGION=us-west-2
ID=homecookd/$ENVIRONMENT/RATE_LIMIT_SALT
if aws secretsmanager get-secret-value --secret-id "$ID" --query VersionId --output text >/dev/null 2>&1; then
  echo "already set: $ID"
  exit 0
fi
openssl rand -hex 32 | tr -d '\n' | aws secretsmanager put-secret-value --secret-id "$ID" --secret-string file:///dev/stdin >/dev/null
echo "set: $ID"
