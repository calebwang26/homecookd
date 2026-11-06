#!/usr/bin/env python3
"""The public sample library on an S3 media bucket: library.json, each sample's recipe.json, and the files they link to.
docs/build/MEDIA-MIGRATION.md, "The sample library".

    python sample_library.py --to BUCKET --media-base https://media.homecookd.app                              # dry run
    python sample_library.py --to BUCKET --media-base https://media.homecookd.app --write --library-bucket-caleb-ok

The samples are the made-up recipes in data/synthetic/ and their photos in data/synthetic/posters/, read from the repo: no GCS, no
family. --from-gcs ID adds one of the video samples on today's GCS media bucket (chicken-biryani, the gordon-* ones): its recipe.json
and exactly the files it links to, nothing else in its folder. Whatever is asked, a recipe is taken only if it says "sample": true
and isn't a family's. Every link points at --media-base, with ?v= so a changed file gets a new link past the CDN's cache.

library.json lists exactly what this run publishes, and it's written last, after every file it names. A key on the bucket that this
tool didn't write is never overwritten. Exit codes as media_copy.py: 0 fine, 1 failed, 2 refused, 3 permission denied.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (EXIT_DENIED, EXIT_FAILED, EXIT_OK, EXIT_REFUSED, FAST_CRC, BadChecksum, Denied, Refused,  # noqa: E402
                    crc32c, with_retries)
from media_copy import READ_FLAG, REPO, _local  # noqa: E402
from rewrite import GCS_HOST, _link_fields, _strings, split_gcs_url  # noqa: E402

SYNTHETIC = REPO / "data" / "synthetic"
GCS_MEDIA = "edible-media-379797517579"
WRITE_FLAG = "--library-bucket-caleb-ok"
MARK = {"written-by": "sample-library"}  # on every file this tool writes: a key without it is someone else's
JSON_HEADERS = {"content_type": "application/json", "cache_control": "no-cache, max-age=0"}  # pipeline/publish.py JSON_CACHE
POSTER_HEADERS = {"content_type": "image/jpeg", "cache_control": "public, max-age=3600"}  # publish.py MEDIA_CACHE
MAX_FILE = 2 << 30  # held in memory whole; no sample comes near it
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")
KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$")
# The media bucket's own folders (api/src/modules/accounts/outside.ts SHARED), and the worker's recipe-<job>/ folders (workerFolder).
RESERVED = {"library", "jobs", "trash", "cancellations", "deletions", "glasses"}

RULE = f"""\
THE RULE. Writing to a real bucket needs Caleb's OK in chat. This tool refuses one unless told by name:
  {WRITE_FLAG}
      you have Caleb's OK to put the sample library on this bucket. Needed for --write anywhere but a local endpoint.
  {READ_FLAG}
      you have Caleb's OK to read today's GCS media bucket. Needed for --from-gcs, dry run included.
--from-gcs never goes to a staging bucket or a local endpoint, with any flag (MEDIA-MIGRATION.md). The made-up samples from the repo
can go anywhere. No environment variable can stand in for these flags.
"""


@dataclass
class Put:
    key: str
    size: int
    crc: str
    headers: dict
    load: Callable[[], bytes]
    source: str  # "repo", "gcs" or "built"
    version: str = ""  # the ?v= on its link: GCS's generation, or a hash of the bytes


@dataclass
class Plan:
    recipes: list[dict]  # the recipe.json documents, links rewritten
    files: list[Put]  # media, then each recipe.json, then library.json
    library: list[dict]


def check_id(recipe_id: str) -> None:
    if not ID.match(recipe_id) or recipe_id in RESERVED or recipe_id.startswith("recipe-"):
        raise Refused(f"{recipe_id!r} can't be a library id: one lowercase segment, not a shared folder, not a worker's recipe-<job>")


def check_sample(doc, recipe_id: str, where: str) -> None:
    if not isinstance(doc, dict) or doc.get("id") != recipe_id:
        raise Refused(f"{where} isn't the recipe {recipe_id}")
    if doc.get("sample") is not True:
        raise Refused(f"{where} isn't a sample (\"sample\": true): only samples go in the public library")
    if doc.get("family") is True:
        raise Refused(f"{where} is a family's own recipe: it never goes in the public library")
    if not isinstance(doc.get("title"), str) or not isinstance((doc.get("cook") or {}).get("name"), str):
        raise Refused(f"{where} has no title or cook")


def check_schema(doc: dict, where: str) -> str:
    """pipeline/schema.py's Recipe, when pydantic is there. Says whether it was checked."""
    if str(REPO / "pipeline") not in sys.path:
        sys.path.append(str(REPO / "pipeline"))
    try:
        from schema import Recipe
    except ImportError:
        return "not checked (no pydantic)"
    try:
        Recipe.model_validate(doc)
    except ValueError as e:
        raise Refused(f"{where} fails pipeline/schema.py: {str(e)[:300]}") from None
    return "ok"


def no_old_links(doc: dict, where: str) -> None:
    if any("storage.googleapis.com" in s for s in _strings(doc)):
        raise Refused(f"{where} still names the GCS host after its links were moved: a link this tool doesn't know about")


def _version(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


def synthetic_recipe(path: Path, base: str) -> tuple[dict, list[Put]]:
    recipe_id = path.stem
    check_id(recipe_id)
    doc = json.loads(path.read_text())
    where = f"data/synthetic/{path.name}"
    check_sample(doc, recipe_id, where)
    if any("://" in s for s in _strings(doc)):
        raise Refused(f"{where} links to a file elsewhere: a sample from the repo brings its own files")
    doc.setdefault("media", {})["poster_url"] = None
    files = []
    photo = path.parent / "posters" / f"{recipe_id}.jpg"
    if photo.exists():
        data = photo.read_bytes()
        key = f"{recipe_id}/poster.jpg"
        files.append(Put(key, len(data), crc32c(data), POSTER_HEADERS, lambda d=data: d, "repo", _version(data)))
        doc["media"]["poster_url"] = f"{base}/{key}?v={files[-1].version}"
    return doc, files


def gcs_recipe(gcs, bucket: str, recipe_id: str, base: str) -> tuple[dict, list[Put]]:
    check_id(recipe_id)
    where = f"gs://{bucket}/{recipe_id}/recipe.json"
    obj = with_retries(lambda: gcs.head(bucket, f"{recipe_id}/recipe.json"))
    if obj is None:
        raise Refused(f"{where} isn't there")
    doc = json.loads(with_retries(lambda: gcs.read(bucket, obj.key, obj.generation)))
    check_sample(doc, recipe_id, where)
    files: dict[str, Put] = {}
    for label, holder, field in list(_link_fields(doc, "recipe")):
        url = holder.get(field)
        if not url:
            continue
        found = split_gcs_url(url) if isinstance(url, str) else None
        if not found or found[0] != bucket or not found[1].startswith(f"{recipe_id}/") or not KEY.match(found[1]):
            raise Refused(f"{where} {label} links outside its own folder")
        key = found[1]
        if key not in files:
            src = with_retries(lambda: gcs.head(bucket, key))
            if src is None:
                raise Refused(f"{where} {label} links to a file that isn't there")
            if src.size > MAX_FILE:
                raise Refused(f"{where} {label} is over {MAX_FILE >> 30} GiB")

            def load(src=src) -> bytes:
                data = with_retries(lambda: gcs.read(bucket, src.key, src.generation))
                if crc32c(data) != src.crc32c:
                    raise BadChecksum()
                return data

            headers = {k: v for k, v in src.headers().items() if k in ("content_type", "cache_control")}
            files[key] = Put(key, src.size, src.crc32c, headers, load, "gcs", str(src.generation))
        holder[field] = f"{base}/{key}?v={files[key].version}"
    no_old_links(doc, where)
    return doc, list(files.values())


def library_entry(doc: dict, base: str) -> dict:
    """pipeline/schema.py LibraryEntry, as publish.rebuild_library builds it."""
    cook = doc.get("cook") or {}
    return {"id": doc["id"], "title": doc["title"], "cook_name": cook.get("name"), "relation": cook.get("relation") or "",
            "poster_url": (doc.get("media") or {}).get("poster_url"), "tags": doc.get("tags") or [], "sample": True,
            "recipe_url": f"{base}/{doc['id']}/recipe.json"}


def _json_put(key: str, doc) -> Put:
    data = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()
    return Put(key, len(data), crc32c(data), JSON_HEADERS, lambda: data, "built")


def build_plan(base: str, gcs=None, from_gcs: list[str] = (), gcs_bucket: str = GCS_MEDIA, synthetic: Path = SYNTHETIC) -> Plan:
    docs, media = [], []
    for path in sorted(synthetic.glob("*.json")):
        doc, files = synthetic_recipe(path, base)
        docs.append(doc)
        media += files
    for recipe_id in from_gcs:
        doc, files = gcs_recipe(gcs, gcs_bucket, recipe_id, base)
        docs.append(doc)
        media += files
    ids = [d["id"] for d in docs]
    if len(set(ids)) != len(ids):
        raise Refused("the same id twice: a repo sample and --from-gcs, or --from-gcs repeated")
    if not docs:
        raise Refused("no samples to publish")
    docs.sort(key=lambda d: (d["cook"]["name"].lower(), d["title"].lower()))  # publish.rebuild_library's order (all samples)
    library = [library_entry(d, base) for d in docs]
    files = media + [_json_put(f"{d['id']}/recipe.json", d) for d in docs] + [_json_put("library.json", library)]
    return Plan(docs, files, library)


def write(s3, bucket: str, plan: Plan) -> dict:
    """Checks every key first, so a refusal writes nothing. Then media, recipes, and library.json last."""
    todo, same = [], 0
    for f in plan.files:
        head = with_retries(lambda: s3.head(bucket, f.key))
        if head is not None and head.size == f.size and head.crc32c == f.crc:
            same += 1
            continue
        if head is not None and head.meta.get("written-by") != MARK["written-by"]:
            raise Refused(f"{f.key} is already on {bucket}, and this tool didn't write it: look before replacing it")
        todo.append(f)
    for f in todo:
        data = f.load()
        with_retries(lambda: s3.put(bucket, f.key, data, dict(MARK), dict(f.headers), f.crc))
    return {"written": [f.key for f in todo], "unchanged": same}


def summary(plan: Plan, args, writes: bool) -> dict:
    by_recipe: dict[str, list] = {}
    for f in plan.files:
        by_recipe.setdefault(f.key.split("/")[0] if "/" in f.key else "", []).append(f)
    return {
        "mode": "write" if writes else "dry run: nothing written",
        "bucket": args.to,
        "media_base": args.media_base.rstrip("/"),
        "recipes": [{"id": d["id"], "title": d["title"], "cook": d["cook"]["name"],
                     "from": "gcs" if d["id"] in args.from_gcs else "repo",
                     "files": [f"{f.key} ({f.size} bytes)" for f in by_recipe.get(d["id"], [])]} for d in plan.recipes],
        "files": len(plan.files),
        "bytes": sum(f.size for f in plan.files),
        "library_json": plan.library,
    }


def check_guard(args) -> None:
    """Runs before any client exists, so a refusal contacts nothing."""
    base = args.media_base.rstrip("/")
    if not base.startswith("https://") or base.startswith(GCS_HOST):
        raise Refused("--media-base must be https, and not the GCS host")
    if "media" not in args.to or "uploads" in args.to or "private" in args.to:
        raise Refused("--to must be a media bucket: the library is public")
    for recipe_id in args.from_gcs:
        check_id(recipe_id)
    if args.from_gcs and not _local(args.gcs_endpoint):
        if "staging" in args.to:
            raise Refused(f"real media never goes to staging ({args.to}): staging holds no real data. The repo's samples can")
        if _local(args.s3_endpoint):
            raise Refused("real media never goes to a local endpoint")
        if not args.real_buckets_read_only_caleb_ok:
            raise Refused(f"--from-gcs reads today's real media bucket. It needs {READ_FLAG}: Caleb's OK in chat")
        if args.write and not FAST_CRC:
            raise Refused("install google-crc32c with its C extension: the pure Python checksum is far too slow for videos")
    if args.write and not _local(args.s3_endpoint) and not args.library_bucket_caleb_ok:
        raise Refused(f"{args.to} is a real bucket, and this would write to it. It needs {WRITE_FLAG}: Caleb's OK in chat")
    if args.out and Path(args.out).resolve().is_relative_to(REPO):
        raise Refused("--out goes outside the repo, so the copies aren't committed by mistake")


def real_stores(args):
    from stores import GcsStore, S3Store  # the SDKs load only here, past the guard
    gcs = GcsStore(args.gcs_endpoint) if args.from_gcs else None
    s3 = S3Store(args.s3_endpoint) if args.write else None
    return gcs, s3


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, epilog=RULE, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--to", required=True, help="the S3 media bucket, e.g. homecookd-production-media-<account>")
    p.add_argument("--media-base", required=True, help="where that bucket is served: https://media.homecookd.app on production")
    p.add_argument("--from-gcs", action="append", default=[], metavar="ID", help="a video sample on GCS's media bucket; repeat")
    p.add_argument("--gcs-bucket", default=GCS_MEDIA, help=f"where --from-gcs reads (default {GCS_MEDIA})")
    p.add_argument("--write", action="store_true", help="actually write; without it, a dry run that never touches S3")
    p.add_argument("--out", help="also write the built library.json and recipe.json files here, outside the repo, to read them")
    p.add_argument("--gcs-endpoint", help="a local emulator, for tests")
    p.add_argument("--s3-endpoint", help="a local emulator, for tests")
    p.add_argument(WRITE_FLAG, action="store_true", help="see THE RULE below")
    p.add_argument(READ_FLAG, action="store_true", help="see THE RULE below")
    return p


def save_out(out: Path, plan: Plan) -> None:
    for f in plan.files:
        if f.source == "built":
            dest = out / f.key
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(f.load())


def main(argv: list[str] | None = None, make_stores=real_stores, out=None, err=None, synthetic: Path = SYNTHETIC) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    args = build_parser().parse_args(argv)
    try:
        check_guard(args)
        gcs, s3 = make_stores(args)
        base = args.media_base.rstrip("/")
        plan = build_plan(base, gcs, args.from_gcs, args.gcs_bucket, synthetic)
        schema = {d["id"]: check_schema(copy.deepcopy(d), f"{d['id']}/recipe.json") for d in plan.recipes}
        result = summary(plan, args, args.write)
        result["schema"] = schema
        if args.out:
            save_out(Path(args.out), plan)
        if args.write:
            result.update(write(s3, args.to, plan))
        print(json.dumps(result, indent=2, ensure_ascii=False), file=out)
        return EXIT_OK
    except Refused as e:
        print(f"refused: {e}", file=err)
        return EXIT_REFUSED
    except Denied as e:
        print(f"denied: {e}", file=err)
        return EXIT_DENIED
    except Exception as e:  # noqa: BLE001 - an SDK's message can hold a key, so only the type is printed
        print(f"failed: {type(e).__name__}", file=err)
        return EXIT_FAILED


if __name__ == "__main__":
    raise SystemExit(main())
