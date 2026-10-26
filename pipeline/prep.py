"""Turn recording files into the AI copies, play.mp4, voice.m4a, poster.jpg and work/manifest.json.

python pipeline/prep.py --id weed-pancakes --title "Sunday Pancakes" --cook "Mom" --relation "Mom" \
    [--source "Creator name (YouTube)"] [--sample] [--force] input/pancakes_*.mov
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = ROOT / "data" / "out"
SEGMENT_S = 900  # AI copies longer than 15 min are split into 15-min segments

AI_ARGS = ["-vf", "scale=-2:360,fps=1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "32",
           "-c:a", "aac", "-ac", "1", "-ar", "16000", "-b:a", "32k"]
# Playback copy: Apple's hardware H.264 encoder when present (several times faster than libx264 on
# long 4K iPhone recordings; 2.5 Mbps is plenty for 720p on a phone), libx264 otherwise.
_HW = "h264_videotoolbox" in subprocess.run(
    [shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg", "-hide_banner", "-encoders"],
    capture_output=True, text=True).stdout
# 1.2 Mbps keeps 720p clips sharp in the app's player box and halves the upload of long recordings.
PLAY_VIDEO = (["-c:v", "h264_videotoolbox", "-b:v", "1200k", "-maxrate", "2000k", "-bufsize", "4000k"] if _HW
              else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"])
# Decode on the Mac's media engine too: software HEVC decoding of 4K iPhone video was the bottleneck. Only for the
# codecs it decodes: on others (AV1 from YouTube, Oct 26) ffmpeg 9 stops with "doesn't support hardware accelerated
# AV1 decoding" instead of falling back to software.
HWDEC = ["-hwaccel", "videotoolbox"] if _HW else []
HW_CODECS = {"h264", "hevc", "prores"}


def hwdec(path: Path) -> list[str]:
    """HWDEC when the file's first video stream is a codec the media engine decodes, else nothing (software)."""
    if not HWDEC:
        return []
    try:
        streams = probe(path).get("streams", [])
    except PrepError:
        return []
    codec = next((s.get("codec_name") for s in streams if s.get("codec_type") == "video"), None)
    return HWDEC if codec in HW_CODECS else []
PLAY_ARGS = ["-vf", "scale=-2:720", *PLAY_VIDEO,
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-b:a", "128k"]
# First real video stream (V skips cover art) and first audio stream.
MAP_ARGS = ["-map", "0:V:0", "-map", "0:a:0"]
# While process.py swaps in a clip reorder (pipeline/order.py): the pre-swap play.mp4 / voice.m4a (hard
# links), the target manifest (removed once the real one is written) and where an outdated recipe.json goes.
PREV_PLAY, PREV_VOICE = "play.prev.mp4", "voice.prev.m4a"
SWAP_PENDING = "swap.pending.json"
STALE_RECIPE = "recipe.stale.json"
LEGACY_BACKUPS = ("play.recorded.mp4", "voice.recorded.m4a")  # older runs kept these; nothing reads them


class PrepError(RuntimeError):
    pass


# ---------- ffmpeg helpers (also used by process.py) ----------

def find_tool(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    for candidate in (Path("/opt/homebrew/bin") / name, Path("/usr/local/bin") / name):
        if candidate.exists():
            return str(candidate)
    raise PrepError(f"{name} not found on PATH or in /opt/homebrew/bin; install it with `brew install ffmpeg`")


def run_cmd(args: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise PrepError(f"command failed (exit {proc.returncode}): {' '.join(args)}\n{proc.stderr.strip()[-3000:]}")
    return proc.stdout


def ffmpeg(*args: str) -> None:
    run_cmd([find_tool("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-y", *args])


def probe(path: Path) -> dict:
    out = run_cmd([find_tool("ffprobe"), "-v", "error", "-show_format", "-show_streams",
                   "-show_data_hash", "MD5", "-of", "json", str(path)])
    return json.loads(out)


def probe_duration(path: Path) -> float:
    dur = probe(path).get("format", {}).get("duration")
    if dur is None:
        raise PrepError(f"ffprobe reports no duration for {path}")
    return float(dur)


def encode(out: Path, args: list[str], force: bool) -> bool:
    """Run ffmpeg into a .part file and rename on success, so an interrupted run never leaves
    a half-written output that a later run would skip. Returns True if it (re)built `out`."""
    if out.exists() and not force:
        print(f"  skip {out.name} (exists)")
        return False
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    t0 = time.monotonic()
    ffmpeg(*args, str(tmp))
    tmp.replace(out)
    print(f"  made {out.name} ({time.monotonic() - t0:.1f} s)")
    return True


def write_json(path: Path, data: dict) -> None:
    """Write via a temp file + rename, so a crash never leaves half a manifest."""
    tmp = path.with_name(f"{path.stem}.part{path.suffix}")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


# ---------- inventory ----------

def _parse_time(value: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if dt.year < 2000:  # some cameras write 1904/1970 when the clock is unset
        return None
    return dt if dt.tzinfo else dt.astimezone()


def recording_time(path: Path, info: dict) -> tuple[datetime, str]:
    tags = info.get("format", {}).get("tags", {})
    apple = _parse_time(tags.get("com.apple.quicktime.creationdate", ""))
    if apple:
        return apple, "com.apple.quicktime.creationdate"  # keeps the phone's local UTC offset
    created = _parse_time(tags.get("creation_time", ""))
    if created:
        return created.astimezone(), "creation_time"
    return datetime.fromtimestamp(path.stat().st_mtime).astimezone(), "file mtime"


def inventory(path: Path) -> dict:
    info = probe(path)
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None:
        raise PrepError(f"{path.name} has no video stream")
    if audio is None:
        raise PrepError(f"{path.name} has no audio stream. homecookd needs the cook's narration; "
                        "use a recording with sound (check the mic wasn't muted / the export kept audio).")
    if "duration" not in info.get("format", {}):
        raise PrepError(f"ffprobe reports no duration for {path.name}")
    recorded, source = recording_time(path, info)
    return {"path": path, "duration": float(info["format"]["duration"]), "recorded": recorded, "recorded_source": source}


# ---------- steps ----------

def make_ai_copy(src: Path, duration: float, nn: str, work: Path, force: bool) -> list[dict]:
    base = [*hwdec(src), "-i", str(src), *MAP_ARGS, *AI_ARGS]
    if duration <= SEGMENT_S:
        out = work / f"ai_{nn}.mp4"
        encode(out, base, force)
        return [{"path": f"work/{out.name}", "start_in_file_s": 0.0, "duration_s": round(probe_duration(out), 3)}]

    chunks_csv = work / f"chunks_{nn}.csv"

    def read_rows() -> list[list[str]]:
        with chunks_csv.open() as f:
            return [row for row in csv.reader(f) if row]

    if force or not chunks_csv.exists() or not all((work / Path(r[0]).name).exists() for r in read_rows()):
        # Each 900 s segment is encoded on its own with -ss/-t (frame-accurate when transcoding), so its
        # start in the file is exact. ffmpeg 9's `-f segment` muxer did not cut while encoding in testing
        # (one 970 s segment despite a forced keyframe at 900 s), so it is not used here.
        for old in work.glob(f"ai_{nn}_*.mp4"):
            old.unlink()
        chunks_csv.unlink(missing_ok=True)
        rows = []
        for k in range(math.ceil(duration / SEGMENT_S)):
            start = k * SEGMENT_S
            seg = work / f"ai_{nn}_{k:02d}.mp4"
            encode(seg, ["-ss", str(start), "-t", str(SEGMENT_S), *base], True)
            rows.append([seg.name, f"{start:.3f}", f"{min(start + SEGMENT_S, duration):.3f}"])
        with chunks_csv.open("w", newline="") as f:  # written last: marks the split as complete
            csv.writer(f).writerows(rows)
    else:
        print(f"  skip ai_{nn}_*.mp4 (exists)")

    files = []
    for name, start, _end in read_rows():
        seg = work / Path(name).name
        files.append({"path": f"work/{seg.name}", "start_in_file_s": round(float(start), 3),
                      "duration_s": round(probe_duration(seg), 3)})
    return files


def _concat_key(path: Path) -> tuple:
    streams = probe(path)["streams"]
    v = next(s for s in streams if s["codec_type"] == "video")
    a = next(s for s in streams if s["codec_type"] == "audio")
    return (v.get("width"), v.get("height"), v.get("pix_fmt"), v.get("extradata_hash"),
            a.get("sample_rate"), a.get("channels"), a.get("extradata_hash"))


def concat(plays: list[Path], work: Path, out: Path) -> None:
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    t0 = time.monotonic()
    keys = [_concat_key(p) for p in plays]
    if all(k == keys[0] for k in keys):
        listing = work / "concat.txt"
        listing.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in plays))
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(tmp))
        how = "stream copy"
    else:
        # Stream copy would corrupt the joins (different size/encoder params, e.g. portrait + landscape),
        # so re-encode, letterboxing everything into the first file's frame size.
        width, height = keys[0][0], keys[0][1]
        print(f"  playback copies differ in format ({[k[:2] + k[4:6] for k in keys]}); re-encoding the concat")
        inputs, chains, pads = [], [], ""
        for i, p in enumerate(plays):
            inputs += ["-i", str(p)]
            chains.append(f"[{i}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                          f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v{i}]")
            chains.append(f"[{i}:a:0]aresample=48000,aformat=channel_layouts=stereo[a{i}]")
            pads += f"[v{i}][a{i}]"
        graph = ";".join(chains) + f";{pads}concat=n={len(plays)}:v=1:a=1[v][a]"
        ffmpeg(*inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
               *PLAY_VIDEO, "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-ar", "48000", "-b:a", "128k", "-movflags", "+faststart", str(tmp))
        how = "re-encode"
    tmp.replace(out)
    print(f"  made {out.name} from {len(plays)} file(s) by {how} ({time.monotonic() - t0:.1f} s)")


def play_file(session: dict) -> str:
    """A session's playback copy, relative to the recipe folder (named by its recorded position)."""
    return session.get("play_file") or f"work/play_{session.get('recorded_index', session['index']):02d}.mp4"


def lay_out(sessions: list[dict], out_dir: Path) -> float:
    """Set offset_s & duration_s of each session, in play order, from its playback copy.
    Returns the summed length in seconds (float)."""
    cursor = 0.0
    for s in sessions:
        dur = probe_duration(out_dir / play_file(s))
        s["offset_s"] = round(cursor)
        s["duration_s"] = math.floor(dur)  # floor: timestamps must never pass the real end
        cursor += dur
    return cursor


def make_poster(play: Path, at_s: float, out: Path) -> None:
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    ffmpeg("-ss", f"{at_s:.2f}", "-i", str(play), "-frames:v", "1", "-q:v", "3", "-update", "1", str(tmp))
    tmp.replace(out)


def _layout(manifest: dict) -> tuple:
    """What recipe.json times depend on: which clip sits where in play.mp4."""
    return manifest.get("duration_s"), [(s.get("input"), s.get("offset_s"), s.get("duration_s"))
                                        for s in manifest.get("sessions", [])]


# ---------- main ----------

def run(recipe_id: str, title: str, cook: str, relation: str, inputs: list[Path],
        source: str | None = None, sample: bool = False, force: bool = False) -> Path:
    """Prepare media for one recipe. Returns the path of work/manifest.json. Raises PrepError on failure."""
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", recipe_id):
        raise PrepError(f"recipe id {recipe_id!r} must be lowercase letters, digits and hyphens (e.g. weed-pancakes)")
    if not inputs:
        raise PrepError("no input files given")
    paths = [Path(p).expanduser().resolve() for p in inputs]
    for p in paths:
        if not p.is_file():
            raise PrepError(f"input not found: {p}")
    if len(set(paths)) != len(paths):
        raise PrepError("the same input file is listed twice")

    out_dir = OUT_ROOT / recipe_id
    work = out_dir / "work"
    work.mkdir(parents=True, exist_ok=True)
    manifest_path = work / "manifest.json"
    t_start = time.monotonic()

    print(f"[prep {recipe_id}] inventory")
    items = sorted((inventory(p) for p in paths), key=lambda it: it["recorded"])
    for n, it in enumerate(items, 1):
        print(f"  {n:02d}  {it['path'].name}  {it['duration']:.1f} s  recorded {it['recorded'].isoformat(timespec='seconds')}"
              f"  (from {it['recorded_source']})")
        if it["recorded_source"] == "file mtime" and len(items) > 1:
            print(f"      warning: no creation date in {it['path'].name}; order uses file mtime, check it is right")

    if (work / SWAP_PENDING).exists():
        if not force:
            raise PrepError(f"a clip reorder in {work} was interrupted; run process.py --id {recipe_id} first "
                            "(it finishes or undoes it), or prep.py --force")
        for name in (SWAP_PENDING, PREV_PLAY, PREV_VOICE):
            (work / name).unlink(missing_ok=True)
    old_manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    previous_manifest = old_manifest if not force else None
    if previous_manifest:
        # Compare in recorded order: process.py may have put the sessions in cooking order.
        previous = [s.get("input") for s in sorted(previous_manifest.get("sessions", []),
                                                   key=lambda s: s.get("recorded_index", s["index"]))]
        if previous != [str(it["path"]) for it in items]:
            raise PrepError(f"{manifest_path} was built from different inputs {previous}; re-run with --force")

    rebuilt = force
    plays: list[Path] = []
    # Every file's AI copy and playback copy encode in parallel (hardware encoders have headroom).
    with ThreadPoolExecutor(max_workers=4) as pool:
        ai_jobs, play_jobs = [], []
        for n, it in enumerate(items, 1):
            nn = f"{n:02d}"
            print(f"[prep {recipe_id}] file {nn}: {it['path'].name}")
            ai_jobs.append((it, pool.submit(make_ai_copy, it["path"], it["duration"], nn, work, force)))
            play = work / f"play_{nn}.mp4"
            play_jobs.append(pool.submit(encode, play, [*hwdec(it["path"]), "-i", str(it["path"]), *MAP_ARGS, *PLAY_ARGS],
                                         force))
            plays.append(play)
        for it, job in ai_jobs:
            it["ai_files"] = job.result()
        for job in play_jobs:
            rebuilt |= job.result()

    # Keep the cooking order process.py chose (and its cached decision) unless --force: the inputs are
    # the same (checked above), so a re-encoded playback copy still belongs at the same place.
    order = (previous_manifest or {}).get("order")
    chosen = order.get("chosen") if order and order.get("reordered") else None
    if chosen and sorted(chosen) != list(range(1, len(items) + 1)):
        raise PrepError(f"{manifest_path} has a bad clip order {chosen}; re-run with --force")

    print(f"[prep {recipe_id}] play.mp4, voice.m4a, poster.jpg")
    play_mp4, voice, poster = out_dir / "play.mp4", out_dir / "voice.m4a", out_dir / "poster.jpg"
    if rebuilt or not play_mp4.exists():
        concat([plays[r - 1] for r in chosen] if chosen else plays, work, play_mp4)
        rebuilt = True
        for stale in LEGACY_BACKUPS:
            (work / stale).unlink(missing_ok=True)
    else:
        print("  skip play.mp4 (exists)")
    encode(voice, ["-i", str(play_mp4), "-vn", "-c:a", "copy", "-movflags", "+faststart"], rebuilt)

    total = probe_duration(play_mp4)
    if rebuilt or not poster.exists():
        make_poster(play_mp4, total * 0.2, poster)  # placeholder; process.py replaces it with a frame from step 2
        print("  made poster.jpg (placeholder at 20%)")
    else:
        print("  skip poster.jpg (exists)")

    sessions = [{
        "index": n,
        "recorded_index": n,  # position by recording time; stays put if process.py reorders by content
        "recorded_at": it["recorded"].isoformat(timespec="seconds"),
        "offset_s": 0,
        "duration_s": 0,
        "input": str(it["path"]),
        "recorded_at_source": it["recorded_source"],
        "play_file": f"work/{play.name}",
        "ai_files": it["ai_files"],
    } for n, (it, play) in enumerate(zip(items, plays), 1)]
    if chosen:
        sessions = [sessions[r - 1] for r in chosen]
        for n, s in enumerate(sessions, 1):
            s["index"] = n
        print(f"  keeping the cooking order from process.py: clips {chosen}")
    cursor = lay_out(sessions, out_dir)
    if abs(cursor - total) > 2:
        print(f"  warning: play.mp4 is {total:.1f} s but the copies sum to {cursor:.1f} s; offsets may drift")

    manifest = {
        "id": recipe_id, "title": title, "cook": cook, "relation": relation, "source": source,
        "sample": sample, "duration_s": math.floor(total), "sessions": sessions,
    }
    if order:
        manifest["order"] = order
    # recipe.json times point into the old play.mp4. If its layout changed (--force dropped a cooking
    # order, or a copy came out a different length), set the recipe aside so it is never published.
    recipe = out_dir / "recipe.json"
    if old_manifest and recipe.exists() and _layout(old_manifest) != _layout(manifest):
        recipe.replace(work / STALE_RECIPE)
        print(f"  play.mp4 changed layout; moved recipe.json to work/{STALE_RECIPE} (re-run process.py)")
    write_json(manifest_path, manifest)
    print(f"[prep {recipe_id}] done in {time.monotonic() - t_start:.1f} s: {len(sessions)} session(s), "
          f"{sum(len(s['ai_files']) for s in sessions)} AI file(s), {math.floor(total)} s -> {manifest_path}")
    return manifest_path


def main() -> None:
    ap = argparse.ArgumentParser(description="Prepare recording files for the homecookd pipeline.")
    ap.add_argument("--id", required=True, help="recipe id, e.g. weed-pancakes")
    ap.add_argument("--title", required=True)
    ap.add_argument("--cook", required=True)
    ap.add_argument("--relation", required=True)
    ap.add_argument("--source", default=None, help='credit, e.g. "Creator name (YouTube)"')
    ap.add_argument("--sample", action="store_true", help="mark as a sample recipe (e.g. a credited YouTube video)")
    ap.add_argument("--force", action="store_true", help="rebuild outputs that already exist")
    ap.add_argument("inputs", nargs="+", type=Path)
    args = ap.parse_args()
    try:
        run(args.id, args.title, args.cook, args.relation, args.inputs, source=args.source, sample=args.sample,
            force=args.force)
    except PrepError as e:
        sys.exit(f"prep: error: {e}")


if __name__ == "__main__":
    main()
