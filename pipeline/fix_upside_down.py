"""Turn the front-camera clips filmed in the app between #79 and #104 the right way up.

    .venv/bin/python pipeline/fix_upside_down.py                 # dry run: the bad clips, their jobs and recipes, the plan
    .venv/bin/python pipeline/fix_upside_down.py --try clip.mp4  # repair a local copy only (clip.fixed.mp4 + before/after frames)
    .venv/bin/python pipeline/fix_upside_down.py --write         # repair them in the uploads bucket (Caleb's OK first)

From #79 (in the app Oct 25) until #104's EAS Update (Oct 26 05:12 UTC), the in-app camera passed
isMirrored={false} to VisionCamera 4.7.3, and every front-camera clip was stored with display-matrix rotation 90
(back-camera clips have -90). Players show those clips upside down.

What the stored picture is (checked Oct 26 on the uploaded clips, not guessed): the real scene turned 180°, NOT
mirrored. Shirt text in family-recipe-9363d8 ("the brighter days ...") and the Cal Hacks lanyard in 6ff35b read
the right way once the frame is turned 180°, and backwards when it is flipped top-to-bottom. So the pixels are
fine and only the rotation tag is 180° off: the repair writes -90 (the back camera's value) with a stream copy.
No re-encode, nothing lost; the result is upright and unmirrored, like VisionCamera's own front path (#104),
which writes the same pixels with the rotation turned 180° (CameraSession+Configuration.swift step 2.2).
--mirror re-encodes instead and also mirrors left-right, for the case a real post-#104 front clip turns out to be
mirrored like a selfie (check one first; see docs/agents/memory/in-app-recording.md).

A clip is flagged when it looks like an in-app VisionCamera file (mp42 brand, no Apple camera tags, no ffmpeg
encoder tag), has rotation 90, and was created after #79 reached phones. A phone that hadn't loaded #104's
update still films bad front clips, so clips after FIXED_AT are flagged too, with a note. A repaired clip has
rotation -90 and is never flagged again.

--write, per clip: copy the original to backup/<path> in the uploads bucket (kept if it's already there),
download it, repair it, check the result (rotation -90, the same video and audio packets, creation_time kept),
and upload it over the original only if the original hasn't changed meanwhile. It never touches Convex, the
media bucket or a recipe: it prints how to redo each recipe that was published from a bad clip.
Note: the uploads bucket's 14-day lifecycle rule deletes backups and originals alike.
Reads Convex with the team token (CONVEX_OVERRIDE_ACCESS_TOKEN in .env) and the Convex CLI.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prep  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEPLOYMENT = "grand-dragon-649"
ROW_LIMIT = 10000
BACKUP = "backup/"
BAD_ROTATION = 90  # what a front clip got with isMirrored={false}
GOOD_ROTATION = -90  # what a back clip gets, and what #104 writes for a front clip
IN_APP_FROM = datetime(2026, 10, 25, 3, 38, tzinfo=timezone.utc)  # #79 merged (the in-app camera's flip)
FIXED_AT = datetime(2026, 10, 26, 5, 12, tzinfo=timezone.utc)  # #104's EAS Update 8cbcb886
VIDEO_EXTS = (".mp4", ".mov")


# ---------- detection (pure, tested in test_fix_upside_down.py) ----------

def rotation(info: dict) -> int | None:
    """The first video stream's display-matrix rotation in ffprobe's degrees (-90, 90, 180), or None."""
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    if video is None:
        return None
    for side in video.get("side_data_list", []):
        if "rotation" in side:
            return int(round(float(side["rotation"])))
    rotate = video.get("tags", {}).get("rotate")  # older ffprobe builds
    return -int(rotate) if rotate else None


def same_angle(a: int | None, b: int) -> bool:
    return a is not None and (a - b) % 360 == 0


def is_in_app(info: dict) -> bool:
    """A VisionCamera recording (AVAssetWriter): mp42 brand, no Apple camera tags (the iOS camera and the camera
    roll write com.apple.quicktime.*), not written by ffmpeg (the glasses VM, the demo uploads, a repaired clip)."""
    tags = info.get("format", {}).get("tags", {})
    if tags.get("major_brand", "").strip() != "mp42" or "encoder" in tags:
        return False
    return not any(k.startswith("com.apple.quicktime.") for k in tags)


def created_at(info: dict) -> datetime | None:
    value = info.get("format", {}).get("tags", {}).get("creation_time", "")
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def verdict(info: dict) -> tuple[bool, str]:
    """(upside down?, why) for one clip's ffprobe JSON (-show_format -show_streams)."""
    rot = rotation(info)
    if not is_in_app(info):
        return False, "not an in-app recording"
    if same_angle(rot, GOOD_ROTATION):
        return False, "upright (rotation -90)"
    if not same_angle(rot, BAD_ROTATION):
        return False, f"rotation {rot}: not the isMirrored={{false}} front-camera case"
    created = created_at(info)
    if created is None:
        return False, "rotation 90 but no creation_time: check it by eye"
    if created < IN_APP_FROM:
        return False, f"rotation 90 but filmed before #79 ({created:%b %d %H:%M} UTC)"
    if created >= FIXED_AT:
        return True, f"front camera, filmed {created:%b %d %H:%M} UTC, after #104 (that phone hadn't loaded the update)"
    return True, f"front camera, filmed {created:%b %d %H:%M} UTC"


# ---------- the repair ----------

def repair_args(src: Path, dst: Path, mirror: bool) -> list[str]:
    """ffmpeg arguments that write dst from src: rotation -90 instead of 90, everything else kept.
    mirror=True re-encodes the upright picture mirrored left-right (a selfie), with no rotation tag."""
    head = ["-display_rotation:v:0", str(GOOD_ROTATION), "-i", str(src), "-map", "0", "-map_metadata", "0"]
    if not mirror:
        return [*head, "-c", "copy", "-movflags", "+faststart", str(dst)]
    # ffmpeg turns the picture upright by the (corrected) display matrix, then hflip; about the in-app 6 Mbps.
    encoder = "h264_videotoolbox" if prep._HW else "libx264"
    return [*head, "-vf", "hflip", "-c:v", encoder, "-b:v", "6M", "-pix_fmt", "yuv420p",
            "-c:a", "copy", "-movflags", "+faststart", str(dst)]


def stream_hash(path: Path, which: str) -> str:
    """md5 of one stream's packets ("v" or "a"), as stored: equal hashes mean nothing was re-encoded."""
    return prep.run_cmd([prep.find_tool("ffmpeg"), "-v", "error", "-i", str(path), "-map", f"0:{which}",
                         "-c", "copy", "-f", "streamhash", "-hash", "md5", "-"]).strip().split("=")[-1]


def repair_file(src: Path, dst: Path, mirror: bool = False) -> None:
    """Write the repaired clip and check it; raises prep.PrepError when the result isn't right."""
    prep.ffmpeg(*repair_args(src, dst, mirror))
    before, after = prep.probe(src), prep.probe(dst)
    rot = rotation(after)
    if mirror and rot not in (None, 0):
        raise prep.PrepError(f"{dst}: rotation {rot} after the mirror re-encode")
    if not mirror and not same_angle(rot, GOOD_ROTATION):
        raise prep.PrepError(f"{dst}: rotation {rot}, expected {GOOD_ROTATION}")
    if created_at(before) != created_at(after):
        raise prep.PrepError(f"{dst}: creation_time {created_at(after)} != {created_at(before)} (prep orders clips by it)")
    has_audio = any(s.get("codec_type") == "audio" for s in before.get("streams", []))
    for which in (["a"] if has_audio else []) + ([] if mirror else ["v"]):
        if stream_hash(src, which) != stream_hash(dst, which):
            raise prep.PrepError(f"{dst}: the {'audio' if which == 'a' else 'video'} packets changed")
    if abs(float(before["format"]["duration"]) - float(after["format"]["duration"])) > 0.5:
        raise prep.PrepError(f"{dst}: duration {after['format']['duration']} != {before['format']['duration']}")


def frame(path: Path, out: Path, at_s: float = 1.0) -> Path:
    """One frame as players show it (display matrix applied), 540 px wide."""
    prep.ffmpeg("-ss", str(at_s), "-i", str(path), "-frames:v", "1", "-vf", "scale=540:-2", str(out))
    return out


# ---------- the cloud side (read-only unless --write) ----------

@dataclass
class Clip:
    path: str  # in the uploads bucket
    why: str
    job: dict | None = None
    recipe: dict | None = None
    notes: list[str] = field(default_factory=list)


def _env() -> None:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")


def _buckets():
    from google.cloud import storage
    client = storage.Client(project=os.environ.get("GCP_PROJECT"))
    return client.bucket(os.environ["GCS_UPLOAD_BUCKET"]), client.bucket(os.environ["GCS_MEDIA_BUCKET"])


def _token() -> str:
    import google.auth
    import google.auth.transport.requests
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/devstorage.read_only"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def probe_remote(bucket_name: str, path: str, token: str) -> dict:
    """ffprobe over HTTPS with range reads: the header and the moov box, not the whole clip."""
    url = f"https://storage.googleapis.com/{bucket_name}/{path}"
    proc = subprocess.run([prep.find_tool("ffprobe"), "-v", "error", "-headers", f"Authorization: Bearer {token}\r\n",
                           "-show_format", "-show_streams", "-of", "json", url], capture_output=True, text=True)
    if proc.returncode != 0:  # never prep.run_cmd here: its error repeats the command, token included
        raise prep.PrepError(f"ffprobe exit {proc.returncode}: {proc.stderr.strip()[-200:]}")
    return json.loads(proc.stdout)


def convex_rows(table: str, deployment: str) -> list[dict]:
    env = {k: v for k, v in os.environ.items() if k != "CONVEX_DEPLOY_KEY"}  # the team token reads any deployment
    out = subprocess.run(["npx", "--yes", "convex", "data", table, "--deployment", deployment,
                          "--limit", str(ROW_LIMIT), "--format", "jsonLines"],
                         cwd=ROOT, env=env, capture_output=True, text=True, check=True).stdout
    rows = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    if len(rows) >= ROW_LIMIT:
        sys.exit(f"Convex returned {len(rows)} {table}, the most it lists; raise ROW_LIMIT")
    return rows


def job_for(path: str, jobs: list[dict]) -> dict | None:
    """The Convex job whose uploadPath is this clip or its folder ("family-recipe-7f1ee1/")."""
    folder = path.split("/")[0] + "/"
    return next((j for j in jobs if j["uploadPath"] in (path, folder, folder.rstrip("/"))), None)


def redo_hint(clip: Clip) -> str:
    """What to do about the recipe made from this clip, in words (nothing here runs it)."""
    job, recipe = clip.job, clip.recipe
    if job is None:
        return "no Convex job: nothing was made from it"
    if recipe is None or recipe.get("status") != "ready":
        status = recipe.get("status") if recipe else "none"
        return (f"job {job['_id']} is {job['stage']}, recipe {recipe['_id'] if recipe else '-'} is {status}: "
                "nothing was published, so no recipe media to redo")
    return (f"recipe {recipe['_id']} ({recipe.get('title')}) is ready and its media in the media bucket "
            f"({recipe.get('recipeJsonUrl')}) came from the upside-down clip. Redo it: set job {job['_id']} back "
            "to stage 'queued' in the Convex dashboard (no function re-queues a finished job) so the worker runs "
            "prep -> process -> publish into the same folder, or locally: prep.py --force, process.py --force, "
            "publish. Both need Caleb's OK and redo the Gemini/Claude calls (process.py --rewrite is not enough: "
            "it reuses the old frames)")


def find(uploads, media, deployment: str) -> list[Clip]:
    token = _token()
    clips = []
    for blob in uploads.client.list_blobs(uploads):
        if not blob.name.lower().endswith(VIDEO_EXTS) or blob.name.startswith(BACKUP):
            continue
        try:
            bad, why = verdict(probe_remote(uploads.name, blob.name, token))
        except prep.PrepError as e:
            print(f"skip {blob.name}: {e}")
            continue
        print(f"{'BAD ' if bad else 'ok  '} {blob.name}: {why}")
        if bad:
            clips.append(Clip(blob.name, why))
    if not clips:
        return clips
    try:
        jobs, recipes = convex_rows("jobs", deployment), {r["_id"]: r for r in convex_rows("recipes", deployment)}
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"warning: couldn't read Convex ({e}); jobs and recipes unknown")
        return clips
    for clip in clips:
        clip.job = job_for(clip.path, jobs)
        clip.recipe = recipes.get(clip.job.get("recipeId")) if clip.job else None
        if clip.job and media.blob(f"cancellations/{clip.path.split('/')[0]}.json").exists():
            clip.notes.append(f"media has cancellations/{clip.path.split('/')[0]}.json (the cook stopped or removed it)")
    return clips


def write(uploads, clips: list[Clip], mirror: bool) -> None:
    for clip in clips:
        blob = uploads.get_blob(clip.path)
        backup = uploads.blob(BACKUP + clip.path)
        if backup.exists():
            print(f"  {clip.path}: backup already at {backup.name}; kept")
        else:
            uploads.copy_blob(blob, uploads, backup.name, if_generation_match=0)
            print(f"  {clip.path}: original copied to {backup.name}")
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "in.mp4", Path(tmp) / "out.mp4"
            blob.download_to_filename(str(src))
            repair_file(src, dst, mirror)
            out = uploads.blob(clip.path)
            out.content_type = blob.content_type or "video/mp4"
            out.upload_from_filename(str(dst), if_generation_match=blob.generation)  # not if it changed meanwhile
        print(f"  {clip.path}: repaired ({'mirrored, re-encoded' if mirror else 'rotation 90 -> -90, stream copy'})")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="repair the clips in the uploads bucket (default: dry run)")
    ap.add_argument("--mirror", action="store_true", help="also mirror left-right (re-encode); see the docstring")
    ap.add_argument("--try", dest="try_path", metavar="CLIP", type=Path,
                    help="repair a local clip into <clip>.fixed.mp4 with before/after frames; no cloud calls")
    ap.add_argument("--deployment", default=DEPLOYMENT, help=f"Convex deployment (default {DEPLOYMENT})")
    args = ap.parse_args(argv)

    if args.try_path:
        src = args.try_path
        bad, why = verdict(prep.probe(src))
        print(f"{src}: {'upside down' if bad else 'not flagged'} ({why})")
        dst = src.with_name(f"{src.stem}.fixed.mp4")
        repair_file(src, dst, args.mirror)
        at = min(1.0, float(prep.probe(src)["format"]["duration"]) / 2)
        before = frame(src, src.with_name(f"{src.stem}.before.jpg"), at)
        after = frame(dst, src.with_name(f"{src.stem}.after.jpg"), at)
        print(f"repaired: {dst}\nframes: {before} {after}")
        return

    _env()
    uploads, media = _buckets()
    clips = find(uploads, media, args.deployment)
    action = ("re-encode mirrored left-right (--mirror)" if args.mirror
              else "rotation 90 -> -90, stream copy (no re-encode)")
    for clip in clips:
        print(f"\n{clip.path} ({clip.why})\n  plan: back up to {BACKUP}{clip.path}, then {action}")
        if clip.job:
            print(f"  job {clip.job['_id']} ({clip.job['source']}, {clip.job['stage']}), "
                  f"recording {clip.job.get('recordingId', '-')}")
        print(f"  recipe: {redo_hint(clip)}" + "".join(f"\n  note: {n}" for n in clip.notes))
    if not args.write:
        print(f"\ndry run: {len(clips)} clip(s) to repair, nothing written. --write repairs them (Caleb's OK first).")
        return
    write(uploads, clips, args.mirror)
    print(f"{len(clips)} clip(s) repaired. Convex, the media bucket and the recipes were not touched.")


if __name__ == "__main__":
    main()
