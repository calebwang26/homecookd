"""Tests for cover.py: which part of the video Gemini watches, the frames compared around its pick, and that
the sharpest real frame wins (fake Gemini, a generated video; no API call). Also process.make_cover's order:
the cook's plate photo, used as it is with no frame pick; a broken photo falls back to the frame pick.

    .venv/bin/python pipeline/test_cover.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import cover as C  # noqa: E402
from pipeline import process  # noqa: E402
from pipeline.schema import Recipe  # noqa: E402
from pipeline.shorten import MemoryUsage  # noqa: E402


def steps(*spans: tuple[int, int]) -> list[dict]:
    return [{"order": i, "start_s": a, "end_s": b} for i, (a, b) in enumerate(spans, 1)]


class FakeGemini:
    """Stands in for genai.Client: returns the scripted answers in order and keeps what it was sent."""

    def __init__(self, *answers: dict) -> None:
        self.answers, self.sent = list(answers), []
        self.models = SimpleNamespace(generate_content=self._generate)

    def _generate(self, model, contents, config):
        assert config.response_schema is C.CoverAnswer, config.response_schema
        self.sent.append(contents)
        meta = SimpleNamespace(prompt_token_count=100, candidates_token_count=20, thoughts_token_count=0)
        return SimpleNamespace(text=json.dumps(self.answers.pop(0)), usage_metadata=meta, candidates=[],
                               prompt_feedback=None)


def video(path: Path, seconds: int, sharp_at: float) -> None:
    """A test pattern that is blurred everywhere except the one frame at sharp_at (10 fps)."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=320x240:rate=10:d={seconds}",
                    "-vf", f"boxblur=8:enable='not(between(t,{sharp_at - 0.05},{sharp_at + 0.05}))'",
                    "-pix_fmt", "yuv420p", str(path)], check=True)


def test_window_is_the_last_two_steps_within_limits() -> None:
    poha = steps((10, 60), (544, 555), (578, 603))
    assert C.window(poha, 631) == (544.0, 631.0)
    assert C.window(steps((0, 50), (100, 900), (950, 990)), 1000) == (700.0, 1000.0)  # at most 300 s
    assert C.window(steps((0, 50), (600, 610), (615, 625)), 631) == (571.0, 631.0)  # at least 60 s
    assert C.window(steps((0, 30)), 40) == (0.0, 40.0)  # a short video: all of it


def test_frames_around_the_pick_stay_inside_the_video() -> None:
    assert C.near(10, 100) == [9.0, 9.5, 10.0, 10.5, 11.0]
    assert C.near(0.3, 100) == [0.0, 0.3, 0.8, 1.3]
    assert C.near(99, 100) == [98.0, 98.5, 99.0, 99.5]


def test_sharpest_frame_near_the_pick_wins() -> None:
    recipe = {"title": "Poha", "media": {"duration_s": 70}, "steps": steps((0, 20), (30, 60))}
    fake = FakeGemini({"found": True, "at": "00:40"})  # the window starts at 0 s here (at least 60 s of 70)
    usage = MemoryUsage()
    with tempfile.TemporaryDirectory() as tmp:
        play, dest = Path(tmp) / "play.mp4", Path(tmp) / "poster.jpg"
        video(play, 70, sharp_at=40.5)
        assert C.make_cover(fake, "fake-pro", recipe, play, dest, usage) == 40.5
        assert dest.stat().st_size > 0
    part, prompt = fake.sent[0]
    assert part.inline_data.mime_type == "video/mp4" and len(part.inline_data.data) > 0
    assert '"Poha"' in prompt and "01:10 long" in prompt, prompt
    assert [c["kind"] for c in usage.calls] == ["cover"] and usage.calls[0]["ok"]


def test_no_finished_dish_leaves_the_poster_alone() -> None:
    recipe = {"title": "Poha", "media": {"duration_s": 70}, "steps": steps((0, 20), (30, 60))}
    with tempfile.TemporaryDirectory() as tmp:
        play, dest = Path(tmp) / "play.mp4", Path(tmp) / "poster.jpg"
        video(play, 70, sharp_at=40.5)
        assert C.make_cover(FakeGemini({"found": False, "at": "00:00"}), "fake-pro", recipe, play, dest,
                            MemoryUsage()) is None
        assert not dest.exists()


def test_bad_answers_are_retried_once_then_raise() -> None:
    usage = MemoryUsage()
    fake = FakeGemini({"found": True, "at": "05:00"}, {"found": True, "at": "1:75"})
    try:
        C.ask(fake, "fake-pro", "Poha", b"video", 87, usage)
    except C.CoverError as e:
        assert "1:75" in str(e), e
    else:
        raise AssertionError("ask accepted a time past the clip and an impossible time")
    assert [c["ok"] for c in usage.calls] == [False, False] and "past the clip's end" in usage.calls[0]["error"]
    assert C.ask(FakeGemini({"found": True, "at": "01:02"}), "fake-pro", "Poha", b"video", 87, MemoryUsage()) == 62


def photo(path: Path, size: str = "1080x1920") -> bytes:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={size}", "-frames:v", "1",
                    str(path)], check=True)
    return path.read_bytes()


def sample_recipe() -> Recipe:
    return Recipe.model_validate_json((ROOT / "app/assets/data/recipes/weed-steak.json").read_text())


def must_not_run(*_a, **_k):
    raise AssertionError("the frame pick ran although the cook's plate photo was there")


def test_plate_photo_is_the_cover_as_it_is() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / "work").mkdir()
        mine = photo(out / "work" / process.COVER_PHOTO)
        old = (C.make_cover, process.make_poster)
        C.make_cover, process.make_poster = must_not_run, must_not_run
        try:
            got = process.make_cover(None, "fake-pro", sample_recipe(), out, MemoryUsage())
        finally:
            C.make_cover, process.make_poster = old
        assert got == "the cook's plate photo", got
        assert (out / "poster.jpg").read_bytes() == mine  # byte for byte: no filter, no crop, no re-encode


def test_broken_plate_photo_falls_back_to_the_frame_pick() -> None:
    for name, write in (("not an image", lambda p: p.write_bytes(b"not a jpeg")),
                        ("a PNG", lambda p: photo(p.with_suffix(".png")) and p.with_suffix(".png").replace(p)),
                        ("too small", lambda p: photo(p, "120x90"))):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "work").mkdir()
            write(out / "work" / process.COVER_PHOTO)
            picked = []
            old = C.make_cover
            C.make_cover = lambda *a, **k: picked.append(a) or 12.0
            try:
                got = process.make_cover(None, "fake-pro", sample_recipe(), out, MemoryUsage())
            finally:
                C.make_cover = old
            assert got == "the finished dish at 12.0 s" and len(picked) == 1, (name, got)
            assert not (out / "poster.jpg").exists(), name  # the fake pick wrote nothing; the photo didn't either


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"ok   {t.__name__}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
