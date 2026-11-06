"""Rewrites the links inside S3's copies of recipe.json and library.json. Plan and order: docs/build/MEDIA-MIGRATION.md.

GCS's copies are never touched: old builds read them, and they keep getting links to the GCS host. So the two stores differ on
purpose, and S3's copy is the only one that names the new host.

The way back is built in. Only the host part of a quoted link changes, byte for byte, and each write first proves that swapping the
host back gives the exact file GCS has (same CRC32C). A file that can't prove that isn't changed.
"""
from __future__ import annotations

import copy
import json
import time
from collections import Counter
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from urllib.parse import unquote, urlsplit

from common import META_REWRITTEN, Denied, Log, Transient, crc32c, with_retries
from ledger import Ledger
from sync import PassResult, Target, finish_delete

GCS_HOST = "https://storage.googleapis.com"


def split_gcs_url(url: str) -> tuple[str, str, str | None] | None:
    """(bucket, key, ?v=) of a link to a GCS file, or None for anything else. SCHEMA.md section 5, item 7 needs this too."""
    if not url.startswith(f"{GCS_HOST}/"):
        return None
    parts = urlsplit(url)
    bucket, _, path = unquote(parts.path).lstrip("/").partition("/")
    if not bucket or not path:
        return None
    version = next((q[2:] for q in parts.query.split("&") if q.startswith("v=")), None)
    return bucket, path, version


def kind_of(key: str) -> str | None:
    if key == "library.json":
        return "library"
    return "recipe" if key.count("/") == 1 and key.endswith("/recipe.json") else None


def _link_fields(doc, kind: str) -> Iterator[tuple[str, dict, str]]:
    """(label, the dict holding it, the field), for each place pipeline/schema.py defines a link."""
    if kind == "library":
        for entry in doc if isinstance(doc, list) else []:
            if isinstance(entry, dict):
                yield "poster_url", entry, "poster_url"
                yield "recipe_url", entry, "recipe_url"
        return
    if not isinstance(doc, dict):
        return
    media = doc.get("media")
    if isinstance(media, dict):
        for f in ("video_url", "audio_url", "poster_url"):
            yield f"media.{f}", media, f
    steps = doc.get("steps")
    for step in steps if isinstance(steps, list) else []:
        if isinstance(step, dict):
            yield "steps.image_url", step, "image_url"


def _strings(doc) -> Iterator[str]:
    if isinstance(doc, str):
        yield doc
    elif isinstance(doc, dict):
        for v in doc.values():
            yield from _strings(v)
    elif isinstance(doc, list):
        for v in doc:
            yield from _strings(v)


def _quoted(text: str) -> bytes:
    return json.dumps(text, ensure_ascii=False).encode()


def swap_host_back(raw: bytes, old_base: str, new_base: str) -> bytes:
    return raw.replace(f'"{new_base}/'.encode(), f'"{old_base}/'.encode())


@dataclass
class FilePlan:
    new_raw: bytes | None = None  # None: nothing to change
    links: Counter = field(default_factory=Counter)
    left: Counter = field(default_factory=Counter)
    refused: str | None = None

    @property
    def complete(self) -> bool:
        return not self.left["target_not_in_s3"] and not self.left["unknown_field"]


def plan_file(raw: bytes, kind: str, old_base: str, new_base: str, source_crc: str, in_s3: Callable[[str], bool]) -> FilePlan:
    """Pure: what this file becomes. A link moves only if its file is in S3 and it sits in a field the schema defines."""
    plan = FilePlan()
    try:
        doc = json.loads(raw)
    except ValueError:
        plan.refused = "bad_json"
        return plan
    expected = copy.deepcopy(doc)
    swaps: dict[str, str] = {}
    old_prefix, new_prefix = f"{old_base}/", f"{new_base}/"
    known_left = 0
    for label, holder, name in _link_fields(expected, kind):
        url = holder.get(name)
        if not isinstance(url, str) or url.startswith(new_prefix):
            continue
        if not url.startswith(old_prefix):
            plan.left["other_host"] += 1
            continue
        parsed = split_gcs_url(url)
        if parsed is None or not in_s3(parsed[1]):
            plan.left["target_not_in_s3"] += 1
            known_left += 1
            continue
        swaps[url] = new_base + url[len(old_base):]
        holder[name] = swaps[url]
        plan.links[label] += 1
    unknown = sum(1 for s in _strings(expected) if s.startswith(old_prefix)) - known_left
    if unknown:
        plan.left["unknown_field"] += unknown

    result = raw
    for old, new in swaps.items():
        result = result.replace(_quoted(old), _quoted(new))
    try:
        same_shape = json.loads(result) == expected  # a link repeated in a field nothing knows, or escaped in an odd way
    except ValueError:
        same_shape = False
    if not same_shape:
        return FilePlan(left=plan.left, refused="unexpected_shape")
    if crc32c(swap_host_back(result, old_base, new_base)) != source_crc:
        return FilePlan(left=plan.left, refused="no_way_back")
    plan.new_raw = result if swaps else None
    return plan


class Rewriter:
    def __init__(self, gcs, s3, ledger: Ledger, log: Log, media_base: str, sleep: Callable[[float], None] = time.sleep):
        self.gcs, self.s3, self.ledger, self.log, self.sleep = gcs, s3, ledger, log, sleep
        self.new_base = media_base.rstrip("/")

    def _retry(self, fn):
        return with_retries(fn, sleep=self.sleep)

    def _rows(self, t: Target) -> list:
        """recipe.json files before library.json, so the library never names a recipe that still has old links."""
        rows = [r for r in self.ledger.rows(t.gcs, "copied") if kind_of(r["key"])] if t.is_media else []
        return sorted(rows, key=lambda r: r["key"] == "library.json")

    def run(self, targets: list[Target], write: bool) -> dict:
        out = {"dry_run": not write, "files_to_change": 0, "written": 0, "links": Counter(), "left_alone": Counter(), "refused_files": 0,
               "source_gone": 0, "failed": 0, "denied": None}
        try:
            for t in targets:
                for row in self._rows(t):
                    if row["rewrite_state"] != "full":
                        self._one(t, row, write, out)
        except Denied as e:
            out["denied"] = str(e)
            self.log.event("denied", op=e.op, bucket=e.bucket)
        out["links"], out["left_alone"] = dict(out["links"]), dict(out["left_alone"])
        out["ok"] = not (out["denied"] or out["failed"])
        self.log.event("rewrite_done", **{k: v for k, v in out.items() if k not in ("links", "left_alone")})
        return out

    def _one(self, t: Target, row, write: bool, out: dict) -> None:
        key, key_id = row["key"], row["key_id"]
        try:
            source = self._retry(lambda: self.gcs.head(t.gcs, key))
            if source is None or source.generation != row["generation"]:
                out["source_gone"] += 1  # the next sync settles it
                return
            head = self._retry(lambda: self.s3.head(t.s3, key))
            raw = self._retry(lambda: self.s3.get(t.s3, key))
            if head is None or raw is None:
                out["source_gone"] += 1
                return
            old_base = f"{GCS_HOST}/{t.gcs}"

            def in_s3(target_key: str) -> bool:
                found = self.ledger.get(t.gcs, target_key)
                return found is not None and found["state"] == "copied"

            plan = plan_file(raw, kind_of(key), old_base, self.new_base, row["crc32c"], in_s3)
            out["left_alone"].update(plan.left)
            if plan.refused:
                out["refused_files"] += 1
                self.log.event("rewrite_refused", bucket=t.s3, key_id=key_id, why=plan.refused)
                return
            state = "full" if plan.complete else "partial"
            if plan.new_raw is None:
                if write:  # nothing new. Records what's there, which also finishes a run that died after its write.
                    self.ledger.mark_rewritten(t.gcs, key, None, crc32c(raw), state)
                return
            out["files_to_change"] += 1
            out["links"].update(plan.links)
            if not write:
                return
            crc = crc32c(plan.new_raw)
            meta = {**head.meta, META_REWRITTEN: "1"}
            version_id = self._retry(lambda: self.s3.put(t.s3, key, plan.new_raw, meta, head.headers, crc))
            after = self._retry(lambda: self.s3.head(t.s3, key))
            if after is None or after.crc32c != crc:
                self.ledger.mark_failed(t.gcs, key, "rewrite_differs")  # the next sync puts GCS's copy back
                out["failed"] += 1
                return
            self.ledger.mark_rewritten(t.gcs, key, version_id, crc, state)
            out["written"] += 1
            self.log.event("rewritten", bucket=t.s3, key_id=key_id, links=sum(plan.links.values()))
            self._recheck_source(t, key)
        except Transient:
            out["failed"] += 1
            self.log.event("rewrite_failed", bucket=t.s3, key_id=key_id)

    def _recheck_source(self, t: Target, key: str) -> None:
        """Same as the copy: a write that lands after the source's delete has to go."""
        if self._retry(lambda: self.gcs.head(t.gcs, key)) is None:
            self.ledger.mark_deleting(t.gcs, key)
            finish_delete(self.s3, self.ledger, self.log, t, key, PassResult(), self.sleep)

    def undo(self, targets: list[Target], write: bool) -> dict:
        """The way back: S3's copies hold GCS links again, byte for byte. If a copy can't prove that, its row goes to `failed`, and
        the next sync copies it fresh from GCS. Stop the catch-up's rewrite first, or it will redo this."""
        out = {"dry_run": not write, "restored": 0, "need_fresh_copy": 0, "failed": 0, "denied": None}
        try:
            for t in targets:
                for row in self._rows(t):
                    if row["rewrite_state"]:
                        self._undo_one(t, row, write, out)
        except Denied as e:
            out["denied"] = str(e)
            self.log.event("denied", op=e.op, bucket=e.bucket)
        out["ok"] = not (out["denied"] or out["failed"])
        self.log.event("rewrite_undo_done", **out)
        return out

    def _undo_one(self, t: Target, row, write: bool, out: dict) -> None:
        key = row["key"]
        try:
            head = self._retry(lambda: self.s3.head(t.s3, key))
            raw = self._retry(lambda: self.s3.get(t.s3, key))
            if head is None or raw is None:
                return
            original = swap_host_back(raw, f"{GCS_HOST}/{t.gcs}", self.new_base)
            if crc32c(original) != row["crc32c"]:
                out["need_fresh_copy"] += 1
                self.log.event("undo_unproven", bucket=t.s3, key_id=row["key_id"])
                if write:
                    self.ledger.mark_failed(t.gcs, key, "undo_unproven")
                return
            if original == raw and META_REWRITTEN not in head.meta:
                if write:
                    self.ledger.clear_rewrite(t.gcs, key, None)
                return
            out["restored"] += 1
            if write:
                meta = {k: v for k, v in head.meta.items() if k != META_REWRITTEN}
                version_id = self._retry(lambda: self.s3.put(t.s3, key, original, meta, head.headers, row["crc32c"]))
                self.ledger.clear_rewrite(t.gcs, key, version_id)
                self._recheck_source(t, key)
        except Transient:
            out["failed"] += 1
            self.log.event("rewrite_undo_failed", bucket=t.s3, key_id=row["key_id"])
