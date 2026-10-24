"""Automated evaluation of processed recipes against the PRD "Evaluation checklist".

python pipeline/evaluate.py --id chicken-biryani [--id gordon-gnocchi ...] [--vision]

Deterministic checks compare data/out/<id>/recipe.json with the per-chunk Gemini extraction in
work/chunk_NN.offset.json (seconds from the start of play.mp4). --vision adds one Gemini Flash call
per recipe that looks at 3 frames per step and says whether the frames show the step's action
(approximates "Watch lands on the right action within 10 s").

Writes data/out/<id>/work/eval.json and eval.md; touches nothing else in data/out/.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import BaseModel, ValidationError  # noqa: E402

from pipeline.schema import Recipe  # noqa: E402

OUT_ROOT = ROOT / "data" / "out"
FFMPEG = "/opt/homebrew/bin/ffmpeg" if Path("/opt/homebrew/bin/ffmpeg").exists() else (shutil.which("ffmpeg") or "ffmpeg")

VISION_MODEL = "gemini-3.8-flash"
# USD per 1M tokens, https://ai.google.dev/gemini-api/docs/pricing (output includes thinking).
PRICE_IN, PRICE_OUT = 0.75, 3.75
FRAME_WIDTH = 320

PLACEMENT_TOLERANCE_S = 60  # story/special may sit this far outside its step's range
COVER_TOLERANCE_S = 10  # an extracted step event counts as covered within this many seconds
BIG_GAP_S = 120

PASS, WARN, FAIL, SKIP = "PASS", "WARN", "FAIL", "SKIP"

# Words that make a "feel" an amount ("a nice spoon", "two scoops", "a touch"). Feels without one
# are usually adjectives the extractor put in the wrong field ("fresh", "leftover").
AMOUNT_WORDS = {
    "a", "an", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "dozen",
    "half", "quarter", "third", "couple", "few", "some", "bit", "little", "lot", "lots", "much", "many",
    "enough", "all", "whole", "pinch", "touch", "dash", "splash", "drizzle", "glug", "knob", "handful",
    "scoop", "spoon", "spoonful", "tablespoon", "teaspoon", "tbsp", "tsp", "cup", "cups", "pound", "lb",
    "ounce", "oz", "gram", "grams", "g", "kg", "ml", "liter", "litre", "piece", "pieces", "clove", "cloves",
    "slice", "slices", "bunch", "sprig", "sprigs", "stick", "can", "jar", "packet", "bag", "generous",
    "generously", "plenty", "more", "less", "double", "single", "strand", "strands", "drop", "drops",
}
NAME_STOPWORDS = {"of", "the", "a", "an", "and", "with", "for", "to"}


# ---------- text helpers ----------

def norm(s: str | None) -> str:
    """Lowercase, straighten quotes, drop punctuation (keep apostrophes, digits, '/'), collapse spaces."""
    if not s:
        return ""
    s = s.lower()
    for a, b in (("\u2019", "'"), ("\u2018", "'"), ("\u201c", '"'), ("\u201d", '"'), ("\u2013", "-"),
                 ("\u2014", "-"), ("\u2026", " ")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9'/ ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def contains(hay: str, needle: str) -> bool:
    """Word-bounded containment on normalized text."""
    h, n = norm(hay), norm(needle)
    return bool(n) and f" {n} " in f" {h} "


def singular(t: str) -> str:
    if len(t) > 4 and t.endswith("ies"):
        return t[:-3] + "y"
    if len(t) > 4 and t.endswith("oes"):
        return t[:-2]
    if len(t) > 4 and t.endswith("es") and t[:-2].endswith(("ch", "sh", "ss", "x")):
        return t[:-2]
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
        return t[:-1]
    return t


def name_tokens(s: str) -> set[str]:
    return {singular(t) for t in norm(s).replace("'", " ").split() if t not in NAME_STOPWORDS}


def names_match(a: str, b: str) -> bool:
    ta, tb = name_tokens(a), name_tokens(b)
    return bool(ta and tb) and (ta <= tb or tb <= ta)


def fmt_t(s: float) -> str:
    s = int(round(s))
    return f"{s // 60}:{s % 60:02d}"


def overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def check(name: str, status: str, summary: str, details: list[str] | None = None, **data) -> dict:
    return {"name": name, "status": status, "summary": summary, "details": details or [], **data}


# ---------- loading ----------

def load(recipe_id: str) -> tuple[Path, dict, list[dict]]:
    out = OUT_ROOT / recipe_id
    path = out / "recipe.json"
    if not path.exists():
        raise SystemExit(f"[eval] {path} not found; run process.py first")
    raw = json.loads(path.read_text())
    chunks = sorted((out / "work").glob("chunk_*.offset.json"))
    if not chunks:
        raise SystemExit(f"[eval] no work/chunk_*.offset.json in {out}; cannot compare against extraction")
    events: list[dict] = []
    for c in chunks:
        j = json.loads(c.read_text())
        evs = j["events"] if isinstance(j, dict) else j
        for e in evs:
            e.setdefault("_chunk", c.name)
            events.append(e)
    events.sort(key=lambda e: (e["start_s"], e["end_s"]))
    return out, raw, events


# ---------- deterministic checks ----------

def check_schema(raw: dict) -> dict:
    try:
        Recipe.model_validate(raw)
        return check("Schema valid", PASS, "Recipe.model_validate OK")
    except (ValidationError, ValueError) as e:
        lines = [ln for ln in str(e).splitlines() if ln.strip() and "errors.pydantic.dev" not in ln]
        return check("Schema valid", FAIL, "Recipe.model_validate failed", lines[:15])


def check_ingredients(raw: dict, events: list[dict]) -> tuple[dict, dict, int]:
    chunk_names = [i["name"] for e in events if e["type"] == "step" for i in (e.get("ingredients") or [])]
    corpus = " | ".join(norm(" ".join(filter(None, [e.get("action"), e.get("quote"), e.get("sensory_cue"),
                                                     e.get("text"), e.get("why")]))) for e in events)
    invented, mentioned_only, ok = [], [], 0
    for ing in raw.get("ingredients", []):
        name = ing["name"]
        if any(names_match(name, c) for c in chunk_names):
            ok += 1
        elif any(f" {t} " in f" {corpus} " for t in name_tokens(name) if len(t) > 2):
            mentioned_only.append(name)
        else:
            invented.append(name)
    n = len(raw.get("ingredients", []))
    details = [f"invented (not in any extracted ingredient or transcript): {x}" for x in invented]
    details += [f"not an extracted ingredient, but a word of it appears in quotes/actions: {x}" for x in mentioned_only]
    status = FAIL if invented else WARN if mentioned_only else PASS
    inv = check("No invented ingredients", status,
                f"{ok}/{n} match an extracted ingredient; {len(invented)} invented, {len(mentioned_only)} only mentioned",
                details, invented=invented, mentioned_only=mentioned_only)

    recipe_names = [i["name"] for i in raw.get("ingredients", [])]
    dropped = sorted({c for c in chunk_names if not any(names_match(c, r) for r in recipe_names)}, key=str.lower)
    drop = check("No dropped ingredients", WARN if dropped else PASS,
                 f"{len(dropped)} extracted ingredient name(s) missing from the recipe list",
                 [f"extracted but not in recipe: {d}" for d in dropped], dropped=dropped)
    return inv, drop, len(invented)


def check_feel(raw: dict, events: list[dict]) -> tuple[dict, dict, int]:
    chunk_feels = [i.get("feel") or "" for e in events if e["type"] == "step" for i in (e.get("ingredients") or [])]
    quotes = [e.get("quote") or "" for e in events] + [e.get("text") or "" for e in events]
    quotes += [s.get("quote") or "" for s in raw.get("steps", [])]

    def grounded(part: str) -> tuple[bool, bool]:
        in_quote = any(contains(q, part) for q in quotes)
        in_feel = any(contains(f, part) for f in chunk_feels)
        return in_feel or in_quote, in_quote

    paraphrased, unheard, combined, verbatim, not_amount, empty = [], [], [], 0, [], []
    for ing in raw.get("ingredients", []):
        feel = ing.get("feel") or ""
        if not norm(feel):
            empty.append(ing["name"])  # the cook gave no amount; the app shows a blank feel
            continue
        ok, heard = grounded(feel)
        if not ok:
            parts = [p.strip() for p in re.split(r"[,;+]| plus ", feel) if p.strip()]
            results = [grounded(p) for p in parts]
            if len(parts) > 1 and all(r[0] for r in results):
                ok, heard = True, all(r[1] for r in results)
                combined.append(f"{ing['name']}: \"{feel}\"")
        if not ok:
            paraphrased.append(f"{ing['name']}: \"{feel}\"")
            continue
        verbatim += 1
        if not heard:
            unheard.append(f"{ing['name']}: \"{feel}\"")
        if not (set(norm(feel).split()) & AMOUNT_WORDS) and not re.search(r"\d", feel):
            not_amount.append(f"{ing['name']}: \"{feel}\"")

    n = len(raw.get("ingredients", []))
    details = [f"paraphrased (not in any extracted feel or quote): {x}" for x in paraphrased]
    details += [f"empty feel (no words from the cook): {x}" for x in empty]
    details += [f"matches the extraction's feel but never appears in any quote: {x}" for x in unheard]
    details += [f"merge joined several feels into one string: {x}" for x in combined]
    status = FAIL if paraphrased else WARN if unheard or empty else PASS
    feel = check("Feel words verbatim", status,
                 f"{verbatim}/{n} verbatim; {len(paraphrased)} paraphrased; {len(empty)} empty; "
                 f"{len(unheard)} not heard in any quote; {len(combined)} combined", details,
                 paraphrased=paraphrased, empty=empty, unheard=unheard, combined=combined)
    amt = check("Feel words are amounts", WARN if not_amount else PASS,
                f"{len(not_amount)}/{n} feel(s) contain no amount word (likely an adjective, not a quantity)",
                [f"no amount: {x}" for x in not_amount], not_amount=not_amount)
    return feel, amt, len(paraphrased)


def check_placement(raw: dict) -> dict:
    steps = {s["order"]: s for s in raw.get("steps", [])}
    bad, elsewhere, details = 0, 0, []
    items = [("story", st) for st in raw.get("stories", [])] + [("special", sp) for sp in raw.get("special", [])]
    for kind, it in items:
        step = steps.get(it["step"])
        a = it["start_s"]
        b = it.get("end_s") if it.get("end_s") is not None else a
        label = f"{kind} {it['id']} ({fmt_t(a)}-{fmt_t(b)}) on step {it['step']}"
        if step is None:
            bad += 1
            details.append(f"{label}: step does not exist")
            continue
        dist = max(0, a - step["end_s"], step["start_s"] - b)
        mid = (a + b) / 2
        during = [s["order"] for s in steps.values() if s["start_s"] < mid < s["end_s"]]
        if dist > PLACEMENT_TOLERANCE_S:
            bad += 1
            details.append(f"{label}: {dist}s away from step range {fmt_t(step['start_s'])}-{fmt_t(step['end_s'])}"
                           + (f"; happens during step {during[0]}" if during else ""))
        elif during and it["step"] not in during:
            elsewhere += 1
            details.append(f"{label}: within {dist}s, but happens during step {during[0]}")
    status = FAIL if bad else WARN if elsewhere else PASS
    return check("Stories & specials placement", status,
                 f"{len(items)} item(s); {bad} more than {PLACEMENT_TOLERANCE_S}s from their step; "
                 f"{elsewhere} closer to another step", details)


def check_timestamps(raw: dict, events: list[dict]) -> tuple[dict, dict]:
    dur = raw["media"]["duration_s"]
    steps = raw.get("steps", [])
    problems, warns = [], []
    for s in steps:
        if not 0 <= s["start_s"] < s["end_s"] <= dur:
            problems.append(f"step {s['order']}: {s['start_s']}-{s['end_s']} outside 0..{dur}")
    for kind, items in (("story", raw.get("stories", [])), ("special", raw.get("special", []))):
        for it in items:
            end = it.get("end_s") if it.get("end_s") is not None else it["start_s"]
            if not 0 <= it["start_s"] <= end <= dur:
                problems.append(f"{kind} {it['id']}: {it['start_s']}-{end} outside 0..{dur}")
    starts = [s["start_s"] for s in steps]
    if starts != sorted(starts):
        problems.append(f"steps not in start order: {starts}")
    for a, b in zip(steps, steps[1:]):
        if a["end_s"] - b["start_s"] > 5:
            warns.append(f"steps {a['order']} & {b['order']} overlap by {a['end_s'] - b['start_s']}s")

    covered = sum(max(0, min(s["end_s"], dur) - max(s["start_s"], 0)) for s in steps)
    coverage = covered / dur if dur else 0.0
    step_events = [e for e in events if e["type"] == "step"]
    gaps = []
    bounds = [("start of video", 0)] + [(f"step {s['order']}", s["end_s"]) for s in steps]
    nexts = [(f"step {s['order']}", s["start_s"]) for s in steps] + [("end of video", dur)]
    for (la, ga), (lb, gb) in zip(bounds, nexts):
        if gb - ga > BIG_GAP_S:
            inside = [e for e in step_events if overlap(e["start_s"], max(e["end_s"], e["start_s"] + 1), ga, gb) > 0]
            gaps.append({"from": la, "to": lb, "start_s": ga, "end_s": gb, "seconds": gb - ga,
                         "extracted_steps_inside": [f"{fmt_t(e['start_s'])} {e['action']}" for e in inside]})
            warns.append(f"gap {gb - ga}s between {la} ({fmt_t(ga)}) and {lb} ({fmt_t(gb)})"
                         + (f" containing {len(inside)} extracted step(s) not in the recipe: "
                            + "; ".join(f"{fmt_t(e['start_s'])} {e['action']}" for e in inside) if inside else ""))
    inner_gaps = [b["start_s"] - a["end_s"] for a, b in zip(steps, steps[1:])]
    largest = max(inner_gaps, default=0)
    status = FAIL if problems else WARN if warns else PASS
    ts = check("Timestamps", status,
               f"coverage {coverage:.0%} of {fmt_t(dur)}; largest gap between steps {largest}s; "
               f"lead-in {starts[0] if starts else dur}s, tail {dur - steps[-1]['end_s'] if steps else dur}s",
               problems + warns, coverage=round(coverage, 3), largest_gap_s=largest, gaps=gaps)

    # Missing steps: extracted step events mostly outside every recipe step (+-COVER_TOLERANCE_S).
    ranges = [(s["start_s"] - COVER_TOLERANCE_S, s["end_s"] + COVER_TOLERANCE_S) for s in steps]
    missing = []
    for e in step_events:
        a, b = e["start_s"], e["end_s"]
        if b <= a:
            hit = any(r0 <= a <= r1 for r0, r1 in ranges)
        else:
            # union coverage of [a, b] by the expanded ranges
            pts = sorted((max(a, r0), min(b, r1)) for r0, r1 in ranges if min(b, r1) > max(a, r0))
            cov, cur = 0.0, a
            for p0, p1 in pts:
                p0 = max(p0, cur)
                if p1 > p0:
                    cov += p1 - p0
                    cur = p1
            hit = cov / (b - a) >= 0.5
        if not hit:
            missing.append(f"{fmt_t(a)}-{fmt_t(b)} {e['action']}")
    ms = check("Missing steps (heuristic)", WARN if missing else PASS,
               f"{len(step_events)} extracted step events -> {len(steps)} recipe steps; "
               f"{len(missing)} extracted step(s) not covered by any recipe step (+-{COVER_TOLERANCE_S}s)",
               [f"not covered: {m}" for m in missing], missing=missing,
               extracted_steps=len(step_events), recipe_steps=len(steps))
    return ts, ms


def check_quotes(raw: dict, events: list[dict]) -> dict:
    """Each sentence of a step quote should be verbatim from an extracted quote that was said during
    the step; otherwise Hear the cook plays different words than the subtitle shows. The merge joins
    several chunk quotes with '...' or '. ', so sentences (3+ words) are checked one by one."""
    srcs = [e for e in events if e.get("quote") or e.get("text")]
    not_found, out_of_range, n_frag = [], [], 0
    for s in raw.get("steps", []):
        frags = [f.strip() for f in re.split(r"\.\.\.|\u2026|(?<=[.!?])\s+", s.get("quote") or "")
                 if len(norm(f).split()) >= 3]
        for f in frags:
            n_frag += 1
            hits = [e for e in srcs if contains(e.get("quote") or "", f) or contains(e.get("text") or "", f)]
            short = f if len(f) < 70 else f[:67] + "..."
            if not hits:
                not_found.append(f"step {s['order']}: \"{short}\"")
            elif not any(overlap(e["start_s"] - COVER_TOLERANCE_S, e["end_s"] + COVER_TOLERANCE_S,
                                 s["start_s"], s["end_s"]) > 0 or s["start_s"] <= e["start_s"] <= s["end_s"]
                         for e in hits):
                e = hits[0]
                out_of_range.append(f"step {s['order']} ({fmt_t(s['start_s'])}-{fmt_t(s['end_s'])}): \"{short}\" "
                                    f"was said at {fmt_t(e['start_s'])}-{fmt_t(e['end_s'])}")
    details = [f"not verbatim in any extracted quote: {x}" for x in not_found]
    details += [f"quote said outside the step's range: {x}" for x in out_of_range]
    return check("Step quotes verbatim & in range", WARN if details else PASS,
                 f"{n_frag - len(not_found) - len(out_of_range)}/{n_frag} quote sentence(s) verbatim and in range",
                 details)


# ---------- vision ----------

class VisionStep(BaseModel):
    order: int
    matches: Literal["yes", "partly", "no"]
    starts_on_action: bool
    note: str


class VisionOut(BaseModel):
    steps: list[VisionStep]


def frame_times(start: float, end: float, dur: float) -> list[float]:
    if end - start >= 6:
        ts = [start + 2, (start + end) / 2, end - 2]
    else:
        ts = [start + (end - start) * f for f in (0.2, 0.5, 0.8)]
    return [min(max(t, 0), max(dur - 0.5, 0)) for t in ts]


def grab_frame(video: Path, t: float) -> bytes:
    cmd = [FFMPEG, "-v", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
           "-vf", f"scale={FRAME_WIDTH}:-2", "-q:v", "6", "-f", "image2pipe", "-vcodec", "mjpeg", "-"]
    r = subprocess.run(cmd, capture_output=True, timeout=60)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"ffmpeg frame at {t:.1f}s failed: {r.stderr.decode(errors='replace')[:300]}")
    return r.stdout


VISION_PROMPT = """You are checking a recipe app's step timestamps against its cooking video.
Each step below has a title, an instruction, its video range, and 3 frames sampled from that range:
~2 s after the start, the middle, and ~2 s before the end. Frames are small (320 px wide).

For EVERY step, judge whether the frames show that step's action (the hands, ingredients, tools or
food state the instruction describes):
- matches: "yes" if the frames clearly show this step being done; "partly" if only some frames do,
  or they show the setup/result or a talking-to-camera shot of the same step; "no" if the frames
  show a different step or unrelated footage.
- starts_on_action: true if the FIRST frame (~2 s in) already shows this step's action or its
  immediate setup, i.e. pressing Watch would land on the right moment.
- note: one short sentence on what the frames actually show, especially when not "yes".
Judge only what is visible; do not assume. Return one entry per step, in order."""


def run_vision(client, raw: dict, video: Path) -> dict:
    from google.genai import types

    dur = raw["media"]["duration_s"]
    steps = raw.get("steps", [])
    jobs = [(s["order"], t) for s in steps for t in frame_times(s["start_s"], s["end_s"], dur)]
    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=8) as pool:
        frames = list(pool.map(lambda j: grab_frame(video, j[1]), jobs))
    grab_s = time.monotonic() - t0

    contents: list = [VISION_PROMPT]
    k = 0
    for s in steps:
        ts = [t for o, t in jobs if o == s["order"]]
        contents.append(f"\nStep {s['order']}: {s['title']}. {s['instruction']} "
                        f"(range {fmt_t(s['start_s'])}-{fmt_t(s['end_s'])}; frames at "
                        + ", ".join(fmt_t(t) for t in ts) + ")")
        for _ in ts:
            contents.append(types.Part.from_bytes(data=frames[k], mime_type="image/jpeg"))
            k += 1

    config = types.GenerateContentConfig(response_mime_type="application/json", response_schema=VisionOut,
                                         media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW)
    last_err: Optional[Exception] = None
    calls = []
    for attempt in (1, 2):
        t1 = time.monotonic()
        resp = None
        try:
            resp = client.models.generate_content(model=VISION_MODEL, contents=contents, config=config)
            out = resp.parsed if isinstance(resp.parsed, VisionOut) else VisionOut.model_validate_json(resp.text)
        except Exception as e:  # noqa: BLE001 - retry once on any API/parse error
            last_err = e
            out = None
        meta = resp.usage_metadata if resp is not None else None
        p = (meta.prompt_token_count or 0) if meta else 0
        o = ((meta.candidates_token_count or 0) + (meta.thoughts_token_count or 0)) if meta else 0
        cost = (p * PRICE_IN + o * PRICE_OUT) / 1_000_000
        calls.append({"attempt": attempt, "seconds": round(time.monotonic() - t1, 1), "prompt_tokens": p,
                      "candidates_tokens": (meta.candidates_token_count or 0) if meta else 0,
                      "thoughts_tokens": (meta.thoughts_token_count or 0) if meta else 0,
                      "cost_usd": round(cost, 6), "ok": out is not None,
                      "error": None if out is not None else repr(last_err)[:300]})
        print(f"  [vision] attempt {attempt}: {calls[-1]['seconds']}s, prompt {p} tok, output+thinking {o} tok, "
              f"~${cost:.4f}" + ("" if out is not None else f"  ERROR {repr(last_err)[:200]}"), flush=True)
        if out is not None:
            break
    total_cost = sum(c["cost_usd"] for c in calls)
    base = {"model": VISION_MODEL, "frames": len(frames), "frame_grab_s": round(grab_s, 1), "calls": calls,
            "cost_usd": round(total_cost, 6)}
    if out is None:
        return {**base, "ok": False, "steps": []}
    by_order = {v.order: v for v in out.steps}
    results = []
    for s in steps:
        v = by_order.get(s["order"])
        results.append({"order": s["order"], "title": s["title"], "start_s": s["start_s"], "end_s": s["end_s"],
                        "frames_at": [round(t, 1) for o, t in jobs if o == s["order"]],
                        "matches": v.matches if v else "missing", "starts_on_action": v.starts_on_action if v else None,
                        "note": v.note if v else "model returned no entry for this step"})
    return {**base, "ok": True, "steps": results}


def vision_check(vision: dict) -> dict:
    if not vision.get("ok"):
        return check("Watch lands on the action (vision)", FAIL, "vision call failed", [str(vision.get("calls"))])
    st = vision["steps"]
    yes = sum(v["matches"] == "yes" for v in st)
    partly = [v for v in st if v["matches"] == "partly"]
    no = [v for v in st if v["matches"] not in ("yes", "partly")]
    late = [v for v in st if v["starts_on_action"] is False]
    details = [f"step {v['order']} {v['matches'].upper()}: {v['title']} ({fmt_t(v['start_s'])}-{fmt_t(v['end_s'])}) "
               f"- {v['note']}" for v in no + partly]
    details += [f"step {v['order']} first frame not on the action: {v['note']}" for v in late
                if v["matches"] == "yes"]
    status = FAIL if no else WARN if partly or late else PASS
    return check("Watch lands on the action (vision)", status,
                 f"{yes}/{len(st)} yes, {len(partly)} partly, {len(no)} no; "
                 f"{len(st) - len(late)}/{len(st)} start on the action", details)


# ---------- report ----------

def evaluate(recipe_id: str, client) -> dict:
    out, raw, events = load(recipe_id)
    print(f"\n=== {recipe_id}: {raw.get('title')} ({len(raw.get('steps', []))} steps, "
          f"{len(events)} extracted events, {fmt_t(raw['media']['duration_s'])}) ===", flush=True)
    checks = [check_schema(raw)]
    inv, drop, n_invented = check_ingredients(raw, events)
    feel, amt, n_para = check_feel(raw, events)
    ts, ms = check_timestamps(raw, events)
    checks += [inv, drop, feel, amt, check_placement(raw), ts, ms, check_quotes(raw, events)]

    vision = None
    if client is not None:
        vision = run_vision(client, raw, out / "play.mp4")
        checks.append(vision_check(vision))

    for c in checks:
        print(f"  [{c['status']}] {c['name']}: {c['summary']}")
        for d in c["details"][:10]:
            print(f"         - {d}")
        if len(c["details"]) > 10:
            print(f"         ... {len(c['details']) - 10} more in eval.json")

    n_steps = len(raw.get("steps", []))
    if vision and vision.get("ok"):
        yes = sum(v["matches"] == "yes" for v in vision["steps"])
        partly = sum(v["matches"] == "partly" for v in vision["steps"])
        head = f"{yes}/{n_steps} steps on-target (vision; {partly} partly)"
    else:
        head = "vision not run"
    placement = next(c for c in checks if c["name"] == "Stories & specials placement")
    line = (f"{head}, {n_invented} invented ingredients, {n_para} paraphrased feel words, "
            f"{len(ms['missing'])} possibly missing steps, coverage {ts['coverage']:.0%}, "
            f"stories/specials {placement['status']}")
    print(f"  SUMMARY {recipe_id}: {line}")
    if vision:
        print(f"  vision cost ~${vision['cost_usd']:.4f}")

    report = {"id": recipe_id, "title": raw.get("title"), "evaluated_at": datetime.now(timezone.utc).isoformat(
        timespec="seconds"), "duration_s": raw["media"]["duration_s"], "summary": line, "checks": checks,
        "vision": vision}
    (out / "work" / "eval.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "work" / "eval.md").write_text(to_markdown(report))
    return report


def md_cell(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def to_markdown(r: dict) -> str:
    lines = [f"# Eval: {r['title']} (`{r['id']}`)", "", f"_{r['evaluated_at']}_ · {fmt_t(r['duration_s'])} video",
             "", f"**{r['summary']}**", "", "| Check | Status | Result |", "|---|---|---|"]
    for c in r["checks"]:
        lines.append(f"| {c['name']} | {c['status']} | {md_cell(c['summary'])} |")
    flagged = [c for c in r["checks"] if c["details"]]
    if flagged:
        lines += ["", "## Details"]
        for c in flagged:
            lines += ["", f"**{c['name']}** ({c['status']})"] + [f"- {md_cell(d)}" for d in c["details"]]
    v = r.get("vision")
    if v and v.get("ok"):
        lines += ["", f"## Vision ({v['model']}, {v['frames']} frames, ~${v['cost_usd']:.4f})", "",
                  "| Step | Title | Range | Match | Starts on action | Note |", "|---|---|---|---|---|---|"]
        for s in v["steps"]:
            lines.append(f"| {s['order']} | {md_cell(s['title'])} | {fmt_t(s['start_s'])}-{fmt_t(s['end_s'])} | "
                         f"{s['matches']} | {'yes' if s['starts_on_action'] else 'no'} | {md_cell(s['note'])} |")
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description="Evaluate processed recipes against the PRD checklist.")
    ap.add_argument("--id", action="append", required=True, help="recipe id (repeatable)")
    ap.add_argument("--vision", action="store_true", help=f"also check step frames with {VISION_MODEL} (paid)")
    args = ap.parse_args()

    client = None
    if args.vision:
        from dotenv import load_dotenv
        from google import genai

        load_dotenv(ROOT / ".env")
        if not os.environ.get("GEMINI_API_KEY"):
            raise SystemExit("[eval] GEMINI_API_KEY is not set (.env); needed for --vision")
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    reports = [evaluate(i, client) for i in args.id]
    print("\n=== overall ===")
    for r in reports:
        print(f"  {r['id']}: {r['summary']}")
    if client is not None:
        total = sum((r["vision"] or {}).get("cost_usd", 0) for r in reports)
        print(f"  total vision cost ~${total:.4f} ({VISION_MODEL}, ${PRICE_IN}/M in, ${PRICE_OUT}/M out incl. thinking)")


if __name__ == "__main__":
    main()
