"""The video worker's new mode: takes jobs from SQS, keeps their state in Postgres, stores files in S3. It runs beside worker.py's
Convex mode and shares no state with it (docs/build/WORKER-MIGRATION.md).

    python pipeline/queue_worker.py [--once]     # one job at a time, forever, or one message then exit

Nothing starts this unless it's asked for by name, and it reads no .env, so the laptop's worker can't turn into it. Only this
process writes to the database; each job's work runs in a child process (queue_job.py) this one can stop at any moment. So one
loop does everything while a job runs: progress, spend, heartbeat, the message's visibility, cancel, the stop signal.

SQS can deliver any message twice. What keeps that safe: only a conditional claim starts a job, only a final transaction
publishes one, and both name the attempt.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import observability  # noqa: E402
import queue_db  # noqa: E402
from queue_aws import Message  # noqa: E402
from queue_job import COST_PER_HOUR_USD, MAX_HOURS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = ROOT / "data" / "out"  # prep.OUT_ROOT, without importing the pipeline here
INPUT = ROOT / "input" / "queue"

MAX_RECEIVES = 3  # the jobs queue's maxReceiveCount (infra/modules/env/queues.tf): the 4th receive moves it to dead letters
LEASE_S = 600  # a running job with no heartbeat for this long has lost its worker
VISIBILITY_S = 900  # longer than the lease, so a message that comes back finds the dead worker's lease over
BEAT_S = 30  # how late a cancel can be noticed
EXTEND_S = 120
TICK_S = 2
MAX_JOB_S = 10 * 3600  # SQS can't hold a message past 12 hours from a receive, so a job ends visibly before that
DUPLICATE_HOLD_S = 3600  # another worker is on it: look again later, when it's probably done
UPLOAD_RETRY_S = 900
RETRY_HOLD_S = 300  # after a failed try, times the tries so far
BAD_MESSAGE_HOLD_S = 60
MAX_HOLD_S = 43000  # just under SQS's 12 hours
SWEEP_EVERY_S = 300
IDLE_BACKOFF_S = 30
FINISH_TRIES, FINISH_RETRY_S = 4, 20  # stays inside Fargate's 120 seconds after a stop signal
# TODO(caleb): both caps are defaults. $12 covers the longest video (MAX_HOURS x COST_PER_HOUR_USD) once, and a bit.
JOB_CAP_USD = "12"
DAILY_CAP_USD = "30"

# The words the cook reads. test_queue_worker.py checks they stay worker.py's.
MSG_FAILED = "We couldn't finish this recipe. We'll take a look and try again."
MSG_EMPTY = "One of the videos arrived empty. Please try adding it again."
MSG_TOO_LONG = f"That recording is over {MAX_HOURS} hours. Try splitting it into shorter videos."
MSG_PAUSED = "Recipe writing is paused for a little while. It will start on its own, nothing to do."
MSG_NO_STEPS = "We couldn't find any cooking in this video. Try filming the dish from the first ingredient to the plate."
MSG_NO_UPLOAD = "We couldn't find the video for this recipe. Please try adding it again."
MSG_CANCELLED = "Cancelled."  # convex/jobs.ts CANCELLED
MESSAGES = {"no_steps": MSG_NO_STEPS, "too_long": MSG_TOO_LONG, "bad_output": MSG_FAILED}


class Log:
    """One JSON object per line, with what ties it to a request. Callers pass ids, stages and error types only: never a
    transcript, a title, a name, a URL or an exception's text."""

    def __init__(self, **context):
        self.context = context

    def bind(self, **context) -> "Log":
        return Log(**{**self.context, **context})

    def __call__(self, message: str, level: str = "info", **fields) -> None:
        line = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "level": level, "msg": message,
                **self.context, **fields}
        print(json.dumps(line, default=str), flush=True)


def report(error: BaseException | str, job_id: str | None) -> None:
    """To Sentry, which keeps the type and drops the text (observability.py). A child's failure arrives as its type's name."""
    if isinstance(error, str):
        error = type(error, (Exception,), {})()
    observability.report_failure(error, job_id or "")


def recipe_folder(claim: dict) -> str:
    """This recipe's folder in the media bucket and data/out. A re-run keeps its recipe's folder, because account deletion takes
    recipes.media_prefix: a second folder would be left behind."""
    existing = (claim.get("media_prefix") or "").rstrip("/")
    if re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", existing):
        return existing
    return "recipe-" + re.sub(r"[^a-z0-9]", "", claim["id"].lower())


def job_prefix(claim: dict) -> str:
    """Everything this job has published. Add the attempt number for one attempt's own folder."""
    return f"{recipe_folder(claim)}/{re.sub(r'[^a-z0-9]', '', claim['id'].lower())[:12]}-a"


def seconds_to_next_utc_day() -> int:
    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((tomorrow - now).total_seconds()) + 60


def spec_for(claim: dict, objects: list[dict]) -> dict:
    """What the child needs. No database in it, and it holds family content, so it lives only on the task's own disk."""
    gaps = claim.get("video_gaps") or []
    return {"job_id": claim["id"], "recipe_id": recipe_folder(claim), "attempt_prefix": f"{job_prefix(claim)}{claim['attempts']}/",
            "objects": [{"key": o["key"], "size": o["size"]} for o in objects], "title": claim.get("title"),
            "cook_name": claim.get("cook_name"), "relation": claim.get("relation"),
            "language": claim.get("language") or claim.get("cook_language") or "en",
            "homie_log": claim.get("homie_log") or [], "cover_key": claim.get("cover_key"),
            "live": {"liveLog": [], "liveGaps": [], "videoGaps": gaps} if gaps else None}


class ChildJob:
    def __init__(self, proc: subprocess.Popen, work: Path, usage_file: Path, out_dir: Path):
        self.proc, self.work, self.usage_file, self.out_dir = proc, work, usage_file, out_dir
        self.events_read = self.calls_read = self.disk_peak = 0

    def poll(self) -> int | None:
        return self.proc.poll()

    def events(self) -> list[dict]:
        """New complete lines of events.jsonl."""
        path = self.work / "events.jsonl"
        if not path.exists():
            return []
        with path.open("rb") as f:
            f.seek(self.events_read)
            data = f.read()
        end = data.rfind(b"\n") + 1
        self.events_read += end
        return [json.loads(line) for line in data[:end].splitlines() if line.strip()]

    def calls(self) -> list[dict]:
        """New model calls in usage.json. process.Usage rewrites that file in place, so a half-written one is read next time."""
        try:
            calls = json.loads(self.usage_file.read_text()).get("calls", [])
        except (OSError, ValueError):
            return []
        new = calls[self.calls_read:]
        self.calls_read = len(calls)
        return new

    def result(self) -> dict | None:
        try:
            return json.loads((self.work / "result.json").read_text())
        except (OSError, ValueError):
            return None

    def sample(self) -> None:
        total = 0
        for d in (self.work, self.out_dir):
            for p in d.rglob("*"):
                try:
                    total += p.stat().st_size if p.is_file() else 0
                except OSError:  # ffmpeg's temporary file, just gone
                    pass
        self.disk_peak = max(self.disk_peak, total)

    def usage(self) -> dict:
        """For measuring a real job (docs/build/WORKER-MIGRATION.md). The rusage is every finished child's, so read one job's
        figures from a run with --once."""
        r = resource.getrusage(resource.RUSAGE_CHILDREN)
        kb = r.ru_maxrss / (1024 if sys.platform == "darwin" else 1)  # bytes on macOS, kilobytes on Linux
        return {"cpu_s": round(r.ru_utime + r.ru_stime, 1), "max_rss_mb": round(kb / 1024), "disk_peak_mb": round(self.disk_peak / 1e6)}

    def kill(self) -> None:
        """The whole group: ffmpeg and the model calls' threads go too."""
        try:
            os.killpg(self.proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass

    def cleanup(self) -> None:
        for d in (self.work, self.out_dir):
            shutil.rmtree(d, ignore_errors=True)


class ChildRunner:
    def __init__(self, command: list[str] | None = None, work_root: Path = INPUT, out_root: Path = OUT_ROOT):
        self.command = command or [sys.executable, str(Path(__file__).with_name("queue_job.py"))]
        self.work_root, self.out_root = work_root, out_root

    def start(self, spec: dict) -> ChildJob:
        """Every attempt starts clean from the raw upload, so half-written files from a crash can't reach a recipe and every
        model call is counted once."""
        work, out = self.work_root / spec["recipe_id"], self.out_root / spec["recipe_id"]
        for d in (work, out):
            shutil.rmtree(d, ignore_errors=True)
        work.mkdir(parents=True, exist_ok=True)
        path = work / "spec.json"
        path.write_text(json.dumps({**spec, "dir": str(work)}, ensure_ascii=False))
        path.chmod(0o600)
        # QUEUE_WORKER_DEBUG shows the steps' own output, which can quote family content: staging with fake data only.
        output = None if os.environ.get("QUEUE_WORKER_DEBUG") else subprocess.DEVNULL
        proc = subprocess.Popen([*self.command, str(path)], stdout=output, stderr=output, start_new_session=True)
        return ChildJob(proc, work, out / "work" / "usage.json", out)


@dataclass
class Run:
    """One attempt at one job, as this process sees it."""
    msg: Message
    claim: dict
    log: Log
    request_id: str | None
    child: object = None
    cost: Decimal = Decimal(0)
    pending_calls: list = field(default_factory=list)
    pending_duration: float | None = None
    video_s: float | None = None
    stage_at: dict = field(default_factory=dict)
    started: float = 0.0
    result_model: str | None = None
    result_prompt: str | None = None


class Worker:
    def __init__(self, queue, store, storage, runner, job_cap: Decimal, daily_cap: Decimal, log: Log | None = None,
                 clock=time.monotonic, sleep=time.sleep, reporter=report):
        self.queue, self.store, self.storage, self.runner = queue, store, storage, runner
        self.job_cap, self.daily_cap = job_cap, daily_cap
        self.log = log or Log()
        self.clock, self.sleep, self.report = clock, sleep, reporter
        self.stopping = False
        self.swept_at: float | None = None

    def stop(self, *_args) -> None:
        """A signal handler: the loop acts on this within one tick."""
        self.stopping = True

    # ---------- the loop ----------

    def run(self, once: bool = False) -> None:
        self.log("worker started")
        while not self.stopping:
            try:
                self.store.ping()  # with the database down, taking messages would only use up their tries
                self._sweep()
                msg = self.queue.receive()
            except Exception as e:  # noqa: BLE001 - an outage: wait, and keep the task alive
                self.log("queue or database unreachable", "error", error_type=type(e).__name__)
                self.report(e, None)
                self.sleep(IDLE_BACKOFF_S)
                continue
            if msg is None:
                if once:
                    break
                continue
            if self.stopping:  # it arrived during the last long poll
                self._hold(msg, 0, self.log)
                break
            try:
                self.handle(msg)
            except Exception as e:  # noqa: BLE001 - nothing was acknowledged, so SQS delivers it again
                self.log("job handling failed", "error", message_id=msg.id, error_type=type(e).__name__)
                self.report(e, None)
            if once:
                break
        self.log("worker stopped")

    def _sweep(self) -> None:
        now = self.clock()
        if self.swept_at is not None and now - self.swept_at < SWEEP_EVERY_S:
            return
        self.swept_at = now
        for job_id in self.store.sweep(LEASE_S, MAX_RECEIVES, MSG_FAILED):
            self.log("job failed: its worker died on the last try", "error", job_id=job_id)
            self.report("JobAbandoned", job_id)

    def _hold(self, msg: Message, seconds: int, log: Log) -> None:
        try:
            self.queue.hold(msg, seconds)
        except Exception as e:  # noqa: BLE001 - the message just comes back at its old time; the claim stays the guard
            log("could not change the message's visibility", "warning", error_type=type(e).__name__)

    def _delete(self, msg: Message, log: Log) -> None:
        try:
            self.queue.delete(msg)
        except Exception as e:  # noqa: BLE001 - it comes back, finds the job over, and is deleted then
            log("could not delete the message", "warning", error_type=type(e).__name__)

    # ---------- one message ----------

    def handle(self, msg: Message) -> None:
        log = self.log.bind(message_id=msg.id, receive_count=msg.receive_count)
        try:
            body = json.loads(msg.body)
            job_id = body["payload"]["jobId"]
            if not isinstance(job_id, str) or not job_id:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            log("not a job message", "error")
            self.report("BadJobMessage", None)
            self._hold(msg, BAD_MESSAGE_HOLD_S, log)  # soon in the dead letters, where its alarm is
            return
        log = log.bind(job_id=job_id, request_id=body.get("requestId"), outbox_id=body.get("outboxId"))
        self._hold(msg, VISIBILITY_S, log)  # a worker that dies from here on costs 15 minutes, not the queue's 2 hours

        state = self.store.peek(job_id, LEASE_S)
        if state and state["stage"] == "queued" and not state["cancelled"] and self.store.spent_today() >= self.daily_cap:
            self._pause_for_budget(msg, job_id, log)
            return
        claim = self.store.claim(job_id, LEASE_S)
        if claim is None:
            self._not_claimed(msg, job_id, log)
            return
        log = log.bind(attempt=claim["attempts"])
        run = Run(msg, claim, log, body.get("requestId"), cost=Decimal(claim.get("cost_usd") or 0), started=self.clock())
        log("job claimed")
        self._start(run)

    def _not_claimed(self, msg: Message, job_id: str, log: Log) -> None:
        """A repeat of something, or too early. Only a job that's over lets go of its message."""
        state = self.store.peek(job_id, LEASE_S)
        if state is None:
            log("job is gone: dropped")  # deleted with its account, whose purge takes the files
            self._delete(msg, log)
        elif state["cancelled"]:
            self._cancelled(msg, {"id": job_id, **state}, log)
        elif state["stage"] in ("done", "failed"):
            log("repeat of a finished job: dropped", stage=state["stage"])
            self._delete(msg, log)
        elif state["stage"] == "uploading":
            log("upload isn't finished: waiting", stage="uploading")
            self._hold(msg, UPLOAD_RETRY_S, log)
        else:
            log("another worker is on it: waiting", stage=state["stage"])
            self._hold(msg, DUPLICATE_HOLD_S, log)

    def _pause_for_budget(self, msg: Message, job_id: str, log: Log) -> None:
        log("daily spend cap reached: job waits", "warning")
        self.store.pause(job_id, MSG_PAUSED)
        self._hold(msg, min(seconds_to_next_utc_day(), MAX_HOLD_S), log)
        if self.store.note_daily_cap():
            self.report("DailySpendCapReached", job_id)

    def _start(self, run: Run) -> None:
        claim, msg, log = run.claim, run.msg, run.log
        objects = self.storage.list_upload(claim["upload_key"])
        if not objects:
            if msg.receive_count >= MAX_RECEIVES:
                self._fail(run, MSG_NO_UPLOAD, "NoUpload")
            else:
                log("no upload yet: waiting")
                self.store.release(claim)
                self._hold(msg, UPLOAD_RETRY_S, log)
            return
        if any(o["size"] == 0 for o in objects):
            self._fail(run, MSG_EMPTY, "EmptyUpload")
            return
        self.store.upload_finished(claim, max(o["modified"] for o in objects))
        run.child = self.runner.start(spec_for(claim, objects))
        try:
            outcome = self._watch(run)
            run.child.kill()  # stopped already, or to be stopped: nothing it does after this counts
            self._save_calls(run, run.child.calls())
            self._settle(run, outcome)
        finally:
            run.child.kill()
            run.child.cleanup()

    # ---------- while the child runs ----------

    def _watch(self, run: Run) -> str:
        now = self.clock()
        beat_at, extend_at, beat_ok = now, now, now
        deadline = now + MAX_JOB_S
        while True:
            outcome = self._drain(run)
            if run.child.poll() is not None:  # it wrote its last lines before exiting
                self._drain(run)
                return "exited"
            if outcome:
                return outcome
            if self.stopping:
                return "stopping"
            now = self.clock()
            if now >= deadline:
                return "too_slow"
            if now - beat_at >= BEAT_S:
                beat_at = now
                run.child.sample()
                try:
                    status = self.store.heartbeat(run.claim)
                except Exception as e:  # noqa: BLE001 - the database is down: keep going while the lease is surely ours
                    run.log("heartbeat failed", "warning", error_type=type(e).__name__)
                    if now - beat_ok >= LEASE_S - 2 * BEAT_S:
                        return "lease_unsure"
                else:
                    beat_ok = now
                    if status != "ok":
                        return status
            if now - extend_at >= EXTEND_S:
                extend_at = now
                self._hold(run.msg, VISIBILITY_S, run.log)
            self.sleep(TICK_S)

    def _drain(self, run: Run) -> str | None:
        """What the child has written since the last tick. Job progress may be a little old (SYSTEM-DESIGN), so a failed write here
        only waits for the next one; spend is kept until it's saved."""
        latest = None
        for event in run.child.events():
            if "duration_s" in event:
                run.video_s = run.pending_duration = float(event["duration_s"])
            elif event.get("stage"):
                latest = event
                if event["stage"] not in run.stage_at:
                    run.stage_at[event["stage"]] = round(self.clock() - run.started, 1)
                    run.log("stage", stage=event["stage"])
        if latest:
            try:
                self.store.progress(run.claim, latest["stage"], float(latest.get("progress") or 0))
            except Exception as e:  # noqa: BLE001
                run.log("progress not saved", "warning", error_type=type(e).__name__)
        self._save_calls(run, run.child.calls())
        if run.cost > self.job_cap:
            return "over_job_cap"
        if run.pending_duration is None:
            return None
        projected = Decimal(str(round(run.pending_duration / 3600 * COST_PER_HOUR_USD, 6)))
        try:
            spent = self.store.spent_today()
        except Exception as e:  # noqa: BLE001 - asked again next tick; no model has run yet
            run.log("today's spend unreadable", "warning", error_type=type(e).__name__)
            return None
        run.pending_duration = None
        if run.cost + projected > self.job_cap:
            return "over_job_cap"
        if spent + projected > self.daily_cap:
            return "over_daily_cap"
        return None

    def _save_calls(self, run: Run, calls: list[dict]) -> None:
        for call in calls:
            if call.get("kind") == "merge" and call.get("error") is None:
                run.result_model, run.result_prompt = call.get("model"), queue_db.prompt_version("merge")
        run.pending_calls += calls
        if not run.pending_calls:
            return
        try:
            run.cost = self.store.record_calls(run.claim["id"], run.pending_calls)
            run.pending_calls = []
        except Exception as e:  # noqa: BLE001 - kept for the next tick
            run.log("model calls not saved", "warning", error_type=type(e).__name__)

    # ---------- how it ended ----------

    def _settle(self, run: Run, outcome: str) -> None:
        log, msg, claim = run.log, run.msg, run.claim
        log("job stopped", outcome=outcome, seconds=round(self.clock() - run.started, 1), stages=run.stage_at,
            cost_usd=str(run.cost), video_s=run.video_s, **run.child.usage())
        if outcome == "exited":
            self._after_exit(run)
        elif outcome == "cancelled":
            self._cancelled(msg, claim, log)
        elif outcome == "stopping":
            # Back to the queue for the next task. If this was the last try, it goes to the dead letters, whose alarm says so.
            self.store.release(claim)
            self._hold(msg, 0, log)
        elif outcome == "over_job_cap":
            self._fail(run, MSG_FAILED, "JobSpendCapReached")
        elif outcome == "over_daily_cap":
            self.store.release(claim, MSG_PAUSED)
            self._hold(msg, min(seconds_to_next_utc_day(), MAX_HOLD_S), log)
            if self.store.note_daily_cap():
                self.report("DailySpendCapReached", claim["id"])
        elif outcome == "too_slow":
            self._fail(run, MSG_FAILED, "JobTooSlow")
        # lost: another worker has the job, and the claim's fence refuses anything from here. lease_unsure: the database has been
        # down for a lease, so another worker may take over once it's back. Either way nothing more is written.

    def _after_exit(self, run: Run) -> None:
        result = run.child.result()
        if result is None:  # killed from outside, usually out of memory: no words from it at all
            self._try_again(run, "ChildDied")
        elif result.get("ok"):
            self._publish(run, result)
        elif result.get("kind") in MESSAGES:
            self._fail(run, MESSAGES[result["kind"]], result.get("error_type") or result["kind"])
        else:
            self._try_again(run, result.get("error_type") or "JobError")

    def _publish(self, run: Run, result: dict) -> None:
        """The last check before saving, then the one transaction that makes the recipe real."""
        claim, log = run.claim, run.log
        try:
            import schema
            schema.Recipe.model_validate(result["recipe"])
            row = queue_db.recipe_row(result["recipe"])
        except Exception as e:  # noqa: BLE001 - pydantic's ValidationError or recipe_row's ValueError
            self.storage.delete_media(f"{job_prefix(claim)}{claim['attempts']}/")
            self._fail(run, MSG_FAILED, type(e).__name__)
            return
        keys = {"media_prefix": f"{recipe_folder(claim)}/", "recipe_json_key": result["recipe_json_key"],
                "cover_key": result["cover_key"], "cover_version": result.get("cover_version")}
        if self._finish(run, row, keys):
            log("job done", cost_usd=str(run.cost))
            self._delete(run.msg, log)
        else:
            self._claim_gone(run)

    def _finish(self, run: Run, row: dict, keys: dict) -> bool:
        """A job this far has been paid for, so a database blip gets some patience. If it's still down, this raises: the message
        comes back and the job re-runs, which is safe but costs the model calls again."""
        result = {"model": run.result_model, "prompt_version": run.result_prompt}
        for attempt in range(FINISH_TRIES):
            try:
                return self.store.finish(run.claim, row, keys, result, run.request_id)
            except Exception as e:  # noqa: BLE001
                run.log("final save failed", "warning", error_type=type(e).__name__, try_number=attempt + 1)
                if attempt == FINISH_TRIES - 1:
                    raise
                self.sleep(FINISH_RETRY_S)
        return False

    def _claim_gone(self, run: Run) -> None:
        """A fenced write changed nothing, so this attempt doesn't own the job any more. A cancel is finished here. Another worker
        holding it needs nothing from this one, and the message stays for it."""
        state = self.store.peek(run.claim["id"], LEASE_S)
        if state is None or state["cancelled"]:
            self._cancelled(run.msg, run.claim, run.log)
        else:
            run.log("lost the claim: nothing saved", "warning", stage=state["stage"])

    def _fail(self, run: Run, message: str, why: str) -> None:
        """Over for good, and the cook is told. The message goes once that's saved, so a crash in between repeats harmlessly."""
        run.log("job failed", "error", error_type=why)
        self.report(why, run.claim["id"])
        if self.store.fail(run.claim, message):
            self._delete(run.msg, run.log)
        else:
            self._claim_gone(run)

    def _try_again(self, run: Run, why: str) -> None:
        """Maybe an outage or a bad moment, so SQS brings it back. On the last try the cook is told, and the message goes on to
        the dead letters for the alarm."""
        run.log("job try failed", "error", error_type=why)
        self.report(why, run.claim["id"])
        last = run.msg.receive_count >= MAX_RECEIVES
        if not (self.store.fail(run.claim, MSG_FAILED) if last else self.store.release(run.claim)):
            self._claim_gone(run)
        else:
            self._hold(run.msg, 0 if last else RETRY_HOLD_S * run.msg.receive_count, run.log)

    def _cancelled(self, msg: Message, job: dict, log: Log) -> None:
        """Her raw video goes, as Convex mode does, and anything this job published. If S3 fails the message stays, so it's tried
        again, and on the third try the alarm says footage she stopped is still there."""
        try:
            # Another cook's stop keeps her raw video: footage is irreplaceable, and a person decides (JOBS-MIGRATION.md, decisions).
            keep = self.store.keeps_upload(job["id"])
            gone = (0 if keep else self.storage.delete_upload(job["upload_key"])) + self.storage.delete_media(job_prefix(job))
        except Exception as e:  # noqa: BLE001
            log("cancelled job's files not deleted", "error", error_type=type(e).__name__)
            self.report(e, job["id"])
            return
        self.store.acknowledge_cancel(job["id"], MSG_CANCELLED)
        log("job cancelled", files_deleted=gone)
        self._delete(msg, log)


def _cap(name: str, default: str) -> Decimal:
    return Decimal(os.environ.get(name) or default)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true", help="handle at most one message, then exit (measuring a job)")
    args = ap.parse_args(argv)
    required = ["JOBS_QUEUE_URL", "UPLOAD_BUCKET", "MEDIA_BUCKET", "MEDIA_BASE_URL", "DEPLOY_ENV"]
    if missing := [name for name in required if not os.environ.get(name)]:
        sys.exit(f"queue_worker: not set: {', '.join(missing)}")
    observability.init_sentry()
    from queue_aws import S3Storage, SqsQueue
    worker = Worker(SqsQueue(os.environ["JOBS_QUEUE_URL"]), queue_db.PostgresStore(), S3Storage.from_env(), ChildRunner(),
                    _cap("PIPELINE_JOB_CAP_USD", JOB_CAP_USD), _cap("PIPELINE_DAILY_CAP_USD", DAILY_CAP_USD),
                    log=Log(service="worker", release=os.environ.get("RELEASE")))
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    worker.run(args.once)
    worker.store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
