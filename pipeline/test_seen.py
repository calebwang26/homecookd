"""Tests for seen.py: ingredients the frames show and nobody said (fake Claude, a generated video; no API call).

    .venv/bin/python pipeline/test_seen.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import claude  # noqa: E402
from pipeline import seen as S  # noqa: E402
from pipeline.schema import Recipe  # noqa: E402
from pipeline.shorten import MemoryUsage  # noqa: E402
from pipeline.test_claude import FakeAnthropic  # noqa: E402


def steak() -> Recipe:
    return Recipe.model_validate_json((ROOT / "app/assets/data/recipes/weed-steak.json").read_text())


def item(name: str, step: int, frames: list[str], sure: bool = True, estimate: str = "~1 sprig") -> S.SeenItem:
    return S.SeenItem(name=name, step=step, frames=frames, sure=sure, estimate=estimate, why="seen going in")


def test_a_listed_ingredient_under_another_form_counts_as_listed() -> None:
    names = ["green chillies", "Coriander (cilantro)", "mustard seeds", "salt"]
    assert S.listed("green chilli", names) and S.listed("chilli", names) and S.listed("coriander", names)
    assert S.listed("Mustard seed", names) and S.listed("salt", names)
    assert not S.listed("curry leaves", names) and not S.listed("turmeric", names)


def test_frames_spread_inside_each_step() -> None:
    assert S.frame_times(10, 50) == [15.0, 25.0, 35.0, 45.0]
    assert S.frame_times(0, 3, 2) == [0.75, 2.25]


def test_sure_needs_two_frames_of_its_step_and_the_rest_is_asked() -> None:
    r = steak()
    answer = S.SeenAnswer(items=[
        item("curry leaves", 2, ["2.1", "2.3"]),  # sure, two frames of step 2: added
        item("sesame seeds", 3, ["3.2"]),  # sure, but one frame: asked
        item("fenugreek", 4, ["4.1", "4.2"], sure=False),  # unsure: asked
        item("thyme", 4, ["4.1", "4.3"]),  # listed already: dropped
        item("paprika", 5, ["4.1", "6.2"]),  # its frames aren't step 5's: asked
        item("salt", 2, ["2.1", "2.2"]),  # listed already: dropped
        item("saffron", 99, ["99.1", "99.2"]),  # no such step: dropped
    ])
    add, ask = S.decide(answer, r)
    assert [i.name for i in add] == ["curry leaves"], add
    assert [i.name for i in ask] == ["sesame seeds", "fenugreek"], ask  # paprika too, but capped at MAX_ASK


def test_an_added_ingredient_joins_the_list_and_its_step_and_a_doubt_becomes_a_question() -> None:
    r = steak()
    out = S.apply(r, [item("curry leaves", 2, ["2.1", "2.2"])], [item("thyme", 3, ["3.2"], estimate="unknown")])
    new = out.ingredients[-1]
    assert (new.name, new.feel, new.estimate, new.confidence) == ("curry leaves", "", "~1 sprig", "medium")
    assert new.first_seen_s == r.steps[1].start_s
    assert out.steps[1].instruction.endswith("Add the curry leaves too.")
    q = out.follow_up_questions[-1]
    assert (q.id, q.about_step, q.ingredient) == ("seen-thyme", 3, "thyme")
    assert q.question.startswith("Step 3: we saw thyme but didn't hear it")
    assert out.model_dump(mode="json")["follow_up_questions"][-1]["ingredient"] == "thyme"  # what Convex reads
    assert all(x.ingredient is None for x in out.follow_up_questions[:-1])  # the writer's own questions: none
    again = S.apply(out.model_copy(update={"follow_up_questions": r.follow_up_questions}), [],
                    [item("Curry Leaves", 3, ["3.2"])])
    assert again.follow_up_questions[-1].id == "seen-curry-leaves"  # from the name: the same on every publish
    assert len(out.ingredients) == len(r.ingredients) + 1 and r.steps[1].instruction == steak().steps[1].instruction


def test_check_shows_claude_each_steps_frames_and_writes_what_it_did() -> None:
    r = steak()
    fake = FakeAnthropic({"items": [item("curry leaves", 2, ["2.1", "2.4"]).model_dump(),
                                    item("salt", 3, ["3.1", "3.2"]).model_dump()]})
    usage, logged = MemoryUsage(), []
    with tempfile.TemporaryDirectory() as tmp:
        play = Path(tmp) / "play.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                        f"testsrc2=size=160x90:rate=1:d={r.media.duration_s}", "-pix_fmt", "yuv420p", str(play)],
                       check=True)
        out = S.check(r, play, Path(tmp), usage, logged.append, claude.ClaudeText("claude-sonnet-5-5", client=fake))
        record = json.loads((Path(tmp) / "seen.json").read_text())
    assert [i.name for i in out.ingredients][-1] == "curry leaves" and len(out.ingredients) == len(r.ingredients) + 1
    assert record["added"] == ["curry leaves"] and record["asked"] == [] and record["frames"] == 4 * len(r.steps)
    content = fake.calls[0]["messages"][0]["content"]
    labels = [c["text"] for c in content if c["type"] == "text"]
    assert sum(c["type"] == "image" for c in content) == 4 * len(r.steps)
    assert labels[0].startswith(f"Step 1: {r.steps[0].title}.") and labels[0].endswith("Frame 1.1")
    assert labels[1] == "Frame 1.2" and "- salt" in labels[-1].lower() and "Find the ingredients you can SEE" in labels[-1]
    assert [c["kind"] for c in usage.calls] == ["seen"] and "added ['curry leaves']" in logged[0]


def test_on_with_the_claude_extraction_unless_switched_off() -> None:
    from pipeline.test_claude import env
    with env(INGREDIENT_CHECK=None):
        assert S.enabled({"extractor": "claude"}) and not S.enabled({"extractor": "gemini"})
    with env(INGREDIENT_CHECK="off"):
        assert not S.enabled({"extractor": "claude"})


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
