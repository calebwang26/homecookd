"""SQS and S3 for queue mode (docs/build/WORKER-MIGRATION.md). boto3 is imported only when a client is made here, so Convex
mode and the laptop never need it. The database and the logs only ever see keys.

S3Bucket is shaped like the google-cloud-storage bucket that publish.py was written against, so publish.publish_recipe runs
unchanged. It puts every upload in one attempt's own folder, so a worker that lost its claim can't overwrite what another one
published, and nothing shows until the final transaction points at that folder.
"""
from __future__ import annotations

import base64
import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

MAX_COVER_BYTES = 20_000_000  # worker.py's limit: anything this big is not her plate photo
PAGE_LIMIT = 10  # at most 10,000 objects in one listing: an upload folder holds a few clips


@dataclass(frozen=True)
class Message:
    id: str
    receipt: str
    body: str
    receive_count: int


def _config(**kw):
    from botocore.config import Config
    return Config(retries={"total_max_attempts": 5, "mode": "standard"}, **kw)


class SqsQueue:
    WAIT_S = 20

    def __init__(self, url: str, client=None):
        self.url = url
        if client is None:
            import boto3
            # read_timeout has to outlast the long poll.
            client = boto3.client("sqs", config=_config(connect_timeout=5, read_timeout=self.WAIT_S + 10))
        self.client = client

    def receive(self) -> Message | None:
        res = self.client.receive_message(QueueUrl=self.url, MaxNumberOfMessages=1, WaitTimeSeconds=self.WAIT_S,
                                          MessageSystemAttributeNames=["ApproximateReceiveCount"])
        for m in res.get("Messages") or []:
            return Message(m["MessageId"], m["ReceiptHandle"], m["Body"],
                           int((m.get("Attributes") or {}).get("ApproximateReceiveCount", 1)))
        return None

    def hold(self, msg: Message, seconds: int) -> None:
        """Keeps the message hidden for this many seconds from now; 0 hands it back at once."""
        self.client.change_message_visibility(QueueUrl=self.url, ReceiptHandle=msg.receipt, VisibilityTimeout=int(seconds))

    def delete(self, msg: Message) -> None:
        self.client.delete_message(QueueUrl=self.url, ReceiptHandle=msg.receipt)


class S3Blob:
    """What publish.py uses of a GCS blob. name is the full key, so publish's URLs name the attempt's folder."""

    def __init__(self, bucket: "S3Bucket", name: str):
        self.bucket, self.name = bucket, name
        self.cache_control: str | None = None
        self.md5_hash: str | None = None
        self.generation: str | None = None

    def _head(self) -> dict | None:
        return self.bucket.storage.head(self.bucket.name, self.name)

    def exists(self) -> bool:
        return self._head() is not None

    def reload(self) -> None:
        head = self._head() or {}
        # S3's ETag isn't an MD5 for a multipart upload, so the upload records its own.
        self.md5_hash = (head.get("Metadata") or {}).get("md5")
        self.generation = head.get("VersionId") or "0"

    def _extra(self, content_type: str, md5: str) -> dict:
        extra = {"ContentType": content_type, "Metadata": {"md5": md5}}
        if self.cache_control:
            extra["CacheControl"] = self.cache_control
        return extra

    def upload_from_filename(self, path: str, content_type: str, timeout: float | None = None) -> None:
        digest = hashlib.md5()
        with open(path, "rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                digest.update(block)
        md5 = base64.b64encode(digest.digest()).decode()
        self.bucket.storage.client.upload_file(path, self.bucket.name, self.name, ExtraArgs=self._extra(content_type, md5))
        self.generation = None  # the next versioned_url reads it back

    def upload_from_string(self, data: str, content_type: str) -> None:
        raw = data.encode()
        md5 = base64.b64encode(hashlib.md5(raw).digest()).decode()
        self.bucket.storage.client.put_object(Bucket=self.bucket.name, Key=self.name, Body=raw,
                                              **self._extra(content_type, md5))
        self.generation = None

    def download_as_text(self) -> str:
        res = self.bucket.storage.client.get_object(Bucket=self.bucket.name, Key=self.name)
        return res["Body"].read().decode()


class S3Bucket:
    """The media bucket as publish.py sees it. publish names objects "<recipe_id>/<file>"; here they land in "<prefix><file>".
    public_base is what publish.public_url builds links from, for the public recipe.json only: the database keeps keys."""

    def __init__(self, storage: "S3Storage", recipe_id: str, prefix: str, public_base: str):
        self.storage, self.recipe_id, self.prefix = storage, recipe_id, prefix
        self.name = storage.media
        self.public_base = public_base.rstrip("/")

    def key_for(self, name: str) -> str:
        return self.prefix + name.removeprefix(f"{self.recipe_id}/")

    def blob(self, name: str) -> S3Blob:
        return S3Blob(self, self.key_for(name))


class S3Storage:
    """All the S3 this worker does: read a job's raw upload, write its published files, delete on a cancel. Tests give it a fake
    client; nothing here needs boto3 unless it makes its own."""

    def __init__(self, uploads: str, media: str, private: str | None, media_base_url: str, client=None):
        self.uploads, self.media, self.private, self.media_base_url = uploads, media, private, media_base_url
        if client is None:
            import boto3
            client = boto3.client("s3", config=_config(connect_timeout=10, read_timeout=120))
        self.client = client

    @classmethod
    def from_env(cls) -> "S3Storage":
        return cls(os.environ["UPLOAD_BUCKET"], os.environ["MEDIA_BUCKET"], os.environ.get("PRIVATE_BUCKET"),
                   os.environ["MEDIA_BASE_URL"])

    def head(self, bucket: str, key: str) -> dict | None:
        try:
            return self.client.head_object(Bucket=bucket, Key=key)
        except Exception as e:  # noqa: BLE001 - botocore's ClientError, told apart by its code
            if (getattr(e, "response", None) or {}).get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def _list(self, bucket: str, prefix: str) -> list[dict]:
        found: list[dict] = []
        token = None
        for _ in range(PAGE_LIMIT):
            res = self.client.list_objects_v2(Bucket=bucket, Prefix=prefix, **({"ContinuationToken": token} if token else {}))
            found += res.get("Contents") or []
            token = res.get("NextContinuationToken")
            if not token:
                return found
        raise RuntimeError("too many objects under one prefix")

    def list_upload(self, upload_key: str) -> list[dict]:
        """The upload's objects by name: [{key, size, modified}]. upload_key names one object, or a folder of clips."""
        if not upload_key.endswith("/"):
            head = self.head(self.uploads, upload_key)
            if head is not None:
                return [{"key": upload_key, "size": head["ContentLength"], "modified": head["LastModified"]}]
        prefix = upload_key.rstrip("/") + "/"
        rows = [{"key": o["Key"], "size": o["Size"], "modified": o["LastModified"]}
                for o in self._list(self.uploads, prefix) if not o["Key"].endswith("/")]
        return sorted(rows, key=lambda r: r["key"])

    def download(self, key: str, size: int, dest: Path) -> None:
        """Into <name>.part, then renamed, so a file at dest is always complete. boto3 retries each part."""
        part = dest.with_name(dest.name + ".part")
        self.client.download_file(self.uploads, key, str(part))
        got = part.stat().st_size
        if got != size:
            raise RuntimeError(f"downloaded {got} of {size} bytes")
        part.replace(dest)

    def download_cover(self, key: str, dest: Path) -> Path | None:
        """The cook's plate photo. None when it can't be fetched: the cover is then a frame from the video."""
        try:
            head = self.head(self.private or "", key)
            if head is None or head["ContentLength"] > MAX_COVER_BYTES:
                return None
            self.client.download_file(self.private, key, str(dest))
            return dest
        except Exception:  # noqa: BLE001 - never fail a job over the cover
            return None

    def delete_upload(self, upload_key: str) -> int:
        """A cancelled job's raw video: its folder, or just the one object, never anything beside it."""
        return self._delete(self.uploads, [r["key"] for r in self.list_upload(upload_key)])

    def delete_media(self, prefix: str) -> int:
        return self._delete(self.media, [o["Key"] for o in self._list(self.media, prefix)])

    def _delete(self, bucket: str, keys: list[str]) -> int:
        for i in range(0, len(keys), 1000):
            batch = keys[i:i + 1000]
            answer = self.client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True})
            # S3 answers 200 even when some keys failed, and footage someone stopped would quietly stay. No keys in the error:
            # they name a family.
            failed = (answer or {}).get("Errors") or []
            if failed:
                raise RuntimeError(f"S3 refused {len(failed)} of {len(batch)} deletes: {failed[0].get('Code')}")
        return len(keys)

    def media_bucket(self, recipe_id: str, prefix: str) -> S3Bucket:
        return S3Bucket(self, recipe_id, prefix, self.media_base_url)
