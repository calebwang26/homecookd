"""Tests for extract_claude.py (EXTRACTOR=claude): the frames Claude sees, the transcript cut to a clip, and one AI
file through process.Extraction (fake Claude, a generated video; no API call).

    .venv/bin/python pipeline/test_extract_claude.py
"""
from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import claude, process, writer  # noqa: E402
from pipeline import extract_claude as E  # noqa: E402
from pipeline.shorten import MemoryUsage  # noqa: E402
from pipeline.test_claude import FakeAnthropic, env  # noqa: E402
from pipeline.test_coverage import patched  # noqa: E402


def video(path: Path, seconds: int, size: str = "202x360") -> None:
    """Like prep.py's AI copy: one frame per second."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=1:d={seconds}",
                    "-pix_fmt", "yuv420p", str(path)], check=True)


def test_the_env_can_shrink_and_space_the_frames() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        clip = Path(tmp) / "ai.mp4"
        video(clip, 25, "640x360")
        seen, every = E.frames(clip)
        assert every == 1 and len(seen) == 25 and E.image_tokens(seen[0][1]) == 299  # 640x360: 23 x 13 tiles
        with env(CLAUDE_EXTRACT_FRAME_PX="448", CLAUDE_EXTRACT_EVERY_S="10"):
            seen, every = E.frames(clip)
        assert every == 10 and [label for label, _ in seen] == ["00:00", "00:10", "00:20"]
        assert E.image_tokens(seen[0][1]) == 144  # 448x252


def test_every_second_labelled_and_thinned_to_fit_one_call() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        clip = Path(tmp) / "ai.mp4"
        video(clip, 20)
        seen, every = E.frames(clip)
        assert every == 1 and [label for label, _ in seen[:3]] == ["00:00", "00:01", "00:02"] and len(seen) == 20
        assert E.image_tokens(seen[0][1]) == 104  # 202x360: 8 x 13 tiles of 28 px
        with patched(E, "SEEN_IMAGES", 7):
            seen, every = E.frames(clip)
        assert every == 3 and [label for label, _ in seen] == ["00:00", "00:03", "00:06", "00:09", "00:12",
                                                               "00:15", "00:18"], seen
        with patched(E, "SEEN_TOKENS", 104 * 5):
            assert E.frames(clip)[1] == 4  # 20 frames of 104 tokens, 520 a call


def test_a_big_frame_is_scaled_to_fit_640() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        clip = Path(tmp) / "big.mp4"
        video(clip, 2, "1280x720")
        seen, _ = E.frames(clip)
        assert E.image_tokens(seen[0][1]) == 23 * 13  # 640x360


def test_the_transcript_is_cut_to_the_clip_and_timed_from_its_start() -> None:
    lines = [{"start": 899.0, "end": 900.5, "text": "before"}, {"start": 905.4, "end": 907.0, "text": "हळद टाकते"},
             {"start": 1800.0, "end": 1801.0, "text": "after"}]
    assert E.heard(lines, 900, 900) == "00:05 हळद टाकते"
    assert E.heard([], 0, 60) == "(nothing said)"


def chunk(*events: tuple[str, str, str]) -> dict:
    return {"chunk_index": 1, "events": [
        {"type": "step", "start": a, "end": b, "action": what, "ingredients": [{"name": "turmeric", "feel": "थोडी",
                                                                               "estimate": "1/4 tsp"}],
         "sensory_cue": None, "quote": "Add a little turmeric.", "quote_original": "थोडी हळद टाकायची.", "text": None,
         "why": None} for a, b, what in events]}


def test_one_ai_file_goes_through_extraction_accept_like_gemini() -> None:
    late, good = chunk(("00:02", "00:30", "Add turmeric")), chunk(("00:02", "00:06", "Add turmeric"))
    fake = FakeAnthropic(late, good)  # the first answer runs past the clip: retried with the error, as on Gemini
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / "work").mkdir()
        video(out / "work" / "ai_01.mp4", 12)
        session = {"index": 1, "offset_s": 100, "duration_s": 12}
        ai = {"path": "work/ai_01.mp4", "start_in_file_s": 0.0, "duration_s": 12.0}
        manifest = {"title": "Poha", "language": "mr", "sessions": [session]}
        usage = process.Usage(out / "work" / "usage.json")
        job = process.Extraction({"extract_model": "gemini-x"}, 1, 1, session, ai, out, 200, usage, manifest)
        lines = [{"start": 103.2, "end": 104.0, "text": "थोडी हळद टाकायची"}]
        result = E.extract_one(job, claude.ClaudeText("claude-sonnet-5-5", client=fake), lines, False)
        assert [(e["start_s"], e["end_s"], e["action"]) for e in result["events"]] == [(102, 106, "Add turmeric")]
        assert (out / "work" / "chunk_01.raw.json").exists() and (out / "work" / "chunk_01.offset.json").exists()
        assert [(c["kind"], c["model"], c["ok"]) for c in usage.calls] == [
            ("extract", "claude-sonnet-5-5", False), ("extract", "claude-sonnet-5-5", True)], usage.calls
    first, second = (c["messages"][0]["content"] for c in fake.calls)
    labels = [b["text"] for b in first[:-1] if b["type"] == "text"]
    assert labels == [f"00:{s:02d}" for s in range(12)] and sum(b["type"] == "image" for b in first) == 12
    prompt = first[-1]["text"]
    assert prompt.startswith("You can't watch this clip as a video: it comes as 12 still frames, one every 1 sec")
    assert "file 1 of 1 of the recording" in prompt and "Marathi" in prompt  # the unchanged EXTRACT_PROMPT
    assert prompt.endswith("Transcript of this clip:\n00:03 थोडी हळद टाकायची\n"), prompt[-200:]
    assert "Your previous answer was rejected" in second[-1]["text"]
    assert fake.calls[0]["output_format"].__name__ == "TimedChunkOutput"


def test_process_run_extracts_on_claude_then_merges() -> None:
    """process.run with EXTRACTOR=claude on a fresh recording: the transcript (cached here), one Claude extraction per
    AI file, then the merge; Gemini is never asked to extract."""
    from pipeline import align, cover, shorten, transcribe, writer
    from pipeline.test_coverage import MANIFEST, draft
    manifest = json.loads(json.dumps(MANIFEST))
    manifest["sessions"][0]["ai_files"] = [{"path": "work/ai_01.mp4", "start_in_file_s": 0, "duration_s": 30.0}]
    manifest["duration_s"] = 30
    fake = FakeAnthropic(chunk(("00:02", "00:20", "Chop the onions")), draft((2, 20, "Chop the onions")))

    class NoGemini:
        def __init__(self, **_k):
            self.models = self.files = None  # any Gemini call fails loudly

    def broken(*_a, **_k):
        raise RuntimeError("not in this test")

    with env(GEMINI_API_KEY="fake", GEMINI_MODEL="fake-pro", GEMINI_EXTRACT_MODEL="", GEMINI_MEDIA_RESOLUTION="LOW", CLAUDE_BATCH="0",
             COVERAGE_GAP_S="", RECIPE_WRITER="claude", TEXT_PROVIDER=None, EXTRACTOR="claude",
             ANTHROPIC_API_KEY="fake", CLAUDE_EXTRACT_MODEL=None, CLAUDE_WRITER_MODEL=None), \
            tempfile.TemporaryDirectory() as tmp, patched(process, "OUT_ROOT", Path(tmp)), \
            patched(process, "load_dotenv", lambda *a, **k: None), patched(process.genai, "Client", NoGemini), \
            patched(claude.anthropic, "Anthropic", fake), patched(process, "make_poster", lambda *a: None), \
            patched(cover, "make_cover", broken), patched(shorten, "shorten_file", broken), \
            patched(align, "align_file", broken):
        out = Path(tmp) / "t-cover"
        (out / "work").mkdir(parents=True)
        (out / "work" / "manifest.json").write_text(json.dumps(manifest))
        video(out / "work" / "ai_01.mp4", 30)
        (out / "voice.m4a").write_bytes(b"m4a")
        (out / "work" / transcribe.FILE).write_text(json.dumps({"language": "en", "words": [
            {"word": "chop", "start": 3.0, "end": 3.4}, {"word": "onions", "start": 3.5, "end": 4.0}]}))
        process.run("t-cover")
        recipe = json.loads((out / "recipe.json").read_text())
        usage = json.loads((out / "work" / "usage.json").read_text())["calls"]
    assert [s["title"] for s in recipe["steps"]] == ["Chop the onions"], recipe
    assert [(c["kind"], c["model"]) for c in usage] == [("extract", "claude-sonnet-5-5"),
                                                        ("merge", "claude-sonnet-5-5")], usage
    extraction = fake.calls[0]["messages"][0]["content"]
    assert extraction[-1]["text"].endswith("Transcript of this clip:\n00:03 chop onions\n")
    assert fake.calls[1]["system"] == writer.CLAUDE_SYSTEM


def test_a_recording_tagged_english_but_found_marathi_is_extracted_as_marathi() -> None:
    """The language check's answer reaches the extraction: the manifest (and so the prompt and the recipe) say mr."""
    from pipeline import align, cover, shorten, transcribe
    from pipeline.test_coverage import MANIFEST, draft
    manifest = json.loads(json.dumps(MANIFEST))
    manifest["sessions"][0]["ai_files"] = [{"path": "work/ai_01.mp4", "start_in_file_s": 0, "duration_s": 30.0}]
    manifest.update(duration_s=30, language="en")
    step = "Temper the mustard seeds"
    fake = FakeAnthropic(chunk(("00:02", "00:20", step)), draft((2, 20, step)))

    def broken(*_a, **_k):
        raise RuntimeError("not in this test")

    with env(GEMINI_API_KEY="fake", GEMINI_MODEL="fake-pro", GEMINI_EXTRACT_MODEL="", GEMINI_MEDIA_RESOLUTION="LOW", CLAUDE_BATCH="0",
             COVERAGE_GAP_S="", RECIPE_WRITER="claude", TEXT_PROVIDER=None, EXTRACTOR="claude",
             TRANSCRIPT_PROOFREAD=None, ANTHROPIC_API_KEY="fake", CLAUDE_EXTRACT_MODEL=None, CLAUDE_WRITER_MODEL=None), \
            tempfile.TemporaryDirectory() as tmp, patched(process, "OUT_ROOT", Path(tmp)), \
            patched(process, "load_dotenv", lambda *a, **k: None), \
            patched(process.genai, "Client", lambda **_k: None), \
            patched(claude.anthropic, "Anthropic", fake), patched(process, "make_poster", lambda *a: None), \
            patched(cover, "make_cover", broken), patched(shorten, "shorten_file", broken), \
            patched(align, "align_file", broken):
        out = Path(tmp) / "t-cover"
        (out / "work").mkdir(parents=True)
        (out / "work" / "manifest.json").write_text(json.dumps(manifest))
        video(out / "work" / "ai_01.mp4", 30)
        (out / "voice.m4a").write_bytes(b"m4a")
        (out / "work" / transcribe.FILE).write_text(json.dumps({  # what the language check left: tagged en, found mr
            "language": "mr", "tagged_language": "en", "language_note": "tagged English, but 85% loops: Marathi",
            "words": [{"word": "मोहरी", "start": 3.0, "end": 3.4}, {"word": "टाकते", "start": 3.5, "end": 4.0}]}))
        process.run("t-cover")
        saved = json.loads((out / "work" / "manifest.json").read_text())
        recipe = json.loads((out / "recipe.json").read_text())
    assert saved["language"] == "mr" and recipe["language"] == "mr", (saved.get("language"), recipe.get("language"))
    prompt = fake.calls[0]["messages"][0]["content"][-1]["text"]
    assert "The family says the cook narrates in Marathi" in prompt and "00:03 मोहरी टाकते" in prompt


def test_a_stopped_job_drops_the_extractions_not_started_and_waits_for_the_running_one() -> None:
    class Stopped(Exception):
        pass

    def report(_stage, _progress):
        raise Stopped  # Convex's 409: the cook stopped it

    started, gate = [], threading.Event()

    def extract(i):
        started.append(i)
        if i == 1:
            gate.wait(10)  # running when the report raises, so 2 and 3 can only still be queued

    pool = ThreadPoolExecutor(max_workers=1)
    futures = [pool.submit(extract, i) for i in range(4)]
    try:
        process.report_extractions(pool, futures, 4, report)
        raise AssertionError("the report's exception should reach the caller")
    except Stopped:
        pass
    gate.set()
    pool.shutdown(wait=True)
    assert futures[2].cancelled() and futures[3].cancelled() and 2 not in started and 3 not in started, started


def test_stopped_while_being_heard_means_no_extraction_at_all() -> None:
    """The check right after the transcript: the cook stopped it, so no frames go to Claude."""
    from pipeline import transcribe
    from pipeline.test_coverage import MANIFEST

    class Stopped(Exception):
        pass

    seen = []

    def report(stage, progress):
        seen.append((stage, progress))
        if len(seen) == 2:
            raise Stopped

    manifest = json.loads(json.dumps(MANIFEST))
    manifest["sessions"][0]["ai_files"] = [{"path": "work/ai_01.mp4", "start_in_file_s": 0, "duration_s": 30.0}]
    fake = FakeAnthropic()
    with env(GEMINI_API_KEY="fake", GEMINI_MODEL="fake-pro", GEMINI_EXTRACT_MODEL="", GEMINI_MEDIA_RESOLUTION="LOW", CLAUDE_BATCH="0",
             COVERAGE_GAP_S="", RECIPE_WRITER="claude", TEXT_PROVIDER=None, EXTRACTOR="claude",
             ANTHROPIC_API_KEY="fake", CLAUDE_EXTRACT_MODEL=None, CLAUDE_WRITER_MODEL=None), \
            tempfile.TemporaryDirectory() as tmp, patched(process, "OUT_ROOT", Path(tmp)), \
            patched(process, "load_dotenv", lambda *a, **k: None), patched(process.genai, "Client", lambda **_k: None), \
            patched(claude.anthropic, "Anthropic", fake):
        out = Path(tmp) / "t-cover"
        (out / "work").mkdir(parents=True)
        (out / "work" / "manifest.json").write_text(json.dumps(manifest))
        video(out / "work" / "ai_01.mp4", 30)
        (out / "voice.m4a").write_bytes(b"m4a")
        (out / "work" / transcribe.FILE).write_text(json.dumps({"language": "en", "words": []}))
        try:
            process.run("t-cover", report=report)
            raise AssertionError("the report's exception should reach the caller")
        except Stopped:
            pass
    assert fake.calls == [], fake.calls


def test_extractor_flag_picks_claude_and_sonnet() -> None:
    assert process.extract_model({"extractor": "gemini"}) is None
    with env(ANTHROPIC_API_KEY="fake", CLAUDE_EXTRACT_MODEL=None, CLAUDE_BATCH=None):
        gen = process.extract_model({"extractor": "claude"})
        assert gen.model == "claude-sonnet-5-5" and gen.batch is True  # half price on the Batch API
    with env(ANTHROPIC_API_KEY="fake", RECIPE_WRITER="claude", CLAUDE_BATCH=None):
        assert writer.choose(None, "gemini-x").batch is True
    with env(EXTRACTOR="claude"):
        assert claude.provider("EXTRACTOR") == "claude"


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
