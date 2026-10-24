#!/bin/bash
# Deploy the voice service to Cloud Run (us-west1) with min instances 1 and a 60-minute request
# timeout, so a cooking WebSocket isn't cut off. Keys go to Secret Manager from the root .env, never
# printed. Run from anywhere:  voice/deploy.sh
#
# CONVEX_SITE_URL and VOICE_SECRET are optional: without them the service runs on its stub recipe.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"
ENV_FILE=$(git rev-parse --show-toplevel)/.env
[ -f "$ENV_FILE" ] || ENV_FILE=$(git rev-parse --path-format=absolute --git-common-dir)/../.env
fromenv() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

P=$(fromenv GCP_PROJECT)
REGION=us-west1
SERVICE=homecookd-voice
SA=$(gcloud projects describe "$P" --format='value(projectNumber)')-compute@developer.gserviceaccount.com

gcloud services enable secretmanager.googleapis.com --project "$P"

# One Secret Manager secret per key, named like the env var. Adds a new version only when it changed.
SECRETS=()
for NAME in CARTESIA_API_KEY ANTHROPIC_API_KEY MOSS_PROJECT_ID MOSS_PROJECT_KEY VOICE_SECRET; do
  VALUE=$(fromenv $NAME)
  [ -n "$VALUE" ] || { echo "skip $NAME (not in .env)"; continue; }
  if ! gcloud secrets describe $NAME --project "$P" >/dev/null 2>&1; then
    printf %s "$VALUE" | gcloud secrets create $NAME --project "$P" --replication-policy=automatic --data-file=- >/dev/null
    echo "created secret $NAME"
  elif [ "$(gcloud secrets versions access latest --secret=$NAME --project "$P")" != "$VALUE" ]; then
    printf %s "$VALUE" | gcloud secrets versions add $NAME --project "$P" --data-file=- >/dev/null
    echo "updated secret $NAME"
  fi
  gcloud secrets add-iam-policy-binding $NAME --project "$P" \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
  SECRETS+=("$NAME=$NAME:latest")
done

ENV_VARS="CLAUDE_FAST=1"
CONVEX_SITE_URL=$(fromenv CONVEX_SITE_URL)
[ -n "$CONVEX_SITE_URL" ] && ENV_VARS="$ENV_VARS,CONVEX_SITE_URL=$CONVEX_SITE_URL"

gcloud run deploy $SERVICE --project "$P" --region $REGION --source . \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 3 \
  --timeout 3600 --concurrency 50 --session-affinity \
  --cpu 1 --memory 1Gi \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "$(IFS=,; echo "${SECRETS[*]}")"

URL=$(gcloud run services describe $SERVICE --project "$P" --region $REGION --format='value(status.url)')
echo "$URL  (app: ${URL/https:/wss:}/cook?session=…&recipe=…)"
curl -sf "$URL/healthz" && echo "  healthz ok"
