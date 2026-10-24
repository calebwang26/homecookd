#!/bin/bash
# One-time IAM grants for homecookd's upload signer. Least privilege:
#   1. edible-signer may CREATE (not read/delete) objects in the private uploads bucket,
#      so the signed URLs it hands the phone can only upload new files.
#   2. edible-signer may CREATE objects in the media bucket (only jobs/<id>.json status files).
#   3. edible-signer may sign blobs as itself (V4 signed URLs without any key file).
#   4. The default compute service account may run Cloud Build (needed to deploy a 2nd-gen function).
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
P=project-11b9fc8a-1108-4ea8-a3b
N=379797517579
SA=edible-signer@$P.iam.gserviceaccount.com

gcloud storage buckets add-iam-policy-binding gs://edible-uploads-$N \
  --member=serviceAccount:$SA --role=roles/storage.objectCreator >/dev/null
gcloud storage buckets add-iam-policy-binding gs://edible-media-$N \
  --member=serviceAccount:$SA --role=roles/storage.objectCreator >/dev/null
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountTokenCreator >/dev/null
gcloud projects add-iam-policy-binding $P \
  --member=serviceAccount:$N-compute@developer.gserviceaccount.com \
  --role=roles/cloudbuild.builds.builder --condition=None >/dev/null
# 5. Public can GET a media file by its URL but cannot list the bucket's contents.
gcloud storage buckets remove-iam-policy-binding gs://edible-media-$N \
  --member=allUsers --role=roles/storage.objectViewer >/dev/null 2>&1 || true
gcloud storage buckets add-iam-policy-binding gs://edible-media-$N \
  --member=allUsers --role=roles/storage.legacyObjectReader >/dev/null
echo "IAM grants done."
