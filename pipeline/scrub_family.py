"""Take the cook's stories and tips out of the family recipes the Convex worker published before #37.

    .venv/bin/python pipeline/scrub_family.py            # dry run: lists what it would change, writes nothing
    .venv/bin/python pipeline/scrub_family.py --write    # rewrite them in the public bucket (Caleb's OK first)
    .venv/bin/python pipeline/scrub_family.py --id hackathon-biryani-1   # also one Convex no longer lists

A family recipe is a Convex recipes row with a recipeJsonUrl: only the worker sets one (/worker/published);
the seeded demo rows have none. The dry run also names any other unmarked recipe.json that library.json
doesn't list (a family recipe whose Convex row is gone), which --id adds. Each one's recipe.json (and a trash/ copy, also public) is rewritten with
publish.without_memories, which also marks it a family recipe, so rebuild_library leaves it out of the
shared library.json and the app's bundle. This never rebuilds library.json; Convex keeps the memories.
Reads Convex with the team token (CONVEX_OVERRIDE_ACCESS_TOKEN in .env) and the Convex CLI.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from google.cloud import storage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish  # noqa: E402
from schema import Recipe  # noqa: E402

DEPLOYMENT = "grand-dragon-649"
ROW_LIMIT = 10000


def family_recipe_urls(deployment: str = DEPLOYMENT) -> list[str]:
    """The recipeJsonUrl of every Convex recipe that has one."""
    out = subprocess.run(["npx", "--yes", "convex", "data", "recipes", "--deployment", deployment,
                          "--limit", str(ROW_LIMIT), "--format", "jsonLines"],
                         cwd=publish.ROOT, capture_output=True, text=True, check=True).stdout
    rows = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    if len(rows) >= ROW_LIMIT:
        sys.exit(f"Convex returned {len(rows)} recipes, the most it lists; raise ROW_LIMIT")
    return sorted({r["recipeJsonUrl"] for r in rows if r.get("recipeJsonUrl")})


def _recipe_id(bucket: storage.Bucket, url: str) -> str | None:
    """oatmeal-5372a0 from https://storage.googleapis.com/<bucket>/oatmeal-5372a0/recipe.json."""
    prefix = publish.public_url(bucket, "")
    folder, _, name = url.split("?")[0].removeprefix(prefix).partition("/")
    return folder if url.startswith(prefix) and folder and name == "recipe.json" else None


def _left_in(recipe: Recipe) -> list[str]:
    """What without_memories would change, in words."""
    counts = {"stories": len(recipe.stories), "special moments": len(recipe.special),
              "step tips": sum(1 for s in recipe.steps if s.tip)}
    found = [f"{n} {what}" for what, n in counts.items() if n]
    if recipe.intro:
        found.append("the intro")
    if not recipe.family:
        found.append("no family mark")
    return found


def plan(bucket: storage.Bucket, urls: list[str]) -> list[tuple[str, Recipe]]:
    """(path in the bucket, its recipe now) for each family recipe.json that still has memories or no mark."""
    todo = []
    for url in urls:
        recipe_id = _recipe_id(bucket, url)
        if not recipe_id:
            print(f"skip {url}: not a recipe.json in {bucket.name}")
            continue
        for path in (f"{recipe_id}/recipe.json", f"trash/{recipe_id}/recipe.json"):
            blob = bucket.blob(path)
            if not blob.exists():
                continue
            try:
                recipe = Recipe.model_validate_json(blob.download_as_text())
            except ValueError as e:  # pydantic ValidationError is a ValueError
                print(f"skip {path}: not a valid recipe ({str(e)[:200]})")
                continue
            left = _left_in(recipe)
            if left:
                print(f"scrub {path} ({recipe.title}, {recipe.cook.name}): {', '.join(left)}")
                todo.append((path, recipe))
            else:
                print(f"clean {path}")
    return todo


def unlisted(bucket: storage.Bucket, known: set[str]) -> list[str]:
    """Recipe ids in the bucket with no family mark that neither library.json nor Convex (known) lists, such as
    a family recipe whose Convex row was removed. rebuild_library would add them to the shared library."""
    blob = bucket.blob("library.json")
    listed = {e["id"] for e in json.loads(blob.download_as_text())} if blob.exists() else set()
    found = []
    for blob in bucket.client.list_blobs(bucket, match_glob="*/recipe.json"):
        recipe_id = blob.name.split("/")[0]
        if recipe_id in listed or recipe_id in known:
            continue
        try:
            if not publish.is_family(Recipe.model_validate_json(blob.download_as_text())):
                found.append(recipe_id)
        except ValueError:
            pass  # rebuild_library leaves an invalid file out too
    return found


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="rewrite the files (default: dry run, writes nothing)")
    ap.add_argument("--id", action="append", default=[], help="also scrub this recipe id (one Convex no longer lists)")
    ap.add_argument("--deployment", default=DEPLOYMENT, help=f"Convex deployment (default {DEPLOYMENT})")
    args = ap.parse_args(argv)
    bucket = publish._bucket()  # loads .env
    extra = [publish.public_url(bucket, f"{recipe_id}/recipe.json") for recipe_id in args.id]
    urls = list(dict.fromkeys(family_recipe_urls(args.deployment) + extra))
    todo = plan(bucket, urls)
    for recipe_id in unlisted(bucket, {_recipe_id(bucket, u) for u in urls}):
        print(f"check {recipe_id}/recipe.json: not in library.json or Convex, so rebuild_library would list it. "
              f"A family's own? Add --id {recipe_id}")
    if not args.write:
        print(f"dry run: {len(todo)} file(s) to scrub, nothing written. --write rewrites them.")
        return
    for path, recipe in todo:
        publish._upload_json(bucket, path, publish.without_memories(recipe).model_dump_json(indent=2))
        print(f"scrubbed {path}")
    print(f"{len(todo)} file(s) scrubbed. library.json was not rebuilt.")


if __name__ == "__main__":
    main()
