# The pipeline worker as a container, for a Cloud Run job (docs/build/STACK.md, "Changes from the PDF" 1).
#   docker build -t homecookd-worker pipeline/
#   docker run --env-file .env -v ~/.config/gcloud:/root/.config/gcloud homecookd-worker --once
# On Cloud Run the service account reaches the GCS buckets; pass GEMINI_API_KEY, MUSE_API_KEY, WORKER_SECRET
# and CONVEX_SITE_URL (plus GCS_MEDIA_BUCKET, GCS_UPLOAD_BUCKET, GCP_PROJECT) as env vars or secrets.
# With no args it polls Convex forever; a scheduled job run uses --once (one job, then exit).
# Queue mode (SQS, Postgres, S3) is a different entry point, chosen by name: --entrypoint python ... pipeline/queue_worker.py
# (docs/build/WORKER-MIGRATION.md). It's never the default.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-queue.txt pipeline/
RUN pip install --no-cache-dir -r pipeline/requirements.txt -r pipeline/requirements-queue.txt
# RDS's certificate authorities, so queue mode's database connection is checked, not only encrypted (as api/Dockerfile).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
RUN chmod 644 /app/rds-ca.pem
COPY . pipeline/

ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "pipeline/worker.py"]
