"""One video job in its own process: the raw upload -> prep -> process -> schema check -> publish, reusing those steps as
Convex mode does (docs/build/WORKER-MIGRATION.md).

    python pipeline/queue_job.py <spec.json>     # started only by queue_worker.ChildRunner

Why a process of its own: a cancel, a spend cap or a stopping task can end it at any moment, including mid-ffmpeg or with four
model calls in flight, by killing its process group. It never touches the database. It writes events.jsonl (stage, progress,
the video's length) and at the end result.json next to the spec; the parent does every database write. The steps print
transcripts and titles, so its stdout and stderr don't reach CloudWatch.
"""
from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

MAX_HOURS = 4  # worker.MAX_HOURS
COST_PER_HOUR_USD = 2.5  # worker.COST_PER_HOUR_USD: the projection the spend caps check before any model runs
Emit = Callable[[dict], None]


class Permanent(Exception):
    """A job another try can't fix. kind picks the words the cook reads (queue_worker.MESSAGES)."""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


class RealSteps:
    """The seam: everything from the existing pipeline this mode uses. Tests pass a fake."""

    def __init__(self):
        import prep
        import process
        import publish
        import schema
        self.prep, self.process, self.publish_mod, self.schema = prep, process, publish, schema

    def duration(self, path: Path) -> float:
        return self.prep.probe_duration(path)

    def prepare(self, recipe_id: str, spec: dict, inputs: list[Path]) -> None:
        cook = spec.get("cook_name") or "Cook"
        self.prep.run(recipe_id, spec.get("title") or "", cook, spec.get("relation") or cook, inputs,
                      keep_order=bool(spec.get("keep_order")))

    def process_video(self, recipe_id: str, spec: dict, report, cover: Path | None) -> Path:
        return self.process.run(recipe_id, report=report, language=spec.get("language"),
                                homie_log=spec.get("homie_log") or [], live=spec.get("live"), cover_photo=cover)

    def check(self, raw: dict) -> None:
        self.schema.Recipe.model_validate(raw)

    def publish(self, recipe_id: str, bucket) -> dict:
        return self.publish_mod.publish_recipe(recipe_id, bucket=bucket, family=True).model_dump(mode="json")

    def kind_of(self, error: BaseException, recipe_id: str) -> str:
        """no_steps and bad_output are final; anything else (a model or network outage, ffmpeg, a bug) is worth another try."""
        name = type(error).__name__
        if name == "NoStepsError":
            return "no_steps"
        if name == "ValidationError":
            return "bad_output"
        invalid = self.prep.OUT_ROOT / recipe_id / "recipe.invalid.json"
        if name == "ProcessError" and invalid.exists():
            try:  # the merge's last answer. With only "errors" in it, the model never answered at all.
                return "retry" if set(json.loads(invalid.read_text())) == {"errors"} else "bad_output"
            except (OSError, ValueError):
                return "bad_output"
        return "retry"


def run_job(spec: dict, storage, steps, emit: Emit) -> dict:
    recipe_id = spec["recipe_id"]
    work = Path(spec["dir"])
    downloads = work / "input"
    downloads.mkdir(parents=True, exist_ok=True)
    inputs = []
    for i, obj in enumerate(spec["objects"]):
        dest = downloads / f"{i:02d}-{Path(obj['key']).name}"
        storage.download(obj["key"], obj["size"], dest)
        inputs.append(dest)
    emit({"stage": "preparing", "progress": 0.1})
    seconds = sum(steps.duration(p) for p in inputs)  # the phone's numbers can be missing or wrong
    emit({"duration_s": seconds})
    if seconds > MAX_HOURS * 3600:
        raise Permanent("too_long")
    steps.prepare(recipe_id, spec, inputs)
    cover = storage.download_cover(spec["cover_key"], work / "plate-photo.jpg") if spec.get("cover_key") else None
    path = Path(steps.process_video(recipe_id, spec, lambda stage, p: emit({"stage": stage, "progress": p}), cover))
    emit({"stage": "writing", "progress": 0.9})
    steps.check(json.loads(path.read_text()))  # before any upload: bad output never reaches the bucket
    bucket = storage.media_bucket(recipe_id, spec["attempt_prefix"])
    recipe = steps.publish(recipe_id, bucket)
    cover_blob = bucket.blob(f"{recipe_id}/poster.jpg")
    cover_blob.reload()
    return {"ok": True, "recipe": recipe, "recipe_json_key": bucket.key_for(f"{recipe_id}/recipe.json"),
            "cover_key": cover_blob.name, "cover_version": cover_blob.generation}


def failure(error: BaseException, steps, recipe_id: str) -> dict:
    # Never str(error): it can quote a transcript or a model's answer.
    kind = error.kind if isinstance(error, Permanent) else (steps.kind_of(error, recipe_id) if steps else "retry")
    return {"ok": False, "kind": kind, "error_type": type(error).__name__}


def _die_with_parent() -> None:
    """A parent that's gone can't record or stop what this spends."""
    parent = os.getppid()

    def watch() -> None:
        while os.getppid() == parent:
            time.sleep(5)
        os.killpg(0, signal.SIGKILL)

    threading.Thread(target=watch, daemon=True).start()


def write_result(work: Path, result: dict) -> None:
    tmp = work / "result.json.tmp"
    tmp.write_text(json.dumps(result, ensure_ascii=False))
    tmp.replace(work / "result.json")


def main(path: str) -> int:
    _die_with_parent()
    spec = json.loads(Path(path).read_text())
    work = Path(spec["dir"])
    steps = None
    with (work / "events.jsonl").open("a", buffering=1) as events:
        try:
            from queue_aws import S3Storage
            steps = RealSteps()
            result = run_job(spec, S3Storage.from_env(), steps, lambda e: events.write(json.dumps(e) + "\n"))
        except (Exception, SystemExit) as e:  # noqa: BLE001 - every failure is reported as a result
            result = failure(e, steps, spec["recipe_id"])
    write_result(work, result)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
