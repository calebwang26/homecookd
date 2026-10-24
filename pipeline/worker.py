"""Process recipes uploaded from the phone.

    python pipeline/worker.py              # poll forever (every 10 min; --interval 60 for a demo)
    python pipeline/worker.py --once       # one pass, then exit
    python pipeline/worker.py --retry <job_id>

The phone gets signed URLs from the Cloud Run signer (cloud/signer), uploads videos into the
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
from google.cloud import storage
from google.cloud.storage.retry import DEFAULT_RETRY

sys.path.insert(0, str(Path(__file__).resolve().parent))
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

MSG_FAILED = "We couldn't finish this recipe. We'll take a look and try again."
MSG_MISSING = "Some of the videos never finished uploading, so we couldn't write this one. Please try adding them again."
MSG_EMPTY = "One of the videos arrived empty. Please try adding it again."
MSG_TOO_LONG = f"That recording is over {MAX_HOURS} hours. Try splitting it into shorter videos."
MSG_PAUSED = "Recipe writing is paused for a little while. It will start on its own, nothing to do."


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
        _fail(media, job, MSG_FAILED, f"{type(e).__name__}: {e}")
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
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=600,
                    help="seconds between polls; 600 keeps list calls inside the GCS free tier (use 60 during a demo)")
    ap.add_argument("--retry", metavar="JOB_ID", help="restart a failed (or stuck) job now")
    args = ap.parse_args()

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
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
