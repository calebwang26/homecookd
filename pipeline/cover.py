"""The cover photo: a real frame of the finished dish, where it looks best.

python pipeline/cover.py --id ID [--out PATH]    # pick data/out/ID/poster.jpg again (or write PATH instead)

process.py calls make_cover() after the merge. Gemini watches the end of play.mp4 (from the start of the
second-to-last step, but at least MIN_WINDOW_S and at most MAX_WINDOW_S before the end, as a small 360p copy
sent inline) and names the second where the finished, served dish looks best. ffmpeg grabs a frame every half
second from a second before to a second after it, and the sharpest (least blur by ffmpeg's blurdetect) becomes
the poster. Never generated or edited: always a frame of the cook's own video. When Gemini sees no finished
dish, make_cover returns None and leaves the poster alone; process.py then uses the middle of the last step,
as it does when anything here fails.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from pipeline.prep import OUT_ROOT, PrepError, ffmpeg, find_tool, make_poster, run_cmd  # noqa: E402
from pipeline.process import (HTTP_RETRY, REQUEST_TIMEOUT_MS, Usage, describe_call, load_config, log,  # noqa: E402
                              response_text)
from pipeline.prompts import COVER_PROMPT  # noqa: E402
from pipeline.schema import parse_timestamp  # noqa: E402
from pipeline.shorten import MemoryUsage  # noqa: E402

MIN_WINDOW_S, MAX_WINDOW_S = 60, 300
NEAR_S = (-1.0, -0.5, 0.0, 0.5, 1.0)  # Gemini answers in whole seconds: look around its second


class CoverError(RuntimeError):
    pass


class CoverAnswer(BaseModel):  # no defaults: the response_schema rejects them
    found: bool
    at: str  # MM:SS in the clip


# ---------- rules (pure, tested in test_cover.py) ----------

def window(steps: list[dict], duration: float) -> tuple[float, float]:
    """The part of play.mp4 Gemini watches: from the second-to-last step to the end, within the limits."""
    start = steps[-2]["start_s"] if len(steps) > 1 else steps[-1]["start_s"]
    start = min(max(start, duration - MAX_WINDOW_S), duration - MIN_WINDOW_S)
    return max(0.0, float(start)), float(duration)


def near(at: float, duration: float) -> list[float]:
    """The frames to compare around Gemini's second, all inside the video."""
    return sorted({round(min(max(at + d, 0.0), duration - 0.5), 2) for d in NEAR_S})


def mmss(s: float) -> str:
    return f"{int(s) // 60:02d}:{int(s) % 60:02d}"


# ---------- ffmpeg ----------

def cut_clip(play: Path, start: float, end: float, dest: Path) -> bytes:
    ffmpeg("-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(play), "-an", "-vf", "scale=-2:360,fps=5",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-movflags", "+faststart", str(dest))
    return dest.read_bytes()


def blur(frame: Path) -> float:
    """ffmpeg's blurdetect score for one image: lower is sharper."""
    out = run_cmd([find_tool("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-i", str(frame),
                   "-vf", "blurdetect,metadata=mode=print:file=-", "-f", "null", "-"])
    m = re.search(r"lavfi\.blur=([\d.]+)", out)
    if not m:
        raise PrepError(f"blurdetect gave no score for {frame.name}")
    return float(m.group(1))


# ---------- the Gemini call ----------

def ask(client: genai.Client, model: str, title: str, video: bytes, length: float, usage: Usage) -> int | None:
    """Gemini's second in the clip, or None when it sees no finished dish. Raises CoverError after two failures."""
    prompt = COVER_PROMPT.format(title=json.dumps(title), clip_mmss=mmss(length))
    error = ""
    for attempt in (1, 2):
        resp, t0 = None, time.monotonic()
        try:
            resp = client.models.generate_content(
                model=model, contents=[types.Part.from_bytes(data=video, mime_type="video/mp4"), prompt],
                config=types.GenerateContentConfig(response_mime_type="application/json",
                                                   response_schema=CoverAnswer, temperature=0.1))
            answer = CoverAnswer.model_validate_json(response_text(resp))
            at = parse_timestamp(answer.at) if answer.found else None
            if at is not None and at > length:
                raise ValueError(f"{answer.at} is past the clip's end {mmss(length)}")
        except Exception as e:  # noqa: BLE001 - API errors, bad JSON, bad times: one retry, then the caller falls back
            error = f"{type(e).__name__}: {e}"[:2000]
            call = usage.add("cover", model, None, attempt, time.monotonic() - t0, resp, error)
            log(f"[cover] attempt {attempt} failed ({describe_call(call)}): {error[:300]}")
            continue
        call = usage.add("cover", model, None, attempt, time.monotonic() - t0, resp)
        log(f"[cover] {model}: {f'finished dish at {answer.at}' if at is not None else 'no finished dish seen'} "
            f"in a {mmss(length)} clip, {describe_call(call)}")
        return at
    raise CoverError(f"{model} gave no usable answer: {error[:300]}")


def make_cover(client: genai.Client, model: str, recipe: dict, play: Path, dest: Path, usage: Usage) -> float | None:
    """Writes dest from the sharpest frame around the moment Gemini picks. Returns that second on play.mp4, or
    None (dest untouched) when Gemini saw no finished dish. Raises on errors."""
    duration = recipe["media"]["duration_s"]
    start, end = window(recipe["steps"], duration)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        at = ask(client, model, recipe["title"], cut_clip(play, start, end, tmp / "end.mp4"), end - start, usage)
        if at is None:
            return None
        scores = {}
        for t in near(start + at, duration):
            make_poster(play, t, tmp / f"{t:.2f}.jpg")
            scores[t] = blur(tmp / f"{t:.2f}.jpg")
    best = min(scores, key=scores.get)
    make_poster(play, best, dest)
    log(f"[cover] {dest.name} from {best:.1f} s, the sharpest of "
        + ", ".join(f"{t:.1f} s ({b:.2f})" for t, b in sorted(scores.items())))
    return best


def main() -> None:
    ap = argparse.ArgumentParser(description="Pick a recipe's cover: the best real frame of the finished dish.")
    ap.add_argument("--id", required=True, help="recipe id: data/out/ID/recipe.json and play.mp4")
    ap.add_argument("--out", type=Path, help="write here instead of data/out/ID/poster.jpg")
    args = ap.parse_args()
    folder = OUT_ROOT / args.id
    cfg = load_config()
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                          http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS, retry_options=HTTP_RETRY))
    usage = Usage(folder / "work" / "usage.json") if (folder / "work").is_dir() else MemoryUsage()
    recipe = json.loads((folder / "recipe.json").read_text())
    at = make_cover(client, cfg["extract_model"], recipe, folder / "play.mp4", args.out or folder / "poster.jpg", usage)
    if at is None:
        sys.exit("cover: Gemini saw no finished dish; the poster is unchanged")


if __name__ == "__main__":
    main()
