"""Tests for clip ordering (pipeline/order.py) and its wiring in prep.py / process.py.

    .venv/bin/python pipeline/test_order.py          # plain runner (pytest is not in the venv)
    pytest pipeline/test_order.py                    # also works if pytest is installed

No network and no paid calls: process.run talks to a fake Gemini client. The end-to-end tests make three
tiny clips with ffmpeg, run the real prep.py and process.py on them in a temp folder and check play.mp4.
"""
from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import order, prep, process  # noqa: E402
from pipeline.schema import ChunkEvent, ChunkOutput, RecipeDraft, TimedChunkOutput  # noqa: E402


@contextlib.contextmanager
def patched(obj, name: str, value):
    old = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, old)


def answer(order_: list[int], confidence: str = "high", reason: str = "prep, then cooking, then plating"):
    return order.OrderAnswer(order=order_, confidence=confidence, reason=reason)


def manifest_of(durations: list[int], segments: dict[int, list[float]] | None = None, **session_extra) -> dict:
    """A manifest in recorded order; segments[k] = AI segment starts for session k (default one at 0)."""
    sessions, cursor = [], 0
    for k, dur in enumerate(durations, 1):
        starts = (segments or {}).get(k, [0.0])
        ais = [{"path": f"work/ai_{k:02d}_{j:02d}.mp4", "start_in_file_s": st,
                "duration_s": float(min(900, dur - st))} for j, st in enumerate(starts)]
        sessions.append({"index": k, "recorded_index": k, "recorded_at": f"2026-10-11T10:{k:02d}:00-07:00",
                         "offset_s": cursor, "duration_s": dur, "recorded_at_source": "com.apple.quicktime.creationdate",
                         "ai_files": ais, **session_extra})
        cursor += dur
    return {"id": "t", "title": "Test Dish", "duration_s": cursor, "sessions": sessions}


def step(file: int, start: int, end: int, action: str) -> dict:
    return {"type": "step", "start_s": start, "end_s": end, "action": action, "file": file}


# ---------- scorer ----------

def test_step_phase():
    assert order.step_phase("Preheat the oven to 350F.") == 0.0
    assert order.step_phase("Start chopping the garlic") == 0.0
    assert order.step_phase("Fry the chopped onions until golden.") == 1.0  # "chopped" is an adjective
    assert order.step_phase("Plate the steak and garnish with parsley.") == 2.0
    assert order.step_phase("Mix the flour and baking powder.") == 0.5  # "baking powder" is not baking
    assert order.step_phase("Slice and serve.") == 1.0  # mean of prep (0) and serving (2)
    assert order.step_phase("Add a pinch of salt.") is None
    assert order.step_phase("Add brown sugar and a slice of lemon.") is None
    assert order.step_phase("Pour oil into the frying pan.") is None


def test_scores_and_keyword_order():
    m = manifest_of([30, 40, 50])
    events = [step(1, 2, 10, "Plate the pancakes"), step(1, 12, 20, "Serve with syrup"),
              step(2, 32, 40, "Measure the flour"), step(2, 45, 60, "Whisk the eggs"),
              step(3, 72, 80, "Fry the batter"), {"type": "story", "start_s": 80, "end_s": 85, "file": 3, "text": "x"}]
    scores = order.session_scores(m, events)
    assert scores == {1: 2.0, 2: 0.25, 3: 1.0}, scores
    assert order.keyword_order([1, 2, 3], scores) == ([2, 3, 1], True)
    # 0.25 vs 0.5 is not a clear difference: no clear keyword order
    assert order.keyword_order([1, 2], {1: 0.5, 2: 0.25}) == ([2, 1], False)
    # an unscored clip -> no keyword opinion at all
    assert order.keyword_order([1, 2], {1: 2.0, 2: None}) == ([1, 2], False)
    assert order.keyword_order([1, 2], {1: 0.0, 2: 2.0}) == ([1, 2], False)  # same as recorded: nothing to do
    assert order.contradictions([1, 2, 3], scores) == [(1, 2), (1, 3)]
    assert order.contradictions([2, 3, 1], scores) == []


def test_timestamp_issues():
    m = manifest_of([60, 60])
    assert order.timestamp_issues(m["sessions"]) == []
    same = manifest_of([60, 60])
    same["sessions"][1]["recorded_at"] = same["sessions"][0]["recorded_at"]
    assert order.timestamp_issues(same["sessions"]) == ["clips 1 and 2 have the same creation date"]
    overlap = manifest_of([600, 60])  # clip 2 "starts" 1 min after clip 1, which is 10 min long
    assert order.timestamp_issues(overlap["sessions"]) == ["clip 2 starts before clip 1 ends"]
    mtime = manifest_of([60, 60])
    mtime["sessions"][0]["recorded_at_source"] = "file mtime"
    assert order.timestamp_issues(mtime["sessions"]) == ["clip 1 has no creation date"]
    mixed = manifest_of([60, 60])
    mixed["sessions"][1]["recorded_at_source"] = "creation_time"
    assert order.timestamp_issues(mixed["sessions"]) == ["creation dates come from different kinds of metadata"]


# ---------- decision rule ----------

def test_decide():
    rec = [1, 2, 3]
    clear = {1: 2.0, 2: 0.0, 3: 1.0}  # keywords: [2, 3, 1]
    vague = {1: 0.5, 2: 0.5, 3: None}
    bad_dates = ["clips 1 and 2 have the same creation date"]

    def chosen(scores, ans, issues):
        return order.decide(rec, scores, ans, issues)[0]

    # no model answer: keywords alone, only when the dates are unreliable
    assert chosen(clear, None, bad_dates) == [2, 3, 1]
    assert chosen(clear, None, []) == rec
    assert chosen(vague, None, bad_dates) == rec
    # a sure model reorders unreliable dates unless the keywords clearly disagree; good dates also need
    # the keywords to clearly give the same order (a multi-stage dish can look "out of order")
    assert chosen(vague, answer([3, 1, 2], "high"), []) == rec
    assert chosen(clear, answer([2, 3, 1], "high"), []) == [2, 3, 1]
    assert chosen(clear, answer([1, 3, 2], "high"), bad_dates) == rec  # puts plating (1) first: clash
    close = {1: 0.5, 2: 0.25, 3: 1.0}  # keywords lean [2, 1, 3] but not clearly
    assert chosen(close, answer([2, 1, 3], "high"), []) == rec
    assert chosen(close, answer([2, 1, 3], "high"), bad_dates) == [2, 1, 3]
    # a clip with no steps to place stays where its file date put it
    empty2 = {1: 2.0, 2: None, 3: 0.0}
    assert chosen(empty2, answer([3, 2, 1], "high"), bad_dates) == [3, 2, 1]
    assert chosen(empty2, answer([2, 3, 1], "high"), bad_dates) == rec
    assert chosen(empty2, answer([3, 1, 2], "high"), bad_dates) == rec
    assert "no steps" in order.decide(rec, empty2, answer([3, 1, 2], "high"), bad_dates)[1]
    # medium: only with unreliable dates AND agreeing keywords
    assert chosen(clear, answer([2, 3, 1], "medium"), bad_dates) == [2, 3, 1]
    assert chosen(clear, answer([2, 3, 1], "medium"), []) == rec
    assert chosen(vague, answer([2, 3, 1], "medium"), bad_dates) == rec
    # low, or the model agreeing with the dates: keep
    assert chosen(clear, answer([2, 3, 1], "low"), bad_dates) == rec
    assert chosen(clear, answer([1, 2, 3], "high"), bad_dates) == rec
    why = order.decide(rec, clear, answer([1, 3, 2], "high"), bad_dates)[1]
    assert "clashes" in why, why


def test_parse_answer():
    ok = order.parse_answer('{"order": [2, 1], "confidence": "high", "reason": "r"}', [1, 2])
    assert ok.order == [2, 1]
    for bad in ('{"order": [1, 1], "confidence": "high", "reason": "r"}',
                '{"order": [1], "confidence": "high", "reason": "r"}',
                '{"order": [1, 2], "confidence": "sure", "reason": "r"}'):
        try:
            order.parse_answer(bad, [1, 2])
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")


# ---------- offset shifting ----------

def _fresh_events(m: dict, chunks: dict[int, ChunkOutput]) -> list[dict]:
    return [e for i, (s, ai) in enumerate(order.chunk_jobs(m), 1)
            for e in process.offset_events(chunks[i], i, s, ai, m["duration_s"])]


def test_shift_matches_fresh_offsets():
    """Shifting events to a new layout gives exactly what process.offset_events computes from scratch
    for that layout (what a later cached run does), including the clamp at the end of a clip."""
    old = manifest_of([1000, 120, 300], segments={1: [0.0, 900.0]})  # clip 1 has two AI segments
    def ev(a, b, action):
        return ChunkEvent(type="step", start_s=a, end_s=b, action=action, ingredients=None,
                          sensory_cue=None, quote=None, text=None, why=None)
    chunks = {1: ChunkOutput(chunk_index=1, events=[ev(10, 50, "Plate it")]),
              2: ChunkOutput(chunk_index=2, events=[ev(5, 120, "Serve it")]),  # ends past the 100 s segment
              3: ChunkOutput(chunk_index=3, events=[ev(0, 30, "Chop onions"), ev(100, 121, "Measure rice")]),
              4: ChunkOutput(chunk_index=4, events=[ev(20, 60, "Fry onions")])}
    before = _fresh_events(old, chunks)
    assert [(e["file"], e["start_s"], e["end_s"]) for e in before] == \
        [(1, 10, 50), (2, 905, 1000), (3, 1000, 1030), (3, 1100, 1120), (4, 1140, 1180)]

    target = [2, 3, 1]
    new = json.loads(json.dumps(old))
    by_r = {s["recorded_index"]: s for s in new["sessions"]}
    new["sessions"], cursor = [by_r[r] for r in target], 0
    for n, s in enumerate(new["sessions"], 1):
        s["index"], s["offset_s"] = n, cursor
        cursor += s["duration_s"]
    owner = order.chunk_sessions(new)
    assert owner == {1: 1, 2: 1, 3: 2, 4: 3}  # numbering by recorded order survives the reorder
    deltas = {r: by_r[r]["offset_s"] - s["offset_s"] for r, s in
              ((s["recorded_index"], s) for s in old["sessions"])}
    shifted = order.shift_events(before, owner, deltas, order.chunk_limits(new))
    assert shifted == _fresh_events(new, chunks), (shifted, _fresh_events(new, chunks))
    assert [(e["file"], e["start_s"], e["end_s"]) for e in shifted] == \
        [(1, 430, 470), (2, 1325, 1420), (3, 0, 30), (3, 100, 120), (4, 140, 180)]

    gaps = [{"file": "work/ai_01_01.mp4", "chunk": 2, "start_s": 900, "end_s": 1000, "error": "x"}]
    assert order.shift_gaps(gaps, new) == [{**gaps[0], "start_s": 1320, "end_s": 1420}]


def test_prompt_is_stable_across_a_reorder():
    old = manifest_of([30, 40])
    events = [step(1, 2, 10, "Plate the pancakes"), step(2, 32, 40, "Measure the flour")]
    new = json.loads(json.dumps(old))
    new["sessions"] = [new["sessions"][1], new["sessions"][0]]
    new["sessions"][0].update(index=1, offset_s=0)
    new["sessions"][1].update(index=2, offset_s=40)
    moved = [step(1, 42, 50, "Plate the pancakes"), step(2, 2, 10, "Measure the flour")]
    p = order.build_prompt(old, events)
    assert p == order.build_prompt(new, moved)
    assert "Clip 1: 00:30 long" in p and "00:02-00:10 Measure the flour" in p
    assert "File dates: look consistent." in p
    old["sessions"][1]["recorded_at"] = old["sessions"][0]["recorded_at"]
    assert "File dates: clips 1 and 2 have the same creation date." in order.build_prompt(old, events)


def test_failed_model_call_is_not_cached():
    """No model answer -> the keyword-only decision is recorded but not reused: the next run asks again."""
    m = manifest_of([30, 40])
    events = [step(1, 2, 10, "Fry the eggs"), step(2, 32, 40, "Serve the eggs")]
    calls = []

    def ask(answer_):
        def f(prompt, ids):
            calls.append(ids)
            return answer_
        return f

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / "work").mkdir()
        quiet = lambda _m: None  # noqa: E731
        m1, _, _ = order.order_sessions(out, m, events, [], ask(None), log=quiet)
        assert m1["order"]["basis"] is None and m1["order"]["chosen"] == [1, 2], m1["order"]
        m2, _, _ = order.order_sessions(out, m1, events, [], ask(answer([1, 2], "low")), log=quiet)
        assert len(calls) == 2 and m2["order"]["basis"], m2["order"]
        order.order_sessions(out, m2, events, [], ask(answer([1, 2], "low")), log=quiet)
        assert len(calls) == 2  # a real answer is cached


# ---------- end to end with ffmpeg & a fake Gemini ----------

COLORS = {"plate": "red", "prep": "green", "cook": "blue"}
ACTIONS = {"plate": "Plate the dish and garnish it", "prep": "Chop the onions and measure the rice",
           "cook": "Fry the onions until golden"}
LENGTHS = {"plate": 3, "prep": 4, "cook": 5}
INPUT_ORDER = ["plate", "prep", "cook"]  # same file dates, so prep.py keeps this (wrong) order


def make_clip(path: Path, role: str) -> None:
    d = LENGTHS[role]
    prep.ffmpeg("-f", "lavfi", "-i", f"color=c={COLORS[role]}:s=320x240:r=10:d={d}",
                "-f", "lavfi", "-i", f"sine=frequency=440:duration={d}:sample_rate=48000",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
                "-metadata", "creation_time=2026-10-11T17:00:00Z", str(path))


def color_at(video: Path, t: float) -> str:
    rgb = subprocess.run([prep.find_tool("ffmpeg"), "-v", "error", "-ss", f"{t:.2f}", "-i", str(video),
                          "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout[:3]
    return ("red", "green", "blue")[max(range(3), key=lambda k: rgb[k])]


def resp(data) -> SimpleNamespace:
    meta = SimpleNamespace(prompt_token_count=100, candidates_token_count=20, thoughts_token_count=0)
    return SimpleNamespace(text=json.dumps(data), usage_metadata=meta, candidates=[], prompt_feedback=None)


class FakeGemini:
    """Stands in for genai.Client: canned extraction per clip, a scripted order answer, and a merge that
    turns every step event it is given into one recipe step (and records the events it saw)."""

    def __init__(self, roles: dict[int, str], order_answer: dict | None):
        self.roles, self.order_answer = roles, order_answer
        self.calls = {"extract": 0, "order": 0, "merge": 0}
        self.merge_events: list[dict] = []
        self.files = SimpleNamespace(upload=self._upload, get=lambda name: None, delete=lambda name: None)
        self.models = SimpleNamespace(generate_content=self._generate)

    def __call__(self, **_kwargs):  # used as the genai.Client class
        return self

    def _upload(self, file):
        return SimpleNamespace(name=f"files/{Path(file).name}", state=SimpleNamespace(name="ACTIVE"), path=Path(file))

    def _generate(self, model, contents, config):
        schema = config.response_schema
        if schema is TimedChunkOutput:
            self.calls["extract"] += 1
            k = int(contents[0].path.stem.split("_")[1])  # ai_NN.mp4 -> recorded index
            role = self.roles[k]
            return resp({"chunk_index": 1, "events": [
                {"type": "step", "start": "00:00", "end": "00:02", "action": ACTIONS[role], "ingredients": None,
                 "sensory_cue": None, "quote": f"this is the {role} clip", "text": None, "why": None}]})
        if schema is order.OrderAnswer:
            self.calls["order"] += 1
            if self.order_answer is None:
                raise RuntimeError("model unavailable")
            return resp(self.order_answer)
        assert schema is RecipeDraft, schema
        self.calls["merge"] += 1
        events = json.loads(contents.split("seconds from the start of the full video):\n", 1)[1])
        self.merge_events = events
        steps = [{"order": n, "title": e["action"], "instruction": e["action"], "sensory_cue": None,
                  "start_s": e["start_s"], "end_s": max(e["end_s"], e["start_s"] + 1), "quote": e.get("quote"),
                  "wait_after": None}
                 for n, e in enumerate((e for e in events if e["type"] == "step"), 1)]
        return resp({"title": "Test Dish", "intro": "A test.", "servings": None, "total_time": None, "tags": [],
                     "ingredients": [], "steps": steps, "stories": [], "special": [], "follow_up_questions": []})


@contextlib.contextmanager
def sandbox(fake: FakeGemini):
    with tempfile.TemporaryDirectory(prefix="homecookd-order-") as tmp:
        out_root = Path(tmp) / "out"
        env = {"GEMINI_API_KEY": "fake-key-for-tests", "GEMINI_MODEL": "fake-pro",
               "GEMINI_EXTRACT_MODEL": "fake-flash", "GEMINI_MEDIA_RESOLUTION": "LOW",
               "RECIPE_WRITER": "gemini"}  # the fake stands in for Gemini only; never call the real Muse
        saved = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            with patched(prep, "OUT_ROOT", out_root), patched(process, "OUT_ROOT", out_root), \
                    patched(process, "load_dotenv", lambda *a, **k: None), \
                    patched(process.genai, "Client", fake):
                clips = []
                for role in INPUT_ORDER:
                    clips.append(Path(tmp) / f"{role}.mov")
                    make_clip(clips[-1], role)
                yield out_root, clips
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


def probe_len(path: Path) -> float:
    return prep.probe_duration(path)


def test_reorder_three_clips_end_to_end():
    fake = FakeGemini({1: "plate", 2: "prep", 3: "cook"},
                      {"order": [2, 3, 1], "confidence": "high", "reason": "prep, cooking, then plating"})
    with sandbox(fake) as (out_root, clips):
        prep.run("t-order", "Test Dish", "Mom", "Mom", clips)
        out, work = out_root / "t-order", out_root / "t-order" / "work"
        before = json.loads((work / "manifest.json").read_text())
        assert [s["recorded_index"] for s in before["sessions"]] == [1, 2, 3]
        assert color_at(out / "play.mp4", 1) == "red"  # the plating clip first: wrong

        process.run("t-order")
        m = json.loads((work / "manifest.json").read_text())
        rec = m["order"]
        assert rec["recorded"] == [1, 2, 3] and rec["chosen"] == [2, 3, 1] and rec["reordered"], rec
        assert rec["model"]["confidence"] == "high" and rec["model"]["model"] == "fake-flash", rec
        assert "same creation date" in " ".join(rec["timestamp_issues"]), rec
        assert rec["keywords"] == {"scores": {"1": 2.0, "2": 0.0, "3": 1.0}, "order": [2, 3, 1], "clear": True}
        assert [s["recorded_index"] for s in m["sessions"]] == [2, 3, 1]
        assert [s["index"] for s in m["sessions"]] == [1, 2, 3]
        lens = {r: probe_len(work / f"play_{r:02d}.mp4") for r in (1, 2, 3)}
        assert [s["offset_s"] for s in m["sessions"]] == [0, round(lens[2]), round(lens[2] + lens[3])]
        total = probe_len(out / "play.mp4")
        assert abs(total - sum(lens.values())) < 0.5 and m["duration_s"] == int(total)
        assert abs(probe_len(out / "voice.m4a") - total) < 0.5
        for s, want in zip(m["sessions"], ("green", "blue", "red")):
            assert color_at(out / "play.mp4", s["offset_s"] + 1) == want, (s, want)

        # every event moved with its clip; the merge saw the new times
        offsets = {s["recorded_index"]: s["offset_s"] for s in m["sessions"]}
        got = sorted((e["file"], e["start_s"], e["end_s"]) for e in fake.merge_events)
        assert got == [(k, offsets[k], offsets[k] + 2) for k in (1, 2, 3)], got
        assert json.loads((work / "chunk_01.offset.json").read_text())["events"][0]["start_s"] == offsets[1]
        recipe = json.loads((out / "recipe.json").read_text())
        assert [st["title"] for st in recipe["steps"]] == [ACTIONS["prep"], ACTIONS["cook"], ACTIONS["plate"]]
        assert [s["offset_s"] for s in recipe["sessions"]] == [s["offset_s"] for s in m["sessions"]]
        assert recipe["media"]["duration_s"] == m["duration_s"]
        # swap guards gone after success, no half-built files left
        assert_no_swap_files(work)
        assert not list(work.glob("*.part*"))
        assert fake.calls == {"extract": 3, "order": 1, "merge": 1}, fake.calls

        # prep again without --force: nothing re-encodes, so the cooking order is kept
        prep.run("t-order", "Test Dish", "Mom", "Mom", clips)
        again = json.loads((work / "manifest.json").read_text())
        assert again["sessions"] == m["sessions"] and again["order"] == rec

        # process again: cached extraction & cached decision (no model call), no media rebuild
        inode = (out / "play.mp4").stat().st_ino
        (out / "recipe.json").unlink()
        process.run("t-order")
        assert fake.calls == {"extract": 3, "order": 1, "merge": 2}, fake.calls
        assert (out / "play.mp4").stat().st_ino == inode
        # --force re-extracts and asks again; same answer -> still no rebuild
        process.run("t-order", force=True)
        assert fake.calls == {"extract": 6, "order": 2, "merge": 3}, fake.calls
        assert (out / "play.mp4").stat().st_ino == inode
        assert json.loads((work / "manifest.json").read_text())["order"]["chosen"] == [2, 3, 1]

        # the model changes its mind (keeps the dates): --force rebuilds play.mp4 in recorded order
        fake.order_answer = {"order": [1, 2, 3], "confidence": "high", "reason": "dates are fine"}
        process.run("t-order", force=True)
        m2 = json.loads((work / "manifest.json").read_text())
        assert [s["recorded_index"] for s in m2["sessions"]] == [1, 2, 3] and not m2["order"]["reordered"]
        assert color_at(out / "play.mp4", 1) == "red"
        assert_no_swap_files(work)


def assert_no_swap_files(work: Path) -> None:
    left = [p.name for p in work.iterdir()
            if p.name in (prep.SWAP_PENDING, prep.PREV_PLAY, prep.PREV_VOICE, *prep.LEGACY_BACKUPS)
            or ".reorder" in p.name]
    assert not left, left


def first_step(out: Path) -> tuple[str, str]:
    """(title, color of play.mp4 one second into the step) of recipe.json's first step."""
    recipe = json.loads((out / "recipe.json").read_text())
    st = recipe["steps"][0]
    return st["title"], color_at(out / "play.mp4", st["start_s"] + 1)


def test_reorder_sets_old_recipe_aside_when_merge_fails():
    """process --force reorders a recipe that already has a recipe.json, then the merge fails: the old
    recipe.json (times for the old play.mp4) must not stay where publish.py would ship it."""
    fake = FakeGemini({1: "plate", 2: "prep", 3: "cook"},
                      {"order": [1, 2, 3], "confidence": "high", "reason": "dates are fine"})

    def failing_merge(*_a, **_k):
        raise process.ProcessError("merge failed (simulated)")

    with sandbox(fake) as (out_root, clips):
        prep.run("t-stale", "Test Dish", "Mom", "Mom", clips)
        out, work = out_root / "t-stale", out_root / "t-stale" / "work"
        process.run("t-stale")
        assert first_step(out) == (ACTIONS["plate"], "red")

        fake.order_answer = {"order": [2, 3, 1], "confidence": "high", "reason": "prep, cooking, then plating"}
        with patched(process, "merge", failing_merge):
            try:
                process.run("t-stale", force=True)
            except process.ProcessError:
                pass
            else:
                raise AssertionError("the merge should have failed")
        assert not (out / "recipe.json").exists() and (work / prep.STALE_RECIPE).exists()
        assert color_at(out / "play.mp4", 1) == "green"
        assert json.loads((work / "manifest.json").read_text())["order"]["chosen"] == [2, 3, 1]
        assert_no_swap_files(work)

        process.run("t-stale")  # recipe.json is gone, so this runs: cached extraction & decision
        assert first_step(out) == (ACTIONS["prep"], "green")
        assert not (work / prep.STALE_RECIPE).exists()


def test_prep_after_reorder_keeps_recipe_and_video_matched():
    fake = FakeGemini({1: "plate", 2: "prep", 3: "cook"},
                      {"order": [2, 3, 1], "confidence": "high", "reason": "prep, cooking, then plating"})
    with sandbox(fake) as (out_root, clips):
        prep.run("t-prep", "Test Dish", "Mom", "Mom", clips)
        out, work = out_root / "t-prep", out_root / "t-prep" / "work"
        process.run("t-prep")
        assert first_step(out) == (ACTIONS["prep"], "green")
        reordered = json.loads((work / "manifest.json").read_text())

        # a playback copy goes missing: prep re-encodes it and re-concats in the cooking order
        (work / "play_02.mp4").unlink()
        prep.run("t-prep", "Test Dish", "Mom", "Mom", clips)
        m = json.loads((work / "manifest.json").read_text())
        assert m["sessions"] == reordered["sessions"] and m["order"] == reordered["order"]
        assert first_step(out) == (ACTIONS["prep"], "green")

        # --force rebuilds in file-date order: the recipe no longer matches, so it is set aside
        prep.run("t-prep", "Test Dish", "Mom", "Mom", clips, force=True)
        m = json.loads((work / "manifest.json").read_text())
        assert "order" not in m and [s["recorded_index"] for s in m["sessions"]] == [1, 2, 3]
        assert color_at(out / "play.mp4", 1) == "red"
        assert not (out / "recipe.json").exists() and (work / prep.STALE_RECIPE).exists()

        calls = fake.calls["order"]
        process.run("t-prep")  # runs again (no recipe.json), decides again, reorders again
        assert fake.calls["order"] == calls + 1
        assert first_step(out) == (ACTIONS["prep"], "green")
        assert not (work / prep.STALE_RECIPE).exists()


def test_interrupted_swap_is_undone():
    """A crash (here: Ctrl-C at the manifest write) after play.mp4 was swapped, going from one reordered
    layout to another: the next process run puts play.mp4, voice.m4a and recipe.json back."""
    fake = FakeGemini({1: "plate", 2: "prep", 3: "cook"},
                      {"order": [2, 3, 1], "confidence": "high", "reason": "prep, cooking, then plating"})
    real_write = prep.write_json

    def crash_at_commit(path, data):
        if path.name == "manifest.json" and (path.parent / prep.SWAP_PENDING).exists():
            raise KeyboardInterrupt
        real_write(path, data)

    with sandbox(fake) as (out_root, clips):
        prep.run("t-crash", "Test Dish", "Mom", "Mom", clips)
        out, work = out_root / "t-crash", out_root / "t-crash" / "work"
        process.run("t-crash")
        before = json.loads((work / "manifest.json").read_text())
        recipe = (out / "recipe.json").read_text()
        voice_len = probe_len(out / "voice.m4a")

        fake.order_answer = {"order": [1, 2, 3], "confidence": "high", "reason": "dates are fine"}
        with patched(prep, "write_json", crash_at_commit):
            try:
                process.run("t-crash", force=True)
            except KeyboardInterrupt:
                pass
            else:
                raise AssertionError("expected the simulated crash")
        assert color_at(out / "play.mp4", 1) == "red" and not (out / "recipe.json").exists()  # half-swapped
        assert (work / prep.SWAP_PENDING).exists()

        process.run("t-crash")  # undoes the swap, then finds recipe.json back and stops
        assert json.loads((work / "manifest.json").read_text()) == before
        assert (out / "recipe.json").read_text() == recipe
        assert first_step(out) == (ACTIONS["prep"], "green")
        assert abs(probe_len(out / "voice.m4a") - voice_len) < 0.1
        assert_no_swap_files(work)
        assert fake.calls["merge"] == 1  # the crashed --force run never reached the merge
def test_keyword_fallback_when_model_fails():
    fake = FakeGemini({1: "plate", 2: "prep", 3: "cook"}, None)  # every order call raises
    with sandbox(fake) as (out_root, clips):
        prep.run("t-kw", "Test Dish", "Mom", "Mom", clips)
        process.run("t-kw")
        m = json.loads((out_root / "t-kw" / "work" / "manifest.json").read_text())
        assert fake.calls["order"] == 2  # one retry
        assert m["order"]["model"] is None and m["order"]["chosen"] == [2, 3, 1], m["order"]
        assert color_at(out_root / "t-kw" / "play.mp4", 1) == "green"


def test_failed_rebuild_keeps_recorded_order():
    fake = FakeGemini({1: "plate", 2: "prep", 3: "cook"},
                      {"order": [2, 3, 1], "confidence": "high", "reason": "r"})

    def broken_concat(*_a, **_k):
        raise prep.PrepError("disk full (simulated)")

    with sandbox(fake) as (out_root, clips):
        prep.run("t-fail", "Test Dish", "Mom", "Mom", clips)
        out, work = out_root / "t-fail", out_root / "t-fail" / "work"
        inode = (out / "play.mp4").stat().st_ino
        with patched(prep, "concat", broken_concat):
            process.run("t-fail")
        m = json.loads((work / "manifest.json").read_text())
        assert [s["recorded_index"] for s in m["sessions"]] == [1, 2, 3]
        assert m["order"]["chosen"] == [1, 2, 3] and "failed" in m["order"]["why"], m["order"]
        assert (out / "play.mp4").stat().st_ino == inode and color_at(out / "play.mp4", 1) == "red"
        assert (out / "recipe.json").exists()
        assert_no_swap_files(work)


def test_single_clip_is_untouched():
    m = manifest_of([60])
    calls = []
    got = order.order_sessions(Path("/nonexistent"), m, [], [], lambda p, ids: calls.append(p), force=True)
    assert got == (m, [], []) and not calls


def main() -> None:
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("test_") and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet):
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
