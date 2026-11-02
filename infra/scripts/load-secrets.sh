#!/bin/bash
# Copies keys from the root .env into an environment's Secrets Manager entries, without printing them. Run it yourself:
#   infra/scripts/load-secrets.sh production
# Only names Terraform already created are filled. A name missing from .env is reported and left alone.
set -euo pipefail
ENVIRONMENT=${1:?usage: load-secrets.sh staging|production}
ENV_FILE=/Users/calebwang/GitHub/homecookd/hackathon-homecookd/.env
export AWS_PROFILE=${AWS_PROFILE:-homecookd} AWS_REGION=us-west-2

for ARN_NAME in $(aws secretsmanager list-secrets --filters "Key=name,Values=homecookd/$ENVIRONMENT/" \
    --query 'SecretList[].Name' --output text); do
  KEY=${ARN_NAME##*/}
  VALUE=$(grep "^$KEY=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)
  if [ -z "$VALUE" ]; then echo "not in .env: $KEY"; continue; fi
  printf %s "$VALUE" | aws secretsmanager put-secret-value --secret-id "$ARN_NAME" --secret-string file:///dev/stdin >/dev/null
  echo "set: $KEY"
done
