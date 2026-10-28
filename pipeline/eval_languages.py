"""The 13-language eval: how well the pipeline hears and writes each cook language, scored against human captions.

    .venv/bin/python pipeline/eval_languages.py --only ta,hi     # the languages a change touches (or --all)
    .venv/bin/python pipeline/eval_languages.py --rescore        # score the cached runs again: no model calls
    .venv/bin/python pipeline/eval_languages.py --only ta --rerun   # a new recipe from the cached transcript

Each clip in eval_clips.json is a home-cooking video in one of the 13 cook languages (memory marathi-dropped) whose
YouTube subtitles were written by people in that language: those captions are the ground truth. For each clip:
1. fetch: yt-dlp downloads the clip's span (at most 720p) and its manual captions into data/eval/<key>/ (gitignored;
   internal testing only, never published or bundled). Needs yt-dlp in .venv (`pip install yt-dlp`).
2. run: prep.run + process.run, the real pipeline with the root .env's switches (Claude + Cartesia today), on the
   clip's first --minutes (default 5), as recipe eval-<key>-<N>m in data/out/. Cached: a clip that has a recipe is
   only scored again; --rerun writes a new recipe but keeps Cartesia's transcript; --fresh redoes everything.
3. score (pure, tested in test_eval_languages.py):
   - heard_raw / heard_proofread: the share of the captions' words found in Cartesia's transcript (raw lines) and in
     the proofread copy, per minute of captions, fuzzy-matched (difflib >= 0.8); Mandarin by characters;
   - ingredients: the share of the ingredients the captions name (one Claude call reads them) that the recipe lists,
     judged by Claude allowing synonyms and translations (ingredients_by_name: the same by seen.listed's name rules);
   - script: the share of quote_original letters in her language's script (English and Latin-script languages: 1);
   - loops: the share of Cartesia's words dropped as repeat glitches (music or noise under her voice);
   - steps, stories and cost (work/usage.json, plus Cartesia credits not priced).
Cheap by default (Caleb, Oct 28): every Claude call goes through the Batch API (half price; CLAUDE_BATCH, so clips
run --jobs at a time while they wait), and the run stops before it would pass --max-usd (default $3), checked
before each clip from an estimate and the cost of the clips already done. About $0.20 a 5-minute clip and 15
minutes, since each batched call waits a minute or two (--no-batch: twice the price, a few minutes). Results: data/eval/results/<date-time>.json and a table on stdout.
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import traceback
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import BaseModel  # noqa: E402

CLIPS = Path(__file__).resolve().parent / "eval_clips.json"
EVAL = ROOT / "data" / "eval"
MATCH, WINDOW_S, SLACK_S = 0.8, 60.0, 5.0
MINUTES, MAX_USD, JOBS = 5, 3.0, 4
# What a clip costs at full price: a fixed part (writer, cover, ingredient check, judge) and a part per minute (frames,
# proofread). Fits Oct 26-28: 10-minute Hindi $0.56, 5-minute Telugu $0.37 ($0.22 batched). The Batch API halves it.
FIXED_USD, USD_PER_MIN = 0.20, 0.04
SCRIPT_RANGES = {  # Unicode blocks of each language's own script
    "hi": [(0x0900, 0x097F)], "gu": [(0x0A80, 0x0AFF)], "ta": [(0x0B80, 0x0BFF)], "te": [(0x0C00, 0x0C7F)],
    "pa": [(0x0A00, 0x0A7F)], "ur": [(0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)],
    "ar": [(0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)], "zh": [(0x4E00, 0x9FFF)],
    "ko": [(0xAC00, 0xD7AF), (0x1100, 0x11FF), (0x3130, 0x318F)],
}


class Ingredients(BaseModel):
    names: list[str]


class Missing(BaseModel):
    missing: list[str]


# ---------- scoring (pure) ----------

def parse_vtt(text: str, offset_s: float = 0.0) -> list[dict]:
    """WebVTT cues as [{"start", "end", "text"}] in seconds from the clip's start (offset_s = where the clip begins
    in the video); tags removed, and a cue repeating the one before (YouTube's rolling captions) kept once."""
    out: list[dict] = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "")):
        m = re.search(r"(\d+:)?(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+:)?(\d+):(\d+)[.,](\d+)", block)
        if not m:
            continue
        def secs(h, mi, s, ms):
            return int((h or "0:")[:-1]) * 3600 + int(mi) * 60 + int(s) + int(ms) / 1000
        start, end = secs(*m.group(1, 2, 3, 4)) - offset_s, secs(*m.group(5, 6, 7, 8)) - offset_s
        words = " ".join(re.sub(r"<[^>]+>", "", line).strip() for line in block[m.end():].strip().split("\n"))
        words = re.sub(r"\([^)]*\)|\[[^\]]*\]|（[^）]*）|♪|&nbsp;", " ", words)  # sound tags, editors' notes
        words = re.sub(r"\s+", " ", words).strip()
        if not words or end <= 0 or (out and out[-1]["text"] == words):
            continue
        out.append({"start": max(0.0, start), "end": end, "text": words})
    return out


def tokens(text: str, lang: str) -> list[str]:
    """Words to compare: lowercase, no punctuation; Mandarin as single characters."""
    text = text.lower()
    if lang == "zh":
        return [c for c in text if "一" <= c <= "鿿"]
    return [t for t in re.split(r"[\s,.?!।؟،\"'…:;()\[\]♪\-–—]+", text) if t]


def heard(reference: list[dict], lines: list[dict], lang: str) -> float | None:
    """The share of the captions' words found in `lines` near the same time, averaged over WINDOW_S windows of the
    captions. None without captions."""
    if not reference:
        return None
    end = max(x["end"] for x in reference)
    per = []
    t = 0.0
    while t < end:
        ref = [w for x in reference if t <= x["start"] < t + WINDOW_S for w in tokens(x["text"], lang)]
        if ref:
            got = [w for x in lines if t - SLACK_S <= x["start"] < t + WINDOW_S + SLACK_S for w in tokens(x["text"], lang)]
            if lang == "zh":
                have = set(got)
                hits = sum(1 for w in ref if w in have)
            else:
                hits = sum(1 for w in ref if w in got or difflib.get_close_matches(w, got, n=1, cutoff=MATCH))
            per.append(hits / len(ref))
        t += WINDOW_S
    return round(sum(per) / len(per), 3) if per else None


def script_share(texts: list[str], lang: str) -> float | None:
    """The share of letters in these texts written in `lang`'s own script; None when there are none or the
    language is written in Latin letters."""
    ranges = SCRIPT_RANGES.get(lang)
    if not ranges:
        return None
    letters = [c for t in texts for c in t if c.isalpha()]
    if not letters:
        return None
    own = sum(1 for c in letters if any(a <= ord(c) <= b for a, b in ranges))
    return round(own / len(letters), 3)


def ingredient_recall(named: list[str], recipe_names: list[str]) -> float | None:
    from pipeline.seen import listed
    if not named:
        return None
    return round(sum(1 for n in named if listed(n, recipe_names)) / len(named), 3)


# ---------- fetch, run ----------

def key(clip: dict) -> str:
    return f"{clip['lang']}-{clip['id']}"


def recipe_id(clip: dict, minutes: int = MINUTES) -> str:
    """prep's recipe ids are lowercase letters, digits and hyphens; the clip's length is part of it, so a 5- and a
    10-minute run never share a cache."""
    return re.sub(r"[^a-z0-9]+", "-", f"eval-{key(clip)}-{minutes}m".lower()).strip("-")


def clip_minutes(clip: dict, minutes: int) -> float:
    """How much of the clip a run uses: its first `minutes`, or all of it when it is shorter."""
    length = (clip["end_s"] - clip.get("start_s", 0)) if clip.get("end_s") else clip.get("duration_s", minutes * 60)
    return min(minutes, length / 60)


def estimate(clip: dict, minutes: int, batch: bool) -> float:
    """What running the clip should cost, in USD (half on the Batch API)."""
    return (FIXED_USD + clip_minutes(clip, minutes) * USD_PER_MIN) * (0.5 if batch else 1)


class Budget:
    """--max-usd for one run: a clip starts only if what is spent, what the running clips should cost and what it
    should cost all fit."""

    def __init__(self, cap: float):
        self.cap, self.spent, self.running, self.lock = cap, 0.0, {}, threading.Lock()

    def start(self, name: str, est: float) -> bool:
        with self.lock:
            if self.spent + sum(self.running.values()) + est > self.cap:
                return False
            self.running[name] = est
            return True

    def done(self, name: str, cost: float) -> None:
        with self.lock:
            self.running.pop(name, None)
            self.spent += cost


def fetch(clip: dict) -> Path:
    folder = EVAL / key(clip)
    folder.mkdir(parents=True, exist_ok=True)
    video, url = folder / "source.mp4", f"https://www.youtube.com/watch?v={clip['id']}"
    ytdlp = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--quiet", "--no-warnings"]
    span = f"*{clip.get('start_s', 0)}-{clip['end_s']}" if clip.get("end_s") else None
    if not video.exists():
        subprocess.run(ytdlp + ["-f", "bv*[height<=720][vcodec^=avc1]+ba/bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
                                *(["--download-sections", span, "--force-keyframes-at-cuts"] if span else []),
                                "-o", str(video), url], check=True)
    if not list(folder.glob("captions*.vtt")):
        subprocess.run(ytdlp + ["--skip-download", "--write-subs", "--sub-langs", clip["sub_lang"], "--sub-format",
                                "vtt", "-o", str(folder / "captions"), url], check=True)
    return folder


def trimmed(clip: dict, minutes: int) -> Path:
    """The clip's first `minutes` (stream copy, so it ends on a keyframe), made once."""
    from pipeline.prep import ffmpeg
    folder = EVAL / key(clip)
    out = folder / f"source-{minutes}m.mp4"
    if not out.exists():
        ffmpeg("-i", str(folder / "source.mp4"), "-t", str(minutes * 60), "-c", "copy", str(out))
    return out


def spent(out: Path) -> float:
    path = out / "work" / "usage.json"
    return json.loads(path.read_text()).get("estimated_cost_usd", 0.0) if path.exists() else 0.0


def run(clip: dict, minutes: int, rerun: bool = False) -> Path:
    """The clip's recipe: made when there is none, or again with rerun (Cartesia's transcript kept). What the run
    cost goes to work/eval_run.json."""
    from pipeline import prep, process
    rid = recipe_id(clip, minutes)
    out = prep.OUT_ROOT / rid
    if (out / "recipe.json").exists() and not rerun:
        return out
    keep = {n: (out / "work" / n).read_bytes() for n in ("transcript.json", "usage.json") if (out / "work" / n).exists()}
    shutil.rmtree(out, ignore_errors=True)
    prep.run(rid, clip.get("dish") or "", "Cook", "Cook", [trimmed(clip, minutes)])
    for name, data in keep.items():  # the same audio, so the same transcript
        (out / "work" / name).write_bytes(data)
    before = spent(out)
    process.run(rid, language=clip["lang"])
    (out / "work" / "eval_run.json").write_text(json.dumps({"cost_usd": round(spent(out) - before, 4)}))
    return out


def named_ingredients(reference: list[dict], lang: str, dish: str, usage=None) -> list[str]:
    """The ingredients the captions name, in English (one Claude call; cached by the caller)."""
    from pipeline import claude
    from pipeline.prompts import LANGUAGES
    text = "\n".join(x["text"] for x in reference)[:30_000]
    prompt = (f"These are a cook's own words, in {LANGUAGES.get(lang, lang)}, while making {dish or 'a dish'}. List "
              "every ingredient she names as going into the food, by its common English name, once each. Leave out "
              "tools, water used only for washing, and dishes she only mentions.\n\n" + text)
    gen = claude.ClaudeText("claude-sonnet-5-5")
    reply = gen.generate(prompt, Ingredients)
    if usage is not None:
        usage.add("eval-named", gen.model, None, 1, 0.0, reply)
    return Ingredients.model_validate_json(reply.text).names


def judge_missing(named: list[str], recipe_names: list[str], usage=None) -> list[str]:
    """Which of the ingredients the captions name the recipe leaves out, by Claude, allowing synonyms, translations
    and forms ("agathi keerai (sesbania greens)" is "sesbania leaves"; "chilli" is "chili")."""
    from pipeline import claude
    prompt = ("A cook named the ingredients in list A while cooking; a recipe written from the video lists B. Return "
              "the items of A that B does not include under any name: count synonyms, translations, spellings and "
              "forms (whole, chopped, paste, powder of the same thing) as included, and a general item (\"oil\") as "
              "covering a specific one (\"mustard oil\") only when it clearly is the same thing.\n\nA:\n"
              + "\n".join(f"- {n}" for n in named) + "\n\nB:\n" + "\n".join(f"- {n}" for n in recipe_names))
    gen = claude.ClaudeText("claude-sonnet-5-5")
    reply = gen.generate(prompt, Missing)
    if usage is not None:
        usage.add("eval-judge", gen.model, None, 1, 0.0, reply)
    return [m for m in Missing.model_validate_json(reply.text).missing if m in named]


def score(clip: dict, out: Path, minutes: int = MINUTES) -> dict:
    """The clip's scores. The judge's calls go to the recipe's work/usage.json, so they count in its cost."""
    from pipeline import transcribe
    from pipeline.process import Usage
    folder = EVAL / key(clip)
    vtt = next(folder.glob("captions*.vtt"))
    recipe = json.loads((out / "recipe.json").read_text())
    kept_s = recipe["media"]["duration_s"]
    reference = parse_vtt(vtt.read_text(encoding="utf-8"), clip.get("start_s", 0) if clip.get("end_s") else 0.0)
    reference = [x for x in reference if x["start"] < kept_s]  # only the captions of the part that was run
    t = json.loads((out / "work" / "transcript.json").read_text())
    usage = Usage(out / "work" / "usage.json")
    before = usage.calls[:]
    cache = folder / f"named-{minutes}m.json"
    if not cache.exists():
        cache.write_text(json.dumps(named_ingredients(reference, clip["lang"], clip.get("dish", ""), usage),
                                    ensure_ascii=False))
    named = json.loads(cache.read_text())
    names = [i["name"] for i in recipe["ingredients"]]
    judged = out / "work" / "eval_missing.json"  # cached per recipe: a re-run of the clip writes a new recipe
    stamp = json.dumps([named, names], ensure_ascii=False)
    if not judged.exists() or json.loads(judged.read_text()).get("stamp") != stamp:
        judged.write_text(json.dumps({"stamp": stamp, "missing": judge_missing(named, names, usage)},
                                     ensure_ascii=False))
    missing = json.loads(judged.read_text())["missing"]
    last = out / "work" / "eval_run.json"
    run_cost = json.loads(last.read_text())["cost_usd"] if last.exists() else spent(out)
    judge_cost = sum(c["cost_usd"] for c in usage.calls[len(before):])
    return {
        "key": key(clip), "lang": clip["lang"], "dish": clip.get("dish"), "minutes": round(reference[-1]["end"] / 60, 1),
        "transcript_language": t.get("language"), "language_note": t.get("language_note"),
        "loops": round(t.get("loop_words_dropped", 0) / max(1, t.get("loop_words_dropped", 0) + len(t["words"])), 2),
        "heard_raw": heard(reference, transcribe.lines(t["words"]), clip["lang"]),
        "heard_proofread": heard(reference, t["proofread"]["lines"], clip["lang"]) if t.get("proofread") else None,
        "ingredients": round(1 - len(missing) / len(named), 3) if named else None,
        "ingredients_by_name": ingredient_recall(named, names), "named": named, "missing": missing,
        "script": script_share([s.get("quote_original") or "" for s in recipe["steps"]], clip["lang"]),
        "steps": len(recipe["steps"]), "stories": len(recipe.get("stories", [])),
        "cost_usd": round(run_cost + judge_cost, 3),  # this run's pipeline calls and this scoring's judge calls
    }


def table(rows: list[dict]) -> str:
    head = "| lang | dish | min | loops | heard raw | heard proofread | ingredients | script | steps | $ |"
    lines = [head, "|" + "---|" * 10]
    fmt = lambda v: "–" if v is None else (f"{v:.2f}" if isinstance(v, float) else str(v))  # noqa: E731
    for r in rows:
        if "error" in r:
            lines.append(f"| {r['lang']} | {r.get('dish', '')} | error: {r['error'][:60]} |||||||")
            continue
        lines.append(f"| {r['lang']} | {r['dish']} | {r['minutes']} | {fmt(r.get('loops'))} | {fmt(r['heard_raw'])} "
                     f"| {fmt(r['heard_proofread'])} "
                     f"| {fmt(r['ingredients'])} | {fmt(r['script'])} | {r['steps']} | {r['cost_usd']:.2f} |")
    return "\n".join(lines)


def prep_out(clip: dict, minutes: int) -> Path:
    from pipeline.prep import OUT_ROOT
    return OUT_ROOT / recipe_id(clip, minutes)


def one(clip: dict, args, budget: Budget | None, est: float) -> dict:
    """Runs (unless --rescore) and scores one clip. Its row's spent_usd is what this did cost: the growth of the
    recipe's work/usage.json, which holds the pipeline's calls and the judge's."""
    name, out = key(clip), prep_out(clip, args.minutes)
    if args.fresh:
        shutil.rmtree(out, ignore_errors=True)
    before = spent(out)
    try:
        if not args.rescore:
            run(clip, args.minutes, args.rerun)
        row = score(clip, out, args.minutes)
        print(f"[eval] {name}: {row}", flush=True)
    except Exception as e:  # noqa: BLE001 - one clip's failure is a result too
        traceback.print_exc()
        row = {"key": name, "lang": clip["lang"], "dish": clip.get("dish"), "error": f"{type(e).__name__}: {e}"}
    row["spent_usd"] = round(max(spent(out) - before, 0.0), 4)
    if budget:
        budget.done(name, row["spent_usd"])
    return row


def main() -> None:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser(description="Score the pipeline on the 13 cook languages against human captions.")
    pick = ap.add_mutually_exclusive_group()
    pick.add_argument("--only", help="comma-separated language codes: the ones your change touches")
    pick.add_argument("--all", action="store_true", help="all 13 (for a change that touches every language)")
    ap.add_argument("--minutes", type=int, default=MINUTES, help=f"run each clip's first N minutes (default {MINUTES})")
    ap.add_argument("--max-usd", type=float, default=MAX_USD, help=f"stop before passing this (default ${MAX_USD:.0f})")
    ap.add_argument("--no-batch", action="store_true", help="standard API calls: twice the price, answers in seconds")
    ap.add_argument("--jobs", type=int, help=f"clips at once (default {JOBS} on the Batch API, else 1)")
    ap.add_argument("--fetch-only", action="store_true")
    ap.add_argument("--rescore", action="store_true", help="score the cached runs again; no pipeline calls")
    ap.add_argument("--rerun", action="store_true", help="a new recipe for each clip, keeping Cartesia's transcript")
    ap.add_argument("--fresh", action="store_true", help="redo each clip from scratch, the transcript too")
    args = ap.parse_args()
    clips = json.loads(CLIPS.read_text())
    if args.only:
        clips = [c for c in clips if c["lang"] in args.only.split(",")]
    elif not (args.all or args.rescore or args.fetch_only):
        sys.exit(f"Pick the languages your change touches with --only (e.g. --only ta,hi), or --all for all "
                 f"{len(clips)} (about ${sum(estimate(c, args.minutes, True) for c in clips):.2f} on the Batch API).")
    batch = not args.no_batch
    if batch:
        os.environ["CLAUDE_BATCH"] = "1"
    for clip in clips:
        fetch(clip)
    if args.fetch_only:
        return
    jobs = args.jobs or (JOBS if batch else 1)
    budget = None if args.rescore else Budget(args.max_usd)
    plan = sum(estimate(c, args.minutes, batch) for c in clips)
    print(f"[eval] {len(clips)} clip(s), first {args.minutes} min each, {'Batch API' if batch else 'standard API'}, "
          f"{jobs} at a time: about ${plan:.2f} if all run (cap ${args.max_usd:.2f})", flush=True)
    rows, skipped, running = [], [], {}
    def settle(until: int) -> None:  # wait until at most `until` clips are running
        while len(running) > until:
            done, _ = wait(running, return_when=FIRST_COMPLETED)
            for f in done:
                rows.append(f.result())
                running.pop(f)

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for clip in clips:
            settle(jobs - 1)
            est = estimate(clip, args.minutes, batch) if budget else 0.0
            cached = (prep_out(clip, args.minutes) / "recipe.json").exists() and not (args.rerun or args.fresh)
            if budget and not cached and not budget.start(key(clip), est):  # a cached clip only costs the judge
                settle(0)  # the running clips may cost less than their estimates
                if not budget.start(key(clip), est):
                    skipped.append(key(clip))
                    continue
            running[pool.submit(one, clip, args, budget if not cached else None, est)] = clip
        for f in running:
            rows.append(f.result())
    order = {key(c): i for i, c in enumerate(clips)}
    rows.sort(key=lambda r: order.get(r["key"], 99))
    if rows:
        (EVAL / "results").mkdir(parents=True, exist_ok=True)
        path = EVAL / "results" / f"{dt.datetime.now():%Y-%m-%d-%H%M}.json"
        path.write_text(json.dumps(rows, indent=1, ensure_ascii=False) + "\n")
        print(table(rows))
        print(f"\nsaved {path}")
    total = sum(r.get("spent_usd", 0.0) for r in rows)
    print(f"[eval] spent ${total:.2f}" + (f"; stopped at the ${args.max_usd:.2f} cap, not run: {', '.join(skipped)}"
                                           if skipped else ""))


if __name__ == "__main__":
    main()
