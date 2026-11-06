#!/bin/bash
# Copies keys from the root .env into an environment's Secrets Manager entries, without printing them. Run it yourself:
#   infra/scripts/load-secrets.sh staging
#   infra/scripts/load-secrets.sh staging TEST_SIGNIN_KEY     # only the names given, so staging's real model keys aren't copied again
#   infra/scripts/load-secrets.sh production ANTHROPIC_API_KEY ...   # production always takes names (infra/README.md, "Production before launch")
# Only names Terraform already created are filled. A name missing from .env is reported and left alone.
set -euo pipefail
ENVIRONMENT=${1:?usage: load-secrets.sh staging|production [NAME ...]}
shift
# .env also holds Convex's and Supabase's EDIBLE_CODE_KEY and LINK_JOIN_SECRET, and production's are its own (make-salt.sh): copying every name would overwrite them.
if [ "$ENVIRONMENT" = production ] && [ $# -eq 0 ]; then
  echo "production takes the names to copy: infra/README.md, \"Production before launch\"" >&2
  exit 2
fi
ONLY=" $* "
ENV_FILE=/Users/calebwang/GitHub/homecookd/homecookd/.env
export AWS_PROFILE=${AWS_PROFILE:-homecookd} AWS_REGION=us-west-2

for ARN_NAME in $(aws secretsmanager list-secrets --filters "Key=name,Values=homecookd/$ENVIRONMENT/" \
    --query 'SecretList[].Name' --output text); do
  KEY=${ARN_NAME##*/}
  if [ "$ONLY" != "  " ] && [[ "$ONLY" != *" $KEY "* ]]; then continue; fi
  VALUE=$(grep "^$KEY=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)
  if [ -z "$VALUE" ]; then echo "not in .env: $KEY"; continue; fi
  printf %s "$VALUE" | aws secretsmanager put-secret-value --secret-id "$ARN_NAME" --secret-string file:///dev/stdin >/dev/null
  echo "set: $KEY"
done
