"""The cover photo: the cook's own plate photo, else a real frame of the finished dish, cropped to the dish.

python pipeline/cover.py --id ID [--out PATH]    # pick data/out/ID/poster.jpg again (or write PATH instead)

When an in-app recording ends, homie asks the cook to photograph her plate; the worker downloads that photo and
process.py's make_cover makes it the poster as it is (use_photo checks it is one real JPEG first). Without one,
process.py calls make_cover() below after the merge:
1. Gemini watches the end of play.mp4 (from the start of the second-to-last step, but at least MIN_WINDOW_S and at
   most MAX_WINDOW_S before the end, as a small 360p copy sent inline). It names the second where the finished,
   served dish looks best, and the second inside the last step where the finished dish shows best, if it does.
2. ffmpeg grabs a frame every half second from a second before to a second after each, and the sharpest (least
   blur by ffmpeg's blurdetect) wins.
3. The cover frame is cropped to the dish: ffmpeg's cropdetect trims black side bars, Gemini gives the dish's box
   in the frame, and crop_rect cuts a 4:5 picture around it, sized so the dish stays whole in every way the app
   center-crops a cover (SLOT_ASPECTS). A box that is missing, tiny or outside the picture: the whole frame.
4. The last step's second goes to process.py, which saves it for publish.py's step still (cook mode shows it
   before the step's video plays), so the last step shows the dish instead of whatever its middle second shows.
Crop only: never generated or edited, always her photo or a frame of her own video. When Gemini sees no finished
dish, make_cover returns None and leaves the poster alone; process.py then uses the middle of the last step,
as it does when anything here fails.

COVER_PROVIDER=claude (process.cover_model) asks Claude instead (CLAUDE_COVER_MODEL, default Sonnet). Claude takes no
video, so step 1 sends the same window as still frames, one every FRAME_EVERY_S seconds (more apart for a long
window, at most MAX_FRAMES), each labelled with its MM:SS, and Claude answers with a frame's time. Steps 2-4 are
the same; the dish box comes from the same prompt with the frame as an image.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from pipeline import claude  # noqa: E402
from pipeline.prep import OUT_ROOT, PrepError, ffmpeg, find_tool, make_poster, probe, run_cmd  # noqa: E402
from pipeline.process import (Usage, cover_model, describe_call, gemini_client, load_config, log,  # noqa: E402
                              response_text)
from pipeline.prompts import COVER_BOX_PROMPT, COVER_FRAMES_NOTE, COVER_PROMPT  # noqa: E402
from pipeline.schema import parse_timestamp  # noqa: E402
from pipeline.shorten import MemoryUsage  # noqa: E402

MIN_WINDOW_S, MAX_WINDOW_S = 60, 300
MIN_PHOTO_PX = 200  # a plate photo smaller than this on either side is a broken upload, not a cover
NEAR_S = (-1.0, -0.5, 0.0, 0.5, 1.0)  # Gemini answers in whole seconds: look around its second
# Claude's stills fit in FRAME_PX x FRAME_PX: ~300 image tokens each landscape or portrait (a 640 px wide portrait
# frame is ~950), so at most ~45k, under Haiku's 100k-token price step.
FRAME_EVERY_S, MAX_FRAMES, FRAME_PX = 2.0, 150, 640

ASPECT = 0.8  # the cropped cover's width : height (4:5)
# The app center-crops covers into slots from 0.78 wide (kid Home's deck card, its title over the bottom) to about
# 1.1 (the recipe page's hero on today's iPhones); square thumbnails sit in between. The dish stays whole in all of
# them, unless it sits at the frame's edge, where no crop can center it. Wider slots (my-recipe's ~1.35 hero) may
# trim its top and bottom: sizing for them would shrink the dish on the cards that matter most.
SLOT_ASPECTS = (0.78, 1.1)
DISH_PAD = 1.15  # room around the dish's box inside what every slot shows
MIN_DISH_SHARE = 0.02  # a dish box under 2% of the picture is a misread (or too small to crop to)
MIN_CROP_SHARE = 0.5  # never crop to less than half the picture's height: it gets too soft


class CoverError(RuntimeError):
    pass


class CoverAnswer(BaseModel):  # no defaults: the response_schema rejects them
    found: bool
    at: str  # MM:SS in the clip
    step_at: str  # MM:SS in the clip, inside the last step, where the finished dish shows best; "" if it doesn't


class DishBox(BaseModel):
    found: bool
    box_2d: list[int]  # [ymin, xmin, ymax, xmax], each 0-1000 of the image's height or width


@dataclass
class Pick:
    at: float  # the cover's second on play.mp4
    cropped: bool  # cut to the dish, else the whole frame
    still_at: float | None  # the last step's still: its second on play.mp4, when the finished dish shows there


Box = tuple[float, float, float, float]  # x1, y1, x2, y2 in pixels


# ---------- rules (pure, tested in test_cover.py) ----------

def window(steps: list[dict], duration: float) -> tuple[float, float]:
    """The part of play.mp4 Gemini watches: from the second-to-last step to the end, within the limits."""
    start = steps[-2]["start_s"] if len(steps) > 1 else steps[-1]["start_s"]
    start = min(max(start, duration - MAX_WINDOW_S), duration - MIN_WINDOW_S)
    return max(0.0, float(start)), float(duration)


def near(at: float, lo: float, hi: float) -> list[float]:
    """The frames to compare around Gemini's second, all in [lo, hi - 0.5]."""
    return sorted({round(min(max(at + d, lo), hi - 0.5), 2) for d in NEAR_S})


def mmss(s: float) -> str:
    return f"{int(s) // 60:02d}:{int(s) % 60:02d}"


def frame_every(length: float) -> float:
    """Seconds between Claude's stills: FRAME_EVERY_S, or more for a window that would need over MAX_FRAMES."""
    return max(FRAME_EVERY_S, float(-(-int(length) // MAX_FRAMES)))


def crop_rect(dish: Box, picture: Box) -> tuple[int, int, int, int] | None:
    """The 4:5 crop (x, y, w, h) around the dish, inside the picture (the frame without black bars), or None when
    the box can't be the dish. Every slot in SLOT_ASPECTS keeps the crop's middle strip of
    min(ASPECT, narrowest) x height by min(1, ASPECT / widest) x height; the dish plus DISH_PAD must fit it."""
    px1, py1, px2, py2 = picture
    x1, y1, x2, y2 = max(dish[0], px1), max(dish[1], py1), min(dish[2], px2), min(dish[3], py2)
    pw, ph, dw, dh = px2 - px1, py2 - py1, x2 - x1, y2 - y1
    if dw <= 0 or dh <= 0 or dw * dh < MIN_DISH_SHARE * pw * ph:
        return None
    narrow, wide = SLOT_ASPECTS
    h = max(dw * DISH_PAD / min(ASPECT, narrow), dh * DISH_PAD / min(1.0, ASPECT / wide), MIN_CROP_SHARE * ph)
    h = min(h, ph, pw / ASPECT)
    w = ASPECT * h
    x = min(max((x1 + x2) / 2 - w / 2, px1), px2 - w)
    y = min(max((y1 + y2) / 2 - h / 2, py1), py2 - h)
    even = lambda v: int(v) // 2 * 2  # noqa: E731 - JPEG chroma likes even sizes
    return even(x), even(y), even(w), even(h)


# ---------- ffmpeg ----------

def cut_clip(play: Path, start: float, end: float, dest: Path) -> bytes:
    ffmpeg("-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(play), "-an", "-vf", "scale=-2:360,fps=5",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-movflags", "+faststart", str(dest))
    return dest.read_bytes()


def grab_frames(play: Path, start: float, end: float, tmp: Path) -> list[tuple[str, bytes]]:
    """The window as Claude's stills: (its "MM:SS" label in the clip, JPEG), one every frame_every seconds."""
    every = frame_every(end - start)
    (tmp / "frames").mkdir()
    ffmpeg("-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(play), "-an",
           "-vf", f"fps=1/{every:g},scale={FRAME_PX}:{FRAME_PX}:force_original_aspect_ratio=decrease",
           "-q:v", "4", str(tmp / "frames" / "%04d.jpg"))
    files = sorted((tmp / "frames").glob("*.jpg"))
    return [(mmss(i * every), f.read_bytes()) for i, f in enumerate(files)]


def _frame_metadata(frame: Path, vf: str) -> str:
    return run_cmd([find_tool("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-i", str(frame),
                    "-vf", f"{vf},metadata=mode=print:file=-", "-f", "null", "-"])


def blur(frame: Path) -> float:
    """ffmpeg's blurdetect score for one image: lower is sharper."""
    m = re.search(r"lavfi\.blur=([\d.]+)", _frame_metadata(frame, "blurdetect"))
    if not m:
        raise PrepError(f"blurdetect gave no score for {frame.name}")
    return float(m.group(1))


def picture_box(frame: Path, width: int, height: int) -> Box:
    """The frame without its black bars (glasses footage is 4:3 inside 16:9), by ffmpeg's cropdetect. The whole
    frame when it finds less than half of either side (a dark frame, not bars)."""
    out = _frame_metadata(frame, "cropdetect=limit=24:round=2:skip=0")
    edge = {k: int(v) for k, v in re.findall(r"lavfi\.cropdetect\.(x1|y1|x2|y2)=(\d+)", out)}
    if len(edge) == 4 and edge["x2"] - edge["x1"] >= width / 2 and edge["y2"] - edge["y1"] >= height / 2:
        return edge["x1"], edge["y1"], edge["x2"] + 1, edge["y2"] + 1
    return 0, 0, width, height


def sharpest(play: Path, times: list[float], tmp: Path) -> tuple[float, dict[float, float]]:
    scores = {}
    for t in times:
        make_poster(play, t, tmp / f"{t:.2f}.jpg")
        scores[t] = blur(tmp / f"{t:.2f}.jpg")
    return min(scores, key=scores.get), scores


def grab_crop(play: Path, at_s: float, rect: tuple[int, int, int, int], dest: Path) -> None:
    x, y, w, h = rect
    part = dest.with_name(f"{dest.stem}.part{dest.suffix}")
    ffmpeg("-ss", f"{at_s:.2f}", "-i", str(play), "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}", "-q:v", "2",
           "-update", "1", str(part))
    part.replace(dest)


def use_photo(photo: Path, dest: Path) -> None:
    """The cook's plate photo becomes dest unchanged (no filters, no crop) once ffprobe reads it as one JPEG
    image of a usable size. Raises otherwise; the caller then picks a frame from the video."""
    with photo.open("rb") as f:
        if f.read(3) != b"\xff\xd8\xff":  # ffprobe alone goes by the .jpg name for some files
            raise CoverError("not a JPEG file")
    streams = probe(photo).get("streams", [])
    if len(streams) != 1 or streams[0].get("codec_name") != "mjpeg":
        raise CoverError(f"not one JPEG image: {[x.get('codec_name') for x in streams]}")
    w, h = streams[0].get("width") or 0, streams[0].get("height") or 0
    if min(w, h) < MIN_PHOTO_PX:
        raise CoverError(f"only {w}x{h} px")
    part = dest.with_name(f"{dest.stem}.part{dest.suffix}")
    shutil.copyfile(photo, part)
    part.replace(dest)
    log(f"[cover] {dest.name} is the cook's plate photo ({w}x{h})")


# ---------- the model calls ----------

Clip = bytes | list[tuple[str, bytes]]  # Gemini: an MP4 or a JPEG; Claude: labelled JPEG stills


def generate(client: genai.Client | claude.ClaudeText, model: str, prompt: str, schema: type[BaseModel], clip: Clip,
             mime: str):
    """One structured call about `clip`: Gemini watches it (`mime`); Claude sees the stills, or the one image."""
    if isinstance(client, claude.ClaudeText):
        return client.generate(prompt, schema, images=clip if isinstance(clip, list) else [("The frame:", clip)])
    return client.models.generate_content(
        model=model, contents=[types.Part.from_bytes(data=clip, mime_type=mime), prompt],
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema,
                                           temperature=0.1))


def ask(client: genai.Client | claude.ClaudeText, model: str, title: str, clip: Clip, length: float,
        step: tuple[float, float] | None, usage: Usage) -> tuple[int | None, int | None]:
    """(the cover's second in the clip, the last step's still's second in the clip). The cover is None when the
    model sees no finished dish; the still is None when the dish doesn't show inside `step` (the last step's span in
    the clip; None = not in the clip). `clip` is the video, or Claude's stills. Raises CoverError after two
    failures."""
    span = f"from {mmss(step[0])} to {mmss(step[1])} in this clip" if step else "not in this clip"
    prompt = COVER_PROMPT.format(title=json.dumps(title), clip_mmss=mmss(length), step_span=span)
    if isinstance(clip, list):
        prompt = COVER_FRAMES_NOTE.format(n=len(clip), every=f"{frame_every(length):g}") + prompt
    error = ""
    for attempt in (1, 2):
        resp, t0 = None, time.monotonic()
        try:
            resp = generate(client, model, prompt, CoverAnswer, clip, "video/mp4")
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
        still = None
        if answer.found and step and answer.step_at.strip():
            try:  # the still is a bonus: a bad one is dropped, not retried
                still = parse_timestamp(answer.step_at)
            except ValueError:
                pass
            if still is not None and not step[0] - 1 <= still <= step[1] + 1:
                still = None
        log(f"[cover] {model}: {f'finished dish at {answer.at}' if at is not None else 'no finished dish seen'}"
            f"{f', last step shows it at {mmss(still)}' if still is not None else ''} in a {mmss(length)} clip, "
            f"{describe_call(call)}")
        return at, still
    raise CoverError(f"{model} gave no usable answer: {error[:300]}")


def find_dish(client: genai.Client | claude.ClaudeText, model: str, title: str, frame: bytes,
              usage: Usage) -> tuple[float, ...] | None:
    """The finished dish's box in the frame as (x1, y1, x2, y2) shares 0-1, or None when the model sees none or
    answers badly twice (the cover is then the whole frame)."""
    for attempt in (1, 2):
        resp, t0 = None, time.monotonic()
        try:
            resp = generate(client, model, COVER_BOX_PROMPT.format(title=json.dumps(title)), DishBox, frame,
                            "image/jpeg")
            answer = DishBox.model_validate_json(response_text(resp))
            if answer.found:
                ymin, xmin, ymax, xmax = answer.box_2d  # ValueError unless exactly four
                if not (0 <= xmin < xmax <= 1000 and 0 <= ymin < ymax <= 1000):
                    raise ValueError(f"box {answer.box_2d} is not [ymin, xmin, ymax, xmax] in 0-1000")
        except Exception as e:  # noqa: BLE001
            call = usage.add("cover-box", model, None, attempt, time.monotonic() - t0, resp,
                             f"{type(e).__name__}: {e}"[:2000])
            log(f"[cover] dish box attempt {attempt} failed ({describe_call(call)}): {type(e).__name__}: {e}"[:400])
            continue
        call = usage.add("cover-box", model, None, attempt, time.monotonic() - t0, resp)
        log(f"[cover] dish box {answer.box_2d if answer.found else 'not found'}, {describe_call(call)}")
        return (xmin / 1000, ymin / 1000, xmax / 1000, ymax / 1000) if answer.found else None
    return None


def make_cover(client: genai.Client | claude.ClaudeText, model: str, recipe: dict, play: Path, dest: Path,
               usage: Usage) -> Pick | None:
    """Writes dest from the sharpest frame around the moment the model picks, cropped to the dish when it can be.
    Returns what it picked, or None (dest untouched) when the model saw no finished dish. Raises on errors."""
    duration = recipe["media"]["duration_s"]
    start, end = window(recipe["steps"], duration)
    last = recipe["steps"][-1]
    step = (max(last["start_s"], start) - start, last["end_s"] - start) if last["end_s"] > start else None
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        clip = (grab_frames(play, start, end, tmp) if isinstance(client, claude.ClaudeText)
                else cut_clip(play, start, end, tmp / "end.mp4"))
        at, step_at = ask(client, model, recipe["title"], clip, end - start, step, usage)
        if at is None:
            return None
        best, scores = sharpest(play, near(start + at, 0.0, duration), tmp)
        log(f"[cover] frame at {best:.1f} s, the sharpest of "
            + ", ".join(f"{t:.1f} s ({b:.2f})" for t, b in sorted(scores.items())))
        still_at = None
        if step_at is not None:
            (tmp / "still").mkdir()
            still_at, _ = sharpest(play, near(start + step_at, last["start_s"], last["end_s"]), tmp / "still")
            log(f"[cover] last step {last['order']}'s still at {still_at:.1f} s")
        frame = tmp / f"{best:.2f}.jpg"
        rect = None
        try:
            stream = probe(frame)["streams"][0]
            w, h = stream["width"], stream["height"]
            share = find_dish(client, model, recipe["title"], frame.read_bytes(), usage)
            if share:
                rect = crop_rect((share[0] * w, share[1] * h, share[2] * w, share[3] * h), picture_box(frame, w, h))
                if rect is None:
                    log("[cover] the dish box can't be cropped to (tiny or outside the picture); whole frame")
        except Exception as e:  # noqa: BLE001 - the crop is a bonus: the whole frame still works
            log(f"[cover] WARNING: no crop ({type(e).__name__}: {str(e)[:300]}); whole frame")
    if rect:
        grab_crop(play, best, rect, dest)
        log(f"[cover] {dest.name}: {rect[2]}x{rect[3]} at ({rect[0]}, {rect[1]}) of the frame at {best:.1f} s")
    else:
        make_poster(play, best, dest)
    return Pick(at=best, cropped=rect is not None, still_at=still_at)


def main() -> None:
    ap = argparse.ArgumentParser(description="Pick a recipe's cover: the best real frame of the finished dish.")
    ap.add_argument("--id", required=True, help="recipe id: data/out/ID/recipe.json and play.mp4")
    ap.add_argument("--out", type=Path, help="write here instead of data/out/ID/poster.jpg")
    args = ap.parse_args()
    folder = OUT_ROOT / args.id
    cfg = load_config()
    client, model = cover_model(cfg, gemini_client())
    usage = Usage(folder / "work" / "usage.json") if (folder / "work").is_dir() else MemoryUsage()
    recipe = json.loads((folder / "recipe.json").read_text())
    pick = make_cover(client, model, recipe, folder / "play.mp4", args.out or folder / "poster.jpg", usage)
    if pick is None:
        sys.exit(f"cover: {model} saw no finished dish; the poster is unchanged")
    print(json.dumps(pick.__dict__))


if __name__ == "__main__":
    main()
