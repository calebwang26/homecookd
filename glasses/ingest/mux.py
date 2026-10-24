"""Turn a recording folder (store.py) into out.mp4: the frames at their real times, as constant 15 fps
H.264, plus the PCM as AAC, cut to the same length. pipeline/prep.py needs both a video and an audio stream,
so a recording without sound gets silence."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from store import BYTES_PER_S

FPS = 15
PRESET = "ultrafast"  # an e2-micro has a quarter of a core; faster presets keep the wait after "I'm done" short


async def _run(*cmd: str) -> bytes:
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    if proc.returncode:
        raise RuntimeError(f"{cmd[0]} failed: {err.decode(errors='replace')[-600:]}")
    return out


async def _size(jpeg: Path) -> tuple[int, int]:
    out = await _run("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                     "-of", "json", str(jpeg))
    s = json.loads(out)["streams"][0]
    return s["width"] // 2 * 2, s["height"] // 2 * 2


def _write_concat(folder: Path, frames: list[tuple[int, str]]) -> float:
    """An ffconcat list where each frame lasts until the next one. Returns the total seconds."""
    gaps = [b[0] - a[0] for a, b in zip(frames, frames[1:])]
    typical = sorted(gaps)[len(gaps) // 2] if gaps else 125
    lines = ["ffconcat version 1.0"]
    total = 0.0
    for i, (_, name) in enumerate(frames):
        d = max(gaps[i] if i < len(gaps) else typical, 1) / 1000
        total += d
        lines += [f"file '{name}'", f"duration {d:.3f}"]
    lines.append(f"file '{frames[-1][1]}'")  # the concat demuxer ignores the last duration unless it's repeated
    (folder / "list.ffconcat").write_text("\n".join(lines) + "\n")
    return total


def _write_aligned_audio(folder: Path, video_start: int, audio_start: int | None, total_s: float) -> None:
    """audio.pcm moved onto the video's clock and cut or padded to exactly total_s."""
    want = int(total_s * BYTES_PER_S) // 2 * 2
    skip = 0
    with (folder / "aligned.pcm").open("wb") as out:
        if audio_start is not None:
            shift = (audio_start - video_start) * BYTES_PER_S // 1000 // 2 * 2
            if shift > 0:
                out.write(bytes(min(shift, want)))
            else:
                skip = -shift
            src = folder / "audio.pcm"
            with src.open("rb") as f:
                f.seek(skip)
                while out.tell() < want:
                    chunk = f.read(min(1 << 20, want - out.tell()))
                    if not chunk:
                        break
                    out.write(chunk)
        if out.tell() < want:
            out.write(bytes(want - out.tell()))


async def mux(folder: Path, meta: dict) -> tuple[Path, int, float]:
    """Returns (mp4, videoStartedAt ms, duration s)."""
    lines = (folder / "frames.txt").read_text().splitlines() if (folder / "frames.txt").exists() else []
    frames = [(int(ms), name) for ms, name in (line.split() for line in lines)]
    if not frames:
        raise RuntimeError("no frames were recorded")
    video_start = frames[0][0]
    total = _write_concat(folder, frames)
    _write_aligned_audio(folder, video_start, meta.get("audioStartedAt"), total)
    w, h = await _size(folder / frames[0][1])
    tmp, mp4 = folder / "out.tmp.mp4", folder / "out.mp4"
    await _run(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(folder / "list.ffconcat"),
        "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", str(folder / "aligned.pcm"),
        "-map", "0:v", "-map", "1:a",
        "-vf", f"scale={w}:{h},fps={FPS},format=yuv420p",
        "-c:v", "libx264", "-preset", PRESET, "-crf", "26",
        "-c:a", "aac", "-b:a", "64k",
        "-t", f"{total:.3f}", "-movflags", "+faststart", str(tmp),
    )
    tmp.replace(mp4)
    (folder / "aligned.pcm").unlink(missing_ok=True)
    return mp4, video_start, round(total, 3)
