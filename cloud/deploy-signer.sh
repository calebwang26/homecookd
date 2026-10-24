#!/bin/bash
# Deploy the upload signer as a public HTTPS Cloud Run function (free tier: 2M requests/month).
# Public on purpose: the phone has no account. It only hands out create-only upload URLs and
# requires the X-Edible-Family header (FAMILY_CODE from .env, also baked into the app).
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."
FAMILY_CODE=$(grep '^FAMILY_CODE=' .env | cut -d= -f2-)
P=project-11b9fc8a-1108-4ea8-a3b
N=379797517579

gcloud functions deploy edible-upload \
  --gen2 --project=$P --region=us-west1 --runtime=python313 \
  --source=cloud/signer --entry-point=create_upload --trigger-http --allow-unauthenticated \
  --service-account=edible-signer@$P.iam.gserviceaccount.com \
  --memory=256Mi --max-instances=3 --timeout=30s \
  --set-env-vars="MEDIA_BUCKET=edible-media-$N,UPLOAD_BUCKET=edible-uploads-$N,FAMILY_CODE=$FAMILY_CODE"

gcloud functions describe edible-upload --project=$P --region=us-west1 --format="value(serviceConfig.uri)"
