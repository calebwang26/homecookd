"""Pretend to be the glasses: replay any video as JPEG frames + 16 kHz PCM in the INGEST.md format.

    python fake_glasses.py <video.mp4> [--url ws://localhost:8090] [--fps 8] [--fast] [--drop-at 3]

The device key comes from GLASSES_DEVICE_KEY (or --device). --fast sends everything at once (the device
timestamps still say real time). --drop-at S hangs up at S seconds and reconnects, like flaky Wi-Fi.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from websockets.asyncio.client import ClientConnection, connect

BOOT_US = 7_000_000  # the glasses have been on for 7 s when the video starts
CHUNK = 3200  # 100 ms of 16 kHz s16le


def decode(video: str, fps: float, out: Path) -> tuple[list[Path], bytes]:
    subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={fps},scale=640:-2", "-q:v", "6",
                    str(out / "%06d.jpg")], check=True)
    frames = sorted(out.glob("*.jpg"))
    pcm = out / "audio.pcm"
    got = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le",
                          str(pcm)])
    audio = pcm.read_bytes() if got.returncode == 0 and pcm.exists() else b""
    return frames, audio or bytes(int(len(frames) / fps * 32_000) // 2 * 2)


def record(kind: int, t_s: float, payload: bytes) -> bytes:
    return bytes([kind]) + int(BOOT_US + t_s * 1e6).to_bytes(8, "little") + len(payload).to_bytes(4, "little") + payload


async def listen(ws: ClientConnection) -> None:
    async for msg in ws:
        print("vm:", msg, flush=True)


async def stream(args: argparse.Namespace) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        frames, audio = decode(args.video, args.fps, Path(tmp))
        events = [(i / args.fps, 1, f.read_bytes()) for i, f in enumerate(frames)]
        events += [(j * CHUNK / 32_000, 2, audio[j * CHUNK:(j + 1) * CHUNK]) for j in range(len(audio) // CHUNK)]
    events.sort(key=lambda e: (e[0], e[1]))
    print(f"{len(frames)} frames, {len(audio) / 32_000:.1f} s of audio", flush=True)

    url = f"{args.url.rstrip('/')}/ingest?device={args.device}"
    hello = json.dumps({"type": "hello", "fw": "fake-1", "w": 640, "h": 480, "fps": args.fps})
    dropped = args.drop_at is None
    start = time.monotonic()
    i = 0
    while i < len(events):
        async with connect(url, max_size=2 ** 21) as ws:
            listener = asyncio.create_task(listen(ws))
            await ws.send(hello)
            while i < len(events):
                t, kind, payload = events[i]
                if not dropped and t >= args.drop_at:
                    dropped = True
                    print(f"dropping the connection at {t:.1f} s", flush=True)
                    break
                if not args.fast:
                    await asyncio.sleep(max(0.0, start + t - time.monotonic()))
                await ws.send(record(kind, t, payload))
                i += 1
            await asyncio.sleep(0.3)  # let the VM's last text messages arrive
            listener.cancel()
        if i < len(events):
            await asyncio.sleep(1)
    print("done", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video")
    p.add_argument("--url", default="ws://localhost:8090")
    p.add_argument("--device", default=os.environ.get("GLASSES_DEVICE_KEY", ""))
    p.add_argument("--fps", type=float, default=8)
    p.add_argument("--fast", action="store_true")
    p.add_argument("--drop-at", type=float)
    asyncio.run(stream(p.parse_args()))
