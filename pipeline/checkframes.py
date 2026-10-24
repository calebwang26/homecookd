"""Spot-check timestamps (docs/HACKATHON-SPEC.md §9): tile one frame from the middle of each step, in order.

    python pipeline/checkframes.py --id chicken-biryani     # writes data/out/<id>/work/check_steps.jpg
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--cols", type=int, default=4)
    args = ap.parse_args()
    folder = ROOT / "data" / "out" / args.id
    recipe = json.loads((folder / "recipe.json").read_text())
    with tempfile.TemporaryDirectory() as tmp:
        frames = []
        for step in recipe["steps"]:
            t = (step["start_s"] + step["end_s"]) / 2
            out = Path(tmp) / f"{step['order']:02d}.jpg"
            subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{t:.1f}", "-i", str(folder / "play.mp4"),
                            "-frames:v", "1", "-vf", "scale=320:180:force_original_aspect_ratio=decrease,"
                            "pad=320:180:(ow-iw)/2:(oh-ih)/2", str(out)], check=True)
            frames.append(out)
            print(f"{step['order']:2d}. {step['start_s']:>5}-{step['end_s']:<5} (frame @ {t:.0f}s) {step['title']}")
        rows = -(-len(frames) // args.cols)
        cmd = [FFMPEG, "-y", "-loglevel", "error"]
        for f in frames:
            cmd += ["-i", str(f)]
        layout = "|".join(f"{(k % args.cols) * 320}_{(k // args.cols) * 180}" for k in range(len(frames)))
        dest = folder / "work" / "check_steps.jpg"
        if len(frames) == 1:
            shutil.copy(frames[0], dest)
        else:
            subprocess.run(cmd + ["-filter_complex", f"xstack=inputs={len(frames)}:layout={layout}:fill=black",
                                  str(dest)], check=True)
        print(f"{rows} row(s) x {args.cols} -> {dest}")


if __name__ == "__main__":
    main()
