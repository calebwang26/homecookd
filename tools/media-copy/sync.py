"""One pass of the copy: GCS to S3, with deletions carried across. docs/build/MEDIA-MIGRATION.md explains the rules.

A pass, for each bucket:
  1. Finish every delete still owed, then list GCS and carry over what's gone. This comes first, so no slow copy can hold it up.
  2. Copy what's new or changed: media first, then recipe.json files whose media made it, then library.json.
  3. List GCS again and carry over anything deleted during the copy.

What keeps a deleted file from coming back:
  - a read is pinned to the listed generation, so it fails once the file is gone or replaced;
  - each copy is checked against GCS again after the write, and removed if the source went while it was being written;
  - a `copied` row whose key has left GCS is always deleted, by this pass or the next;
  - a tombstone refuses any generation up to the one that was deleted. Only a newer one, a real new upload, is copied.

Files this tool never copied aren't its business. After uploads move, the api and the worker write straight to S3, so an S3 file
with no ledger row is left alone, and a delete made in S3 isn't undone: a `copied` row is never copied again for the same generation.
"""
from __future__ import annotations

import math
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from threading import Event

import costs
from common import (EXIT_DENIED, EXIT_FAILED, EXIT_OK, META_CRC, META_GENERATION, META_MD5, META_METAGENERATION, BadChecksum, Crc,
                    Denied, GcsObject, Log, Refused, S3Head, SourceGone, Transient, with_retries)
from ledger import Ledger

# The media bucket's own folders. jobs/ holds a cook's name and dish in a status file only GCS readers use, the two marker folders
# are instructions to the laptop's worker, and trash/ is recipes someone deleted, which have no reason to reach a new company.
MEDIA_EXCLUDED = ("jobs/", "trash/", "cancellations/", "deletions/")
MAX_OLD_VERSION_DAYS = 28  # infra/modules/env/storage.tf. /privacy has 30 days, and S3's expiry can run a little late.
STALE_UPLOAD_S = 24 * 3600


@dataclass(frozen=True)
class Target:
    gcs: str
    s3: str

    @property
    def is_media(self) -> bool:
        return "media" in self.gcs

    def excluded(self, key: str) -> bool:
        return self.is_media and key.startswith(MEDIA_EXCLUDED)


@dataclass
class Config:
    workers: int = 8  # most bytes held in memory: workers x part_size
    part_size: int = 64 * 1024 * 1024
    time_budget_s: float = 1800  # stops starting files after this, so the next pass's deletes aren't held up
    max_cost_usd: float = 25.0
    attempts_cap: int = 5
    retry_failed: bool = False
    recopy_missing: bool = False
    allow_mass_delete: bool = False
    mass_delete_min: int = 200
    mass_delete_share: float = 0.25
    only_prefix: str = ""


@dataclass
class PassResult:
    copied: int = 0
    resumed: int = 0
    failed: int = 0
    stuck: int = 0
    held: int = 0
    out_of_time: int = 0
    excluded: int = 0
    tombstoned: int = 0
    source_changed: int = 0
    deleted: int = 0
    delete_failed: int = 0
    foreign_at_deleted_key: int = 0
    denied: str | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not (self.denied or self.failed or self.stuck or self.held or self.out_of_time or self.delete_failed)

    @property
    def exit_code(self) -> int:
        return EXIT_DENIED if self.denied else EXIT_OK if self.ok else EXIT_FAILED

    def as_dict(self) -> dict:
        return {**asdict(self), "ok": self.ok}


@dataclass
class Plan:
    new: list[GcsObject] = field(default_factory=list)
    changed: list[GcsObject] = field(default_factory=list)
    retry: list[GcsObject] = field(default_factory=list)
    recopy: list[GcsObject] = field(default_factory=list)
    stuck: list[GcsObject] = field(default_factory=list)
    tombstoned: int = 0
    excluded: int = 0

    @property
    def items(self) -> list[GcsObject]:
        return self.new + self.changed + self.retry + self.recopy


def top_folder(key: str) -> str:
    return key.split("/", 1)[0]


def write_calls(size: int, part_size: int) -> int:
    return 1 if size <= part_size else math.ceil(size / part_size) + 2


def build_plan(t: Target, listing: dict[str, GcsObject], ledger: Ledger, cfg: Config, s3_keys: set[str] | None = None) -> Plan:
    plan = Plan()
    for key in sorted(listing):
        obj = listing[key]
        if t.excluded(key):
            plan.excluded += 1
            continue
        row = ledger.get(t.gcs, key)
        if row is None:
            plan.new.append(obj)
        elif row["tomb_generation"] is not None and obj.generation <= row["tomb_generation"]:
            plan.tombstoned += 1
        elif row["state"] == "deleted":
            plan.new.append(obj)  # a newer generation than the one deleted: a real new upload
        elif row["state"] == "deleting":
            continue  # the delete is owed first, and the next pass copies this
        elif row["state"] == "copied":
            if (row["generation"], row["metageneration"]) != (obj.generation, obj.metageneration):
                plan.changed.append(obj)
            elif s3_keys is not None and key not in s3_keys:
                plan.recopy.append(obj)
        elif row["attempts"] >= cfg.attempts_cap and not cfg.retry_failed:
            plan.stuck.append(obj)
        else:
            plan.retry.append(obj)
    return plan


def is_good_copy(head: S3Head | None, obj: GcsObject) -> bool:
    return (head is not None and head.size == obj.size and head.crc32c == obj.crc32c
            and head.meta.get(META_GENERATION) == str(obj.generation) and head.meta.get(META_CRC) == obj.crc32c)


def finish_delete(s3, ledger: Ledger, log: Log, t: Target, key: str, result: PassResult,
                  sleep: Callable[[float], None] = time.sleep) -> None:
    """Carries one delete across. Safe to repeat. A Denied goes up, with the row still owing the delete."""
    key_id = ledger.key_id(t.gcs, key)
    try:
        head = with_retries(lambda: s3.head(t.s3, key), sleep=sleep)
        if head is not None and META_GENERATION not in head.meta:
            result.foreign_at_deleted_key += 1  # someone else wrote here since, so it isn't this tool's to remove
            log.event("left_foreign_file", bucket=t.s3, key_id=key_id)
        elif head is not None:
            # A plain delete: on a versioned bucket a marker goes on top, and the bytes stay as an old version until the
            # bucket's lifecycle rule removes them. This tool has no permission to remove a version by hand.
            with_retries(lambda: s3.delete(t.s3, key), sleep=sleep)
            if with_retries(lambda: s3.head(t.s3, key), sleep=sleep) is not None:
                raise Transient("still there")
            result.deleted += 1
            log.event("deleted", bucket=t.s3, key_id=key_id)
        ledger.mark_deleted(t.gcs, key)
    except Transient:
        result.delete_failed += 1
        ledger.note_error(t.gcs, key, "Transient")
        log.event("delete_failed", bucket=t.s3, key_id=key_id)


class Syncer:
    def __init__(self, gcs, s3, ledger: Ledger, log: Log, cfg: Config | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.time):
        self.gcs, self.s3, self.ledger, self.log, self.sleep, self.clock = gcs, s3, ledger, log, sleep, clock
        self.cfg = cfg or Config()
        self.result = PassResult()
        self._stop = Event()
        self._denied: Denied | None = None

    def _retry(self, fn):
        return with_retries(fn, sleep=self.sleep)

    # ---------- the pass ----------

    def run_pass(self, targets: list[Target]) -> PassResult:
        """A Denied ends the pass with a result. A Refused goes up, because nothing should run at all."""
        r = self.result
        self._preflight(targets, r)
        self._refuse_if_ledger_lost(targets)
        refused = None
        for t in targets:  # a problem with one bucket must not hold up another bucket's deletes
            self._stop.clear()
            self._denied = None
            try:
                self._sync_target(t, r)
            except Denied as e:
                r.denied = r.denied or str(e)
                self.log.event("denied", op=e.op, bucket=e.bucket)
            except Transient:
                r.failed += 1  # a listing that kept failing. Nothing is decided from half an answer.
                self.log.event("listing_failed", bucket=t.gcs)
            except Refused as e:
                refused = refused or e
        if refused:
            raise refused
        now = self.clock()
        self.ledger.set_meta("last_pass_at", str(now))
        if r.ok:
            self.ledger.set_meta("last_good_pass_at", str(now))
        self.log.event("pass_done", **{k: v for k, v in r.as_dict().items() if k != "warnings"})
        return r

    def _preflight(self, targets: list[Target], r: PassResult) -> None:
        for t in targets:
            if self.s3.versioning_status(t.s3) != "Enabled":
                raise Refused(f"{t.s3} doesn't have versioning on, so a mistake here couldn't be undone")
            days = self.s3.noncurrent_days(t.s3)
            if days is None or days > MAX_OLD_VERSION_DAYS:
                raise Refused(f"{t.s3} keeps old versions for {days} days. It must expire them within {MAX_OLD_VERSION_DAYS}, "
                              "or a deleted file outlives what /privacy promises")
            if not self.s3.aborts_stale_uploads(t.s3):
                r.warnings.append(f"{t.s3} has no rule to abort abandoned uploads, so this tool's sweep is the only cleanup")
                self.log.event("warning", what="no_abort_rule", bucket=t.s3)

    def _refuse_if_ledger_lost(self, targets: list[Target]) -> None:
        """Without the ledger, deletes would silently stop reaching S3, and files deleted in S3 could come back."""
        if not self.ledger.is_empty():
            return
        for t in targets:
            for i, (key, _) in enumerate(self.s3.list_keys(t.s3)):
                if i >= 20:
                    break
                head = self.s3.head(t.s3, key)
                if head is not None and META_GENERATION in head.meta:
                    raise Refused(f"the ledger is empty but {t.s3} holds this tool's copies. Don't start over: run rebuild-ledger")

    def _sync_target(self, t: Target, r: PassResult) -> None:
        listing = self._list(t)
        self._carry_deletions(t, listing, r)
        self._abort_stale_uploads(t)
        s3_keys = None
        if self.cfg.recopy_missing:
            s3_keys = {k for k, _ in self.s3.list_keys(t.s3, self.cfg.only_prefix)}
        plan = build_plan(t, listing, self.ledger, self.cfg, s3_keys)
        r.excluded += plan.excluded
        r.tombstoned += plan.tombstoned
        r.stuck += len(plan.stuck)
        self._check_cost(t, plan)
        self._copy(t, plan, r)
        if self._denied:
            raise self._denied
        self._carry_deletions(t, self._list(t), r)

    def _list(self, t: Target) -> dict[str, GcsObject]:
        """Every live object in scope, excluded folders too: an excluded file isn't a deleted one."""
        return self._retry(lambda: {o.key: o for o in self.gcs.list(t.gcs, self.cfg.only_prefix)})

    def _check_cost(self, t: Target, plan: Plan) -> None:
        size = sum(o.size for o in plan.items)
        calls = sum(write_calls(o.size, self.cfg.part_size) for o in plan.items)
        one_time = costs.estimate(size, len(plan.items), calls, 2)["one_time_usd"]
        if plan.items and one_time > self.cfg.max_cost_usd:
            raise Refused(f"this pass would cost about ${one_time:.2f} for {t.gcs}, over the ${self.cfg.max_cost_usd:.2f} cap. "
                          "Check the dry run, then raise --max-cost-usd if it's right")

    def _abort_stale_uploads(self, t: Target) -> None:
        """Parts of an upload a crash left behind hold family bytes that no listing shows. Only ones the ledger knows are touched:
        a phone's upload to this bucket isn't ours."""
        for key, upload_id in self._retry(lambda: list(self.s3.stale_multipart(t.s3, STALE_UPLOAD_S))):
            if self.ledger.get(t.gcs, key) is not None:
                self._retry(lambda k=key, u=upload_id: self.s3.abort_multipart(t.s3, k, u))
                self.log.event("aborted_stale_upload", bucket=t.s3, key_id=self.ledger.key_id(t.gcs, key))

    # ---------- deletions ----------

    def _carry_deletions(self, t: Target, listing: dict[str, GcsObject], r: PassResult) -> None:
        self._drain_deleting(t, r)
        rows = [row for row in self.ledger.rows(t.gcs, "copied", "copying", "failed")
                if row["key"].startswith(self.cfg.only_prefix)]
        missing = [row["key"] for row in rows if row["key"] not in listing]
        if not missing:
            return
        # Small numbers just go: the uploads bucket can empty out on a quiet week, and a mistake is recoverable for 28 days.
        looks_wrong = len(missing) >= self.cfg.mass_delete_min and len(missing) / len(rows) > self.cfg.mass_delete_share
        if looks_wrong and not self.cfg.allow_mass_delete:
            self.log.event("mass_delete_held", bucket=t.gcs, missing=len(missing), of=len(rows))
            raise Refused(f"mass delete held: {len(missing)} of {len(rows)} copied files are missing from {t.gcs}. A wrong listing "
                          "looks like this. Look, then pass --allow-mass-delete if it's real. These deletes are owed until then")
        for key in missing:
            self.ledger.mark_deleting(t.gcs, key)
        self._drain_deleting(t, r)

    def _drain_deleting(self, t: Target, r: PassResult) -> None:
        for row in self.ledger.rows(t.gcs, "deleting"):
            if row["key"].startswith(self.cfg.only_prefix):
                finish_delete(self.s3, self.ledger, self.log, t, row["key"], r, self.sleep)

    # ---------- copying ----------

    def _copy(self, t: Target, plan: Plan, r: PassResult) -> None:
        deadline = self.clock() + self.cfg.time_budget_s
        held = {top_folder(o.key) for o in plan.stuck}
        items = plan.items
        media = [o for o in items if not o.key.endswith("recipe.json") and o.key != "library.json"]
        recipes = [o for o in items if o.key.endswith("recipe.json")]
        library = [o for o in items if o.key == "library.json"]

        with ThreadPoolExecutor(max_workers=self.cfg.workers) as pool:
            def run_stage(objs: list[GcsObject]) -> None:
                futures = [(o, pool.submit(self._task, t, o, deadline)) for o in objs]
                for o, f in futures:
                    outcome = f.result()
                    self._tally(outcome, r)
                    if outcome in ("failed", "out_of_time", "stopped", "denied"):
                        held.add(top_folder(o.key))

            run_stage(media)
            r.held += sum(1 for o in recipes if top_folder(o.key) in held)
            run_stage([o for o in recipes if top_folder(o.key) not in held])
            if library and held:
                r.held += len(library)  # it would list a recipe that isn't there yet
            elif library:
                run_stage(library)

    @staticmethod
    def _tally(outcome: str, r: PassResult) -> None:
        if outcome in ("copied", "resumed", "failed", "tombstoned", "out_of_time"):
            setattr(r, outcome, getattr(r, outcome) + 1)
        elif outcome == "source_gone":
            r.source_changed += 1

    def _task(self, t: Target, obj: GcsObject, deadline: float) -> str:
        if self._stop.is_set():
            return "stopped"
        if self.clock() >= deadline:
            return "out_of_time"
        try:
            return self.copy_one(t, obj)
        except Denied as e:
            self._denied = e
            self._stop.set()
            return "denied"
        except BaseException:
            self._stop.set()  # the machine dying, in the tests: nothing further should start
            raise

    def copy_one(self, t: Target, obj: GcsObject) -> str:
        """One file. Returns what happened. A Denied goes up, because the rest of the pass would hit it too."""
        key_id = self.ledger.key_id(t.gcs, obj.key)
        row = self.ledger.get(t.gcs, obj.key)
        if row is not None and row["tomb_generation"] is not None and obj.generation <= row["tomb_generation"]:
            self.log.event("refused_tombstoned", bucket=t.gcs, key_id=key_id)
            return "tombstoned"
        try:
            if row is not None and row["state"] in ("copying", "failed"):
                head = self._retry(lambda: self.s3.head(t.s3, obj.key))
                if is_good_copy(head, obj):  # the last run wrote it and died before saying so
                    self.ledger.mark_copied(t.gcs, obj, head.version_id)
                    self.log.event("resumed", bucket=t.s3, key_id=key_id)
                    return "resumed"

            self.ledger.mark_copying(t.gcs, obj)  # before any bytes move
            try:
                version_id = self._transfer(t, obj)
            except SourceGone:
                self.log.event("source_gone", bucket=t.gcs, key_id=key_id)
                return "source_gone"  # nothing was written. The next listing settles it.

            head = self._retry(lambda: self.s3.head(t.s3, obj.key))
            if not is_good_copy(head, obj):
                self.ledger.mark_failed(t.gcs, obj.key, "copy_differs")
                self.log.event("copy_differs", bucket=t.s3, key_id=key_id)
                self._retry(lambda: self.s3.delete(t.s3, obj.key))  # hide it. The next pass copies again.
                return "failed"
        except Denied:
            raise  # not this file's fault, so it doesn't count toward the attempts cap
        except Exception as e:  # noqa: BLE001 - an SDK's message can hold the key, so only its type goes anywhere
            return self._failed(t, obj, type(e).__name__)

        self.ledger.mark_copied(t.gcs, obj, version_id)
        self.log.event("copied", bucket=t.s3, key_id=key_id, size=obj.size)
        return self._recheck_source(t, obj)

    def _failed(self, t: Target, obj: GcsObject, why: str) -> str:
        self.ledger.mark_failed(t.gcs, obj.key, why)
        self.log.event("copy_failed", bucket=t.s3, key_id=self.ledger.key_id(t.gcs, obj.key), error=why)
        return "failed"

    def _recheck_source(self, t: Target, obj: GcsObject) -> str:
        """Closes the hard order: the read worked, then the file was deleted, then the write landed."""
        try:
            now = self._retry(lambda: self.gcs.head(t.gcs, obj.key))
        except Transient:
            return "copied"  # the row says copied, so the next listing still catches a delete
        if now is None:
            self.ledger.mark_deleting(t.gcs, obj.key)
            finish_delete(self.s3, self.ledger, self.log, t, obj.key, self.result, self.sleep)
        return "copied"

    def _transfer(self, t: Target, obj: GcsObject) -> str | None:
        meta = {META_GENERATION: str(obj.generation), META_METAGENERATION: str(obj.metageneration), META_CRC: obj.crc32c}
        if obj.md5:
            meta[META_MD5] = obj.md5
        if obj.size <= self.cfg.part_size:
            data = self._retry(lambda: self.gcs.read(t.gcs, obj.key, obj.generation, 0, obj.size))
            crc = Crc().update(data).b64()
            if len(data) != obj.size or crc != obj.crc32c:
                raise BadChecksum()
            return self._retry(lambda: self.s3.put(t.s3, obj.key, data, meta, obj.headers(), crc))

        upload_id = self._retry(lambda: self.s3.begin_multipart(t.s3, obj.key, meta, obj.headers()))
        try:
            whole, parts, start = Crc(), [], 0
            for number in range(1, math.ceil(obj.size / self.cfg.part_size) + 1):
                end = min(start + self.cfg.part_size, obj.size)
                data = self._retry(lambda s=start, e=end: self.gcs.read(t.gcs, obj.key, obj.generation, s, e))
                if len(data) != end - start:
                    raise BadChecksum()
                whole.update(data)
                part_crc = Crc().update(data).b64()
                parts.append(self._retry(lambda n=number, d=data, c=part_crc: self.s3.upload_part(t.s3, obj.key, upload_id, n, d, c)))
                start = end
            if whole.b64() != obj.crc32c:
                raise BadChecksum()
            return self._retry(lambda: self.s3.complete_multipart(t.s3, obj.key, upload_id, parts, obj.crc32c))
        except Exception:
            self._abort(t, obj.key, upload_id)
            raise

    def _abort(self, t: Target, key: str, upload_id: str) -> None:
        try:
            self._retry(lambda: self.s3.abort_multipart(t.s3, key, upload_id))
        except (Transient, Denied):
            self.log.event("abort_failed", bucket=t.s3, key_id=self.ledger.key_id(t.gcs, key))  # the sweep gets it next pass


def dry_run(gcs, ledger: Ledger, targets: list[Target], cfg: Config, sleep: Callable[[float], None] = time.sleep) -> dict:
    """What a pass would change and cost. Needs only a GCS listing and reads the ledger. It writes nothing and doesn't touch S3."""
    buckets, size, objects, calls, pages = {}, 0, 0, 0, 0
    for t in targets:
        listing = with_retries(lambda t=t: {o.key: o for o in gcs.list(t.gcs, cfg.only_prefix)}, sleep=sleep)
        plan = build_plan(t, listing, ledger, cfg)
        rows = [r for r in ledger.rows(t.gcs, "copied", "copying", "failed") if r["key"].startswith(cfg.only_prefix)]
        owed = len(ledger.rows(t.gcs, "deleting"))
        would_delete = sum(1 for r in rows if r["key"] not in listing) + owed
        would_copy = {name: {"files": len(objs), "bytes": sum(o.size for o in objs)}
                      for name, objs in (("new", plan.new), ("changed", plan.changed), ("retry", plan.retry))}
        buckets[t.gcs] = {
            "s3_bucket": t.s3,
            "listed": len(listing),
            "would_copy": would_copy,
            "would_delete_from_s3": would_delete,
            "excluded": plan.excluded,
            "stuck": len(plan.stuck),
            "kept_gone_by_tombstone": plan.tombstoned,
        }
        size += sum(o.size for o in plan.items)
        objects += len(plan.items)
        calls += sum(write_calls(o.size, cfg.part_size) for o in plan.items)
        pages += math.ceil(len(listing) / 1000) * 2 + 2
    return {"dry_run": True, "buckets": buckets, "cost": costs.estimate(size, objects, calls, pages)}
