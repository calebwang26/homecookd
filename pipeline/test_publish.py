"""Tests for a family recipe's public recipe.json (publish.without_memories, publish_recipe(family=True)).

    .venv/bin/python pipeline/test_publish.py        # plain runner (pytest is not in the venv)

No network: a fake bucket keeps what would be uploaded, and the worker test fakes prep, process and Convex.
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import traceback
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import publish  # noqa: E402
import worker  # noqa: E402
from schema import Recipe  # noqa: E402

SAMPLE = ROOT / "data" / "synthetic" / "dad-sunday-chili.json"  # 2 stories, 2 specials, 2 step tips


@contextlib.contextmanager
def patched(obj, **values):
    old = {k: getattr(obj, k) for k in values}
    for k, v in values.items():
        setattr(obj, k, v)
    try:
        yield
    finally:
        for k, v in old.items():
            setattr(obj, k, v)


class FakeBlob:
    def __init__(self, bucket: "FakeBucket", name: str):
        self.bucket, self.name, self.generation, self.md5_hash = bucket, name, 1, None

    def exists(self) -> bool:
        return False

    def upload_from_filename(self, *_args, **_kw) -> None:
        pass

    def upload_from_string(self, data: str, content_type: str) -> None:
        self.bucket.uploaded[self.name] = data


class FakeBucket:
    name = "fake-media"

    def __init__(self):
        self.uploaded: dict[str, str] = {}

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self, name)


def memories_in(r: dict) -> list[str]:
    """What a public recipe.json must not hold for a family recipe."""
    found = [k for k in ("stories", "special") if r.get(k)]
    found += ["intro"] if r.get("intro") else []
    for s in r["steps"]:
        found += [f"step {s['order']} {k}" for k in ("tip", "story_ids", "special_ids") if s.get(k)]
    return found


@contextlib.contextmanager
def out_folder(recipe_id: str):
    """data/out/<recipe_id>/ in a temp folder: the sample recipe and stand-in media files."""
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / recipe_id
        folder.mkdir()
        (folder / "recipe.json").write_text(SAMPLE.read_text())
        for local in publish.MEDIA_FILES:
            (folder / local).write_bytes(b"media")
        with patched(publish, OUT=Path(tmp), _video_size=lambda _p: (720, 1280),
                     _publish_step_stills=lambda *_a: None), contextlib.redirect_stdout(io.StringIO()):
            yield folder


def test_without_memories_keeps_the_recipe():
    full = Recipe.model_validate_json(SAMPLE.read_text())
    assert memories_in(full.model_dump()), "the sample must have stories and tips to take out"
    bare = publish.without_memories(full)
    assert memories_in(bare.model_dump()) == []
    Recipe.model_validate(bare.model_dump())  # still a valid recipe
    keep = ("title", "cook", "ingredients", "media", "tags", "follow_up_questions")
    assert all(getattr(bare, k) == getattr(full, k) for k in keep)
    assert [(s.instruction, s.quote, s.substeps) for s in bare.steps] == \
        [(s.instruction, s.quote, s.substeps) for s in full.steps]
    assert memories_in(full.model_dump()), "the original is left alone"


def test_family_recipe_json_has_no_memories():
    with out_folder("chili-abc123") as folder:
        bucket = FakeBucket()
        recipe = publish.publish_recipe("chili-abc123", bucket=bucket, family=True)
        public = json.loads(bucket.uploaded["chili-abc123/recipe.json"])
        assert memories_in(public) == []
        assert public["media"]["video_url"] == "https://storage.googleapis.com/fake-media/chili-abc123/play.mp4?v=1"
        assert len(recipe.stories) == 2 and len(recipe.special) == 2, "Convex still gets them all"
        assert (folder / publish.FAMILY_MARK).exists()
        # Published again by hand (publish.py --id), it is still a family recipe.
        publish.publish_recipe("chili-abc123", bucket=bucket)
        assert memories_in(json.loads(bucket.uploaded["chili-abc123/recipe.json"])) == []


def test_other_recipes_keep_their_stories():
    with out_folder("weed-chili") as folder:
        bucket = FakeBucket()
        publish.publish_recipe("weed-chili", bucket=bucket)
        assert memories_in(json.loads(bucket.uploaded["weed-chili/recipe.json"]))
        assert not (folder / publish.FAMILY_MARK).exists()


def test_worker_publishes_a_family_recipe():
    calls: dict = {}
    full = Recipe.model_validate_json(SAMPLE.read_text())

    def publish_recipe(recipe_id, **kw):
        calls["publish"] = (recipe_id, kw)
        return full

    class Convex:
        def progress(self, _job_id, stage, _progress, error=None):
            assert stage != "failed", error

        def published(self, job_id, recipe, url, language=None, memories_opt_in=None):
            calls["convex"] = recipe
            return "recipe1"

    upload = SimpleNamespace(name="chili-abc123/01.mov", size=10)
    job = {"jobId": "job1", "uploadPath": "chili-abc123/", "cookName": "Dad", "title": "Chili"}
    with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()), \
            patched(worker, LOCKS=Path(tmp) / ".locks", INPUT=Path(tmp), _complete_upload=lambda *_a: [upload],
                    _download=lambda *_a: None, spend_cap=lambda: 100.0, spent_usd=lambda: 0.0), \
            patched(worker.prep, run=lambda *_a: None, probe_duration=lambda _p: 60.0), \
            patched(worker.process, run=lambda *_a, **_kw: None), \
            patched(publish, publish_recipe=publish_recipe):
        worker.handle_convex(Convex(), job, FakeBucket(), FakeBucket())
    assert calls["publish"][1]["family"] is True, "the worker publishes a family recipe"
    assert len(calls["convex"]["stories"]) == 2, "Convex gets the stories the public file leaves out"


def main() -> None:
    tests = [(n, f) for n, f in globals().items() if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"ok   {name}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
