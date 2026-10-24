"""--cloud: connects the laptop receiver to homecookd (Convex + GCS + the glasses VM).

    glasses --UDP--> receiver --+-- raw/*.bin (local backup, as before)
                                +-- [A] relay.py          live copy to the VM (homie's /frame/latest)
                                +-- [B] backup_upload.py  raw/*.bin to GCS after "I'm done" (--backup-during: every minute)
                                +-- [C] live_analysis.py  30 s windows -> Gemini -> Convex /glasses/live-events
                                +-- frames      newest JPEG ~7/s -> Convex /glasses/frame (the phone's live view)
                                +-- [D] finish             on "I'm done": the full video, rebuilt from the
                                                          backup, -> glasses-<recordingId>/NN.mp4 -> /glasses/finished

Pairing: the cook presses Start in the app. Every second this asks Convex
/glasses/active which recording is live (as the VM does) and binds to it every glasses session that is
streaming here. A glasses reboot mid-cook is a new session id, so it becomes the recording's next clip
(02.mp4); the pipeline already takes several clips. Bindings are saved in each session's meta.json
("cloud"), so a receiver restart picks them up again.

The final video is built from every raw file the laptop has (plus any --sd copy), not from what the VM
got live, so Wi-Fi drops on the way to the cloud never reach the recipe. The laptop finishes first and
the VM, seeing the job, only cleans up (it is the fallback uploader if the laptop never finishes).

Recover a recording by hand (say the laptop died before "I'm done" finished uploading):
    python receiver/cloud_bridge.py finish sessions/<sid> [sessions/<sid2> ...] --recording <id> [--sd x.bin]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import queue
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import cloud_io
import session_builder as sb
from backup_upload import BackupUploader
from edg_protocol import EVENT, JPEG, PCM
from live_analysis import LiveAnalyzer
from relay import Relay

POLL_S = 1  # how quickly her Start / Stop reaches the laptop (footage is kept only in between)
LIVE_S = 10  # a session counts as streaming if a packet came this recently
RETRY_S = 30
FRAME_ERROR_EVERY_S = 60  # log a failing frame upload at most this often
FRAME_SENDERS = 3  # frame uploads in flight at once: one round trip to Convex takes 0.2-0.4 s
CLOUD_FPS = 15  # the uploaded video's frame rate: the kid watches it (the glasses send ~23 fps)
POST_TRIES = 3


@dataclass
class Clip:
    """One glasses session's part of one recording: session seconds [from_t, to_t)."""
    sid: str
    dir: Path
    from_t: float
    to_t: float | None = None


def started_at_ms(meta: dict) -> int:
    """Wall-clock ms of the glasses session's t = 0."""
    if meta.get("started_at_ms"):
        return int(meta["started_at_ms"])
    return int(datetime.fromisoformat(meta["started_at"]).timestamp() * 1000)


def _read_meta(d: Path) -> dict:
    try:
        return json.loads((d / "meta.json").read_text())
    except (OSError, ValueError):
        return {}


def _write_meta(d: Path, meta: dict) -> None:
    tmp = d / "meta.json.tmp"
    tmp.write_text(json.dumps(meta, indent=2))
    tmp.replace(d / "meta.json")


class CloudBridge:
    def __init__(self, args) -> None:
        cloud_io.load_env(Path(__file__).resolve().parent.parent / ".env")
        env = os.environ
        missing = [k for k in ("CONVEX_SITE_URL", "GLASSES_SECRET", "GCS_UPLOAD_BUCKET") if not env.get(k)]
        if missing:
            raise SystemExit(f"--cloud needs {', '.join(missing)} (in edible-glasses/.env or exported)")
        self.args = args
        self.site, self.secret, self.bucket = env["CONVEX_SITE_URL"], env["GLASSES_SECRET"], env["GCS_UPLOAD_BUCKET"]
        self.relay = (Relay(env["GLASSES_URL"], env.get("GLASSES_DEVICE_KEY", ""), args.relay_fps)
                      if env.get("GLASSES_URL") and args.relay_fps > 0 else None)
        self.backup = BackupUploader(self.bucket)
        self.live = (LiveAnalyzer(self._post_window, args.model, window_s=args.live_window)
                     if env.get("GEMINI_API_KEY") and not args.no_live else None)
        self.dirs: dict[str, Path] = {}          # sid -> session dir
        self.last_seen: dict[str, float] = {}    # sid -> monotonic time of its last packet
        self.max_t: dict[str, float] = {}        # sid -> newest session time
        self.clips: dict[str, list[Clip]] = {}   # recordingId -> its clips, in order
        self.open_clip: dict[str, str] = {}      # sid -> the recordingId it is streaming into
        self.window_rid: dict[str, str] = {}     # sid -> where its live windows go (kept while finishing)
        self.finishing: set[str] = set()
        self.retry_at: dict[str, float] = {}
        self.latest: dict[str, tuple[float, bytes]] = {}  # sid -> its newest frame (session t, JPEG)
        self.frame_pool = ThreadPoolExecutor(max_workers=FRAME_SENDERS)
        self.frames_in_flight = 0
        self.frame_lock = threading.Lock()
        self.frame_error_at = 0.0
        self.posts: queue.Queue = queue.Queue()
        self._restore(args.out)

    # ---- startup ----

    def _restore(self, out: Path) -> None:
        """Bindings from an earlier run whose recording hasn't been finished yet."""
        for meta_path in sorted(out.glob("*/meta.json")):
            meta = _read_meta(meta_path.parent)
            for b in meta.get("cloud", []):
                if b.get("job") or b.get("abandoned"):
                    continue
                rid, sid = b["recording_id"], meta_path.parent.name
                self.dirs[sid] = meta_path.parent
                self.clips.setdefault(rid, []).append(Clip(sid, meta_path.parent, b["from_t"], b.get("to_t")))
                if b.get("to_t") is None:
                    self.open_clip[sid] = self.window_rid[sid] = rid
                print(f"[cloud] {sid}: still bound to recording {rid}")

    def start(self, loop: asyncio.AbstractEventLoop) -> list[asyncio.Task]:
        threading.Thread(target=self.backup.run, daemon=True).start()
        threading.Thread(target=self._poster, daemon=True).start()
        if self.args.frame_every > 0:
            threading.Thread(target=self._frames, daemon=True).start()
        for rid, clips in self.clips.items():
            for c in clips:
                if self.args.backup_during:
                    self.backup.add(c.dir, rid)
        self.tasks = [loop.create_task(self._poll())]  # held, so they can't be garbage-collected
        if self.relay:
            self.tasks.append(loop.create_task(self.relay.run()))
        print(f"[cloud] on: Convex {self.site}, gs://{self.bucket}"
              f"{', relay to ' + os.environ['GLASSES_URL'] if self.relay else ', no VM relay'}"
              f"{', live analysis' if self.live else ', no live analysis'}")
        return self.tasks

    # ---- fed by receiver.py on its loop ----

    def session_opened(self, sid: str, session_dir: Path) -> None:
        self.dirs[sid] = session_dir
        if self.live and sid in self.open_clip:  # the receiver restarted mid-recording: keep analysing
            meta = _read_meta(session_dir)
            self.live.start(sid, meta, started_at_ms(meta))

    def storing(self, sid: str) -> bool:
        """True while this glasses session is in a recording she started and hasn't stopped."""
        return sid in self.open_clip

    def packet(self, sid: str, p) -> None:
        self.last_seen[sid] = time.monotonic()
        self.max_t[sid] = max(self.max_t.get(sid, 0.0), p.t)
        if p.type == JPEG:
            self.latest[sid] = (p.t, p.payload)
            if self.relay:
                self.relay.frame(p.payload, p.t_ms)
            if self.live:
                self.live.frame(sid, p.payload, p.t)
        elif p.type == PCM:
            if self.relay:
                self.relay.audio(p.payload, p.t_ms)
            if self.live:
                self.live.audio(sid, p.payload, p.t)
        elif p.type == EVENT and self.live and p.json().get("event") == "marker":
            self.live.marker(sid, p.t)

    # ---- pairing with Convex ----

    async def convex(self, path: str, body: dict) -> tuple[int, dict | None]:
        return await asyncio.to_thread(cloud_io.convex_post, self.site, self.secret, path, body)

    async def _poll(self) -> None:
        while True:
            try:
                await self._tick()
            except Exception as e:  # Convex or the hotspot blinked: keep recording, try again
                print(f"[cloud] poll: {e}")
            await asyncio.sleep(POLL_S)

    async def _tick(self) -> None:
        code, body = await self.convex("/glasses/active", {})
        if code not in (200, 204):
            raise RuntimeError(f"/glasses/active answered {code}: {body}")
        active = body if code == 200 else None

        for rid in [r for r in list(self.clips) if r not in self.finishing]:
            if active and active["recordingId"] == rid:
                status = active["status"]
            else:
                c, b = await self.convex("/glasses/active", {"recordingId": rid})
                status = "abandoned" if c == 404 else (b or {}).get("status") if c == 200 else None
            if status == "ended" and time.monotonic() >= self.retry_at.get(rid, 0):
                self.finishing.add(rid)
                self._close_clips(rid)
                asyncio.get_running_loop().run_in_executor(None, self._finish_logged, rid)
            elif status == "abandoned":
                self._abandon(rid)

        # Only her Start counts: footage is kept from the moment the recording is 'recording', never before.
        if active and active["status"] == "recording":
            rid = active["recordingId"]
            now = time.monotonic()
            for sid, seen in self.last_seen.items():
                if now - seen <= LIVE_S and self.open_clip.get(sid) != rid and rid not in self.finishing:
                    self._bind(sid, rid)

    def _bind(self, sid: str, rid: str) -> None:
        old = self.open_clip.get(sid)
        if old:  # still streaming into an older recording that never ended: that clip stops here
            self._close_clip(sid, old)
        d = self.dirs[sid]
        meta = _read_meta(d)
        bindings = meta.setdefault("cloud", [])
        # The clip starts where she pressed Start (now), not at the glasses' power-on: nothing from before
        # is stored (receiver.py writes packets only while a clip is open) or put in the video.
        from_t = round(self.max_t.get(sid, 0.0), 2)
        bindings.append({"recording_id": rid, "from_t": from_t})
        _write_meta(d, meta)
        self.clips.setdefault(rid, []).append(Clip(sid, d, from_t))
        self.open_clip[sid] = self.window_rid[sid] = rid
        # The rolling cloud backup shares the phone hotspot with the glasses' own stream, and its minute-by-
        # minute bursts make the glasses drop packets (the live view freezes). By default it waits until
        # "I'm done" (finish_recording syncs everything); the local copy is complete the whole time.
        if self.args.backup_during:
            self.backup.add(d, rid)
        if self.live:
            self.live.start(sid, meta, started_at_ms(meta))
        print(f"[cloud] glasses session {sid} paired with recording {rid}"
              f" (clip {len(self.clips[rid]):02d}, from {sb.mmss(from_t)})")

    def _close_clip(self, sid: str, rid: str) -> None:
        to_t = round(self.max_t.get(sid, 0.0), 2)
        for c in self.clips.get(rid, []):
            if c.sid == sid and c.to_t is None:
                c.to_t = to_t
        meta = _read_meta(self.dirs[sid])
        for b in meta.get("cloud", []):
            if b["recording_id"] == rid and b.get("to_t") is None:
                b["to_t"] = to_t
        _write_meta(self.dirs[sid], meta)
        self.open_clip.pop(sid, None)

    def _close_clips(self, rid: str) -> None:
        for sid, r in list(self.open_clip.items()):
            if r == rid:
                self._close_clip(sid, rid)

    def _abandon(self, rid: str) -> None:
        """The cook threw it away: stop sending it anywhere. The local raw files stay, as always."""
        for c in self.clips.pop(rid, []):
            self.backup.sessions.pop(c.dir, None)
            meta = _read_meta(c.dir)
            for b in meta.get("cloud", []):
                if b["recording_id"] == rid:
                    b["abandoned"] = True
            _write_meta(c.dir, meta)
            if self.open_clip.get(c.sid) == rid:
                self.open_clip.pop(c.sid)
            if self.window_rid.get(c.sid) == rid:
                self.window_rid.pop(c.sid)
        print(f"[cloud] recording {rid} was discarded; not uploading it")

    # ---- live windows -> Convex (a thread, so Gemini's worker never waits on the network) ----

    def _post_window(self, w: dict) -> None:
        """From LiveAnalyzer, on any thread. Only paired sessions are analysed, so there's always a recording,
        unless the cook discarded it meanwhile."""
        rid = self.window_rid.get(w["sessionId"])
        if rid:
            self.posts.put((rid, w))

    def _poster(self) -> None:
        while True:
            rid, w = self.posts.get()
            for attempt in range(POST_TRIES):
                try:
                    code, res = cloud_io.convex_post(self.site, self.secret, "/glasses/live-events",
                                                     {"recordingId": rid, **w})
                    if code == 200 or code in (400, 404):
                        if code != 200:
                            print(f"[live] Convex refused a window ({code}): {(res or {}).get('error')}")
                        break
                except OSError as e:
                    if attempt == POST_TRIES - 1:
                        print(f"[live] could not post a window: {e}")
                time.sleep(2 ** attempt)
            self.posts.task_done()

    # ---- the phone's live view: the newest frame of each paired session, about once a second ----

    def _frames(self) -> None:
        """Every --frame-every s, the newest frame of each paired session goes up, a few at a time (one
        upload is a whole round trip). Each carries its capture time, so Convex keeps the newest even when
        uploads finish out of order. A slow uplink just skips frames: the next one is newer anyway."""
        sent: dict[str, float] = {}  # sid -> session t of the last frame handed to a sender
        while True:
            t0 = time.monotonic()
            for sid, rid in list(self.open_clip.items()):
                t, jpeg = self.latest.get(sid, (None, b""))
                if t is None or sent.get(sid) == t:
                    continue
                with self.frame_lock:
                    if self.frames_in_flight >= FRAME_SENDERS:
                        continue
                    self.frames_in_flight += 1
                sent[sid] = t
                self.frame_pool.submit(self._send_frame, sid, rid, t, jpeg)
            time.sleep(max(0.0, self.args.frame_every - (time.monotonic() - t0)))

    def _send_frame(self, sid: str, rid: str, t: float, jpeg: bytes) -> None:
        try:
            jpeg = small_jpeg(jpeg)
            code, res = cloud_io.convex_post_bytes(
                self.site, self.secret, f"/glasses/frame?recordingId={rid}&session={sid}&t={int(t * 1000)}",
                jpeg, "image/jpeg")
            if code != 200:
                raise RuntimeError(f"{code} {(res or {}).get('error')}")
        except Exception as e:
            if time.monotonic() - self.frame_error_at > FRAME_ERROR_EVERY_S:
                self.frame_error_at = time.monotonic()
                print(f"[frames] could not send a frame: {e}")
        finally:
            with self.frame_lock:
                self.frames_in_flight -= 1

    # ---- [D] finish ----

    def _finish_logged(self, rid: str) -> None:
        try:
            self.finish(rid)
        except Exception as e:
            self.retry_at[rid] = time.monotonic() + RETRY_S
            print(f"[cloud] finishing {rid} failed: {e}\n"
                  f"        retry: python receiver/cloud_bridge.py finish "
                  f"{' '.join(str(c.dir) for c in self.clips.get(rid, []))} --recording {rid}")
        finally:
            self.finishing.discard(rid)

    def finish(self, rid: str) -> None:
        clips = self.clips.get(rid, [])
        if self.live:
            for c in clips:
                self.live.flush(c.sid)
        result = finish_recording(self.site, self.secret, self.backup, rid, clips, self.args.cloud_fps,
                                  auto_job=self.args.auto_job)
        self.posts.join()  # the last live windows are in before the worker claims the job
        self.clips.pop(rid, None)
        print(f"[cloud] recording {rid}: done" + (f", job {result['jobId']} queued" if "jobId" in result else
                                                  ". Save it to Photos from the app, then send it with \"Videos I took\"."))


PREVIEW_WIDTH = 320  # the phone's live picture: a quarter of the pixels, so it costs the hotspot little


def small_jpeg(jpeg: bytes) -> bytes:
    """The frame shrunk for the phone's preview (~4 KB instead of ~12 KB); the original if Pillow can't read it."""
    try:
        from io import BytesIO
        from PIL import Image
        img = Image.open(BytesIO(jpeg))
        if img.width <= PREVIEW_WIDTH:
            return jpeg
        img = img.convert("RGB").resize((PREVIEW_WIDTH, round(img.height * PREVIEW_WIDTH / img.width)))
        out = BytesIO()
        img.save(out, "JPEG", quality=60)
        return out.getvalue()
    except Exception:
        return jpeg


def finish_recording(site: str, secret: str, backup: BackupUploader, rid: str, clips: list[Clip],
                     fps: int = CLOUD_FPS, sd_files: list[Path] = (), auto_job: bool = False,
                     media_bucket: str = "") -> dict:
    """Build the full video from the backup and save it for the cook: gs://<media>/glasses-<rid>/full.mp4
    (public, unguessable), reported to Convex /glasses/video, so her phone can save it to Photos and she sends
    it through the app herself. With auto_job, also upload each clip as glasses-<rid>/NN.mp4 to the uploads
    bucket and create the job, as before. The rest of the raw backup goes up last, so a backup that fell
    behind on a slow hotspot doesn't hold anything up."""
    if not clips:
        raise RuntimeError(f"no glasses sessions were paired with {rid}")
    video_started_at = None
    total = 0.0
    gaps: list[dict] = []
    built: list[Path] = []
    for n, c in enumerate(clips, 1):
        meta = _read_meta(c.dir)
        t0_ms = started_at_ms(meta)
        sid_sd = [f for f in sd_files if f.stem == c.sid]
        session = sb.load_session(sb.raw_files_for(c.dir, sid_sd))
        end = min(c.to_t, session.duration) if c.to_t else session.duration
        if end - c.from_t < 1:
            print(f"[cloud] {c.sid}: under a second in this recording; skipping it")
            continue
        out = c.dir / "cloud" / f"{rid}_{n:02d}.mp4"
        sb.build_mp4(session, c.from_t, end, out, fps)
        clip_start_ms = t0_ms + int(c.from_t * 1000)
        if video_started_at is None:
            video_started_at = clip_start_ms
        shift = (clip_start_ms - video_started_at) / 1000 - c.from_t  # session seconds -> video seconds
        gaps += [{"startS": round(max(g["start_s"], c.from_t) + shift, 1), "endS": round(min(g["end_s"], end) + shift, 1)}
                 for g in session.gaps if g["end_s"] > c.from_t and g["start_s"] < end]
        (c.dir / "cloud" / f"{rid}_{n:02d}.gaps.json").write_text(json.dumps(session.gaps, indent=2))
        built.append(out)
        if auto_job:
            result = cloud_io.gcs_upload(backup.bucket, f"glasses-{rid}/{n:02d}.mp4", out, "video/mp4")
            if result == "already there":
                print(f"[cloud] glasses-{rid}/{n:02d}.mp4 was already uploaded (by the VM, or an earlier try)")
        print(f"[cloud] {c.sid}: {end - c.from_t:.0f} s of video, {len(session.gaps)} gaps")
        total += end - c.from_t
    if video_started_at is None:
        raise RuntimeError(f"recording {rid} has no footage")

    # One file for her phone: the clips joined (a glasses reboot mid-cook makes two).
    full = built[0] if len(built) == 1 else join_clips(built, clips[0].dir / "cloud" / f"{rid}_full.mp4")
    bucket = media_bucket or os.environ.get("GCS_MEDIA_BUCKET", "")
    if not bucket:
        raise RuntimeError("set GCS_MEDIA_BUCKET (e.g. edible-media-379797517579) so the phone can download the video")
    name = f"glasses-{rid}/full.mp4"
    cloud_io.gcs_upload(bucket, name, full, "video/mp4")
    video_url = f"https://storage.googleapis.com/{bucket}/{name}"
    code, res = cloud_io.convex_post(site, secret, "/glasses/video", {"recordingId": rid, "videoUrl": video_url})
    if code != 200:
        raise RuntimeError(f"/glasses/video answered {code}: {res}")
    print(f"[cloud] recording {rid}: full video ({total:.0f} s) ready for the phone at {video_url}")
    res = {"videoUrl": video_url}
    if auto_job:
        code, job = cloud_io.convex_post(site, secret, "/glasses/finished", {
            "recordingId": rid, "uploadPath": f"glasses-{rid}/", "videoStartedAt": video_started_at,
            "durationS": round(total, 1), "videoGaps": gaps})
        if code != 200 or not job:
            raise RuntimeError(f"/glasses/finished answered {code}: {job}")
        res |= job
    for c in clips:
        meta = _read_meta(c.dir)
        for b in meta.get("cloud", []):
            if b["recording_id"] == rid:
                b["job"] = res
        _write_meta(c.dir, meta)
    print(f"[cloud] recording {rid}: {'job ' + res['jobId'] + ' created; ' if 'jobId' in res else ''}finishing the raw backup upload")
    for n, c in enumerate(clips, 1):
        try:  # the job doesn't need these; a failure here is retried by the backup thread / next finish
            backup.sync(c.dir, rid)
            gaps_file = c.dir / "cloud" / f"{rid}_{n:02d}.gaps.json"
            if gaps_file.exists():
                backup.upload_file(rid, c.sid, gaps_file, "application/json")
        except Exception as e:
            print(f"[backup] {c.sid}: {e} (the local copy in {c.dir / 'raw'} is complete)")
    return res


def join_clips(parts: list[Path], out: Path) -> Path:
    """Glue clips built with the same settings into one MP4, without re-encoding."""
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                    "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(out)], check=True)
    listing.unlink(missing_ok=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("finish", help="upload a recording's clips and create its job")
    f.add_argument("session_dirs", type=Path, nargs="+", help="in clip order")
    f.add_argument("--recording", required=True, help="the Convex recordingId")
    f.add_argument("--sd", type=Path, action="append", default=[], help="SD copies, <sessionId>.bin")
    f.add_argument("--fps", type=int, default=CLOUD_FPS)
    f.add_argument("--auto-job", action="store_true", help="also create the recipe job (the old automatic path)")
    a = ap.parse_args()
    cloud_io.load_env(Path(__file__).resolve().parent.parent / ".env")
    env = os.environ
    clips = []
    for d in a.session_dirs:
        b = next((b for b in _read_meta(d).get("cloud", []) if b["recording_id"] == a.recording), {})
        clips.append(Clip(d.name, d, b.get("from_t", 0.0), b.get("to_t")))
    res = finish_recording(env["CONVEX_SITE_URL"], env["GLASSES_SECRET"], BackupUploader(env["GCS_UPLOAD_BUCKET"]),
                           a.recording, clips, a.fps, a.sd, auto_job=a.auto_job)
    print(res)


if __name__ == "__main__":
    main()
