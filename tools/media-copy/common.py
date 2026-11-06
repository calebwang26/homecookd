"""What every part of the media copy shares: the object shape, the errors, retries, checksums and logging.

Logs carry a salted id in place of an object's key. A key can hold a slug of the title a cook typed (the signer names a job
"<title slug>-<6 hex>"), so a key can hold a family's name.
"""
from __future__ import annotations

import base64
import json
import random
import struct
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

T = TypeVar("T")

EXIT_OK, EXIT_FAILED, EXIT_REFUSED, EXIT_DENIED = 0, 1, 2, 3

META_GENERATION = "gcs-generation"  # on every S3 copy: this tag is how a copy is told from a file someone else wrote
META_METAGENERATION = "gcs-metageneration"
META_CRC = "gcs-crc32c"
META_MD5 = "gcs-md5"
META_REWRITTEN = "links-rewritten"


@dataclass(frozen=True)
class GcsObject:
    key: str
    size: int
    generation: int
    metageneration: int
    crc32c: str  # base64, big-endian, as both GCS and S3 write it
    md5: str | None = None  # None on a composite object
    content_type: str | None = None
    cache_control: str | None = None
    content_encoding: str | None = None
    content_disposition: str | None = None
    content_language: str | None = None

    def headers(self) -> dict[str, str]:
        return {k: v for k, v in (("content_type", self.content_type), ("cache_control", self.cache_control),
                                  ("content_encoding", self.content_encoding),
                                  ("content_disposition", self.content_disposition),
                                  ("content_language", self.content_language)) if v}


@dataclass(frozen=True)
class S3Head:
    size: int
    crc32c: str | None
    meta: dict[str, str]
    version_id: str | None
    headers: dict[str, str]


class Refused(Exception):
    """The tool won't do this. The message is for the operator and holds no key."""


class SourceGone(Exception):
    """The GCS object isn't there, or isn't the generation that was listed."""


class Denied(Exception):
    """A permissions failure. Retrying won't help, so the pass stops. Names the operation and bucket, never a key."""

    def __init__(self, op: str, bucket: str):
        super().__init__(f"{op} was denied on {bucket}")
        self.op, self.bucket = op, bucket


class Transient(Exception):
    """A timeout, a throttle or a 5xx: worth retrying."""


class BadChecksum(Exception):
    """The bytes don't match the checksum they should have."""


def with_retries(fn: Callable[[], T], attempts: int = 5, base_s: float = 0.5, cap_s: float = 30.0,
                 sleep: Callable[[float], None] = time.sleep) -> T:
    """Retries only Transient, with backoff and jitter, then lets it go up."""
    for i in range(attempts):
        try:
            return fn()
        except Transient:
            if i == attempts - 1:
                raise
            sleep(min(cap_s, base_s * 2 ** i) * random.uniform(0.5, 1.0))
    raise AssertionError("unreachable")


# ---------- CRC32C ----------

try:
    import google_crc32c as _fast
    FAST_CRC = _fast.implementation == "c"
except ImportError:
    _fast = None
    FAST_CRC = False

_TABLE: list[int] = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ 0x82F63B78 if _c & 1 else _c >> 1
    _TABLE.append(_c)


class Crc:
    """Running CRC32C, base64 big-endian. The pure Python path is far too slow for a real run; the CLI refuses it there."""

    def __init__(self) -> None:
        self._c = _fast.Checksum() if _fast else None
        self._v = 0xFFFFFFFF

    def update(self, data: bytes) -> "Crc":
        if self._c is not None:
            self._c.update(data)
        else:
            v = self._v
            for b in data:
                v = (v >> 8) ^ _TABLE[(v ^ b) & 0xFF]
            self._v = v
        return self

    def b64(self) -> str:
        raw = self._c.digest() if self._c is not None else struct.pack(">I", self._v ^ 0xFFFFFFFF)
        return base64.b64encode(raw).decode()


def crc32c(data: bytes) -> str:
    return Crc().update(data).b64()


# ---------- logs ----------

class Log:
    """One JSON object per line. There's no way to pass a key: an operator maps an id back through the ledger."""

    FORBIDDEN = {"key", "keys", "url", "name", "title", "body", "message"}

    def __init__(self, stream=None, clock: Callable[[], float] = time.time):
        self.stream = stream or sys.stderr
        self.clock = clock
        self._lock = threading.Lock()

    def event(self, event: str, **fields) -> None:
        bad = self.FORBIDDEN & fields.keys()
        if bad:
            raise ValueError(f"log fields not allowed: {sorted(bad)}")
        line = json.dumps({"t": round(self.clock(), 3), "event": event, **fields}, sort_keys=True)
        with self._lock:
            print(line, file=self.stream, flush=True)
