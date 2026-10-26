"""Tests for cover.py: which part of the video Gemini watches, the frames compared around its pick, that the
sharpest real frame wins, the 4:5 crop around the dish (black bars trimmed, the dish whole in every app slot),
and the last step's still (fake Gemini, a generated video; no API call). The same on Claude, which sees the window
as labelled stills (COVER_PROVIDER=claude). Also process.make_cover's order: the cook's plate photo, used as it is
with no frame pick; a broken photo falls back to the frame pick.

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

from pipeline import claude  # noqa: E402
from pipeline import cover as C  # noqa: E402
from pipeline import process  # noqa: E402
from pipeline.prep import probe  # noqa: E402
from pipeline.schema import Recipe  # noqa: E402
from pipeline.shorten import MemoryUsage  # noqa: E402
from pipeline.test_claude import FakeAnthropic, env  # noqa: E402


def steps(*spans: tuple[int, int]) -> list[dict]:
    return [{"order": i, "start_s": a, "end_s": b} for i, (a, b) in enumerate(spans, 1)]


def cover_answer(at: str | None, step_at: str = "") -> dict:
    return {"found": at is not None, "at": at or "00:00", "step_at": step_at}


class FakeGemini:
    """Stands in for genai.Client: answers the moment call and the dish-box call from their own scripts, in order,
    and keeps what each was sent."""

    def __init__(self, covers: list[dict], boxes: list[dict] = ()) -> None:
        self.answers = {C.CoverAnswer: list(covers), C.DishBox: list(boxes)}
        self.sent = {C.CoverAnswer: [], C.DishBox: []}
        self.models = SimpleNamespace(generate_content=self._generate)

    def _generate(self, model, contents, config):
        self.sent[config.response_schema].append(contents)
        meta = SimpleNamespace(prompt_token_count=100, candidates_token_count=20, thoughts_token_count=0)
        return SimpleNamespace(text=json.dumps(self.answers[config.response_schema].pop(0)), usage_metadata=meta,
                               candidates=[], prompt_feedback=None)


def video(path: Path, seconds: int, sharp_at: tuple[float, ...]) -> None:
    """A 240x240 test pattern between black side bars (320x240, like glasses footage), blurred everywhere except
    the frames at sharp_at (10 fps)."""
    sharp = "+".join(f"between(t,{t - 0.05},{t + 0.05})" for t in sharp_at)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=240x240:rate=10:d={seconds}",
                    "-vf", f"boxblur=8:enable='not({sharp})',pad=320:240:40:0:black", "-pix_fmt", "yuv420p",
                    str(path)], check=True)


def size(path: Path) -> tuple[int, int]:
    s = probe(path)["streams"][0]
    return s["width"], s["height"]


RECIPE = {"title": "Poha", "media": {"duration_s": 70}, "steps": steps((0, 20), (30, 60))}


# ---------- rules ----------

def test_window_is_the_last_two_steps_within_limits() -> None:
    poha = steps((10, 60), (544, 555), (578, 603))
    assert C.window(poha, 631) == (544.0, 631.0)
    assert C.window(steps((0, 50), (100, 900), (950, 990)), 1000) == (700.0, 1000.0)  # at most 300 s
    assert C.window(steps((0, 50), (600, 610), (615, 625)), 631) == (571.0, 631.0)  # at least 60 s
    assert C.window(steps((0, 30)), 40) == (0.0, 40.0)  # a short video: all of it


def test_frames_around_the_pick_stay_inside_their_span() -> None:
    assert C.near(10, 0, 100) == [9.0, 9.5, 10.0, 10.5, 11.0]
    assert C.near(0.3, 0, 100) == [0.0, 0.3, 0.8, 1.3]
    assert C.near(99, 0, 100) == [98.0, 98.5, 99.0, 99.5]
    assert C.near(578, 578, 603) == [578.0, 578.5, 579.0]  # the last step's still stays inside that step


def fits(dish, rect) -> bool:
    """The dish is whole in every slot the app center-crops the cover into."""
    x, y, w, h = rect
    narrow, wide = C.SLOT_ASPECTS
    keep_w, keep_h = min(w, narrow * h), min(h, w / wide)
    cx, cy = x + w / 2, y + h / 2
    return (cx - keep_w / 2 <= dish[0] and dish[2] <= cx + keep_w / 2
            and cy - keep_h / 2 <= dish[1] and dish[3] <= cy + keep_h / 2)


def test_crop_is_4_by_5_around_the_dish_inside_the_picture() -> None:
    frame = (0, 0, 1280, 720)
    dish = (500, 260, 700, 420)  # a plate in the middle
    rect = C.crop_rect(dish, frame)
    x, y, w, h = rect
    assert abs(w / h - C.ASPECT) < 0.01 and 0 <= x and x + w <= 1280 and 0 <= y and y + h <= 720, rect
    assert fits(dish, rect), rect
    assert h >= C.MIN_CROP_SHARE * 720  # never a postage stamp


def test_crop_stays_out_of_the_black_bars_and_keeps_an_edge_dish() -> None:
    picture = (160, 0, 1120, 720)  # Poha: 4:3 glasses footage inside 16:9
    bowl = (730, 450, 1000, 690)  # in the bottom right corner, as in Poha's cover frame
    x, y, w, h = C.crop_rect(bowl, picture)
    assert 160 <= x and x + w <= 1120 and 0 <= y and y + h <= 720, (x, y, w, h)
    assert x <= bowl[0] and bowl[2] <= x + w and y <= bowl[1] and bowl[3] <= y + h  # the whole bowl is in it
    assert abs(w / h - C.ASPECT) < 0.01
    narrow = C.SLOT_ASPECTS[0]  # the kid Home deck card: the bowl is whole across its width
    assert x + w / 2 - narrow * h / 2 <= bowl[0] and bowl[2] <= x + w / 2 + narrow * h / 2


def test_crop_refuses_boxes_that_cant_be_the_dish() -> None:
    picture = (160, 0, 1120, 720)
    assert C.crop_rect((600, 300, 640, 330), picture) is None  # 0.2% of the picture
    assert C.crop_rect((0, 100, 150, 600), picture) is None  # all in the black bar
    assert C.crop_rect((700, 400, 600, 500), picture) is None  # x2 before x1
    x, y, w, h = C.crop_rect((160, 0, 1120, 720), picture)  # the dish fills the frame: the biggest 4:5 there is
    assert h == 720 and w == 576, (x, y, w, h)


# ---------- the Gemini answers ----------

def test_bad_answers_are_retried_once_then_raise() -> None:
    usage = MemoryUsage()
    fake = FakeGemini([cover_answer("05:00"), cover_answer("1:75")])
    try:
        C.ask(fake, "fake-pro", "Poha", b"video", 87, (34, 59), usage)
    except C.CoverError as e:
        assert "1:75" in str(e), e
    else:
        raise AssertionError("ask accepted a time past the clip and an impossible time")
    assert [c["ok"] for c in usage.calls] == [False, False] and "past the clip's end" in usage.calls[0]["error"]


def test_the_last_steps_second_must_be_inside_that_step() -> None:
    ok = lambda at, step_at, step=(34, 59): C.ask(FakeGemini([cover_answer(at, step_at)]), "fake-pro", "Poha",  # noqa: E731
                                                b"video", 87, step, MemoryUsage())
    assert ok("01:02", "00:45") == (62, 45)
    assert ok("01:02", "") == (62, None)  # not visible in the last step
    assert ok("01:02", "01:20") == (62, None)  # outside the step: dropped, the cover stays
    assert ok("01:02", "soon") == (62, None)
    assert ok("01:02", "00:45", None) == (62, None)  # the last step isn't in the clip
    prompt = FakeGemini([cover_answer("01:02")])
    C.ask(prompt, "fake-pro", "Poha", b"video", 87, (34, 59), MemoryUsage())
    assert "from 00:34 to 00:59 in this clip" in prompt.sent[C.CoverAnswer][0][1]


def test_dish_box_answers() -> None:
    box = lambda *answers: C.find_dish(FakeGemini([], list(answers)), "fake-pro", "Poha", b"jpeg", MemoryUsage())  # noqa: E731
    assert box({"found": True, "box_2d": [250, 300, 750, 700]}) == (0.3, 0.25, 0.7, 0.75)  # (x1, y1, x2, y2)
    assert box({"found": False, "box_2d": [0, 0, 0, 0]}) is None
    usage = MemoryUsage()
    bad = FakeGemini([], [{"found": True, "box_2d": [700, 300, 250, 700]}, {"found": True, "box_2d": [1, 2, 3]}])
    assert C.find_dish(bad, "fake-pro", "Poha", b"jpeg", usage) is None  # a bad box twice: the whole frame
    assert [c["ok"] for c in usage.calls] == [False, False]


# ---------- make_cover end to end (fake Gemini, real ffmpeg) ----------

def test_cover_is_the_sharpest_frame_cropped_to_the_dish_and_the_last_step_gets_a_still() -> None:
    fake = FakeGemini([cover_answer("00:40", "00:50")], [{"found": True, "box_2d": [250, 300, 750, 700]}])
    usage = MemoryUsage()
    with tempfile.TemporaryDirectory() as tmp:
        play, dest = Path(tmp) / "play.mp4", Path(tmp) / "poster.jpg"
        video(play, 70, sharp_at=(40.5, 49.5))
        pick = C.make_cover(fake, "fake-pro", RECIPE, play, dest, usage)
        assert (pick.at, pick.cropped, pick.still_at) == (40.5, True, 49.5), pick
        # box: x 96-224, y 60-180 of 320x240; the picture is x 40-280 (bars trimmed). 4:5, centered on the dish,
        # sized so the 128 px wide dish (+15%) fits the 0.78 deck card: 150x188.
        assert size(dest) == (150, 188), size(dest)
    part, prompt = fake.sent[C.CoverAnswer][0]
    assert part.inline_data.mime_type == "video/mp4" and '"Poha"' in prompt and "01:10 long" in prompt, prompt
    frame, _ = fake.sent[C.DishBox][0]
    assert frame.inline_data.mime_type == "image/jpeg"
    assert [c["kind"] for c in usage.calls] == ["cover", "cover-box"] and all(c["ok"] for c in usage.calls)


def test_claude_frames_are_every_two_seconds_and_further_apart_for_a_long_window() -> None:
    assert [C.frame_every(s) for s in (70, 300, 301, 450)] == [2.0, 2.0, 3.0, 3.0]


def test_claude_picks_from_labelled_stills_then_the_same_sharpest_frame_and_crop() -> None:
    fake = FakeAnthropic(cover_answer("00:40", "00:50"), {"found": True, "box_2d": [250, 300, 750, 700]})
    usage = MemoryUsage()
    with tempfile.TemporaryDirectory() as tmp:
        play, dest = Path(tmp) / "play.mp4", Path(tmp) / "poster.jpg"
        video(play, 70, sharp_at=(40.5, 49.5))
        pick = C.make_cover(claude.ClaudeText(client=fake), "claude-haiku-5-5", RECIPE, play, dest, usage)
        assert (pick.at, pick.cropped, pick.still_at) == (40.5, True, 49.5), pick
        assert size(dest) == (150, 188), size(dest)
    moment, box = (call["messages"][0]["content"] for call in fake.calls)
    labels = [b["text"] for b in moment[:-1] if b["type"] == "text"]
    assert labels[:3] == ["00:00", "00:02", "00:04"] and len(labels) in (35, 36), labels
    assert sum(b["type"] == "image" for b in moment) == len(labels)
    prompt = moment[-1]["text"]
    assert prompt.startswith(f"The clip comes as {len(labels)} still frames, one every 2 seconds"), prompt
    assert '"Poha"' in prompt and "01:10 long" in prompt, prompt
    assert [b["type"] for b in box] == ["text", "image", "text"] and box[0]["text"] == "The frame:", box
    assert [c["kind"] for c in usage.calls] == ["cover", "cover-box"] and all(c["ok"] for c in usage.calls)
    assert {c["model"] for c in usage.calls} == {"claude-haiku-5-5"}


def test_cover_provider_picks_the_model() -> None:
    gemini = object()
    with env(COVER_PROVIDER=None):
        assert process.cover_model({"cover_provider": "gemini", "extract_model": "fake-pro"}, gemini) == (gemini,
                                                                                                         "fake-pro")
    with env(ANTHROPIC_API_KEY="fake", CLAUDE_COVER_MODEL=None):
        client, model = process.cover_model({"cover_provider": "claude", "extract_model": "fake-pro"}, gemini)
        assert isinstance(client, claude.ClaudeText) and model == client.model == "claude-sonnet-5-5"
    with env(COVER_PROVIDER="claude"):
        assert claude.provider("COVER_PROVIDER") == "claude"


def test_no_dish_box_keeps_the_whole_frame() -> None:
    fake = FakeGemini([cover_answer("00:40")], [{"found": False, "box_2d": [0, 0, 0, 0]}])
    with tempfile.TemporaryDirectory() as tmp:
        play, dest = Path(tmp) / "play.mp4", Path(tmp) / "poster.jpg"
        video(play, 70, sharp_at=(40.5,))
        pick = C.make_cover(fake, "fake-pro", RECIPE, play, dest, MemoryUsage())
        assert (pick.at, pick.cropped, pick.still_at) == (40.5, False, None), pick
        assert size(dest) == (320, 240)


def test_no_finished_dish_leaves_the_poster_alone() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        play, dest = Path(tmp) / "play.mp4", Path(tmp) / "poster.jpg"
        video(play, 70, sharp_at=(40.5,))
        assert C.make_cover(FakeGemini([cover_answer(None)]), "fake-pro", RECIPE, play, dest, MemoryUsage()) is None
        assert not dest.exists()


# ---------- process.make_cover: the plate photo first, the pick's still saved ----------

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
            C.make_cover = lambda *a, **k: picked.append(a) or C.Pick(at=12.0, cropped=False, still_at=None)
            try:
                got = process.make_cover(None, "fake-pro", sample_recipe(), out, MemoryUsage())
            finally:
                C.make_cover = old
            assert got == "the finished dish at 12.0 s" and len(picked) == 1, (name, got)
            assert not (out / "poster.jpg").exists(), name  # the fake pick wrote nothing; the photo didn't either


def test_the_picks_last_step_still_is_saved_for_publish() -> None:
    recipe = sample_recipe()
    last = recipe.steps[-1]
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / "work").mkdir()
        times = out / "work" / process.STILL_TIMES
        old = C.make_cover
        try:
            C.make_cover = lambda *a, **k: C.Pick(at=12.0, cropped=True, still_at=last.start_s + 3.5)
            got = process.make_cover(None, "fake-pro", recipe, out, MemoryUsage())
            assert got == "the finished dish at 12.0 s, cropped to the dish", got
            assert json.loads(times.read_text()) == {str(last.order): last.start_s + 3.5}
            C.make_cover = lambda *a, **k: C.Pick(at=12.0, cropped=True, still_at=None)
            process.make_cover(None, "fake-pro", recipe, out, MemoryUsage())
            assert not times.exists()  # a new pick without a still drops the old one
        finally:
            C.make_cover = old


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
