"""Pretend to be the glasses, so the whole pipeline can be tested before the
parts arrive.

Streams numbered JPEG frames (a clock drawn on each), a 440 Hz tone with
speech-like bursts, step markers and a mode change to receiver.py over TCP,
drops the connection for a while to simulate a Wi-Fi gap, and writes the
complete SD-card copy so you can test backfill.

    python receiver.py &            # in another terminal
    python ../tools/fake_glasses.py --seconds 120 --gap 40:50
"""
from __future__ import annotations

import argparse
import io
import math
import random
import socket
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "receiver"))
from edg_protocol import END, EVENT, HELLO, JPEG, NO_SEQ, PCM, SAMPLE_RATE, Packet  # noqa: E402


def frame(t: float, size=(1280, 720)) -> bytes:
    img = Image.new("RGB", size, (40 + int(t) % 60, 60, 90))
    d = ImageDraw.Draw(img)
    d.text((40, 40), f"t = {t:7.2f} s", fill=(255, 255, 255))
    d.ellipse((size[0] // 2 - 100, size[1] // 2 - 100, size[0] // 2 + 100, size[1] // 2 + 100), outline=(255, 200, 0), width=6)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return buf.getvalue()


def make_session(seconds: float, markers: list[float], playback_from: float | None):
    sid = "%016x" % random.getrandbits(64)
    hello = Packet(HELLO, 0, NO_SEQ, 0, (
        '{"session_id":"%s","firmware":"fake-glasses","sensor":"FAKE","sample_rate":16000,"mode":"ai","sd":true}' % sid
    ).encode())
    items: list[Packet] = []
    mode = 0
    # events
    evs = [(0.0, "start")] + [(m, "marker") for m in markers]
    if playback_from is not None:
        evs.append((playback_from, "mode"))
    evs.append((seconds, "stop"))
    for t, name in evs:
        m = "playback" if (playback_from is not None and t >= playback_from) else "ai"
        items.append(Packet(EVENT, 1 if m == "playback" else 0, 0, int(t * 1000),
                            ('{"event":"%s","mode":"%s","dropped":0}' % (name, m)).encode()))
    # frames
    t = 0.0
    while t < seconds:
        pb = playback_from is not None and t >= playback_from
        items.append(Packet(JPEG, 1 if pb else 0, 0, int(t * 1000), frame(t, (640, 480) if pb else (1280, 720))))
        t += 0.1 if pb else 0.5
    # audio, 100 ms blocks
    n_blocks = int(seconds * 10)
    for b in range(n_blocks):
        tt = np.arange(1600) / SAMPLE_RATE + b * 0.1
        amp = 6000 if (int(b / 10) % 3) else 1500
        pcm = (amp * np.sin(2 * math.pi * 440 * tt)).astype("<i2").tobytes()
        items.append(Packet(PCM, 0, 0, int(b * 100), pcm))
    items.sort(key=lambda p: (p.t_ms, p.type))
    for i, p in enumerate(items):
        p.seq = i
    end = Packet(END, 0, NO_SEQ, int(seconds * 1000), b"")
    return sid, hello, items, end


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7070)
    ap.add_argument("--seconds", type=float, default=120)
    ap.add_argument("--gap", default="40:50", help="start:end seconds with Wi-Fi down ('' for none)")
    ap.add_argument("--markers", default="5,30,65,100")
    ap.add_argument("--playback-from", type=float, default=None, help="switch to 10 fps VGA at this time")
    ap.add_argument("--sd-out", type=Path, default=Path("fake_sd"))
    ap.add_argument("--realtime", type=float, default=0, help="speed factor, e.g. 10 = 10x real time; 0 = as fast as possible")
    args = ap.parse_args()

    markers = [float(x) for x in args.markers.split(",") if x]
    sid, hello, items, end = make_session(args.seconds, markers, args.playback_from)
    gap = tuple(float(x) for x in args.gap.split(":")) if args.gap else None

    args.sd_out.mkdir(parents=True, exist_ok=True)
    sd_path = args.sd_out / f"{sid}.bin"
    with open(sd_path, "wb") as f:
        f.write(hello.encode())
        for p in items:
            f.write(p.encode())
        f.write(end.encode())

    def connect():
        s = socket.create_connection((args.host, args.port))
        hello.t_ms = 0
        s.sendall(hello.encode())
        return s

    sock = connect()
    t_wall0 = time.time()
    for p in items:
        if args.realtime:
            delay = p.t / args.realtime - (time.time() - t_wall0)
            if delay > 0:
                time.sleep(delay)
        in_gap = gap and gap[0] <= p.t < gap[1]
        if in_gap:
            if sock:
                # Simulate a Wi-Fi drop mid-packet: send half a packet, then hang up.
                raw = p.encode()
                sock.sendall(raw[: len(raw) // 2])
                sock.close()
                sock = None
            continue
        if sock is None:
            sock = connect()
        sock.sendall(p.encode())
    sock.sendall(end.encode())
    sock.close()
    print(f"session {sid}: sent {len(items)} packets; SD copy at {sd_path}")


if __name__ == "__main__":
    main()
