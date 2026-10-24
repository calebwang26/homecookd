"""homecookd upload signer (Cloud Run function).

POST JSON {title, cook_name, relation, files: [{name, content_type, size, duration_s}]}
with the phone's Convex session (Authorization: Bearer <sessionToken>, checked against Convex) or,
from older builds, the shared X-Edible-Family code. Returns V4 signed PUT URLs into the private uploads bucket
and writes a public jobs/<job_id>.json status file the app polls. No key files: URLs are
signed through the IAM signBlob API as this function's own service account.
"""
import datetime as dt
import hmac
import json
import os
import re
import urllib.error
import urllib.request
import uuid

import functions_framework
import google.auth
from google.auth.transport import requests as grequests
from google.api_core import exceptions as gexc
from google.cloud import storage

MEDIA_BUCKET = os.environ["MEDIA_BUCKET"]
UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]
FAMILY_CODE = os.environ.get("FAMILY_CODE", "")  # older builds only; empty turns that path off
CONVEX_URL = os.environ.get("CONVEX_URL", "https://grand-dragon-649.convex.cloud").rstrip("/")
MAX_FILES = 20
MAX_FILE_BYTES = 20 * 1024**3  # 20 GB; a 3-hour iPhone recording is ~10 GB
MAX_HOURS = 4  # same cap as pipeline/worker.py; reject before the phone uploads GBs for nothing
URL_TTL = dt.timedelta(days=7)  # V4 maximum; background uploads of long videos can take hours

client = storage.Client()
EXT = {"video/quicktime": ".mov", "video/mp4": ".mp4", "video/x-m4v": ".m4v"}
CONTENT_TYPE = re.compile(r"video/[a-z0-9][a-z0-9.+-]{0,60}", re.IGNORECASE)


def _json(body: dict, status: int = 200):
    return (json.dumps(body), status, {"Content-Type": "application/json"})


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "recipe"


def _text(body: dict, key: str, limit: int) -> str:
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{key} is required (max {limit} chars)")
    return value.strip()


def _number(f: dict, key: str, limit: float, message: str) -> float | None:
    """Optional non-negative number (bools are rejected even though they're ints in Python)."""
    value = f.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= limit:
        raise ValueError(message)
    return value


class ConvexDown(Exception):
    pass


TROUBLE = "The service is having trouble. Please try again in a minute."


def _convex_query(path: str, args: dict):
    """A public Convex query's value, or None if Convex refuses (e.g. a signed-out session). Raises
    ConvexDown when Convex can't be reached, so a blip isn't reported as "signed out"."""
    req = urllib.request.Request(
        f"{CONVEX_URL}/api/query", method="POST", headers={"Content-Type": "application/json"},
        data=json.dumps({"path": path, "args": args, "format": "json"}).encode())
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            body = json.load(res)
    except urllib.error.HTTPError as e:
        if 400 <= e.code < 500:
            return None
        raise ConvexDown(f"HTTP {e.code}") from None
    except (OSError, ValueError) as e:
        raise ConvexDown(type(e).__name__) from None
    return body.get("value") if isinstance(body, dict) and body.get("status") == "success" else None


def _caller(request):
    """(error, token): error is the JSON answer when the caller may not use the signer. token is the
    Convex session for a signed-in phone, None for a family-code caller."""
    code = request.headers.get("X-Edible-Family", "")
    if FAMILY_CODE and code and hmac.compare_digest(code.encode(), FAMILY_CODE.encode()):
        return None, None
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth[:7].lower() == "bearer " else ""
    if not token:
        return _json({"error": "unknown family"}, 403), None
    if not 20 <= len(token) <= 200:
        return _json({"error": "Please sign in again."}, 401), None
    try:
        me = _convex_query("people:me", {"sessionToken": token})
    except ConvexDown as e:
        print(f"session check failed: {e}")  # never the token
        return _json({"error": TROUBLE}, 502), None
    if not isinstance(me, dict) or not isinstance(me.get("personId"), str):
        return _json({"error": "Please sign in again."}, 401), None
    print(f"signed in as {me['personId']}")
    return None, token


def _not_theirs(token: str, kind: str, item_id) -> tuple | None:
    """For a signed-in phone: refuse a cancel or delete unless the job or recipe is its family's
    (signer:owns; only a cook may)."""
    if not isinstance(item_id, str):
        return None  # the action itself answers 400
    try:
        owns = _convex_query("signer:owns", {"sessionToken": token, "kind": kind, "id": item_id})
    except ConvexDown as e:
        print(f"ownership check failed: {e}")
        return _json({"error": TROUBLE}, 502)
    return None if owns is True else _json({"error": f"That {kind} isn't yours to change."}, 403)


RECIPE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,99}")


def _request_cancel(body: dict):
    """Leave cancellations/<job_id>.json; the worker stops the job, deletes its raw videos and
    trashes the recipe if it was already published."""
    job_id = body.get("job_id")
    if not isinstance(job_id, str) or not RECIPE_ID.fullmatch(job_id):
        return _json({"error": "job_id is required"}, 400)
    marker = client.bucket(MEDIA_BUCKET).blob(f"cancellations/{job_id}.json")
    marker.cache_control = "no-cache, max-age=0"
    try:
        marker.upload_from_string(
            json.dumps({"job_id": job_id, "requested_at": dt.datetime.now(dt.timezone.utc).isoformat()}),
            content_type="application/json", if_generation_match=0)
    except (gexc.PreconditionFailed, gexc.Forbidden):
        pass  # already requested
    except Exception as e:  # noqa: BLE001
        print(f"cancel request for {job_id} failed: {e}")
        return _json({"error": TROUBLE}, 502)
    return _json({"ok": True, "job_id": job_id})


def _request_delete(body: dict):
    """Leave deletions/<id>.json for the worker, which moves the recipe to trash/. This function's
    account can only create objects, so it can never delete anything itself."""
    recipe_id = body.get("recipe_id")
    if not isinstance(recipe_id, str) or not RECIPE_ID.fullmatch(recipe_id):
        return _json({"error": "recipe_id is required"}, 400)
    marker = client.bucket(MEDIA_BUCKET).blob(f"deletions/{recipe_id}.json")
    marker.cache_control = "no-cache, max-age=0"
    try:
        marker.upload_from_string(
            json.dumps({"recipe_id": recipe_id, "requested_at": dt.datetime.now(dt.timezone.utc).isoformat()}),
            content_type="application/json", if_generation_match=0)
    except (gexc.PreconditionFailed, gexc.Forbidden):
        pass  # already requested; the worker hasn't picked it up yet
    except Exception as e:  # noqa: BLE001
        print(f"delete request for {recipe_id} failed: {e}")
        return _json({"error": TROUBLE}, 502)
    return _json({"ok": True, "recipe_id": recipe_id})


@functions_framework.http
def create_upload(request):
    if request.method != "POST":
        return _json({"error": "POST only"}, 405)
    denied, token = _caller(request)
    if denied:
        return denied
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _json({"error": "send a JSON object"}, 400)
    if body.get("action") == "delete":
        return (token and _not_theirs(token, "recipe", body.get("recipe_id"))) or _request_delete(body)
    if body.get("action") == "cancel":
        return (token and _not_theirs(token, "job", body.get("job_id"))) or _request_cancel(body)
    try:
        title = _text(body, "title", 120)
        cook_name = _text(body, "cook_name", 60)
        relation = _text(body, "relation", 40)
        files = body.get("files")
        if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
            raise ValueError(f"files must be a list of 1..{MAX_FILES}")
        clean, total_s = [], 0.0
        for f in files:
            if not isinstance(f, dict):
                raise ValueError("every file must be an object")
            ct = f.get("content_type")
            if not isinstance(ct, str) or not CONTENT_TYPE.fullmatch(ct):
                raise ValueError("every file must be a video")
            size = _number(f, "size", MAX_FILE_BYTES, "a file is larger than 20 GB (or its size is invalid)")
            duration_s = _number(f, "duration_s", 24 * 3600, "a video's length doesn't look right")
            total_s += duration_s or 0
            name = f.get("name")
            clean.append({"content_type": ct, "size": size, "duration_s": duration_s,
                          "name": name[:200] if isinstance(name, str) else None})
        if total_s > MAX_HOURS * 3600:
            raise ValueError(f"That's more than {MAX_HOURS} hours of video. Please pick fewer videos.")
    except ValueError as e:
        return _json({"error": str(e)}, 400)

    job_id = f"{_slug(title)}-{uuid.uuid4().hex[:6]}"
    try:
        creds, _ = google.auth.default()
        creds.refresh(grequests.Request())

        uploads, job_files = [], []
        for i, f in enumerate(clean, start=1):
            ct = f["content_type"]
            obj = f"{job_id}/{i:02d}{EXT.get(ct, '.mov')}"
            url = client.bucket(UPLOAD_BUCKET).blob(obj).generate_signed_url(
                version="v4", expiration=URL_TTL, method="PUT", content_type=ct,
                service_account_email=creds.service_account_email, access_token=creds.token,
            )
            uploads.append({"index": i, "url": url, "method": "PUT", "headers": {"Content-Type": ct}})
            job_files.append({"index": i, "object": obj, **f})

        now = dt.datetime.now(dt.timezone.utc).isoformat()
        job = {"id": job_id, "title": title, "cook_name": cook_name, "relation": relation,
               "status": "uploading", "created_at": now, "updated_at": now,
               "files_expected": len(clean), "files_received": 0, "recipe_id": None, "message": None,
               "files": job_files}
        blob = client.bucket(MEDIA_BUCKET).blob(f"jobs/{job_id}.json")
        blob.cache_control = "no-cache, max-age=0"
        blob.upload_from_string(json.dumps(job), content_type="application/json")
    except Exception as e:  # noqa: BLE001 - signing or the status write failed; answer JSON, not an HTML 500
        print(f"create_upload failed for {job_id}: {type(e).__name__}: {e}")
        return _json({"error": "The upload service is having trouble. Please try again in a minute."}, 502)

    status_url = f"https://storage.googleapis.com/{MEDIA_BUCKET}/jobs/{job_id}.json"
    return _json({"job_id": job_id, "status_url": status_url, "uploads": uploads})
