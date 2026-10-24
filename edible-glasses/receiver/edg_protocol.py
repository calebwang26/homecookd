"""Packet format shared with the glasses firmware (glasses.cpp).

Every packet: 20-byte little-endian header + payload.
    magic "EDG1" | type u8 | mode u8 | reserved u16 | seq u32 | t_ms u32 | len u32
t_ms is milliseconds since the session started, on the glasses' own clock.
seq numbers frames, audio and events in one sequence; HELLO and END use 0xFFFFFFFF.
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from typing import BinaryIO, Iterator

MAGIC = b"EDG1"
HEADER = struct.Struct("<4sBBHIII")
HEADER_SIZE = HEADER.size  # 20
NO_SEQ = 0xFFFFFFFF
MAX_PAYLOAD = 4 * 1024 * 1024  # anything bigger is corruption

HELLO, JPEG, PCM, EVENT, END = 1, 2, 3, 4, 5
TYPE_NAMES = {HELLO: "hello", JPEG: "jpeg", PCM: "pcm", EVENT: "event", END: "end"}
MODES = {0: "ai", 1: "playback", 2: "simmer"}
SAMPLE_RATE = 16000


@dataclass
class Packet:
    type: int
    mode: int
    seq: int
    t_ms: int
    payload: bytes

    @property
    def t(self) -> float:
        return self.t_ms / 1000.0

    def json(self) -> dict:
        return json.loads(self.payload.decode("utf-8"))

    def encode(self) -> bytes:
        return HEADER.pack(MAGIC, self.type, self.mode, 0, self.seq, self.t_ms, len(self.payload)) + self.payload


def iter_packets(data: bytes) -> Iterator[Packet]:
    """Parse packets from a byte buffer.

    Resyncs on the magic if it hits garbage, and silently drops a truncated
    final packet (what a dropped Wi-Fi connection leaves behind).
    """
    i, n = 0, len(data)
    while i + HEADER_SIZE <= n:
        if data[i:i + 4] != MAGIC:
            j = data.find(MAGIC, i + 1)
            if j < 0:
                return
            i = j
            continue
        _, typ, mode, _, seq, t_ms, length = HEADER.unpack_from(data, i)
        if typ not in TYPE_NAMES or length > MAX_PAYLOAD:
            i += 1
            continue
        end = i + HEADER_SIZE + length
        if end > n:
            return  # truncated tail
        yield Packet(typ, mode, seq, t_ms, data[i + HEADER_SIZE:end])
        i = end


def read_packet_file(path) -> list[Packet]:
    with open(path, "rb") as f:
        return list(iter_packets(f.read()))


class StreamParser:
    """Incremental parser for a live TCP stream."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def feed(self, chunk: bytes) -> list[Packet]:
        self.buf += chunk
        out: list[Packet] = []
        consumed = 0
        data = bytes(self.buf)
        i, n = 0, len(data)
        while i + HEADER_SIZE <= n:
            if data[i:i + 4] != MAGIC:
                j = data.find(MAGIC, i + 1)
                i = j if j >= 0 else max(i + 1, n - 3)
                consumed = i
                continue
            _, typ, mode, _, seq, t_ms, length = HEADER.unpack_from(data, i)
            if typ not in TYPE_NAMES or length > MAX_PAYLOAD:
                i += 1
                consumed = i
                continue
            end = i + HEADER_SIZE + length
            if end > n:
                break
            out.append(Packet(typ, mode, seq, t_ms, data[i + HEADER_SIZE:end]))
            i = consumed = end
        del self.buf[:consumed]
        return out


def write_packet(f: BinaryIO, p: Packet) -> None:
    f.write(p.encode())


# ---------- UDP transport (firmware TRANSPORT_UDP 1) ----------
# Each packet is split into datagrams:
#   "EDU1" | type u8 | mode u8 | frag u16 | frags u16 | reserved u16 |
#   session 8 bytes | seq u32 | t_ms u32 | total_len u32 | data
UDP_MAGIC = b"EDU1"
UDP_HEADER = struct.Struct("<4sBBHHH8sIII")


class Reassembler:
    """Turns UDP fragments back into Packets. Incomplete packets expire."""

    def __init__(self, ttl: float = 2.0) -> None:
        import time as _t
        self._time = _t.monotonic
        self.ttl = ttl
        self.partial: dict[tuple, dict] = {}
        self.done_keys: dict[tuple, float] = {}
        self.completed = 0
        self.expired = 0

    def feed(self, datagram: bytes) -> tuple[str, Packet] | None:
        if len(datagram) < UDP_HEADER.size or datagram[:4] != UDP_MAGIC:
            return None
        _, typ, mode, frag, frags, _, sess, seq, t_ms, total = UDP_HEADER.unpack_from(datagram)
        if typ not in TYPE_NAMES or frags == 0 or frag >= frags or total > MAX_PAYLOAD:
            return None
        sid = sess.hex()
        # HELLOs are repeated every second with the same seq: key them by time too.
        key = (sid, seq, typ, t_ms) if seq == NO_SEQ else (sid, seq)
        now = self._time()
        self._expire(now)
        if key in self.done_keys:
            return None  # duplicate (events and END are sent 3 times)
        data = datagram[UDP_HEADER.size:]
        if frags == 1:
            payload = data[:total]
        else:
            entry = self.partial.setdefault(key, {"t": now, "frags": {}, "n": frags})
            entry["frags"][frag] = data
            if len(entry["frags"]) < frags:
                return None
            payload = b"".join(entry["frags"][i] for i in range(frags))[:total]
            del self.partial[key]
        if len(payload) != total:
            return None
        self.done_keys[key] = now
        self.completed += 1
        return sid, Packet(typ, mode, seq, t_ms, payload)

    def _expire(self, now: float) -> None:
        for k in [k for k, e in self.partial.items() if now - e["t"] > self.ttl]:
            del self.partial[k]
            self.expired += 1
        if len(self.done_keys) > 5000:
            for k in [k for k, t in self.done_keys.items() if now - t > 30]:
                del self.done_keys[k]