"""Fake GCS and S3 for the tests, the same shape as stores.py. Nothing here touches a network. Hooks let a test step in at an exact
moment, such as deleting a file while it's being copied."""
from __future__ import annotations

import base64
import hashlib
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from common import BadChecksum, Denied, GcsObject, S3Head, SourceGone, Transient, crc32c


class Faults:
    """deny: operations answered 403. transient[op]: how many calls fail first. hooks[op]: (key, fn) run once, before that call."""

    def __init__(self) -> None:
        self.deny: set[str] = set()
        self.transient: Counter[str] = Counter()
        self.hooks: dict[str, list] = defaultdict(list)
        self.calls: Counter[str] = Counter()

    def hit(self, op: str, bucket: str, key: str | None = None) -> None:
        self.calls[op] += 1
        for pair in list(self.hooks[op]):
            if pair[0] is None or pair[0] == key:
                self.hooks[op].remove(pair)
                pair[1]()
        if op in self.deny:
            raise Denied(op, bucket)
        if self.transient[op] > 0:
            self.transient[op] -= 1
            raise Transient(op)

    def before(self, op: str, key: str | None, fn) -> None:
        self.hooks[op].append((key, fn))


@dataclass
class _Blob:
    data: bytes
    generation: int
    metageneration: int = 1
    headers: dict = field(default_factory=dict)


class FakeGcs:
    def __init__(self) -> None:
        self.buckets: dict[str, dict[str, _Blob]] = defaultdict(dict)
        self.faults = Faults()
        self._generation = 1000
        self.corrupt_reads: set[str] = set()
        self.bytes_read = 0

    def put(self, bucket: str, key: str, data: bytes, **headers) -> int:
        self._generation += 1
        self.buckets[bucket][key] = _Blob(data, self._generation, 1, headers)
        return self._generation

    def delete(self, bucket: str, key: str) -> None:
        del self.buckets[bucket][key]

    def _obj(self, key: str, b: _Blob) -> GcsObject:
        return GcsObject(key, len(b.data), b.generation, b.metageneration, crc32c(b.data),
                         base64.b64encode(hashlib.md5(b.data).digest()).decode(), **b.headers)

    def list(self, bucket: str, prefix: str = ""):
        self.faults.hit("list", bucket)
        return [self._obj(k, b) for k, b in sorted(self.buckets[bucket].items()) if k.startswith(prefix)]

    def head(self, bucket: str, key: str) -> GcsObject | None:
        self.faults.hit("head", bucket, key)
        b = self.buckets[bucket].get(key)
        return self._obj(key, b) if b else None

    def read(self, bucket: str, key: str, generation: int, start: int = 0, end: int | None = None) -> bytes:
        """end is exclusive here. Pinned to the live object: a deleted or replaced generation is SourceGone."""
        self.faults.hit("read", bucket, key)
        b = self.buckets[bucket].get(key)
        if b is None or b.generation != generation:
            raise SourceGone()
        data = b.data[start:end]
        self.bytes_read += len(data)
        if key in self.corrupt_reads and data:
            data = bytes([data[0] ^ 0xFF]) + data[1:]
        return data


@dataclass
class _Version:
    version_id: str
    data: bytes | None  # None: a delete marker
    meta: dict
    headers: dict
    crc32c: str | None
    age_days: int = 0
    noncurrent_days: int = 0


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, dict[str, list[_Version]]] = defaultdict(lambda: defaultdict(list))
        self.faults = Faults()
        self.versioning = "Enabled"
        self.retention: int | None = 28
        self.abort_rule = True
        self.corrupt_writes: set[str] = set()  # S3 accepts the write, then a head shows different bytes
        self.uploads: dict[str, dict] = {}
        self.old_uploads: list[dict] = []
        self.aborted: list[str] = []
        self._n = 0
        self.puts = 0

    def _version_id(self) -> str:
        self._n += 1
        return f"v{self._n}"

    def _latest(self, bucket: str, key: str) -> _Version | None:
        versions = self.objects[bucket].get(key)
        return versions[-1] if versions else None

    def _store(self, bucket: str, key: str, data: bytes, meta: dict, headers: dict) -> str:
        vid = self._version_id()
        crc = crc32c(data)
        if key in self.corrupt_writes:
            data = data + b"!"
        self.objects[bucket][key].append(_Version(vid, data, dict(meta), dict(headers), crc32c(data) if key in self.corrupt_writes else crc))
        self.puts += 1
        return vid

    # ---------- the shape stores.S3Store has ----------

    def versioning_status(self, bucket: str) -> str | None:
        self.faults.hit("preflight", bucket)
        return self.versioning

    def noncurrent_days(self, bucket: str) -> int | None:
        self.faults.hit("preflight", bucket)
        return self.retention

    def aborts_stale_uploads(self, bucket: str) -> bool:
        self.faults.hit("preflight", bucket)
        return self.abort_rule

    def list_keys(self, bucket: str, prefix: str = ""):
        self.faults.hit("s3_list", bucket)
        for key, versions in sorted(self.objects[bucket].items()):
            if key.startswith(prefix) and versions and versions[-1].data is not None:
                yield key, len(versions[-1].data)

    def head(self, bucket: str, key: str, version_id: str | None = None) -> S3Head | None:
        self.faults.hit("s3_head", bucket, key)
        versions = self.objects[bucket].get(key) or []
        v = next((x for x in versions if x.version_id == version_id), None) if version_id else (versions[-1] if versions else None)
        if v is None or v.data is None:
            return None
        return S3Head(len(v.data), v.crc32c, dict(v.meta), v.version_id, dict(v.headers))

    def get(self, bucket: str, key: str) -> bytes | None:
        self.faults.hit("s3_get", bucket, key)
        v = self._latest(bucket, key)
        return None if v is None or v.data is None else v.data

    def put(self, bucket: str, key: str, data: bytes, meta: dict, headers: dict, crc: str) -> str:
        self.faults.hit("put", bucket, key)
        if crc32c(data) != crc:
            raise BadChecksum()
        return self._store(bucket, key, data, meta, headers)

    def begin_multipart(self, bucket: str, key: str, meta: dict, headers: dict) -> str:
        self.faults.hit("put", bucket, key)
        upload_id = f"u{len(self.uploads) + len(self.aborted) + 1}"
        self.uploads[upload_id] = {"bucket": bucket, "key": key, "meta": meta, "headers": headers, "parts": {}}
        return upload_id

    def upload_part(self, bucket: str, key: str, upload_id: str, number: int, data: bytes, crc: str) -> dict:
        self.faults.hit("part", bucket, key)
        if crc32c(data) != crc:
            raise BadChecksum()
        self.uploads[upload_id]["parts"][number] = data
        return {"PartNumber": number, "ETag": f"e{number}", "ChecksumCRC32C": crc}

    def complete_multipart(self, bucket: str, key: str, upload_id: str, parts: list[dict], crc: str) -> str:
        self.faults.hit("complete", bucket, key)
        upload = self.uploads[upload_id]
        data = b"".join(upload["parts"][p["PartNumber"]] for p in parts)
        if crc32c(data) != crc:
            raise BadChecksum()
        del self.uploads[upload_id]
        return self._store(bucket, key, data, upload["meta"], upload["headers"])

    def abort_multipart(self, bucket: str, key: str, upload_id: str) -> None:
        self.faults.hit("abort", bucket, key)
        self.uploads.pop(upload_id, None)
        self.aborted.append(upload_id)

    def stale_multipart(self, bucket: str, older_than_s: float):
        self.faults.hit("s3_list", bucket)
        return [(u["key"], u["id"]) for u in self.old_uploads if u["bucket"] == bucket]

    def delete(self, bucket: str, key: str) -> None:
        """A plain delete on a versioned bucket: a marker goes on top, and the bytes stay as an old version."""
        self.faults.hit("delete", bucket, key)
        self.objects[bucket][key].append(_Version(self._version_id(), None, {}, {}, None))

    def latest_entries(self, bucket: str):
        """(key, is_marker, the version under a marker)."""
        self.faults.hit("s3_list", bucket)
        for key, versions in sorted(self.objects[bucket].items()):
            if not versions:
                continue
            latest = versions[-1]
            if latest.data is not None:
                yield key, False, None
            else:
                under = next((v.version_id for v in reversed(versions) if v.data is not None), None)
                yield key, True, under

    # ---------- for assertions ----------

    def current(self, bucket: str, key: str) -> bytes | None:
        v = self._latest(bucket, key)
        return None if v is None else v.data

    def stored_bytes(self, bucket: str, key: str) -> list[bytes]:
        """Every version that still holds bytes, current or old."""
        return [v.data for v in self.objects[bucket].get(key) or [] if v.data is not None]

    def run_lifecycle(self, days: int) -> None:
        """Advances time by whole days and applies what the bucket's rule says: an old version goes `retention` days after
        it stopped being current. A marker with nothing under it goes too."""
        if self.retention is None:
            return
        for keys in self.objects.values():
            for key, versions in list(keys.items()):
                for i, v in enumerate(versions):
                    if i < len(versions) - 1:
                        v.noncurrent_days += days
                keys[key] = [v for i, v in enumerate(versions)
                             if i == len(versions) - 1 or v.noncurrent_days < self.retention]
                if len(keys[key]) == 1 and keys[key][0].data is None:
                    del keys[key]
