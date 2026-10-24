# The pipeline worker as a container, for a Cloud Run job (docs/build/STACK.md, "Changes from the PDF" 1).
#   docker build -t homecookd-worker pipeline/
#   docker run --env-file .env -v ~/.config/gcloud:/root/.config/gcloud homecookd-worker --once
# On Cloud Run the service account reaches the GCS buckets; pass GEMINI_API_KEY, MUSE_API_KEY, WORKER_SECRET
# and CONVEX_SITE_URL (plus GCS_MEDIA_BUCKET, GCS_UPLOAD_BUCKET, GCP_PROJECT) as env vars or secrets.
# With no args it polls Convex forever; a scheduled job run uses --once (one job, then exit).
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt pipeline/requirements.txt
RUN pip install --no-cache-dir -r pipeline/requirements.txt
COPY . pipeline/

ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "pipeline/worker.py"]
