"""Tests for the post-merge coverage check (pipeline/coverage.py) and its wiring in process.py.

    .venv/bin/python pipeline/test_coverage.py       # plain runner (pytest is not in the venv)
    pytest pipeline/test_coverage.py                 # also works if pytest is installed

No network and no paid calls: the merge talks to a fake Gemini client with scripted answers.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import coverage, process  # noqa: E402
from pipeline.schema import RecipeDraft  # noqa: E402


def ev(start: int, end: int, action: str, kind: str = "step", file: int = 1) -> dict:
    out = {"type": kind, "start_s": start, "end_s": end, "file": file}
    out["action" if kind == "step" else "text"] = action
    return out


def steps_of(*spans: tuple[int, int]) -> list[dict]:
    return [{"order": n, "start_s": a, "end_s": b} for n, (a, b) in enumerate(spans, 1)]


# ---------- coverage.py ----------

def test_no_missing():
    events = [ev(10, 40, "Chop the onions"), ev(45, 50, "Preheat the pan"), ev(60, 120, "Fry the onions"),
              ev(20, 30, "My grandmother always...", kind="story")]
    report = coverage.check(events, steps_of((10, 50), (60, 120)))
    assert report["missing"] == [] and report["gaps"] == [], report
    assert report["extracted_steps"] == 3 and report["recipe_steps"] == 2, report


def test_one_missing():
    events = [ev(10, 40, "Chop the onions"), ev(45, 52, "Season with salt"), ev(60, 120, "Fry the onions")]
    report = coverage.check(events, steps_of((10, 40), (60, 120)))
    assert report["missing"] == [{"start_s": 45, "end_s": 52, "action": "Season with salt", "file": 1}], report


def test_boundary_split_step_merged_is_not_flagged():
    # One action cut by the 15-minute file boundary: file 1 ends it at 900, file 2 starts it at 900.
    events = [ev(850, 900, "Knead the dough", file=1), ev(900, 960, "Knead the dough", file=2),
              ev(970, 990, "Cover the bowl", file=2)]
    report = coverage.check(events, steps_of((850, 960), (970, 990)))
    assert report["missing"] == [], report
    # a grouped step (several actions, one technique) covers all of them too
    assert coverage.check(events, steps_of((850, 990)))["missing"] == []


def test_dropped_step_overlapping_its_neighbour_is_flagged():
    # Extracted ranges often overlap by a second or two; dropping "Season" must not pass for brushing a neighbour.
    events = [ev(10, 40, "Chop the onions"), ev(38, 52, "Season with salt"), ev(50, 120, "Fry the onions")]
    report = coverage.check(events, steps_of((10, 40), (50, 120)))
    assert [m["action"] for m in report["missing"]] == ["Season with salt"], report
    assert coverage.check(events, steps_of((10, 40), (40, 52), (52, 120)))["missing"] == []


def test_edges():
    one = [{"order": 1, "start_s": 100, "end_s": 200}]
    assert not coverage.covered(ev(80, 100, "only touches the start"), one)
    assert not coverage.covered(ev(200, 230, "only touches the end"), one)
    assert not coverage.covered(ev(90, 101, "one second of eleven inside"), one)
    assert coverage.covered(ev(95, 105, "half inside"), one)
    assert not coverage.covered(ev(94, 105, "just under half inside"), one)
    assert coverage.covered(ev(150, 150, "momentary, inside"), one)
    assert coverage.covered(ev(200, 200, "momentary, at the last second"), one)
    assert not coverage.covered(ev(201, 201, "momentary, after"), one)
    # two steps together can cover an event neither covers alone
    assert coverage.covered(ev(90, 130, "spans a step boundary"), steps_of((80, 105), (105, 112)))
    # stories and specials are not steps: never reported missing
    events = [ev(300, 320, "a memory", kind="story"), ev(330, 340, "unusual trick", kind="special")]
    assert coverage.check(events, one)["missing"] == []


def test_gap_detection():
    steps = steps_of((0, 60), (400, 460), (480, 520))
    busy = [ev(0, 60, "Chop"), ev(40, 250, "Simmer the sauce"), ev(400, 460, "Plate"), ev(480, 520, "Garnish")]
    gaps = coverage.check(busy, steps)["gaps"]
    assert len(gaps) == 1, gaps
    g = gaps[0]
    assert (g["start_s"], g["end_s"], g["seconds"], g["active_s"]) == (60, 400, 340, 190), g
    assert (g["after_step"], g["before_step"]) == (1, 2), g
    assert [e["action"] for e in g["events"]] == ["Simmer the sauce"], g

    # the same gap with only talk (or a few seconds of spill-over) in it is not reported
    quiet = [ev(0, 70, "Chop"), ev(100, 300, "the story of this dish", kind="story"), ev(400, 460, "Plate")]
    assert coverage.check(quiet, steps)["gaps"] == []
    # short gaps are fine; gap_s is configurable
    assert coverage.check(busy, steps, gap_s=400)["gaps"] == []
    assert len(coverage.check([ev(0, 60, "Chop"), ev(60, 100, "Stir")], steps_of((0, 60), (100, 120)),
                              gap_s=30)["gaps"]) == 1
    # an overlapped step (ends earlier than the one before it) does not open a false gap
    nested = steps_of((0, 500), (100, 150), (520, 560))
    assert coverage.check([ev(0, 560, "Braise")], nested)["gaps"] == []


def test_retry_lines_and_warnings():
    missing = [{"start_s": 308, "end_s": 340, "action": "Preheat the oven"}]
    assert coverage.retry_lines(missing) == "- 308-340 s: Preheat the oven"
    report = {"missing": missing, "gaps": []}
    lines = coverage.warnings(report)
    assert lines[0].startswith("!!! COVERAGE WARNING: 1 step(s)") and "05:08-05:40  Preheat the oven" in lines[1]
    assert coverage.warnings({"missing": [], "gaps": []}) == []


# ---------- process.py wiring (fake Gemini) ----------

def resp(data) -> SimpleNamespace:
    meta = SimpleNamespace(prompt_token_count=100, candidates_token_count=20, thoughts_token_count=0)
    text = data if isinstance(data, str) else json.dumps(data)
    return SimpleNamespace(text=text, usage_metadata=meta, candidates=[], prompt_feedback=None)


def draft(*steps: tuple[int, int, str]) -> dict:
    return {"title": "Test Dish", "intro": "A test.", "servings": None, "total_time": None, "tags": [],
            "ingredients": [], "stories": [], "special": [], "follow_up_questions": [],
            "steps": [{"order": n, "title": t, "instruction": t, "sensory_cue": None, "start_s": a, "end_s": b,
                       "quote": None, "wait_after": None} for n, (a, b, t) in enumerate(steps, 1)]}


class FakeMerge:
    """Stands in for genai.Client: each merge call returns the next scripted answer and keeps the prompt."""

    def __init__(self, *answers):
        self.answers, self.prompts = list(answers), []
        self.models = SimpleNamespace(generate_content=self._generate)

    def __call__(self, **_kwargs):  # used as the genai.Client class
        return self

    def _generate(self, model, contents, config):
        assert config.response_schema is RecipeDraft, config.response_schema
        self.prompts.append(contents)
        return resp(self.answers.pop(0))


MANIFEST = {"id": "t-cover", "title": "Test Dish", "cook": "Mom", "relation": "Mom", "duration_s": 300,
            "sessions": [{"index": 1, "recorded_at": "2026-10-11T10:00:00-07:00", "offset_s": 0, "duration_s": 300,
                          "ai_files": [{"path": "work/ai_01.mp4", "start_in_file_s": 0, "duration_s": 300.0}]}]}
EVENTS = [ev(10, 40, "Chop the onions"), ev(45, 52, "Season with salt"), ev(60, 120, "Fry the onions")]
DROPS_SALT = draft((10, 40, "Chop the onions"), (60, 120, "Fry the onions"))
KEEPS_SALT = draft((10, 40, "Chop the onions"), (45, 52, "Season with salt"), (60, 120, "Fry the onions"))


def run_merge(fake: FakeMerge, out: Path):
    (out / "work").mkdir(exist_ok=True)
    usage = process.Usage(out / "work" / "usage.json")
    first = process.merge(fake, "fake-pro", MANIFEST, EVENTS, 1, out, usage)
    return process.ensure_coverage(fake, "fake-pro", MANIFEST, EVENTS, 1, out, usage, first)


def test_retry_recovers_missing_step():
    fake = FakeMerge(DROPS_SALT, KEEPS_SALT)
    with tempfile.TemporaryDirectory() as tmp:
        recipe, report = run_merge(fake, Path(tmp))
        assert [s.title for s in recipe.steps] == ["Chop the onions", "Season with salt", "Fry the onions"]
        assert len(fake.prompts) == 2, len(fake.prompts)
        retry = fake.prompts[1]
        assert "left out these step events" in retry and "- 45-52 s: Season with salt" in retry, retry[-800:]
        assert '"title":"Chop the onions"' in retry  # the previous answer is fed back
        saved = json.loads((Path(tmp) / "work" / "coverage.json").read_text())
        assert saved == report and saved["missing"] == [], saved
        assert [m["action"] for m in saved["missing_before_retry"]] == ["Season with salt"], saved


def test_retry_that_still_misses_keeps_first_and_warns():
    fake = FakeMerge(DROPS_SALT, draft((10, 40, "Chop the onions")))
    with tempfile.TemporaryDirectory() as tmp:
        recipe, report = run_merge(fake, Path(tmp))
        assert [s.title for s in recipe.steps] == ["Chop the onions", "Fry the onions"]  # the retry missed more
        assert [m["action"] for m in report["missing"]] == ["Season with salt"], report
        saved = json.loads((Path(tmp) / "work" / "coverage.json").read_text())
        assert [m["action"] for m in saved["missing"]] == ["Season with salt"], saved
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            process.summarize(recipe, [], process.Usage(Path(tmp) / "work" / "usage.json"), report)
        tail = out.getvalue().strip().splitlines()
        assert tail[-2].startswith("!!! COVERAGE WARNING") and "Season with salt" in tail[-1], tail


def test_validation_retry_inside_coverage_retry_labels_both_answers():
    # The coverage retry's first answer fails validation: its retry prompt must say which recipe is which.
    fake = FakeMerge(DROPS_SALT, "not json", KEEPS_SALT)
    with tempfile.TemporaryDirectory() as tmp:
        recipe, report = run_merge(fake, Path(tmp))
        assert len(fake.prompts) == 3 and len(recipe.steps) == 3 and report["missing"] == [], report
        p = fake.prompts[2]
        assert "Your previous answer" not in p, p[-1500:]
        assert p.count("Your first recipe:") == 1 and p.count("Your last answer:") == 1, p[-1500:]
        assert p.index("- 45-52 s: Season with salt") < p.index("Your first recipe:") < p.index("Your last answer:")
        assert p.rstrip().endswith("follows all the rules and instructions above."), p[-300:]


def test_failed_retry_keeps_first():
    fake = FakeMerge(DROPS_SALT, "not json", "still not json")
    with tempfile.TemporaryDirectory() as tmp:
        recipe, report = run_merge(fake, Path(tmp))
        assert len(fake.prompts) == 3 and len(recipe.steps) == 2
        assert [m["action"] for m in report["missing"]] == ["Season with salt"], report


def test_complete_merge_is_not_retried():
    fake = FakeMerge(KEEPS_SALT)
    with tempfile.TemporaryDirectory() as tmp:
        recipe, report = run_merge(fake, Path(tmp))
        assert len(fake.prompts) == 1 and len(recipe.steps) == 3
        assert report["missing"] == [] and "missing_before_retry" not in report, report


def test_run_end_to_end_with_a_file_boundary():
    """process.run on cached extractions of two 150 s AI files: the merge first drops a step, the retry
    puts it back, and recipe.json + work/coverage.json reflect that."""
    manifest = json.loads(json.dumps(MANIFEST))
    manifest["sessions"][0]["ai_files"] = [
        {"path": "work/ai_01_00.mp4", "start_in_file_s": 0, "duration_s": 150.0},
        {"path": "work/ai_01_01.mp4", "start_in_file_s": 150, "duration_s": 150.0}]

    def step_ev(start: str, end: str, action: str) -> dict:
        return {"type": "step", "start": start, "end": end, "action": action, "ingredients": None,
                "sensory_cue": None, "quote": None, "text": None, "why": None}

    raws = {1: [step_ev("00:10", "00:40", "Chop the onions"), step_ev("02:00", "02:30", "Fry the onions")],
            2: [step_ev("00:00", "00:30", "Fry the onions"), step_ev("01:00", "01:10", "Season with salt")]}
    first = draft((10, 180, "Chop and fry the onions"))
    second = draft((10, 180, "Chop and fry the onions"), (210, 220, "Season with salt"))
    fake = FakeMerge(first, second)
    env = {"GEMINI_API_KEY": "fake-key-for-tests", "GEMINI_MODEL": "fake-pro", "GEMINI_EXTRACT_MODEL": "",
           "GEMINI_MEDIA_RESOLUTION": "LOW", "COVERAGE_GAP_S": ""}
    saved_env = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        with tempfile.TemporaryDirectory() as tmp, \
                patched(process, "OUT_ROOT", Path(tmp)), patched(process, "load_dotenv", lambda *a, **k: None), \
                patched(process.genai, "Client", fake), patched(process, "make_poster", lambda *a, **k: None):
            out = Path(tmp) / "t-cover"
            (out / "work").mkdir(parents=True)
            (out / "work" / "manifest.json").write_text(json.dumps(manifest))
            for i, events in raws.items():
                (out / "work" / f"chunk_{i:02d}.raw.json").write_text(json.dumps({"chunk_index": i, "events": events}))
            process.run("t-cover")
            recipe = json.loads((out / "recipe.json").read_text())
            assert [s["title"] for s in recipe["steps"]] == ["Chop and fry the onions", "Season with salt"], recipe
            report = json.loads((out / "work" / "coverage.json").read_text())
            assert report["missing"] == [] and report["extracted_steps"] == 4, report
            assert [m["start_s"] for m in report["missing_before_retry"]] == [210], report
            assert len(fake.prompts) == 2
    finally:
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@contextlib.contextmanager
def patched(obj, name: str, value):
    old = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, old)


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
