"""Tests for shorten.py's normalize() and check() rules (no Gemini call, no files written).

    .venv/bin/python pipeline/test_shorten.py

Covers the Oct 22 review rules: a detail is the line's fuller version or null (never the same words
again), amounts are measurements or nothing (a split ingredient is not shown its whole estimate), a line's
loose amount loses its bold where the card measures it, and a tip may not repeat the "Ready when" cue.
Also checks every bundled and synthetic recipe still passes check() as stored, and align.py's substep start_s
rules: recipes with audio have start_s on every substep (first = step.start_s, strictly increasing, inside the
step), recipes without media have none, and schema.py rejects a broken one. align_file (process.py's call
right after shorten) times a new recipe.json in place with a fake Gemini, and hears the cook's Marathi.
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

from pipeline import align as A  # noqa: E402
from pipeline import shorten as S  # noqa: E402
from pipeline.schema import Recipe  # noqa: E402
from pipeline.shorten import MemoryUsage  # noqa: E402


def recipe(steps: list[dict], ingredients: list[tuple[str, str]]) -> dict:
    return {"ingredients": [{"name": n, "feel": "", "estimate": e} for n, e in ingredients],
            "steps": [{"order": i + 1, "title": f"Step {i + 1}", "sensory_cue": None, "quote": None,
                       "wait_after": None, **s} for i, s in enumerate(steps)], "special": []}


def short(*steps: tuple[list[tuple[str, str | None]], list[tuple[str, str | None]], str | None]) -> S.ShortRecipe:
    return S.ShortRecipe(steps=[S.ShortStep(order=i + 1, substeps=[S.ShortSubstep(text=t, detail=d) for t, d in subs],
                                            uses=[S.ShortUse(name=n, amount=a) for n, a in uses], tip=tip)
                                for i, (subs, uses, tip) in enumerate(steps)])


def test_detail_is_the_fuller_line_or_nothing() -> None:
    assert S.tidy_detail("Add a splash of water to help it combine.", "Add **a splash** of water.") is None
    full = "Mix the miso paste, soy sauce, and mirin until the paste becomes liquid and easy to pour."
    assert S.tidy_detail(full, "Mix miso paste, soy sauce, and mirin.") == full
    # Only the new part: the line goes in front, so the tap still says the whole thing once.
    assert S.tidy_detail("they should have curled up and become firm", "Check the strips in the cold water.") == \
        "Check the strips in the cold water. They should have curled up and become firm."
    # A cue line: "Ready when" is only its frame.
    cue = "The green onion strips should have curled up and become firm."
    assert S.tidy_detail(cue, "Ready when **curled up**.") == cue


def test_amounts_are_measurements_or_nothing() -> None:
    r = recipe([{"instruction": "Wipe the grate with oil. Salt the fish."},
                {"instruction": "Heat the oil and pour it over a pinch of salt."},
                {"instruction": "Season with a pinch of pepper."}],
               [("neutral oil", "~1/2 cup"), ("salt", "~1 tbsp"), ("pepper", "~1 pinch")])
    out = S.normalize(short(([("Wipe the grate with oil.", None), ("Salt the fish.", None)],
                             [("neutral oil", "a wipe"), ("salt", "1 tbsp")], None),
                            ([("Heat the oil.", None), ("Pour it over **a pinch** of salt.", None)],
                             [("neutral oil", "~1/2 cup"), ("salt", "a pinch")], None),
                            ([("Season with **a pinch** of pepper.", None), ("Taste it.", None)],
                             [("pepper", "a pinch")], None)), r)
    s1, s2, s3 = out.steps
    assert [(u.name, u.amount) for u in s1.uses] == [("neutral oil", None), ("salt", "~1 tbsp")]  # split: no total
    assert [(u.name, u.amount) for u in s2.uses] == [("neutral oil", "~1/2 cup"), ("salt", None)]  # first measured use
    assert [(u.name, u.amount) for u in s3.uses] == [("pepper", "~1 pinch")]  # only step: the estimate
    assert s2.substeps[1].text == "Pour it over **a pinch** of salt."  # no measured salt on this card: stays bold
    assert s3.substeps[0].text == "Season with a pinch of pepper."  # the card says ~1 pinch: one amount


def test_numbers_heat_and_times_keep_their_bold() -> None:
    measured = {"steak", "water"}
    assert S.unbold_measured("Flip after **a couple of minutes** of steak.", measured) == \
        "Flip after **a couple of minutes** of steak."
    assert S.unbold_measured("Add **2 tbsp** of water.", measured) == "Add **2 tbsp** of water."
    assert S.unbold_measured("Ready when **a drop of water dances**.", measured) == "Ready when **a drop of water dances**."


def test_tip_may_not_repeat_the_ready_cue() -> None:
    r = recipe([{"instruction": "Pat the fish very dry.", "sensory_cue": "the skin feels dry"}], [])
    tip = "Dry skin is the secret. If it's wet it steams and sticks to the grill."
    errors = S.check(r, S.normalize(short(([("Pat the fish very dry.", None), ("Ready when **the skin feels dry**.", None)],
                                           [], tip)), r))
    assert any("repeats the line 'Ready when" in e for e in errors), errors
    assert not S.check(r, S.normalize(short(([("Pat the fish very dry.", None), ("Rub it with salt.", None)], [], tip)), r))


def test_stored_recipes_pass() -> None:
    for rid in S.all_ids():
        for path in S.copies(rid):
            r = json.loads(path.read_text())
            have = S.from_recipe(r)
            assert have is not None, f"{path}: no substeps"
            assert not S.check(r, have), f"{path}: {S.check(r, have)}"


def test_align_fixes_small_slips_and_rejects_big_ones() -> None:
    assert A.fix_offsets([0, 10, 20], 30) == ([0, 10, 20], [])
    assert A.fix_offsets([2, 10, 9, 31], 30) == ([0, 10, 11, 29], [])  # first -> 0, nudged, clamped
    assert A.fix_offsets([0, 20, 5], 30)[1]  # 15 s backwards: ask again
    assert A.fix_offsets([0, 10, 50], 30)[1]  # 20 s past the end: ask again
    assert A.fix_offsets([0, 1, 2], 2)[1]  # 3 substeps cannot fit in 2 s
    out = A.proportional(["aaaa", "**bb**", "cccccc"], 12)
    assert out == [0, 4, 6] and A.fix_offsets(out, 12) == (out, [])
    assert A.proportional(["a", "b", "c"], 3) == [0, 1, 2]


def test_stored_substep_start_s() -> None:
    timed = 0
    for path in sorted(S.BUNDLED.glob("*.json")) + sorted(S.SYNTHETIC.glob("*.json")):
        r = json.loads(path.read_text())
        assert not A.check(r), f"{path}: {A.check(r)}"
        timed += bool((r.get("media") or {}).get("audio_url"))
    assert timed >= 5, f"only {timed} recipes with audio"


def test_schema_rejects_bad_start_s() -> None:
    good = json.loads((S.BUNDLED / "weed-steak.json").read_text())
    Recipe.model_validate(good)
    step = good["steps"][1]
    for change in (lambda xs: xs[0].update(start_s=step["start_s"] + 1),  # first != step start
                   lambda xs: xs[2].update(start_s=xs[1]["start_s"]),  # not strictly increasing
                   lambda xs: xs[-1].update(start_s=step["end_s"]),  # at the step's end
                   lambda xs: xs[1].pop("start_s")):  # some timed, some not
        bad = json.loads(json.dumps(good))
        change(bad["steps"][1]["substeps"])
        try:
            Recipe.model_validate(bad)
        except ValueError as e:
            assert "substeps start_s" in str(e), e
        else:
            raise AssertionError("schema accepted a broken substep start_s")


class FakeAlign:
    """Stands in for genai.Client: answers every step with evenly spread substep times, keeps the prompts."""

    def __init__(self) -> None:
        self.prompts: list[str] = []
        self.models = SimpleNamespace(generate_content=self._generate)

    def _generate(self, model, contents, config):
        assert config.response_schema is A.AlignAnswer, config.response_schema
        text = "\n".join(c for c in contents if isinstance(c, str))
        self.prompts.append(text)
        steps = []
        for block in text.split("Step ")[1:]:
            order = int(block.split(":")[0])
            n = block.split("Substeps:")[1].split("What the cook says")[0].strip().count("\n") + 1
            length = A.parse_timestamp(block.split("Clip length ")[1].split(".")[0])
            steps.append({"order": order, "starts": [A.mmss(length * i // n) for i in range(n)]})
        meta = SimpleNamespace(prompt_token_count=100, candidates_token_count=20, thoughts_token_count=0)
        return SimpleNamespace(text=json.dumps({"steps": steps}), usage_metadata=meta, candidates=[],
                               prompt_feedback=None)


def test_align_file_times_a_new_recipe() -> None:
    r = json.loads((S.BUNDLED / "weed-steak.json").read_text())
    for s in r["steps"]:
        for x in s["substeps"]:
            x.pop("start_s", None)
    marathi = "आता कांदा कापायचा आहे."
    r["steps"][1]["quote_original"] = marathi
    r["media"]["audio_url"] = "voice.m4a"  # process.py's relative name; the file sits next to recipe.json
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "recipe.json"
        path.write_text(json.dumps(r, ensure_ascii=False))
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono",
                        "-t", str(r["media"]["duration_s"]), "-c:a", "aac", str(Path(tmp) / "voice.m4a")], check=True)
        fake = FakeAlign()
        how = A.align_file(path, fake, "fake-flash", MemoryUsage())
        after = json.loads(path.read_text())
    assert not A.check(after), A.check(after)
    assert set(how) == {s["order"] for s in r["steps"]} and all(h.startswith("gemini") for h in how.values()), how
    assert len(fake.prompts) == 1 and f'(as spoken: "{marathi}")' in fake.prompts[0], fake.prompts[0][:2000]
    assert after["steps"][1]["quote_original"] == marathi  # written back as Marathi, not \u escapes



def test_align_on_claude_reads_each_steps_transcript_lines() -> None:
    from pipeline import claude
    from pipeline import transcribe as T
    from pipeline.test_claude import FakeAnthropic
    r = json.loads((S.BUNDLED / "weed-steak.json").read_text())
    for s in r["steps"]:
        for x in s["substeps"]:
            x.pop("start_s", None)
    r["media"]["audio_url"] = "voice.m4a"
    step2 = r["steps"][1]
    heard = {"language": "en", "duration": 99.0, "text": "", "loop_words_dropped": 0,
             "words": [{"word": w, "start": step2["start_s"] + 65 + i * 0.3, "end": step2["start_s"] + 65.2 + i * 0.3}
                       for i, w in enumerate("now the miso glaze".split())]}
    even = {"steps": [{"order": s["order"], "starts": [A.mmss((s["end_s"] - s["start_s"]) * i // len(s["substeps"]))
                                                       for i in range(len(s["substeps"]))]} for s in r["steps"]]}
    fake = FakeAnthropic(even)

    def no_network(*_a, **_k):
        raise AssertionError("the cached transcript should be used")

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "recipe.json"
        path.write_text(json.dumps(r, ensure_ascii=False))
        (Path(tmp) / "voice.m4a").write_bytes(b"m4a")  # never cut: Claude gets the transcript, not clips
        (Path(tmp) / "work").mkdir()
        (Path(tmp) / "work" / T.FILE).write_text(json.dumps(heard))
        old_post, T.requests.post = T.requests.post, no_network
        try:
            how = A.align_file(path, claude.ClaudeText(client=fake), "claude-haiku-5-5", MemoryUsage())
        finally:
            T.requests.post = old_post
        after = json.loads(path.read_text())
    assert not A.check(after), A.check(after)
    assert all(h.startswith("claude attempt 1") for h in how.values()), how
    [call] = fake.calls
    prompt = call["messages"][0]["content"][-1]["text"]
    assert call["output_format"] is A.AlignAnswer and prompt.startswith("You are timing the substeps"), prompt[:200]
    assert f"Transcript of step 2:\n01:05 now the miso glaze\n" in prompt, prompt
    assert "Transcript of step 1:\n(no speech)" in prompt, prompt


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
