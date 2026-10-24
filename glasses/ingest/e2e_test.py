"""Local end-to-end test, no cloud: convex_stub.py + server.py --dry-upload + fake_glasses.py --fast.

    python glasses/ingest/e2e_test.py

Streams a 6 s test video (with one dropped connection), ends the recording in the stub and checks that the
MP4 has H.264 video and AAC audio of the right length, that /glasses/finished got the right body, and that the
frames and audio are deleted afterwards (--dry-upload keeps out.mp4).
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SECRET, DEVICE, REC = "e2e-secret", "e2e-device", "e2erec1"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


STUB, VM = free_port(), free_port()


def get(url: str, headers: dict | None = None) -> tuple[int, bytes, str]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=5) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), ""


def wait(what: str, check, timeout: float = 30) -> None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            if check():
                return
        except OSError:
            pass
        time.sleep(0.3)
    raise SystemExit(f"FAIL: timed out waiting for {what}")


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="glasses-e2e-"))
    video = tmp / "sample.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=10",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "6",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(video)], check=True)
    env = {**os.environ, "GLASSES_SECRET": SECRET, "GLASSES_DEVICE_KEY": DEVICE,
           "CONVEX_SITE_URL": f"http://127.0.0.1:{STUB}"}
    py = sys.executable
    procs = [
        subprocess.Popen([py, str(HERE / "convex_stub.py"), "--port", str(STUB), "--recording", REC], env=env),
        subprocess.Popen([py, str(HERE / "server.py"), "--port", str(VM), "--dir", str(tmp / "glasses"),
                          "--dry-upload"], env=env),
    ]
    try:
        base = f"http://127.0.0.1:{VM}"
        health = f"{base}/health"
        wait("the VM to pick up the recording",
             lambda: json.loads(get(health, {"x-glasses-secret": SECRET})[1])["recording"] == REC)
        assert json.loads(get(health)[1]) == {"ok": True, "glasses": 0}, "/health without the secret says more"
        assert get(f"{base}/ingest?device=wrong")[0] == 401, "wrong device key should be refused"
        assert get(f"{base}/frame/latest?recording={REC}")[0] == 401, "/frame/latest needs the secret"

        subprocess.run([py, str(HERE / "fake_glasses.py"), str(video), "--url", f"ws://127.0.0.1:{VM}",
                        "--fast", "--drop-at", "3"], env=env, check=True)
        code, jpeg, kind = get(f"{base}/frame/latest?recording={REC}", {"x-glasses-secret": SECRET})
        assert code == 200 and kind == "image/jpeg" and jpeg[:2] == b"\xff\xd8", f"/frame/latest gave {code} {kind}"
        assert get(f"{base}/frame/latest?recording=other", {"x-glasses-secret": SECRET})[0] == 404

        urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{STUB}/_status", method="POST",
                                                      data=json.dumps({"status": "ended"}).encode()), timeout=5)
        wait("/glasses/finished", lambda: json.loads(get(f"http://127.0.0.1:{STUB}/_finished")[1]), timeout=90)
        body = json.loads(get(f"http://127.0.0.1:{STUB}/_finished")[1])[0]
        folder = tmp / "glasses" / REC
        wait("the VM to mark it finished", lambda: "finished" in json.loads((folder / "meta.json").read_text()))
        left = sorted(p.name for p in folder.iterdir())
        assert left == ["meta.json", "out.mp4"], f"the media should be gone, but the folder has {left}"

        mp4 = folder / "out.mp4"
        probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                           "stream=codec_type,codec_name,duration,r_frame_rate", "-of", "json",
                                           str(mp4)], check=True, capture_output=True, text=True).stdout)
        streams = {s["codec_type"]: s for s in probe["streams"]}
        print(json.dumps({"finished": body, "streams": probe["streams"]}, indent=1))
        assert streams["video"]["codec_name"] == "h264" and streams["video"]["r_frame_rate"] == "15/1"
        assert streams["audio"]["codec_name"] == "aac"
        for kind in ("video", "audio"):
            assert abs(float(streams[kind]["duration"]) - 6) < 0.3, f"{kind} lasts {streams[kind]['duration']} s"
        assert body["uploadPath"] == f"glasses-{REC}/" and abs(body["durationS"] - 6) < 0.3
        assert abs(body["videoStartedAt"] - time.time() * 1000) < 120_000
        meta = json.loads((folder / "meta.json").read_text())
        assert meta["finished"] == {"jobId": "stubjob1", "recipeId": "stubrecipe1"}
        print(f"PASS ({tmp})")
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    main()
