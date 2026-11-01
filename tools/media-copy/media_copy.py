#!/usr/bin/env python3
"""Copies homecookd's media from GCS to S3 and keeps the two in step until the switch. docs/build/MEDIA-MIGRATION.md.

    sync             one pass; a dry run with costs unless you pass --write
    report           what differs, with ids and never keys
    rewrite          the links inside S3's recipe.json and library.json; a dry run unless you pass --write; --undo is the way back
    rebuild-ledger   a lost ledger, rebuilt from S3
"""
from __future__ import annotations

import argparse
import contextlib
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import EXIT_DENIED, EXIT_FAILED, EXIT_OK, EXIT_REFUSED, FAST_CRC, Denied, Log, Refused  # noqa: E402,F401
from ledger import Ledger  # noqa: E402
from report import hold_lock, rebuild_ledger, report  # noqa: E402
from rewrite import GCS_HOST, Rewriter  # noqa: E402
from sync import Config, Syncer, Target, dry_run  # noqa: E402

REPO = Path(__file__).resolve().parent.parent.parent
WRITE_FLAG = "--real-family-media-caleb-ok-privacy-lists-aws"
READ_FLAG = "--real-buckets-read-only-caleb-ok"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

RULE = f"""\
THE RULE. Copying family media to AWS needs Caleb's OK in chat, and /privacy must list AWS first. This tool refuses real buckets
unless told otherwise by name:
  {WRITE_FLAG}
      you have Caleb's OK for this run, and homecookd.app/privacy lists AWS as live. Needed for anything that writes to S3.
  {READ_FLAG}
      you have Caleb's OK to list the real buckets. Dry runs and reports only: nothing is copied.
Anything that isn't a test bucket on local endpoints counts as real. Real media never goes to a staging bucket or a local endpoint,
with any flag: staging holds no real data. No environment variable can stand in for these flags.
"""


def _local(url: str | None) -> bool:
    return bool(url) and urlsplit(url).hostname in LOCAL_HOSTS


def _is_real_source(args, gcs: str) -> bool:
    """Today's buckets by name, and any other bucket on real GCS that isn't plainly a test one (buckets can be renamed)."""
    return gcs.startswith("edible-") or (not _local(args.gcs_endpoint) and not gcs.startswith("test-"))


def check_guard(args, targets: list[Target], writes: bool) -> None:
    """Runs before any client exists, so a refusal contacts nothing."""
    state = Path(args.state).resolve()
    if state.is_relative_to(REPO):
        raise Refused("the ledger holds object keys and can't live in the repo. Point --state outside it")
    for t in targets:
        if _is_real_source(args, t.gcs) and "staging" in t.s3:
            raise Refused(f"real media never goes to staging ({t.s3}): staging holds no real data")
        if _is_real_source(args, t.gcs) and _local(args.s3_endpoint):
            raise Refused("real media never goes to a local endpoint")
    if _local(args.gcs_endpoint) and _local(args.s3_endpoint):
        return
    if getattr(args, WRITE_FLAG[2:].replace("-", "_")):
        return
    if writes:
        raise Refused(f"these are real buckets, and this would write to them. It needs {WRITE_FLAG}: Caleb's OK in chat, and "
                      "/privacy listing AWS first")
    if not getattr(args, READ_FLAG[2:].replace("-", "_")):
        raise Refused(f"these are real buckets. Reading them needs {READ_FLAG}: Caleb's OK in chat")


def _targets(args) -> list[Target]:
    targets = []
    for pair in args.map:
        gcs, sep, s3 = pair.partition("=")
        if not (sep and gcs and s3):
            raise Refused("--map takes GCS_BUCKET=S3_BUCKET")
        targets.append(Target(gcs, s3))
    return targets


def real_stores(args):
    from stores import GcsStore, S3Store  # the SDKs load only here, past the guard
    if not (_local(args.gcs_endpoint) and _local(args.s3_endpoint)) and not FAST_CRC:
        raise Refused("install google-crc32c with its C extension: the pure Python checksum is far too slow for real files")
    return GcsStore(args.gcs_endpoint), S3Store(args.s3_endpoint)


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--state", required=True, help="the ledger's path, outside the repo, on a disk that lasts")
    common.add_argument("--map", action="append", required=True, metavar="GCS_BUCKET=S3_BUCKET", help="repeat for each bucket")
    common.add_argument("--gcs-endpoint", help="a local emulator, for tests")
    common.add_argument("--s3-endpoint", help="a local emulator, for tests")
    common.add_argument(WRITE_FLAG, action="store_true", help="see THE RULE below")
    common.add_argument(READ_FLAG, action="store_true", help="see THE RULE below")

    p = argparse.ArgumentParser(description=__doc__, epilog=RULE, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    def add(name: str, summary: str) -> argparse.ArgumentParser:
        return sub.add_parser(name, parents=[common], help=summary, description=summary, epilog=RULE,
                              formatter_class=argparse.RawDescriptionHelpFormatter)

    s = add("sync", "One pass: finish owed deletes, copy what's new or changed, carry over deletions. A dry run unless --write.")
    s.add_argument("--write", action="store_true", help="actually do it")
    s.add_argument("--workers", type=int, default=8, help="files at once (default 8); memory is at most this x 64 MB")
    s.add_argument("--time-budget-s", type=float, default=1800, help="stop starting files after this long (default 1800)")
    s.add_argument("--max-cost-usd", type=float, default=25.0, help="refuse a pass estimated above this (default 25)")
    s.add_argument("--only-prefix", default="", help="only keys under this, for a pilot on the TEST family. Deletes stay in scope too")
    s.add_argument("--retry-failed", action="store_true", help="try files again that hit the attempts cap")
    s.add_argument("--recopy-missing", action="store_true",
                   help="copy again files this tool copied that S3 no longer has. Only once you know S3 lost them by mistake: "
                        "a purge deleting from S3 looks the same")
    s.add_argument("--allow-mass-delete", action="store_true", help="carry over a delete that looks too big, once you've looked")

    s = add("report", "What differs between GCS and S3. Exits 1 if anything does, or if the catch-up is stale.")
    s.add_argument("--deep", action="store_true", help="also compare each copy's checksum")
    s.add_argument("--fail-if-stale-hours", type=float, default=6, help="stale if no good pass in this many hours (default 6)")

    s = add("rewrite", "The links inside S3's recipe.json and library.json. GCS's copies never change. A dry run unless --write.")
    s.add_argument("--media-base", required=True, help="https://media.homecookd.app")
    s.add_argument("--write", action="store_true", help="actually do it")
    s.add_argument("--undo", action="store_true", help="the way back: S3's copies get their GCS links again, byte for byte")

    add("rebuild-ledger", "Rebuild a lost ledger from S3's versions and tags. Fills an empty ledger only.")
    return p


def main(argv: list[str] | None = None, make_stores=real_stores, out=None, err=None) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    args = build_parser().parse_args(argv)
    ledger = None
    try:
        targets = _targets(args)
        writes = bool(getattr(args, "write", False))
        check_guard(args, targets, writes)
        log = Log(err)
        emit = lambda result: print(json.dumps(result, indent=2), file=out)  # noqa: E731

        if args.command == "sync" and not writes:
            gcs, _ = make_stores(args)
            ledger = Ledger(args.state, readonly=True)
            cfg = Config(only_prefix=args.only_prefix)
            emit(dry_run(gcs, ledger, targets, cfg))
            return EXIT_OK

        if args.command == "report":
            gcs, s3 = make_stores(args)
            ledger = Ledger(args.state, readonly=True)
            result = report(gcs, s3, ledger, targets, deep=args.deep, stale_hours=args.fail_if_stale_hours)
            emit(result)
            return EXIT_OK if result["in_step"] and not result["catch_up_is_stale"] else EXIT_FAILED

        if args.command == "rewrite":
            base = args.media_base
            if not base.startswith("https://") or base.startswith(GCS_HOST):
                raise Refused("--media-base must be https, and not the GCS host")
            gcs, s3 = make_stores(args)
            with hold_lock(args.state) if writes else contextlib.nullcontext():
                ledger = Ledger(args.state, readonly=not writes)
                rewriter = Rewriter(gcs, s3, ledger, log, base)
                result = rewriter.undo(targets, writes) if args.undo else rewriter.run(targets, writes)
                emit(result)
                return EXIT_DENIED if result["denied"] else EXIT_OK if result["ok"] else EXIT_FAILED

        if args.command == "rebuild-ledger":
            _, s3 = make_stores(args)
            with hold_lock(args.state):
                ledger = Ledger(args.state)
                emit(rebuild_ledger(s3, ledger, targets, log))
                return EXIT_OK

        cfg = Config(workers=max(1, args.workers), time_budget_s=args.time_budget_s, max_cost_usd=args.max_cost_usd,
                     only_prefix=args.only_prefix, retry_failed=args.retry_failed, recopy_missing=args.recopy_missing,
                     allow_mass_delete=args.allow_mass_delete)
        gcs, s3 = make_stores(args)
        with hold_lock(args.state):
            ledger = Ledger(args.state)
            result = Syncer(gcs, s3, ledger, log, cfg).run_pass(targets)
            emit(result.as_dict())
            return result.exit_code
    except Refused as e:
        print(f"refused: {e}", file=err)
        return EXIT_REFUSED
    except Denied as e:
        print(f"denied: {e}", file=err)
        return EXIT_DENIED
    except Exception as e:  # noqa: BLE001 - an SDK's message can hold a key, so only the type is printed
        print(f"failed: {type(e).__name__}", file=err)
        return EXIT_FAILED
    finally:
        if ledger is not None:
            ledger.close()


if __name__ == "__main__":
    raise SystemExit(main())
