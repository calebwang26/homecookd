#!/bin/bash
# Fills an environment's RATE_LIMIT_SALT, or the names given, with a random value, once, without showing it. Rate limit keys, links and
# returning identities depend on them, so it refuses to replace one that's set.
#   infra/scripts/make-salt.sh staging
#   infra/scripts/make-salt.sh staging LINK_JOIN_SECRET LEFT_IDENTITY_SECRET     # staging's own, never production's
set -euo pipefail
ENVIRONMENT=${1:?usage: make-salt.sh staging|production [NAME ...]}
shift
NAMES=("${@:-RATE_LIMIT_SALT}")
export AWS_PROFILE=${AWS_PROFILE:-homecookd} AWS_REGION=us-west-2
for NAME in "${NAMES[@]}"; do
  ID=homecookd/$ENVIRONMENT/$NAME
  if aws secretsmanager get-secret-value --secret-id "$ID" --query VersionId --output text >/dev/null 2>&1; then
    echo "already set: $ID"
    continue
  fi
  openssl rand -hex 32 | tr -d '\n' | aws secretsmanager put-secret-value --secret-id "$ID" --secret-string file:///dev/stdin >/dev/null
  echo "set: $ID"
done
