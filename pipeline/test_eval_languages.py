"""Tests for eval_languages.py's scoring (pure: no download, no model call).

    .venv/bin/python pipeline/test_eval_languages.py
"""
from __future__ import annotations

import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import eval_languages as E  # noqa: E402

VTT = """WEBVTT
Kind: captions
Language: ta

00:01:00.000 --> 00:01:04.500
<c>இப்போ</c> கடுகு போடுங்க

00:01:04.500 --> 00:01:08.000
இப்போ கடுகு போடுங்க

00:01:08.000 --> 00:01:12.000
கறிவேப்பிலை சேர்க்கவும் (மெதுவாக)

00:01:12.000 --> 00:01:14.000
[music] ♪
"""


def test_captions_parse_on_the_clips_clock_without_tags_or_rolling_repeats() -> None:
    cues = E.parse_vtt(VTT, offset_s=55.0)
    assert [(c["start"], c["text"]) for c in cues] == [(5.0, "இப்போ கடுகு போடுங்க"), (13.0, "கறிவேப்பிலை சேர்க்கவும்")]
    assert E.parse_vtt(VTT)[0]["start"] == 60.0


def test_heard_counts_the_captions_words_found_near_their_time() -> None:
    reference = [{"start": 5.0, "end": 9.0, "text": "now add the mustard seeds"},
                 {"start": 70.0, "end": 74.0, "text": "then the curry leaves"}]
    lines = [{"start": 6.0, "end": 9.0, "text": "now ad the mustard seed"},  # two close slips still count
             {"start": 200.0, "end": 203.0, "text": "then the curry leaves"}]  # far from its time: missed
    assert E.heard(reference, lines, "en") == 0.5  # minute 1: 5/5, minute 2: 0/4
    assert E.heard([], lines, "en") is None


def test_mandarin_is_matched_by_characters() -> None:
    assert E.tokens("先放油，再放葱花。", "zh") == list("先放油再放葱花")
    reference = [{"start": 1.0, "end": 3.0, "text": "先放油再放葱花"}]
    assert E.heard(reference, [{"start": 1.5, "end": 3.0, "text": "先放油在放葱"}], "zh") == round(5 / 7, 3)  # 再 misheard as 在, 花 missing


def test_script_share_counts_her_scripts_letters() -> None:
    assert E.script_share(["கடுகு போடுங்க"], "ta") == 1.0
    assert 0.0 < E.script_share(["கடுகு", "add mustard"], "ta") < 0.5  # mostly English letters
    assert E.script_share(["كمون"], "ar") == 1.0 and E.script_share(["کالی مرچ"], "ur") == 1.0
    assert E.script_share(["दाल"], "ta") == 0.0  # Devanagari in a Tamil quote
    assert E.script_share(["sal y pimienta"], "es") is None and E.script_share([""], "hi") is None


def test_ingredient_recall_uses_the_same_name_rules_as_the_ingredient_check() -> None:
    assert E.ingredient_recall(["mustard seeds", "curry leaves", "green chilli"],
                               ["Mustard seed", "green chillies (hari mirch)"]) == round(2 / 3, 3)
    assert E.ingredient_recall([], ["salt"]) is None


def test_every_clip_names_its_language_video_and_captions() -> None:
    import json
    clips = json.loads(E.CLIPS.read_text())
    langs = {c["lang"] for c in clips}
    assert langs <= {"en", "hi", "gu", "ta", "te", "pa", "ur", "zh", "ko", "tl", "es", "pt", "ar"}, langs
    for c in clips:
        assert c["id"] and c["sub_lang"] and c.get("dish"), c
        assert E.recipe_id(c).startswith("eval-") and E.recipe_id(c) == E.recipe_id(c).lower()


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
