"""EXTRACTOR=claude: the video extraction on Claude and Cartesia instead of Gemini watching each AI file.

Claude takes no video or audio, so each AI file (process.Extraction) goes as:
- its frames: the AI copy's one frame per second, every `every` seconds so one call holds them (SEEN_IMAGES images,
  SEEN_TOKENS image tokens), each after its MM:SS label;
- what the cook says: Cartesia's word-timed transcript of voice.m4a (pipeline/transcribe.py, made once per recording
  in the job's language), cut to the file's span and timed from its start.
Claude (CLAUDE_EXTRACT_MODEL, default Sonnet) gets the unchanged EXTRACT_PROMPT after EXTRACT_FRAMES_NOTE, and answers
with the same TimedChunkOutput Gemini does: Extraction.accept validates, retries, caches and offsets it exactly as
on the Gemini path, so the merge and everything after it don't change.

Compared live (Oct 26): a Haiku text log of every frame lost what Sonnet sees in the frames themselves (it read
apple roses as "yellow sheets" and missed Poha's salt and coconut), so the extraction looks at the frames.
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path

from pipeline import claude
from pipeline.prep import ffmpeg
from pipeline.process import Extraction
from pipeline.prompts import EXTRACT_FRAMES_NOTE, EXTRACT_HEARD
from pipeline.schema import TimedChunkOutput

FRAME_PX = 640  # bigger sources are scaled to fit in FRAME_PX x FRAME_PX (~300 tokens; a 202x360 AI frame is 104)
SEEN_IMAGES, SEEN_TOKENS = 550, 90_000  # per call: under the API's 600 images, and room for the prompt


def mmss(s: float) -> str:
    return f"{int(s) // 60:02d}:{int(s) % 60:02d}"


def image_tokens(jpeg: bytes) -> int:
    """Claude's image token count for a JPEG: (width/28) x (height/28) rounded up, from its SOF header."""
    i = 2
    while i < len(jpeg) - 9:
        marker, size = jpeg[i + 1], int.from_bytes(jpeg[i + 2:i + 4], "big")
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = int.from_bytes(jpeg[i + 5:i + 7], "big"), int.from_bytes(jpeg[i + 7:i + 9], "big")
            return -(-w // 28) * -(-h // 28)
        i += 2 + size
    return 1600  # unknown: count it as a large image


def frames(path: Path) -> tuple[list[tuple[str, bytes]], int]:
    """The clip's frames as ("MM:SS", JPEG), one every `every` seconds so they fit one call. Returns (frames, every)."""
    with tempfile.TemporaryDirectory() as tmp:
        ffmpeg("-i", str(path), "-an", "-vf",
               f"fps=1,scale='min({FRAME_PX},iw)':'min({FRAME_PX},ih)':force_original_aspect_ratio=decrease",
               "-q:v", "5", str(Path(tmp) / "%05d.jpg"))
        all_frames = [(mmss(i), f.read_bytes()) for i, f in enumerate(sorted(Path(tmp).glob("*.jpg")))]
    per = image_tokens(all_frames[0][1]) if all_frames else 0
    every = max(1, -(-len(all_frames) // SEEN_IMAGES), -(-len(all_frames) * per // SEEN_TOKENS))
    return all_frames[::every], every


def heard(lines: list[dict], base_s: float, clip_len: float) -> str:
    """The transcript lines that start inside the clip, as "MM:SS text" from its start."""
    own = [x for x in lines if base_s <= x["start"] < base_s + clip_len]
    return "\n".join(f"{mmss(x['start'] - base_s)} {x['text']}" for x in own) or "(nothing said)"


def extract(job: Extraction, gen: claude.ClaudeText, transcript_lines: list[dict]) -> dict | None:
    """Two attempts at one AI file through job.accept, as extract_sync does on Gemini. None = not processed."""
    try:
        seen, every = frames(job.path)
    except Exception as e:  # noqa: BLE001
        job.error = f"{type(e).__name__}: {e}"
        return None
    note = EXTRACT_FRAMES_NOTE.format(n=len(seen), every=every)
    tail = EXTRACT_HEARD.format(transcript=heard(transcript_lines, job.base_s, job.clip_len))
    job.model = gen.model
    for attempt in (1, 2):
        resp, exc, t0 = None, None, time.monotonic()
        try:
            resp = gen.generate(note + job.prompt + tail, TimedChunkOutput, images=seen)
        except Exception as e:  # noqa: BLE001 - handled (and retried) like an invalid answer
            exc = e
        result = job.accept(attempt, "extract", time.monotonic() - t0, resp, exc)
        if result is not None:
            return result
    return None


def extract_one(job: Extraction, gen: claude.ClaudeText, transcript_lines: list[dict], force: bool) -> dict:
    """process.extract_one on Claude: the cache first, then extract(). Never raises."""
    result = job.skip() or job.cached(force)
    if result is not None:
        return result
    return extract(job, gen, transcript_lines) or job.not_processed()
