"""The real GCS and S3 clients, narrowed to what the copy uses. fakes.py has the same shape. test_stores.py runs S3Store against moto
and GcsStore against a local fake-gcs-server. Neither has ever run against the real services.

Every call has a timeout and goes through a small retry here, and sync.py retries on top of that. SDK errors become our own errors,
with no message: an SDK's message can hold the object's key. No keys or .env are read here. Both SDKs find their own login.
"""
from __future__ import annotations

import contextlib
from datetime import datetime, timedelta, timezone

from common import BadChecksum, Denied, GcsObject, S3Head, SourceGone, Transient

GCS_TIMEOUT = (10, 300)  # connect, read
S3_CONNECT_S, S3_READ_S = 10, 300
S3_ATTEMPTS = 3
DENIED_CODES = {"403", "AccessDenied", "AllAccessDisabled", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken", "AccountProblem"}
MISSING_CODES = {"404", "NoSuchKey", "NotFound"}
BAD_BYTES_CODES = {"BadDigest", "InvalidDigest"}
TRANSIENT_CODES = {"500", "502", "503", "504", "InternalError", "ServiceUnavailable", "SlowDown", "RequestTimeout", "RequestTimeTooSkewed", "Throttling"}


class GcsStore:
    def __init__(self, endpoint: str | None = None):
        from google.cloud import storage
        if endpoint:
            from google.auth.credentials import AnonymousCredentials
            self.client = storage.Client(project="test", credentials=AnonymousCredentials(), client_options={"api_endpoint": endpoint})
        else:
            self.client = storage.Client()

    @contextlib.contextmanager
    def _errors(self, op: str, bucket: str, missing=SourceGone):
        from google.api_core import exceptions as g
        import requests
        try:
            yield
        except (g.Forbidden, g.Unauthorized):
            raise Denied(op, bucket) from None
        except (g.NotFound, g.PreconditionFailed):
            raise missing() from None
        except (g.TooManyRequests, g.ServerError, g.RetryError, requests.ConnectionError, requests.Timeout):
            raise Transient(op) from None

    @staticmethod
    def _to_object(b) -> GcsObject:
        return GcsObject(b.name, int(b.size), int(b.generation), int(b.metageneration), b.crc32c, b.md5_hash, b.content_type,
                         b.cache_control, b.content_encoding, b.content_disposition, b.content_language)

    def list(self, bucket: str, prefix: str = "") -> list[GcsObject]:
        """A missing bucket must not look like every file was deleted, so it's Denied. Any page failing fails the whole listing."""
        def no_bucket():
            return Denied("list", bucket)
        with self._errors("list", bucket, missing=no_bucket):
            return [self._to_object(b) for b in self.client.list_blobs(bucket, prefix=prefix or None, timeout=GCS_TIMEOUT)]

    def head(self, bucket: str, key: str) -> GcsObject | None:
        with self._errors("head", bucket):
            b = self.client.bucket(bucket).get_blob(key, timeout=GCS_TIMEOUT)
            return self._to_object(b) if b else None

    def read(self, bucket: str, key: str, generation: int, start: int = 0, end: int | None = None) -> bytes:
        """end is exclusive. if_generation_match is on the live object, so it fails once this generation is gone, even on a bucket
        that keeps old generations. raw_download: the bytes as stored, which is what GCS's checksum covers."""
        if end is not None and end <= start:
            return b""
        with self._errors("read", bucket):
            return self.client.bucket(bucket).blob(key).download_as_bytes(
                start=start, end=None if end is None else end - 1, if_generation_match=generation, raw_download=True,
                checksum=None, timeout=GCS_TIMEOUT)


class S3Store:
    def __init__(self, endpoint: str | None = None, client=None):
        if client is None:
            import boto3
            from botocore.config import Config
            client = boto3.client("s3", endpoint_url=endpoint, config=Config(
                connect_timeout=S3_CONNECT_S, read_timeout=S3_READ_S, retries={"total_max_attempts": S3_ATTEMPTS, "mode": "standard"}))
        self.client = client

    @contextlib.contextmanager
    def _errors(self, op: str, bucket: str):
        from botocore.exceptions import BotoCoreError, ClientError
        try:
            yield
        except ClientError as e:
            info = e.response.get("Error", {})
            code = str(info.get("Code", ""))
            status = str(e.response.get("ResponseMetadata", {}).get("HTTPStatusCode", ""))
            if code in DENIED_CODES or status == "403":
                raise Denied(op, bucket) from None
            if code in BAD_BYTES_CODES:
                raise BadChecksum() from None
            if code in TRANSIENT_CODES or status.startswith("5"):
                raise Transient(op) from None
            raise RuntimeError(f"S3 {op} answered {code or status}") from None
        except BotoCoreError:
            raise Transient(op) from None

    @staticmethod
    def _headers(extra: dict) -> dict[str, str]:
        names = {"ContentType": "content_type", "CacheControl": "cache_control", "ContentEncoding": "content_encoding",
                 "ContentDisposition": "content_disposition", "ContentLanguage": "content_language"}
        return {ours: extra[theirs] for theirs, ours in names.items() if extra.get(theirs)}

    @staticmethod
    def _extra(headers: dict[str, str]) -> dict:
        names = {"content_type": "ContentType", "cache_control": "CacheControl", "content_encoding": "ContentEncoding",
                 "content_disposition": "ContentDisposition", "content_language": "ContentLanguage"}
        return {names[k]: v for k, v in headers.items()}

    def versioning_status(self, bucket: str) -> str | None:
        with self._errors("GetBucketVersioning", bucket):
            return self.client.get_bucket_versioning(Bucket=bucket).get("Status")

    def _lifecycle(self, bucket: str) -> list[dict]:
        from botocore.exceptions import ClientError
        with self._errors("GetLifecycleConfiguration", bucket):
            try:
                return self.client.get_bucket_lifecycle_configuration(Bucket=bucket).get("Rules", [])
            except ClientError as e:
                if e.response.get("Error", {}).get("Code") == "NoSuchLifecycleConfiguration":
                    return []
                raise

    def noncurrent_days(self, bucket: str) -> int | None:
        """The rule that covers the whole bucket. A rule scoped to a prefix doesn't cover it, so it doesn't count."""
        days = []
        for rule in self._lifecycle(bucket):
            whole_bucket = not (rule.get("Filter") or {}).get("Prefix") and not rule.get("Prefix") and not (rule.get("Filter") or {}).get("And")
            if rule.get("Status") == "Enabled" and whole_bucket and rule.get("NoncurrentVersionExpiration"):
                days.append(rule["NoncurrentVersionExpiration"].get("NoncurrentDays"))
        days = [d for d in days if d is not None]
        return min(days) if days else None

    def aborts_stale_uploads(self, bucket: str) -> bool:
        return any(r.get("Status") == "Enabled" and r.get("AbortIncompleteMultipartUpload") for r in self._lifecycle(bucket))

    def list_keys(self, bucket: str, prefix: str = ""):
        with self._errors("ListBucket", bucket):
            for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
                for o in page.get("Contents") or []:
                    yield o["Key"], o["Size"]

    def head(self, bucket: str, key: str, version_id: str | None = None) -> S3Head | None:
        from botocore.exceptions import ClientError
        extra = {"VersionId": version_id} if version_id else {}
        with self._errors("HeadObject", bucket):
            try:
                res = self.client.head_object(Bucket=bucket, Key=key, ChecksumMode="ENABLED", **extra)
            except ClientError as e:
                code = str(e.response.get("Error", {}).get("Code", ""))
                status = str(e.response.get("ResponseMetadata", {}).get("HTTPStatusCode", ""))
                if code in MISSING_CODES or status == "404":
                    return None
                raise
        return S3Head(res["ContentLength"], res.get("ChecksumCRC32C"), dict(res.get("Metadata") or {}), res.get("VersionId"),
                      self._headers(res))

    def get(self, bucket: str, key: str) -> bytes | None:
        from botocore.exceptions import ClientError
        with self._errors("GetObject", bucket):
            try:
                return self.client.get_object(Bucket=bucket, Key=key)["Body"].read()
            except ClientError as e:
                if str(e.response.get("Error", {}).get("Code", "")) in MISSING_CODES:
                    return None
                raise

    def put(self, bucket: str, key: str, data: bytes, meta: dict, headers: dict, crc: str) -> str | None:
        """S3 checks the bytes against GCS's checksum on arrival, and answers BadDigest if they differ."""
        with self._errors("PutObject", bucket):
            res = self.client.put_object(Bucket=bucket, Key=key, Body=data, Metadata=meta, ChecksumAlgorithm="CRC32C", ChecksumCRC32C=crc,
                                         **self._extra(headers))
        return res.get("VersionId")

    def begin_multipart(self, bucket: str, key: str, meta: dict, headers: dict) -> str:
        with self._errors("CreateMultipartUpload", bucket):
            return self.client.create_multipart_upload(Bucket=bucket, Key=key, Metadata=meta, ChecksumAlgorithm="CRC32C",
                                                       ChecksumType="FULL_OBJECT", **self._extra(headers))["UploadId"]

    def upload_part(self, bucket: str, key: str, upload_id: str, number: int, data: bytes, crc: str) -> dict:
        with self._errors("UploadPart", bucket):
            res = self.client.upload_part(Bucket=bucket, Key=key, UploadId=upload_id, PartNumber=number, Body=data, ChecksumCRC32C=crc)
        return {"PartNumber": number, "ETag": res["ETag"], "ChecksumCRC32C": crc}

    def complete_multipart(self, bucket: str, key: str, upload_id: str, parts: list[dict], crc: str) -> str | None:
        with self._errors("CompleteMultipartUpload", bucket):
            res = self.client.complete_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id, MultipartUpload={"Parts": parts},
                                                        ChecksumCRC32C=crc, ChecksumType="FULL_OBJECT")
        return res.get("VersionId")

    def abort_multipart(self, bucket: str, key: str, upload_id: str) -> None:
        with self._errors("AbortMultipartUpload", bucket):
            self.client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)

    def stale_multipart(self, bucket: str, older_than_s: float):
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=older_than_s)
        with self._errors("ListMultipartUploads", bucket):
            for page in self.client.get_paginator("list_multipart_uploads").paginate(Bucket=bucket):
                for u in page.get("Uploads") or []:
                    if u["Initiated"] < cutoff:
                        yield u["Key"], u["UploadId"]

    def delete(self, bucket: str, key: str) -> None:
        """No VersionId, on purpose: this adds a delete marker. The tool's role has no s3:DeleteObjectVersion."""
        with self._errors("DeleteObject", bucket):
            self.client.delete_object(Bucket=bucket, Key=key)

    def latest_entries(self, bucket: str):
        """(key, is_marker, the newest real version under a marker). S3 lists a key's versions and markers newest first, on separate
        lists in each page, so this gathers them per key."""
        entries: dict[str, dict] = {}
        with self._errors("ListBucketVersions", bucket):
            for page in self.client.get_paginator("list_object_versions").paginate(Bucket=bucket):
                for m in page.get("DeleteMarkers") or []:
                    if m["IsLatest"]:
                        entries.setdefault(m["Key"], {})["marker"] = True
                for v in page.get("Versions") or []:
                    e = entries.setdefault(v["Key"], {})
                    if "newest" not in e or v["LastModified"] > e["newest"][0]:
                        e["newest"] = (v["LastModified"], v["VersionId"])
        for key in sorted(entries):
            e = entries[key]
            if e.get("marker"):
                yield key, True, e["newest"][1] if "newest" in e else None
            elif "newest" in e:
                yield key, False, None
