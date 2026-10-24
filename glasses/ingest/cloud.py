"""The two services the VM talks to: Convex's /glasses/* routes and the GCS uploads bucket (JSON API).
Blocking calls; server.py runs them in a thread."""
from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"


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


def access_token() -> str:
    """The VM's service account (metadata server); on a laptop, your own gcloud login."""
    try:
        req = urllib.request.Request(METADATA_TOKEN, headers={"Metadata-Flavor": "Google"})
        with urllib.request.urlopen(req, timeout=2) as res:
            return json.loads(res.read())["access_token"]
    except (urllib.error.URLError, OSError):
        return subprocess.run(["gcloud", "auth", "print-access-token"], check=True, capture_output=True,
                              text=True).stdout.strip()


def upload(bucket: str, name: str, file: Path) -> str:
    """Resumable upload, only if the object doesn't exist yet (objectCreator can't overwrite).
    Returns "uploaded" or "already there"."""
    token = access_token()
    q = urllib.parse.urlencode({"uploadType": "resumable", "name": name, "ifGenerationMatch": "0"})
    start = urllib.request.Request(
        f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?{q}", data=b"{}", method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "X-Upload-Content-Type": "video/mp4"},
    )
    try:
        with urllib.request.urlopen(start, timeout=30) as res:
            session = res.headers["Location"]
        size = file.stat().st_size
        with file.open("rb") as f:
            put = urllib.request.Request(session, data=f, method="PUT",
                                         headers={"Content-Length": str(size), "Content-Type": "video/mp4"})
            with urllib.request.urlopen(put, timeout=1800) as res:
                res.read()
        return "uploaded"
    except urllib.error.HTTPError as e:
        if e.code == 412:
            return "already there"
        raise RuntimeError(f"GCS upload failed: {e.code} {e.read().decode(errors='replace')[:300]}") from None
