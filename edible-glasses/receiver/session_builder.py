"""Turn raw glasses packets into the Edible session folder.

Session folder layout (the data contract in the spec):
    session.json            sidecar metadata
    full.mp4                whole session, constant frame rate, H.264 + AAC mono, t=0 = session start
    chunks/chunk_NN.mp4     15-min cuts with 30 s overlap, built straight from packets (exact cuts)
    chunks/chunk_NN.json    per-chunk sidecar (what Gemini sees in the prompt)
    markers.json            button presses: session seconds + chunk-relative MM:SS
    gaps.json               spans filled with a held frame and silence because data was lost

Usage:
    python session_builder.py sessions/<session_id> [--sd /Volumes/SD/EDG/<session_id>.bin]
"""
from __future__ import annotations

import argparse
import bisect
import json
import math
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from edg_protocol import EVENT, HELLO, JPEG, MODES, NO_SEQ, PCM, SAMPLE_RATE, Packet, read_packet_file

CHUNK_SECONDS = int(os.environ.get("EDIBLE_CHUNK_SECONDS", 900))    # 15 minutes
OVERLAP_SECONDS = int(os.environ.get("EDIBLE_OVERLAP_SECONDS", 30))
DEFAULT_FPS = 2          # file frame rate; Gemini samples 1 fps anyway
VIDEO_W, VIDEO_H = 1280, 720


def mmss(seconds: float) -> str:
    s = max(0, int(round(seconds)))
    return f"{s // 60:02d}:{s % 60:02d}"


def chunk_ranges(duration: float, chunk_s: int = CHUNK_SECONDS, overlap_s: int = OVERLAP_SECONDS):
    """Chunk k covers [k*L - O, (k+1)*L), clamped to the session."""
    ranges = []
    k = 0
    while k * chunk_s < duration or k == 0:
        start = max(0.0, k * chunk_s - (overlap_s if k else 0))
        end = min(duration, (k + 1) * chunk_s)
        if end - start > 0.5:
            ranges.append((k, start, end))
        k += 1
    return ranges


@dataclass
class Session:
    session_id: str
    hello: dict
    frames: list[Packet]          # sorted by t_ms
    audio: list[Packet]           # sorted by t_ms
    events: list[Packet]          # sorted by t_ms
    duration: float
    gaps: list[dict] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    @property
    def markers(self) -> list[float]:
        return [p.t for p in self.events if p.json().get("event") == "marker"]

    def mode_changes(self) -> list[dict]:
        out = []
        for p in self.events:
            ev = p.json()
            if ev.get("event") in ("start", "mode"):
                out.append({"t": p.t, "mode": ev.get("mode")})
        return out


def load_session(raw_files: list[Path]) -> Session:
    """Merge live TCP captures and the SD-card copy, dedupe by seq, find real gaps."""
    by_seq: dict[int, Packet] = {}
    hello: dict = {}
    for path in raw_files:
        for p in read_packet_file(path):
            if p.type == HELLO:
                hello = hello or p.json()
            elif p.seq != NO_SEQ:
                by_seq.setdefault(p.seq, p)
    if not by_seq:
        raise SystemExit("No packets found. Is this the right session folder?")

    packets = sorted(by_seq.values(), key=lambda p: (p.t_ms, p.seq))
    frames = [p for p in packets if p.type == JPEG]
    audio = [p for p in packets if p.type == PCM]
    events = [p for p in packets if p.type == EVENT]

    stop = [p.t for p in events if p.json().get("event") == "stop"]
    last_audio_end = max((p.t + len(p.payload) / 2 / SAMPLE_RATE for p in audio), default=0.0)
    duration = stop[-1] if stop else max(packets[-1].t, last_audio_end)

    # Lost data = missing seq numbers. Each missing run becomes a gap between
    # the packets on either side of it.
    seqs = sorted(by_seq)
    gaps = []
    for a, b in zip(seqs, seqs[1:]):
        if b - a > 1:
            t0, t1 = by_seq[a].t, by_seq[b].t
            if t1 - t0 >= 1.0:
                gaps.append({"start_s": round(t0, 2), "end_s": round(t1, 2),
                             "missing_packets": b - a - 1})
    gaps = _merge_spans(gaps)

    session_id = hello.get("session_id") or Path(raw_files[0]).parent.parent.name
    return Session(
        session_id=session_id, hello=hello, frames=frames, audio=audio, events=events,
        duration=round(duration, 3), gaps=gaps,
        stats={"packets": len(packets), "frames": len(frames), "audio_blocks": len(audio),
               "events": len(events), "missing_packets": sum(g["missing_packets"] for g in gaps)},
    )


def _merge_spans(spans: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in sorted(spans, key=lambda s: s["start_s"]):
        if out and s["start_s"] <= out[-1]["end_s"] + 0.5:
            out[-1]["end_s"] = max(out[-1]["end_s"], s["end_s"])
            out[-1]["missing_packets"] += s["missing_packets"]
        else:
            out.append(dict(s))
    return out


def _audio_track(session: Session, start: float, end: float) -> bytes:
    """16 kHz mono s16le for [start, end); silence wherever nothing was sent."""
    n = int(round((end - start) * SAMPLE_RATE))
    track = np.zeros(n, dtype=np.int16)
    for p in session.audio:
        block = np.frombuffer(p.payload, dtype="<i2")
        offset = int(round((p.t - start) * SAMPLE_RATE))
        a, b = max(0, offset), min(n, offset + len(block))
        if a < b:
            track[a:b] = block[a - offset:b - offset]
    return track.tobytes()


def build_mp4(session: Session, start: float, end: float, out_path: Path, fps: int = DEFAULT_FPS) -> None:
    """Constant-frame-rate MP4 for [start, end): each output frame is the
    latest captured frame at that moment (held through gaps), so file time
    always equals session time minus `start`."""
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg not found. Install it (macOS: brew install ffmpeg).")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    duration = end - start
    n_out = max(1, int(math.ceil(duration * fps)))
    times = [f.t for f in session.frames]

    audio_path = out_path.with_suffix(".pcm.tmp")
    audio_path.write_bytes(_audio_track(session, start, end))

    vf = (f"scale={VIDEO_W}:{VIDEO_H}:force_original_aspect_ratio=decrease,"
          f"pad={VIDEO_W}:{VIDEO_H}:(ow-iw)/2:(oh-ih)/2,setsar=1")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
           "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", str(audio_path),
           "-vf", vf, "-r", str(fps),
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "48k", "-ac", "1",
           "-t", f"{duration:.3f}", "-movflags", "+faststart", str(out_path)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    black = _black_jpeg()
    try:
        for i in range(n_out):
            t = start + i / fps
            k = bisect.bisect_right(times, t) - 1
            if k < 0:
                k = 0 if times and times[0] - t < 2.0 else -1  # brief lead-in: use the first frame
            proc.stdin.write(session.frames[k].payload if k >= 0 else black)
        proc.stdin.close()
    except BrokenPipeError:
        pass
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed building {out_path}")
    audio_path.unlink(missing_ok=True)


_BLACK: bytes | None = None


def _black_jpeg() -> bytes:
    global _BLACK
    if _BLACK is None:
        from io import BytesIO
        from PIL import Image
        buf = BytesIO()
        Image.new("RGB", (VIDEO_W, VIDEO_H)).save(buf, "JPEG", quality=50)
        _BLACK = buf.getvalue()
    return _BLACK


def sidecar(session: Session, meta: dict, fps: int, chunk: tuple | None = None) -> dict:
    """The metadata Gemini gets after the video, and the app gets with the recipe."""
    modes = session.mode_changes()
    d = {
        "session_id": session.session_id,
        "cook_name": meta.get("cook_name", ""),
        "relationship": meta.get("relationship", ""),
        "spoken_languages": meta.get("spoken_languages", []),
        "dish_name": meta.get("dish_name", ""),
        "started_at": meta.get("started_at", ""),
        "capture_mode": modes[0]["mode"] if modes else session.hello.get("mode", "ai"),
        "mode_changes": [{"at": mmss(m["t"]), "mode": m["mode"]} for m in modes],
        "fps": fps,
        "camera": session.hello.get("sensor", ""),
        "duration_s": session.duration,
        "consent_recorded_at": meta.get("consent_recorded_at", "00:00"),
        "license_opt_in": bool(meta.get("license_opt_in", False)),
    }
    if chunk is None:
        d["markers"] = [{"session_s": round(t, 2), "at": mmss(t)} for t in session.markers]
        d["gaps"] = session.gaps
    else:
        k, start, end = chunk
        d.update({
            "chunk_index": k,
            "chunk_start_s": round(start, 3),
            "chunk_duration_s": round(end - start, 3),
            "overlap_with_previous_s": round(min(OVERLAP_SECONDS, start), 3) if k else 0,
            "markers": [{"at": mmss(t - start), "session_s": round(t, 2)}
                        for t in session.markers if start <= t < end],
            "gaps": [{"start": mmss(max(g["start_s"], start) - start), "end": mmss(min(g["end_s"], end) - start)}
                     for g in session.gaps if g["end_s"] > start and g["start_s"] < end],
        })
    return d


def raw_files_for(session_dir: Path, extra: list[Path] = ()) -> list[Path]:
    files = sorted((session_dir / "raw").glob("*.bin")) + list(extra)
    return files


def build_chunk(session: Session, session_dir: Path, meta: dict, k: int, start: float, end: float,
                fps: int = DEFAULT_FPS) -> Path:
    chunks = session_dir / "chunks"
    mp4 = chunks / f"chunk_{k:02d}.mp4"
    build_mp4(session, start, end, mp4, fps)
    (chunks / f"chunk_{k:02d}.json").write_text(json.dumps(sidecar(session, meta, fps, (k, start, end)), indent=2))
    return mp4


def build_all(session_dir: Path, sd_files: list[Path] = (), fps: int = DEFAULT_FPS,
              skip_chunks: set[int] = frozenset()) -> Session:
    meta_path = session_dir / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    session = load_session(raw_files_for(session_dir, sd_files))

    build_mp4(session, 0.0, session.duration, session_dir / "full.mp4", fps)
    for k, start, end in chunk_ranges(session.duration):
        if k not in skip_chunks:
            build_chunk(session, session_dir, meta, k, start, end, fps)

    markers = []
    for t in session.markers:
        owners = [(k, s) for k, s, e in chunk_ranges(session.duration) if s <= t < e]
        markers.append({"session_s": round(t, 2), "at": mmss(t),
                        "chunks": [{"chunk_index": k, "at": mmss(t - s)} for k, s in owners]})
    (session_dir / "markers.json").write_text(json.dumps(markers, indent=2))
    (session_dir / "gaps.json").write_text(json.dumps(session.gaps, indent=2))
    sc = sidecar(session, meta, fps)
    sc["chunks"] = [{"chunk_index": k, "file": f"chunks/chunk_{k:02d}.mp4", "start_s": s, "end_s": e}
                    for k, s, e in chunk_ranges(session.duration)]
    sc["chunk_seconds"] = CHUNK_SECONDS
    sc["overlap_seconds"] = OVERLAP_SECONDS
    sc["stats"] = session.stats
    (session_dir / "session.json").write_text(json.dumps(sc, indent=2))
    return session


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session_dir", type=Path)
    ap.add_argument("--sd", type=Path, action="append", default=[],
                    help="the glasses' SD copy, e.g. /Volumes/SD/EDG/<session_id>.bin (fills Wi-Fi gaps)")
    ap.add_argument("--fps", type=int, default=DEFAULT_FPS, help="output frame rate (use 10 for playback mode)")
    args = ap.parse_args()
    s = build_all(args.session_dir, args.sd, args.fps)
    print(f"Built {args.session_dir}: {s.duration:.1f} s, {s.stats['frames']} frames, "
          f"{len(s.markers)} markers, {len(s.gaps)} gaps ({s.stats['missing_packets']} packets missing)")


if __name__ == "__main__":
    main()
