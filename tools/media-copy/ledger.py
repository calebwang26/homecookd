"""The ledger: what this tool copied, what it has yet to delete, and what must never come back. SQLite, on the machine that runs
the tool, one row per GCS object. Each row is committed before the step it describes, so a crash leaves a state the next pass can
finish.

A row's state:
  copying   about to write, or may have written. The next pass checks S3 before it does anything.
  copied    S3 holds a verified copy of `generation`.
  failed    the last try failed. `s3_generation` still says what S3 holds, if anything.
  deleting  gone from GCS. S3's copy has yet to go. A pass retries this until it's confirmed.
  deleted   the tombstone: `key` is blanked, and `tomb_generation` is the newest generation known deleted.

A tombstone keeps only the salted id, so the ledger doesn't hold a dish title after someone's data is gone.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path

from common import GcsObject

SCHEMA = """
create table if not exists meta (name text primary key, value text not null);
create table if not exists objects (
  bucket text not null,
  key_id text not null,
  key text,
  state text not null check (state in ('copying', 'copied', 'failed', 'deleting', 'deleted')),
  generation integer,
  metageneration integer,
  s3_generation integer,
  tomb_generation integer,
  size integer,
  crc32c text,
  version_id text,
  attempts integer not null default 0,
  error text,
  rewrite_state text check (rewrite_state in ('partial', 'full')),
  rewritten_crc32c text,
  updated_at real not null,
  primary key (bucket, key_id)
);
create index if not exists objects_state on objects (bucket, state);
"""


class Ledger:
    def __init__(self, path: str | Path | None, readonly: bool = False, clock=time.time):
        """path None, or readonly on a file that doesn't exist yet, is an empty ledger in memory: a dry run writes nothing."""
        self.clock = clock
        self.readonly = readonly
        self.path = None if path is None else Path(path)
        self._lock = threading.Lock()
        if self.path is None or (readonly and not self.path.exists()):
            self._db = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
            self._db.executescript(SCHEMA)
        elif readonly:
            self._db = sqlite3.connect(f"{self.path.resolve().as_uri()}?mode=ro", uri=True, check_same_thread=False,
                                       isolation_level=None)
        else:
            # Holds object keys, so only this user reads it. Rollback journal, not WAL: a read-only dry run leaves no side files.
            # secure_delete overwrites a blanked key, so a tombstone's old key doesn't linger in the file's free space.
            os.close(os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600))
            self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
            self._db.execute("pragma journal_mode = delete")
            self._db.execute("pragma synchronous = full")
            self._db.execute("pragma secure_delete = on")
            self._db.executescript(SCHEMA)
        self._db.row_factory = sqlite3.Row
        self._salt = self._load_salt()

    def _load_salt(self) -> str:
        salt = self.get_meta("salt")
        if salt is None:
            salt = secrets.token_hex(16)
            if not self.readonly:
                self.set_meta("salt", salt)
        return salt

    def key_id(self, bucket: str, key: str) -> str:
        return hashlib.sha256(f"{self._salt}\0{bucket}\0{key}".encode()).hexdigest()[:16]

    def _run(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ---------- meta ----------

    def get_meta(self, name: str) -> str | None:
        rows = self._run("select value from meta where name = ?", (name,))
        return rows[0]["value"] if rows else None

    def set_meta(self, name: str, value: str) -> None:
        self._run("insert into meta (name, value) values (?, ?) on conflict (name) do update set value = excluded.value",
                  (name, value))

    # ---------- reads ----------

    def get(self, bucket: str, key: str) -> sqlite3.Row | None:
        rows = self._run("select * from objects where bucket = ? and key_id = ?", (bucket, self.key_id(bucket, key)))
        return rows[0] if rows else None

    def rows(self, bucket: str, *states: str) -> list[sqlite3.Row]:
        marks = ", ".join("?" for _ in states)
        return self._run(f"select * from objects where bucket = ? and state in ({marks})", (bucket, *states))

    def counts(self, bucket: str) -> dict[str, int]:
        rows = self._run("select state, count(*) n from objects where bucket = ? group by state", (bucket,))
        return {r["state"]: r["n"] for r in rows}

    def is_empty(self) -> bool:
        return self._run("select count(*) n from objects")[0]["n"] == 0

    # ---------- writes ----------

    def mark_copying(self, bucket: str, obj: GcsObject) -> None:
        self._run(
            """insert into objects (bucket, key_id, key, state, generation, metageneration, size, crc32c, updated_at)
               values (?, ?, ?, 'copying', ?, ?, ?, ?, ?)
               on conflict (bucket, key_id) do update set key = excluded.key, state = 'copying',
                 generation = excluded.generation, metageneration = excluded.metageneration, size = excluded.size,
                 crc32c = excluded.crc32c, error = null, updated_at = excluded.updated_at""",
            (bucket, self.key_id(bucket, obj.key), obj.key, obj.generation, obj.metageneration, obj.size, obj.crc32c,
             self.clock()))

    def mark_copied(self, bucket: str, obj: GcsObject, version_id: str | None) -> None:
        self._run(
            """update objects set state = 'copied', s3_generation = ?, version_id = ?, attempts = 0, error = null,
                 rewrite_state = null, rewritten_crc32c = null, updated_at = ? where bucket = ? and key_id = ?""",
            (obj.generation, version_id, self.clock(), bucket, self.key_id(bucket, obj.key)))

    def mark_failed(self, bucket: str, key: str, error: str) -> None:
        self._run("update objects set state = 'failed', attempts = attempts + 1, error = ?, updated_at = ? "
                  "where bucket = ? and key_id = ?", (error, self.clock(), bucket, self.key_id(bucket, key)))

    def mark_deleting(self, bucket: str, key: str, seen_generation: int | None = None) -> None:
        """Written before S3's delete, so a crash can't forget it and no copy can run for this generation."""
        self._run(
            """update objects set state = 'deleting', updated_at = ?,
                 tomb_generation = max(coalesce(tomb_generation, 0), coalesce(generation, 0), coalesce(s3_generation, 0), ?)
               where bucket = ? and key_id = ?""",
            (self.clock(), seen_generation or 0, bucket, self.key_id(bucket, key)))

    def note_error(self, bucket: str, key: str, error: str) -> None:
        self._run("update objects set attempts = attempts + 1, error = ?, updated_at = ? where bucket = ? and key_id = ?",
                  (error, self.clock(), bucket, self.key_id(bucket, key)))

    def mark_deleted(self, bucket: str, key: str) -> None:
        self._run(
            """update objects set state = 'deleted', key = null, s3_generation = null, version_id = null, attempts = 0,
                 error = null, rewrite_state = null, rewritten_crc32c = null, updated_at = ?
               where bucket = ? and key_id = ?""", (self.clock(), bucket, self.key_id(bucket, key)))

    def mark_rewritten(self, bucket: str, key: str, version_id: str | None, crc: str, state: str) -> None:
        self._run("update objects set version_id = coalesce(?, version_id), rewritten_crc32c = ?, rewrite_state = ?, updated_at = ? "
                  "where bucket = ? and key_id = ?", (version_id, crc, state, self.clock(), bucket, self.key_id(bucket, key)))

    def clear_rewrite(self, bucket: str, key: str, version_id: str | None) -> None:
        self._run("update objects set version_id = coalesce(?, version_id), rewritten_crc32c = null, rewrite_state = null, "
                  "updated_at = ? where bucket = ? and key_id = ?", (version_id, self.clock(), bucket, self.key_id(bucket, key)))

    def restore_copied(self, bucket: str, obj: GcsObject, version_id: str | None, rewritten: bool, crc: str | None) -> None:
        """rebuild-ledger: S3 says this generation is there."""
        self.mark_copying(bucket, obj)
        self.mark_copied(bucket, obj, version_id)
        if rewritten:
            self.mark_rewritten(bucket, obj.key, version_id, crc or obj.crc32c, "partial")

    def restore_deleted(self, bucket: str, key: str, generation: int) -> None:
        """rebuild-ledger: S3's newest entry for this key is a delete marker over this generation."""
        key_id = self.key_id(bucket, key)
        self._run(
            """insert into objects (bucket, key_id, key, state, tomb_generation, updated_at)
               values (?, ?, null, 'deleted', ?, ?)
               on conflict (bucket, key_id) do update set state = 'deleted', key = null,
                 tomb_generation = max(coalesce(tomb_generation, 0), excluded.tomb_generation), updated_at = excluded.updated_at""",
            (bucket, key_id, generation, self.clock()))
