"""Tests for transcribe.py: Cartesia's word-timed transcript, its loops dropped, lines, keys and the cache.

    .venv/bin/python pipeline/test_transcribe.py

No network: requests.post is a fake.
"""
from __future__ import annotations

import contextlib
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

from pipeline import transcribe as T  # noqa: E402
from pipeline.test_claude import env  # noqa: E402
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


def test_the_transcript_is_cached_per_language() -> None:
    post = FakePost((200, HEARD), (200, HEARD))
    with tempfile.TemporaryDirectory() as tmp, env(CARTESIA_API_KEY="k1"), patched(T.requests, "post", post):
        out_dir = Path(tmp)
        (out_dir / "voice.m4a").write_bytes(b"m4a")
        first = T.transcript_file(out_dir, "mr")
        assert T.transcript_file(out_dir, "mr") == first and len(post.calls) == 1
        assert json.loads((out_dir / "work" / "transcript.json").read_text())["language"] == "mr"
        T.transcript_file(out_dir, None)  # no language: English, a different transcript
        assert [c["data"]["language"] for c in post.calls] == ["mr", "en"]


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
