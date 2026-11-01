"""What differs between GCS and S3, with salted ids in place of keys; rebuilding a lost ledger; and the one-run-at-a-time lock.

An operator maps an id back with the ledger: `select key from objects where key_id = '...'`. A file this tool didn't copy has no
row, so its id can't be mapped back. That's fine, because it isn't this tool's to act on.
"""
from __future__ import annotations

import contextlib
import fcntl
import time
from collections.abc import Callable
from pathlib import Path

from common import META_CRC, META_GENERATION, META_METAGENERATION, META_REWRITTEN, GcsObject, Log, Refused, with_retries
from ledger import Ledger
from sync import Target

MAX_IDS = 50


@contextlib.contextmanager
def hold_lock(state: str | Path):
    """Two runs at once could undo each other's checks. The lock goes when the process does, even after a crash."""
    with open(f"{state}.lock", "a") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Refused("another run is already running on this ledger") from None
        yield


def _found(ids: list[str]) -> dict:
    return {"count": len(ids), "ids": ids[:MAX_IDS]}


def report(gcs, s3, ledger: Ledger, targets: list[Target], deep: bool = False, clock: Callable[[], float] = time.time,
           stale_hours: float | None = None, sleep: Callable[[float], None] = time.sleep) -> dict:
    """Read-only. deep also checks each copy's checksum with a HEAD, at about $0.40 per million files."""
    buckets = {}
    for t in targets:
        listing = with_retries(lambda t=t: {o.key: o for o in gcs.list(t.gcs)}, sleep=sleep)
        in_s3 = dict(with_retries(lambda t=t: list(s3.list_keys(t.s3)), sleep=sleep))
        idof = lambda key, b=t.gcs: ledger.key_id(b, key)  # noqa: E731
        not_yet, changed, missing, owed, failed, foreign, size_off, crc_off, back = [], [], [], [], [], [], [], [], []
        in_step = excluded = 0

        for key, obj in listing.items():
            if t.excluded(key):
                excluded += 1
                continue
            row = ledger.get(t.gcs, key)
            if row is None or (row["state"] == "deleted" and obj.generation > row["tomb_generation"]):
                not_yet.append(idof(key))
            elif row["state"] == "deleted":
                back.append(idof(key))  # GCS holds a generation already deleted, such as a restore. It stays out of S3.
            elif row["state"] in ("failed", "copying"):
                failed.append(idof(key))
            elif row["state"] == "copied":
                if (row["generation"], row["metageneration"]) != (obj.generation, obj.metageneration):
                    changed.append(idof(key))
                elif key not in in_s3:
                    missing.append(idof(key))
                elif not row["rewrite_state"] and in_s3[key] != row["size"]:
                    size_off.append(idof(key))
                elif deep and not _checksum_ok(s3, t, key, row, sleep):
                    crc_off.append(idof(key))
                else:
                    in_step += 1

        for row in ledger.rows(t.gcs, "deleting"):
            owed.append(row["key_id"])
        for row in ledger.rows(t.gcs, "copied", "copying", "failed"):
            if row["key"] not in listing:
                owed.append(row["key_id"])
        for key in in_s3:
            row = ledger.get(t.gcs, key)
            if row is None or row["state"] == "deleted":
                foreign.append(idof(key))

        buckets[t.gcs] = {
            "s3_bucket": t.s3, "gcs_files": len(listing), "s3_files": len(in_s3), "in_step": in_step, "excluded": excluded,
            "not_copied_yet": _found(not_yet), "changed_in_gcs": _found(changed), "failed_or_interrupted": _found(failed),
            "missing_in_s3": _found(missing), "delete_owed": _found(owed), "size_differs": _found(size_off),
            "checksum_differs": _found(crc_off), "kept_gone_by_tombstone": _found(back),
            "not_copied_by_this_tool": _found(foreign),
        }

    must_be_empty = ("not_copied_yet", "changed_in_gcs", "failed_or_interrupted", "missing_in_s3", "delete_owed", "size_differs",
                     "checksum_differs")
    good = ledger.get_meta("last_good_pass_at")
    hours = None if good is None else (clock() - float(good)) / 3600
    return {
        "in_step": not any(b[name]["count"] for b in buckets.values() for name in must_be_empty),
        "checksums_checked": deep,
        "hours_since_last_good_pass": hours,
        "catch_up_is_stale": stale_hours is not None and (hours is None or hours > stale_hours),
        "buckets": buckets,
    }


def _checksum_ok(s3, t: Target, key: str, row, sleep) -> bool:
    head = with_retries(lambda: s3.head(t.s3, key), sleep=sleep)
    want = row["rewritten_crc32c"] or row["crc32c"]
    return head is not None and head.crc32c == want and head.meta.get(META_GENERATION) == str(row["generation"])


def rebuild_ledger(s3, ledger: Ledger, targets: list[Target], log: Log, sleep: Callable[[float], None] = time.sleep) -> dict:
    """Rebuilds a lost ledger from S3: each copy carries its generation and checksum as metadata. A delete marker over one of this
    tool's copies becomes a tombstone, so a delete made in S3 isn't undone. Markers older than old versions' 28 days are gone, so
    a delete older than that can't be recovered this way, and neither can a copy with no tag."""
    if not ledger.is_empty():
        raise Refused("this ledger isn't empty. rebuild-ledger only fills an empty one")
    totals = {"copied": 0, "tombstones": 0, "not_ours": 0}
    for t in targets:
        for key, is_marker, under in with_retries(lambda t=t: list(s3.latest_entries(t.s3)), sleep=sleep):
            head = with_retries(lambda: s3.head(t.s3, key, under if is_marker else None), sleep=sleep) if (under or not is_marker) else None
            if head is None or META_GENERATION not in head.meta:
                totals["not_ours"] += 1
            elif is_marker:
                ledger.restore_deleted(t.gcs, key, int(head.meta[META_GENERATION]))
                totals["tombstones"] += 1
            else:
                obj = GcsObject(key, head.size, int(head.meta[META_GENERATION]), int(head.meta.get(META_METAGENERATION, 0)),
                                head.meta[META_CRC])
                ledger.restore_copied(t.gcs, obj, head.version_id, META_REWRITTEN in head.meta, head.crc32c)
                totals["copied"] += 1
    log.event("ledger_rebuilt", **totals)
    return totals
