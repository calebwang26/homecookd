"""Queue mode (queue_worker.py, queue_db.py, queue_aws.py, queue_job.py; docs/build/WORKER-MIGRATION.md).

    python pipeline/test_queue_worker.py                 # fakes only; the Postgres and boto3 checks skip
    TEST_DATABASE_URL=postgres://... python pipeline/test_queue_worker.py   # every scenario runs on real Postgres too

The URL's database is wiped and rebuilt from api/migrations/*.sql, so point it only at a throwaway one. No network, no AWS, no
model calls: SQS and S3 are fakes, and a fake child stands in for the real job except where a test starts a real process.
Every scenario runs against the fake store and, when there's a database, against PostgresStore, so the two can't drift apart.
"""
from __future__ import annotations

import contextlib
import copy
import inspect
import io
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import queue_aws  # noqa: E402
import queue_db  # noqa: E402
import queue_job  # noqa: E402
import queue_worker as qw  # noqa: E402
from queue_aws import Message, S3Storage, SqsQueue  # noqa: E402

DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
SAMPLE = ROOT / "data" / "synthetic" / "dad-sunday-chili.json"
# Family content. After every scenario, the logs are searched for these.
FAMILY = ("Secret Masala", "Aaji Pawar", "she whispered")


class Skip(Exception):
    pass


class Crash(BaseException):
    """The process dying: no except Exception in the worker may catch it."""


def recipe_json(**changes) -> dict:
    raw = json.loads(SAMPLE.read_text())
    raw.update(sample=False, title="Secret Masala", language="mr", id="recipe-x")
    raw["cook"] = {"name": "Aaji Pawar", "relation": "Aaji"}
    raw["media"].update(video_url="https://cdn.test/play.mp4", audio_url="https://cdn.test/voice.m4a",
                        poster_url="https://cdn.test/poster.jpg")
    raw["steps"][0]["quote"] = "she whispered this part"
    raw["follow_up_questions"] = [{"id": "q1", "about_step": 1, "question": "How long does it boil?"},
                                  {"id": "q2", "about_step": 1, "question": "Did you add salt?", "ingredient": "salt"}]
    raw.update(changes)
    return raw


def call(cost: float = 1.0, kind: str = "merge", error: str | None = None, model: str = "claude-sonnet-5-5") -> dict:
    return {"kind": kind, "model": model, "file": "/x/ai.mp4", "attempt": 1, "seconds": 2.5, "prompt_token_count": 100,
            "candidates_token_count": 50, "thoughts_token_count": 5, "cost_usd": cost, "price_known": True, "ok": error is None,
            "error": error, "batch": False}


def good_result(spec: dict) -> dict:
    return {"ok": True, "recipe": recipe_json(), "recipe_json_key": spec["attempt_prefix"] + "recipe.json",
            "cover_key": spec["attempt_prefix"] + "poster.jpg", "cover_version": "v1"}


# ---------- fakes: SQS, S3, the child ----------

class FakeQueue:
    """SQS's rules that matter here: hidden while in flight, the 4th receive moves to the dead letters, a hold of 0 returns it."""

    def __init__(self):
        self.rows: list[dict] = []
        self.dead: list[dict] = []
        self.holds: list[tuple[str, int]] = []
        self.crash_on_delete = False
        self.hold_error: Exception | None = None

    def send(self, job_id: str | None = None, body: str | None = None) -> str:
        mid = f"m{len(self.rows) + len(self.dead) + 1}"
        body = body or json.dumps({"outboxId": "7", "requestId": "req-1", "payload": {"jobId": job_id}})
        self.rows.append({"id": mid, "body": body, "count": 0, "visible": True, "delay": None})
        return mid

    def receive(self) -> Message | None:
        for row in list(self.rows):
            if not row["visible"]:
                continue
            if row["count"] >= qw.MAX_RECEIVES:
                self.rows.remove(row)
                self.dead.append(row)
                continue
            row["count"] += 1
            row["visible"] = False
            return Message(row["id"], f"{row['id']}:{row['count']}", row["body"], row["count"])
        return None

    def hold(self, msg: Message, seconds: int) -> None:
        if self.hold_error:
            raise self.hold_error
        self.holds.append((msg.id, seconds))
        for row in self.rows:
            if row["id"] == msg.id:
                row["visible"] = seconds == 0

    def delete(self, msg: Message) -> None:
        if self.crash_on_delete:
            self.crash_on_delete = False
            raise Crash()
        self.rows = [r for r in self.rows if r["id"] != msg.id]

    def time_passes(self) -> None:
        for row in self.rows:
            row["visible"] = True

    def alive(self) -> list[str]:
        return [r["id"] for r in self.rows]


class FakeS3:
    """The boto3 S3 client calls queue_aws makes, in memory."""

    def __init__(self):
        self.objects: dict[tuple[str, str], dict] = {}
        self.versions = 0
        self.delete_error: Exception | None = None

    def put(self, bucket: str, key: str, body: bytes = b"video", modified: datetime | None = None, metadata: dict | None = None):
        self.versions += 1
        self.objects[(bucket, key)] = {"Body": body, "ContentLength": len(body), "VersionId": f"ver{self.versions}",
                                       "LastModified": modified or datetime.now(timezone.utc), "Metadata": metadata or {}}

    def keys(self, bucket: str) -> list[str]:
        return sorted(k for b, k in self.objects if b == bucket)

    def head_object(self, Bucket: str, Key: str) -> dict:
        found = self.objects.get((Bucket, Key))
        if found is None:
            raise_404()
        return {k: v for k, v in found.items() if k != "Body"}

    def list_objects_v2(self, Bucket: str, Prefix: str, ContinuationToken: str | None = None) -> dict:
        return {"Contents": [{"Key": k, "Size": o["ContentLength"], "LastModified": o["LastModified"]}
                             for (b, k), o in sorted(self.objects.items()) if b == Bucket and k.startswith(Prefix)]}

    def download_file(self, bucket: str, key: str, dest: str) -> None:
        Path(dest).write_bytes(self.objects[(bucket, key)]["Body"])

    def upload_file(self, path: str, bucket: str, key: str, ExtraArgs: dict) -> None:
        self.put(bucket, key, Path(path).read_bytes(), metadata=ExtraArgs.get("Metadata"))
        self.objects[(bucket, key)]["extra"] = ExtraArgs

    def put_object(self, Bucket: str, Key: str, Body: bytes, **extra) -> None:
        self.put(Bucket, Key, Body, metadata=extra.get("Metadata"))
        self.objects[(Bucket, Key)]["extra"] = extra

    def get_object(self, Bucket: str, Key: str) -> dict:
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)]["Body"])}

    def delete_objects(self, Bucket: str, Delete: dict) -> dict | None:
        if self.delete_error:
            raise self.delete_error
        if getattr(self, "delete_answer", None):
            return self.delete_answer
        for o in Delete["Objects"]:
            self.objects.pop((Bucket, o["Key"]), None)


def raise_404():
    e = Exception("not found")
    e.response = {"Error": {"Code": "404"}}
    raise e


class FakeChild:
    """ticks run one per poll: a dict of events and calls, or a function of the spec. Then it exits with result."""

    def __init__(self, spec: dict, ticks: list, result=good_result, forever: bool = False):
        self.spec, self.ticks, self._result, self.forever = spec, list(ticks), result, forever
        self.pending_events, self.pending_calls = [], []
        self.killed = self.cleaned = False

    def poll(self):
        if self.killed:
            return -9
        if self.ticks:
            tick = self.ticks.pop(0)
            if callable(tick):
                tick(self.spec)
            else:
                self.pending_events += tick.get("events", [])
                self.pending_calls += tick.get("calls", [])
            return None
        return None if self.forever else 0

    def events(self):
        new, self.pending_events = self.pending_events, []
        return new

    def calls(self):
        new, self.pending_calls = self.pending_calls, []
        return new

    def result(self):
        return self._result(self.spec) if callable(self._result) else self._result

    def sample(self):
        pass

    def usage(self):
        return {"cpu_s": 1.0}

    def kill(self):
        self.killed = True

    def cleanup(self):
        self.cleaned = True


class FakeRunner:
    def __init__(self, *scripts):
        self.scripts = list(scripts) or [{}]
        self.specs: list[dict] = []
        self.children: list[FakeChild] = []

    def start(self, spec: dict) -> FakeChild:
        self.specs.append(spec)
        script = self.scripts.pop(0) if len(self.scripts) > 1 else self.scripts[0]
        kw = {"ticks": [], **script}
        child = FakeChild(spec, **kw)
        self.children.append(child)
        return child


GOOD_TICKS = [{"events": [{"stage": "preparing", "progress": 0.1}, {"duration_s": 60}]},
              {"events": [{"stage": "understanding", "progress": 0.5}], "calls": [call(0.5, "extract")]},
              {"events": [{"stage": "writing", "progress": 0.9}], "calls": [call(0.25, "merge")]}]


# ---------- the store: fake and real, the same scenarios on both ----------

RUNNING = queue_db.RUNNING


class FakeStore:
    """The same promises as PostgresStore, in memory."""

    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self.recipes: dict[str, dict] = {}
        self.questions: list[dict] = []
        self.outbox: list[dict] = []
        self.model_calls: list[dict] = []
        self.spent = Decimal(0)
        self.alerted = False
        self.lock = threading.Lock()

    def ping(self):
        pass

    def _beat(self, job):
        return job["heartbeat_at"] or job["claimed_at"] or job["updated_at"]

    def claim(self, job_id, lease_s):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job["cancelled_at"]:
                return None
            if not (job["stage"] == "queued" or (job["stage"] in RUNNING and self._beat(job) < time.time() - lease_s)):
                return None
            job.update(stage="preparing", progress=0.02, error=None, attempts=job["attempts"] + 1, claimed_at=time.time(),
                       heartbeat_at=time.time(), updated_at=time.time())
            recipe = self.recipes.get(job["recipe_id"]) or {}
            return {**job, "cook_name": "Aaji Pawar", "relation": "Aaji", "cook_language": "mr",
                    "media_prefix": recipe.get("media_prefix"), "homie_log": [], "memories_opt_in": None, "cover_key": None}

    def peek(self, job_id, lease_s):
        job = self.jobs.get(job_id)
        if not job:
            return None
        recipe = self.recipes.get(job["recipe_id"]) or {}
        return {"stage": job["stage"], "attempts": job["attempts"], "upload_key": job["upload_key"],
                "media_prefix": recipe.get("media_prefix"), "cancelled": job["cancelled_at"] is not None,
                "lease_live": self._beat(job) >= time.time() - lease_s}

    def _owned(self, claim):
        job = self.jobs.get(claim["id"])
        if job and job["attempts"] == claim["attempts"] and not job["cancelled_at"] and job["stage"] in RUNNING:
            return job
        return None

    def heartbeat(self, claim):
        job = self._owned(claim)
        if job:
            job["heartbeat_at"] = time.time()
            return "ok"
        now = self.jobs.get(claim["id"])
        return "cancelled" if now is None or now["cancelled_at"] else "lost"

    def progress(self, claim, stage, progress):
        if job := self._owned(claim):
            job.update(stage=stage, progress=round(progress, 3))

    def upload_finished(self, claim, at):
        if job := self._owned(claim):
            job["upload_finished_at"] = job["upload_finished_at"] or at

    def release(self, claim, error=None):
        job = self._owned(claim)
        if job:
            job.update(stage="queued", progress=0, claimed_at=None, heartbeat_at=None, error=error, updated_at=time.time())
        return job is not None

    def fail(self, claim, message):
        job = self._owned(claim)
        if job:
            job.update(stage="failed", progress=0, error=message, finished_at=time.time())
            if job["recipe_id"] in self.recipes:
                self.recipes[job["recipe_id"]]["status"] = "failed"
        return job is not None

    def record_calls(self, job_id, calls):
        rows = [queue_db.call_row(c) for c in calls]
        total = sum((r["cost_usd"] for r in rows), Decimal(0))
        job = self.jobs.get(job_id)
        self.model_calls += [{**r, "job_id": job_id if job else None} for r in rows]
        self.spent += total
        if job:
            job["cost_usd"] = (job["cost_usd"] or Decimal(0)) + total
            return job["cost_usd"]
        return total

    def spent_today(self):
        return self.spent

    def note_daily_cap(self):
        first, self.alerted = not self.alerted, True
        return first

    def pause(self, job_id, message):
        job = self.jobs.get(job_id)
        if job and job["stage"] == "queued" and not job["cancelled_at"]:
            job["error"] = message

    def keeps_upload(self, job_id):
        return bool((self.jobs.get(job_id) or {}).get("keep_upload"))

    def acknowledge_cancel(self, job_id, message):
        job = self.jobs.get(job_id)
        if job and job["cancelled_at"]:
            job.update(stage="failed", progress=0, error=job["error"] or message, finished_at=job["finished_at"] or time.time())

    def finish(self, claim, row, keys, result, request_id):
        job = self.jobs.get(claim["id"])
        if job is None or job["cancelled_at"] or job["attempts"] != claim["attempts"]:
            return False
        if job["stage"] == "done":
            return True
        if job["stage"] not in RUNNING:
            return False
        fields = {"title": row["title"], "steps": row["steps"], "memories": row["memories"], "status": "ready",
                  "language": row["language"] or job["language"], **keys}
        recipe_id = job["recipe_id"] if job["recipe_id"] in self.recipes else str(uuid.uuid4())
        self.recipes.setdefault(recipe_id, {}).update(fields)
        for f in row["follow_ups"]:
            if not any(q["recipe_id"] == recipe_id and q["follow_up_id"] == f["id"] for q in self.questions):
                self.questions.append({"recipe_id": recipe_id, "follow_up_id": f["id"]})
        job.update(stage="done", progress=1, error=None, finished_at=time.time(), recipe_id=recipe_id,
                   result_model=result.get("model"), result_prompt_version=result.get("prompt_version"))
        self.outbox.append({"queue": "scheduled", "payload": {"kind": "recipe_published", "jobId": job["id"], "recipeId": recipe_id},
                            "request_id": request_id})
        return True

    def sweep(self, lease_s, max_attempts, message):
        gone = []
        for job in self.jobs.values():
            beat = self._beat(job)
            if job["stage"] in RUNNING and beat < time.time() - lease_s and (job["attempts"] >= max_attempts or beat < time.time() - 86400):
                job.update(stage="failed", progress=0, error=message, finished_at=time.time())
                if job["recipe_id"] in self.recipes:
                    self.recipes[job["recipe_id"]]["status"] = "failed"
                gone.append(job["id"])
        return gone


class FakeContext:
    name = "fake"

    def __init__(self):
        self.store = FakeStore()

    def second_store(self):
        return self.store

    def new_job(self, upload_key="up-1/", stage="queued", recipe=None, attempts=0, cost=None) -> str:
        job_id = str(uuid.uuid4())
        recipe_id = None
        if recipe:
            recipe_id = str(uuid.uuid4())
            self.store.recipes[recipe_id] = dict(recipe)
        self.store.jobs[job_id] = {
            "id": job_id, "stage": stage, "progress": 0, "attempts": attempts, "upload_key": upload_key, "cancelled_at": None,
            "claimed_at": time.time() if stage in RUNNING else None, "heartbeat_at": time.time() if stage in RUNNING else None,
            "updated_at": time.time(), "finished_at": None, "upload_finished_at": None, "error": None, "recipe_id": recipe_id,
            "cost_usd": cost, "language": "mr", "title": "Secret Masala", "result_model": None, "result_prompt_version": None,
            "video_gaps": None, "recording_id": None}
        return job_id

    def job(self, job_id) -> dict | None:
        return self.store.jobs.get(job_id)

    def cancel(self, job_id, keep_upload=False):
        self.store.jobs[job_id].update(cancelled_at=time.time(), stage="failed", progress=0, error="Cancelled.", keep_upload=keep_upload)

    def delete_job(self, job_id):
        del self.store.jobs[job_id]

    def stale(self, job_id, seconds=3600):
        job = self.store.jobs[job_id]
        job.update(heartbeat_at=time.time() - seconds, claimed_at=time.time() - seconds)

    def set_spent(self, usd):
        self.store.spent = Decimal(str(usd))

    def spent(self) -> Decimal:
        return self.store.spent

    def recipes(self) -> list[dict]:
        return list(self.store.recipes.values())

    def question_count(self) -> int:
        return len(self.store.questions)

    def outbox(self) -> list[dict]:
        return self.store.outbox

    def calls(self, job_id) -> list[dict]:
        return [c for c in self.store.model_calls if c["job_id"] == job_id]


class PostgresContext:
    name = "postgres"

    def __init__(self, url: str):
        import psycopg
        from psycopg.rows import dict_row
        self.admin = psycopg.connect(url, autocommit=True, row_factory=dict_row)
        self.url = url
        self.store = queue_db.PostgresStore({"conninfo": url})
        self.family = self.admin.execute("insert into families (name) values (%s) returning id", (f"Fam {uuid.uuid4()}",)).fetchone()["id"]
        self.cook = self.admin.execute("insert into people (family_id, name, role, language) values (%s, 'Aaji Pawar', 'cook', 'mr') returning id",
                                       (self.family,)).fetchone()["id"]
        self.admin.execute("delete from daily_spend")

    def second_store(self):
        return queue_db.PostgresStore({"conninfo": self.url})

    def new_job(self, upload_key="up-1/", stage="queued", recipe=None, attempts=0, cost=None) -> str:
        recipe_id = None
        if recipe:
            recipe_id = self.admin.execute(
                "insert into recipes (family_id, cook_id, title, status, media_prefix) values (%s, %s, 'Old', 'processing', %s) returning id",
                (self.family, self.cook, recipe.get("media_prefix"))).fetchone()["id"]
        running = stage in RUNNING
        return self.admin.execute(
            """insert into jobs (family_id, cook_id, upload_key, source, title, language, stage, attempts, recipe_id, cost_usd, claimed_at, heartbeat_at)
               values (%s, %s, %s, 'phone', 'Secret Masala', 'mr', %s, %s, %s, %s, %s, %s) returning id""",
            (self.family, self.cook, upload_key, stage, attempts, recipe_id, cost,
             datetime.now(timezone.utc) if running else None, datetime.now(timezone.utc) if running else None)).fetchone()["id"]

    def job(self, job_id) -> dict | None:
        return self.admin.execute("select * from jobs where id = %s", (job_id,)).fetchone()

    def cancel(self, job_id, keep_upload=False):
        self.admin.execute("update jobs set cancelled_at = now(), stage = 'failed', progress = 0, error = 'Cancelled.', keep_upload = %s where id = %s", (keep_upload, job_id))

    def delete_job(self, job_id):
        self.admin.execute("delete from jobs where id = %s", (job_id,))

    def stale(self, job_id, seconds=3600):
        self.admin.execute("""update jobs set heartbeat_at = now() - make_interval(secs => %s), claimed_at = now() - make_interval(secs => %s)
                               where id = %s""", (seconds, seconds, job_id))

    def set_spent(self, usd):
        self.admin.execute("""insert into daily_spend (scope, day, usd) values ('pipeline', (now() at time zone 'utc')::date, %s)
                              on conflict (scope, day) do update set usd = excluded.usd""", (Decimal(str(usd)),))

    def spent(self) -> Decimal:
        return self.store.spent_today()

    def recipes(self) -> list[dict]:
        return self.admin.execute("select * from recipes where family_id = %s", (self.family,)).fetchall()

    def question_count(self) -> int:
        return self.admin.execute("select count(*) as n from questions where family_id = %s", (self.family,)).fetchone()["n"]

    def outbox(self) -> list[dict]:
        rows = self.admin.execute("select * from outbox order by id").fetchall()
        return [r for r in rows if r["payload"].get("recipeId") in {x["id"] for x in self.recipes()}]

    def calls(self, job_id) -> list[dict]:
        return self.admin.execute("select * from model_calls where job_id = %s order by id", (job_id,)).fetchall()


class Box:
    """One scenario's world."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.queue = FakeQueue()
        self.s3 = FakeS3()
        self.reports: list[tuple[str, str | None]] = []
        self.now = 0.0

    def storage(self) -> S3Storage:
        return S3Storage("uploads", "media", "private", "https://cdn.test", client=self.s3)

    def worker(self, runner, job_cap="12", daily_cap="30", store=None) -> qw.Worker:
        def sleep(seconds):
            self.now += seconds

        def reporter(error, job_id):
            self.reports.append((error if isinstance(error, str) else type(error).__name__, job_id))

        return qw.Worker(self.queue, store or self.ctx.store, self.storage(), runner, Decimal(job_cap), Decimal(daily_cap),
                         log=qw.Log(service="test"), clock=lambda: self.now, sleep=sleep, reporter=reporter)

    def job_with_upload(self, upload_key="up-1/", **kw) -> str:
        job_id = self.ctx.new_job(upload_key=upload_key, **kw)
        self.s3.put("uploads", "up-1/00.mov", modified=datetime(2026, 10, 31, 12, 0, tzinfo=timezone.utc))
        self.s3.put("uploads", "up-1/01.mov", modified=datetime(2026, 10, 31, 12, 5, tzinfo=timezone.utc))
        return job_id

    def deliver(self, worker) -> Message | None:
        msg = self.queue.receive()
        if msg:
            worker.handle(msg)
        return msg


SCENARIOS = []


def scenario(fn):
    SCENARIOS.append(fn)
    return fn


# ---------- the requested scenarios ----------

@scenario
def a_job_runs_end_to_end(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    runner = FakeRunner({"ticks": GOOD_TICKS})
    box.deliver(box.worker(runner))

    job = ctx.job(job_id)
    assert job["stage"] == "done" and float(job["progress"]) == 1 and job["error"] is None
    assert job["finished_at"] is not None and job["attempts"] == 1
    # The upload's own newest time, not when the worker saw it.
    assert job["upload_finished_at"] == datetime(2026, 10, 31, 12, 5, tzinfo=timezone.utc)
    assert job["result_model"] == "claude-sonnet-5-5"
    assert job["result_prompt_version"].startswith("MERGE_PROMPT:")
    assert Decimal(job["cost_usd"]) == Decimal("0.75")
    assert ctx.spent() == Decimal("0.75")
    calls = ctx.calls(job_id)
    assert [c["purpose"] for c in calls] == ["extract", "merge"]
    assert calls[1]["provider"] == "anthropic" and calls[1]["prompt_version"].startswith("MERGE_PROMPT:")
    recipe = ctx.recipes()[0]
    assert recipe["status"] == "ready" and recipe["title"] == "Secret Masala" and recipe["language"] == "mr"
    prefix = runner.specs[0]["attempt_prefix"]
    folder = runner.specs[0]["recipe_id"]
    assert prefix.startswith(f"{folder}/") and prefix.endswith("-a1/")
    assert recipe["media_prefix"] == f"{folder}/"
    assert recipe["recipe_json_key"] == prefix + "recipe.json" and recipe["cover_key"] == prefix + "poster.jpg"
    for key in ("media_prefix", "recipe_json_key", "cover_key"):
        assert "://" not in recipe[key]  # keys, never URLs
    assert recipe["steps"][0]["text"] and "moment" in recipe["steps"][0] and "instruction" not in recipe["steps"][0]
    assert recipe["memories"]  # hers: kept in the database, left out of the public recipe.json
    assert ctx.question_count() == 2
    out = ctx.outbox()
    assert len(out) == 1 and out[0]["payload"]["kind"] == "recipe_published" and out[0]["request_id"] == "req-1"
    assert set(out[0]["payload"]) == {"kind", "jobId", "recipeId"}  # ids only
    assert box.queue.alive() == []
    # The raw input is kept, so a better model can run it again.
    assert box.s3.keys("uploads") == ["up-1/00.mov", "up-1/01.mov"]
    assert runner.children[0].cleaned
    assert runner.specs[0]["objects"] == [{"key": "up-1/00.mov", "size": 5}, {"key": "up-1/01.mov", "size": 5}]
    # Every line after the claim can be followed back to the request and the job.
    lines = [json.loads(line) for line in sys.stdout.getvalue().splitlines()]
    ours = [line for line in lines if line.get("job_id") == job_id]
    assert {"job claimed", "stage", "job stopped", "job done"} <= {line["msg"] for line in ours}
    assert all(line["request_id"] == "req-1" and line["outbox_id"] == "7" and line["attempt"] == 1 for line in ours)


@scenario
def a_duplicate_message_does_nothing(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    box.queue.send(job_id)  # the outbox sent it twice
    runner = FakeRunner({"ticks": GOOD_TICKS})
    worker = box.worker(runner)
    box.deliver(worker)
    box.deliver(worker)
    assert len(runner.specs) == 1 and ctx.job(job_id)["attempts"] == 1
    assert len(ctx.recipes()) == 1 and ctx.question_count() == 2 and len(ctx.outbox()) == 1
    assert ctx.spent() == Decimal("0.75")
    assert box.queue.alive() == []


@scenario
def a_crash_at_each_stage_reruns_safely(box: Box):
    ctx = box.ctx
    # While preparing: nothing recorded yet. In the model calls: the money stays counted. Before the final transaction: nothing
    # went live. After it, before the message's delete: the repeat sees a finished job and runs nothing.
    def die(_spec):
        raise Crash()

    for where, ticks in (("preparing", [GOOD_TICKS[0], die]), ("model calls", [*GOOD_TICKS[:2], {}, die])):
        job_id = box.job_with_upload()
        before = ctx.spent()
        box.queue.send(job_id)
        try:
            box.deliver(box.worker(FakeRunner({"ticks": ticks})))
            raise AssertionError("should have crashed")
        except Crash:
            pass
        assert ctx.job(job_id)["stage"] in RUNNING, where
        assert not ctx.outbox() or all(o["payload"]["jobId"] != job_id for o in ctx.outbox()), where
        # Too soon: the lease is still live, so a redelivery waits rather than doubling up.
        box.queue.time_passes()
        idle = FakeRunner({})
        box.deliver(box.worker(idle))
        assert not idle.specs, where
        ctx.stale(job_id)
        box.queue.time_passes()
        again = FakeRunner({"ticks": GOOD_TICKS})
        box.deliver(box.worker(again))
        assert again.specs[0]["attempt_prefix"].endswith("-a2/"), where  # a new folder: nothing half-written is reused
        job = ctx.job(job_id)
        assert job["stage"] == "done" and job["attempts"] == 2, where
        paid_first = Decimal("0.5") if where == "model calls" else Decimal(0)
        assert Decimal(job["cost_usd"]) == paid_first + Decimal("0.75"), where
        assert ctx.spent() == before + paid_first + Decimal("0.75"), where
        assert box.queue.alive() == [], where
    recipes_so_far = len(ctx.recipes())

    # Before the final transaction.
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    real_finish = ctx.store.finish

    def crash_finish(*_a, **_k):
        raise Crash()

    ctx.store.finish = crash_finish
    try:
        box.deliver(box.worker(FakeRunner({"ticks": GOOD_TICKS})))
        raise AssertionError("should have crashed")
    except Crash:
        pass
    finally:
        ctx.store.finish = real_finish
    assert ctx.job(job_id)["stage"] in RUNNING and len(ctx.recipes()) == recipes_so_far
    ctx.stale(job_id)
    box.queue.time_passes()
    box.deliver(box.worker(FakeRunner({"ticks": GOOD_TICKS})))
    assert ctx.job(job_id)["stage"] == "done" and len(ctx.recipes()) == recipes_so_far + 1

    # After the final transaction.
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    box.queue.crash_on_delete = True
    try:
        box.deliver(box.worker(FakeRunner({"ticks": GOOD_TICKS})))
        raise AssertionError("should have crashed")
    except Crash:
        pass
    published = len(ctx.outbox())
    assert ctx.job(job_id)["stage"] == "done" and box.queue.alive()
    box.queue.time_passes()
    idle = FakeRunner({})
    box.deliver(box.worker(idle))
    assert not idle.specs and box.queue.alive() == []
    assert ctx.job(job_id)["attempts"] == 1 and len(ctx.outbox()) == published
    assert len(ctx.recipes()) == recipes_so_far + 2


@scenario
def a_crash_on_the_last_try_tells_the_cook(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload(stage="writing", attempts=3)
    other = box.job_with_upload(stage="writing", attempts=1)
    ancient = box.job_with_upload(stage="writing", attempts=1)
    fresh = box.job_with_upload(stage="writing", attempts=3)
    ctx.stale(job_id)
    ctx.stale(other)
    ctx.stale(ancient, 90000)
    worker = box.worker(FakeRunner({}))
    worker.run(once=True)  # sweeps, finds no message, exits
    assert ctx.job(job_id)["stage"] == "failed" and ctx.job(job_id)["error"] == qw.MSG_FAILED
    assert ctx.job(job_id)["finished_at"] is not None
    assert ctx.job(ancient)["stage"] == "failed"
    assert ctx.job(other)["stage"] == "writing"  # it still has tries left
    assert ctx.job(fresh)["stage"] == "writing"  # its worker is alive
    assert ("JobAbandoned", job_id) in box.reports


@scenario
def a_second_worker_cannot_take_a_running_job(box: Box):
    ctx = box.ctx
    # Two claims at once: one wins, on two separate connections.
    job_id = box.job_with_upload()
    stores = [ctx.store, ctx.second_store()]
    barrier = threading.Barrier(2)
    wins: list[dict | None] = [None, None]

    def race(i):
        barrier.wait()
        wins[i] = stores[i].claim(job_id, qw.LEASE_S)

    threads = [threading.Thread(target=race, args=(i,)) for i in (0, 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(w is not None for w in wins) == 1 and ctx.job(job_id)["attempts"] == 1

    # The repeat message while another worker runs it: it waits, it doesn't start or delete anything.
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    second_runner = FakeRunner({})
    second = box.worker(second_runner)

    def second_worker_arrives(_spec):
        box.queue.send(job_id)
        box.deliver(second)

    first = box.worker(FakeRunner({"ticks": [GOOD_TICKS[0], second_worker_arrives, *GOOD_TICKS[1:]]}))
    box.deliver(first)
    assert not second_runner.specs
    assert ctx.job(job_id)["stage"] == "done" and ctx.job(job_id)["attempts"] == 1
    assert len(box.queue.alive()) == 1  # the repeat stays until the job is over
    assert any(h[1] == qw.DUPLICATE_HOLD_S for h in box.queue.holds)
    box.queue.time_passes()
    box.deliver(second)  # now it's over, and the repeat goes
    assert box.queue.alive() == []

    # A worker that lost its lease and doesn't know it: every write it tries changes nothing.
    job_id = box.job_with_upload()
    zombie = ctx.store.claim(job_id, qw.LEASE_S)
    ctx.stale(job_id)
    winner = ctx.store.claim(job_id, qw.LEASE_S)
    assert winner["attempts"] == zombie["attempts"] + 1
    ctx.store.progress(zombie, "writing", 0.9)
    assert ctx.job(job_id)["stage"] == "preparing"
    assert ctx.store.fail(zombie, "no") is False and ctx.store.release(zombie) is False
    assert ctx.store.heartbeat(zombie) == "lost"
    row = queue_db.recipe_row(recipe_json())
    keys = {"media_prefix": "z/", "recipe_json_key": "z/recipe.json", "cover_key": "z/poster.jpg"}
    assert ctx.store.finish(zombie, row, keys, {}, None) is False
    assert ctx.job(job_id)["stage"] == "preparing"
    assert ctx.store.finish(winner, row, keys, {}, None) is True
    assert ctx.store.finish(winner, row, keys, {}, None) is True  # a retry after a dropped COMMIT is not an error
    assert ctx.job(job_id)["stage"] == "done"


@scenario
def a_zombie_worker_publishes_nothing_and_keeps_the_message(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    msg_id = box.queue.send(job_id)

    def taken_over(_spec):
        ctx.stale(job_id)
        ctx.store.claim(job_id, qw.LEASE_S)

    before = len(ctx.recipes())
    box.deliver(box.worker(FakeRunner({"ticks": [taken_over]})))
    assert len(ctx.recipes()) == before and ctx.job(job_id)["stage"] == "preparing"
    assert box.queue.alive() == [msg_id]


@scenario
def cancelling_while_it_runs_stops_it(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    box.queue.send(job_id)

    def uploads_then_cancels(spec):
        box.s3.put("media", spec["attempt_prefix"] + "play.mp4")
        ctx.cancel(job_id)

    runner = FakeRunner({"ticks": [GOOD_TICKS[0], uploads_then_cancels], "forever": True})
    start = box.now
    box.deliver(box.worker(runner))
    assert runner.children[0].killed and box.now - start <= qw.BEAT_S + qw.TICK_S  # noticed by the next heartbeat
    job = ctx.job(job_id)
    assert job["stage"] == "failed" and job["error"] == "Cancelled." and job["finished_at"] is not None
    assert not ctx.recipes()
    assert box.s3.keys("uploads") == [] and box.s3.keys("media") == []  # her raw video and anything published go
    assert box.queue.alive() == []
    # It can't be brought back, by a repeat or by a worker that hadn't noticed.
    box.queue.send(job_id)
    idle = FakeRunner({})
    box.deliver(box.worker(idle))
    assert not idle.specs and ctx.job(job_id)["stage"] == "failed" and box.queue.alive() == []


@scenario
def cancelling_just_before_the_end_publishes_nothing(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    runner = FakeRunner({"ticks": [*GOOD_TICKS, lambda _s: box.s3.put("media", "other-family/play.mp4"), lambda _s: ctx.cancel(job_id)]})
    box.deliver(box.worker(runner))
    assert not ctx.recipes() and ctx.job(job_id)["error"] == "Cancelled."
    assert box.s3.keys("uploads") == [] and box.queue.alive() == []
    assert box.s3.keys("media") == ["other-family/play.mp4"]  # only this job's own folder is touched


@scenario
def a_job_cancelled_in_the_queue_never_starts(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    ctx.cancel(job_id)
    box.queue.send(job_id)
    runner = FakeRunner({})
    box.deliver(box.worker(runner))
    assert not runner.specs and ctx.job(job_id)["attempts"] == 0
    assert box.s3.keys("uploads") == [] and box.queue.alive() == []


@scenario
def another_cooks_stop_leaves_her_raw_video(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    kept = box.s3.keys("uploads")
    ctx.cancel(job_id, keep_upload=True)
    box.queue.send(job_id)
    runner = FakeRunner({})
    box.deliver(box.worker(runner))
    assert not runner.specs and box.queue.alive() == []
    assert box.s3.keys("uploads") == kept and kept


@scenario
def a_cancel_whose_delete_fails_stays_on_the_queue(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    ctx.cancel(job_id)
    msg_id = box.queue.send(job_id)
    box.s3.delete_error = RuntimeError("S3 is down")
    box.deliver(box.worker(FakeRunner({})))
    assert box.queue.alive() == [msg_id] and box.reports  # the footage she stopped is still there: tried again, then the alarm
    box.s3.delete_error = None
    box.queue.time_passes()
    box.deliver(box.worker(FakeRunner({})))
    assert box.queue.alive() == [] and box.s3.keys("uploads") == []


@scenario
def an_account_deleted_mid_job_leaves_nothing_behind(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    box.queue.send(job_id)

    def deleted(spec):
        box.s3.put("media", spec["attempt_prefix"] + "play.mp4")
        ctx.delete_job(job_id)

    runner = FakeRunner({"ticks": [{"calls": [call(0.5, "extract")]}, {}, deleted], "forever": True})
    box.deliver(box.worker(runner))
    assert runner.children[0].killed and not ctx.recipes()
    assert box.s3.keys("media") == [] and box.s3.keys("uploads") == [] and box.queue.alive() == []
    # A repeat message: the job is gone, and it's dropped.
    box.queue.send(job_id)
    box.deliver(box.worker(FakeRunner({})))
    assert box.queue.alive() == []
    assert ctx.spent() == Decimal("0.5")  # the money was spent, whoever it was for


@scenario
def the_job_spend_cap_stops_it(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    runner = FakeRunner({"ticks": [{"calls": [call(5.0, "extract")]}, {"calls": [call(8.0, "extract")]}], "forever": True})
    box.deliver(box.worker(runner))
    assert runner.children[0].killed
    job = ctx.job(job_id)
    assert job["stage"] == "failed" and job["error"] == qw.MSG_FAILED and Decimal(job["cost_usd"]) == Decimal(13)
    assert ("JobSpendCapReached", job_id) in box.reports and box.queue.alive() == [] and not ctx.recipes()

    # Earlier attempts count, and the length alone can stop it before any model runs.
    job_id = box.job_with_upload(cost=Decimal("11"), stage="writing", attempts=1)
    ctx.stale(job_id)
    box.queue.send(job_id)
    calls_before = len(ctx.calls(job_id))
    runner = FakeRunner({"ticks": [{"events": [{"duration_s": 3600}]}], "forever": True})
    box.deliver(box.worker(runner))
    assert runner.children[0].killed and ctx.job(job_id)["stage"] == "failed" and len(ctx.calls(job_id)) == calls_before


@scenario
def the_daily_spend_cap_makes_jobs_wait(box: Box):
    ctx = box.ctx
    ctx.set_spent(30)
    job_id = box.job_with_upload()
    msg_id = box.queue.send(job_id)
    second = box.job_with_upload()
    box.queue.send(second)
    runner = FakeRunner({})
    worker = box.worker(runner)
    box.deliver(worker)
    box.deliver(worker)
    assert not runner.specs
    job = ctx.job(job_id)
    assert job["stage"] == "queued" and job["attempts"] == 0 and job["error"] == qw.MSG_PAUSED
    held = [s for m, s in box.queue.holds if m == msg_id][-1]
    assert held == min(qw.seconds_to_next_utc_day(), qw.MAX_HOLD_S) or abs(held - qw.seconds_to_next_utc_day()) < 5
    assert held <= qw.MAX_HOLD_S < 12 * 3600 and msg_id in box.queue.alive()  # until the new UTC day, within what SQS allows
    assert len([r for r in box.reports if r[0] == "DailySpendCapReached"]) == 1  # told once

    # The new day: it runs, and the words go.
    ctx.set_spent(0)
    box.queue.time_passes()
    runner = FakeRunner({"ticks": GOOD_TICKS})
    box.deliver(box.worker(runner))
    assert runner.specs and ctx.job(job_id)["stage"] == "done" and ctx.job(job_id)["error"] is None


@scenario
def a_long_video_waits_when_it_would_pass_the_daily_cap(box: Box):
    ctx = box.ctx
    ctx.set_spent(29)
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    runner = FakeRunner({"ticks": [{"events": [{"duration_s": 3600}]}], "forever": True})  # ~$2.50, with $1 left
    box.deliver(box.worker(runner))
    assert runner.children[0].killed
    job = ctx.job(job_id)
    assert job["stage"] == "queued" and job["error"] == qw.MSG_PAUSED and job["claimed_at"] is None
    assert ctx.spent() == Decimal(29)


@scenario
def bad_model_output_fails_the_job_visibly(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    bad = recipe_json()
    bad["steps"][0]["start_s"] = 10 ** 9  # outside the video: the schema refuses it

    def bad_result(spec):
        box.s3.put("media", spec["attempt_prefix"] + "play.mp4")
        return {**good_result(spec), "recipe": bad}

    box.deliver(box.worker(FakeRunner({"ticks": GOOD_TICKS, "result": bad_result})))
    job = ctx.job(job_id)
    assert job["stage"] == "failed" and job["error"] == qw.MSG_FAILED and job["finished_at"] is not None
    assert not ctx.recipes() and ctx.question_count() == 0 and not ctx.outbox()
    assert box.s3.keys("media") == [] and box.queue.alive() == []
    assert ("ValidationError", job_id) in box.reports

    # The child found it first.
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    box.deliver(box.worker(FakeRunner({"result": {"ok": False, "kind": "bad_output", "error_type": "ProcessError"}})))
    assert ctx.job(job_id)["stage"] == "failed" and box.queue.alive() == []

    # Steps the schema has no quarrel with, but nothing to cook.
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    box.deliver(box.worker(FakeRunner({"result": lambda s: {**good_result(s), "recipe": recipe_json(steps=[])}})))
    assert ctx.job(job_id)["stage"] == "failed" and not ctx.recipes()


@scenario
def no_cooking_in_the_video_tells_the_cook_so(box: Box):
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    box.deliver(box.worker(FakeRunner({"result": {"ok": False, "kind": "no_steps", "error_type": "NoStepsError"}})))
    assert box.ctx.job(job_id)["error"] == qw.MSG_NO_STEPS and box.queue.alive() == []


@scenario
def the_message_stays_hidden_while_a_long_job_runs(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    msg_id = box.queue.send(job_id)
    runner = FakeRunner({"ticks": [{} for _ in range(int(3600 / qw.TICK_S))]})  # an hour, on the fake clock
    box.deliver(box.worker(runner))
    extends = [s for m, s in box.queue.holds if m == msg_id]
    assert all(s == qw.VISIBILITY_S for s in extends)
    assert len(extends) >= 3600 / qw.EXTEND_S  # the first on receive, then every EXTEND_S
    assert qw.VISIBILITY_S > qw.LEASE_S > qw.EXTEND_S  # a dead worker's message comes back to a lease that's over
    assert ctx.job(job_id)["stage"] == "done"

    # SQS refusing an extension doesn't stop the job: the lease is still the guard.
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    box.queue.hold_error = RuntimeError("SQS is down")
    box.deliver(box.worker(FakeRunner({"ticks": GOOD_TICKS})))
    box.queue.hold_error = None
    assert ctx.job(job_id)["stage"] == "done"


@scenario
def a_job_that_never_ends_fails_before_sqs_gives_up_on_it(box: Box):
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    runner = FakeRunner({"forever": True})
    box.deliver(box.worker(runner))
    assert runner.children[0].killed and qw.MAX_JOB_S <= box.now < 12 * 3600
    assert box.ctx.job(job_id)["stage"] == "failed" and ("JobTooSlow", job_id) in box.reports


@scenario
def a_database_outage_mid_job_stops_it_without_writes(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    msg_id = box.queue.send(job_id)
    runner = FakeRunner({"forever": True})
    worker = box.worker(runner)
    real = ctx.store.heartbeat

    def down(_claim):
        raise ConnectionError("database down")

    ctx.store.heartbeat = down
    try:
        box.deliver(worker)
    finally:
        ctx.store.heartbeat = real
    assert runner.children[0].killed and qw.LEASE_S - 2 * qw.BEAT_S <= box.now <= qw.LEASE_S  # stopped while the lease was surely still ours
    assert ctx.job(job_id)["stage"] in RUNNING and box.queue.alive() == [msg_id]
    ctx.stale(job_id)
    box.queue.time_passes()
    box.deliver(box.worker(FakeRunner({"ticks": GOOD_TICKS})))
    assert ctx.job(job_id)["stage"] == "done" and ctx.job(job_id)["attempts"] == 2


@scenario
def sigterm_stops_taking_work_and_hands_the_job_back(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    msg_id = box.queue.send(job_id)
    other = box.queue.send(box.job_with_upload())
    runner = FakeRunner({"ticks": [GOOD_TICKS[0], lambda _s: os.kill(os.getpid(), signal.SIGTERM)], "forever": True})
    worker = box.worker(runner)
    old = signal.signal(signal.SIGTERM, worker.stop)
    try:
        worker.run()  # returns: a real signal, through the same handler main() installs
    finally:
        signal.signal(signal.SIGTERM, old)
    assert worker.stopping and len(runner.specs) == 1 and runner.children[0].killed and runner.children[0].cleaned
    job = ctx.job(job_id)
    assert job["stage"] == "queued" and float(job["progress"]) == 0 and job["claimed_at"] is None and job["error"] is None
    assert box.queue.holds[-1] == (msg_id, 0)  # back on the queue at once
    assert set(box.queue.alive()) == {msg_id, other}
    assert [r for r in box.queue.rows if r["id"] == other][0]["count"] == 0  # never taken
    assert box.now < 110  # inside Fargate's 120 seconds

    # The next task picks it up from the raw upload, under a new attempt.
    next_runner = FakeRunner({"ticks": GOOD_TICKS})
    box.deliver(box.worker(next_runner))
    assert ctx.job(job_id)["stage"] == "done" and ctx.job(job_id)["attempts"] == 2
    assert next_runner.specs[0]["attempt_prefix"].endswith("-a2/")


@scenario
def sigterm_during_a_long_poll_hands_the_message_back(box: Box):
    job_id = box.job_with_upload()
    msg_id = box.queue.send(job_id)
    runner = FakeRunner({})
    worker = box.worker(runner)
    real = box.queue.receive

    def stopped_while_waiting():
        worker.stop()
        return real()

    box.queue.receive = stopped_while_waiting
    worker.run()
    assert not runner.specs and box.ctx.job(job_id)["attempts"] == 0 and box.queue.holds == [(msg_id, 0)]


@scenario
def a_failed_try_comes_back_then_tells_the_cook(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    msg_id = box.queue.send(job_id)
    outage = {"ok": False, "kind": "retry", "error_type": "APIConnectionError"}
    for receive in (1, 2):
        box.deliver(box.worker(FakeRunner({"result": outage})))
        assert ctx.job(job_id)["stage"] == "queued" and box.queue.holds[-1] == (msg_id, qw.RETRY_HOLD_S * receive)
        box.queue.time_passes()
    box.deliver(box.worker(FakeRunner({"result": None})))  # killed from outside this time: out of memory
    job = ctx.job(job_id)
    assert job["stage"] == "failed" and job["error"] == qw.MSG_FAILED and job["attempts"] == 3
    assert ("ChildDied", job_id) in box.reports
    # Its last try: the cook knows, and the message goes to the dead letters, which alarm.
    assert box.queue.holds[-1] == (msg_id, 0)
    assert box.queue.receive() is None and [r["id"] for r in box.queue.dead] == [msg_id]


@scenario
def a_missing_or_empty_upload(box: Box):
    ctx = box.ctx
    job_id = ctx.new_job(upload_key="missing/")
    msg_id = box.queue.send(job_id)
    runner = FakeRunner({})
    for _ in (1, 2):
        box.deliver(box.worker(runner))
        assert ctx.job(job_id)["stage"] == "queued" and box.queue.holds[-1] == (msg_id, qw.UPLOAD_RETRY_S)
        box.queue.time_passes()
    box.deliver(box.worker(runner))
    assert ctx.job(job_id)["stage"] == "failed" and ctx.job(job_id)["error"] == qw.MSG_NO_UPLOAD
    assert not runner.specs and box.queue.alive() == []

    box.s3.put("uploads", "empty/00.mov", b"")
    job_id = ctx.new_job(upload_key="empty/")
    box.queue.send(job_id)
    box.deliver(box.worker(runner))
    assert ctx.job(job_id)["error"] == qw.MSG_EMPTY and not runner.specs

    # A job still uploading isn't ready for a message; it waits, and in the end alarms.
    job_id = ctx.new_job(upload_key="up-1/", stage="uploading")
    msg_id = box.queue.send(job_id)
    box.deliver(box.worker(runner))
    assert ctx.job(job_id)["stage"] == "uploading" and box.queue.holds[-1] == (msg_id, qw.UPLOAD_RETRY_S)


@scenario
def a_message_that_isnt_a_job_reaches_the_dead_letters(box: Box):
    for body in ("not json", "{}", '{"payload":{}}', '{"payload":{"jobId":5}}', '{"payload":"x"}'):
        msg_id = box.queue.send(body=body)
        for _ in range(qw.MAX_RECEIVES):
            box.deliver(box.worker(FakeRunner({})))
            assert box.queue.holds[-1] == (msg_id, qw.BAD_MESSAGE_HOLD_S)
            box.queue.time_passes()
        assert box.queue.receive() is None and box.queue.dead[-1]["id"] == msg_id
    assert ("BadJobMessage", None) in box.reports


@scenario
def a_rerun_keeps_its_recipes_folder(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload(recipe={"media_prefix": "recipe-old/", "title": "Old", "status": "processing"})
    box.queue.send(job_id)
    runner = FakeRunner({"ticks": GOOD_TICKS})
    box.deliver(box.worker(runner))
    assert runner.specs[0]["recipe_id"] == "recipe-old"
    recipes = ctx.recipes()
    assert len(recipes) == 1 and recipes[0]["media_prefix"] == "recipe-old/" and recipes[0]["status"] == "ready"
    assert ctx.job(job_id)["recipe_id"]


@scenario
def model_calls_hold_no_family_content(box: Box):
    ctx = box.ctx
    job_id = box.job_with_upload()
    box.queue.send(job_id)
    calls = [call(0.1, "merge", error="ValidationError: she whispered about Secret Masala"), call(0.1, "shorten", error="she whispered"),
             call(0.1, "cover", model="something-new")]
    box.deliver(box.worker(FakeRunner({"ticks": [{"calls": calls}]})))
    rows = ctx.calls(job_id)
    assert [r["error"] for r in rows] == ["ValidationError", "rejected", None]
    assert [r["ok"] for r in rows] == [False, False, True]
    assert rows[2]["provider"] == "unknown"
    text = json.dumps([{k: str(v) for k, v in r.items()} for r in rows])
    for word in FAMILY + ("/x/ai.mp4",):
        assert word not in text


# ---------- no store needed ----------

def test_recipe_row_matches_convexs_shape():
    raw = {"id": "recipe-x", "title": "  Poha ", "language": "MR",
           "steps": [{"order": 2, "title": "Fry", "instruction": "Fry it", "start_s": 10, "end_s": 20, "quote": "hot", "tip": "low flame"},
                     {"order": 1, "instruction": "Soak", "start_s": 0, "end_s": 10, "quote_original": "भिजवा"}],
           "stories": [{"id": "s1", "step": 1, "title": "Aaji", "text": "A story", "start_s": 1, "end_s": 2},
                       {"id": "s2", "step": 9, "text": "No such step"}],
           "special": [{"id": "x1", "step": 2, "text": "Secret", "why": "Why"}],
           "follow_up_questions": [{"id": "a", "question": "Q?"}, {"id": "b", "about_step": 1, "question": "Salt?", "ingredient": "salt"},
                                   {"id": "a", "question": "Again"}, {"id": "", "question": "No id"}]}
    row = queue_db.recipe_row(raw)
    assert row["title"] == "Poha" and row["language"] == "mr" and row["library_id"] == "recipe-x"
    assert [s["order"] for s in row["steps"]] == [1, 2]
    assert row["steps"][0] == {"order": 1, "title": "Step 2", "text": "Soak", "quoteOriginal": "भिजवा", "moment": {"startS": 0, "endS": 10}}
    assert row["steps"][1]["quote"] == "hot" and "quoteOriginal" not in row["steps"][1]
    kinds = [(m["kind"], m["text"]) for m in row["memories"]]
    assert kinds == [("story", "A story"), ("story", "No such step"), ("tip", "Secret"), ("tip", "low flame")]
    assert row["memories"][1]["moment"] == {"startS": 0, "endS": 0} and "step" not in row["memories"][1]
    assert row["memories"][2]["moment"] == {"startS": 10, "endS": 20} and row["memories"][2]["why"] == "Why"
    assert [f["id"] for f in row["follow_ups"]] == ["b", "a"]  # ingredient questions first
    for broken in ({"steps": [{"instruction": "x"}]}, {"title": "t", "steps": []}, {"title": "t", "steps": [{"title": "no text"}]}):
        try:
            queue_db.recipe_row(broken)
            raise AssertionError(f"accepted {broken}")
        except ValueError:
            pass
    assert queue_db.recipe_row({**raw, "language": "not a code"})["language"] is None


def test_prompt_versions_name_a_template_never_its_text():
    version = queue_db.prompt_version("merge")
    assert re.fullmatch(r"MERGE_PROMPT:[0-9a-f]{12}", version)
    assert queue_db.prompt_version("nothing-we-know") is None
    for kind in queue_db.TEMPLATES:
        assert queue_db.prompt_version(kind), kind  # each template name is still in prompts.py


def test_real_report_reaches_observability():
    seen = []
    real = qw.observability.report_failure
    qw.observability.report_failure = lambda e, job: seen.append((type(e).__name__, job))
    try:
        qw.report("ChildDied", "j1")
        qw.report(ValueError("she whispered"), None)
    finally:
        qw.observability.report_failure = real
    assert seen == [("ChildDied", "j1"), ("ValueError", "")]


def test_recipe_folder_is_safe_for_prep():
    assert qw.recipe_folder({"id": "AbC-123_x", "media_prefix": None}) == "recipe-abc123x"
    assert qw.recipe_folder({"id": "j", "media_prefix": "recipe-old/"}) == "recipe-old"
    assert qw.recipe_folder({"id": "j", "media_prefix": "weird/deep/"}) == "recipe-j"
    claim = {"id": "0f8fad5b-d9cb-469f-a165-70867728950e", "media_prefix": None, "attempts": 2}
    assert qw.job_prefix(claim) == "recipe-0f8fad5bd9cb469fa16570867728950e/0f8fad5bd9cb-a"


def test_spec_holds_what_the_steps_need():
    claim = {"id": "j1", "attempts": 1, "title": "T", "cook_name": "C", "relation": "R", "language": None, "cook_language": "mr",
             "homie_log": [{"atS": 1}], "cover_key": "c.jpg", "video_gaps": [{"startS": 1, "endS": 2}]}
    spec = qw.spec_for(claim, [{"key": "u/0", "size": 1, "modified": datetime.now(timezone.utc)}])
    assert spec["language"] == "mr" and spec["objects"] == [{"key": "u/0", "size": 1}]
    assert spec["live"] == {"liveLog": [], "liveGaps": [], "videoGaps": [{"startS": 1, "endS": 2}]}
    json.dumps(spec)  # the child reads it from a file
    assert qw.spec_for({**claim, "video_gaps": None}, [])["live"] is None


def test_steps_are_called_with_what_they_accept():
    """The seam: if prep, process or publish change shape, this fails instead of a real job."""
    steps = queue_job.RealSteps()
    inspect.signature(steps.prep.run).bind("id", "t", "c", "r", [Path("a")])
    inspect.signature(steps.process.run).bind("id", report=print, language="en", homie_log=[], live=None, cover_photo=None)
    inspect.signature(steps.publish_mod.publish_recipe).bind("id", bucket=object(), family=True)
    calls = {}
    steps.prep = SimpleNamespace(run=lambda *a: calls.setdefault("prep", a), probe_duration=lambda p: 3.0, OUT_ROOT=steps.prep.OUT_ROOT)
    steps.process = SimpleNamespace(run=lambda rid, **kw: calls.setdefault("process", (rid, kw)))
    steps.prepare("rid", {"title": None, "cook_name": None, "relation": None}, [Path("a")])
    assert calls["prep"] == ("rid", "", "Cook", "Cook", [Path("a")])  # worker.py's defaults
    steps.process_video("rid", {"language": "mr", "homie_log": None, "live": None}, print, None)
    assert calls["process"][1]["homie_log"] == [] and calls["process"][1]["language"] == "mr"


def test_a_failed_step_is_final_only_when_another_try_cant_help():
    steps = queue_job.RealSteps()
    with tempfile.TemporaryDirectory() as tmp:
        real_root = steps.prep.OUT_ROOT
        steps.prep = SimpleNamespace(OUT_ROOT=Path(tmp))
        (Path(tmp) / "r").mkdir()
        invalid = Path(tmp) / "r" / "recipe.invalid.json"

        def error(name):
            return type(name, (Exception,), {})("x")

        assert steps.kind_of(error("NoStepsError"), "r") == "no_steps"
        assert steps.kind_of(error("ValidationError"), "r") == "bad_output"
        assert steps.kind_of(error("ProcessError"), "r") == "retry"  # no answer saved: an outage
        invalid.write_text('{"errors": ["APIConnectionError: down"]}')
        assert steps.kind_of(error("ProcessError"), "r") == "retry"  # the merge never got an answer
        invalid.write_text('{"title": "the model wrote this", "steps": []}')
        assert steps.kind_of(error("ProcessError"), "r") == "bad_output"
        assert steps.kind_of(error("RuntimeError"), "r") == "retry"
    assert queue_job.failure(queue_job.Permanent("too_long"), None, "r")["kind"] == "too_long"
    result = queue_job.failure(ValueError("she whispered"), None, "r")
    assert result == {"ok": False, "kind": "retry", "error_type": "ValueError"}  # never the text
    assert real_root


class FakeSteps:
    def __init__(self, tmp: Path, recipe: dict, seconds: float = 60):
        self.tmp, self.recipe, self.seconds = tmp, recipe, seconds
        self.published = 0
        import schema
        self.schema = schema

    def duration(self, _path):
        return self.seconds

    def prepare(self, _rid, _spec, _inputs):
        pass

    def process_video(self, _rid, _spec, report, _cover):
        report("understanding", 0.5)
        path = self.tmp / "recipe.json"
        path.write_text(json.dumps(self.recipe))
        return path

    def check(self, raw):
        self.schema.Recipe.model_validate(raw)

    def publish(self, _rid, bucket):
        self.published += 1
        bucket.blob(f"{_rid}/poster.jpg").upload_from_string("jpg", content_type="image/jpeg")
        bucket.blob(f"{_rid}/recipe.json").upload_from_string("{}", content_type="application/json")
        return self.recipe


def test_the_child_runs_the_steps_in_order():
    with tempfile.TemporaryDirectory() as tmp:
        s3 = FakeS3()
        s3.put("uploads", "up/00.mov", b"abc")
        s3.put("uploads", "up/01.mov", b"defg")
        storage = S3Storage("uploads", "media", "private", "https://cdn.test", client=s3)
        steps, events = FakeSteps(Path(tmp), recipe_json()), []
        spec = {"recipe_id": "recipe-x", "attempt_prefix": "recipe-x/abc-a1/", "dir": tmp, "cover_key": None,
                "objects": [{"key": "up/00.mov", "size": 3}, {"key": "up/01.mov", "size": 4}]}
        result = queue_job.run_job(spec, storage, steps, events.append)
        assert result["ok"] and result["recipe_json_key"] == "recipe-x/abc-a1/recipe.json"
        assert result["cover_key"] == "recipe-x/abc-a1/poster.jpg" and result["cover_version"]
        assert (Path(tmp) / "input" / "00-00.mov").read_bytes() == b"abc"
        assert {"duration_s": 120} in events and {"stage": "understanding", "progress": 0.5} in events
        assert not list((Path(tmp) / "input").glob("*.part"))


def test_the_child_uploads_nothing_when_the_output_is_bad():
    with tempfile.TemporaryDirectory() as tmp:
        s3 = FakeS3()
        s3.put("uploads", "up/00.mov", b"abc")
        storage = S3Storage("uploads", "media", "private", "https://cdn.test", client=s3)
        bad = recipe_json()
        bad["steps"][0]["start_s"] = 10 ** 9
        steps = FakeSteps(Path(tmp), bad)
        spec = {"recipe_id": "recipe-x", "attempt_prefix": "recipe-x/abc-a1/", "dir": tmp, "cover_key": None,
                "objects": [{"key": "up/00.mov", "size": 3}]}
        try:
            queue_job.run_job(spec, storage, steps, lambda e: None)
            raise AssertionError("bad output was accepted")
        except ValueError as e:  # pydantic's ValidationError
            assert type(e).__name__ == "ValidationError"
        assert s3.keys("media") == [] and steps.published == 0


def test_the_child_stops_at_the_length_limit_and_on_a_short_download():
    with tempfile.TemporaryDirectory() as tmp:
        s3 = FakeS3()
        s3.put("uploads", "up/00.mov", b"abc")
        storage = S3Storage("uploads", "media", "private", "https://cdn.test", client=s3)
        spec = {"recipe_id": "r", "attempt_prefix": "r/a1/", "dir": tmp, "cover_key": None, "objects": [{"key": "up/00.mov", "size": 3}]}
        events = []
        try:
            queue_job.run_job(spec, storage, FakeSteps(Path(tmp), {}, seconds=queue_job.MAX_HOURS * 3600 + 1), events.append)
            raise AssertionError("too long was accepted")
        except queue_job.Permanent as e:
            assert e.kind == "too_long" and any("duration_s" in x for x in events)
        spec["objects"][0]["size"] = 99
        try:
            queue_job.run_job(spec, storage, FakeSteps(Path(tmp), {}), lambda e: None)
            raise AssertionError("short download was accepted")
        except RuntimeError:
            pass
        assert not (Path(tmp) / "input" / "00-00.mov").exists() or (Path(tmp) / "input" / "00-00.mov").stat().st_size == 3


def test_a_partly_failed_s3_delete_is_an_error_and_names_no_key():
    s3 = FakeS3()
    s3.put("uploads", "family-a/00.mov")
    s3.delete_answer = {"Errors": [{"Key": "family-a/00.mov", "Code": "AccessDenied", "Message": "no"}]}
    storage = S3Storage("uploads", "media", None, "https://cdn.test", client=s3)
    try:
        storage.delete_upload("family-a/")
    except RuntimeError as e:
        assert "AccessDenied" in str(e) and "family-a" not in str(e)
    else:
        raise AssertionError("a refused delete must not look like success")


def test_upload_listing_and_cancel_delete_stay_in_their_own_folder():
    s3 = FakeS3()
    for key in ("a/00.mov", "a/01.mov", "ab/00.mov", "glasses/rec1.mp4", "glasses/rec2.mp4", "b/"):
        s3.put("uploads", key)
    storage = S3Storage("uploads", "media", None, "https://cdn.test", client=s3)
    assert [r["key"] for r in storage.list_upload("a/")] == ["a/00.mov", "a/01.mov"]
    assert [r["key"] for r in storage.list_upload("a")] == ["a/00.mov", "a/01.mov"]  # worker.py's _upload_blobs: a folder too
    assert [r["key"] for r in storage.list_upload("glasses/rec1.mp4")] == ["glasses/rec1.mp4"]
    assert storage.list_upload("b/") == [] and storage.list_upload("nothing/") == []
    assert storage.delete_upload("glasses/rec1.mp4") == 1
    assert storage.delete_upload("a/") == 2
    assert s3.keys("uploads") == ["ab/00.mov", "b/", "glasses/rec2.mp4"]
    # Paged listings are followed, and an endless one stops.
    pages = {None: {"Contents": [{"Key": "x/1", "Size": 1, "LastModified": 0}], "NextContinuationToken": "t"},
             "t": {"Contents": [{"Key": "x/2", "Size": 1, "LastModified": 0}]}}
    paged = SimpleNamespace(list_objects_v2=lambda Bucket, Prefix, ContinuationToken=None: pages[ContinuationToken],
                            head_object=lambda **_k: raise_404())
    assert len(S3Storage("u", "m", None, "b", client=paged).list_upload("x/")) == 2
    endless = SimpleNamespace(list_objects_v2=lambda **_k: {"Contents": [], "NextContinuationToken": "t"}, head_object=lambda **_k: raise_404())
    try:
        S3Storage("u", "m", None, "b", client=endless).list_upload("x/")
        raise AssertionError("an endless listing never stopped")
    except RuntimeError:
        pass


def test_a_cover_that_cant_be_fetched_never_fails_the_job():
    with tempfile.TemporaryDirectory() as tmp:
        s3 = FakeS3()
        dest = Path(tmp) / "c.jpg"
        storage = S3Storage("u", "m", "private", "b", client=s3)
        assert storage.download_cover("nope.jpg", dest) is None
        s3.put("private", "big.jpg", b"x" * (queue_aws.MAX_COVER_BYTES + 1))
        assert storage.download_cover("big.jpg", dest) is None
        s3.put("private", "ok.jpg", b"jpg")
        assert storage.download_cover("ok.jpg", dest) == dest and dest.read_bytes() == b"jpg"
        denied = SimpleNamespace(head_object=lambda **_k: (_ for _ in ()).throw(PermissionError("no")))
        assert S3Storage("u", "m", "private", "b", client=denied).download_cover("k", dest) is None


def test_publish_runs_unchanged_on_the_s3_bucket():
    """The real publish.publish_recipe on queue_aws.S3Bucket: the attempt's folder, no GCS host, and family stories left out."""
    import publish
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        folder = out / "recipe-x"
        (folder / "work").mkdir(parents=True)
        for name in ("play.mp4", "voice.m4a", "poster.jpg"):
            (folder / name).write_bytes(name.encode())
        local = recipe_json()
        local["media"].update(video_url="play.mp4", audio_url="voice.m4a", poster_url="poster.jpg")
        (folder / "recipe.json").write_text(json.dumps(local))
        s3 = FakeS3()
        storage = S3Storage("uploads", "media", "private", "https://media.test/", client=s3)
        bucket = storage.media_bucket("recipe-x", "recipe-x/abc-a2/")
        real = publish.OUT, publish.grab_still, publish._video_size
        publish.OUT = out
        publish.grab_still = lambda _play, _t, dest: dest.write_bytes(b"still")
        publish._video_size = lambda _path: (720, 1280)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                recipe = publish.publish_recipe("recipe-x", bucket=bucket, family=True)
                first = dict(s3.objects)
                publish.publish_recipe("recipe-x", bucket=bucket, family=True)  # again, as after a retry
        finally:
            publish.OUT, publish.grab_still, publish._video_size = real
        keys = s3.keys("media")
        assert all(k.startswith("recipe-x/abc-a2/") for k in keys) and "recipe-x/abc-a2/play.mp4" in keys
        assert "recipe-x/abc-a2/steps/01.jpg" in keys
        assert recipe.stories, "the database gets her stories"
        public = json.loads(s3.objects[("media", "recipe-x/abc-a2/recipe.json")]["Body"])
        assert public["family"] is True and public["stories"] == [] and public["special"] == []
        assert public["media"]["video_url"].startswith("https://media.test/recipe-x/abc-a2/play.mp4?v=ver")
        assert public["steps"][0]["image_url"].startswith("https://media.test/recipe-x/abc-a2/steps/01.jpg")
        assert "googleapis" not in json.dumps(public)
        assert s3.objects[("media", "recipe-x/abc-a2/play.mp4")]["extra"]["CacheControl"] == publish.MEDIA_CACHE
        assert s3.objects[("media", "recipe-x/abc-a2/recipe.json")]["extra"]["CacheControl"] == publish.JSON_CACHE
        # The second publish found the same bytes by the md5 it recorded, and uploaded no video again.
        assert first[("media", "recipe-x/abc-a2/play.mp4")] is s3.objects[("media", "recipe-x/abc-a2/play.mp4")]


def test_real_prep_and_publish_on_a_real_clip():
    """The seam for real: ffmpeg on a real file, through prep.run and publish.publish_recipe, with only the model step faked."""
    import shutil
    if not shutil.which("ffmpeg"):
        raise Skip("ffmpeg isn't installed")
    steps = queue_job.RealSteps()
    import publish
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        clip = tmp / "raw.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=10",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", str(clip)], check=True, timeout=120)
        s3 = FakeS3()
        s3.put("uploads", "up/clip one.mp4", clip.read_bytes())
        storage = S3Storage("uploads", "media", "private", "https://media.test", client=s3)
        spec = {"recipe_id": "recipe-real", "attempt_prefix": "recipe-real/abc-a1/", "dir": str(tmp / "work"), "cover_key": None,
                "objects": [{"key": "up/clip one.mp4", "size": clip.stat().st_size}], "title": "Secret Masala", "cook_name": "Aaji Pawar",
                "relation": "Aaji"}

        def fake_model_step(recipe_id, **_kw):
            out = tmp / "out" / recipe_id
            manifest = json.loads((out / "work" / "manifest.json").read_text())
            raw = recipe_json(id=recipe_id, stories=[], special=[], follow_up_questions=[], ingredients=[], sessions=[])
            step = {**raw["steps"][0], "order": 1, "start_s": 0, "end_s": manifest["duration_s"], "story_ids": [], "special_ids": []}
            raw.update(steps=[step])
            raw["media"].update(video_url="play.mp4", audio_url="voice.m4a", poster_url="poster.jpg", duration_s=manifest["duration_s"])
            (out / "recipe.json").write_text(json.dumps(raw))
            return out / "recipe.json"

        steps.process = SimpleNamespace(run=fake_model_step)
        real = steps.prep.OUT_ROOT, publish.OUT
        steps.prep.OUT_ROOT, publish.OUT = tmp / "out", tmp / "out"
        events = []
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                result = queue_job.run_job(spec, storage, steps, events.append)
        finally:
            steps.prep.OUT_ROOT, publish.OUT = real
        assert result["ok"] and result["recipe"]["media"]["width"] and result["cover_key"] == "recipe-real/abc-a1/poster.jpg"
        assert set(s3.keys("media")) == {f"recipe-real/abc-a1/{f}" for f in ("play.mp4", "voice.m4a", "poster.jpg", "recipe.json", "steps/01.jpg")}
        assert s3.objects[("media", "recipe-real/abc-a1/play.mp4")]["ContentLength"] > 0
        assert any("duration_s" in e and 3 < e["duration_s"] < 5 for e in events)
        import schema
        schema.Recipe.model_validate(result["recipe"])
        assert queue_db.recipe_row(result["recipe"])["steps"]


def test_the_child_writes_a_result_whatever_happens():
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        spec_path = tmp / "spec.json"
        spec_path.write_text(json.dumps({"dir": str(tmp), "recipe_id": "r"}))
        real = queue_job._die_with_parent, queue_job.RealSteps, queue_job.run_job
        queue_job._die_with_parent = lambda: None

        class Steps:
            def kind_of(self, error, _rid):
                return "no_steps" if isinstance(error, KeyError) else "retry"

        queue_job.RealSteps = Steps
        os.environ.update(UPLOAD_BUCKET="u", MEDIA_BUCKET="m", MEDIA_BASE_URL="https://b")
        real_client = queue_aws.S3Storage.__init__
        queue_aws.S3Storage.__init__ = lambda self, *a, **k: real_client(self, *a, client=FakeS3())
        try:
            queue_job.run_job = lambda spec, storage, steps, emit: (emit({"stage": "writing", "progress": 0.9}), {"ok": True, "recipe": {}})[1]
            assert queue_job.main(str(spec_path)) == 0
            assert json.loads((tmp / "result.json").read_text()) == {"ok": True, "recipe": {}}
            assert json.loads((tmp / "events.jsonl").read_text().splitlines()[0])["stage"] == "writing"

            def explode(*_a):
                raise KeyError("she whispered")

            queue_job.run_job = explode
            assert queue_job.main(str(spec_path)) == 0
            assert json.loads((tmp / "result.json").read_text()) == {"ok": False, "kind": "no_steps", "error_type": "KeyError"}

            def leaves(*_a):
                sys.exit("process: error: she whispered")

            queue_job.run_job = leaves
            assert queue_job.main(str(spec_path)) == 0
            assert json.loads((tmp / "result.json").read_text())["error_type"] == "SystemExit"
        finally:
            queue_job._die_with_parent, queue_job.RealSteps, queue_job.run_job = real
            queue_aws.S3Storage.__init__ = real_client
            for name in ("UPLOAD_BUCKET", "MEDIA_BUCKET", "MEDIA_BASE_URL"):
                os.environ.pop(name, None)


def test_the_real_child_program_starts_and_reports_a_missing_setting():
    """queue_job.py itself, as ChildRunner starts it, with the whole pipeline imported, and no AWS call: no bucket is set."""
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        runner = qw.ChildRunner(work_root=tmp / "work", out_root=tmp / "out")
        for name in ("UPLOAD_BUCKET", "MEDIA_BUCKET", "MEDIA_BASE_URL"):
            os.environ.pop(name, None)
        child = runner.start({"recipe_id": "recipe-z"})
        deadline = time.monotonic() + 120
        while child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        assert child.poll() == 0
        assert child.result() == {"ok": False, "kind": "retry", "error_type": "KeyError"}
        child.cleanup()


# ---------- real processes ----------

HELPER = """
import json, os, subprocess, sys, time
spec = json.load(open(sys.argv[1]))
work = spec["dir"]
print("she whispered, on stdout", flush=True)
print("she whispered, on stderr", file=sys.stderr, flush=True)
mode = spec["mode"]
events = open(os.path.join(work, "events.jsonl"), "a", buffering=1)
events.write(json.dumps({"stage": "preparing", "progress": 0.1}) + "\\n")
events.write('{"partial": ')  # a line still being written: not read until it's whole
events.flush()
usage = spec["usage"]
os.makedirs(os.path.dirname(usage), exist_ok=True)
open(usage, "w").write('{"calls": [')  # half-written, as process.Usage can leave it for a moment
if mode == "hang":
    subprocess.Popen(["sh", "-c", 'while :; do echo x >> "$0"; sleep 0.1; done', spec["ticks"]])
    time.sleep(120)
time.sleep(0.3)
events.write('1}\\n')
open(usage, "w").write(json.dumps({"calls": [{"kind": "merge"}]}))
open(os.path.join(work, "result.json"), "w").write(json.dumps({"ok": False, "kind": "retry"}))
"""


def _real_runner(tmp: Path) -> tuple[qw.ChildRunner, Path]:
    helper = tmp / "helper.py"
    helper.write_text(HELPER)
    return qw.ChildRunner(command=[sys.executable, str(helper)], work_root=tmp / "work", out_root=tmp / "out"), tmp


def test_a_real_child_reports_through_its_files():
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        runner, _ = _real_runner(tmp)
        stale = tmp / "out" / "recipe-x" / "leftover.txt"
        stale.parent.mkdir(parents=True)
        stale.write_text("from a crashed run")
        usage = tmp / "out" / "recipe-x" / "work" / "usage.json"
        spec = {"recipe_id": "recipe-x", "mode": "finish", "usage": str(usage)}
        saved = os.dup(1), os.dup(2)
        with open(tmp / "captured", "wb") as sink:  # the real file descriptors: the child's own output
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)
            try:
                child = runner.start(spec)
                seen, calls = [], []
                deadline = time.monotonic() + 20
                while child.poll() is None and time.monotonic() < deadline:
                    seen += child.events()
                    calls += child.calls()
                    time.sleep(0.05)
            finally:
                os.dup2(saved[0], 1)
                os.dup2(saved[1], 2)
                os.close(saved[0])
                os.close(saved[1])
        seen += child.events()
        calls += child.calls()
        assert child.poll() == 0
        assert not stale.exists()  # every attempt starts clean
        assert seen == [{"stage": "preparing", "progress": 0.1}, {"partial": 1}]
        assert calls == [{"kind": "merge"}] and child.calls() == []  # each call once
        assert child.result() == {"ok": False, "kind": "retry"}
        assert "she whispered" not in (tmp / "captured").read_text()  # its output doesn't reach the logs
        assert (Path(child.work) / "spec.json").stat().st_mode & 0o777 == 0o600
        child.sample()
        assert child.disk_peak > 0 and child.usage()["cpu_s"] >= 0
        child.cleanup()
        assert not child.work.exists() and not child.out_dir.exists()


def test_killing_a_real_child_takes_ffmpeg_with_it():
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        runner, _ = _real_runner(tmp)
        ticks = tmp / "ticks"
        spec = {"recipe_id": "recipe-y", "mode": "hang", "usage": str(tmp / "out" / "recipe-y" / "work" / "usage.json"), "ticks": str(ticks)}
        child = runner.start(spec)
        deadline = time.monotonic() + 20
        while not ticks.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert ticks.exists() and child.poll() is None
        child.kill()
        assert child.poll() is not None
        size = ticks.stat().st_size
        time.sleep(0.5)
        assert ticks.stat().st_size == size, "the grandchild outlived the kill"
        child.kill()  # twice is harmless
        child.cleanup()


def test_a_real_child_dies_with_its_parent():
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        ticks = tmp / "ticks"
        grandchild = tmp / "grandchild.py"
        grandchild.write_text(
            f"import sys, time; sys.path.insert(0, {str(ROOT / 'pipeline')!r}); import queue_job; queue_job._die_with_parent()\n"
            f"while True:\n    open({str(ticks)!r}, 'a').write('x'); time.sleep(0.1)\n")
        parent = tmp / "parent.py"
        parent.write_text(f"import subprocess, sys, time; subprocess.Popen([sys.executable, {str(grandchild)!r}], start_new_session=True); time.sleep(1)\n")
        subprocess.run([sys.executable, str(parent)], check=True, timeout=20)
        deadline = time.monotonic() + 15
        size = -1
        while time.monotonic() < deadline:
            now = ticks.stat().st_size
            if now == size:
                break
            size = now
            time.sleep(0.5)
        else:
            raise AssertionError("the orphan kept running")


def test_a_real_sigterm_to_a_real_process_stops_cleanly():
    """The whole stop: a real worker process, a real child with a grandchild, the real signal. Only SQS, S3 and the store are fakes."""
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        (tmp / "helper.py").write_text(HELPER)
        ticks = tmp / "ticks"
        script = tmp / "real_worker.py"
        script.write_text(f"""
import json, signal, sys
sys.path.insert(0, {str(ROOT / 'pipeline')!r})
import queue_worker as qw
import test_queue_worker as t
from pathlib import Path
tmp = Path({tmp_name!r})
box = t.Box(t.FakeContext())
job_id = box.job_with_upload()
box.queue.send(job_id)

class Runner(qw.ChildRunner):
    def start(self, spec):
        return super().start({{**spec, "mode": "hang", "ticks": {str(ticks)!r}, "usage": str(tmp / "out" / spec["recipe_id"] / "work" / "usage.json")}})

worker = box.worker(Runner(command=[sys.executable, str(tmp / "helper.py")], work_root=tmp / "work", out_root=tmp / "out"))
worker.clock, worker.sleep = __import__("time").monotonic, __import__("time").sleep
signal.signal(signal.SIGTERM, worker.stop)
worker.run()
print("RESULT " + json.dumps({{"stage": box.ctx.job(job_id)["stage"], "holds": box.queue.holds, "alive": box.queue.alive(),
                               "left": [str(p) for p in (tmp / "work").iterdir()]}}), flush=True)
""")
        proc = subprocess.Popen([sys.executable, str(script)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.monotonic() + 60
        while not ticks.exists() and time.monotonic() < deadline and proc.poll() is None:
            time.sleep(0.05)
        assert ticks.exists(), proc.communicate(timeout=5)[0][-2000:] if proc.poll() is not None else "no child"
        started = time.monotonic()
        proc.send_signal(signal.SIGTERM)
        out, _ = proc.communicate(timeout=30)
        assert proc.returncode == 0, out[-2000:]
        assert time.monotonic() - started < 10  # well inside Fargate's 120 seconds
        size = ticks.stat().st_size
        time.sleep(0.5)
        assert ticks.stat().st_size == size, "the grandchild outlived the stop"
        final = json.loads(next(line for line in out.splitlines() if line.startswith("RESULT "))[7:])
        assert final["stage"] == "queued" and final["holds"][-1][1] == 0 and final["alive"] == final["holds"][-1][:1]
        assert final["left"] == []  # the job's folder went with it


# ---------- Convex mode is unchanged ----------

def test_convex_mode_needs_nothing_new_and_nothing_loads_it():
    code = """
import sys
sys.modules["boto3"] = None; sys.modules["botocore"] = None; sys.modules["psycopg"] = None
sys.path.insert(0, sys.argv[1])
import worker
new = {"queue_worker", "queue_db", "queue_aws", "queue_job"} & set(sys.modules)
assert not new, new
import queue_worker, queue_db, queue_aws, queue_job  # the new code imports without them too
print("clean")
"""
    res = subprocess.run([sys.executable, "-c", code, str(ROOT / "pipeline")], capture_output=True, text=True, timeout=120)
    assert res.returncode == 0 and "clean" in res.stdout, res.stderr[-2000:]


def test_worker_py_has_no_door_into_queue_mode():
    source = (ROOT / "pipeline" / "worker.py").read_text()
    assert "queue_worker" not in source and "boto3" not in source and "psycopg" not in source
    assert "queue_worker" not in (ROOT / "pipeline" / "Dockerfile").read_text().split("ENTRYPOINT")[-1]
    assert (ROOT / "pipeline" / "Dockerfile").read_text().rstrip().endswith('ENTRYPOINT ["python", "pipeline/worker.py"]')


def test_queue_mode_refuses_to_start_without_being_set_up():
    env = {k: v for k, v in os.environ.items() if k not in ("JOBS_QUEUE_URL", "UPLOAD_BUCKET", "MEDIA_BUCKET", "MEDIA_BASE_URL", "DEPLOY_ENV")}
    res = subprocess.run([sys.executable, str(ROOT / "pipeline" / "queue_worker.py"), "--once"], capture_output=True, text=True, env=env,
                         timeout=120, cwd=tempfile.gettempdir())
    assert res.returncode != 0 and "not set: JOBS_QUEUE_URL" in res.stderr


def test_public_url_is_unchanged_for_gcs():
    import publish
    from google.cloud import storage
    plain = SimpleNamespace(name="edible-media-x")
    assert publish.public_url(plain, "r/recipe.json") == "https://storage.googleapis.com/edible-media-x/r/recipe.json"
    real = storage.Bucket(client=None, name="edible-media-x")
    assert publish.public_url(real, "r/play.mp4") == "https://storage.googleapis.com/edible-media-x/r/play.mp4"
    assert publish.public_url(SimpleNamespace(name="b", public_base="https://media.test"), "k") == "https://media.test/k"


def test_shared_words_and_limits_match_worker_py():
    import prep
    import worker
    for name in ("MSG_FAILED", "MSG_EMPTY", "MSG_TOO_LONG", "MSG_PAUSED", "MSG_NO_STEPS", "MSG_NO_UPLOAD"):
        assert getattr(qw, name) == getattr(worker, name), name
    assert queue_job.MAX_HOURS == worker.MAX_HOURS and queue_job.COST_PER_HOUR_USD == worker.COST_PER_HOUR_USD
    assert queue_aws.MAX_COVER_BYTES == worker.MAX_COVER_BYTES
    assert qw.OUT_ROOT == prep.OUT_ROOT


def test_settings_match_the_real_queue():
    tf = (ROOT / "infra" / "modules" / "env" / "queues.tf").read_text()
    assert int(re.search(r"maxReceiveCount\s*=\s*(\d+)", tf).group(1)) == qw.MAX_RECEIVES
    assert int(re.search(r"visibility_timeout_seconds\s*=\s*(\d+)", tf).group(1)) >= qw.VISIBILITY_S
    services = (ROOT / "infra" / "modules" / "env" / "services.tf").read_text()
    for name in ("JOBS_QUEUE_URL", "UPLOAD_BUCKET", "MEDIA_BUCKET", "PRIVATE_BUCKET", "DEPLOY_ENV", "DB_HOST", "DB_CREDENTIALS"):
        assert name in services, name


# ---------- boto3's own model of the calls (no network: the Stubber answers) ----------

def test_sqs_and_s3_calls_match_boto3():
    try:
        import boto3
        from botocore.stub import Stubber
    except ImportError:
        raise Skip("boto3 isn't installed")
    session = boto3.session.Session(aws_access_key_id="testing", aws_secret_access_key="testing", region_name="us-west-2")
    sqs = session.client("sqs", config=queue_aws._config(connect_timeout=5, read_timeout=30))
    queue = SqsQueue("https://sqs.test/jobs", client=sqs)
    with Stubber(sqs) as stub:
        stub.add_response("receive_message", {"Messages": [{"MessageId": "m1", "ReceiptHandle": "r1", "Body": "{}",
                                                            "Attributes": {"ApproximateReceiveCount": "2"}}]},
                          {"QueueUrl": queue.url, "MaxNumberOfMessages": 1, "WaitTimeSeconds": 20,
                           "MessageSystemAttributeNames": ["ApproximateReceiveCount"]})
        stub.add_response("receive_message", {})
        stub.add_response("change_message_visibility", {}, {"QueueUrl": queue.url, "ReceiptHandle": "r1", "VisibilityTimeout": 900})
        stub.add_response("delete_message", {}, {"QueueUrl": queue.url, "ReceiptHandle": "r1"})
        msg = queue.receive()
        assert msg == Message("m1", "r1", "{}", 2) and queue.receive() is None
        queue.hold(msg, 900)
        queue.delete(msg)
        stub.assert_no_pending_responses()
    s3 = session.client("s3", config=queue_aws._config(connect_timeout=10, read_timeout=120))
    storage = S3Storage("uploads", "media", "private", "https://cdn.test", client=s3)
    with Stubber(s3) as stub:
        stub.add_client_error("head_object", service_error_code="404", http_status_code=404)
        stub.add_response("list_objects_v2", {"Contents": [{"Key": "a/00.mov", "Size": 3, "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc)}]},
                          {"Bucket": "uploads", "Prefix": "a/"})
        stub.add_response("list_objects_v2", {"Contents": []}, {"Bucket": "media", "Prefix": "r/x-a"})
        stub.add_response("delete_objects", {}, {"Bucket": "uploads", "Delete": {"Objects": [{"Key": "a/00.mov"}], "Quiet": True}})
        stub.add_response("put_object", {}, {"Bucket": "media", "Key": "r/a1/recipe.json", "Body": b"{}", "ContentType": "application/json",
                                             "CacheControl": "no-cache", "Metadata": {"md5": "mZFLkyvTelC5g8XnyQrpOw=="}})
        stub.add_response("head_object", {"VersionId": "v9", "Metadata": {"md5": "abc"}, "ContentLength": 2}, {"Bucket": "media", "Key": "r/a1/recipe.json"})
        assert [r["key"] for r in storage.list_upload("a")] == ["a/00.mov"]
        assert storage.delete_media("r/x-a") == 0
        assert storage._delete("uploads", ["a/00.mov"]) == 1
        blob = storage.media_bucket("r", "r/a1/").blob("r/recipe.json")
        blob.cache_control = "no-cache"
        blob.upload_from_string("{}", content_type="application/json")
        blob.reload()
        assert blob.generation == "v9" and blob.md5_hash == "abc"
        stub.assert_no_pending_responses()


# ---------- real Postgres only ----------

def _postgres() -> PostgresContext:
    if not DATABASE_URL:
        raise Skip("TEST_DATABASE_URL isn't set")
    return PostgresContext(DATABASE_URL)


def test_postgres_the_final_save_is_all_or_nothing():
    ctx = _postgres()
    job_id = ctx.new_job()
    claim = ctx.store.claim(job_id, qw.LEASE_S)
    row = queue_db.recipe_row(recipe_json())
    row["follow_ups"][0]["question"] = "x" * 3000  # the table's CHECK refuses it, after the recipe was written
    keys = {"media_prefix": "z/", "recipe_json_key": "z/recipe.json", "cover_key": "z/poster.jpg"}
    try:
        ctx.store.finish(claim, row, keys, {}, None)
        raise AssertionError("the bad question was accepted")
    except Exception as e:  # noqa: BLE001
        assert type(e).__name__ == "CheckViolation", type(e).__name__
    assert not ctx.recipes() and ctx.question_count() == 0 and ctx.job(job_id)["stage"] == "preparing"
    assert ctx.job(job_id)["recipe_id"] is None and not ctx.outbox()


def test_postgres_refuses_a_url_where_a_key_goes():
    ctx = _postgres()
    job_id = ctx.new_job()
    claim = ctx.store.claim(job_id, qw.LEASE_S)
    row = queue_db.recipe_row(recipe_json())
    keys = {"media_prefix": "z/", "recipe_json_key": "https://media.test/z/recipe.json", "cover_key": "z/poster.jpg"}
    try:
        ctx.store.finish(claim, row, keys, {}, None)
        raise AssertionError("a URL was saved as a key")
    except Exception as e:  # noqa: BLE001
        assert type(e).__name__ == "CheckViolation", type(e).__name__
    assert not ctx.recipes()


def test_postgres_reconnects_after_a_lost_connection():
    ctx = _postgres()
    job_id = ctx.new_job()
    claim = ctx.store.claim(job_id, qw.LEASE_S)
    pid = ctx.store.conn.info.backend_pid
    ctx.admin.execute("select pg_terminate_backend(%s)", (pid,))
    time.sleep(0.2)
    assert ctx.store.heartbeat(claim) == "ok"  # a failover looks like this
    assert ctx.store.conn.info.backend_pid != pid


def test_postgres_claim_brings_what_the_steps_need():
    import prompts
    ctx = _postgres()
    started = datetime(2026, 10, 31, 12, 0, 10, tzinfo=timezone.utc)
    recording = ctx.admin.execute(
        """insert into recordings (family_id, cook_id, source, status, started_at, video_started_at, memories_opt_in, cover_key)
           values (%s, %s, 'phone', 'ended', %s, %s, true, 'covers/plate.jpg') returning id""",
        (ctx.family, ctx.cook, started, started - timedelta(seconds=10))).fetchone()["id"]
    ctx.admin.execute(
        """insert into homie_prompts (recording_id, kind, text, text_en, at_s, status, answer_transcript, answer_at_s, answer_end_s)
           values (%s, 'amount', 'किती?', 'How much?', 5, 'answered', 'एक चमचा', 6, 7),
                  (%s, 'intro', 'Hi', 'Hi', -20, 'spoken', null, null, null)""", (recording, recording))
    job_id = ctx.new_job()
    ctx.admin.execute("update jobs set recording_id = %s, video_gaps = %s::jsonb where id = %s",
                      (recording, '[{"startS": 1, "endS": 2}]', job_id))
    claim = ctx.store.claim(job_id, qw.LEASE_S)
    assert claim["cook_name"] == "Aaji Pawar" and claim["cook_language"] == "mr"
    assert claim["memories_opt_in"] is True and claim["cover_key"] == "covers/plate.jpg"
    assert claim["video_gaps"] == [{"startS": 1, "endS": 2}]
    assert claim["homie_log"] == [{"atS": 15.0, "kind": "amount", "text": "किती?", "textEn": "How much?",
                                   "answer": {"transcript": "एक चमचा", "atS": 16.0, "endS": 17.0}}]  # the one before filming is left out
    assert "How much?" in prompts.context("mr", claim["homie_log"])  # the step reads this shape
    # A job stuck on a person's language isn't a thing: the row's own language wins.
    assert claim["language"] == "mr"


def test_postgres_writes_touch_only_this_job_and_use_real_types():
    ctx = _postgres()
    job_id, other = ctx.new_job(), ctx.new_job()
    claim = ctx.store.claim(job_id, qw.LEASE_S)
    assert ctx.job(other)["stage"] == "queued" and ctx.job(job_id)["heartbeat_at"] is not None
    ctx.store.upload_finished(claim, datetime(2026, 1, 1, tzinfo=timezone.utc))
    ctx.store.upload_finished(claim, datetime(2026, 2, 2, tzinfo=timezone.utc))
    assert ctx.job(job_id)["upload_finished_at"] == datetime(2026, 1, 1, tzinfo=timezone.utc)  # the first answer stands
    ctx.store.progress(claim, "understanding", 1.5)
    assert float(ctx.job(job_id)["progress"]) == 1.0
    total = ctx.store.record_calls(job_id, [call(0.123456), call(1.0)])
    assert total == Decimal("1.123456") and ctx.store.spent_today() == Decimal("1.123456")
    assert ctx.store.record_calls("no-such-job", [call(1.0)]) == Decimal("1.0")  # money spent counts, with no job to name
    assert ctx.admin.execute("select count(*) as n from model_calls where job_id is null").fetchone()["n"] >= 1
    assert ctx.store.note_daily_cap() is True and ctx.store.note_daily_cap() is False
    row = queue_db.recipe_row(recipe_json())
    keys = {"media_prefix": "z/", "recipe_json_key": "z/recipe.json", "cover_key": "z/poster.jpg", "cover_version": "v9"}
    assert ctx.store.finish(claim, row, keys, {"model": "m", "prompt_version": "p"}, "req") is True
    recipe = ctx.recipes()[0]
    assert recipe["cover_version"] == "v9" and recipe["step_count"] == len(row["steps"]) and recipe["library_id"] == "recipe-x"
    assert recipe["memories_opt_in"] is False  # no recording, no yes
    counts = ctx.admin.execute("select count(*) as n, count(recipe_id) as linked from model_calls where job_id = %s", (job_id,)).fetchone()
    assert counts["n"] == 2 and counts["linked"] == 2  # which recipe each call went into


# ---------- the runner ----------

def _reset_database() -> None:
    import psycopg
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute("drop schema public cascade; create schema public")
        for path in sorted((ROOT / "api" / "migrations").glob("*.sql")):
            conn.execute(path.read_text())


def main() -> None:
    contexts = [FakeContext]
    skipped: list[str] = []
    if DATABASE_URL:
        try:
            import psycopg  # noqa: F401
        except ImportError:
            print("TEST_DATABASE_URL is set but psycopg isn't installed (pipeline/requirements-queue.txt)")
            sys.exit(1)
        _reset_database()
        contexts.append(lambda: PostgresContext(DATABASE_URL))
    else:
        skipped += [f"{fn.__name__} [postgres]" for fn in SCENARIOS]

    tests = []
    for fn in SCENARIOS:
        for make in contexts:
            label = "fake" if make is FakeContext else "postgres"
            tests.append((f"{fn.__name__} [{label}]", lambda fn=fn, make=make: fn(Box(make()))))
    tests += [(n, f) for n, f in globals().items() if n.startswith("test_") and callable(f)]

    failed = 0
    for name, fn in tests:
        logs = io.StringIO()
        try:
            with contextlib.redirect_stdout(logs):
                fn()
            for line in logs.getvalue().splitlines():
                json.loads(line)  # every line is JSON
            for word in FAMILY:
                assert word not in logs.getvalue(), f"{word!r} reached the logs"
        except Skip as e:
            skipped.append(f"{name}: {e}")
            print(f"skip {name}: {e}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
            print(logs.getvalue()[-3000:])
        else:
            print(f"ok   {name}")
    print(f"{len(tests) - failed - len([s for s in skipped if ':' in s])}/{len(tests)} passed, {failed} failed, {len(skipped)} skipped")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
