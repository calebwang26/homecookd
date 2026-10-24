"""Publish recipes to the public Google Cloud Storage media bucket & rebuild library.json.

    python pipeline/publish.py --id weed-pancakes   # one processed recipe from data/out/<id>/
    python pipeline/publish.py --all                # every processed recipe + data/synthetic/*.json

Uses Application Default Credentials (`gcloud auth login --update-adc`).
Rebuilding the app's bundled copies keeps cook mode's short steps (substeps, uses, tip from shorten.py,
and the step titles tidied with them) that a bundled copy has and its bucket copy lacks, when every step
is the same step (_keep_short_steps).
A family's own recipe (worker.py, Convex mode) is published without the cook's stories and tips
(without_memories): the bucket is public, and Convex shows them only after her yes. library.json and the
bundle leave it out (Recipe.family).
Storage is GCS instead of the Supabase bucket in docs/HACKATHON-SPEC.md: Supabase's free plan caps files
at 50 MB, and GCS's free tier holds full-length videos.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv
from google.cloud import storage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema import LibraryEntry, Recipe  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "out"
SYNTHETIC = ROOT / "data" / "synthetic"
APP_DATA = ROOT / "app" / "assets" / "data"
BUNDLED_TS = ROOT / "app" / "src" / "lib" / "bundled.ts"

MEDIA_FILES = {  # local name -> (content type, Media field)
    "play.mp4": ("video/mp4", "video_url"),
    "voice.m4a": ("audio/mp4", "audio_url"),
    "poster.jpg": ("image/jpeg", "poster_url"),
}
JSON_CACHE = "no-cache, max-age=0"  # library & recipe JSON must update immediately
MEDIA_CACHE = "public, max-age=3600"
FAMILY_MARK = ".family"  # in data/out/<id>/: a family's own recipe, published by the worker in Convex mode


def _bucket() -> storage.Bucket:
    load_dotenv(ROOT / ".env")
    name = os.environ.get("GCS_MEDIA_BUCKET")
    if not name:
        sys.exit("GCS_MEDIA_BUCKET is not set in .env")
    return storage.Client(project=os.environ.get("GCP_PROJECT")).bucket(name)


def public_url(bucket: storage.Bucket, path: str) -> str:
    return f"https://storage.googleapis.com/{bucket.name}/{path}"


def versioned_url(bucket: storage.Bucket, blob: storage.Blob) -> str:
    """Media is edge-cached for an hour; the generation changes on every upload, so a replaced
    file (e.g. a better poster) gets a new URL instead of a stale cached copy."""
    if blob.generation is None:
        blob.reload()
    return f"{public_url(bucket, blob.name)}?v={blob.generation}"


def _publish_step_stills(bucket: storage.Bucket, recipe_id: str, folder: Path, raw: dict, force: bool) -> None:
    """One still per step (from the middle of its range) for cook mode's hero image."""
    ffmpeg = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    stills = folder / "steps"
    stills.mkdir(exist_ok=True)
    for old in stills.glob("*.jpg"):
        old.unlink()  # steps may have been renumbered since the last publish
    for step in raw["steps"]:
        name = f"{step['order']:02d}.jpg"
        t = (step["start_s"] + step["end_s"]) / 2
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-ss", f"{t:.1f}", "-i", str(folder / "play.mp4"),
                        "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "4", "-update", "1",
                        str(stills / name)], check=True)
        blob = bucket.blob(f"{recipe_id}/steps/{name}")
        unchanged = False
        if not force and blob.exists():
            blob.reload()
            unchanged = blob.md5_hash == _md5_b64(stills / name)
        if not unchanged:
            blob.cache_control = MEDIA_CACHE
            blob.upload_from_filename(str(stills / name), content_type="image/jpeg")
        step["image_url"] = versioned_url(bucket, blob)
    print(f"  {len(raw['steps'])} step stills")


def _video_size(path: Path) -> tuple[int, int]:
    """Display width & height of play.mp4 (prep.py already applied any rotation)."""
    ffprobe = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
    out = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0:s=x", str(path)], capture_output=True, text=True, check=True).stdout.strip()
    width, height = (int(n) for n in out.split("x")[:2])
    return width, height


def _md5_b64(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return base64.b64encode(digest.digest()).decode()


def _upload_json(bucket: storage.Bucket, path: str, data: str) -> None:
    blob = bucket.blob(path)
    blob.cache_control = JSON_CACHE
    blob.upload_from_string(data, content_type="application/json")


def without_memories(recipe: Recipe) -> Recipe:
    """The recipe without what Convex keeps as its memories (convex/lib/recipeJson.ts): the stories, special
    moments and step tips, the steps' links to them, and the intro, which the merge writes from the stories.
    Steps, quotes, ingredients and media stay. It is marked a family recipe (Recipe.family), so
    rebuild_library leaves it out of the shared library."""
    steps = [s.model_copy(update={"story_ids": [], "special_ids": [], "tip": None}) for s in recipe.steps]
    return recipe.model_copy(update={"intro": "", "stories": [], "special": [], "steps": steps, "family": True})


def _published_as_family(bucket: storage.Bucket, recipe_id: str) -> bool:
    blob = bucket.blob(f"{recipe_id}/recipe.json")
    try:
        return blob.exists() and json.loads(blob.download_as_text()).get("family") is True
    except ValueError:
        return False


def publish_recipe(recipe_id: str, force: bool = False, bucket: storage.Bucket | None = None,
                   family: bool = False) -> Recipe:
    """Upload one processed recipe's media + recipe.json. Returns the published Recipe, memories and all.
    family: a family's own recipe (worker.py, Convex mode). Its recipe.json is uploaded without_memories,
    and it stays a family recipe (FAMILY_MARK here, Recipe.family in the bucket), so publishing it again by
    hand, from any machine, leaves them out too."""
    bucket = bucket or _bucket()
    folder = OUT / recipe_id
    family = family or (folder / FAMILY_MARK).exists() or _published_as_family(bucket, recipe_id)
    if family:
        (folder / FAMILY_MARK).touch()
    raw = json.loads((folder / "recipe.json").read_text())
    for local, (ctype, field) in MEDIA_FILES.items():
        path = folder / local
        if not path.exists():
            # RuntimeError, not sys.exit: the worker catches Exception and must keep running.
            raise RuntimeError(f"{recipe_id}: missing {path}; run prep.py & process.py first")
        blob = bucket.blob(f"{recipe_id}/{local}")
        if not force and blob.exists():
            blob.reload()
            if blob.md5_hash == _md5_b64(path):
                print(f"  skip {local} (already uploaded)")
                raw["media"][field] = versioned_url(bucket, blob)
                continue
        print(f"  upload {local} ({path.stat().st_size / 1e6:.1f} MB)")
        blob.cache_control = MEDIA_CACHE
        blob.upload_from_filename(str(path), content_type=ctype, timeout=3600)
        raw["media"][field] = versioned_url(bucket, blob)
    raw["media"]["width"], raw["media"]["height"] = _video_size(folder / "play.mp4")
    _publish_step_stills(bucket, recipe_id, folder, raw, force)
    recipe = Recipe.model_validate(raw)  # reject & report; never publish an invalid recipe
    public = without_memories(recipe) if family else recipe
    _upload_json(bucket, f"{recipe_id}/recipe.json", public.model_dump_json(indent=2))
    print(f"published {recipe_id}{' (no stories or tips)' if family else ''}: "
          f"{public_url(bucket, f'{recipe_id}/recipe.json')}")
    return recipe


def publish_synthetic(path: Path, bucket: storage.Bucket) -> Recipe:
    recipe = Recipe.model_validate_json(path.read_text())
    if not recipe.sample:
        sys.exit(f"{path} is in data/synthetic but sample is not true")
    # Sample recipes have no video; a photo in data/synthetic/posters/<id>.jpg becomes the cover.
    photo = SYNTHETIC / "posters" / f"{recipe.id}.jpg"
    if photo.exists():
        blob = bucket.blob(f"{recipe.id}/poster.jpg")
        unchanged = False
        if blob.exists():
            blob.reload()
            unchanged = blob.md5_hash == _md5_b64(photo)
        if not unchanged:
            blob.cache_control = MEDIA_CACHE
            blob.upload_from_filename(str(photo), content_type="image/jpeg")
        recipe.media.poster_url = versioned_url(bucket, blob)
    _upload_json(bucket, f"{recipe.id}/recipe.json", recipe.model_dump_json(indent=2))
    print(f"published sample {recipe.id}")
    return recipe


def is_family(recipe: Recipe) -> bool:
    """A family's own recipe: marked in its recipe.json, or, for one the worker published before the mark,
    FAMILY_MARK on the machine that ran it (scrub_family.py adds the mark to those)."""
    return recipe.family or (OUT / recipe.id / FAMILY_MARK).exists()


def rebuild_library(bucket: storage.Bucket | None = None) -> list[LibraryEntry]:
    """library.json = every */recipe.json in the bucket but a family's own (Convex lists those, and only to
    that family). Also refreshes the app's bundled fallback."""
    bucket = bucket or _bucket()
    recipes: list[Recipe] = []
    family = 0
    for blob in bucket.client.list_blobs(bucket, match_glob="*/recipe.json"):
        try:
            recipe = Recipe.model_validate_json(blob.download_as_text())
        except ValueError as e:  # pydantic ValidationError is a ValueError
            # One bad file must not block every new recipe from reaching the library.
            print(f"warning: leaving {blob.name} out of library.json: {str(e)[:300]}")
            continue
        if is_family(recipe):
            family += 1
        else:
            recipes.append(recipe)
    if family:
        print(f"left {family} family recipe(s) out of library.json and the app's bundle")
    # Real recipes first, then grouped by cook, then title.
    recipes.sort(key=lambda r: (r.sample, r.cook.name.lower(), r.title.lower()))
    entries = [
        LibraryEntry(id=r.id, title=r.title, cook_name=r.cook.name, relation=r.cook.relation,
                     poster_url=r.media.poster_url, tags=r.tags, sample=r.sample,
                     recipe_url=public_url(bucket, f"{r.id}/recipe.json"))
        for r in recipes
    ]
    library_json = json.dumps([e.model_dump() for e in entries], indent=2)
    _upload_json(bucket, "library.json", library_json)
    print(f"library.json: {len(entries)} recipes -> {public_url(bucket, 'library.json')}")
    _write_bundle(library_json, recipes)
    return entries


SHORT_FIELDS = ("title", "substeps", "uses", "tip")


def _step_key(s: dict) -> tuple:
    """The same step: the same instruction (spacing and case aside) over the same stretch of video (the
    app's withBundledShortSteps rule, app/src/lib/recipes.ts)."""
    return " ".join((s.get("instruction") or "").split()).lower(), round(s["start_s"]), round(s["end_s"])


def _keep_short_steps(recipe: Recipe, old: dict | None) -> Recipe:
    """shorten.py writes short steps into the bundled copies; a bucket copy published before that has none.
    Rewriting the bundle from the bucket would wipe them (and any hand fixes), so a bucket recipe with no
    substeps keeps its old bundled copy's, when every step is the same step."""
    if old is None or any(s.substeps for s in recipe.steps):
        return recipe
    theirs = sorted(old.get("steps") or [], key=lambda s: s.get("order", 0))
    data = recipe.model_dump()
    mine = sorted(data["steps"], key=lambda s: s["order"])
    if not any(s.get("substeps") for s in theirs) or [_step_key(s) for s in mine] != [_step_key(s) for s in theirs]:
        return recipe
    for s, o in zip(mine, theirs):
        for k in SHORT_FIELDS:
            s[k] = o.get(k) if k != "title" else o.get("title") or s["title"]
    print(f"{recipe.id}: kept the bundled copy's short steps (the bucket copy has none yet)")
    return Recipe.model_validate(data)


def _write_bundle(library_json: str, recipes: list[Recipe]) -> None:
    (APP_DATA / "recipes").mkdir(parents=True, exist_ok=True)
    old_copies: dict[str, dict] = {}
    for old in (APP_DATA / "recipes").glob("*.json"):
        try:
            old_copies[old.stem] = json.loads(old.read_text())
        except ValueError:
            pass  # a broken copy is simply replaced
        old.unlink()
    (APP_DATA / "library.json").write_text(library_json + "\n")
    lines = []
    for r in recipes:
        r = _keep_short_steps(r, old_copies.get(r.id))
        (APP_DATA / "recipes" / f"{r.id}.json").write_text(r.model_dump_json(indent=2) + "\n")
        lines.append(f"  '{r.id}': require('../../assets/data/recipes/{r.id}.json'),")
    BUNDLED_TS.write_text(
        "// AUTO-GENERATED by pipeline/publish.py — do not edit by hand.\n"
        "import type { LibraryEntry, Recipe } from './types';\n"
        "export const bundledLibrary: LibraryEntry[] = require('../../assets/data/library.json');\n"
        "export const bundledRecipes: Record<string, Recipe> = {\n" + "\n".join(lines) + "\n};\n"
    )
    print(f"bundled {len(recipes)} recipes into app/assets/data (offline fallback)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--id", help="recipe id in data/out/<id>/")
    group.add_argument("--all", action="store_true", help="every processed recipe + synthetic recipes")
    ap.add_argument("--force", action="store_true", help="re-upload media even if already uploaded")
    args = ap.parse_args()
    bucket = _bucket()
    if args.id:
        publish_recipe(args.id, args.force, bucket)
    else:
        # Recipes deleted from the app live in trash/<id>/; --all must not bring them back.
        trashed = {b.name.split("/")[1] for b in bucket.client.list_blobs(bucket, prefix="trash/",
                                                                          match_glob="trash/*/recipe.json")}
        for recipe_json in sorted(OUT.glob("*/recipe.json")):
            name = recipe_json.parent.name
            if name.startswith("test-") or name in trashed:
                continue  # smoke tests & deleted recipes never go to the family library
            publish_recipe(name, args.force, bucket)
        for path in sorted(SYNTHETIC.glob("*.json")):
            if path.stem not in trashed:
                publish_synthetic(path, bucket)
    rebuild_library(bucket)


if __name__ == "__main__":
    main()
