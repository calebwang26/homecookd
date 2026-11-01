"""The real SDK adapters in stores.py, against stand-ins on this machine. Nothing here reaches a cloud.

    pip install -r tools/media-copy/requirements-test.txt
    python tools/media-copy/test_stores.py

S3Store runs against moto, in this process. GcsStore needs fake-gcs-server, so those tests skip unless FAKE_GCS_URL is set:

    docker run -d --rm --name hc-media-fakegcs -p 15462:4443 fsouza/fake-gcs-server:1.52.2 -scheme http -public-host localhost:15462
    FAKE_GCS_URL=http://localhost:15462 python tools/media-copy/test_stores.py

Neither stand-in is S3 or GCS. They prove the calls are well-formed and the errors map. They don't prove S3's full-object checksum
rules or GCS's generation pins on the real services: docs/build/MEDIA-MIGRATION.md lists what a first staging run has to confirm.
"""
from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import Denied, Log, SourceGone, crc32c  # noqa: E402
from ledger import Ledger  # noqa: E402
from stores import S3Store  # noqa: E402
from sync import Config, Syncer, Target  # noqa: E402

try:
    import boto3
    from moto import mock_aws
except ImportError:
    boto3 = None

for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
    os.environ[name] = "testing"  # never a real login: moto answers, and nothing leaves this machine
os.environ["AWS_DEFAULT_REGION"] = "us-west-2"
os.environ.pop("AWS_PROFILE", None)
os.environ.pop("AWS_ENDPOINT_URL", None)

FAKE_GCS_URL = os.environ.get("FAKE_GCS_URL")
BUCKET = "s3-test-media"
RULES = [{"ID": "old", "Status": "Enabled", "Filter": {}, "NoncurrentVersionExpiration": {"NoncurrentDays": 28},
          "Expiration": {"ExpiredObjectDeleteMarker": True}, "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}}]


def make_bucket(client, name: str, versioned: bool = True, rules: list | None = None) -> None:
    client.create_bucket(Bucket=name, CreateBucketConfiguration={"LocationConstraint": "us-west-2"})
    if versioned:
        client.put_bucket_versioning(Bucket=name, VersioningConfiguration={"Status": "Enabled"})
    if rules:
        client.put_bucket_lifecycle_configuration(Bucket=name, LifecycleConfiguration={"Rules": rules})


@unittest.skipIf(boto3 is None, "boto3 and moto aren't installed")
class S3Adapter(unittest.TestCase):
    def setUp(self):
        self.mock = mock_aws()
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.client = boto3.client("s3", region_name="us-west-2")
        make_bucket(self.client, BUCKET, rules=RULES)
        self.s3 = S3Store(client=self.client)

    def test_preflight_reads_what_the_bucket_says(self):
        self.assertEqual(self.s3.versioning_status(BUCKET), "Enabled")
        self.assertEqual(self.s3.noncurrent_days(BUCKET), 28)
        self.assertTrue(self.s3.aborts_stale_uploads(BUCKET))

    def test_preflight_on_a_bare_bucket(self):
        make_bucket(self.client, "bare", versioned=False)
        self.assertIsNone(self.s3.versioning_status("bare"))
        self.assertIsNone(self.s3.noncurrent_days("bare"))
        self.assertFalse(self.s3.aborts_stale_uploads("bare"))

    def test_a_rule_on_one_prefix_doesnt_count(self):
        make_bucket(self.client, "scoped", rules=[{"ID": "x", "Status": "Enabled", "Filter": {"Prefix": "a/"},
                                                   "NoncurrentVersionExpiration": {"NoncurrentDays": 1}}])
        self.assertIsNone(self.s3.noncurrent_days("scoped"))

    def test_put_head_get_keep_metadata_and_checksum(self):
        data = b"family video"
        vid = self.s3.put(BUCKET, "a/b.mp4", data, {"gcs-generation": "7"}, {"content_type": "video/mp4", "cache_control": "max-age=1"}, crc32c(data))
        self.assertTrue(vid)
        head = self.s3.head(BUCKET, "a/b.mp4")
        self.assertEqual((head.size, head.crc32c, head.version_id), (len(data), crc32c(data), vid))
        self.assertEqual(head.meta["gcs-generation"], "7")
        self.assertEqual(head.headers, {"content_type": "video/mp4", "cache_control": "max-age=1"})
        self.assertEqual(self.s3.get(BUCKET, "a/b.mp4"), data)
        self.assertEqual(list(self.s3.list_keys(BUCKET)), [("a/b.mp4", len(data))])

    def test_missing_is_none(self):
        self.assertIsNone(self.s3.head(BUCKET, "nope"))
        self.assertIsNone(self.s3.get(BUCKET, "nope"))

    def test_multipart(self):
        part = b"x" * (5 * 1024 * 1024)
        tail = b"tail"
        upload = self.s3.begin_multipart(BUCKET, "big.mp4", {"gcs-generation": "9"}, {"content_type": "video/mp4"})
        parts = [self.s3.upload_part(BUCKET, "big.mp4", upload, 1, part, crc32c(part)),
                 self.s3.upload_part(BUCKET, "big.mp4", upload, 2, tail, crc32c(tail))]
        vid = self.s3.complete_multipart(BUCKET, "big.mp4", upload, parts, crc32c(part + tail))
        self.assertTrue(vid)
        head = self.s3.head(BUCKET, "big.mp4")
        self.assertEqual(head.size, len(part) + len(tail))
        self.assertEqual(head.meta["gcs-generation"], "9")
        self.assertEqual(self.s3.get(BUCKET, "big.mp4"), part + tail)

    def test_abort_and_the_stale_sweep(self):
        upload = self.s3.begin_multipart(BUCKET, "big.mp4", {}, {})
        self.assertEqual(list(self.s3.stale_multipart(BUCKET, 3600)), [("big.mp4", upload)])  # moto dates every upload 2010
        self.s3.abort_multipart(BUCKET, "big.mp4", upload)
        self.assertEqual(list(self.s3.stale_multipart(BUCKET, 3600)), [])

    def test_a_recent_upload_isnt_stale(self):
        from datetime import datetime, timezone

        class Paginator:
            def paginate(self, **_):
                return [{"Uploads": [{"Key": "new.mp4", "UploadId": "u", "Initiated": datetime.now(timezone.utc)}]}]

        class Client:
            def get_paginator(self, _):
                return Paginator()

        self.assertEqual(list(S3Store(client=Client()).stale_multipart(BUCKET, 3600)), [])

    def test_delete_is_a_marker_and_the_bytes_stay_as_an_old_version(self):
        data = b"family video"
        self.s3.put(BUCKET, "a/b.mp4", data, {"gcs-generation": "7"}, {}, crc32c(data))
        self.s3.delete(BUCKET, "a/b.mp4")
        self.assertIsNone(self.s3.head(BUCKET, "a/b.mp4"))
        self.assertEqual(list(self.s3.list_keys(BUCKET)), [])
        versions = self.client.list_object_versions(Bucket=BUCKET)
        self.assertEqual(len(versions["Versions"]), 1)
        self.assertEqual(len(versions["DeleteMarkers"]), 1)

    def test_latest_entries_finds_the_version_under_a_marker(self):
        self.s3.put(BUCKET, "kept.jpg", b"1", {"gcs-generation": "1"}, {}, crc32c(b"1"))
        first = self.s3.put(BUCKET, "gone.jpg", b"2", {"gcs-generation": "2"}, {}, crc32c(b"2"))
        self.s3.delete(BUCKET, "gone.jpg")
        entries = list(self.s3.latest_entries(BUCKET))
        self.assertEqual(entries, [("gone.jpg", True, first), ("kept.jpg", False, None)])
        self.assertEqual(self.s3.head(BUCKET, "gone.jpg", first).meta["gcs-generation"], "2")

    def test_a_missing_bucket_is_an_error_and_not_empty(self):
        with self.assertRaises(Exception) as caught:
            list(self.s3.list_keys("no-such-bucket"))
        self.assertNotIn("a/b.mp4", str(caught.exception))

    def test_a_403_becomes_denied_and_names_no_key(self):
        from botocore.exceptions import ClientError

        class Refuses:
            def put_object(self, **_):
                raise ClientError({"Error": {"Code": "AccessDenied", "Message": "on shreya-pawar/x"},
                                   "ResponseMetadata": {"HTTPStatusCode": 403}}, "PutObject")

        with self.assertRaises(Denied) as caught:
            S3Store(client=Refuses()).put("b", "shreya-pawar/x", b"", {}, {}, crc32c(b""))
        self.assertNotIn("shreya", str(caught.exception))

    def test_error_codes(self):
        from botocore.exceptions import ClientError, ConnectTimeoutError
        from common import BadChecksum, Transient

        def raising(exc):
            class C:
                def put_object(self, **_):
                    raise exc
            return S3Store(client=C())

        def client_error(code, status):
            return ClientError({"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}, "PutObject")

        for exc, want in ((client_error("BadDigest", 400), BadChecksum), (client_error("SlowDown", 503), Transient),
                          (client_error("InternalError", 500), Transient), (ConnectTimeoutError(endpoint_url="x"), Transient)):
            with self.assertRaises(want):
                raising(exc).put("b", "k", b"", {}, {}, crc32c(b""))


class GcsMapping(unittest.TestCase):
    def test_every_header_is_read(self):
        try:
            from stores import GcsStore
            from types import SimpleNamespace
        except ImportError:
            self.skipTest("no SDK")
        b = SimpleNamespace(name="a/b.mp4", size="9", generation="7", metageneration="2", crc32c="c", md5_hash=None, content_type="video/mp4",
                            cache_control="public, max-age=3600", content_encoding="gzip", content_disposition="inline", content_language="mr")
        obj = GcsStore._to_object(b)
        self.assertEqual((obj.size, obj.generation, obj.metageneration, obj.md5), (9, 7, 2, None))
        self.assertEqual(obj.headers(), {"content_type": "video/mp4", "cache_control": "public, max-age=3600", "content_encoding": "gzip",
                                         "content_disposition": "inline", "content_language": "mr"})


@unittest.skipUnless(FAKE_GCS_URL and boto3 is not None, "needs FAKE_GCS_URL, boto3 and moto")
class GcsAdapter(unittest.TestCase):
    """GcsStore against fake-gcs-server, then a whole pass through both real SDKs."""

    def setUp(self):
        from stores import GcsStore
        self.gcs = GcsStore(FAKE_GCS_URL)
        self.bucket = f"test-media-{uuid.uuid4().hex[:8]}"
        self.gcs.client.create_bucket(self.bucket)

    def put(self, key: str, data: bytes, **kw):
        blob = self.gcs.client.bucket(self.bucket).blob(key)
        blob.upload_from_string(data, content_type=kw.get("content_type", "application/octet-stream"))
        blob.reload()
        return blob

    def test_list_and_head(self):
        self.put("a/1.jpg", b"one", content_type="image/jpeg")
        self.put("b/2.jpg", b"two")
        listed = {o.key: o for o in self.gcs.list(self.bucket)}
        self.assertEqual(set(listed), {"a/1.jpg", "b/2.jpg"})
        self.assertEqual(listed["a/1.jpg"].crc32c, crc32c(b"one"))
        self.assertEqual(listed["a/1.jpg"].size, 3)
        self.assertGreater(listed["a/1.jpg"].generation, 0)
        self.assertEqual({o.key for o in self.gcs.list(self.bucket, "a/")}, {"a/1.jpg"})
        self.assertEqual(self.gcs.head(self.bucket, "a/1.jpg").content_type, "image/jpeg")
        self.assertIsNone(self.gcs.head(self.bucket, "nope"))

    def test_read_a_range(self):
        blob = self.put("a/1.jpg", b"0123456789")
        self.assertEqual(self.gcs.read(self.bucket, "a/1.jpg", blob.generation, 0, 10), b"0123456789")
        self.assertEqual(self.gcs.read(self.bucket, "a/1.jpg", blob.generation, 2, 5), b"234")

    def test_reading_a_deleted_file_is_source_gone(self):
        blob = self.put("a/1.jpg", b"x")
        self.gcs.client.bucket(self.bucket).blob("a/1.jpg").delete()
        with self.assertRaises(SourceGone):
            self.gcs.read(self.bucket, "a/1.jpg", blob.generation, 0, 1)

    def test_a_read_asks_for_the_listed_generation(self):
        """fake-gcs-server ignores the pin on a read, so this checks only that it's sent, as the stored bytes. Real GCS answering 412 is
        on the list of things a first real run has to confirm, and if it didn't, the checksum check still stops the copy."""
        seen = {}

        class Blob:
            def download_as_bytes(self, **kw):
                seen.update(kw)
                return b"x"

        class Bucket:
            def blob(self, _):
                return Blob()

        class Client:
            def bucket(self, _):
                return Bucket()

        from stores import GcsStore
        store = GcsStore.__new__(GcsStore)
        store.client = Client()
        store.read("b", "k", 77, 2, 5)
        self.assertEqual((seen["if_generation_match"], seen["raw_download"], seen["start"], seen["end"]), (77, True, 2, 4))

    def test_a_missing_bucket_isnt_every_file_deleted(self):
        with self.assertRaises(Denied):
            self.gcs.list("test-no-such-bucket")

    def test_a_whole_pass_through_both_sdks(self):
        with mock_aws():
            client = boto3.client("s3", region_name="us-west-2")
            make_bucket(client, BUCKET, rules=RULES)
            s3 = S3Store(client=client)
            t = Target(self.bucket, BUCKET)
            # All small: moto's whole-object checksum on a multipart upload isn't a real CRC32C, so a big file would fail its check.
            # test_multipart covers those calls, and test_media_copy.py covers the checks around them.
            big = bytes(range(256)) * 1024
            self.put("dish/poster.jpg", b"poster", content_type="image/jpeg")
            self.put("dish/play.mp4", big, content_type="video/mp4")
            self.put("trash/old/play.mp4", b"deleted recipe")
            self.put("gone/x.jpg", b"to delete")
            logs = io.StringIO()
            with tempfile.TemporaryDirectory(prefix="media-copy-e2e-") as d:
                ledger = Ledger(Path(d) / "state.sqlite")
                cfg = Config()
                result = Syncer(self.gcs, s3, ledger, Log(logs), cfg).run_pass([t])
                self.assertTrue(result.ok, result.as_dict())
                self.assertEqual(result.copied, 3)
                self.assertEqual(s3.get(BUCKET, "dish/play.mp4"), big)
                self.assertEqual(s3.head(BUCKET, "dish/poster.jpg").headers["content_type"], "image/jpeg")
                self.assertIsNone(s3.head(BUCKET, "trash/old/play.mp4"))

                again = Syncer(self.gcs, s3, ledger, Log(logs), cfg).run_pass([t])
                self.assertEqual((again.copied, again.ok), (0, True))

                self.gcs.client.bucket(self.bucket).blob("gone/x.jpg").delete()
                third = Syncer(self.gcs, s3, ledger, Log(logs), cfg).run_pass([t])
                self.assertTrue(third.ok)
                self.assertEqual(third.deleted, 1)
                self.assertIsNone(s3.head(BUCKET, "gone/x.jpg"))
                ledger.close()


if __name__ == "__main__":
    unittest.main(verbosity=1)
