"""[A] Live copy to homecookd's glasses VM: re-sends what the glasses stream here as the VM's own
WebSocket format (homecookd glasses/INGEST.md), so homie's /frame/latest and the VM's recording work
as if the glasses talked to the VM directly.

Each binary message: kind u8 (1 JPEG, 2 PCM) | device time in µs u64 LE | length u32 LE | payload.
Device time is the glasses' session clock (t_ms * 1000), the same clock for frames and audio.

Best effort by design: frames are thinned to --relay-fps (AI mode sends ~23 fps, too much for a phone
hotspot's uplink), the queue drops its oldest message when the uplink falls behind, and nothing is
resent after a reconnect (the VM would drop it as late anyway). The full copy is the backup.
"""
from __future__ import annotations

import asyncio
import json
import struct
from urllib.parse import quote

from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

HEADER = struct.Struct("<BQI")  # 13 bytes
KIND_JPEG, KIND_PCM = 1, 2
QUEUE = 64
BACKOFF_MAX_S = 10
HELLO_FW = "edible-glasses-bridge 0.1"  # the VM gives a bridged recording time for the laptop's full upload


def record(kind: int, t_ms: int, payload: bytes) -> bytes:
    return HEADER.pack(kind, t_ms * 1000, len(payload)) + payload


class Relay:
    def __init__(self, url: str, device_key: str, fps: float) -> None:
        self.url = f"{url.rstrip('/')}/ingest?device={quote(device_key)}"
        self.min_gap_ms = int(1000 / fps) if fps > 0 else 0
        self.queue: asyncio.Queue[bytes] = asyncio.Queue(QUEUE)
        self.last_frame_ms = -10**9
        self.size = (640, 480)
        self.fps = fps
        self.sent = 0
        self.dropped = 0
        self.connected = False

    # ---- fed from the receiver's loop; never blocks ----

    def frame(self, jpeg: bytes, t_ms: int) -> None:
        if t_ms < self.last_frame_ms:  # a new glasses session restarted the clock
            self.last_frame_ms = -10**9
        if t_ms - self.last_frame_ms < self.min_gap_ms:
            return
        self.last_frame_ms = t_ms
        self._put(record(KIND_JPEG, t_ms, jpeg))

    def audio(self, pcm: bytes, t_ms: int) -> None:
        self._put(record(KIND_PCM, t_ms, pcm))

    def _put(self, msg: bytes) -> None:
        if not self.connected:
            return  # nothing to keep: the VM only wants live data
        if self.queue.full():
            self.queue.get_nowait()
            self.dropped += 1
        self.queue.put_nowait(msg)

    # ---- the connection ----

    async def run(self) -> None:
        backoff = 1.0
        while True:
            try:
                async with connect(self.url, max_size=2 ** 21, ping_interval=15, open_timeout=10) as ws:
                    await ws.send(json.dumps({"type": "hello", "fw": HELLO_FW, "w": self.size[0],
                                              "h": self.size[1], "fps": self.fps}))
                    self.connected, backoff = True, 1.0
                    print(f"[relay] connected to {self.url.split('?')[0]}")
                    sender = asyncio.create_task(self._send(ws))
                    try:
                        async for msg in ws:  # ready / recording / stopped: just for the log
                            if isinstance(msg, str):
                                print(f"[relay] VM: {msg}")
                    finally:
                        sender.cancel()
            except (OSError, WebSocketException, asyncio.TimeoutError) as e:
                if self.connected:
                    print(f"[relay] lost the VM ({type(e).__name__}); reconnecting")
            self.connected = False
            while not self.queue.empty():
                self.queue.get_nowait()
            await asyncio.sleep(backoff)
            backoff = min(BACKOFF_MAX_S, backoff * 2)

    async def _send(self, ws) -> None:
        while True:
            msg = await self.queue.get()
            await ws.send(msg)
            self.sent += 1
