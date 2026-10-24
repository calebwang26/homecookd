"""The two cloud services the receiver talks to with --cloud: homecookd's Convex /glasses/* routes and the
GCS uploads bucket (JSON API). Blocking calls; run them in a thread. Same calls as homecookd's
glasses/ingest/cloud.py, so the laptop and the VM behave alike.

Env (put them in edible-glasses/.env or export them):
    CONVEX_SITE_URL     https://<deployment>.convex.site
    GLASSES_SECRET      the x-glasses-secret Convex checks
    GLASSES_URL         ws://<vm-ip>:8090 (the VM's ingest; optional, no live relay without it)
    GLASSES_DEVICE_KEY  the VM's device key
    GCS_UPLOAD_BUCKET   e.g. edible-uploads-379797517579
    GEMINI_API_KEY      for the live analysis
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
TOKEN_TTL_S = 30 * 60  # gcloud tokens last an hour; asking gcloud every upload costs a second each


def load_env(path: Path) -> None:
    """KEY=value lines from a .env file, without overriding what's already exported."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def convex_post(site_url: str, secret: str, path: str, body: dict) -> tuple[int, dict | None]:
    req = urllib.request.Request(
        site_url.rstrip("/") + path, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "x-glasses-secret": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"error": raw.decode(errors="replace")[:200]}


def convex_post_bytes(site_url: str, secret: str, path: str, data: bytes, content_type: str) -> tuple[int, dict | None]:
    """convex_post with a raw body (a JPEG frame) instead of JSON."""
    req = urllib.request.Request(site_url.rstrip("/") + path, data=data, method="POST",
                                 headers={"Content-Type": content_type, "x-glasses-secret": secret})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode(errors="replace")[:200]}


_token: tuple[float, str] | None = None


def access_token() -> str:
    """GOOGLE_ACCESS_TOKEN if set, else the metadata server (on GCP), else your own gcloud login."""
    global _token
    if os.environ.get("GOOGLE_ACCESS_TOKEN"):
        return os.environ["GOOGLE_ACCESS_TOKEN"]
    if _token and time.monotonic() - _token[0] < TOKEN_TTL_S:
        return _token[1]
    try:
        req = urllib.request.Request(METADATA_TOKEN, headers={"Metadata-Flavor": "Google"})
        with urllib.request.urlopen(req, timeout=2) as res:
            token = json.loads(res.read())["access_token"]
    except (urllib.error.URLError, OSError):
        token = subprocess.run(["gcloud", "auth", "print-access-token"], check=True, capture_output=True,
                               text=True).stdout.strip()
    _token = (time.monotonic(), token)
    return token


def gcs_upload(bucket: str, name: str, data: bytes | Path, content_type: str) -> str:
    """Resumable upload, only if the object doesn't exist yet (the uploads bucket can't be overwritten).
    Returns "uploaded" or "already there". GCS_ENDPOINT points it at a fake in tests."""
    base = os.environ.get("GCS_ENDPOINT", "https://storage.googleapis.com")
    q = urllib.parse.urlencode({"uploadType": "resumable", "name": name, "ifGenerationMatch": "0"})
    start = urllib.request.Request(
        f"{base}/upload/storage/v1/b/{bucket}/o?{q}", data=b"{}", method="POST",
        headers={"Authorization": f"Bearer {access_token()}", "Content-Type": "application/json",
                 "X-Upload-Content-Type": content_type},
    )
    try:
        with urllib.request.urlopen(start, timeout=30) as res:
            session = res.headers["Location"]
        if isinstance(data, Path):
            size, body = data.stat().st_size, data.open("rb")
        else:
            size, body = len(data), data
        try:
            put = urllib.request.Request(session, data=body, method="PUT",
                                         headers={"Content-Length": str(size), "Content-Type": content_type})
            with urllib.request.urlopen(put, timeout=1800) as res:
                res.read()
        finally:
            if not isinstance(body, bytes):
                body.close()
        return "uploaded"
    except urllib.error.HTTPError as e:
        if e.code == 412:
            return "already there"
        raise RuntimeError(f"GCS upload of {name} failed: {e.code} {e.read().decode(errors='replace')[:300]}") from None
