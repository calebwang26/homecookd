#!/bin/bash
# Create or update the glasses ingest VM (glasses/INGEST.md). Safe to run again: it creates only what's
# missing, then pushes the current glasses/ingest code and restarts the VM.
#
#   glasses/vm/setup.sh --dry-run    # print every gcloud command (secrets masked), run nothing
#   glasses/vm/setup.sh
#
# GLASSES_SECRET, GLASSES_DEVICE_KEY, CONVEX_SITE_URL, GCS_UPLOAD_BUCKET and GCP_PROJECT come from the
# environment or the root .env. They go into the VM's metadata (project members can read it), never into git.
#
# Cost: one e2-micro with a 30 GB standard disk in us-west1 (Oregon) is in the Compute Engine Free Tier
# (so are us-central1 and us-east1). The external IPv4 address the glasses connect to may cost ~$0.005/h
# (~$3.60 a month); release it when the hackathon is over. Uploads to a bucket in the same region are free.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

ENV_FILE=$(git rev-parse --show-toplevel)/.env
[ -f "$ENV_FILE" ] || ENV_FILE=$(git rev-parse --path-format=absolute --git-common-dir)/../.env
fromenv() { [ -f "$ENV_FILE" ] && grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
for K in GLASSES_SECRET GLASSES_DEVICE_KEY CONVEX_SITE_URL GCS_UPLOAD_BUCKET GCP_PROJECT; do
  [ -n "${!K:-}" ] || export "$K=$(fromenv $K)"
  if [ -z "${!K}" ]; then
    [ $DRY = 1 ] || { echo "missing $K (set it or add it to .env)"; exit 1; }
    export "$K=<$K>"
  fi
done

P=$GCP_PROJECT
REGION=us-west1
ZONE=us-west1-b
VM=glasses-ingest
SA=glasses-ingest@$P.iam.gserviceaccount.com

mask() {
  local s="$*"
  s=${s//"$GLASSES_SECRET"/<GLASSES_SECRET>}
  echo "${s//"$GLASSES_DEVICE_KEY"/<GLASSES_DEVICE_KEY>}"
}
run() { if [ $DRY = 1 ]; then echo "+ $(mask "$@")"; else "$@"; fi; }
exists() { [ $DRY = 0 ] && "$@" >/dev/null 2>&1; }

TGZ=$(mktemp)
trap 'rm -f "$TGZ"' EXIT
COPYFILE_DISABLE=1 tar czf - --exclude __pycache__ ingest | base64 > "$TGZ"
FILES="startup-script=vm/startup.sh,glasses-ingest-tgz=$TGZ"
META="glasses-secret=$GLASSES_SECRET,glasses-device-key=$GLASSES_DEVICE_KEY,convex-site-url=$CONVEX_SITE_URL,gcs-upload-bucket=$GCS_UPLOAD_BUCKET"

run gcloud services enable compute.googleapis.com --project "$P"

exists gcloud iam service-accounts describe "$SA" --project "$P" ||
  run gcloud iam service-accounts create glasses-ingest --project "$P" --display-name "homecookd glasses VM"
# It may only add new objects to the uploads bucket: no reads, no overwrites, nothing else in the project.
run gcloud storage buckets add-iam-policy-binding "gs://$GCS_UPLOAD_BUCKET" \
  --member "serviceAccount:$SA" --role roles/storage.objectCreator

exists gcloud compute firewall-rules describe glasses-ingest --project "$P" ||
  run gcloud compute firewall-rules create glasses-ingest --project "$P" --network default \
    --allow tcp:8090 --target-tags glasses-ingest --source-ranges 0.0.0.0/0

# A reserved address, so the URL in the firmware survives a VM stop/start.
exists gcloud compute addresses describe glasses-ingest --project "$P" --region $REGION ||
  run gcloud compute addresses create glasses-ingest --project "$P" --region $REGION

if exists gcloud compute instances describe $VM --project "$P" --zone $ZONE; then
  run gcloud compute instances add-metadata $VM --project "$P" --zone $ZONE \
    --metadata-from-file "$FILES" --metadata "$META"
  # The startup script runs again on boot. Don't do this in the middle of a recording.
  run gcloud compute instances reset $VM --project "$P" --zone $ZONE
else
  run gcloud compute instances create $VM --project "$P" --zone $ZONE \
    --machine-type e2-micro --image-family debian-12 --image-project debian-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-standard \
    --tags glasses-ingest --address glasses-ingest \
    --service-account "$SA" --scopes storage-rw \
    --metadata-from-file "$FILES" --metadata "$META"
fi

IP="<VM_IP>"
[ $DRY = 1 ] || IP=$(gcloud compute addresses describe glasses-ingest --project "$P" --region $REGION --format 'value(address)')
echo
echo "VM: http://$IP:8090/health   (the first boot takes a few minutes to install ffmpeg)"
echo "firmware: ws://$IP:8090/ingest?device=<GLASSES_DEVICE_KEY from .env>"
echo "voice service: GLASSES_URL=http://$IP:8090"
echo "logs: gcloud compute ssh $VM --project $P --zone $ZONE --command 'journalctl -u glasses -f'"
