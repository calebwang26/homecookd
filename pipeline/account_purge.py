"""Purge a deleted account outside Convex (docs/build/STACK.md, "Account deletion").

Convex's account.deleteMe deletes everything of theirs in Convex and leaves an accountDeletions row listing what
lives elsewhere. The worker (run_convex, at most every PURGE_EVERY_S) takes each row whose Convex purge has
finished from POST /worker/deletions/next and deletes, for real (no trash/), each part idempotent:
  1. GCS: every object in her upload folders; her recipe folders in the media bucket (the one the worker names
     after each of her jobs, and any holding one of her recipe.json files) with their trash/ copies; the
     signer's jobs/<id>.json; the objects her mediaUrls name in our two buckets; our copies on this machine.
  2. Supabase (SUPABASE_REF): her voice notes and photos through the Storage API, then her rows in one SQL
     statement (purge_sql). Skipped when she has no Supabase profile (a seeded or test person).
  3. Cartesia: her voice clone (404 = already gone).
Then it reports to /worker/deletions/done: ok with what it deleted, or short reasons without secrets; Convex
offers the row again later and gives up after 10 failures.

    python pipeline/worker.py --purge-dry-run   # what each pending deletion would delete; deletes nothing

Keys from the root .env, never printed: SUPABASE_ACCESS_TOKEN (the management API runs the SQL and hands over
the service role key for the Storage API, kept in memory only) and CARTESIA_API_KEY.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import json
import os
import re
import shutil
import sys
import traceback
from collections.abc import Callable
from pathlib import Path
from urllib.parse import unquote, urlsplit

import requests
from google.api_core.exceptions import NotFound
from google.cloud import storage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish  # noqa: E402

SUPABASE_REF = "bsudybxsqvtwftsdmwmz"
SUPABASE_API = "https://api.supabase.com/v1/projects"
CARTESIA = "https://api.cartesia.ai"
CARTESIA_VERSION = "2026-08-14"
INPUT = publish.ROOT / "input" / "uploads"  # worker.INPUT: where the worker downloads a job's videos
FOLDER = re.compile(r"[a-z0-9][a-z0-9-]{0,99}")  # worker.RECIPE_ID: an upload or recipe folder
RESERVED = {"jobs", "trash", "cancellations", "deletions"}  # the media bucket's own folders: never hers
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
STORAGE_PATH = re.compile(r"[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,200}")  # <family_id>/<uuid>.<ext>, as the api writes
VOICE_ID = re.compile(r"[A-Za-z0-9_-]{1,100}")
MAX_PER_PASS = 20


class PurgeError(Exception):
    """A part that can't be done; its message goes to Convex as it is, so it never holds a key."""


# ---------- GCS ----------

def _folder(name: str) -> bool:
    return bool(FOLDER.fullmatch(name)) and name not in RESERVED


def upload_targets(d: dict) -> tuple[list[str], list[str]]:
    """Her raw videos in the uploads bucket: (folders, objects). Each path is one object, and a one-segment
    folder ("<id>/", from the signer or the glasses VM) is everything in it too. A deeper or odd path is never
    widened to a folder: it could hold someone else's files."""
    folders, objects = set(), set()
    for raw in d["uploadPaths"]:
        path = raw.strip().strip("/")
        if not path or ".." in path:
            continue
        objects.add(path)
        if "/" not in path and _folder(path):
            folders.add(path)
    return sorted(folders), sorted(objects)


def media_objects(d: dict, buckets: set[str]) -> list[tuple[str, str]]:
    """(bucket, path) of each of her mediaUrls that names a file in one of our buckets; others are skipped."""
    found = set()
    for url in d["mediaUrls"]:
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.netloc != "storage.googleapis.com":
            continue
        bucket, _, path = unquote(parts.path).lstrip("/").partition("/")
        if bucket in buckets and path and not path.endswith("/") and ".." not in path and path != "library.json":
            found.add((bucket, path))
    return sorted(found)


def recipe_folders(d: dict, media_bucket: str) -> list[str]:
    """Her recipes' folders in the media bucket: the worker's name for each of her jobs
    (worker._convex_recipe_id), and any folder holding one of her recipe.json files."""
    names = set()
    for job_id in d["jobIds"]:
        tail = re.sub(r"[^a-z0-9]", "", job_id.lower())[-12:]
        if len(tail) >= 8:
            names.add(f"recipe-{tail}")
    for _, path in media_objects(d, {media_bucket}):
        folder, _, file = path.partition("/")
        if file == "recipe.json" and _folder(folder):
            names.add(folder)
    return sorted(names)


def gcs_targets(d: dict, media: storage.Bucket, uploads: storage.Bucket) -> list[tuple[storage.Bucket, storage.Blob]]:
    """Every object of hers in our buckets, once each."""
    found: dict[tuple[str, str], tuple[storage.Bucket, storage.Blob]] = {}

    def add(bucket: storage.Bucket, blobs) -> None:
        for b in blobs:
            if b is not None:
                found[(bucket.name, b.name)] = (bucket, b)

    folders, objects = upload_targets(d)
    for f in folders:
        add(uploads, uploads.client.list_blobs(uploads, prefix=f"{f}/"))
        add(media, [media.get_blob(f"jobs/{f}.json")])  # the signer's status file: her name and the dish
    add(uploads, [uploads.get_blob(o) for o in objects])
    for f in recipe_folders(d, media.name):
        add(media, media.client.list_blobs(media, prefix=f"{f}/"))
        add(media, media.client.list_blobs(media, prefix=f"trash/{f}/"))
    buckets = {media.name: media, uploads.name: uploads}
    for name, path in media_objects(d, set(buckets)):
        add(buckets[name], [buckets[name].get_blob(path)])
    return [found[k] for k in sorted(found)]


def _library_ids(media: storage.Bucket) -> set[str]:
    try:
        return {str(e.get("id")) for e in json.loads(media.blob("library.json").download_as_text())}
    except NotFound:
        return set()


def local_copies(d: dict, media_bucket: str) -> list[Path]:
    """This machine's copies: the downloaded videos (worker.INPUT) and the pipeline's work (data/out)."""
    names = set(recipe_folders(d, media_bucket)) | set(upload_targets(d)[0])
    return [p for n in sorted(names) for p in (INPUT / n, publish.OUT / n) if p.exists()]


def _drop_local(path: Path) -> None:
    """Deletes the folder but its work/usage.json: spent_usd counts it toward MAX_SPEND_USD."""
    usage = path / "work" / "usage.json"
    keep = usage.read_bytes() if usage.is_file() else None
    shutil.rmtree(path, ignore_errors=True)
    if keep is not None:
        usage.parent.mkdir(parents=True, exist_ok=True)
        usage.write_bytes(keep)


def purge_gcs(d: dict, media: storage.Bucket, uploads: storage.Bucket, dry_run: bool) -> dict:
    targets = gcs_targets(d, media, uploads)
    public = sorted(set(recipe_folders(d, media.name)) & _library_ids(media))
    local = local_copies(d, media.name)
    verb = "would delete" if dry_run else "deleting"
    for bucket, blob in targets:
        print(f"  gcs: {verb} gs://{bucket.name}/{blob.name}")
    for path in local:
        print(f"  local: {verb} {path.relative_to(publish.ROOT) if path.is_relative_to(publish.ROOT) else path}")
    if public:
        print(f"  gcs: library.json lists {', '.join(public)}; {'would rebuild' if dry_run else 'rebuilding'} it")
    if not dry_run:
        for _, blob in targets:
            with contextlib.suppress(NotFound):  # already gone: a second run, or the 14-day lifecycle rule
                blob.delete()
        if public:
            publish.rebuild_library(media)
        for path in local:
            _drop_local(path)
    return {"gcsObjects": len(targets), "localFolders": len(local)}


# ---------- Supabase ----------

# Her rows (supabase/migrations/), in this order: (table, "set ..." or None to delete, where). {p} is her profile
# id, {pairs} her 1:1 threads and {doomed} the messages that go: hers, and every message in those threads. A 1:1
# can't outlive her (threads_shape_check needs both people on a 'pair'; its FK cascades), so the other person's
# half goes with it. Her question's text leaves the notes that answered it; the answer stays.
ROWS: list[tuple[str, str | None, str]] = [
    ("messages", "reply_to = null", "reply_to = any({doomed})"),
    ("recipe_notes", "question_message_id = null", "question_message_id = any({doomed})"),
    ("recipe_notes", None, "answer_message_id = any({doomed}) or answered_by = {p}"),
    ("recipe_notes", "asked_by = null, question = null", "asked_by = {p}"),
    ("messages", None, "id = any({doomed})"),
    ("thread_reads", None, "profile_id = {p} or thread_id = any({pairs})"),
    ("threads", None, "id = any({pairs})"),
    ("push_tokens", None, "profile_id = {p}"),
    ("notification_log", None, "profile_id = {p}"),
    ("cooking_now", None, "profile_id = {p}"),
    ("cooking_now", "cook_id = null", "cook_id = {p}"),
    ("recipe_events", None, "profile_id = {p}"),
    ("recipe_events", "cook_id = null", "cook_id = {p}"),
    ("favorites", None, "profile_id = {p}"),
    ("identities", None, "profile_id = {p}"),  # frees her Apple/Google sign-in
    ("move_requests", None, "profile_id = {p}"),
    ("move_requests", "decided_by = null", "decided_by = {p}"),
    ("pending_sends", None, "sender_id = {p}"),
    ("pending_sends", "recipient_ids = array_remove(recipient_ids, {p})", "{p} = any(recipient_ids)"),
    ("invites", None, "profile_id = {p}"),
    ("invites", "inviter_id = null", "inviter_id = {p}"),
    ("shares", "sender_id = null", "sender_id = {p}"),
    ("devices", "profile_id = null, revoked_at = coalesce(revoked_at, now())", "profile_id = {p}"),
    ("profiles", None, "id = {p}"),
]
PAIRS = "select id from public.threads where kind = 'pair' and {p} in (a_profile, b_profile)"
DOOMED = "select id from public.messages where sender_id = {p} or thread_id = any({pairs})"
VOICE_FILES = (
    "select audio_path from public.messages where id = any({doomed}) and audio_path is not null"
    " union select answer_audio_path from public.recipe_notes"
    " where (answer_message_id = any({doomed}) or answered_by = {p}) and answer_audio_path is not null"
    " union select hello_path from public.pending_sends where sender_id = {p} and hello_path is not null"
)
PHOTO_FILES = "select photo_path from public.messages where id = any({doomed}) and photo_path is not null"
ELSEWHERE = "exists (select 1 from public.profiles where id = {p} and family_id <> {f})"


def sql_uuid(value: str) -> str:
    """A uuid as a SQL literal. The management API's DO block takes no bind parameters, so nothing else is ever
    put into the SQL."""
    v = (value or "").strip().lower()
    if not UUID.fullmatch(v):
        raise ValueError("not a uuid")
    return f"'{v}'::uuid"


def row_label(table: str, change: str | None) -> str:
    return table if change is None else f"{table}.{change.split()[0]}"


def plan_sql(profile_id: str, family_id: str) -> str:
    """Read-only: how many rows each step of purge_sql touches, her files in Storage, and whether the profile
    sits in another family (then nothing is done)."""
    p, f = sql_uuid(profile_id), sql_uuid(family_id)
    pairs = f"array({PAIRS.format(p=p)})"
    doomed = f"array({DOOMED.format(p=p, pairs=pairs)})"
    counts = ", ".join(
        f"'{row_label(t, s)}', (select count(*) from public.{t} where {w.format(p=p, pairs=pairs, doomed=doomed)})"
        for t, s, w in ROWS
    )
    return (
        f"select json_build_object('counts', json_build_object({counts}),"
        f" 'voice', array({VOICE_FILES.format(p=p, doomed=doomed)}),"
        f" 'photos', array({PHOTO_FILES.format(doomed=doomed)}),"
        f" 'elsewhere', {ELSEWHERE.format(p=p, f=f)}) as plan"
    )


def purge_sql(profile_id: str, family_id: str) -> str:
    """Her rows, all or nothing: one DO block is one statement. Running it again finds nothing to do."""
    p, f = sql_uuid(profile_id), sql_uuid(family_id)
    steps = "\n".join(
        f"  {'update' if s else 'delete from'} public.{t}{f' set {s.format(p=p)}' if s else ''}"
        f" where {w.format(p=p, pairs='v_pairs', doomed='v_doomed')};"
        for t, s, w in ROWS
    )
    return (
        "do $purge$\ndeclare\n"
        f"  v_pairs uuid[] := array({PAIRS.format(p=p)});\n"
        f"  v_doomed uuid[] := array({DOOMED.format(p=p, pairs='v_pairs')});\n"
        "begin\n"
        f"  if {ELSEWHERE.format(p=p, f=f)} then\n"
        "    raise exception 'this profile is in another family';\n"
        "  end if;\n"
        f"{steps}\nend\n$purge$;"
    )


class Supabase:
    """The management API (SQL) and, with the service role key it hands over, the Storage API."""

    def __init__(self, token: str, ref: str = SUPABASE_REF, http=requests):
        self.ref, self.http = ref, http
        self.auth = {"Authorization": f"Bearer {token}"}
        self.secrets = [token]
        self._storage_headers: dict[str, str] | None = None

    def sql(self, query: str, read_only: bool = False) -> list[dict]:
        res = self.http.post(f"{SUPABASE_API}/{self.ref}/database/query", headers=self.auth,
                             json={"query": query, "read_only": read_only}, timeout=120)
        if res.status_code >= 400:
            raise PurgeError(f"Supabase SQL: HTTP {res.status_code} {res.text[:200]}")
        return res.json()

    def plan(self, profile_id: str, family_id: str) -> dict:
        rows = self.sql(plan_sql(profile_id, family_id), read_only=True)
        plan = rows[0]["plan"]
        return json.loads(plan) if isinstance(plan, str) else plan

    def _storage(self) -> dict[str, str]:
        if self._storage_headers is None:
            res = self.http.get(f"{SUPABASE_API}/{self.ref}/api-keys", params={"reveal": "true"},
                                headers=self.auth, timeout=30)
            if res.status_code >= 400:
                raise PurgeError(f"Supabase API keys: HTTP {res.status_code}")
            keys = [k for k in res.json() if k.get("api_key")]
            legacy = next((k["api_key"] for k in keys if k.get("name") == "service_role"), None)
            secret = next((k["api_key"] for k in keys if k.get("type") == "secret"), None)
            if not (legacy or secret):
                raise PurgeError("Supabase has no service role key")
            self.secrets.append(legacy or secret)
            # A legacy key is a JWT and goes in both headers; a new secret key only as apikey.
            self._storage_headers = {"apikey": legacy, "Authorization": f"Bearer {legacy}"} if legacy else {"apikey": secret}
        return self._storage_headers

    def delete_files(self, bucket: str, paths: list[str]) -> int:
        """Deletes these objects; one already gone is skipped. Returns how many were deleted."""
        gone = 0
        for i in range(0, len(paths), 100):
            res = self.http.delete(f"https://{self.ref}.supabase.co/storage/v1/object/{bucket}",
                                   headers=self._storage(), json={"prefixes": paths[i:i + 100]}, timeout=60)
            if res.status_code >= 400:
                raise PurgeError(f"Supabase Storage {bucket}: HTTP {res.status_code} {res.text[:200]}")
            gone += len(res.json() or [])
        return gone


def purge_supabase(d: dict, supabase: Supabase | None, dry_run: bool) -> dict:
    pid = (d.get("supabaseProfileId") or "").strip().lower()
    if not UUID.fullmatch(pid):
        print(f"  supabase: skipped ({'no profile' if not pid else 'not a Supabase profile id'})")
        return {}
    if supabase is None:
        raise PurgeError("SUPABASE_ACCESS_TOKEN is not set")
    fid = (d.get("supabaseFamilyId") or "").strip().lower()
    if not UUID.fullmatch(fid):
        raise PurgeError("the family's Supabase id is not a uuid")
    plan = supabase.plan(pid, fid)
    if plan["elsewhere"]:
        raise PurgeError("the Supabase profile is in another family; nothing deleted")
    files = {}
    for bucket in ("voice", "photos"):
        paths = sorted(set(plan[bucket] or []))
        odd = [x for x in paths if not STORAGE_PATH.fullmatch(x) or ".." in x]
        if odd:
            print(f"  supabase: left {len(odd)} {bucket} path(s) that aren't the api's shape")
        files[bucket] = [x for x in paths if x not in odd]
    touched = {k: n for k, n in plan["counts"].items() if n}
    verb = "would" if dry_run else "will"
    print(f"  supabase: {verb} delete {sum(map(len, files.values()))} file(s) "
          f"({', '.join(f'{b} {len(p)}' for b, p in files.items())}) and change rows: "
          f"{', '.join(f'{k} {n}' for k, n in touched.items()) or 'none'}")
    counts = {
        "supabaseRows": sum(n for k, n in touched.items() if "." not in k),
        "supabaseUpdated": sum(n for k, n in touched.items() if "." in k),
        "supabaseFiles": sum(map(len, files.values())),
    }
    if not dry_run:
        # Files first: once the rows are gone, nothing says where they were.
        counts["supabaseFiles"] = sum(supabase.delete_files(b, paths) for b, paths in files.items() if paths)
        supabase.sql(purge_sql(pid, fid))
    return counts


# ---------- Cartesia ----------

def purge_voice(d: dict, key: str | None, dry_run: bool, http=requests) -> dict:
    voice_id = d.get("voiceCloneId")
    if not voice_id:
        return {}
    if not VOICE_ID.fullmatch(voice_id):
        raise PurgeError("the voice clone id isn't a Cartesia id")
    if dry_run:
        print("  cartesia: would delete her voice clone")
        return {"voiceClones": 1}
    if not key:
        raise PurgeError("CARTESIA_API_KEY is not set")
    res = http.delete(f"{CARTESIA}/voices/{voice_id}", timeout=30,
                      headers={"Authorization": f"Bearer {key}", "Cartesia-Version": CARTESIA_VERSION})
    if res.status_code == 404:
        print("  cartesia: her voice clone was already gone")
        return {"voiceClones": 0}
    if res.status_code >= 400:
        raise PurgeError(f"Cartesia: HTTP {res.status_code} {res.text[:120]}")
    print("  cartesia: deleted her voice clone")
    return {"voiceClones": 1}


# ---------- one pass ----------

def scrub(text: str, secrets: list[str]) -> str:
    for s in secrets:
        if s:
            text = text.replace(s, "***")
    return text


def purge_one(d: dict, media: storage.Bucket, uploads: storage.Bucket, supabase: Supabase | None,
              cartesia_key: str | None, dry_run: bool, http=requests) -> tuple[dict, list[str]]:
    """Every part, even after one fails (each deletes what it can); returns (counts, reasons it failed)."""
    parts: list[tuple[str, Callable[[], dict]]] = [
        ("GCS", lambda: purge_gcs(d, media, uploads, dry_run)),
        ("Supabase", lambda: purge_supabase(d, supabase, dry_run)),
        ("Cartesia", lambda: purge_voice(d, cartesia_key, dry_run, http)),
    ]
    secrets = [cartesia_key or ""] + (supabase.secrets if supabase else [])
    counts, errors = {}, []
    for name, part in parts:
        try:
            counts.update(part())
        except Exception as e:  # noqa: BLE001 - one part's failure is reported; the others still run
            if not isinstance(e, PurgeError):
                print(scrub(traceback.format_exc(), secrets), end="")
            why = str(e) if isinstance(e, PurgeError) else f"{type(e).__name__}: {e}"
            errors.append(f"{name}: {scrub(why, secrets)[:200]}")
            print(f"  {errors[-1]}")
    return counts, errors


def run_pending(convex, media: storage.Bucket, uploads: storage.Bucket, dry_run: bool = False, http=requests) -> int:
    """Purges each deletion Convex offers (worker.Convex.next_deletion), at most MAX_PER_PASS; returns how many."""
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    supabase = Supabase(token, http=http) if token else None
    cartesia_key = os.environ.get("CARTESIA_API_KEY")
    seen: list[str] = []
    while len(seen) < MAX_PER_PASS:
        d = convex.next_deletion(seen)
        if not d:
            break
        seen.append(d["deletionId"])
        asked = dt.datetime.fromtimestamp(d["requestedAt"] / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        print(f"account purge {d['deletionId']} (asked {asked}, try {d.get('attempts', 0) + 1})"
              f"{': DRY RUN, nothing is deleted' if dry_run else ''}", flush=True)
        counts, errors = purge_one(d, media, uploads, supabase, cartesia_key, dry_run, http)
        if dry_run:
            print(f"  would report: {'ok' if not errors else 'failed'} {json.dumps(counts)}", flush=True)
            continue
        status = convex.deletion_done(d["deletionId"], not errors, "; ".join(errors)[:500] or None, counts)
        print(f"  {'done' if not errors else 'failed'} ({status}): {json.dumps(counts)}", flush=True)
    if dry_run and not seen:
        print("account purge: nothing pending")
    return len(seen)
