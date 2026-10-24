"""When each substep starts in the recording: adds substeps[].start_s to recipes that have audio.

python pipeline/align.py --id weed-steak [--audio-dir DIR] [--dry-run] [--force]
python pipeline/align.py --all [--audio-dir DIR] [--dry-run] [--force]

start_s is absolute whole seconds on play.mp4 / voice.m4a (the same clock as step.start_s/end_s). The app splits
a step's progress bar at these seconds and highlights the substep the voice is on. Rules (schema.py checks
them): the first substep = step.start_s, strictly increasing, all inside [step.start_s, step.end_s).

One Gemini call per recipe (a Flash model: process.py's order_model). voice.m4a comes from data/out/ID/ when the
pipeline made it there, else from the recipe's public media.audio_url (saved under --audio-dir). ffmpeg cuts one
small mono mp3 per step range; the call gets every step's clip inline with its substeps and quote, and returns
MM:SS offsets inside each clip. Small slips are fixed (the first offset is 0; up to SLIP_S past the clip end is
clamped; a time up to SLIP_S before the one above it is nudged after it). Steps still wrong are asked once more
(their clips only); after that they fall back to splitting the step range by substep text length.

Copies with audio: data/out/ID/recipe.json and app/assets/data/recipes/ID.json (synthetic recipes have no media
and are skipped). Recipes that already have start_s are skipped unless --force. Rerunning shorten.py replaces
the substeps and drops their start_s: run this again after it.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
from pydantic import BaseModel, ValidationError  # noqa: E402

from pipeline.process import (HTTP_RETRY, REQUEST_TIMEOUT_MS, Usage, describe_call, load_config, log,  # noqa: E402
                              response_text)
from pipeline.prompts import ALIGN_PROMPT, ALIGN_RETRY_SUFFIX, ALIGN_STEP  # noqa: E402
from pipeline.schema import Recipe, parse_timestamp  # noqa: E402
from pipeline.shorten import BUNDLED, OUT, MemoryUsage, rel  # noqa: E402

SLIP_S = 5  # a time this far outside its clip, or behind the substep above it, is fixed instead of rejected


class AlignError(RuntimeError):
    pass


# ---------- what Gemini returns (no defaults: the response_schema rejects them) ----------

class AlignStep(BaseModel):
    order: int
    starts: list[str]  # MM:SS inside the step's clip, one per substep


class AlignAnswer(BaseModel):
    steps: list[AlignStep]


# ---------- rules (pure, tested in test_shorten.py) ----------

def mmss(s: int) -> str:
    return f"{s // 60:02d}:{s % 60:02d}"


def fix_offsets(offsets: list[int], length: int) -> tuple[list[int], list[str]]:
    """Offsets (seconds into a step of `length` s) -> (fixed offsets, errors). Errors mean: ask again."""
    n = len(offsets)
    if length < n:
        return offsets, [f"{n} substeps do not fit in {length} s"]
    out, errors = [0], []
    for i, t in enumerate(offsets[1:], 1):
        last = length - (n - i)  # leave a second for every substep after this one
        if t > last:
            if t - last > SLIP_S:
                errors.append(f"substep {i + 1} at {mmss(t)} is past the clip's end {mmss(length)}")
            t = last
        if t <= out[-1]:
            if out[-1] - t >= SLIP_S:
                errors.append(f"substep {i + 1} at {mmss(t)} comes before substep {i} at {mmss(out[-1])}")
            t = out[-1] + 1
        if t > last:
            errors.append(f"substep {i + 1} does not fit after substep {i} at {mmss(out[-1])}")
            t = last
        out.append(t)
    return out, errors


def proportional(texts: list[str], length: int) -> list[int]:
    """The fallback: split the step's seconds by each substep's visible text length."""
    weights = [max(len(t.replace("**", "").strip()), 1) for t in texts]
    total, acc, out = sum(weights), 0, []
    for w in weights:
        out.append(round(length * acc / total))
        acc += w
    out, _ = fix_offsets(out, length)
    return out


def check(recipe: dict) -> list[str]:
    """The stored rules for one recipe dict (empty = fine). Recipes without audio must have no start_s."""
    errors = []
    has_audio = bool((recipe.get("media") or {}).get("audio_url"))
    for s in recipe["steps"]:
        timed = [x.get("start_s") for x in s.get("substeps") or []]
        at = f"step {s['order']}"
        if not has_audio:
            if any(t is not None for t in timed):
                errors.append(f"{at}: start_s on a recipe without audio")
            continue
        if not timed or any(not isinstance(t, int) for t in timed):
            errors.append(f"{at}: substeps without start_s {timed}")
        elif timed[0] != s["start_s"]:
            errors.append(f"{at}: first start_s {timed[0]} != step start_s {s['start_s']}")
        elif any(b <= a for a, b in zip(timed, timed[1:])):
            errors.append(f"{at}: start_s not strictly increasing {timed}")
        elif not all(s["start_s"] <= t < s["end_s"] for t in timed):
            errors.append(f"{at}: start_s {timed} outside {s['start_s']}-{s['end_s']}")
    return errors


# ---------- audio ----------

def voice_file(recipe: dict, audio_dir: Path) -> Path:
    local = OUT / recipe["id"] / "voice.m4a"
    if local.exists():
        return local
    url = (recipe.get("media") or {}).get("audio_url")
    if not url:
        raise AlignError(f"{recipe['id']}: no media.audio_url")
    dest = audio_dir / recipe["id"] / "voice.m4a"
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        log(f"[align {recipe['id']}] downloading {url.split('?')[0]}")
        tmp = dest.with_suffix(".part")
        subprocess.run(["curl", "-fsSL", "-o", str(tmp), url], check=True)  # curl: macOS Python often lacks CA certs
        tmp.rename(dest)
    return dest


def cut_clip(voice: Path, start: int, end: int, dest: Path) -> bytes:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-to", str(end), "-i", str(voice), "-vn",
                    "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "24k", str(dest)], check=True)
    return dest.read_bytes()


# ---------- the Gemini call ----------

def step_parts(recipe: dict, steps: list[dict], clips: dict[int, bytes]) -> list:
    parts: list = []
    for s in steps:
        subs = "\n".join(f"{i}. {x['text'].replace('**', '')}" + (f" ({x['detail']})" if x.get("detail") else "")
                         for i, x in enumerate(s["substeps"], 1))
        parts.append(ALIGN_STEP.format(order=s["order"], title=s["title"], clip_mmss=mmss(s["end_s"] - s["start_s"]),
                                       substeps=subs, quote=s.get("quote") or "(nothing recorded)"))
        parts.append(types.Part.from_bytes(data=clips[s["order"]], mime_type="audio/mpeg"))
    return parts


def ask(client: genai.Client, model: str, recipe: dict, clips: dict[int, bytes], usage: Usage,
        tag: str) -> tuple[dict[int, list[int]], dict[int, str]]:
    """Returns ({step order: absolute start seconds}, {step order: how it was found})."""
    steps = {s["order"]: s for s in recipe["steps"]}
    found: dict[int, list[int]] = {}
    how: dict[int, str] = {}
    todo, errors_by_step = list(steps), {}
    for attempt in (1, 2):
        head = ALIGN_PROMPT.format(title=json.dumps(recipe["title"]))
        if attempt == 2:
            head += ALIGN_RETRY_SUFFIX.format(errors="\n".join(f"- step {o}: {e}" for o, es in errors_by_step.items()
                                                               for e in es))
        resp, t0, errors_by_step = None, time.monotonic(), {}
        try:
            resp = client.models.generate_content(
                model=model, contents=[head, *step_parts(recipe, [steps[o] for o in todo], clips)],
                config=types.GenerateContentConfig(response_mime_type="application/json",
                                                   response_schema=AlignAnswer, temperature=0.1))
            answer = AlignAnswer.model_validate_json(response_text(resp))
            by_order = {a.order: a for a in answer.steps}
            for o in todo:
                s, a = steps[o], by_order.get(o)
                length, n = s["end_s"] - s["start_s"], len(s["substeps"])
                if a is None:
                    errors_by_step[o] = ["missing from the answer"]
                    continue
                if len(a.starts) != n:
                    errors_by_step[o] = [f"{len(a.starts)} times for {n} substeps"]
                    continue
                try:
                    raw = [parse_timestamp(x) for x in a.starts]
                except ValueError as e:
                    errors_by_step[o] = [str(e)]
                    continue
                fixed, errs = fix_offsets(raw, length)
                if errs:
                    errors_by_step[o] = errs
                    continue
                found[o] = [s["start_s"] + t for t in fixed]
                how[o] = f"gemini attempt {attempt}" + ("" if fixed == raw else f" (fixed {mmss_list(raw)})")
        except (ValidationError, ValueError) as e:
            errors_by_step = {o: [f"{type(e).__name__}: {str(e)[:300]}"] for o in todo}
        except Exception as e:  # noqa: BLE001 - API/network errors also get the one retry
            errors_by_step = {o: [f"{type(e).__name__}: {str(e)[:300]}"] for o in todo}
        call = usage.add("align", model, None, attempt, time.monotonic() - t0, resp,
                         json.dumps(errors_by_step)[:2000] if errors_by_step else None)
        log(f"[{tag}] attempt {attempt}, {len(todo)} steps: {describe_call(call)}")
        for o, es in errors_by_step.items():
            log(f"    - step {o}: {'; '.join(es)}")
        todo = list(errors_by_step)
        if not todo:
            break
    for o in todo:  # rejected twice: split the range by text length
        s = steps[o]
        found[o] = [s["start_s"] + t for t in proportional([x["text"] for x in s["substeps"]], s["end_s"] - s["start_s"])]
        how[o] = "proportional fallback"
    return found, how


def mmss_list(xs: list[int]) -> str:
    return "[" + ", ".join(mmss(x) for x in xs) + "]"


# ---------- files ----------

def copies(recipe_id: str) -> list[Path]:
    return [p for p in (OUT / recipe_id / "recipe.json", BUNDLED / f"{recipe_id}.json") if p.exists()]


def has_audio(path: Path) -> bool:
    return bool((json.loads(path.read_text()).get("media") or {}).get("audio_url"))


def all_ids() -> list[str]:
    return sorted(p.stem for p in BUNDLED.glob("*.json") if has_audio(p))


def make_client() -> tuple[genai.Client, str]:
    cfg = load_config()  # loads .env, fails without GEMINI_API_KEY
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                          http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS, retry_options=HTTP_RETRY))
    return client, cfg["order_model"]


def signature(recipe: dict) -> str:
    """Copies with the same steps, substeps and audio share one answer."""
    return json.dumps([recipe["media"].get("audio_url", "").split("?")[0],
                       [(s["order"], s["start_s"], s["end_s"], [x["text"] for x in s["substeps"]])
                        for s in recipe["steps"]]])


def apply(recipe: dict, found: dict[int, list[int]]) -> dict:
    out = json.loads(json.dumps(recipe))
    for s in out["steps"]:
        s["substeps"] = [{**x, "start_s": t} for x, t in zip(s["substeps"], found[s["order"]])]
    Recipe.model_validate(out)  # never write a recipe the app's contract rejects
    if check(out):
        raise AlignError(f"{recipe['id']}: {check(out)}")
    return out


def align_id(recipe_id: str, client: genai.Client | None, model: str, usage: Usage, audio_dir: Path,
             force: bool = False, dry_run: bool = False) -> list[tuple[Path, dict, dict[int, str]]]:
    tag = f"align {recipe_id}"
    answers: dict[str, tuple[dict[int, list[int]], dict[int, str]]] = {}
    results = []
    for p in copies(recipe_id):
        r = json.loads(p.read_text())
        if not (r.get("media") or {}).get("audio_url"):
            log(f"[{tag}] {rel(p)}: no audio, skipped")
            continue
        if not all(s.get("substeps") for s in r["steps"]):
            raise AlignError(f"{rel(p)}: some steps have no substeps (run shorten.py first)")
        if not force and not check(r):
            log(f"[{tag}] {rel(p)}: already aligned (--force redoes it)")
            continue
        sig = signature(r)
        if sig not in answers:
            if client is None:
                raise AlignError(f"{tag}: no Gemini client")
            voice = voice_file(r, audio_dir)
            with tempfile.TemporaryDirectory() as tmp:
                clips = {s["order"]: cut_clip(voice, s["start_s"], s["end_s"], Path(tmp) / f"step_{s['order']:02d}.mp3")
                         for s in r["steps"]}
            log(f"[{tag}] {len(clips)} clips, {sum(len(c) for c in clips.values()) / 1e6:.1f} MB")
            answers[sig] = ask(client, model, r, clips, usage, tag)
        found, how = answers[sig]
        after = apply(r, found)
        if not dry_run:
            p.write_text(json.dumps(after, indent=2, ensure_ascii=False) + "\n")
        results.append((p, after, how))
        log(f"[{tag}] {'would write' if dry_run else 'wrote'} {rel(p)}")
    return results


def show(after: dict, how: dict[int, str]) -> None:
    for s in after["steps"]:
        log(f"  {s['order']:>2}. {s['title']}  {s['start_s']}-{s['end_s']} s  ({how.get(s['order'], '?')})")
        for x in s["substeps"]:
            log(f"        {x['start_s']:>5}  {x['text']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Add substeps[].start_s (seconds on the recording) to recipes with audio.")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--id", help="one recipe: data/out/ID/recipe.json and app/assets/data/recipes/ID.json")
    group.add_argument("--all", action="store_true", help="every bundled recipe with audio")
    ap.add_argument("--audio-dir", type=Path, default=None,
                    help="where downloaded voice.m4a files go (default: a temp folder)")
    ap.add_argument("--dry-run", action="store_true", help="call Gemini and print the result; write nothing")
    ap.add_argument("--force", action="store_true", help="redo recipes that already have start_s")
    args = ap.parse_args()

    ids = all_ids() if args.all else [args.id]
    if not args.all and not copies(args.id):
        raise SystemExit(f"no recipe named {args.id!r}")
    client, model = make_client()
    usage = MemoryUsage()
    audio_dir = args.audio_dir or Path(tempfile.mkdtemp(prefix="align-audio-"))
    failed = []
    for rid in ids:
        try:
            for _, after, how in align_id(rid, client, model, usage, audio_dir, args.force, args.dry_run)[:1]:
                show(after, how)
        except (AlignError, subprocess.CalledProcessError, OSError) as e:
            failed.append(rid)
            log(f"[align {rid}] FAILED: {e}")
    log(f"\nestimated spend this run: ${sum(c['cost_usd'] for c in usage.calls):.4f} over {len(usage.calls)} calls")
    if failed:
        raise SystemExit(f"failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
