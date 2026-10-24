#!/bin/bash
# Runs as root on every boot of the glasses VM (setup.sh gives it as the startup-script). Installs ffmpeg and
# the ingest server from the VM's metadata, writes /etc/glasses.env and (re)starts the systemd unit.
set -euo pipefail
md() { curl -sf -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }

if ! command -v ffmpeg >/dev/null || ! python3 -m venv --help >/dev/null 2>&1; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -yq ffmpeg python3-venv
fi
# An e2-micro has 1 GB of RAM; swap keeps ffmpeg alive on a long recording.
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile; }
  swapon /swapfile
fi

id glasses >/dev/null 2>&1 || useradd --system --home-dir /var/glasses --shell /usr/sbin/nologin glasses
mkdir -p /opt/glasses /var/glasses
chown glasses: /var/glasses
rm -rf /opt/glasses/ingest
md glasses-ingest-tgz | base64 -d | tar xz -C /opt/glasses
[ -x /opt/glasses/venv/bin/python ] || python3 -m venv /opt/glasses/venv
/opt/glasses/venv/bin/pip install -q -r /opt/glasses/ingest/requirements.txt

(umask 077; cat > /etc/glasses.env <<ENV
GLASSES_SECRET=$(md glasses-secret)
GLASSES_DEVICE_KEY=$(md glasses-device-key)
CONVEX_SITE_URL=$(md convex-site-url)
GCS_UPLOAD_BUCKET=$(md gcs-upload-bucket)
ENV
)

cat > /etc/systemd/system/glasses.service <<'UNIT'
[Unit]
Description=homecookd glasses ingest (glasses/INGEST.md)
After=network-online.target
Wants=network-online.target

[Service]
User=glasses
EnvironmentFile=/etc/glasses.env
Environment=PYTHONUNBUFFERED=1
WorkingDirectory=/opt/glasses/ingest
ExecStart=/opt/glasses/venv/bin/python server.py --dir /var/glasses --port 8090
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable glasses
systemctl restart glasses
