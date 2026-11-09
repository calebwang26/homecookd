"""The media copy, with fake GCS and S3 (fakes.py). No network, no cloud, no real data.

    python tools/media-copy/test_media_copy.py

Deletions come first, because they're a privacy promise (docs/build/MEDIA-MIGRATION.md).
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import costs  # noqa: E402
import media_copy  # noqa: E402
import report as report_mod  # noqa: E402
import rewrite as rw  # noqa: E402
from common import Crc, Denied, Log, Refused, crc32c  # noqa: E402
from fakes import FakeGcs, FakeS3  # noqa: E402
from ledger import Ledger  # noqa: E402
from sync import Config, Syncer, Target, dry_run  # noqa: E402

G, S = "test-media", "s3-media"
FAMILY_KEY = "shreya-pawar-grandmas-poha-ab12cd/play.mp4"
SECRET_BODY = b"the sound of Shreya's grandmother's kitchen" * 3


class Crash(BaseException):
    """Stands in for the machine dying: nothing in the tool catches it."""


def explode():
    raise Crash()


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory(prefix="media-copy-test-")
        self.addCleanup(self.dir.cleanup)
        self.state = Path(self.dir.name) / "state.sqlite"
        self.gcs, self.s3 = FakeGcs(), FakeS3()
        self.logs = io.StringIO()
        self.ledger = Ledger(self.state)
        self.addCleanup(lambda: self.ledger.close())
        self.target = Target(G, S)

    def syncer(self, **cfg) -> Syncer:
        return Syncer(self.gcs, self.s3, self.ledger, Log(self.logs), Config(**cfg), sleep=lambda _: None)

    def run_pass(self, **cfg):
        return self.syncer(**cfg).run_pass([self.target])

    def reopen(self):
        """What a new process sees after a crash."""
        self.ledger.close()
        self.ledger = Ledger(self.state)

    def row(self, key):
        return self.ledger.get(G, key)


class DeletionOrder(Base):
    """A file deleted from GCS has to leave S3, whatever order the two happen in, and must not come back."""

    def test_deleted_after_the_copy_leaves_s3_and_never_comes_back(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, FAMILY_KEY), SECRET_BODY)
        self.gcs.delete(G, FAMILY_KEY)
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))
        for _ in range(3):
            self.assertTrue(self.run_pass().ok)
            self.assertIsNone(self.s3.current(S, FAMILY_KEY))
        self.assertEqual(self.s3.puts, 1)

    def test_deleted_before_the_copy_reads_it_is_never_written(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.gcs.faults.before("read", FAMILY_KEY, lambda: self.gcs.delete(G, FAMILY_KEY))
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.puts, 0)
        self.assertEqual(self.s3.stored_bytes(S, FAMILY_KEY), [])
        self.assertEqual(self.row(FAMILY_KEY)["state"], "deleted")

    def test_deleted_while_the_copy_is_being_written_is_removed(self):
        """The hard order: the read succeeded, so the write lands after the delete."""
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.s3.faults.before("put", FAMILY_KEY, lambda: self.gcs.delete(G, FAMILY_KEY))
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.puts, 1)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))
        self.assertEqual(self.row(FAMILY_KEY)["state"], "deleted")

    def test_deleted_after_the_recheck_goes_on_the_second_listing(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        def delete_before_second_list():  # runs at the copy's re-check, so the delete comes just after that re-check
            self.gcs.faults.before("list", None, lambda: self.gcs.delete(G, FAMILY_KEY))
        self.gcs.faults.before("head", FAMILY_KEY, delete_before_second_list)
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))
        self.assertEqual(self.row(FAMILY_KEY)["state"], "deleted")

    def test_a_stale_plan_replayed_after_the_delete_writes_nothing(self):
        """A listing taken before the delete, used after it. The tombstone refuses it, even if GCS still answered."""
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        stale = self.gcs.list(G)[0]
        self.gcs.delete(G, FAMILY_KEY)
        self.run_pass()
        puts = self.s3.puts
        self.gcs.buckets[G][FAMILY_KEY] = type("B", (), {"data": SECRET_BODY, "generation": stale.generation, "metageneration": 1, "headers": {}})()
        outcome = self.syncer().copy_one(self.target, stale)
        self.assertEqual(outcome, "tombstoned")
        self.assertEqual(self.s3.puts, puts)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_the_same_generation_seen_again_is_not_copied(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        blob = self.gcs.buckets[G][FAMILY_KEY]
        self.gcs.delete(G, FAMILY_KEY)
        self.run_pass()
        self.gcs.buckets[G][FAMILY_KEY] = blob  # a restore that kept its generation
        result = self.run_pass()
        self.assertEqual(result.tombstoned, 1)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_a_new_upload_at_the_same_key_is_a_new_file(self):
        self.gcs.put(G, FAMILY_KEY, b"old")
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.run_pass()
        self.gcs.put(G, FAMILY_KEY, b"new")
        self.run_pass()
        self.assertEqual(self.s3.current(S, FAMILY_KEY), b"new")
        self.gcs.delete(G, FAMILY_KEY)
        self.run_pass()
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_a_denied_s3_delete_stops_loudly_and_is_finished_later(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.s3.faults.deny.add("delete")
        result = self.run_pass()
        self.assertFalse(result.ok)
        self.assertEqual(result.exit_code, media_copy.EXIT_DENIED)
        self.assertEqual(self.row(FAMILY_KEY)["state"], "deleting")
        self.assertEqual(self.s3.current(S, FAMILY_KEY), SECRET_BODY)
        self.s3.faults.deny.clear()
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_a_flaky_s3_delete_is_retried_then_reported(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.s3.faults.transient["delete"] = 2
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

        self.gcs.put(G, "b/x.jpg", b"x")
        self.run_pass()
        self.gcs.delete(G, "b/x.jpg")
        self.s3.faults.transient["delete"] = 50
        result = self.run_pass()
        self.assertFalse(result.ok)
        self.assertEqual(result.delete_failed, 2)  # both listings tried, and it's still owed
        self.assertEqual(self.row("b/x.jpg")["state"], "deleting")
        self.s3.faults.transient["delete"] = 0
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, "b/x.jpg"))

    def test_a_crash_before_s3s_delete_still_deletes(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.s3.faults.before("delete", FAMILY_KEY, explode)
        with self.assertRaises(Crash):
            self.run_pass()
        self.assertEqual(self.row(FAMILY_KEY)["state"], "deleting")
        self.reopen()
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))
        self.assertEqual(self.row(FAMILY_KEY)["state"], "deleted")

    def test_a_crash_between_the_put_and_the_ledger_is_still_deleted(self):
        """S3 has a copy the ledger never recorded as finished, and the file then goes from GCS."""
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.s3.faults.before("s3_head", FAMILY_KEY, explode)
        with self.assertRaises(Crash):
            self.run_pass(workers=1)
        self.assertEqual(self.s3.current(S, FAMILY_KEY), SECRET_BODY)
        self.assertEqual(self.row(FAMILY_KEY)["state"], "copying")
        self.gcs.delete(G, FAMILY_KEY)
        self.reopen()
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_a_failed_write_that_landed_anyway_is_still_deleted(self):
        """A timeout can hide a write that worked. The row is `failed`, and S3 holds the copy."""
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.s3.corrupt_writes.add(FAMILY_KEY)
        self.s3.faults.deny.add("delete")
        result = self.run_pass(workers=1)
        self.assertFalse(result.ok)
        self.s3.faults.deny.clear()
        self.s3.corrupt_writes.clear()
        self.gcs.delete(G, FAMILY_KEY)
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_deletes_run_even_when_copying_is_denied(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.gcs.put(G, "new/x.jpg", b"x")
        self.s3.faults.deny.add("put")
        result = self.run_pass()
        self.assertEqual(result.exit_code, media_copy.EXIT_DENIED)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_the_old_version_lasts_28_days_then_goes(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.run_pass()
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))
        self.assertEqual(self.s3.stored_bytes(S, FAMILY_KEY), [SECRET_BODY])  # hidden, and still there
        self.s3.run_lifecycle(27)
        self.assertEqual(self.s3.stored_bytes(S, FAMILY_KEY), [SECRET_BODY])
        self.s3.run_lifecycle(1)
        self.assertEqual(self.s3.stored_bytes(S, FAMILY_KEY), [])
        self.run_pass()
        self.assertEqual(self.s3.stored_bytes(S, FAMILY_KEY), [])

    def test_a_bucket_that_keeps_old_versions_too_long_is_refused(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        for retention in (None, 29, 90):
            self.s3.retention = retention
            with self.assertRaisesRegex(Refused, "old versions"):
                self.run_pass()
        self.assertEqual(self.s3.puts, 0)

    def test_a_bucket_without_versioning_is_refused(self):
        self.s3.versioning = None
        with self.assertRaisesRegex(Refused, "versioning"):
            self.run_pass()

    def test_a_file_this_tool_never_copied_is_left_alone(self):
        """After uploads move, the api and the worker write straight to S3. GCS never had those files."""
        self.s3.put(S, "attempt-1/play.mp4", b"worker", {}, {}, crc32c(b"worker"))
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.assertTrue(self.run_pass().ok)
        self.gcs.delete(G, FAMILY_KEY)
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, "attempt-1/play.mp4"), b"worker")

    def test_an_object_at_a_deleted_key_that_isnt_ours_is_reported_not_deleted(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.s3.put(S, FAMILY_KEY, b"written by the api", {}, {}, crc32c(b"written by the api"))
        result = self.run_pass()
        self.assertEqual(result.foreign_at_deleted_key, 1)
        self.assertEqual(self.s3.current(S, FAMILY_KEY), b"written by the api")

    def test_a_delete_made_in_s3_isnt_undone_by_a_catch_up(self):
        """The new purge deletes from S3 first. GCS still has the file for a moment, and a catch-up must not restore it."""
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.s3.delete(S, FAMILY_KEY)
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))
        self.assertEqual(self.s3.puts, 1)
        self.assertEqual(report_mod.report(self.gcs, self.s3, self.ledger, [self.target])["buckets"][G]["missing_in_s3"]["count"], 1)

    def test_moving_to_trash_deletes_from_s3_and_trash_is_not_copied(self):
        self.gcs.put(G, "dish-a/play.mp4", SECRET_BODY)
        self.run_pass()
        self.gcs.put(G, "trash/dish-a/play.mp4", SECRET_BODY)
        self.gcs.delete(G, "dish-a/play.mp4")
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, "dish-a/play.mp4"))
        self.assertEqual(self.s3.stored_bytes(S, "trash/dish-a/play.mp4"), [])

    def test_the_tombstone_forgets_the_key(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        for i in range(30):
            self.gcs.put(G, f"another-dish-{i:02d}/poster.jpg", b"x")
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.run_pass()
        self.assertIsNone(self.row(FAMILY_KEY)["key"])
        self.ledger.close()
        self.assertNotIn(b"shreya", _all_bytes(self.state))
        self.ledger = Ledger(self.state)

    def test_a_listing_that_looks_wrong_holds_every_new_delete(self):
        for i in range(10):
            self.gcs.put(G, f"dish/{i}.jpg", b"x")
        self.run_pass()
        self.gcs.buckets[G].clear()
        with self.assertRaisesRegex(Refused, "mass"):
            self.run_pass(mass_delete_min=5)
        self.assertIsNotNone(self.s3.current(S, "dish/1.jpg"))
        self.assertTrue(self.run_pass(mass_delete_min=5, allow_mass_delete=True).ok)
        self.assertIsNone(self.s3.current(S, "dish/1.jpg"))

    def test_a_big_share_going_at_once_is_also_held(self):
        for i in range(10):
            self.gcs.put(G, f"dish/{i}.jpg", b"x")
        self.run_pass()
        for i in range(5):
            self.gcs.delete(G, f"dish/{i}.jpg")
        with self.assertRaisesRegex(Refused, "mass"):
            self.run_pass(mass_delete_min=4, mass_delete_share=0.25)
        self.assertTrue(self.run_pass().ok)  # under the default floor, it just goes

    def test_one_buckets_problem_doesnt_hold_up_anothers_deletes(self):
        other = Target("test-uploads", "s3-uploads")
        self.gcs.put(G, "a/1.jpg", b"1")
        self.gcs.put("test-uploads", FAMILY_KEY, SECRET_BODY)
        self.syncer().run_pass([self.target, other])
        self.gcs.delete("test-uploads", FAMILY_KEY)
        real_list = self.gcs.list

        def list_media_denied(bucket, prefix=""):
            if bucket == G:
                raise Denied("list", G)
            return real_list(bucket, prefix)

        self.gcs.list = list_media_denied
        result = self.syncer().run_pass([self.target, other])
        self.assertEqual(result.denied, f"list was denied on {G}")
        self.assertIsNone(self.s3.current("s3-uploads", FAMILY_KEY))

    def test_a_listing_that_keeps_failing_decides_nothing(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.faults.transient["list"] = 50
        result = self.run_pass()
        self.assertFalse(result.ok)
        self.assertEqual(result.failed, 1)
        self.assertEqual(self.s3.current(S, FAMILY_KEY), SECRET_BODY)
        self.assertEqual(self.row(FAMILY_KEY)["state"], "copied")

    def test_a_missing_sweep_permission_doesnt_stop_deletes(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        real = self.s3.stale_multipart

        def denied(bucket, older):
            raise Denied("ListMultipartUploads", bucket)

        self.s3.stale_multipart = denied
        result = self.run_pass()
        self.assertEqual(result.exit_code, media_copy.EXIT_DENIED)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))
        self.s3.stale_multipart = real

    def test_a_scoped_pass_only_deletes_inside_its_scope(self):
        self.gcs.put(G, "a/1.jpg", b"1")
        self.gcs.put(G, "b/1.jpg", b"1")
        self.run_pass()
        self.gcs.delete(G, "a/1.jpg")
        self.gcs.delete(G, "b/1.jpg")
        self.assertTrue(self.run_pass(only_prefix="a/").ok)
        self.assertIsNone(self.s3.current(S, "a/1.jpg"))
        self.assertIsNotNone(self.s3.current(S, "b/1.jpg"))


def _all_bytes(path: Path) -> bytes:
    out = b""
    for p in path.parent.glob(path.name + "*"):
        out += p.read_bytes()
    return out


class Copy(Base):
    def test_copies_with_the_same_key_and_headers(self):
        self.gcs.put(G, "dish/play.mp4", b"video", content_type="video/mp4", cache_control="public, max-age=3600")
        self.assertTrue(self.run_pass().ok)
        head = self.s3.head(S, "dish/play.mp4")
        self.assertEqual(self.s3.current(S, "dish/play.mp4"), b"video")
        self.assertEqual(head.headers, {"content_type": "video/mp4", "cache_control": "public, max-age=3600"})
        self.assertEqual(head.meta["gcs-crc32c"], crc32c(b"video"))

    def test_an_empty_file_is_copied(self):
        self.gcs.put(G, "folder/", b"")
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, "folder/"), b"")

    def test_a_repeat_changes_nothing_and_reads_nothing(self):
        self.gcs.put(G, "dish/play.mp4", b"video")
        self.run_pass()
        reads, puts = self.gcs.faults.calls["read"], self.s3.puts
        for _ in range(3):
            result = self.run_pass()
            self.assertEqual((result.copied, result.ok), (0, True))
        self.assertEqual((self.gcs.faults.calls["read"], self.s3.puts), (reads, puts))

    def test_a_changed_file_is_copied_again_and_the_old_one_is_kept_as_a_version(self):
        self.gcs.put(G, "dish/poster.jpg", b"old")
        self.run_pass()
        self.gcs.put(G, "dish/poster.jpg", b"new")
        self.assertEqual(self.run_pass().copied, 1)
        self.assertEqual(self.s3.current(S, "dish/poster.jpg"), b"new")
        self.assertEqual(self.s3.stored_bytes(S, "dish/poster.jpg"), [b"old", b"new"])

    def test_a_file_replaced_during_the_copy_gets_its_new_version_next_pass(self):
        self.gcs.put(G, "dish/poster.jpg", b"old")
        self.s3.faults.before("put", "dish/poster.jpg", lambda: self.gcs.put(G, "dish/poster.jpg", b"new"))
        self.run_pass()
        self.assertEqual(self.s3.current(S, "dish/poster.jpg"), b"old")
        self.run_pass()
        self.assertEqual(self.s3.current(S, "dish/poster.jpg"), b"new")

    def test_a_metadata_change_is_copied(self):
        self.gcs.put(G, "dish/poster.jpg", b"x", cache_control="a")
        self.run_pass()
        blob = self.gcs.buckets[G]["dish/poster.jpg"]
        blob.metageneration = 2
        blob.headers = {"cache_control": "b"}
        self.assertEqual(self.run_pass().copied, 1)
        self.assertEqual(self.s3.head(S, "dish/poster.jpg").headers["cache_control"], "b")

    def test_resume_after_a_crash_keeps_finished_files_and_finishes_the_rest(self):
        for i in range(6):
            self.gcs.put(G, f"dish/{i}.jpg", b"%d" % i)
        self.s3.faults.before("put", "dish/3.jpg", explode)
        with self.assertRaises(Crash):
            self.run_pass(workers=1)
        done = self.gcs.faults.calls["read"]
        self.reopen()
        self.assertTrue(self.run_pass(workers=1).ok)
        for i in range(6):
            self.assertEqual(self.s3.current(S, f"dish/{i}.jpg"), b"%d" % i)
        self.assertEqual(self.gcs.faults.calls["read"] - done, 3)  # 3, 4 and 5 only
        self.assertEqual(self.s3.puts, 6)

    def test_a_crash_after_the_write_doesnt_copy_again(self):
        self.gcs.put(G, "dish/play.mp4", b"video")
        self.s3.faults.before("s3_head", "dish/play.mp4", explode)
        with self.assertRaises(Crash):
            self.run_pass()
        reads = self.gcs.faults.calls["read"]
        self.reopen()
        result = self.run_pass()
        self.assertEqual((result.resumed, result.ok), (1, True))
        self.assertEqual(self.gcs.faults.calls["read"], reads)
        self.assertEqual(self.s3.puts, 1)

    def test_a_big_file_goes_in_parts(self):
        data = bytes(range(256)) * 100
        self.gcs.put(G, "dish/play.mp4", data, content_type="video/mp4")
        self.assertTrue(self.run_pass(part_size=1000).ok)
        self.assertEqual(self.s3.current(S, "dish/play.mp4"), data)
        self.assertEqual(self.s3.uploads, {})

    def test_a_partial_copy_is_aborted_and_leaves_no_file(self):
        data = b"x" * 5000
        self.gcs.put(G, "dish/play.mp4", data)
        self.s3.faults.transient["part"] = 50
        result = self.run_pass(part_size=1000)
        self.assertFalse(result.ok)
        self.assertEqual(result.failed, 1)
        self.assertIsNone(self.s3.current(S, "dish/play.mp4"))
        self.assertEqual(self.s3.uploads, {})
        self.assertEqual(len(self.s3.aborted), 1)
        self.s3.faults.transient["part"] = 0
        self.assertTrue(self.run_pass(part_size=1000).ok)
        self.assertEqual(self.s3.current(S, "dish/play.mp4"), data)

    def test_a_part_retries_alone(self):
        data = b"x" * 5000
        self.gcs.put(G, "dish/play.mp4", data)
        self.s3.faults.transient["part"] = 2
        self.gcs.faults.transient["read"] = 2
        self.assertTrue(self.run_pass(part_size=1000).ok)
        self.assertEqual(self.s3.current(S, "dish/play.mp4"), data)
        self.assertEqual(self.gcs.faults.calls["read"], 7)

    def test_a_source_deleted_during_a_big_copy_aborts_it(self):
        data = b"x" * 5000
        self.gcs.put(G, FAMILY_KEY, data)
        self.s3.faults.before("part", FAMILY_KEY, lambda: self.gcs.delete(G, FAMILY_KEY))
        self.assertTrue(self.run_pass(part_size=1000).ok)
        self.assertEqual(self.s3.stored_bytes(S, FAMILY_KEY), [])
        self.assertEqual(self.s3.uploads, {})
        self.assertEqual(self.row(FAMILY_KEY)["state"], "deleted")

    def test_an_abandoned_upload_is_aborted_when_the_ledger_knows_the_key(self):
        self.gcs.put(G, "dish/play.mp4", b"x")
        self.run_pass()
        self.s3.old_uploads = [{"bucket": S, "key": "dish/play.mp4", "id": "old1"},
                               {"bucket": S, "key": "phone/upload.mov", "id": "theirs"}]
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.aborted, ["old1"])

    def test_bytes_that_dont_match_gcss_checksum_are_never_written(self):
        self.gcs.put(G, "dish/poster.jpg", b"good")
        self.gcs.corrupt_reads.add("dish/poster.jpg")
        result = self.run_pass()
        self.assertFalse(result.ok)
        self.assertEqual(result.failed, 1)
        self.assertEqual(self.s3.puts, 0)
        self.assertEqual(self.row("dish/poster.jpg")["error"], "BadChecksum")
        self.gcs.corrupt_reads.clear()
        self.assertTrue(self.run_pass().ok)

    def test_if_a_read_ignored_its_pin_the_checksum_still_stops_the_copy(self):
        self.gcs.put(G, "dish/poster.jpg", b"old")
        real_read = self.gcs.read

        def unpinned(bucket, key, generation, start=0, end=None):
            return self.gcs.buckets[bucket][key].data[start:end]

        self.gcs.read = unpinned
        stale = self.gcs.list(G)[0]
        self.gcs.put(G, "dish/poster.jpg", b"new")
        self.assertEqual(self.syncer().copy_one(self.target, stale), "failed")
        self.assertEqual(self.s3.puts, 0)
        self.gcs.read = real_read

    def test_a_corrupt_big_file_is_aborted_before_it_completes(self):
        self.gcs.put(G, "dish/play.mp4", b"x" * 5000)
        self.gcs.corrupt_reads.add("dish/play.mp4")
        result = self.run_pass(part_size=1000)
        self.assertFalse(result.ok)
        self.assertEqual((self.s3.puts, self.s3.uploads), (0, {}))
        self.assertEqual(len(self.s3.aborted), 1)
        self.assertEqual(self.s3.faults.calls["complete"], 0)  # caught here, without relying on S3 to catch it

    def test_a_copy_s3_stored_wrong_is_hidden_and_tried_again(self):
        self.gcs.put(G, "dish/poster.jpg", b"good")
        self.s3.corrupt_writes.add("dish/poster.jpg")
        result = self.run_pass()
        self.assertFalse(result.ok)
        self.assertIsNone(self.s3.current(S, "dish/poster.jpg"))
        self.assertEqual(self.row("dish/poster.jpg")["state"], "failed")
        self.s3.corrupt_writes.clear()
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, "dish/poster.jpg"), b"good")

    def test_a_file_that_keeps_failing_stops_costing_egress_until_asked(self):
        self.gcs.put(G, "dish/poster.jpg", b"good")
        self.gcs.corrupt_reads.add("dish/poster.jpg")
        for _ in range(7):
            result = self.run_pass(attempts_cap=3)
        self.assertEqual(self.gcs.faults.calls["read"], 3)
        self.assertEqual(result.stuck, 1)
        self.assertFalse(result.ok)
        self.gcs.corrupt_reads.clear()
        self.assertTrue(self.run_pass(attempts_cap=3, retry_failed=True).ok)

    def test_a_denied_gcs_read_stops_the_pass_and_names_only_the_operation(self):
        for i in range(5):
            self.gcs.put(G, f"dish/{i}.jpg", b"x")
        self.gcs.faults.deny.add("read")
        result = self.run_pass(workers=1)
        self.assertEqual(result.exit_code, media_copy.EXIT_DENIED)
        self.assertEqual(result.denied, f"read was denied on {G}")
        self.assertEqual(self.gcs.faults.calls["read"], 1)
        self.assertEqual(self.s3.puts, 0)

    def test_a_denied_s3_write_stops_the_pass_and_a_later_pass_finishes(self):
        self.gcs.put(G, "dish/1.jpg", b"x")
        self.s3.faults.deny.add("put")
        result = self.run_pass()
        self.assertEqual(result.exit_code, media_copy.EXIT_DENIED)
        self.s3.faults.deny.clear()
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, "dish/1.jpg"), b"x")

    def test_a_denied_listing_deletes_nothing(self):
        self.gcs.put(G, "dish/1.jpg", b"x")
        self.run_pass()
        self.gcs.faults.deny.add("list")
        result = self.run_pass()
        self.assertEqual(result.exit_code, media_copy.EXIT_DENIED)
        self.assertEqual(self.s3.current(S, "dish/1.jpg"), b"x")

    def test_transient_failures_are_retried(self):
        self.gcs.put(G, "dish/1.jpg", b"x")
        self.gcs.faults.transient["read"] = 3
        self.s3.faults.transient["put"] = 3
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, "dish/1.jpg"), b"x")

    def test_concurrency_is_bounded(self):
        in_flight, peak, lock = [0], [0], threading.Lock()
        real_read = self.gcs.read
        gate = threading.Barrier(3, timeout=5)

        def read(*a, **k):
            with lock:
                in_flight[0] += 1
                peak[0] = max(peak[0], in_flight[0])
            try:
                gate.wait()
            except threading.BrokenBarrierError:
                pass
            with lock:
                in_flight[0] -= 1
            return real_read(*a, **k)

        self.gcs.read = read
        for i in range(30):
            self.gcs.put(G, f"dish/{i}.jpg", b"x")
        self.assertTrue(self.run_pass(workers=3).ok)
        self.assertEqual(peak[0], 3)

    def test_recipe_json_waits_for_its_media_and_library_json_goes_last(self):
        self.target = Target(G, S, own_library=False)
        order = []
        real_put = self.s3.put
        self.s3.put = lambda b, k, *a, **kw: (order.append(k), real_put(b, k, *a, **kw))[1]
        self.gcs.put(G, "library.json", b"[]")
        self.gcs.put(G, "dish/recipe.json", b"{}")
        self.gcs.put(G, "dish/play.mp4", b"v")
        self.gcs.put(G, "dish/poster.jpg", b"p")
        self.assertTrue(self.run_pass(workers=1).ok)
        self.assertEqual(order[-2:], ["dish/recipe.json", "library.json"])

    def test_s3s_own_library_json_is_never_copied_rewritten_or_deleted_from_gcs(self):
        """Caleb, Nov 9: production's library.json is [] (no sample recipes). GCS's 10-entry list must never come back over it."""
        self.s3._store(S, "library.json", b"[]", {}, {})  # written in S3 itself, not copied
        self.gcs.put(G, "library.json", b'[{"id": "dish"}]')
        self.gcs.put(G, "dish/recipe.json", b"{}")
        self.gcs.put(G, "dish/play.mp4", b"v")
        result = self.run_pass()
        self.assertTrue(result.ok)
        self.assertEqual(result.excluded, 1)
        self.assertEqual(self.s3.current(S, "library.json"), b"[]")
        # An old pass's ledger row (from before this rule) changes nothing: not recopied when GCS's changes, not deleted when it goes.
        self.ledger.mark_copied(G, self.gcs.head(G, "library.json"), None)
        self.gcs.put(G, "library.json", b'[{"id": "dish"}, {"id": "more"}]')
        self.assertTrue(self.run_pass().ok)
        self.gcs.delete(G, "library.json")
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, "library.json"), b"[]")
        self.gcs.put(G, "library.json", b'[{"id": "dish"}]')
        self.ledger.mark_copied(G, self.gcs.head(G, "library.json"), None)
        rw.Rewriter(self.gcs, self.s3, self.ledger, Log(self.logs), NEW, sleep=lambda _: None).run([self.target], write=True)
        self.assertEqual(self.s3.current(S, "library.json"), b"[]")

    def test_recipe_json_is_held_while_its_media_fails(self):
        self.target = Target(G, S, own_library=False)
        self.gcs.put(G, "library.json", b"[]")
        self.gcs.put(G, "bad/recipe.json", b"{}")
        self.gcs.put(G, "bad/play.mp4", b"v")
        self.gcs.put(G, "good/recipe.json", b"{}")
        self.gcs.put(G, "good/play.mp4", b"v")
        self.gcs.corrupt_reads.add("bad/play.mp4")
        result = self.run_pass()
        self.assertFalse(result.ok)
        self.assertEqual(result.held, 2)
        self.assertIsNone(self.s3.current(S, "bad/recipe.json"))
        self.assertIsNone(self.s3.current(S, "library.json"))
        self.assertIsNotNone(self.s3.current(S, "good/recipe.json"))
        self.gcs.corrupt_reads.clear()
        self.assertTrue(self.run_pass().ok)
        self.assertIsNotNone(self.s3.current(S, "library.json"))

    def test_the_media_buckets_own_folders_are_not_copied(self):
        for key in ("jobs/x-ab12cd.json", "trash/x/play.mp4", "cancellations/x.json", "deletions/x.json"):
            self.gcs.put(G, key, b"{}")
        self.gcs.put(G, "x/play.mp4", b"v")
        result = self.run_pass()
        self.assertEqual(result.copied, 1)
        self.assertEqual(result.excluded, 4)
        self.assertEqual(list(self.s3.list_keys(S)), [("x/play.mp4", 1)])

    def test_the_uploads_bucket_copies_everything(self):
        self.target = Target("test-uploads", "s3-uploads")
        self.gcs.put("test-uploads", "jobs/x.mov", b"v")
        self.assertEqual(self.run_pass().copied, 1)

    def test_the_time_budget_stops_starting_files_and_deletes_still_run(self):
        clock = [0.0]
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        for i in range(5):
            self.gcs.put(G, f"dish/{i}.jpg", b"x")
        real_read = self.gcs.read

        def slow_read(*a, **k):
            clock[0] += 10
            return real_read(*a, **k)

        self.gcs.read = slow_read
        s = Syncer(self.gcs, self.s3, self.ledger, Log(self.logs), Config(workers=1, time_budget_s=15), sleep=lambda _: None,
                   clock=lambda: clock[0])
        result = s.run_pass([self.target])
        self.assertEqual(result.copied, 2)
        self.assertEqual(result.out_of_time, 3)
        self.assertFalse(result.ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_a_cost_above_the_cap_is_refused_before_anything_moves(self):
        self.gcs.put(G, "dish/play.mp4", b"x" * 1000)
        with self.assertRaisesRegex(Refused, "cap"):
            self.run_pass(max_cost_usd=0.0000001)
        self.assertEqual(self.gcs.faults.calls["read"], 0)

    def test_a_lost_ledger_is_refused_because_deletes_would_stop_reaching_s3(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.gcs.delete(G, FAMILY_KEY)
        self.ledger.close()
        for p in self.state.parent.glob("state.sqlite*"):
            p.unlink()
        self.ledger = Ledger(self.state)
        with self.assertRaisesRegex(Refused, "rebuild-ledger"):
            self.run_pass()
        report_mod.rebuild_ledger(self.s3, self.ledger, [self.target], Log(self.logs))
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_a_rebuilt_ledger_remembers_a_delete_made_in_s3(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        self.s3.delete(S, FAMILY_KEY)
        self.ledger.close()
        for p in self.state.parent.glob("state.sqlite*"):
            p.unlink()
        self.ledger = Ledger(self.state)
        report_mod.rebuild_ledger(self.s3, self.ledger, [self.target], Log(self.logs))
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, FAMILY_KEY))

    def test_recopy_missing_is_by_request_only(self):
        self.gcs.put(G, "dish/1.jpg", b"x")
        self.run_pass()
        self.s3.delete(S, "dish/1.jpg")
        self.run_pass()
        self.assertIsNone(self.s3.current(S, "dish/1.jpg"))
        self.assertEqual(self.run_pass(recopy_missing=True).copied, 1)
        self.assertEqual(self.s3.current(S, "dish/1.jpg"), b"x")

    def test_two_runs_at_once_are_refused(self):
        with report_mod.hold_lock(self.state):
            with self.assertRaisesRegex(Refused, "already running"):
                with report_mod.hold_lock(self.state):
                    pass


class Privacy(Base):
    """No key, no family name, no file contents in anything the tool prints."""

    def test_logs_and_reports_hold_no_key_or_contents(self):
        name = "shreya-pawar"
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.gcs.put(G, f"{name}-chai/recipe.json", json.dumps({"cook": name}).encode())
        self.gcs.corrupt_reads.add(f"{name}-chai/recipe.json")
        self.run_pass()
        self.gcs.corrupt_reads.clear()
        self.s3.put(S, f"{name}-foreign/x.jpg", b"x", {}, {}, crc32c(b"x"))
        self.gcs.delete(G, FAMILY_KEY)
        self.gcs.put(G, f"{name}-new/x.jpg", b"xx")
        self.s3.faults.transient["put"] = 50
        self.run_pass()
        self.s3.faults.transient["put"] = 0
        self.run_pass()
        text = self.logs.getvalue()
        text += json.dumps(report_mod.report(self.gcs, self.s3, self.ledger, [self.target], deep=True))
        text += json.dumps(dry_run(self.gcs, self.ledger, [self.target], Config()))
        self.assertNotIn("shreya", text)
        self.assertNotIn("poha", text)
        self.assertNotIn("grandmother", text)
        self.assertTrue(text)

    def test_the_log_refuses_a_key_field(self):
        with self.assertRaises(ValueError):
            Log(io.StringIO()).event("x", key=FAMILY_KEY)

    def test_the_ledger_is_private_to_this_user(self):
        self.assertEqual(os.stat(self.state).st_mode & 0o777, 0o600)

    def test_unknown_errors_log_their_type_and_not_their_message(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)

        def boom(*a, **k):
            raise RuntimeError(f"failed on gs://{G}/{FAMILY_KEY}")

        self.s3.put = boom
        result = self.run_pass()
        self.assertEqual(result.failed, 1)
        self.assertNotIn("shreya", self.logs.getvalue())
        self.assertEqual(self.row(FAMILY_KEY)["error"], "RuntimeError")


class DryRun(Base):
    def test_a_dry_run_changes_nothing(self):
        self.gcs.put(G, "dish/1.jpg", b"x")
        self.run_pass()
        self.gcs.delete(G, "dish/1.jpg")
        self.gcs.put(G, "dish/2.jpg", b"xx")
        self.gcs.put(G, "dish/3.jpg", b"xxx")
        self.ledger.close()
        before = _all_bytes(self.state)
        self.ledger = Ledger(self.state, readonly=True)
        puts, reads = self.s3.puts, self.gcs.faults.calls["read"]
        out = dry_run(self.gcs, self.ledger, [self.target], Config())
        self.assertEqual((self.s3.puts, self.gcs.faults.calls["read"]), (puts, reads))
        self.assertIsNotNone(self.s3.current(S, "dish/1.jpg"))
        self.assertEqual(_all_bytes(self.state), before)
        b = out["buckets"][G]
        self.assertEqual(b["would_copy"]["new"]["files"], 2)
        self.assertEqual(b["would_copy"]["new"]["bytes"], 5)
        self.assertEqual(b["would_delete_from_s3"], 1)

    def test_a_dry_run_doesnt_count_what_a_tombstone_keeps_out(self):
        self.gcs.put(G, FAMILY_KEY, SECRET_BODY)
        self.run_pass()
        blob = self.gcs.buckets[G][FAMILY_KEY]
        self.gcs.delete(G, FAMILY_KEY)
        self.run_pass()
        self.gcs.buckets[G][FAMILY_KEY] = blob
        b = dry_run(self.gcs, self.ledger, [self.target], Config())["buckets"][G]
        self.assertEqual(b["kept_gone_by_tombstone"], 1)
        self.assertEqual(b["would_copy"]["new"]["files"], 0)

    def test_a_dry_run_on_no_ledger_creates_none(self):
        missing = Path(self.dir.name) / "nothing.sqlite"
        ledger = Ledger(missing, readonly=True)
        self.addCleanup(ledger.close)
        self.gcs.put(G, "dish/1.jpg", b"x" * 100)
        out = dry_run(self.gcs, ledger, [self.target], Config())
        self.assertEqual(out["buckets"][G]["would_copy"]["new"]["files"], 1)
        self.assertFalse(missing.exists())

    def test_a_dry_run_says_what_it_costs(self):
        gb = 10 ** 9
        est = costs.estimate(100 * gb, objects=1000, parts=1100, list_pages=2)
        self.assertAlmostEqual(est["google"]["egress_usd"], 12.0, places=2)
        self.assertAlmostEqual(est["aws"]["storage_usd_per_month"], 2.3, places=2)
        self.assertAlmostEqual(est["aws"]["put_usd"], 1102 * 0.005 / 1000, places=6)
        self.assertGreater(est["one_time_usd"], 12)

    def test_egress_prices_come_down_in_tiers(self):
        self.assertAlmostEqual(costs.egress_usd(2000 * 10 ** 9), 1000 * 0.12 + 1000 * 0.11, places=2)
        self.assertAlmostEqual(costs.egress_usd(11_000 * 10 ** 9), 1000 * 0.12 + 9000 * 0.11 + 1000 * 0.08, places=2)
        self.assertEqual(costs.egress_usd(0), 0)


class Report(Base):
    def test_a_clean_pair_reports_in_step(self):
        self.gcs.put(G, "dish/1.jpg", b"x")
        self.gcs.put(G, "jobs/x.json", b"{}")
        self.run_pass()
        out = report_mod.report(self.gcs, self.s3, self.ledger, [self.target], deep=True)
        b = out["buckets"][G]
        self.assertTrue(out["in_step"])
        self.assertEqual((b["in_step"], b["excluded"]), (1, 1))

    def test_every_difference_is_named(self):
        for k in ("a/1.jpg", "b/1.jpg", "c/1.jpg", "d/1.jpg", "e/1.jpg"):
            self.gcs.put(G, k, b"x")
        self.run_pass()
        self.gcs.put(G, "new/1.jpg", b"x")          # not copied yet
        self.gcs.put(G, "b/1.jpg", b"changed")      # GCS has moved on
        self.s3.delete(S, "c/1.jpg")                # S3 lost it
        self.gcs.delete(G, "d/1.jpg")               # owed a delete
        self.s3.put(S, "foreign/1.jpg", b"x", {}, {}, crc32c(b"x"))
        self.s3.objects[S]["e/1.jpg"][-1].data = b"xy"
        out = report_mod.report(self.gcs, self.s3, self.ledger, [self.target], deep=True)
        b = out["buckets"][G]
        self.assertFalse(out["in_step"])
        self.assertEqual(b["not_copied_yet"]["count"], 1)
        self.assertEqual(b["changed_in_gcs"]["count"], 1)
        self.assertEqual(b["missing_in_s3"]["count"], 1)
        self.assertEqual(b["delete_owed"]["count"], 1)
        self.assertEqual(b["not_copied_by_this_tool"]["count"], 1)
        self.assertEqual(b["size_differs"]["count"], 1)

    def test_a_deep_report_catches_same_size_different_bytes(self):
        self.gcs.put(G, "a/1.jpg", b"xx")
        self.run_pass()
        v = self.s3.objects[S]["a/1.jpg"][-1]
        v.data, v.crc32c = b"yy", crc32c(b"yy")
        b = report_mod.report(self.gcs, self.s3, self.ledger, [self.target], deep=True)["buckets"][G]
        self.assertEqual(b["checksum_differs"]["count"], 1)
        b = report_mod.report(self.gcs, self.s3, self.ledger, [self.target])["buckets"][G]
        self.assertEqual(b["checksum_differs"]["count"], 0)

    def test_a_stale_catch_up_is_flagged(self):
        clock = [1000.0]
        self.ledger.clock = lambda: clock[0]
        s = Syncer(self.gcs, self.s3, self.ledger, Log(self.logs), Config(), sleep=lambda _: None, clock=lambda: clock[0])
        s.run_pass([self.target])
        clock[0] += 7 * 3600
        out = report_mod.report(self.gcs, self.s3, self.ledger, [self.target], clock=lambda: clock[0], stale_hours=6)
        self.assertTrue(out["catch_up_is_stale"])
        self.assertEqual(round(out["hours_since_last_good_pass"]), 7)


MEDIA = "https://storage.googleapis.com/test-media"
NEW = "https://media.homecookd.app"


def recipe_bytes(ids=("dish",), step_count=2):
    d = "dish"
    doc = {
        "id": d, "title": "Poha, the way दादी makes it",
        "media": {"video_url": f"{MEDIA}/{d}/play.mp4?v=111", "audio_url": f"{MEDIA}/{d}/voice.m4a?v=222",
                  "poster_url": f"{MEDIA}/{d}/poster.jpg?v=333", "duration_s": 60},
        "steps": [{"order": i + 1, "image_url": f"{MEDIA}/{d}/steps/{i + 1:02d}.jpg?v=44{i}"} for i in range(step_count)],
    }
    return json.dumps(doc, indent=2, ensure_ascii=False).encode()


def library_bytes():
    return json.dumps([{"id": "dish", "poster_url": f"{MEDIA}/dish/poster.jpg?v=333", "recipe_url": f"{MEDIA}/dish/recipe.json"},
                       {"id": "sample", "poster_url": "https://homecookd.app/media/stock/x.jpg", "recipe_url": f"{MEDIA}/sample/recipe.json"}],
                      indent=2).encode()


class Rewrite(Base):
    def setUp(self):
        super().setUp()
        self.target = Target(G, S, own_library=False)  # these cover the library rewrite itself; production's media keeps its own (Copy tests)

    def seed(self):
        for name in ("play.mp4", "voice.m4a", "poster.jpg", "steps/01.jpg", "steps/02.jpg"):
            self.gcs.put(G, f"dish/{name}", b"media")
        self.raw = recipe_bytes()
        self.lib = library_bytes()
        self.gcs.put(G, "dish/recipe.json", self.raw, content_type="application/json", cache_control="no-cache, max-age=0")
        self.gcs.put(G, "library.json", self.lib, content_type="application/json", cache_control="no-cache, max-age=0")
        self.gcs.put(G, "sample/recipe.json", b"{}", content_type="application/json")
        self.assertTrue(self.run_pass().ok)

    def rewriter(self):
        return rw.Rewriter(self.gcs, self.s3, self.ledger, Log(self.logs), NEW, sleep=lambda _: None)

    def test_the_dry_run_counts_and_writes_nothing(self):
        self.seed()
        puts = self.s3.puts
        out = self.rewriter().run([self.target], write=False)
        self.assertEqual(self.s3.puts, puts)
        self.assertEqual(out["files_to_change"], 2)
        self.assertEqual(out["links"]["media.video_url"], 1)
        self.assertEqual(out["links"]["steps.image_url"], 2)
        self.assertEqual(out["links"]["recipe_url"], 2)
        self.assertEqual(out["left_alone"]["other_host"], 1)
        self.assertIsNone(self.row("dish/recipe.json")["rewrite_state"])

    def test_s3_gets_the_new_links_and_gcs_keeps_the_old(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        got = json.loads(self.s3.current(S, "dish/recipe.json"))
        self.assertEqual(got["media"]["video_url"], f"{NEW}/dish/play.mp4?v=111")
        self.assertEqual(got["steps"][1]["image_url"], f"{NEW}/dish/steps/02.jpg?v=441")
        self.assertEqual(got["title"], "Poha, the way दादी makes it")
        lib = json.loads(self.s3.current(S, "library.json"))
        self.assertEqual(lib[0]["recipe_url"], f"{NEW}/dish/recipe.json")
        self.assertEqual(lib[1]["poster_url"], "https://homecookd.app/media/stock/x.jpg")
        self.assertEqual(self.gcs.buckets[G]["dish/recipe.json"].data, self.raw)
        self.assertEqual(self.gcs.buckets[G]["library.json"].data, self.lib)

    def test_headers_stay_and_the_checksum_is_the_new_files(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        head = self.s3.head(S, "dish/recipe.json")
        self.assertEqual(head.headers["cache_control"], "no-cache, max-age=0")
        self.assertEqual(head.headers["content_type"], "application/json")
        self.assertEqual(head.crc32c, crc32c(self.s3.current(S, "dish/recipe.json")))
        self.assertEqual(head.meta["gcs-crc32c"], crc32c(self.raw))

    def test_it_changes_only_the_links_byte_for_byte(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        now = self.s3.current(S, "dish/recipe.json")
        self.assertEqual(now.replace(NEW.encode(), MEDIA.encode()), self.raw)

    def test_a_repeat_writes_nothing(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        puts = self.s3.puts
        out = self.rewriter().run([self.target], write=True)
        self.assertEqual(self.s3.puts, puts)
        self.assertEqual(out["files_to_change"], 0)

    def test_the_way_back_restores_the_exact_bytes(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        out = self.rewriter().undo([self.target], write=True)
        self.assertEqual(out["restored"], 2)
        self.assertEqual(self.s3.current(S, "dish/recipe.json"), self.raw)
        self.assertEqual(self.s3.current(S, "library.json"), self.lib)
        self.assertNotIn("links-rewritten", self.s3.head(S, "library.json").meta)
        self.assertIsNone(self.row("library.json")["rewrite_state"])
        b = report_mod.report(self.gcs, self.s3, self.ledger, [self.target], deep=True)["buckets"][G]
        self.assertEqual(b["checksum_differs"]["count"], 0)

    def test_the_way_back_dry_run_writes_nothing(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        puts = self.s3.puts
        out = self.rewriter().undo([self.target], write=False)
        self.assertEqual((out["restored"], self.s3.puts), (2, puts))

    def test_when_the_way_back_cant_prove_itself_it_falls_back_to_a_fresh_copy(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        v = self.s3.objects[S]["dish/recipe.json"][-1]
        v.data = v.data + b" "
        v.crc32c = crc32c(v.data)
        out = self.rewriter().undo([self.target], write=True)
        self.assertEqual(out["need_fresh_copy"], 1)
        self.assertEqual(self.row("dish/recipe.json")["state"], "failed")
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, "dish/recipe.json"), self.raw)

    def test_a_link_to_a_file_not_in_s3_stays_on_gcs(self):
        for name in ("voice.m4a", "poster.jpg", "steps/01.jpg", "steps/02.jpg"):
            self.gcs.put(G, f"dish/{name}", b"media")
        self.gcs.put(G, "dish/recipe.json", recipe_bytes())
        self.assertTrue(self.run_pass().ok)
        out = self.rewriter().run([self.target], write=True)
        self.assertEqual(out["left_alone"]["target_not_in_s3"], 1)
        got = json.loads(self.s3.current(S, "dish/recipe.json"))
        self.assertEqual(got["media"]["video_url"], f"{MEDIA}/dish/play.mp4?v=111")
        self.assertEqual(got["media"]["audio_url"], f"{NEW}/dish/voice.m4a?v=222")
        self.assertEqual(self.row("dish/recipe.json")["rewrite_state"], "partial")
        # It catches up once the file arrives, and the way back still proves itself.
        self.gcs.put(G, "dish/play.mp4", b"media")
        self.assertTrue(self.run_pass().ok)
        self.rewriter().run([self.target], write=True)
        got = json.loads(self.s3.current(S, "dish/recipe.json"))
        self.assertEqual(got["media"]["video_url"], f"{NEW}/dish/play.mp4?v=111")
        self.assertEqual(self.row("dish/recipe.json")["rewrite_state"], "full")
        self.rewriter().undo([self.target], write=True)
        self.assertEqual(self.s3.current(S, "dish/recipe.json"), recipe_bytes())

    def test_a_new_generation_in_gcs_comes_over_and_is_rewritten_again(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        newer = recipe_bytes(step_count=1)
        self.gcs.put(G, "dish/recipe.json", newer)
        self.assertTrue(self.run_pass().ok)
        self.assertEqual(self.s3.current(S, "dish/recipe.json"), newer)
        self.assertIsNone(self.row("dish/recipe.json")["rewrite_state"])
        self.rewriter().run([self.target], write=True)
        self.assertIn(NEW.encode(), self.s3.current(S, "dish/recipe.json"))

    def test_a_field_it_doesnt_know_makes_it_refuse_the_file(self):
        doc = json.loads(recipe_bytes())
        doc["clip_url"] = doc["media"]["video_url"]  # the same link, in a field nothing here knows
        self.seed()
        self.gcs.put(G, "dish/recipe.json", json.dumps(doc, indent=2).encode())
        self.run_pass()
        out = self.rewriter().run([self.target], write=True)
        self.assertEqual(out["refused_files"], 1)
        self.assertNotIn(NEW, self.s3.current(S, "dish/recipe.json").decode())

    def test_a_file_that_already_names_the_new_host_is_refused(self):
        """Its way back couldn't restore the exact bytes, so nothing changes."""
        doc = json.loads(recipe_bytes())
        doc["media"]["poster_url"] = f"{NEW}/dish/poster.jpg"
        self.seed()
        self.gcs.put(G, "dish/recipe.json", json.dumps(doc, indent=2).encode())
        self.run_pass()
        out = self.rewriter().run([self.target], write=True)
        self.assertEqual(out["refused_files"], 1)

    def test_a_broken_json_file_is_left_alone(self):
        self.seed()
        self.gcs.put(G, "dish/recipe.json", b"{not json")
        self.run_pass()
        out = self.rewriter().run([self.target], write=True)
        self.assertEqual(out["refused_files"], 1)
        self.assertEqual(self.s3.current(S, "dish/recipe.json"), b"{not json")

    def test_a_file_deleted_before_the_rewrite_isnt_brought_back(self):
        self.seed()
        self.gcs.delete(G, "dish/recipe.json")
        self.run_pass()
        puts = self.s3.puts
        self.rewriter().run([self.target], write=True)
        self.assertIsNone(self.s3.current(S, "dish/recipe.json"))
        self.assertEqual(self.s3.puts - puts, 1)  # library.json only

    def test_a_file_deleted_from_gcs_but_not_yet_from_s3_isnt_rewritten(self):
        self.seed()
        self.gcs.delete(G, "dish/recipe.json")
        puts = self.s3.puts
        self.rewriter().run([self.target], write=True)
        self.assertEqual(self.s3.puts - puts, 1)  # library.json only
        self.assertTrue(self.run_pass().ok)
        self.assertIsNone(self.s3.current(S, "dish/recipe.json"))

    def test_a_file_deleted_while_being_rewritten_is_removed(self):
        self.seed()
        self.s3.faults.before("put", "dish/recipe.json", lambda: self.gcs.delete(G, "dish/recipe.json"))
        self.rewriter().run([self.target], write=True)
        self.assertIsNone(self.s3.current(S, "dish/recipe.json"))
        self.assertEqual(self.row("dish/recipe.json")["state"], "deleted")

    def test_a_crash_after_the_write_is_finished_by_the_next_run(self):
        self.seed()
        self.rewriter().run([self.target], write=True)
        self.ledger.clear_rewrite(G, "dish/recipe.json", None)  # as if the ledger's write never happened
        out = self.rewriter().run([self.target], write=True)
        self.assertEqual(out["files_to_change"], 0)
        self.assertEqual(self.row("dish/recipe.json")["rewrite_state"], "full")
        b = report_mod.report(self.gcs, self.s3, self.ledger, [self.target], deep=True)["buckets"][G]
        self.assertEqual(b["checksum_differs"]["count"], 0)
        self.rewriter().undo([self.target], write=True)
        self.assertEqual(self.s3.current(S, "dish/recipe.json"), self.raw)

    def test_a_denied_write_stops_and_reports(self):
        self.seed()
        self.s3.faults.deny.add("put")
        out = self.rewriter().run([self.target], write=True)
        self.assertEqual(out["denied"], f"put was denied on {S}")
        self.assertEqual(self.s3.current(S, "dish/recipe.json"), self.raw)

    def test_split_url_for_the_database_backfill(self):
        """SCHEMA.md section 5, item 7."""
        self.assertEqual(rw.split_gcs_url("https://storage.googleapis.com/edible-media-1/dish/play.mp4?v=123"),
                         ("edible-media-1", "dish/play.mp4", "123"))
        self.assertEqual(rw.split_gcs_url("https://storage.googleapis.com/edible-media-1/dish/a%20b.jpg"),
                         ("edible-media-1", "dish/a b.jpg", None))
        self.assertIsNone(rw.split_gcs_url("https://homecookd.app/media/stock/x.jpg"))
        self.assertIsNone(rw.split_gcs_url("https://storage.googleapis.com/edible-media-1/"))


REAL_MAP = ["--map", "edible-media-379797517579=homecookd-production-media-111"]
FAKE_MAP = ["--map", f"{G}={S}"]
LOCAL = ["--gcs-endpoint", "http://localhost:15462", "--s3-endpoint", "http://localhost:15462"]


class Refusal(Base):
    """The flag named for the rule, and nothing short of it."""

    def main(self, *argv):
        self.made = 0

        def make(_args):
            self.made += 1
            return self.gcs, self.s3

        out, err = io.StringIO(), io.StringIO()
        code = media_copy.main([*argv], make_stores=make, out=out, err=err)
        return code, out.getvalue(), err.getvalue()

    def state_args(self):
        return ["--state", str(self.state)]

    def test_real_buckets_are_refused_without_the_flag_and_nothing_is_contacted(self):
        self.ledger.close()
        for cmd in (["sync", "--write"], ["rewrite", "--write", "--media-base", NEW], ["rewrite", "--undo", "--write", "--media-base", NEW]):
            code, _, err = self.main(*cmd, *REAL_MAP, *self.state_args())
            self.assertEqual(code, media_copy.EXIT_REFUSED, cmd)
            self.assertEqual(self.made, 0, cmd)
            self.assertIn(media_copy.WRITE_FLAG, err)
        self.ledger = Ledger(self.state)

    def test_the_read_flag_doesnt_allow_a_write(self):
        self.ledger.close()
        code, _, err = self.main("sync", "--write", media_copy.READ_FLAG, *REAL_MAP, *self.state_args())
        self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0))
        self.ledger = Ledger(self.state)

    def test_read_only_commands_on_real_buckets_need_their_own_flag(self):
        self.ledger.close()
        for cmd in (["sync"], ["report"], ["rewrite", "--media-base", NEW], ["rebuild-ledger"]):
            code, _, err = self.main(*cmd, *REAL_MAP, *self.state_args())
            self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0), cmd)
            self.assertIn(media_copy.READ_FLAG, err)
        self.ledger = Ledger(self.state)

    def test_an_env_setting_doesnt_count(self):
        self.ledger.close()
        os.environ["REAL_FAMILY_MEDIA_CALEB_OK_PRIVACY_LISTS_AWS"] = "1"
        self.addCleanup(os.environ.pop, "REAL_FAMILY_MEDIA_CALEB_OK_PRIVACY_LISTS_AWS", None)
        code, _, _ = self.main("sync", "--write", *REAL_MAP, *self.state_args())
        self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0))
        self.ledger = Ledger(self.state)

    def test_an_endpoint_that_isnt_local_is_real_whatever_the_bucket_is_called(self):
        self.ledger.close()
        for ends in (["--gcs-endpoint", "https://storage.googleapis.com", "--s3-endpoint", "http://localhost:15462"],
                     ["--gcs-endpoint", "http://localhost:15462"], ["--s3-endpoint", "http://localhost.evil.example"], []):
            code, _, _ = self.main("sync", "--write", *FAKE_MAP, *ends, *self.state_args())
            self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0), ends)
        self.ledger = Ledger(self.state)

    def test_a_real_bucket_name_on_a_local_endpoint_is_still_refused(self):
        self.ledger.close()
        code, _, _ = self.main("sync", "--write", *REAL_MAP, *LOCAL, *self.state_args())
        self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0))
        self.ledger = Ledger(self.state)

    def test_with_the_flag_it_runs(self):
        self.ledger.close()
        self.gcs.put("edible-media-379797517579", "dish/play.mp4", b"v")
        code, out, _ = self.main("sync", "--write", media_copy.WRITE_FLAG, *REAL_MAP, *self.state_args())
        self.assertEqual((code, self.made), (0, 1))
        self.assertEqual(self.s3.current("homecookd-production-media-111", "dish/play.mp4"), b"v")
        self.assertEqual(json.loads(out)["copied"], 1)
        self.ledger = Ledger(self.state)

    def test_local_endpoints_with_test_buckets_need_no_flag(self):
        self.ledger.close()
        self.gcs.put(G, "dish/play.mp4", b"v")
        code, _, _ = self.main("sync", "--write", *FAKE_MAP, *LOCAL, *self.state_args())
        self.assertEqual(code, 0)
        self.assertEqual(self.s3.current(S, "dish/play.mp4"), b"v")
        self.ledger = Ledger(self.state)

    def test_real_media_never_goes_to_staging_even_with_the_flag(self):
        self.ledger.close()
        code, _, err = self.main("sync", "--write", media_copy.WRITE_FLAG, "--map", "edible-media-1=homecookd-staging-media-111",
                                 *self.state_args())
        self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0))
        self.assertIn("staging", err)
        self.ledger = Ledger(self.state)

    def test_a_renamed_real_bucket_counts_as_real_for_staging_too(self):
        self.ledger.close()
        code, _, _ = self.main("sync", "--write", media_copy.WRITE_FLAG, "--map", "homecookd-media-1=homecookd-staging-media-111",
                               *self.state_args())
        self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0))
        self.ledger = Ledger(self.state)

    def test_a_test_bucket_on_real_gcs_can_go_to_staging_with_the_flag(self):
        """The first run on real services, with no family data."""
        self.ledger.close()
        code, _, _ = self.main("sync", "--write", media_copy.WRITE_FLAG, "--map", "test-media=homecookd-staging-media-111", *self.state_args())
        self.assertEqual((code, self.made), (0, 1))
        self.ledger = Ledger(self.state)

    def test_real_media_never_goes_to_a_local_endpoint(self):
        self.ledger.close()
        code, _, _ = self.main("sync", "--write", media_copy.WRITE_FLAG, *REAL_MAP, "--s3-endpoint", "http://localhost:15462",
                               *self.state_args())
        self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0))
        self.ledger = Ledger(self.state)

    def test_the_rule_is_in_the_help_text(self):
        for cmd in ([], ["sync"], ["rewrite"], ["report"], ["rebuild-ledger"]):
            out = io.StringIO()
            with self.assertRaises(SystemExit), _redirect(out):
                media_copy.main([*cmd, "--help"], make_stores=None, out=out, err=out)
            text = " ".join(out.getvalue().split())
            self.assertIn("Caleb's OK", text, cmd)
            self.assertIn("/privacy", text, cmd)
            self.assertIn(media_copy.WRITE_FLAG, text, cmd)

    def test_the_ledger_cant_live_in_the_repo(self):
        self.ledger.close()
        code, _, err = self.main("sync", "--write", *FAKE_MAP, *LOCAL, "--state", str(media_copy.REPO / "state.sqlite"))
        self.assertEqual((code, self.made), (media_copy.EXIT_REFUSED, 0))
        self.assertIn("repo", err)
        self.assertFalse((media_copy.REPO / "state.sqlite").exists())
        self.ledger = Ledger(self.state)

    def test_a_refused_pass_exits_refused(self):
        self.ledger.close()
        self.s3.versioning = None
        code, _, err = self.main("sync", "--write", *FAKE_MAP, *LOCAL, *self.state_args())
        self.assertEqual(code, media_copy.EXIT_REFUSED)
        self.assertIn("versioning", err)
        self.ledger = Ledger(self.state)

    def test_a_dry_run_is_the_default_and_touches_nothing(self):
        self.ledger.close()
        self.gcs.put(G, "dish/play.mp4", b"v")
        code, out, _ = self.main("sync", *FAKE_MAP, *LOCAL, *self.state_args())
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["buckets"][G]["would_copy"]["new"]["files"], 1)
        self.assertEqual(self.s3.puts, 0)
        self.ledger = Ledger(self.state)

    def test_a_stale_report_exits_failed(self):
        self.ledger.close()
        self.main("sync", "--write", *FAKE_MAP, *LOCAL, *self.state_args())
        code, out, _ = self.main("report", *FAKE_MAP, *LOCAL, *self.state_args(), "--fail-if-stale-hours", "0")
        self.assertEqual(code, media_copy.EXIT_FAILED)
        self.ledger = Ledger(self.state)


class _redirect:
    """argparse prints help to sys.stdout."""

    def __init__(self, stream):
        self.stream = stream

    def __enter__(self):
        self.old, sys.stdout = sys.stdout, self.stream

    def __exit__(self, *_):
        sys.stdout = self.old


class Checksums(unittest.TestCase):
    def test_known_value(self):
        # The standard CRC32C check value of "123456789" is 0xE3069283.
        self.assertEqual(crc32c(b"123456789"), "4waSgw==")

    def test_running_matches_whole(self):
        self.assertEqual(Crc().update(b"1234").update(b"56789").b64(), crc32c(b"123456789"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
