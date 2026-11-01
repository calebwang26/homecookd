"""The worker's side of the contract, for jobsWorker.test.ts: the real pipeline/queue_worker.py and queue_db.py on the real Postgres the api test is using, with only S3, SQS and
the video child faked, using pipeline/test_queue_worker.py's own fakes. Reads {dsn, ops: [...]} on stdin and prints one JSON object. Made-up data only."""
from __future__ import annotations

import contextlib
import io
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import test_queue_worker as fakes  # noqa: E402  (brings queue_worker and queue_db with it)
import queue_db  # noqa: E402
import queue_worker as qw  # noqa: E402

UPLOADED = datetime(2026, 10, 31, 12, 5, tzinfo=timezone.utc)


class Ctx:
    def __init__(self, store):
        self.store = store


def deliver(store, op: dict) -> dict:
    """One real SQS message body through Worker.handle, as the api's outbox sent it."""
    box = fakes.Box(Ctx(store))
    for key in op.get("objects", []):
        box.s3.put("uploads", key, modified=UPLOADED)
    for key in op.get("media", []):
        box.s3.put("media", key)
    box.queue.send(body=op["body"])
    runner = fakes.FakeRunner({"ticks": fakes.GOOD_TICKS})
    box.deliver(box.worker(runner))
    return {"started": len(runner.specs), "spec": runner.specs[0] if runner.specs else None, "uploads": box.s3.keys("uploads"), "media": box.s3.keys("media"),
            "messagesLeft": len(box.queue.alive()), "reports": box.reports}


def run(store, op: dict):
    kind = op["op"]
    if kind == "deliver":
        return deliver(store, op)
    if kind == "claim":
        return store.claim(op["jobId"], op.get("leaseS", qw.LEASE_S))
    if kind == "peek":
        return store.peek(op["jobId"], qw.LEASE_S)
    if kind == "heartbeat":
        return store.heartbeat(op["claim"])
    if kind == "progress":
        return store.progress(op["claim"], op["stage"], op["progress"])
    if kind == "fail":
        return store.fail(op["claim"], op["message"])
    if kind == "release":
        return store.release(op["claim"])
    if kind == "uploadFinished":
        return store.upload_finished(op["claim"], UPLOADED)
    if kind == "finish":
        raw = fakes.recipe_json()
        keys = {"media_prefix": "recipe-x/", "recipe_json_key": "recipe-x/a1/recipe.json", "cover_key": "recipe-x/a1/poster.jpg"}
        return store.finish(op["claim"], queue_db.recipe_row(raw), keys, {"model": "claude-sonnet-5-5", "prompt_version": "MERGE_PROMPT:abc"}, op.get("requestId"))
    if kind == "sweep":
        return store.sweep(op.get("leaseS", qw.LEASE_S), qw.MAX_RECEIVES, qw.MSG_FAILED)
    if kind == "recipeFolder":
        return qw.recipe_folder({"id": op["jobId"], "media_prefix": None})
    raise ValueError(kind)


def main() -> None:
    request = json.load(sys.stdin)
    store = queue_db.PostgresStore({"conninfo": request["dsn"]})
    logged = io.StringIO()
    results = []
    with contextlib.redirect_stdout(logged):
        for op in request["ops"]:
            results.append(run(store, op))
    store.close()
    print(json.dumps({"results": results, "log": logged.getvalue()}, default=lambda o: float(o) if isinstance(o, Decimal) else str(o)))


if __name__ == "__main__":
    main()
