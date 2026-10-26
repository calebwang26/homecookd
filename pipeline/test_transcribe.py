"""Tests for transcribe.py: Cartesia's word-timed transcript, its loops dropped, lines, keys and the cache; the
cleaned audio and its time map, the language check for an English tag, and the proofread copy.

    .venv/bin/python pipeline/test_transcribe.py

No network: requests.post and Claude are fakes (real ffmpeg on generated audio).
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

from pipeline import claude  # noqa: E402
from pipeline import transcribe as T  # noqa: E402
from pipeline.test_claude import FakeAnthropic, env  # noqa: E402
from pipeline.test_coverage import patched  # noqa: E402


def said(*text: str, at: float = 0.0, step: float = 0.5) -> list[dict]:
    words = " ".join(text).split()
    return [{"word": w, "start": at + i * step, "end": at + i * step + 0.4} for i, w in enumerate(words)]


def texts(words: list[dict]) -> str:
    return " ".join(w["word"] for w in words)


def test_a_word_or_phrase_looped_is_cut_to_one_copy() -> None:
    assert texts(T.drop_loops(said("हे बघ", "तुका " * 70, "पोहे घेतले"))) == "हे बघ तुका पोहे घेतले"
    looped = said("आता कांदा टाकते,", "तो कांदा जाओ लागेल, " * 10, "हो.")
    assert texts(T.drop_loops(looped)) == "आता कांदा टाकते, तो कांदा जाओ लागेल, हो."
    assert texts(T.drop_loops(said("Mmm. " * 209, "My fingers. " * 145))) == "Mmm. My fingers."


def test_the_cook_saying_something_two_or_three_times_is_kept() -> None:
    kept = said("पाच मिनिटं. पाच मिनिटं.", "stir stir stir", "like, like, like")
    assert T.drop_loops(kept) == kept


def test_a_word_that_is_one_character_looped_is_dropped() -> None:
    assert texts(T.drop_loops(said("कांदे", "हुँ" + "ँ" * 40, "मीठ"))) == "कांदे मीठ"


def test_lines_break_at_pauses_and_at_twelve_seconds() -> None:
    words = said("a b c", at=0.0) + said("d e", at=5.0) + said("x " * 30, at=20.0)
    got = T.lines(words)
    assert [(l["start"], l["text"]) for l in got[:2]] == [(0.0, "a b c"), (5.0, "d e")], got
    assert all(l["end"] - l["start"] <= T.LINE_MAX_S for l in got) and len(got) == 4, got


class FakePost:
    """Stands in for requests.post: answers each call from a script of (status, body) and keeps what it was sent."""

    def __init__(self, *answers: tuple[int, dict | str]) -> None:
        self.answers, self.calls = list(answers), []

    def __call__(self, url, timeout, headers, data, files):
        self.calls.append({"url": url, "headers": headers, "data": data, "file": files["file"][0]})
        status, body = self.answers.pop(0)
        text = body if isinstance(body, str) else json.dumps(body)
        return SimpleNamespace(ok=status < 400, status_code=status, text=text, json=lambda: json.loads(text))


HEARD = {"type": "transcript", "text": "...", "duration": 9.5,
         "words": [{"word": " हे", "start": 0.0, "end": 0.3}, {"word": "बघ", "start": 0.3, "end": 0.6}]
         + [{"word": "तुका", "start": 1.0, "end": 1.01}] * 50 + [{"word": " ", "start": 2.0, "end": 2.1}]}


def test_one_request_with_the_language_and_word_times_and_loops_dropped() -> None:
    post = FakePost((200, HEARD))
    with tempfile.TemporaryDirectory() as tmp, env(CARTESIA_API_KEY="k1", CARTESIA_API_KEYS_BACKUP=None), \
            patched(T.requests, "post", post):
        audio = Path(tmp) / "voice.m4a"
        audio.write_bytes(b"m4a")
        got = T.transcribe(audio, "mr")
    [call] = post.calls
    assert call["url"] == "https://api.cartesia.ai/stt" and call["file"] == "voice.m4a", call
    assert call["headers"] == {"Authorization": "Bearer k1", "Cartesia-Version": "2026-08-14"}, call
    assert call["data"] == {"model": "ink-whisper", "language": "mr", "timestamp_granularities[]": "word"}, call
    assert texts(got["words"]) == "हे बघ तुका" and got["text"] == "हे बघ तुका", got
    assert (got["language"], got["duration"], got["loop_words_dropped"]) == ("mr", 9.5, 49), got


def test_a_key_out_of_credits_moves_to_the_next_and_other_errors_dont() -> None:
    out = (402, '{"error_code": "quota_exceeded"}')
    with tempfile.TemporaryDirectory() as tmp, env(CARTESIA_API_KEY="k1", CARTESIA_API_KEYS_BACKUP="k2, k3"):
        audio = Path(tmp) / "voice.m4a"
        audio.write_bytes(b"m4a")
        post = FakePost(out, out, (200, HEARD))
        with patched(T.requests, "post", post):
            T.transcribe(audio, "en")
        assert [c["headers"]["Authorization"] for c in post.calls] == ["Bearer k1", "Bearer k2", "Bearer k3"]
        post = FakePost((500, "busy"))
        with patched(T.requests, "post", post), contextlib.suppress(T.TranscribeError):
            T.transcribe(audio, "en")
            raise AssertionError("a 500 should raise")
        assert len(post.calls) == 1


def tone(path: Path, *parts: tuple[str, float]) -> None:
    """A test recording: ("tone" | "quiet", seconds) parts, a 440 Hz tone at -20 dB or digital silence."""
    inputs, n = [], len(parts)
    for kind, secs in parts:
        src = f"sine=frequency=440:duration={secs}" if kind == "tone" else f"anullsrc=r=16000:cl=mono:d={secs}"
        inputs += ["-f", "lavfi", "-i", src]
    mix = "".join(f"[{i}:a]aresample=16000,aformat=channel_layouts=mono,volume=0.1[a{i}];" for i in range(n))
    mix += "".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[out]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", mix, "-map", "[out]", "-c:a", "aac",
                    str(path)], check=True)


ENGLISH = {"type": "transcript", "text": "...", "duration": 120.0,
           "words": [{"word": w, "start": i * 0.4, "end": i * 0.4 + 0.3} for i, w in
                     enumerate(("now we chop the onions really fine and then the garlic " * 12).split())]}


def test_the_transcript_is_cached_per_language() -> None:
    post = FakePost((200, HEARD), (200, ENGLISH))
    with tempfile.TemporaryDirectory() as tmp, env(CARTESIA_API_KEY="k1", TRANSCRIPT_PROOFREAD=None), \
            patched(T.requests, "post", post):
        out_dir = Path(tmp)
        tone(out_dir / "voice.m4a", ("tone", 3))
        first = T.transcript_file(out_dir, "mr")
        assert T.transcript_file(out_dir, "mr") == first and len(post.calls) == 1
        saved = json.loads((out_dir / "work" / "transcript.json").read_text())
        assert (saved["language"], saved["tagged_language"]) == ("mr", "mr"), saved
        T.transcript_file(out_dir, None)  # no language: English, a different transcript
        assert [c["data"]["language"] for c in post.calls] == ["mr", "en"]


# ---------- the cleaned audio ----------

def test_each_long_pause_is_cut_to_its_edges_and_times_map_back() -> None:
    spans = T.speech_spans([(2.0, 8.0), (9.0, 9.4), (12.0, 20.0)], 20.0)
    assert spans == [(0.0, 2.3), (7.7, 12.3)], spans  # a 0.4 s pause stays; the trailing one is gone
    tmap = [(0.0, 0.0, 2.3), (2.3, 7.7, 4.6)]
    assert [T.to_original(t, tmap) for t in (1.0, 2.29, 2.3, 3.3, 99.0)] == [1.0, 2.29, 7.7, 8.7, 12.3]


def test_clean_audio_cuts_a_long_quiet_stretch_and_every_word_lands_on_the_original_clock() -> None:
    clean_words = {"type": "transcript", "text": "", "duration": 4.6,
                   "words": [{"word": "हळद", "start": 0.5, "end": 1.0}, {"word": "टाकते", "start": 2.9, "end": 3.4}]}
    post = FakePost((200, clean_words))
    with tempfile.TemporaryDirectory() as tmp, env(CARTESIA_API_KEY="k1"), patched(T.requests, "post", post):
        voice = Path(tmp) / "voice.m4a"
        tone(voice, ("tone", 2), ("quiet", 6), ("tone", 2))
        got = T.transcribe_clean(voice, "mr")
    assert post.calls[0]["file"] == "clean.flac"
    assert 5.0 <= got["cut_s"] <= 5.6 and 9.8 <= got["duration"] <= 10.2, got  # 6 s of quiet down to ~0.6 s
    first, second = got["words"]
    assert first["start"] == 0.5 and 8.0 <= second["start"] <= 8.3, got["words"]  # 2.9 s in the cut audio


def test_digital_silence_counts_as_quiet_not_as_the_noise_floor() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "a.wav"
        tone(wav.with_suffix(".m4a"), ("tone", 2), ("quiet", 8), ("tone", 2))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav.with_suffix(".m4a")), "-ac", "1", "-ar", "16000",
                        str(wav)], check=True)
        assert T.quiet_level(wav) < -100  # mostly digital silence: never the tone's level, or all of it would go


# ---------- the language check ----------

def test_doubtful_english_names_its_signs() -> None:
    poha = {"words": [{"word": w, "start": 0, "end": 0} for w in ["I'll", "put", "foreign"] * 80],
            "loop_words_dropped": 1403, "duration": 632}  # Poha tagged English, Oct 26: 248 words, 1403 loops
    assert T.doubtful_english(poha) == '85% of its words were loops; only 23 words a minute; 80 "foreign" markers'
    steak = {"words": [{"word": "onion", "start": 0, "end": 0}] * 6522, "loop_words_dropped": 499, "duration": 3103}
    assert T.doubtful_english(steak) is None


def fake_transcribe(said: dict):
    """T.transcribe stand-in: each language's own transcript, and the calls made."""
    calls = []

    def transcribe(audio, language):
        calls.append((Path(audio).name, language))
        words = [{"word": w, "start": i * 0.5, "end": i * 0.5 + 0.4} for i, w in enumerate(said[language].split())]
        return {"language": language, "duration": 120.0, "text": said[language], "words": words,
                "loop_words_dropped": 400 if language == "en" else 0}
    return transcribe, calls


def test_an_english_tag_on_marathi_is_caught_and_the_transcript_redone() -> None:
    said = {c: "garbled" for c in ("en", *T.COOK_LANGUAGES)}
    said.update(en="I will put the water in the water", mr="आता मोहरी टाकते जिरे टाकते")
    transcribe, calls = fake_transcribe(said)
    fake = FakeAnthropic({"language": "mr", "sure": True, "why": "only the Marathi reads as cooking speech"})
    with tempfile.TemporaryDirectory() as tmp, env(ANTHROPIC_API_KEY="fake", TRANSCRIPT_PROOFREAD=None), \
            patched(T, "transcribe", transcribe), patched(claude.anthropic, "Anthropic", fake):
        out_dir = Path(tmp)
        tone(out_dir / "voice.m4a", ("tone", 3))
        got = T.transcript_file(out_dir, "en")
        again = T.transcript_file(out_dir, "en")  # the same tag again: the cached Marathi transcript
    assert (got["language"], got["tagged_language"]) == ("mr", "en") and again == got, got
    assert "tagged English, but" in got["language_note"] and "only the Marathi" in got["language_note"]
    langs = [lang for name, lang in calls]
    assert langs[0] == "en" and sorted(langs[1:15]) == sorted(("en", *T.COOK_LANGUAGES)) and langs[15:] == ["mr"]
    assert {name for name, lang in calls[1:15]} == {"sample.flac"}
    prompt = fake.calls[0]["messages"][0]["content"][-1]["text"]
    assert "[mr: Marathi]\nआता मोहरी टाकते जिरे टाकते" in prompt and "never by the script alone" in prompt


def test_unsure_or_failing_checks_keep_english() -> None:
    said = {c: "garbled" for c in ("en", *T.COOK_LANGUAGES)}
    for answer in ({"language": "mr", "sure": False, "why": "two read as speech"}, ("", "refusal")):
        transcribe, calls = fake_transcribe(said)
        with tempfile.TemporaryDirectory() as tmp, env(ANTHROPIC_API_KEY="fake", TRANSCRIPT_PROOFREAD=None), \
                patched(T, "transcribe", transcribe), patched(claude.anthropic, "Anthropic", FakeAnthropic(answer)):
            tone(Path(tmp) / "voice.m4a", ("tone", 3))
            got = T.transcript_file(Path(tmp), "en")
        assert got["language"] == "en" and "tagged English, but" in got["language_note"], got
        assert [lang for _, lang in calls].count("en") == 2  # the full English one and the sample's: no redo


# ---------- the proofread copy ----------

def test_proofread_fixes_spelling_but_a_rewrite_or_an_addition_keeps_her_words() -> None:
    spoken = [{"start": 10.0, "end": 12.0, "text": "जैसे मिर टाकला मंजे लवकर ब्राउन होता कांदे"},
              {"start": 13.0, "end": 15.0, "text": "मलाफारावडाई चे पोहे माजा आईने बनावली होती ना"},
              {"start": 16.0, "end": 17.0, "text": "प्रवाइब प्"},
              {"start": 18.0, "end": 19.0, "text": "वाटी भर"},
              {"start": 20.0, "end": 21.0, "text": "हळद"}]
    fixes = {"lines": [{"id": 0, "text": "जसे मीठ टाकले म्हणजे लवकर ब्राउन होतात कांदे"},
                       {"id": 1, "text": "आता खोबरे टाकते हां"},  # another line's words: a rewrite
                       {"id": 2, "text": ""},  # noise
                       {"id": 3, "text": "एक वाटी भर, तर सुमारे अर्धी वाटी भर टाकते आहे"}]}  # far longer: an addition
    fake = FakeAnthropic(fixes)
    got, tokens = T.proofread(spoken, "mr", "Kanda Poha", claude.ClaudeText("claude-opus-5-5", client=fake))
    assert [(x["start"], x["text"]) for x in got] == [
        (10.0, "जसे मीठ टाकले म्हणजे लवकर ब्राउन होतात कांदे"),
        (13.0, "मलाफारावडाई चे पोहे माजा आईने बनावली होती ना"),
        (18.0, "वाटी भर"), (20.0, "हळद")], got  # id 4 missing from the answer: kept as it was
    assert tokens == {"in": 1000, "out": 300}, tokens
    prompt = fake.calls[0]["messages"][0]["content"][-1]["text"]
    assert "speaking Marathi while cooking \"Kanda Poha\"" in prompt and "0 | जैसे मिर टाकला" in prompt
    assert "Amounts and numbers stay exactly as heard" in prompt


def test_a_long_story_lines_correction_is_kept() -> None:
    """Poha's story (Oct 26), one 290-character line: Opus's correction keeps 0.84 of its sound, but difflib's
    autojunk scored it 0.24 and the guard threw the story's correction away. A line answered with another line's
    words is still refused."""
    raw = 'में खुप लहान होती ना ते वा माजा आईने पोहे केले होती ते वा मी खनले एरे काट पड़तो एगमाई इदे टाक हां मलाफारावडाई चे पोहे माजा आईने बनावली होती ना मलाफारावडाई चे ते माजा आईने बनावली होती ना मलाफारावडाई चे ते माजाले का पोहे आता है अरदाले मी ते चावराता है खूबर टाकते हां खूबर चान लगता है ते ते ते'
    fixed = 'मी खूप लहान होते ना तेव्हा माझ्या आईने पोहे केले होते तेव्हा मी खाल्ले एरे काट पडतो एगमाई इदे टाक हां मला फार आवडायचे पोहे माझ्या आईने बनवले होते ना मला फार आवडायचे ते माझ्या आईने बनवले होते ना मला फार आवडायचे ते माझ्याले का पोहे आता हे झाले मी ते त्याच्यावर हे खोबरं टाकते हां खोबरं छान लागतं हे ते ते ते'
    other = 'अजय पण शेव पण आवडते शेव टाकते आता खोबरं टाकते हं अजय तुम्हाला खायचेत पोहे हं मला पण खूप आवडतात पोहे अजय असं करते वाटते पोहे आता तुम्हाला खायचेत मी'
    assert len(raw) > 200 and T.kept_sounds(raw, fixed) > 0.8
    assert T.kept_sounds(raw, other) < T.MIN_KEPT
    fake = FakeAnthropic({"lines": [{"id": 0, "text": fixed}, {"id": 1, "text": fixed}]})
    spoken = [{"start": 556.0, "end": 585.0, "text": raw}, {"start": 588.0, "end": 618.0, "text": other}]
    got, _ = T.proofread(spoken, "mr", "Kanda Poha", claude.ClaudeText("claude-opus-5-5", client=fake))
    assert [x["text"] for x in got] == [fixed, other], got  # the story's correction kept; the swap refused


def test_the_proofread_copy_is_made_only_with_the_flag_and_not_for_english() -> None:
    marathi = {"type": "transcript", "text": "", "duration": 3.0,
               "words": [{"word": "मिर", "start": 0.2, "end": 0.6}, {"word": "टाकला", "start": 0.7, "end": 1.1}]}
    for flag, said, made in ((None, marathi, False), ("claude", ENGLISH, False), ("claude", marathi, True)):
        fake = FakeAnthropic({"lines": [{"id": 0, "text": "मीठ टाकला"}]})
        with tempfile.TemporaryDirectory() as tmp, env(CARTESIA_API_KEY="k1", ANTHROPIC_API_KEY="fake",
                                                       TRANSCRIPT_PROOFREAD=flag, CLAUDE_PROOFREAD_MODEL=None), \
                patched(T.requests, "post", FakePost((200, said))), patched(claude.anthropic, "Anthropic", fake):
            tone(Path(tmp) / "voice.m4a", ("tone", 3))
            got = T.transcript_file(Path(tmp), "en" if said is ENGLISH else "mr")
        assert ("proofread" in got) == made, (flag, got.get("proofread"))
        if made:
            assert got["proofread"]["model"] == "claude-opus-5-5" and fake.calls[0]["model"] == "claude-opus-5-5"
            assert [x["text"] for x in T.spoken_lines(got)] == ["मीठ टाकला"]  # the copy wins; the raw words stay
            assert [w["word"] for w in got["words"]] == ["मिर", "टाकला"]


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
