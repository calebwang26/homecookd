"""The 13-language eval: how well the pipeline hears and writes each cook language, scored against human captions.

    .venv/bin/python pipeline/eval_languages.py [--only ta,hi] [--fetch-only] [--rescore]

Each clip in eval_clips.json is a home-cooking video in one of the 13 cook languages (memory marathi-dropped) whose
YouTube subtitles were written by people in that language: those captions are the ground truth. For each clip:
1. fetch: yt-dlp downloads the clip's span (at most 720p) and its manual captions into data/eval/<key>/ (gitignored;
   internal testing only, never published or bundled). Needs yt-dlp in .venv (`pip install yt-dlp`).
2. run: prep.run + process.run, the real pipeline with the root .env's switches (Claude + Cartesia today), as recipe
   eval-<key> in data/out/. Cached: --rescore only scores again.
3. score (pure, tested in test_eval_languages.py):
   - heard_raw / heard_proofread: the share of the captions' words found in Cartesia's transcript (raw lines) and in
     the proofread copy, per minute of captions, fuzzy-matched (difflib >= 0.8); Mandarin by characters;
   - ingredients: the share of the ingredients the captions name (one Claude call reads them) that the recipe lists;
   - script: the share of quote_original letters in her language's script (English and Latin-script languages: 1);
   - steps, stories and cost (work/usage.json, plus Cartesia credits not priced).
Results: data/eval/results/<date>.json and a table on stdout. Costs about $0.3-0.5 a clip.
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import BaseModel  # noqa: E402

CLIPS = Path(__file__).resolve().parent / "eval_clips.json"
EVAL = ROOT / "data" / "eval"
MATCH, WINDOW_S, SLACK_S = 0.8, 60.0, 5.0
SCRIPT_RANGES = {  # Unicode blocks of each language's own script
    "hi": [(0x0900, 0x097F)], "gu": [(0x0A80, 0x0AFF)], "ta": [(0x0B80, 0x0BFF)], "te": [(0x0C00, 0x0C7F)],
    "pa": [(0x0A00, 0x0A7F)], "ur": [(0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)],
    "ar": [(0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)], "zh": [(0x4E00, 0x9FFF)],
    "ko": [(0xAC00, 0xD7AF), (0x1100, 0x11FF), (0x3130, 0x318F)],
}


class Ingredients(BaseModel):
    names: list[str]


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


def recipe_id(clip: dict) -> str:
    """prep's recipe ids are lowercase letters, digits and hyphens."""
    return re.sub(r"[^a-z0-9]+", "-", f"eval-{key(clip)}".lower()).strip("-")


def fetch(clip: dict) -> Path:
    folder = EVAL / key(clip)
    folder.mkdir(parents=True, exist_ok=True)
    video, url = folder / "source.mp4", f"https://www.youtube.com/watch?v={clip['id']}"
    ytdlp = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--quiet", "--no-warnings"]
    span = f"*{clip.get('start_s', 0)}-{clip['end_s']}" if clip.get("end_s") else None
    if not video.exists():
        subprocess.run(ytdlp + ["-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
                                *(["--download-sections", span, "--force-keyframes-at-cuts"] if span else []),
                                "-o", str(video), url], check=True)
    if not list(folder.glob("captions*.vtt")):
        subprocess.run(ytdlp + ["--skip-download", "--write-subs", "--sub-langs", clip["sub_lang"], "--sub-format",
                                "vtt", "-o", str(folder / "captions"), url], check=True)
    return folder


def run(clip: dict) -> Path:
    from pipeline import prep, process
    rid = recipe_id(clip)
    out = prep.OUT_ROOT / rid
    if not (out / "recipe.json").exists():
        prep.run(rid, clip.get("dish") or "", "Cook", "Cook", [EVAL / key(clip) / "source.mp4"])
        process.run(rid, language=clip["lang"])
    return out


def named_ingredients(reference: list[dict], lang: str, dish: str) -> list[str]:
    """The ingredients the captions name, in English (one Claude call; cached by the caller)."""
    from pipeline import claude
    from pipeline.prompts import LANGUAGES
    text = "\n".join(x["text"] for x in reference)[:30_000]
    prompt = (f"These are a cook's own words, in {LANGUAGES.get(lang, lang)}, while making {dish or 'a dish'}. List "
              "every ingredient she names as going into the food, by its common English name, once each. Leave out "
              "tools, water used only for washing, and dishes she only mentions.\n\n" + text)
    reply = claude.ClaudeText("claude-sonnet-5-5").generate(prompt, Ingredients)
    return Ingredients.model_validate_json(reply.text).names


def score(clip: dict, out: Path) -> dict:
    from pipeline import transcribe
    from pipeline.seen import listed
    folder = EVAL / key(clip)
    vtt = next(folder.glob("captions*.vtt"))
    reference = parse_vtt(vtt.read_text(encoding="utf-8"), clip.get("start_s", 0) if clip.get("end_s") else 0.0)
    if clip.get("end_s"):  # only the captions of the span that was cut and run
        reference = [x for x in reference if x["start"] < clip["end_s"] - clip.get("start_s", 0)]
    recipe = json.loads((out / "recipe.json").read_text())
    t = json.loads((out / "work" / "transcript.json").read_text())
    cache = folder / "named.json"
    if not cache.exists():
        cache.write_text(json.dumps(named_ingredients(reference, clip["lang"], clip.get("dish", "")), ensure_ascii=False))
    named = json.loads(cache.read_text())
    names = [i["name"] for i in recipe["ingredients"]]
    usage = json.loads((out / "work" / "usage.json").read_text()) if (out / "work" / "usage.json").exists() else {}
    return {
        "key": key(clip), "lang": clip["lang"], "dish": clip.get("dish"), "minutes": round(reference[-1]["end"] / 60, 1),
        "transcript_language": t.get("language"), "language_note": t.get("language_note"),
        "heard_raw": heard(reference, transcribe.lines(t["words"]), clip["lang"]),
        "heard_proofread": heard(reference, t["proofread"]["lines"], clip["lang"]) if t.get("proofread") else None,
        "ingredients": ingredient_recall(named, names), "named": named,
        "missing": [n for n in named if not listed(n, names)],
        "script": script_share([s.get("quote_original") or "" for s in recipe["steps"]], clip["lang"]),
        "steps": len(recipe["steps"]), "stories": len(recipe.get("stories", [])),
        "cost_usd": round(usage.get("estimated_cost_usd", 0.0), 3),
    }


def table(rows: list[dict]) -> str:
    head = "| lang | dish | min | heard raw | heard proofread | ingredients | script | steps | $ |"
    lines = [head, "|" + "---|" * 9]
    fmt = lambda v: "–" if v is None else (f"{v:.2f}" if isinstance(v, float) else str(v))  # noqa: E731
    for r in rows:
        if "error" in r:
            lines.append(f"| {r['lang']} | {r.get('dish', '')} | error: {r['error'][:60]} |||||||")
            continue
        lines.append(f"| {r['lang']} | {r['dish']} | {r['minutes']} | {fmt(r['heard_raw'])} | {fmt(r['heard_proofread'])} "
                     f"| {fmt(r['ingredients'])} | {fmt(r['script'])} | {r['steps']} | {r['cost_usd']:.2f} |")
    return "\n".join(lines)


def main() -> None:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser(description="Score the pipeline on the 13 cook languages against human captions.")
    ap.add_argument("--only", help="comma-separated language codes")
    ap.add_argument("--fetch-only", action="store_true")
    ap.add_argument("--rescore", action="store_true", help="score the cached runs again; run nothing new")
    args = ap.parse_args()
    clips = [c for c in json.loads(CLIPS.read_text()) if not args.only or c["lang"] in args.only.split(",")]
    rows = []
    for clip in clips:
        try:
            fetch(clip)
            if args.fetch_only:
                continue
            from pipeline.prep import OUT_ROOT
            out = run(clip) if not args.rescore else OUT_ROOT / recipe_id(clip)
            rows.append(score(clip, out))
            print(f"[eval] {key(clip)}: {rows[-1]}", flush=True)
        except Exception as e:  # noqa: BLE001 - one clip's failure is a result too
            traceback.print_exc()
            rows.append({"key": key(clip), "lang": clip["lang"], "dish": clip.get("dish"), "error": f"{type(e).__name__}: {e}"})
    if rows:
        (EVAL / "results").mkdir(parents=True, exist_ok=True)
        path = EVAL / "results" / f"{dt.date.today()}.json"
        path.write_text(json.dumps(rows, indent=1, ensure_ascii=False) + "\n")
        print(table(rows))
        print(f"\nsaved {path}")


if __name__ == "__main__":
    main()
