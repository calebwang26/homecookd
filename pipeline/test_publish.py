"""Tests for a family recipe's public recipe.json (publish.without_memories, publish_recipe(family=True)),
for keeping family recipes out of library.json and the app's bundle (rebuild_library), and for
scrub_family.py, which strips the ones published before.

    .venv/bin/python pipeline/test_publish.py        # plain runner (pytest is not in the venv)

No network: a fake bucket keeps what would be uploaded, and the worker tests fake prep, process and Convex
(including a job the cook stops mid-way: Convex's 409).
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
import scrub_family  # noqa: E402
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
        return self.name in self.bucket.files

    def download_as_text(self) -> str:
        return self.bucket.files[self.name]

    def upload_from_filename(self, *_args, **_kw) -> None:
        pass

    def upload_from_string(self, data: str, content_type: str) -> None:
        self.bucket.files[self.name] = self.bucket.uploaded[self.name] = data


class FakeBucket:
    """files: what is in the bucket (JSON only; media uploads are dropped). uploaded: what was written."""
    name = "fake-media"

    def __init__(self, files: dict[str, str] | None = None):
        self.files, self.uploaded = dict(files or {}), {}
        self.client = self

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self, name)

    def list_blobs(self, _bucket: "FakeBucket", match_glob: str) -> list[FakeBlob]:
        assert match_glob == "*/recipe.json"
        return [FakeBlob(self, n) for n in self.files if n.count("/") == 1 and n.endswith("/recipe.json")]  # * stops at /


def recipe_json(recipe_id: str) -> str:
    """The sample recipe (stories, specials, tips) under another id."""
    return json.dumps({**json.loads(SAMPLE.read_text()), "id": recipe_id})


def url(recipe_id: str) -> str:
    return f"https://storage.googleapis.com/{FakeBucket.name}/{recipe_id}/recipe.json"


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
        (folder / "recipe.json").write_text(recipe_json(recipe_id))
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
    assert bare.family and not full.family
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
        assert memories_in(public) == [] and public["family"] is True
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
        public = json.loads(bucket.uploaded["weed-chili/recipe.json"])
        assert memories_in(public) and public["family"] is False
        assert not (folder / publish.FAMILY_MARK).exists()


def test_republished_elsewhere_it_stays_a_family_recipe():
    """Another machine has the recipe's folder but no FAMILY_MARK: the bucket copy's mark still holds."""
    scrubbed = publish.without_memories(Recipe.model_validate_json(recipe_json("chili-abc123")))
    bucket = FakeBucket({"chili-abc123/recipe.json": scrubbed.model_dump_json()})
    with out_folder("chili-abc123") as folder:
        publish.publish_recipe("chili-abc123", bucket=bucket)
        public = json.loads(bucket.uploaded["chili-abc123/recipe.json"])
        assert memories_in(public) == [] and public["family"] is True
        assert (folder / publish.FAMILY_MARK).exists()


def test_family_recipes_stay_out_of_library_and_bundle():
    bucket = FakeBucket({"weed-steak/recipe.json": recipe_json("weed-steak"),
                         "soup-123456/recipe.json": recipe_json("soup-123456"),  # the worker's, before the mark
                         "trash/weed-cake/recipe.json": recipe_json("weed-cake")})
    with out_folder("chili-abc123"), tempfile.TemporaryDirectory() as app:
        publish.publish_recipe("chili-abc123", bucket=bucket, family=True)
        (publish.OUT / "soup-123456").mkdir()
        (publish.OUT / "soup-123456" / publish.FAMILY_MARK).touch()  # only on the machine that ran the worker
        data = Path(app) / "data"
        (data / "recipes").mkdir(parents=True)
        (data / "recipes" / "chili-abc123.json").write_text(recipe_json("chili-abc123"))  # bundled before
        with patched(publish, APP_DATA=data, BUNDLED_TS=Path(app) / "bundled.ts"):
            entries = publish.rebuild_library(bucket)
        assert [e.id for e in entries] == ["weed-steak"]
        assert [e["id"] for e in json.loads(bucket.uploaded["library.json"])] == ["weed-steak"]
        assert [e["id"] for e in json.loads((data / "library.json").read_text())] == ["weed-steak"]
        assert [p.stem for p in (data / "recipes").glob("*.json")] == ["weed-steak"]
        bundled = (Path(app) / "bundled.ts").read_text()
        assert "'weed-steak'" in bundled and "chili" not in bundled and "soup" not in bundled


def scrub_bucket() -> FakeBucket:
    """Family recipes as the Convex worker left them, and one shared library recipe."""
    clean = publish.without_memories(Recipe.model_validate_json(recipe_json("rice-abcdef")))
    return FakeBucket({"soup-123456/recipe.json": recipe_json("soup-123456"),  # published before #37
                       "trash/pie-654321/recipe.json": recipe_json("pie-654321"),  # deleted, still public
                       "rice-abcdef/recipe.json": clean.model_dump_json(),  # published after #37
                       "stew-222222/recipe.json": recipe_json("stew-222222"),  # its Convex row was removed
                       "weed-steak/recipe.json": recipe_json("weed-steak"),  # the shared library: no Convex row
                       "library.json": json.dumps([{"id": "weed-steak"}])})


SCRUB_URLS = [url("soup-123456"), url("pie-654321"), url("rice-abcdef"), url("gone-000000"),
              "https://storage.googleapis.com/other-bucket/x-111111/recipe.json"]


def run_scrub(bucket: FakeBucket, *argv: str) -> str:
    def no_library(*_a):
        raise AssertionError("the scrub must not rebuild library.json")

    out = io.StringIO()
    with patched(publish, _bucket=lambda: bucket, rebuild_library=no_library), \
            patched(scrub_family, family_recipe_urls=lambda _deployment: SCRUB_URLS), contextlib.redirect_stdout(out):
        scrub_family.main(list(argv))
    return out.getvalue()


def test_scrub_dry_run_lists_the_files_and_writes_nothing():
    bucket = scrub_bucket()
    out = run_scrub(bucket)
    listed = [line.split()[1] for line in out.splitlines() if line.startswith("scrub ")]
    assert listed == ["soup-123456/recipe.json", "trash/pie-654321/recipe.json"], out
    assert "2 stories, 2 special moments, 2 step tips, the intro, no family mark" in out, out
    assert "clean rice-abcdef/recipe.json" in out and "skip https://storage.googleapis.com/other-bucket/" in out
    assert "check stew-222222/recipe.json" in out and "--id stew-222222" in out, out
    assert "weed-steak" not in out and "gone-000000" not in out
    assert "dry run: 2 file(s)" in out
    assert bucket.uploaded == {}, "a dry run writes nothing"


def test_scrub_write_strips_and_marks_only_those():
    bucket = scrub_bucket()
    before = dict(bucket.files)
    run_scrub(bucket, "--write", "--id", "stew-222222", "--id", "soup-123456")
    assert sorted(bucket.uploaded) == ["soup-123456/recipe.json", "stew-222222/recipe.json",
                                       "trash/pie-654321/recipe.json"]
    for path, data in bucket.uploaded.items():
        public = json.loads(data)
        assert memories_in(public) == [] and public["family"] is True, path
        steps = lambda r: [(s["instruction"], s["quote"]) for s in r["steps"]]  # noqa: E731
        assert steps(public) == steps(json.loads(before[path])), "the steps stay"
    assert bucket.files["weed-steak/recipe.json"] == before["weed-steak/recipe.json"]
    again = run_scrub(bucket)
    assert "dry run: 0 file(s)" in again and "check " not in again, "a second run has nothing left to do"


def test_scrub_finds_family_recipes_in_convex():
    calls = []
    rows = [{"_id": "r1", "libraryId": "soup-123456", "recipeJsonUrl": url("soup-123456")},
            {"_id": "r2", "libraryId": "dad-sunday-chili"},  # seeded demo row: no recipeJsonUrl
            {"_id": "r3", "recipeJsonUrl": url("soup-123456")}]

    def run(cmd, **kw):
        calls.append(cmd)
        return SimpleNamespace(stdout="\n".join(["npx: installed 1 package"] + [json.dumps(r) for r in rows]))

    with patched(scrub_family, subprocess=SimpleNamespace(run=run)):
        assert scrub_family.family_recipe_urls() == [url("soup-123456")]
    assert calls[0][:5] == ["npx", "--yes", "convex", "data", "recipes"]
    assert calls[0][calls[0].index("--deployment") + 1] == "grand-dragon-649"


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
            patched(worker.process, run=lambda *_a, **kw: calls.setdefault("process", []).append(kw)), \
            patched(worker, _download_cover=lambda url, dest: calls.setdefault("cover", []).append(url) or dest), \
            patched(publish, publish_recipe=publish_recipe):
        worker.handle_convex(Convex(), job, FakeBucket(), FakeBucket())
        worker.handle_convex(Convex(), {**job, "coverUrl": "https://convex.example/api/storage/abc"}, FakeBucket(),
                             FakeBucket())
    assert calls["publish"][1]["family"] is True, "the worker publishes a family recipe"
    assert len(calls["convex"]["stories"]) == 2, "Convex gets the stories the public file leaves out"
    assert calls["cover"] == ["https://convex.example/api/storage/abc"], calls["cover"]  # only the job with one
    assert [kw["cover_photo"] and kw["cover_photo"].name for kw in calls["process"]] == [None, "plate-photo.jpg"]


def test_worker_stops_a_job_the_cook_cancelled():
    """The cook stopped it in the app mid-way: Convex answers 409 to the next report, the worker
    publishes nothing, reports no failure on top, and deletes her raw videos (only that folder)."""
    calls: dict = {"progress": [], "purged": []}

    class Convex:
        def progress(self, _job_id, stage, _progress, error=None):
            calls["progress"].append(stage)
            if stage == "writing":
                raise worker.JobCancelled("Convex /worker/progress: cancelled")

        def published(self, *_a, **_kw):
            calls["published"] = True

    def publish_recipe(*_a, **_kw):
        calls["publish"] = True

    def process_run(_recipe_id, report, **_kw):
        report("understanding", 0.2)
        report("writing", 0.7)  # the cook stopped it while Gemini was watching
        report("writing", 0.85)

    upload = SimpleNamespace(name="chili-abc123/01.mov", size=10)
    job = {"jobId": "job1", "uploadPath": "chili-abc123/", "cookName": "Dad", "title": "Chili"}
    with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()) as log, \
            patched(worker, LOCKS=Path(tmp) / ".locks", INPUT=Path(tmp), _complete_upload=lambda *_a: [upload],
                    _download=lambda *_a: None, spend_cap=lambda: 100.0, spent_usd=lambda: 0.0,
                    _purge_uploads=lambda _b, folder: calls["purged"].append(folder) or 1), \
            patched(worker.prep, run=lambda *_a: None, probe_duration=lambda _p: 60.0), \
            patched(worker.process, run=process_run), \
            patched(publish, publish_recipe=publish_recipe):
        worker.handle_convex(Convex(), job, FakeBucket(), FakeBucket())
    assert "publish" not in calls and "published" not in calls, calls
    assert "failed" not in calls["progress"], calls["progress"]
    assert calls["progress"][-1] == "writing", calls["progress"]
    assert calls["purged"] == ["chili-abc123"], calls["purged"]
    assert "cancelled job1 by the cook: stopped" in log.getvalue(), log.getvalue()


def test_worker_stopped_right_after_publishing_trashes_the_media_and_keeps_running():
    """Stopped in the last moment: /worker/published answers 409. What publish_recipe put in the public
    bucket goes to trash/, and a storage error while cleaning up doesn't take the worker down."""
    calls: dict = {"trashed": []}

    class Convex:
        def progress(self, _job_id, stage, _progress, error=None):
            assert stage != "failed", error

        def published(self, *_a, **_kw):
            raise worker.JobCancelled("Convex /worker/published: cancelled")

    def purge(_b, _folder):
        raise RuntimeError("GCS 503")

    upload = SimpleNamespace(name="chili-abc123/01.mov", size=10)
    job = {"jobId": "job1", "uploadPath": "chili-abc123/", "cookName": "Dad", "title": "Chili"}
    full = Recipe.model_validate_json(SAMPLE.read_text())
    with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()) as log, \
            patched(worker, LOCKS=Path(tmp) / ".locks", INPUT=Path(tmp), _complete_upload=lambda *_a: [upload],
                    _download=lambda *_a: None, spend_cap=lambda: 100.0, spent_usd=lambda: 0.0,
                    _trash_recipe=lambda _m, rid: calls["trashed"].append(rid) or 3), \
            patched(worker.prep, run=lambda *_a: None, probe_duration=lambda _p: 60.0), \
            patched(worker.process, run=lambda *_a, **_kw: None), \
            patched(publish, publish_recipe=lambda *_a, **_kw: full):
        worker.handle_convex(Convex(), job, FakeBucket(), FakeBucket())  # trashes, then logs the 503
        with patched(worker, _purge_uploads=purge):
            worker.handle_convex(Convex(), job, FakeBucket(), FakeBucket())  # must not raise
    assert calls["trashed"] == ["recipe-job1", "recipe-job1"], calls["trashed"]
    assert "cleanup failed: RuntimeError: GCS 503" in log.getvalue(), log.getvalue()


def test_a_cancelled_glasses_job_deletes_only_its_own_video():
    gone: list[str] = []

    class Blob:
        def __init__(self, name):
            self.name = name

        def delete(self):
            gone.append(self.name)

    class Uploads:
        def get_blob(self, name):
            return Blob(name) if name == "glasses/rec1.mp4" else None

    with patched(worker, _purge_uploads=lambda _b, folder: gone.append(f"folder {folder}") or 1):
        assert worker._purge_cancelled(Uploads(), "glasses/rec1.mp4") == 1
        assert worker._purge_cancelled(Uploads(), "glasses/missing.mp4") == 0
        assert worker._purge_cancelled(Uploads(), "poha-ab12cd/") == 1
    assert gone == ["glasses/rec1.mp4", "folder poha-ab12cd"], gone


class FakeResponse:
    def __init__(self, status: int, chunks: list[bytes]):
        self.status_code, self.chunks = status, chunks

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f"{self.status_code} for url: https://secret.example/photo", response=self)

    def iter_content(self, _size):
        return iter(self.chunks)


def test_worker_plate_photo_download():
    url = "https://secret.example/photo"
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "plate-photo.jpg"
        for status, chunks, want in ((200, [b"\xff\xd8", b"jpeg"], b"\xff\xd8jpeg"),
                                     (404, [], None),
                                     (200, [b"x" * 1_000_000] * 21, None)):  # over MAX_COVER_BYTES
            dest.unlink(missing_ok=True)
            log = io.StringIO()
            with contextlib.redirect_stdout(log), \
                    patched(worker.requests, get=lambda *_a, **_kw: FakeResponse(status, chunks)):
                got = worker._download_cover(url, dest)
            if want:
                assert got == dest and dest.read_bytes() == want, status
            else:
                assert got is None and not dest.exists(), (status, got)
            assert "secret.example" not in log.getvalue(), log.getvalue()  # her photo's URL is never printed


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
