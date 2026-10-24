"""Upload a recipe's play.mp4 & voice.m4a while Gemini is still working on it.

    python pipeline/preupload.py --id weed-steak

Uses the same paths, content types and cache headers as publish.py, so publish_recipe later
finds the files already uploaded (matching MD5) and skips them. The upload of a long video is
the slowest step on a slow connection; overlapping it with extraction saves that time.
"""
from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish  # noqa: E402


def upload(bucket, recipe_id: str, local: str) -> str:
    path = publish.OUT / recipe_id / local
    ctype, _ = publish.MEDIA_FILES[local]
    blob = bucket.blob(f"{recipe_id}/{local}")
    if blob.exists():
        blob.reload()
        if blob.md5_hash == publish._md5_b64(path):
            return f"{local}: already uploaded"
    t0 = time.monotonic()
    blob.cache_control = publish.MEDIA_CACHE
    blob.upload_from_filename(str(path), content_type=ctype, timeout=3600)
    mb = path.stat().st_size / 1e6
    secs = time.monotonic() - t0
    return f"{local}: {mb:.0f} MB in {secs:.0f} s ({mb * 8 / secs:.1f} Mbps)"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    args = ap.parse_args()
    bucket = publish._bucket()
    with ThreadPoolExecutor(max_workers=2) as pool:
        for line in pool.map(lambda name: upload(bucket, args.id, name), ["play.mp4", "voice.m4a"]):
            print(line, flush=True)


if __name__ == "__main__":
    main()
