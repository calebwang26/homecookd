"""Process recipes uploaded from the phone.

    python pipeline/worker.py              # claim jobs from Convex forever (every 15 s)
    python pipeline/worker.py --once       # at most one Convex job, then exit
    python pipeline/worker.py --gcs [--once | --retry <job_id>]   # the pre-hackathon GCS job files (below)
    python pipeline/worker.py --purge-dry-run   # what each deleted account's purge would delete; deletes nothing

Convex (docs/build/STACK.md, "Worker -> Convex"): the app uploads to the GCS uploads bucket and calls
jobs.create. This worker POSTs /worker/claim (204 = nothing queued), runs prep -> process (Gemini watches,
Muse writes) -> publish, reports each stage to /worker/progress (preparing, understanding, writing, or failed
with a message the cook can read) and sends the whole recipe to /worker/published, which saves it and has
Convex index it into Moss. The recipe.json in the public media bucket has no stories or tips (publish.py). Every call carries x-worker-secret. Env: CONVEX_SITE_URL (the deployment's
.convex.site URL; pipeline/convex_stub.py for local tests), WORKER_SECRET. Raw uploads are kept, so a failed
job can be queued again; the uploads bucket's 14-day lifecycle rule deletes them.
Every PURGE_EVERY_S it also purges deleted accounts outside Convex: GCS, Supabase, a Cartesia voice clone
(account_purge.py, through /worker/deletions/*).
The app may create the job while the signer upload is still going. A signer upload ("<job_id>/") lists its
files in jobs/<job_id>.json, the file GCS mode waits on; the worker waits up to UPLOAD_WAIT_S for all of
them, then hands the job back with /worker/release (Convex queues it again 30 s later) and moves on.
The claim also carries the job's title, language and homie's questions (homieLog), which go to process.py,
and for glasses through the laptop bridge the live analysis (liveLog, liveGaps, videoGaps). An in-app recording
may add coverUrl, the cook's photo of her plate: downloaded here, it becomes the recipe's cover (process.py).

GCS mode (--gcs): the phone gets signed URLs from the Cloud Run signer (cloud/signer), uploads videos into the
private uploads bucket in the background, and polls jobs/<job_id>.json in the public media
bucket. This worker finds jobs whose files have all arrived, runs prep -> process -> publish,
updates the job status, and deletes the raw uploads once the recipe is published.

Job states (written by this worker; the signer only creates "uploading"):
  uploading   waiting for the phone's files. Failed if they haven't all arrived once the signed
              upload URLs have expired (nothing can arrive after that).
  processing  being written, OR paused by the spend cap (message says so), OR a previous worker
              died mid-job. Every pass picks these up again; a per-job lock file stops two worker
              processes (e.g. the loop and --retry) from working on the same job at once.
  published / failed   final (--retry restarts a failed job).

TODO: this runs on a laptop today; the roadmap moves it to a server (PRD: "a server pipeline").
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
import re
import shutil
import sys
import time
import traceback
from collections.abc import Iterator
from pathlib import Path

import requests  # comes with google-cloud-storage; uses certifi, unlike this Python's urllib
from dotenv import dotenv_values, load_dotenv
from google.api_core.exceptions import NotFound
from google.cloud import storage
from google.cloud.storage.retry import DEFAULT_RETRY

sys.path.insert(0, str(Path(__file__).resolve().parent))
import account_purge  # noqa: E402
import observability  # noqa: E402
import prep  # noqa: E402
import process  # noqa: E402
import publish  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "input" / "uploads"
LOCKS = INPUT / ".locks"  # never deleted, so a lock file's inode is stable while a job folder comes and goes
MAX_HOURS = 4  # refuse anything longer than a 4-hour recording; protects the Gemini budget
# The signer's PUT URLs live 7 days; after that (+1 day for an upload that started just before expiry)
# no missing file can ever arrive.
UPLOAD_GIVE_UP = dt.timedelta(days=8)
# Conservative Pro cost per hour of video, incl. a retried extraction per file (docs/COSTS.md measures
# ~$1.20-2.10/h). A job only starts if spent + this projection stays under MAX_SPEND_USD.
COST_PER_HOUR_USD = 2.5
# google-cloud-storage resumes an interrupted download from the last byte, but its default retry gives
# up 120 s after the download STARTED, i.e. never for a multi-GB file. Allow resuming for hours.
DOWNLOAD_RETRY = DEFAULT_RETRY.with_timeout(6 * 3600)
DOWNLOAD_TIMEOUT = (30, 600)  # (connect, per-read stall) seconds; not a limit on the whole download
MAX_COVER_BYTES = 20_000_000  # the app sends a ~1080x1920 JPEG; anything this big is not her plate photo

MSG_FAILED = "We couldn't finish this recipe. We'll take a look and try again."
MSG_MISSING = "Some of the videos never finished uploading, so we couldn't write this one. Please try adding them again."
MSG_EMPTY = "One of the videos arrived empty. Please try adding it again."
MSG_TOO_LONG = f"That recording is over {MAX_HOURS} hours. Try splitting it into shorter videos."
MSG_PAUSED = "Recipe writing is paused for a little while. It will start on its own, nothing to do."
MSG_NO_STEPS = "We couldn't find any cooking in this video. Try filming the dish from the first ingredient to the plate."


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _write_job(bucket: storage.Bucket, job: dict) -> None:
    job["updated_at"] = _now()
    blob = bucket.blob(f"jobs/{job['id']}.json")
    blob.cache_control = publish.JSON_CACHE
    blob.upload_from_string(json.dumps(job), content_type="application/json")


def _read_job(bucket: storage.Bucket, job_id: str) -> dict:
    return json.loads(bucket.blob(f"jobs/{job_id}.json").download_as_text())


def _fail(media: storage.Bucket, job: dict, message: str, error: str | None = None) -> None:
    job.update(status="failed", message=message)
    if error:
        job["error"] = error[:500]
    _write_job(media, job)
    print(f"failed {job['id']}: {error or message}")


def notify_published(job_id: str, recipe_id: str) -> None:
    """Tell the homecookd API the recipe is live, so it delivers the pending send (the recipe card and
    the cook's hello) to the people picked on the Send screen. Never fatal: the recipe is already
    published; a missed call only means no message arrives."""
    # EDIBLE_API_URL is the pre-rename name, still read so older .env files keep working.
    api = os.environ.get("HOMECOOKD_API_URL") or os.environ.get("EDIBLE_API_URL")
    code = os.environ.get("FAMILY_CODE")
    if not api or not code:
        print(f"  note: HOMECOOKD_API_URL or FAMILY_CODE not set; {job_id} not announced to the family")
        return
    try:
        res = requests.post(f"{api.rstrip('/')}/jobs/{job_id}/published", json={"recipe_id": recipe_id},
                            headers={"x-family-code": code}, timeout=10)
        if res.ok:
            print(f"  announced {job_id}: delivered to {res.json().get('delivered', 0)}")
        else:
            print(f"  warning: announcing {job_id} failed: HTTP {res.status_code} {res.text[:200]}")
    except Exception as e:  # noqa: BLE001 - network trouble must not fail a published job
        print(f"  warning: announcing {job_id} failed: {type(e).__name__}: {e}")


def spent_usd() -> float:
    total = 0.0
    for usage in (ROOT / "data" / "out").glob("*/work/usage.json"):
        try:
            total += float(json.loads(usage.read_text()).get("estimated_cost_usd", 0))
        except (OSError, ValueError, TypeError):
            print(f"warning: unreadable {usage}")
    return total


def spend_cap() -> float:
    # Read .env on every check so raising MAX_SPEND_USD un-pauses jobs without restarting the worker.
    raw = dotenv_values(ROOT / ".env").get("MAX_SPEND_USD") or os.environ.get("MAX_SPEND_USD") or "15"
    try:
        return float(raw)
    except ValueError:
        print(f"warning: MAX_SPEND_USD={raw!r} is not a number; using $15")
        return 15.0


def _age(job: dict) -> dt.timedelta:
    try:
        created = dt.datetime.fromisoformat(job["created_at"])
    except (KeyError, TypeError, ValueError):
        return dt.timedelta(0)
    if created.tzinfo is None:
        created = created.replace(tzinfo=dt.timezone.utc)
    return dt.datetime.now(dt.timezone.utc) - created


def _reported_seconds(job: dict) -> float:
    """Sum of the phone's durations; tolerates missing or junk values (the phone may not know)."""
    total = 0.0
    for f in job["files"]:
        try:
            total += max(0.0, float(f.get("duration_s") or 0))
        except (TypeError, ValueError):
            pass
    return total


@contextlib.contextmanager
def job_lock(job_id: str) -> Iterator[bool]:
    """Yields True if this process now owns the job. flock is released automatically if the process
    dies, so a crashed run never blocks the job."""
    LOCKS.mkdir(parents=True, exist_ok=True)
    fd = os.open(LOCKS / f"{job_id}.lock", os.O_RDWR | os.O_CREAT, 0o644)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        yield True
    finally:
        os.close(fd)  # also releases the lock


def _budget_allows(job: dict, media: storage.Bucket, seconds: float) -> bool:
    cap, spent = spend_cap(), spent_usd()
    projected = seconds / 3600 * COST_PER_HOUR_USD
    if spent + projected < cap:
        return True
    print(f"budget: spent ~${spent:.2f} + this job ~${projected:.2f} would pass MAX_SPEND_USD ${cap:.2f}; "
          f"{job['id']} waits (raise MAX_SPEND_USD in .env to let it run)")
    if job.get("status") != "processing" or job.get("message") != MSG_PAUSED:
        job.update(status="processing", message=MSG_PAUSED)
        _write_job(media, job)
    return False


_capped: dict[str, float] = {}  # Convex jobs waiting at the spend cap, by id: the seconds of video measured so far


def _over_cap(job_id: str, seconds: float) -> bool:
    """Whether this much video would pass the cap. A job over it isn't failed (nothing brings a failed job back): the
    caller releases it, and it starts by itself once .env's cap is raised (spend_cap reads it on each check)."""
    cap, spent = spend_cap(), spent_usd()
    if spent + seconds / 3600 * COST_PER_HOUR_USD < cap:
        return False
    if job_id not in _capped:
        print(f"  {job_id}: spend cap: ~${spent:.2f} spent, MAX_SPEND_USD ${cap:.2f}; waits", flush=True)
    _capped[job_id] = max(seconds, _capped.get(job_id, 0.0))
    return True


def _download(blob: storage.Blob, dest: Path) -> None:
    """Download into <name>.part and rename, so a file at `dest` is always complete."""
    if dest.exists() and dest.stat().st_size == blob.size:
        return
    part = dest.with_name(dest.name + ".part")
    print(f"  download {blob.name} ({blob.size / 1e6:.0f} MB)")
    blob.download_to_filename(str(part), timeout=DOWNLOAD_TIMEOUT, retry=DOWNLOAD_RETRY)  # checksum-verified
    got = part.stat().st_size
    if got != blob.size:
        raise RuntimeError(f"downloaded {got} bytes of {blob.name}, expected {blob.size}")
    part.replace(dest)


def _download_cover(url: str, dest: Path) -> Path | None:
    """The cook's plate photo (the claim's coverUrl). None when it can't be fetched: the cover is then a frame
    from the video. The URL opens her photo, so it is never printed."""
    try:
        with requests.get(url, timeout=(10, 60), stream=True) as res:
            res.raise_for_status()
            data = b""
            for chunk in res.iter_content(1 << 16):
                data += chunk
                if len(data) > MAX_COVER_BYTES:
                    raise ValueError(f"over {MAX_COVER_BYTES // 1_000_000} MB")
        dest.write_bytes(data)
        print(f"  plate photo ({len(data) / 1e3:.0f} KB)")
        return dest
    except Exception as e:  # noqa: BLE001 - never fail the job over the cover
        status = getattr(getattr(e, "response", None), "status_code", None)
        why = f"HTTP {status}" if status else (str(e) if isinstance(e, ValueError) else type(e).__name__)
        print(f"  no plate photo ({why}); the cover will be a frame from the video")
        return None


def handle(job_id: str, media: storage.Bucket, uploads: storage.Bucket, retry: bool = False) -> None:
    with job_lock(job_id) as mine:
        if not mine:
            print(f"{job_id}: another worker process is on it; skipping")
            return
        job = _read_job(media, job_id)  # fresh copy under the lock: the pass's listing may be stale
        if retry:
            if job.get("status") == "published":
                print(f"{job_id} is already published (recipe {job.get('recipe_id')}); nothing to retry")
                return
            if job.get("status") != "uploading":  # an uploading job just gets a normal pass now
                job.update(status="processing", message=None)
        if job.get("status") not in ("uploading", "processing"):
            return
        _handle(job, media, uploads)


def _handle(job: dict, media: storage.Bucket, uploads: storage.Bucket) -> None:
    files = job["files"]
    found = {b.name: b for b in uploads.client.list_blobs(uploads, prefix=f"{job['id']}/")}
    folder = INPUT / job["id"]

    if job["status"] == "uploading":
        received = sum(1 for f in files if f["object"] in found)
        if received != job.get("files_received"):
            job["files_received"] = received
            _write_job(media, job)
        if received < len(files):
            if _age(job) > UPLOAD_GIVE_UP:
                _fail(media, job, MSG_MISSING,
                      f"only {received} of {len(files)} files arrived before the upload links expired")
            return
        # A GCS object only appears once its PUT has fully completed, so presence means complete.
        # The phone's reported size is informational (it can differ from the exported copy).
        for f in files:
            blob = found[f["object"]]
            if f.get("size") and blob.size != f["size"]:
                print(f"  note: {blob.name} is {blob.size} bytes; phone reported {f['size']}")

    # Pair every expected file with its upload by object name (never by position: a missing file
    # would shift everything after it). A complete local copy from an earlier run also counts,
    # e.g. a --retry after the 14-day lifecycle rule removed the raw upload.
    sources: list[tuple[storage.Blob | None, Path]] = []
    missing = []
    for f in files:
        blob, dest = found.get(f["object"]), folder / Path(f["object"]).name
        if blob is None and not dest.exists():
            missing.append(f["object"])
        sources.append((blob, dest))
    if missing:
        _fail(media, job, MSG_MISSING, f"missing uploads: {', '.join(missing)}")
        return
    if any(blob is not None and blob.size == 0 for blob, _ in sources):
        _fail(media, job, MSG_EMPTY, "a 0-byte upload")
        return

    if _reported_seconds(job) > MAX_HOURS * 3600:
        _fail(media, job, MSG_TOO_LONG)
        return
    if not _budget_allows(job, media, _reported_seconds(job)):
        return

    if job["status"] != "processing" or job.get("message"):
        job.update(status="processing", message=None)
        _write_job(media, job)
    print(f"processing {job['id']} ({len(files)} files, ~{_reported_seconds(job) / 60:.0f} min reported)")
    folder.mkdir(parents=True, exist_ok=True)
    try:
        inputs = []
        for blob, dest in sources:
            if blob is not None:
                _download(blob, dest)
            inputs.append(dest)
        # The phone's durations can be missing or wrong; re-check the caps with the real ones.
        actual_s = sum(prep.probe_duration(p) for p in inputs)
        if actual_s > MAX_HOURS * 3600:
            _fail(media, job, MSG_TOO_LONG, f"{actual_s / 3600:.1f} h of video")
            return
        if not _budget_allows(job, media, actual_s):
            return
        prep.run(job["id"], job["title"], job["cook_name"], job["relation"], inputs)
        if _cancel_requested(media, job["id"]):
            print(f"{job['id']}: cancel requested; stopping before Gemini")
            return  # the next pass's process_cancellations marks it cancelled
        process.run(job["id"])
        if _cancel_requested(media, job["id"]):
            print(f"{job['id']}: cancel requested; not publishing")
            return
        publish.publish_recipe(job["id"], bucket=media)
        publish.rebuild_library(media)
    except (Exception, SystemExit) as e:  # noqa: BLE001 - any failure marks the job failed; the loop keeps running
        traceback.print_exc()
        _fail(media, job, MSG_NO_STEPS if isinstance(e, process.NoStepsError) else MSG_FAILED,
              f"{type(e).__name__}: {e}")
        return

    job.update(status="published", recipe_id=job["id"], message=None)
    job.pop("error", None)
    _write_job(media, job)
    notify_published(job["id"], job["id"])
    for blob, _ in sources:  # raw family footage isn't kept once the recipe exists
        if blob is None:
            continue
        try:
            blob.delete()
        except Exception as e:  # noqa: BLE001 - the bucket's 14-day lifecycle rule deletes it anyway
            print(f"  warning: could not delete {blob.name}: {e}")
    shutil.rmtree(folder, ignore_errors=True)
    print(f"published {job['id']}")


RECIPE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,99}")


# ---------- Convex jobs ----------

MSG_NO_UPLOAD = "We couldn't find the video for this recipe. Please try adding it again."
CONVEX_INTERVAL_S = 15
PURGE_EVERY_S = 600  # deleted accounts' purge outside Convex (the privacy policy gives it 30 days)
UPLOAD_WAIT_S = 45  # a claimed job waits this long for the rest of its upload, then is released
UPLOAD_POLL_S = 5
# Without a signer file nothing says when to give up, so count releases (each ~1.5 min): about half an hour.
MAX_RELEASES = 20
_releases: dict[str, int] = {}


class UploadPending(Exception):
    """Some of the upload's files haven't arrived yet; release the job and try again later. has_signer: the
    signer's jobs/<job_id>.json lists the files, so its links' expiry (UPLOAD_GIVE_UP) says when to give up."""

    def __init__(self, missing: str, has_signer: bool):
        super().__init__(missing)
        self.has_signer = has_signer


class UploadMissing(Exception):
    """The files can never arrive now; fail the job."""


class JobCancelled(Exception):
    """Convex answered 409: the cook stopped this job in the app. Drop it and publish nothing."""


class Convex:
    """The /worker/* routes. progress() never raises, except JobCancelled: a missed update must not fail
    the job, but a stopped one must stop."""

    def __init__(self, site_url: str, secret: str):
        self.base = site_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["x-worker-secret"] = secret

    def _post(self, path: str, body: dict) -> requests.Response:
        res = self.session.post(f"{self.base}{path}", json=body, timeout=30)
        if res.status_code == 409:
            raise JobCancelled(f"Convex {path}: {res.text[:120]}")
        if res.status_code >= 400:
            raise RuntimeError(f"Convex {path}: HTTP {res.status_code} {res.text[:300]}")
        return res

    def claim(self) -> dict | None:
        res = self._post("/worker/claim", {})
        return None if res.status_code == 204 else res.json()

    def progress(self, job_id: str, stage: str, progress: float, error: str | None = None) -> None:
        body = {"jobId": job_id, "stage": stage, "progress": round(min(max(progress, 0.0), 1.0), 3)}
        if error:
            body["error"] = error
        try:
            self._post("/worker/progress", body)
            print(f"  [{job_id}] {stage} {body['progress']:.0%}", flush=True)
        except JobCancelled:
            raise
        except Exception as e:  # noqa: BLE001
            print(f"  warning: progress {stage} not sent: {e}")

    def release(self, job_id: str) -> None:
        self._post("/worker/release", {"jobId": job_id})

    def published(self, job_id: str, recipe: dict, recipe_json_url: str, language: str | None = None,
                  memories_opt_in: bool | None = None) -> str:
        body = {"jobId": job_id, "recipe": recipe, "recipeJsonUrl": recipe_json_url}
        if language:
            body["language"] = language
        if memories_opt_in is not None:  # the cook's answer to homie's "Can <kid> hear your stories too?"
            body["memoriesOptIn"] = memories_opt_in
        res = self._post("/worker/published", body)
        return res.json().get("recipeId", "")

    def next_deletion(self, exclude: list[str]) -> dict | None:
        """The next deleted account to purge outside Convex, leaving out those already taken this pass."""
        res = self._post("/worker/deletions/next", {"exclude": exclude})
        return None if res.status_code == 204 else res.json()

    def deletion_done(self, deletion_id: str, ok: bool, error: str | None, counts: dict[str, int]) -> str:
        body: dict = {"deletionId": deletion_id, "ok": ok, "counts": counts}
        if error:
            body["error"] = error
        return self._post("/worker/deletions/done", body).json().get("status", "")


def _convex_recipe_id(job: dict) -> str:
    """The GCS folder name for the recipe: the signer's upload folder (e.g. "oatmeal-5372a0") when the
    upload sits in one, else one made from the Convex job id."""
    folder = job["uploadPath"].strip("/").split("/")[0]
    if "/" in job["uploadPath"].strip("/") and RECIPE_ID.fullmatch(folder):
        return folder
    return "recipe-" + re.sub(r"[^a-z0-9]", "", job["jobId"].lower())[-12:]


def _upload_blobs(uploads: storage.Bucket, path: str) -> list[storage.Blob]:
    """uploadPath names one object, or a folder of clips (camera-roll uploads can be several files)."""
    one = uploads.get_blob(path)
    if one is not None:
        return [one]
    prefix = path.rstrip("/") + "/"
    return sorted((b for b in uploads.client.list_blobs(uploads, prefix=prefix) if not b.name.endswith("/")),
                  key=lambda b: b.name)


def _signer_job(media: storage.Bucket, path: str) -> dict | None:
    """The signer's jobs/<job_id>.json when uploadPath is a signer upload folder ("<job_id>/"), else None."""
    folder = path.strip("/")
    if not RECIPE_ID.fullmatch(folder):
        return None
    try:
        job = _read_job(media, folder)
    except NotFound:
        return None
    return job if isinstance(job.get("files"), list) and job["files"] else None


def _complete_upload(media: storage.Bucket, uploads: storage.Bucket, path: str,
                     wait_s: float = UPLOAD_WAIT_S) -> list[storage.Blob]:
    """The upload's files once every one is in the bucket (a GCS object appears only once its PUT is
    complete). With a signer file, that's every object it lists, in the phone's order, as in GCS mode;
    without one, whatever is at uploadPath. Raises UploadPending after wait_s, UploadMissing when the files
    can no longer arrive."""
    signer = _signer_job(media, path)
    deadline = time.monotonic() + wait_s
    while True:
        blobs = _upload_blobs(uploads, path)
        if signer is None:
            if blobs:
                return blobs
            missing = "nothing uploaded yet"
        else:
            found = {b.name: b for b in blobs}
            files = signer["files"]
            absent = [f["object"] for f in files if f["object"] not in found]
            if not absent:
                return [found[f["object"]] for f in files]
            if _age(signer) > UPLOAD_GIVE_UP:
                raise UploadMissing(f"only {len(files) - len(absent)} of {len(files)} files arrived before "
                                    "the upload links expired")
            missing = f"waiting for {', '.join(absent)}"
        if time.monotonic() >= deadline:
            raise UploadPending(missing, has_signer=signer is not None)
        time.sleep(UPLOAD_POLL_S)


def handle_convex(convex: Convex, job: dict, media: storage.Bucket, uploads: storage.Bucket) -> None:
    job_id = job["jobId"]
    recipe_id = _convex_recipe_id(job)
    folder = INPUT / recipe_id
    print(f"claimed {job_id}: {job['uploadPath']} -> {recipe_id}", flush=True)
    t0 = time.monotonic()
    timings: dict[str, float] = {}

    def report(stage: str, progress: float) -> None:
        timings.setdefault(stage, time.monotonic() - t0)
        convex.progress(job_id, stage, progress)

    def fail(message: str, error: str) -> None:
        print(f"failed {job_id}: {error}")
        with contextlib.suppress(JobCancelled):  # stopped meanwhile: it already reads "Cancelled."
            convex.progress(job_id, "failed", 0, message)

    published_media = False
    with job_lock(recipe_id) as mine:
        if not mine:
            print(f"{recipe_id}: another worker process is on it; skipping")
            return
        try:
            if _over_cap(job_id, _capped.get(job_id, 0.0)):  # before the bucket: it comes back every 30 s while it waits
                convex.release(job_id)
                return
            report("preparing", 0.02)
            try:
                blobs = _complete_upload(media, uploads, job["uploadPath"])
            except UploadMissing as e:
                return fail(MSG_MISSING, str(e))
            except UploadPending as e:
                if e.has_signer:  # _complete_upload fails it once the signer's links have expired
                    print(f"  {job_id}: upload not complete ({e}); released")
                else:
                    _releases[job_id] = _releases.get(job_id, 0) + 1
                    if _releases[job_id] > MAX_RELEASES:
                        _releases.pop(job_id)
                        return fail(MSG_NO_UPLOAD, f"gs://{uploads.name}/{job['uploadPath']}: {e}")
                    print(f"  {job_id}: upload not complete ({e}); released ({_releases[job_id]}/{MAX_RELEASES})")
                convex.release(job_id)
                return
            _releases.pop(job_id, None)
            if any(b.size == 0 for b in blobs):
                return fail(MSG_EMPTY, "a 0-byte upload")
            folder.mkdir(parents=True, exist_ok=True)
            inputs = []
            for b in blobs:
                dest = folder / Path(b.name).name
                _download(b, dest)
                inputs.append(dest)
            report("preparing", 0.1)
            actual_s = sum(prep.probe_duration(p) for p in inputs)
            if actual_s > MAX_HOURS * 3600:
                return fail(MSG_TOO_LONG, f"{actual_s / 3600:.1f} h of video")
            if _over_cap(job_id, actual_s):
                convex.release(job_id)
                return
            _capped.pop(job_id, None)
            cook = job.get("cookName") or "Cook"
            # The dish the cook named; without one the writer names it (process.NO_TITLE).
            prep.run(recipe_id, job.get("title") or "", cook, job.get("relation") or cook, inputs,
                     keep_order=bool(job.get("filmedInApp")))  # filmed in the app: never reordered (order.py)
            live = {k: job.get(k) or [] for k in ("liveLog", "liveGaps", "videoGaps")}
            photo = _download_cover(job["coverUrl"], folder / "plate-photo.jpg") if job.get("coverUrl") else None
            process.run(recipe_id, report=report, language=job.get("language"), homie_log=job.get("homieLog") or [],
                        live=live if any(live.values()) else None, cover_photo=photo)
            report("writing", 0.9)
            # Media + recipe.json only. No rebuild_library: Convex lists the family's recipes now, and the
            # GCS library.json is shared by every pre-hackathon copy of the app. The public recipe.json
            # leaves out her stories and tips; Convex gets them all and shows them only after her yes.
            recipe = publish.publish_recipe(recipe_id, bucket=media, family=True)
            published_media = True
            recipe_url = publish.public_url(media, f"{recipe_id}/recipe.json")
            convex_recipe = convex.published(job_id, recipe.model_dump(mode="json"), recipe_url,
                                             job.get("language"), job.get("memoriesOptIn"))
        except JobCancelled:
            # The cook stopped it in the app (every report asks; so do release and published): Convex
            # gets nothing, her raw videos and our copies go, and media published a moment before goes
            # to trash/. A storage error here must not stop the worker.
            shutil.rmtree(folder, ignore_errors=True)
            print(f"cancelled {job_id} by the cook: stopped", flush=True)
            cleanup = [("raw videos", lambda: _purge_cancelled(uploads, job["uploadPath"]))]
            if published_media:
                cleanup.append(("published media to trash/", lambda: _trash_recipe(media, recipe_id)))
            for what, step in cleanup:
                try:
                    print(f"  {job_id}: {what}: {step()} file(s)", flush=True)
                except Exception as e:  # noqa: BLE001
                    print(f"  {job_id}: {what}: cleanup failed: {type(e).__name__}: {e}", flush=True)
            return
        except (Exception, SystemExit) as e:  # noqa: BLE001 - any failure fails this job; the loop keeps running
            traceback.print_exc()
            observability.report_failure(e, job_id)
            return fail(MSG_NO_STEPS if isinstance(e, process.NoStepsError) else MSG_FAILED, f"{type(e).__name__}: {e}")
    shutil.rmtree(folder, ignore_errors=True)
    stages = ", ".join(f"{k} at {v / 60:.1f}" for k, v in timings.items())
    print(f"published {job_id} as Convex recipe {convex_recipe} ({recipe_url}) in "
          f"{(time.monotonic() - t0) / 60:.1f} min ({stages} min)", flush=True)


def _convex_setup() -> tuple[Convex, storage.Bucket, storage.Bucket]:
    site, secret = os.environ.get("CONVEX_SITE_URL"), os.environ.get("WORKER_SECRET")
    if not site or not secret:
        sys.exit("worker: set CONVEX_SITE_URL and WORKER_SECRET in .env (or run with --gcs)")
    client = storage.Client(project=os.environ.get("GCP_PROJECT"))
    return Convex(site, secret), client.bucket(os.environ["GCS_MEDIA_BUCKET"]), client.bucket(os.environ["GCS_UPLOAD_BUCKET"])


PURGE_KEYS = ("SUPABASE_ACCESS_TOKEN", "CARTESIA_API_KEY")


def purge_accounts(convex: Convex, media: storage.Bucket, uploads: storage.Bucket) -> None:
    # Read .env on every pass so a replaced token works without restarting the worker.
    fresh = dotenv_values(ROOT / ".env")
    os.environ.update({k: fresh[k] for k in PURGE_KEYS if fresh.get(k)})
    try:
        account_purge.run_pending(convex, media, uploads)
    except Exception as e:  # noqa: BLE001 - e.g. Convex unreachable; the next pass tries again
        print(f"account purge: skipped this pass: {type(e).__name__}: {str(e)[:200]}", flush=True)


def run_convex(once: bool, interval: int) -> None:
    convex, media, uploads = _convex_setup()
    print(f"worker: polling {convex.base} every {interval} s", flush=True)
    purged_at = None
    while True:
        if purged_at is None or time.monotonic() - purged_at >= PURGE_EVERY_S:
            purged_at = time.monotonic()
            purge_accounts(convex, media, uploads)
        try:
            job = convex.claim()
        except Exception as e:  # noqa: BLE001 - e.g. Wi-Fi drop; try again next poll
            print(f"claim failed: {e}")
            job = None
        if job:
            handle_convex(convex, job, media, uploads)
            if once:
                return
            continue  # there may be more queued
        if once:
            print("nothing queued")
            return
        time.sleep(interval)


MSG_CANCELLED = "Cancelled. No recipe will be made from this upload."


def _cancel_requested(media: storage.Bucket, job_id: str) -> bool:
    return media.blob(f"cancellations/{job_id}.json").exists()


def _trash_recipe(media: storage.Bucket, recipe_id: str) -> int:
    moved = 0
    for blob in media.client.list_blobs(media, prefix=f"{recipe_id}/"):
        media.copy_blob(blob, media, f"trash/{blob.name}")
        blob.delete()
        moved += 1
    return moved


def _purge_uploads(uploads: storage.Bucket, job_id: str) -> int:
    gone = 0
    for blob in uploads.client.list_blobs(uploads, prefix=f"{job_id}/"):
        blob.delete()
        gone += 1
    shutil.rmtree(INPUT / job_id, ignore_errors=True)
    return gone


def _purge_cancelled(uploads: storage.Bucket, upload_path: str) -> int:
    """A stopped Convex job's raw video: the phone's upload folder ("<id>/"), else just the one object
    (a glasses path like "glasses/rec1.mp4": never everything beside it)."""
    folder = upload_path.strip("/")
    if upload_path.endswith("/") and RECIPE_ID.fullmatch(folder):
        return _purge_uploads(uploads, folder)
    blob = uploads.get_blob(folder)
    if blob is None:
        return 0
    blob.delete()
    return 1


def process_cancellations(media: storage.Bucket, uploads: storage.Bucket) -> None:
    """The app's Cancel upload leaves cancellations/<job_id>.json (via the signer). Mark the job
    cancelled, delete its raw videos, and trash the recipe if it was already published."""
    for marker in media.client.list_blobs(media, prefix="cancellations/", match_glob="cancellations/*.json"):
        try:
            job_id = str(json.loads(marker.download_as_text()).get("job_id", ""))
            if RECIPE_ID.fullmatch(job_id) and media.blob(f"jobs/{job_id}.json").exists():
                with job_lock(job_id) as mine:
                    if not mine:
                        continue  # being processed right now; it stops itself before Gemini/publish
                    job = _read_job(media, job_id)
                    if job.get("status") == "published" and _trash_recipe(media, job_id):
                        publish.rebuild_library(media)
                    gone = _purge_uploads(uploads, job_id)
                    job.update(status="cancelled", message=MSG_CANCELLED)
                    _write_job(media, job)
                    print(f"cancelled {job_id}: {gone} raw file(s) deleted")
            marker.delete()
        except Exception:  # noqa: BLE001 - a bad marker must not stop the worker
            traceback.print_exc()
            print(f"{marker.name}: skipped this pass")


def process_deletions(media: storage.Bucket) -> None:
    """The app asks the signer to delete a recipe; the signer can only create files, so it leaves
    deletions/<id>.json here. Move the recipe to trash/<id>/ (recoverable) and rebuild the library."""
    for marker in media.client.list_blobs(media, prefix="deletions/", match_glob="deletions/*.json"):
        try:
            recipe_id = str(json.loads(marker.download_as_text()).get("recipe_id", ""))
            moved = _trash_recipe(media, recipe_id) if RECIPE_ID.fullmatch(recipe_id) else 0
            marker.delete()
            print(f"deleted {recipe_id!r}: {moved} file(s) moved to trash/")
            if moved:
                publish.rebuild_library(media)
        except Exception:  # noqa: BLE001 - a bad marker must not stop the worker
            traceback.print_exc()
            print(f"{marker.name}: skipped this pass")


def run_pass(media: storage.Bucket, uploads: storage.Bucket) -> None:
    process_cancellations(media, uploads)
    process_deletions(media)
    for blob in media.client.list_blobs(media, prefix="jobs/", match_glob="jobs/*.json"):
        job_id = blob.name.removeprefix("jobs/").removesuffix(".json")
        try:
            status = json.loads(blob.download_as_text()).get("status")
            if status in ("uploading", "processing"):
                handle(job_id, media, uploads)
            elif status == "cancelled":
                # The phone may finish a background upload after the cancel; don't keep that footage.
                if gone := _purge_uploads(uploads, job_id):
                    print(f"{job_id}: deleted {gone} late file(s) of a cancelled upload")
        except Exception:  # noqa: BLE001 - one bad job file or network blip must not stop the worker
            traceback.print_exc()
            print(f"{job_id}: skipped this pass")


def main() -> None:
    load_dotenv(ROOT / ".env")
    observability.init_sentry()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int,
                    help=f"seconds between polls (Convex: {CONVEX_INTERVAL_S}; --gcs: 600, which keeps list calls "
                         "inside the GCS free tier)")
    ap.add_argument("--gcs", action="store_true", help="process the pre-hackathon GCS job files instead of Convex")
    ap.add_argument("--retry", metavar="JOB_ID", help="--gcs only: restart a failed (or stuck) job now")
    ap.add_argument("--purge-dry-run", action="store_true",
                    help="print what each deleted account's purge (GCS, Supabase, Cartesia) would delete, then exit")
    args = ap.parse_args()
    if args.purge_dry_run:
        account_purge.run_pending(*_convex_setup(), dry_run=True)
        return
    if not args.gcs:
        if args.retry:
            sys.exit("worker: --retry is for --gcs jobs; queue a Convex job again from Convex instead")
        run_convex(args.once, args.interval or CONVEX_INTERVAL_S)
        return

    client = storage.Client(project=os.environ.get("GCP_PROJECT"))
    media = client.bucket(os.environ["GCS_MEDIA_BUCKET"])
    uploads = client.bucket(os.environ["GCS_UPLOAD_BUCKET"])

    if args.retry:
        handle(args.retry, media, uploads, retry=True)
        return
    while True:
        try:
            run_pass(media, uploads)
        except Exception:  # noqa: BLE001 - e.g. Wi-Fi drop while listing; try again next pass
            traceback.print_exc()
        if args.once:
            return
        time.sleep(args.interval or 600)


if __name__ == "__main__":
    main()
