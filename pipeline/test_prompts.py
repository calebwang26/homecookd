"""Tests for the job's language and homie's questions in the prompts (pipeline/prompts.py), the recipe's
language in recipe.json, and the Convex worker waiting for a signer upload (pipeline/worker.py).

    .venv/bin/python pipeline/test_prompts.py        # plain runner (pytest is not in the venv)

No network: the GCS buckets are small fakes.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import sys
import tempfile
import traceback
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from google.api_core.exceptions import NotFound  # noqa: E402

from pipeline import process, worker  # noqa: E402
from pipeline.prompts import EXTRACT_PROMPT, MERGE_PROMPT, context, homie_block, language_line  # noqa: E402
from pipeline.schema import Recipe  # noqa: E402

LOG = [
    {"atS": 65.4, "kind": "amount", "text": "किती मीठ घातलं?", "textEn": "How much salt did you add?",
     "answer": {"transcript": "एक चमचा", "transcriptEn": "One spoon", "atS": 68, "endS": 72.5}},
    {"atS": 400, "kind": "story", "text": "Who taught you this?", "textEn": "Who taught you this?"},
]


def test_language_line():
    assert language_line(None) == ""
    assert "English" in language_line("en")
    assert "Marathi" in language_line("mr")
    assert "xx" in language_line("xx")


def test_homie_block_merge_uses_video_seconds():
    block = homie_block(LOG)
    assert "never quote homie as the cook".lower() in block.lower()
    assert "start a step at the cook's" in block.lower()
    assert '- 65 s homie asked (amount): "How much salt did you add?" (spoken as "किती मीठ घातलं?")' in block
    assert 'the cook answered 68 s-72 s: "One spoon"' in block
    assert '- 400 s homie asked (story): "Who taught you this?"\n' in block  # same words: no "spoken as"
    assert homie_block([]) == "" and homie_block(None) == ""


def test_homie_block_extraction_uses_clip_mmss():
    block = homie_block(LOG, base_s=60, clip_s=120)  # the clip covers 60..180 s of the video
    assert "- 00:05 homie asked (amount)" in block and "answered 00:08-00:12" in block
    assert "Who taught you this?" not in block  # 400 s is in another clip
    assert homie_block(LOG, base_s=500, clip_s=60) == ""


def test_prompts_render_with_context():
    ctx = context("mr", LOG, base_s=0, clip_s=600)
    extract = EXTRACT_PROMPT.format(i=1, n=1, clip_mmss="10:00", context=ctx)
    assert "narrates in Marathi" in extract and "homie (an AI helper on a phone nearby)" in extract
    merge = MERGE_PROMPT.format(n=1, title='"Varan"', duration_s=600, sessions="[]", events="[]",
                                context=context("mr", LOG))
    assert "homie asked (amount)" in merge and "8 to 12 steps" in merge
    plain = EXTRACT_PROMPT.format(i=1, n=1, clip_mmss="10:00", context=context(None, []))
    assert "homie" not in plain and "{" not in plain


def test_recipe_language_round_trip():
    synthetic = json.loads(next((ROOT / "data" / "synthetic").glob("*.json")).read_text())
    assert Recipe.model_validate(synthetic).language is None  # old files still validate
    manifest = {"id": "x", "title": "Varan", "cook": "Rajani", "relation": "Aaji", "duration_s": 100,
                "sessions": [], "language": "mr"}
    draft = SimpleNamespace(model_dump=lambda mode: {k: synthetic.get(k) for k in (
        "title", "intro", "servings", "total_time", "tags", "ingredients", "stories", "special",
        "follow_up_questions")} | {"steps": []})
    assert process.build_recipe(draft, manifest)["language"] == "mr"


class FakeBlob:
    def __init__(self, name: str, size: int = 10, text: str | None = None):
        self.name, self.size, self.text = name, size, text

    def download_as_text(self) -> str:
        if self.text is None:
            raise NotFound("no such object")
        return self.text


class FakeBucket:
    def __init__(self, blobs: dict[str, FakeBlob]):
        self.blobs, self.name = blobs, "fake"
        self.client = SimpleNamespace(list_blobs=lambda _b, prefix: [b for n, b in self.blobs.items()
                                                                     if n.startswith(prefix)])

    def get_blob(self, name: str):
        return self.blobs.get(name)

    def blob(self, name: str):
        return self.blobs.get(name) or FakeBlob(name)


def signer_media(created: dt.datetime) -> FakeBucket:
    job = {"id": "varan-abc123", "created_at": created.isoformat(),
           "files": [{"index": 1, "object": "varan-abc123/01.mov"}, {"index": 2, "object": "varan-abc123/02.mov"}]}
    return FakeBucket({"jobs/varan-abc123.json": FakeBlob("jobs/varan-abc123.json", text=json.dumps(job))})


def test_worker_waits_for_every_signer_file():
    now = dt.datetime.now(dt.timezone.utc)
    one = FakeBucket({"varan-abc123/01.mov": FakeBlob("varan-abc123/01.mov")})
    try:
        worker._complete_upload(signer_media(now), one, "varan-abc123/", wait_s=0)
    except worker.UploadPending as e:
        assert "02.mov" in str(e) and e.has_signer
    else:
        raise AssertionError("a half-uploaded job must be released")
    try:
        worker._complete_upload(signer_media(now - dt.timedelta(days=9)), one, "varan-abc123/", wait_s=0)
    except worker.UploadMissing:
        pass
    else:
        raise AssertionError("files that can no longer arrive fail the job")
    both = FakeBucket({n: FakeBlob(n) for n in ("varan-abc123/02.mov", "varan-abc123/01.mov")})
    got = worker._complete_upload(signer_media(now), both, "varan-abc123/", wait_s=0)
    assert [b.name for b in got] == ["varan-abc123/01.mov", "varan-abc123/02.mov"]


def test_worker_without_signer_file():
    media = FakeBucket({})
    glasses = FakeBucket({"glasses/rec1.mp4": FakeBlob("glasses/rec1.mp4")})
    assert [b.name for b in worker._complete_upload(media, glasses, "glasses/rec1.mp4", wait_s=0)] == ["glasses/rec1.mp4"]
    try:
        worker._complete_upload(media, FakeBucket({}), "glasses/rec2.mp4", wait_s=0)
    except worker.UploadPending as e:
        assert not e.has_signer
    else:
        raise AssertionError("nothing uploaded yet: release, don't fail")


class FakeConvex:
    def __init__(self):
        self.released, self.failed = 0, []

    def progress(self, _job_id, stage, _progress, error=None):
        if stage == "failed":
            self.failed.append(error)

    def release(self, _job_id):
        self.released += 1


def releases(has_signer: bool, times: int) -> FakeConvex:
    """Runs handle_convex `times` times on a job whose upload never completes."""
    def pending(*_args, **_kw):
        raise worker.UploadPending("waiting for 02.mov", has_signer=has_signer)

    saved = worker._complete_upload, worker.LOCKS, worker.INPUT
    convex, job = FakeConvex(), {"jobId": f"job{int(has_signer)}", "uploadPath": "varan-abc123/"}
    with tempfile.TemporaryDirectory() as tmp:
        worker._complete_upload, worker.LOCKS, worker.INPUT = pending, Path(tmp) / ".locks", Path(tmp)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                for _ in range(times):
                    worker.handle_convex(convex, job, FakeBucket({}), FakeBucket({}))
        finally:
            worker._complete_upload, worker.LOCKS, worker.INPUT = saved
            worker._releases.pop(job["jobId"], None)
    return convex


def test_worker_counts_releases_only_without_signer_file():
    # A signer upload waits for its links to expire (UPLOAD_GIVE_UP), however many releases that takes.
    signer = releases(has_signer=True, times=worker.MAX_RELEASES + 5)
    assert signer.released == worker.MAX_RELEASES + 5 and signer.failed == []
    # Without one, the job fails after MAX_RELEASES releases.
    plain = releases(has_signer=False, times=worker.MAX_RELEASES + 1)
    assert plain.released == worker.MAX_RELEASES and plain.failed == [worker.MSG_NO_UPLOAD]


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
