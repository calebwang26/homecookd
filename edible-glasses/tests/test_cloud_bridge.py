"""--cloud end to end, without hardware, Google or Gemini:

    pip install -r requirements.txt pytest
    pytest -q tests/test_cloud_bridge.py

fake glasses (with a Wi-Fi gap) -> receiver.py --cloud -> a fake Convex, a fake GCS and a fake glasses VM.
Checks the pairing, the relay's records, the rolling backup, and that "I'm done" uploads the video built
from the backup and creates the job with the gaps. The live analysis is tested on its own with a stand-in
Gemini client.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
import struct
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "receiver"), str(ROOT / "pipeline")]
# session_builder reads these when first imported; match test_pipeline.py, which may run in the same process.
os.environ.setdefault("EDIBLE_CHUNK_SECONDS", "60")
os.environ.setdefault("EDIBLE_OVERLAP_SECONDS", "10")

import live_analysis  # noqa: E402
from live_analysis import LiveAnalyzer  # noqa: E402

SECRET = "glasses-secret-for-tests"


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Cloud:
    """Convex's /glasses/* routes and the GCS JSON upload API, on one local HTTP server."""

    def __init__(self) -> None:
        self.status = {"rec1": "intro"}  # the app is open; she hasn't pressed Start yet
        self.windows: list[dict] = []
        self.finished: list[dict] = []
        self.videos: list[dict] = []
        self.bucket_of: dict[str, str] = {}
        self.frames: list[tuple[str, bytes]] = []
        self.frame_queries: list[dict] = []
        self.objects: dict[str, bytes] = {}
        cloud = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _reply(self, code: int, body: dict | None = None, headers: dict | None = None) -> None:
                raw = json.dumps(body).encode() if body is not None else b""
                self.send_response(code)
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_POST(self):
                url = urlparse(self.path)
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                if url.path.startswith("/upload/storage/v1/b/"):
                    assert self.headers["Authorization"] == "Bearer test-token"
                    name = parse_qs(url.query)["name"][0]
                    cloud.bucket_of[name] = url.path.split("/b/", 1)[1].split("/", 1)[0]
                    if name in cloud.objects:
                        return self._reply(412, {"error": "exists"})
                    return self._reply(200, {}, {"Location": f"http://127.0.0.1:{cloud.port}/session/{name}"})
                assert self.headers["x-glasses-secret"] == SECRET
                if url.path == "/glasses/frame":
                    q = parse_qs(url.query)
                    cloud.frames.append((q["recordingId"][0], body))
                    cloud.frame_queries.append(q)
                    return self._reply(200, {"ok": True})
                req = json.loads(body or b"{}")
                if url.path == "/glasses/active":
                    rid = req.get("recordingId")
                    if rid:
                        return self._reply(200, {"recordingId": rid, "status": cloud.status[rid]})
                    live = [r for r, s in cloud.status.items() if s in ("intro", "recording", "wrapping_up")]
                    return self._reply(200, {"recordingId": live[-1], "status": cloud.status[live[-1]]}) if live \
                        else self._reply(204)
                if url.path == "/glasses/live-events":
                    cloud.windows.append(req)
                    return self._reply(200, {"events": len(req["events"])})
                if url.path == "/glasses/video":
                    cloud.videos.append(req)
                    return self._reply(200, {"ok": True})
                if url.path == "/glasses/finished":
                    cloud.finished.append(req)
                    return self._reply(200, {"jobId": "job1", "recipeId": "recipe1"})
                self._reply(404, {"error": "not found"})

            def do_PUT(self):
                name = urlparse(self.path).path.split("/session/", 1)[1]
                cloud.objects[name] = self.rfile.read(int(self.headers["Content-Length"]))
                self._reply(200, {})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


class FakeVM:
    """homecookd's glasses VM: a WebSocket at /ingest that keeps what it is sent."""

    def __init__(self) -> None:
        self.texts: list[dict] = []
        self.records: list[tuple[int, int, bytes]] = []
        self.port = free_port()
        self.path = ""
        ready = threading.Event()
        threading.Thread(target=lambda: asyncio.run(self._serve(ready)), daemon=True).start()
        ready.wait(5)

    async def _serve(self, ready: threading.Event) -> None:
        from websockets.asyncio.server import serve

        async def handle(ws):
            self.path = ws.request.path
            async for msg in ws:
                if isinstance(msg, str):
                    self.texts.append(json.loads(msg))
                else:
                    kind, dev_us, n = struct.unpack_from("<BQI", msg)
                    assert len(msg) == 13 + n
                    self.records.append((kind, dev_us, msg[13:]))

        async with serve(handle, "127.0.0.1", self.port):
            ready.set()
            await asyncio.Future()


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out)


def wait_for(cond, timeout: float = 60, what: str = "") -> None:
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {what}")


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("cloud")
    cloud, vm = Cloud(), FakeVM()
    env = {k: v for k, v in os.environ.items() if k != "GEMINI_API_KEY"} | {
        "CONVEX_SITE_URL": f"http://127.0.0.1:{cloud.port}", "GLASSES_SECRET": SECRET,
        "GCS_UPLOAD_BUCKET": "uploads", "GCS_MEDIA_BUCKET": "media", "GCS_ENDPOINT": f"http://127.0.0.1:{cloud.port}",
        "GOOGLE_ACCESS_TOKEN": "test-token", "GLASSES_URL": f"ws://127.0.0.1:{vm.port}",
        "GLASSES_DEVICE_KEY": "dev key", "EDIBLE_CHUNK_SECONDS": "60", "EDIBLE_OVERLAP_SECONDS": "10",
    }
    port = free_port()
    rx = subprocess.Popen([sys.executable, str(ROOT / "receiver/receiver.py"), "--out", str(tmp / "sessions"),
                           "--port", str(port), "--live-port", str(free_port()), "--no-discovery", "--no-build",
                           "--cloud", "--cook", "Ammi"],
                          env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines: list[str] = []
    threading.Thread(target=lambda: lines.extend(rx.stdout), daemon=True).start()
    try:
        wait_for(lambda: vm.texts, 15, "the relay to connect")
        # The glasses stream 90 s at 10x speed: she presses Start about 25 s in and Stop about 60 s in.
        glasses = subprocess.Popen([sys.executable, str(ROOT / "tools/fake_glasses.py"), "--port", str(port),
                                    "--seconds", "90", "--gap", "40:50", "--playback-from", "70", "--sd-out",
                                    str(tmp / "sd"), "--markers", "5,30", "--realtime", "10"],
                                   env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.time()
        time.sleep(max(0.0, 2.5 - (time.time() - t0)))
        cloud.status["rec1"] = "recording"  # Start
        sdir = next((tmp / "sessions").glob("*"))
        wait_for(lambda: json.loads((sdir / "meta.json").read_text()).get("cloud"), 15, "pairing")
        wait_for(lambda: cloud.frames, 15, "a frame for the phone")
        # No cloud backup while she cooks (it would compete with the glasses for the hotspot).
        assert not any(k.startswith("glasses-backup/") for k in cloud.objects)
        time.sleep(max(0.0, 6.0 - (time.time() - t0)))
        cloud.status["rec1"] = "ended"  # Stop
        glasses.wait(30)
        wait_for(lambda: cloud.videos, 120, "the saved video")
        wait_for(lambda: any(k.startswith("glasses-backup/rec1/") and ".bin." in k for k in cloud.objects), 60, "the backup, after")
    except AssertionError:
        print("".join(lines))
        raise
    finally:
        rx.terminate()
    return SimpleNamespace(dir=sdir, cloud=cloud, vm=vm, tmp=tmp, log="".join(lines))


def test_pairs_with_the_live_recording(run):
    meta = json.loads((run.dir / "meta.json").read_text())
    b = meta["cloud"][0]
    assert b["recording_id"] == "rec1" and 20 <= b["from_t"] <= 35  # where she pressed Start, not 0
    assert meta["cloud"][0]["job"] == {"videoUrl": "https://storage.googleapis.com/media/glasses-rec1/full.mp4"}
    assert isinstance(meta["started_at_ms"], int)


def test_relay_sends_the_vm_format_thinned(run):
    vm = run.vm
    assert vm.path == "/ingest?device=dev%20key"
    assert vm.texts[0]["type"] == "hello" and vm.texts[0]["fw"].startswith("edible-glasses-bridge")
    frames = [(t, p) for k, t, p in vm.records if k == 1]
    audio = [(t, p) for k, t, p in vm.records if k == 2]
    assert frames and audio
    assert all(p[:2] == b"\xff\xd8" for _, p in frames)
    assert all(len(p) == 3200 for _, p in audio)
    times = sorted(t for t, _ in frames)
    assert min(b - a for a, b in zip(times, times[1:])) >= 125_000  # 10 fps playback thinned to <= 8 fps


def test_phone_gets_the_newest_frame(run):
    rid, jpeg = run.cloud.frames[-1]
    assert rid == "rec1" and jpeg[:2] == b"\xff\xd8"
    from io import BytesIO
    from PIL import Image
    assert Image.open(BytesIO(jpeg)).width == 320  # shrunk for the phone, so it costs the hotspot little
    # The glasses stopped sending, so the same frame isn't sent again and again.
    assert len(run.cloud.frames) == len({f for _, f in run.cloud.frames})
    q = run.cloud.frame_queries[-1]
    assert q["session"] == [run.dir.name] and int(q["t"][0]) > 0  # so Convex can drop a late, older frame


def test_nothing_from_before_start_is_stored(run):
    """She pressed Start ~25 s in: the laptop kept no frame or sound from before that, on disk or anywhere."""
    from edg_protocol import JPEG, PCM, read_packet_file
    from_t = json.loads((run.dir / "meta.json").read_text())["cloud"][0]["from_t"]
    stored = [p for f in (run.dir / "raw").glob("*.bin") for p in read_packet_file(f) if p.type in (JPEG, PCM)]
    assert stored and min(p.t for p in stored) >= from_t - 1.5
    assert max(p.t for p in stored) <= 75  # and nothing after Stop (~60 s; Convex is asked every second)


def test_backup_in_gcs_is_the_raw_file(run):
    parts = sorted((k, v) for k, v in run.cloud.objects.items() if k.startswith(f"glasses-backup/rec1/{run.dir.name}/raw/"))
    joined = b"".join(v for _, v in sorted(parts, key=lambda kv: int(kv[0].rsplit(".", 1)[1])))
    raw = next((run.dir / "raw").glob("*.bin")).read_bytes()
    # The cloud copy is the local file as of the finish; only the glasses' end packet can land after it.
    from edg_protocol import JPEG, PCM, iter_packets
    assert joined and raw.startswith(joined)
    assert not [p for p in iter_packets(raw[len(joined):]) if p.type in (JPEG, PCM)]
    assert f"glasses-backup/rec1/{run.dir.name}/rec1_01.gaps.json" in run.cloud.objects
    # Nothing but the video under the folder the pipeline worker downloads.
    # Nothing in the uploads folder the worker reads (no job by default): the video is in the media bucket.
    assert [k for k in run.cloud.objects if k.startswith("glasses-rec1/")] == ["glasses-rec1/full.mp4"]
    assert run.cloud.bucket_of["glasses-rec1/full.mp4"] == "media"


def test_done_saves_the_full_video_for_the_phone_without_a_job(run, tmp_path):
    assert run.cloud.finished == []  # she sends it through the app herself
    assert run.cloud.videos == [{"recordingId": "rec1", "videoUrl": "https://storage.googleapis.com/media/glasses-rec1/full.mp4"}]
    gaps = json.loads((run.dir / "cloud" / "rec1_01.gaps.json").read_text())
    assert len(gaps) == 1 and 39 <= gaps[0]["start_s"] <= 40.5 and gaps[0]["end_s"] == 50
    mp4 = tmp_path / "full.mp4"
    mp4.write_bytes(run.cloud.objects["glasses-rec1/full.mp4"])
    meta = json.loads((run.dir / "meta.json").read_text())["cloud"][0]
    assert abs(probe_duration(mp4) - (meta["to_t"] - meta["from_t"])) < 1.5  # Start to Stop, nothing else
    assert 20 <= probe_duration(mp4) <= 45
    rate = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
                           "-of", "csv=p=0", str(mp4)], capture_output=True, text=True, check=True).stdout.strip()
    assert rate == "15/1"  # the kid watches this one: smooth, not the 2 fps the AI chunks use


def test_auto_job_still_makes_the_job(run, monkeypatch):
    """--auto-job: the old path, clips to the uploads bucket and /glasses/finished with the gaps."""
    import cloud_bridge
    from backup_upload import BackupUploader
    for k, v in {"GCS_ENDPOINT": f"http://127.0.0.1:{run.cloud.port}", "GOOGLE_ACCESS_TOKEN": "test-token"}.items():
        monkeypatch.setenv(k, v)
    site = f"http://127.0.0.1:{run.cloud.port}"
    res = cloud_bridge.finish_recording(site, SECRET, BackupUploader("uploads"), "rec2",
                                        [cloud_bridge.Clip(run.dir.name, run.dir, 30.0, 60.0)], auto_job=True,
                                        media_bucket="media")
    assert res["jobId"] == "job1" and res["videoUrl"].endswith("/glasses-rec2/full.mp4")
    assert run.cloud.bucket_of["glasses-rec2/01.mp4"] == "uploads"
    body = run.cloud.finished[-1]
    assert body["uploadPath"] == "glasses-rec2/" and abs(body["durationS"] - 30) < 1
    [gap] = body["videoGaps"]
    assert 9 <= gap["startS"] <= 10.5 and gap["endS"] == 20  # 40-50 s in the session, 30 s into the clip


# ---- the live analysis, with a stand-in Gemini ----

class FakeGemini:
    def __init__(self, fail_calls=()):
        self.calls = 0
        self.fail_calls = set(fail_calls)
        self.prompts: list[str] = []
        self.interactions = SimpleNamespace(create=self._create)

    def _create(self, model, input, response_format):
        self.calls += 1
        assert input[0]["type"] == "video" and input[0]["mime_type"] == "video/mp4" and input[0]["data"]
        self.prompts.append(input[1]["text"])
        if self.calls in self.fail_calls:
            raise RuntimeError("503 overloaded")
        step = lambda a, b, t: {"start": a, "end": b, "title": t, "instruction": t + ".", "ingredients": [],  # noqa: E731
                                "doneness_cue": "", "quote_original": "", "quote_english": "", "story": "",
                                "confidence": 0.9}
        steps = [step("00:02", "00:04", f"in overlap {self.calls}"), step("00:10", "00:20", f"step {self.calls}")]
        if self.calls == 1:
            steps[1]["ingredients"] = [{"name": "salt", "said_as": "thoda sa", "estimated_amount": "~1 tsp", "at": "00:12"}]
            steps[1]["quote_original"] = "bas itna"
        return SimpleNamespace(output_text=json.dumps({"dish_guess": "", "steps": steps, "notes": ""}))


def feed(an: LiveAnalyzer, sid: str, seconds: float, gap=None) -> None:
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (90, 60, 40)).save(buf, "JPEG")
    jpeg = buf.getvalue()
    pcm = (1000 * np.sin(np.arange(1600) / 5)).astype("<i2").tobytes()
    for i in range(int(seconds * 10)):
        t = i / 10
        if gap and gap[0] <= t < gap[1]:
            continue
        if i % 5 == 0:
            an.frame(sid, jpeg, t)
        an.audio(sid, pcm, t)


@pytest.fixture
def no_backlog(monkeypatch):
    monkeypatch.setattr(live_analysis, "MAX_IN_FLIGHT", 99)  # the feed below is instant; Gemini isn't


def test_live_windows_overlap_and_skip_repeats(no_backlog):
    posted: list[dict] = []
    gem = FakeGemini()
    an = LiveAnalyzer(posted.append, "gemini-test", client=gem)
    an.start("s1", {"cook_name": "Ammi", "spoken_languages": ["Urdu"]}, 1_700_000_000_000)
    an.marker("s1", 3.0)
    feed(an, "s1", 70)
    an.flush("s1")
    assert [(w["windowStartS"], w["windowEndS"], w["ok"]) for w in posted] == [(0, 30, True), (25, 55, True),
                                                                             (50, 69.9, True)]
    first = posted[0]["events"]
    assert first[0] == {"kind": "marker", "atS": 3.0, "title": "step marker", "text": "", "confidence": 1.0}
    assert [e["kind"] for e in first] == ["marker", "step", "step", "ingredient", "quote"]
    assert first[3] == {"kind": "ingredient", "atS": 12.0, "title": "salt", "text": "~1 tsp", "saidAs": "thoda sa",
                        "confidence": 0.9}
    # Later windows: the step in the first 5 s was the previous window's; only the new one is kept.
    assert [(e["title"], e["atS"]) for e in posted[1]["events"]] == [("step 2", 35.0)]
    assert all(w["sessionId"] == "s1" and w["sessionStartedAt"] == 1_700_000_000_000 for w in posted)
    assert "Steps already reported earlier in this session" in gem.prompts[1] and "step 1" in gem.prompts[1]
    assert "Urdu" in gem.prompts[0]


def test_live_failures_and_gaps_are_posted_as_holes(no_backlog):
    posted: list[dict] = []
    an = LiveAnalyzer(posted.append, "gemini-test", client=FakeGemini(fail_calls={2}))
    an.start("s1", {}, 1)
    feed(an, "s1", 130, gap=(55, 110))
    an.flush("s1")
    by_start = {w["windowStartS"]: w for w in posted}
    assert by_start[25]["ok"] is False and "503" in by_start[25]["reason"]
    assert by_start[75]["ok"] is False and by_start[75]["reason"] == "no footage"
    # After a failed or empty window, a step in the overlap is kept: nobody else reported it.
    assert ("in overlap 3", 52.0) in [(e["title"], e["atS"]) for e in by_start[50]["events"]]
    assert ("in overlap 4", 102.0) in [(e["title"], e["atS"]) for e in by_start[100]["events"]]
