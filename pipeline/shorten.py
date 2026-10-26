"""Cook mode's short version of each step: 2-5 short substeps, the ingredients the step uses, and a tip.

python pipeline/shorten.py --id weed-steak [--dry-run] [--force]
python pipeline/shorten.py --all [--dry-run] [--force]

One text call per recipe returns, for every step (Gemini's GEMINI_MODEL, set up like process.py's merge; Claude
Haiku with TEXT_PROVIDER=claude, pipeline/claude.py):
- substeps [{text, detail}]: text is one short line (at most 70 characters, **bold** around amounts, heat and
  times); detail is the line's fuller wording from the instruction, shown in the line's place when the cook
  taps it, or null (when it would add fewer than DETAIL_NEW words).
- uses [{name, amount}]: every ingredient the step needs, reused ones included; name matches an ingredient;
  amount is a measurement (the step's own, else the ingredient's estimate) or null (an earlier step added
  it, or it is split across steps with no measured share).
- tip: one useful tip in the cook's own words, or null (most steps).
normalize() applies the amount and detail rules exactly, and unbolds a line's loose amount ("a splash" of
water) where the step's card measures it; check() rejects what the recipe does not support: a number, heat
level or bold amount it never gives, a time the step never says, an unknown ingredient, a placeholder, a line
too long for two lines, a tip that repeats the lines (its "Ready when" cue included) or too many tips. A
rejected answer is retried once with the errors fed back; after that the recipe is reported and left
unchanged.

--id ID shortens every copy of one recipe that exists: data/out/ID/recipe.json, app/assets/data/recipes/ID.json
and data/synthetic/ID.json. --all does that for every bundled and synthetic recipe. Copies with the same steps share one
call. Recipes that already have substeps are skipped unless --force (a copy that lacks them while a matching copy
has them gets them copied, no call). --dry-run calls the model and prints the result without writing anything.
process.py calls shorten_file() right after the merge (skip with --no-shorten).

Old recipes without substeps still work: the app splits the instruction itself.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import os
import re
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
from pydantic import BaseModel, ValidationError  # noqa: E402

from pipeline.process import (HTTP_RETRY, REQUEST_TIMEOUT_MS, ProcessError, TextModel, Usage,  # noqa: E402
                              describe_call, format_validation_error, load_config, log, response_text, text_model)
from pipeline.prompts import SHORTEN_PROMPT, SHORTEN_RETRY_SUFFIX  # noqa: E402
from pipeline.schema import Recipe  # noqa: E402

OUT = ROOT / "data" / "out"
BUNDLED = ROOT / "app" / "assets" / "data" / "recipes"
SYNTHETIC = ROOT / "data" / "synthetic"

MAX_TEXT = 70  # visible characters (without the ** markers): two lines on a phone
MIN_SUBSTEPS, MAX_SUBSTEPS = 2, 5
MAX_TIP = 160
TIP_REPEAT = 0.7  # share of a tip's words already on the step's lines that makes it a repeat
CUE_REPEAT = 0.6  # share of a "Ready when" cue's words in the tip that makes the tip a repeat of it
DETAIL_NEW = 4  # a detail adding fewer new words than this is dropped: the tap would only repeat the line
DETAIL_RESTATES = 0.6  # share of the line's words a detail holds to stand in for the line on its own
MAX_WORKERS = 4


class ShortenError(RuntimeError):
    pass


# ---------- what the model returns (no defaults: Gemini's response_schema rejects them) ----------

class ShortSubstep(BaseModel):
    text: str
    detail: Optional[str]


class ShortUse(BaseModel):
    name: str
    amount: Optional[str]


class ShortStep(BaseModel):
    order: int
    substeps: list[ShortSubstep]
    uses: list[ShortUse]
    tip: Optional[str]


class ShortRecipe(BaseModel):
    steps: list[ShortStep]


# ---------- grounding: every number, heat level and bold amount must come from the recipe ----------

NUMBER_WORDS = {
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8",
    "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "fifteen": "15", "twenty": "20", "thirty": "30",
    "forty": "40", "fifty": "50", "sixty": "60", "ninety": "90", "hundred": "100", "half": "1/2",
    "quarter": "1/4", "dozen": "12", "single": "1", "once": "1", "twice": "2",
}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
ONES = {w: int(n) for w, n in NUMBER_WORDS.items() if w in ("one two three four five six seven eight nine").split()}
FRACTIONS = {"½": " 1/2", "¼": " 1/4", "¾": " 3/4", "⅓": " 1/3", "⅔": " 2/3"}
UNITS = {
    "tablespoon": "tbsp", "tablespoons": "tbsp", "tbsps": "tbsp", "teaspoon": "tsp", "teaspoons": "tsp",
    "tsps": "tsp", "cups": "cup", "pound": "lb", "pounds": "lb", "lbs": "lb", "ounce": "oz", "ounces": "oz",
    "gram": "g", "grams": "g", "minute": "min", "minutes": "min", "mins": "min", "hour": "hr", "hours": "hr",
    "hrs": "hr", "second": "sec", "seconds": "sec", "secs": "sec", "degrees": "deg", "degree": "deg",
    "cloves": "clove", "inches": "inch", "in": "inch",
}
STOPWORDS = set("a an the of to for about and or on in at until it its is each your per with than so".split())
HEAT = re.compile(r"\b(medium[- ]high|medium[- ]low|medium|low|high)\b")
HEAT_IN_TEXT = re.compile(r"\b(?:on|to|over|at)\s+(medium[- ]high|medium[- ]low|medium|low|high)\b"
                          r"|\b(medium[- ]high|medium[- ]low|medium|low|high)\s+(?:heat|flame)\b")
BOLD = re.compile(r"\*\*(.+?)\*\*")
# Measured without a number: a share of the ingredient. Anything else in words ("a pinch", "a splash")
# is the cook's loose amount, which stays in the lines.
SHARE_WORD = re.compile(r"\b(half|halves|quarter|third|rest|remaining|all|whole)\b", re.I)
TIME_WORD = re.compile(r"\b(seconds?|minutes?|hours?|mins?|hrs?|overnight|night|day)\b", re.I)
# "**a splash** of water": a bold span that is an amount of the words after it.
BOLD_OF = re.compile(r"\*\*([^*]+)\*\*(?=\s+of\s+((?:[A-Za-z'’-]+\s*){1,4}))")
PLACEHOLDER = re.compile(r"[\[\]]|\bTBD\b|\bTODO\b|\bask\b|\bunknown\b|\.\.\.|…", re.I)


def _normalize(text: str) -> str:
    t = text.lower().replace("**", "")
    for frac, plain in FRACTIONS.items():
        t = t.replace(frac, plain)
    t = re.sub(r"\b(?:a|an)\s+(second|minute|hour|day|night)\b", r"1 \1", t)
    t = re.sub(r"\b(" + "|".join(TENS) + r")[- ](" + "|".join(ONES) + r")\b",
               lambda m: str(TENS[m.group(1)] + ONES[m.group(2)]), t)
    return re.sub(r"\b(" + "|".join(NUMBER_WORDS) + r")\b", lambda m: NUMBER_WORDS[m.group(1)], t)


def numbers(text: str) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?(?:/\d+)?", _normalize(text)))


def _stem(word: str) -> str:
    if word in UNITS:
        return UNITS[word]
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            return word[: -len(suffix)]
    return word


def times(text: str) -> set[tuple[str, str]]:
    """(number, unit) for every time: "for about 3 hours" -> {("3", "hr")}; "30 to 60 minutes" -> {("60", "min")}."""
    tokens = [_stem(w) for w in re.findall(r"\d+(?:\.\d+)?(?:/\d+)?|[a-z]+", _normalize(text))]
    return {(a, b) for a, b in zip(tokens, tokens[1:]) if a[0].isdigit() and b in ("sec", "min", "hr")}


def words(text: str) -> set[str]:
    """Content words, light-stemmed, units unified ('two tablespoons' and '2 tbsp' share '2' and 'tbsp')."""
    return {_stem(w) for w in re.findall(r"[a-z]+", _normalize(text)) if w not in STOPWORDS} | numbers(text)


def heat_levels(text: str) -> set[str]:
    return {m.replace("-", " ") for m in HEAT.findall(text.lower())}


def step_text(recipe: dict, step: dict) -> str:
    """The step's own words and its special moments."""
    parts = [step.get(k) or "" for k in ("title", "instruction", "sensory_cue", "quote", "wait_after")]
    parts += [f"{sp['text']} {sp['why']}" for sp in recipe.get("special", []) if sp.get("step") == step["order"]]
    return "\n".join(parts)


def step_corpus(recipe: dict, step: dict) -> str:
    """Everything a step's lines may draw on: its own text and the ingredient list."""
    return "\n".join([step_text(recipe, step)] + [f"{i['name']} {i['feel']} {i['estimate']}" for i in recipe["ingredients"]])


def _ungrounded(label: str, text: str, corpus: str, own: str) -> list[str]:
    """Numbers must be in the corpus; times in the step's own words (an estimate's "2" is not "2 minutes")."""
    missing = sorted(numbers(text) - numbers(corpus)) + sorted(f"{n} {u}" for n, u in times(text) - times(own))
    return [f"{label}: {', '.join(missing)} is not in the recipe's text for this step"] if missing else []


# ---------- normalize & check ----------

def _sentence(s: str) -> str:
    return s[0].upper() + s[1:] + ("" if s[-1] in ".!?)\"”" else ".")


def _line_words(text: str) -> set[str]:
    """A line's content words; "Ready when" is only the frame of a cue line."""
    w = words(text)
    return w - {"ready", "when"} if text.lower().startswith("ready when") else w


def tidy_detail(detail: str | None, text: str) -> str | None:
    """A detail takes its line's place when the line is tapped, so it is the line's fuller version in whole
    sentences ("then rub salt over the belly," -> "Rub salt over the belly."). One that only adds to the line
    ("They should have curled up.") gets the line in front of it. Null when it adds fewer than DETAIL_NEW words
    the line doesn't say (the tap would only repeat it)."""
    d = re.sub(r"^(?:and then|and|then|so)\s+", "", " ".join((detail or "").split()), flags=re.I)
    d = re.sub(r"[\s,;:]+$", "", d)
    line = _line_words(text)
    new = {w for w in words(d) - line - {"ready", "when"} if len(w) > 2 or w[0].isdigit()}
    if not d or len(new) < DETAIL_NEW:
        return None
    d = _sentence(d)
    if line and len(line & words(d)) / len(line) < DETAIL_RESTATES:
        d = f"{_sentence(text.replace('**', '').strip())} {d}"
    return d


def _head(name: str) -> str:
    """An ingredient's head word, stemmed: "water (for the glaze)" -> "water", "green onions" -> "onion"."""
    bare = re.findall(r"[a-z]+", re.sub(r"\(.*?\)", "", name.lower()))
    return _stem(bare[-1]) if bare else ""


def unbold_measured(text: str, measured: set[str]) -> str:
    """"Add **a splash** of water." -> "Add a splash of water." when this step's Ingredients card already
    measures the water ("~2 tbsp"): one amount on the screen, never two to choose from. The cook's words
    stay; only the bold goes. Numbers, heat and times keep theirs."""
    def plain(m: re.Match) -> str:
        span, after = m.group(1), words(m.group(2))
        if numbers(span) or heat_levels(span) or TIME_WORD.search(span) or not after & measured:
            return m.group(0)
        return span
    return text if text.lower().startswith("ready when") else BOLD_OF.sub(plain, text)


def normalize(short: ShortRecipe, recipe: dict) -> ShortRecipe:
    """Whitespace, empty strings to null, details tidied (tidy_detail), and the prompt's amount rule made
    exact. A use's amount is a measurement or nothing: loose words ("a splash") become the ingredient's
    estimate when only this step uses it, and null when the ingredient is split across steps (the estimate
    is the whole recipe's: the oil that wipes the grill is not all ~1/2 cup); an estimate without its "~"
    gets it back (estimates always show "~"); a reused ingredient loses the estimate (the butter already in
    the pan is not another ~4 tbsp). Then a line's loose amount loses its bold where the card measures it."""
    estimates = {i["name"]: i["estimate"] for i in recipe["ingredients"]}
    steps_using = Counter(u.name for s in short.steps for u in {x.name: x for x in s.uses}.values())
    used: set[str] = set()
    for s in sorted(short.steps, key=lambda x: x.order):
        for use in s.uses:
            use.amount = " ".join((use.amount or "").split()) or None
            est = estimates.get(use.name)
            known = bool(est) and est != "unknown"
            if use.amount and not numbers(use.amount) and not SHARE_WORD.search(use.amount):
                use.amount = est if known and steps_using[use.name] == 1 else None  # "a splash" stays in the lines
            if use.amount and known and use.amount == est.lstrip("~").strip():
                use.amount = est
            if use.name in used and use.amount == est:
                use.amount = None
        used |= {u.name for u in s.uses if u.amount}  # the first step given an amount shows it
        measured = {_head(u.name) for u in s.uses if u.amount and numbers(u.amount)}
        for sub in s.substeps:
            sub.text = unbold_measured(" ".join(sub.text.split()), measured)
            sub.detail = tidy_detail(sub.detail, sub.text)
        s.tip = " ".join((s.tip or "").split()).strip('"“”') or None
    return short


def check(recipe: dict, short: ShortRecipe) -> list[str]:
    errors: list[str] = []
    orders = [s["order"] for s in recipe["steps"]]
    got = [s.order for s in short.steps]
    if sorted(got) != orders:
        return [f"steps must be exactly the recipe's orders {orders}, got {got}"]
    ingredients = {i["name"]: i for i in recipe["ingredients"]}
    by_order = {s["order"]: s for s in recipe["steps"]}

    for s in short.steps:
        step = by_order[s.order]
        corpus, own = step_corpus(recipe, step), step_text(recipe, step)
        corpus_words, corpus_heat = words(corpus), heat_levels(corpus)
        at = f"step {s.order}"
        if not MIN_SUBSTEPS <= len(s.substeps) <= MAX_SUBSTEPS:
            errors.append(f"{at}: {len(s.substeps)} substeps; give {MIN_SUBSTEPS} to {MAX_SUBSTEPS}")
        for n, sub in enumerate(s.substeps, 1):
            label, visible = f"{at} substep {n}", sub.text.replace("**", "")
            if not visible.strip():
                errors.append(f"{label}: empty text")
            if len(visible) > MAX_TEXT:
                errors.append(f"{label}: text is {len(visible)} characters; at most {MAX_TEXT}: {sub.text!r}")
            if sub.text.count("**") % 2 or "***" in sub.text:
                errors.append(f"{label}: unbalanced ** in {sub.text!r}")
            for field, value in (("text", sub.text), ("detail", sub.detail or "")):
                if PLACEHOLDER.search(value):
                    errors.append(f"{label}: placeholder in {field} {value!r}")
                errors += _ungrounded(f"{label} {field}", value, corpus, own)
            if "?" in sub.text:
                errors.append(f"{label}: a question in {sub.text!r}")
            heat = {h.replace("-", " ") for pair in HEAT_IN_TEXT.findall(visible.lower()) for h in pair if h}
            ready_line = visible.lower().startswith("ready when")
            for bold in BOLD.findall(sub.text):
                heat |= heat_levels(bold)
                extra = sorted(w for w in words(bold) - corpus_words if not w[0].isdigit())  # numbers: above
                if extra and not ready_line:  # "Ready when **...**" shortens the cue in other words
                    errors.append(f"{label}: bold **{bold}** has {', '.join(extra)}, which the recipe never says")
            for level in sorted(heat - corpus_heat):
                errors.append(f"{label}: heat {level!r} is not in the recipe's text for this step")

        seen: set[str] = set()
        for use in s.uses:
            label = f"{at} uses {use.name!r}"
            ing = ingredients.get(use.name)
            if ing is None:
                errors.append(f"{label}: not an ingredient name (copy one exactly from the ingredient list)")
                continue
            if use.name in seen:
                errors.append(f"{label}: listed twice")
            seen.add(use.name)
            if use.amount is None or use.amount == ing["estimate"]:
                continue
            if PLACEHOLDER.search(use.amount) or "?" in use.amount:
                errors.append(f"{label}: placeholder amount {use.amount!r}")
            extra = sorted(words(use.amount) - words(f"{corpus} {ing['feel']} {ing['estimate']}"))
            if extra:
                errors.append(f"{label}: amount {use.amount!r} is neither the estimate {ing['estimate']!r} nor "
                              f"said in this step ({', '.join(extra)} never appears)")

        if s.tip:
            if len(s.tip) > MAX_TIP:
                errors.append(f"{at} tip: {len(s.tip)} characters; at most {MAX_TIP}")
            if PLACEHOLDER.search(s.tip):
                errors.append(f"{at} tip: placeholder in {s.tip!r}")
            errors += _ungrounded(f"{at} tip", s.tip, corpus, own)
            tip_words = words(s.tip)
            shown = words(" ".join(f"{x.text} {x.detail or ''}" for x in s.substeps))
            if tip_words and len(tip_words & shown) / len(tip_words) >= TIP_REPEAT:
                errors.append(f"{at} tip: {s.tip!r} repeats the step's lines; give a different tip or null")
            # A short tip can repeat the done-cue without sharing most of its own words with the lines
            # ("Ready when the skin feels dry" + "Dry skin is the secret...").
            for x in s.substeps:
                cue = _line_words(x.text) if x.text.lower().startswith("ready when") else set()
                if cue and len(cue & tip_words) / len(cue) >= CUE_REPEAT:
                    errors.append(f"{at} tip: {s.tip!r} repeats the line {x.text!r}; drop one of them")

    tips = sum(1 for s in short.steps if s.tip)
    if tips > max(1, math.ceil(len(orders) / 3)):
        errors.append(f"{tips} of {len(orders)} steps have a tip; keep tips for the few steps where one really helps")
    return errors


def notes(recipe: dict, short: ShortRecipe) -> list[str]:
    """Worth a look, not errors: an ingredient no step uses, a done-cue that never became "Ready when"."""
    out = []
    used = {u.name for s in short.steps for u in s.uses}
    unused = [i["name"] for i in recipe["ingredients"] if i["name"] not in used]
    if unused:
        out.append(f"no step uses: {', '.join(unused)}")
    by_order = {s["order"]: s for s in recipe["steps"]}
    no_ready = [s.order for s in short.steps if by_order[s.order].get("sensory_cue")
                and not any(x.text.lower().startswith("ready when") for x in s.substeps)]
    if no_ready:
        out.append(f"sensory cue without a 'Ready when' line in step(s) {no_ready}")
    return out


# ---------- the model call ----------

class MemoryUsage(Usage):
    """process.Usage without a work/usage.json (bundled and synthetic recipes have no work folder)."""

    def __init__(self) -> None:  # noqa: D107 - deliberately skips Usage's file loading
        self.path, self.lock, self.calls, self.run_start = None, threading.Lock(), [], 0

    def save(self) -> None:
        pass


def prompt_view(recipe: dict) -> dict:
    """What the model needs, and nothing it could copy wrongly (no stories, no times, no feels)."""
    specials = recipe.get("special", [])
    return {
        "title": recipe["title"],
        "cook": recipe["cook"]["name"],
        "ingredients": [{"name": i["name"], "estimate": i["estimate"]} for i in recipe["ingredients"]],
        "steps": [{
            "order": s["order"], "title": s["title"], "instruction": s["instruction"],
            "sensory_cue": s.get("sensory_cue"), "quote": s.get("quote"), "wait_after": s.get("wait_after"),
            "special_moments": [{"text": sp["text"], "why": sp["why"]} for sp in specials if sp.get("step") == s["order"]],
        } for s in recipe["steps"]],
    }


def ask(gen: TextModel, recipe: dict, usage: Usage, tag: str) -> ShortRecipe:
    base = SHORTEN_PROMPT.format(recipe=json.dumps(prompt_view(recipe), indent=1, ensure_ascii=False))
    prompt, errors = base, ["no attempt made"]
    for attempt in (1, 2):
        resp, text, t0 = None, None, time.monotonic()
        try:
            resp = gen.generate(prompt, ShortRecipe, temperature=0.2)
            text = response_text(resp)
            short = normalize(ShortRecipe.model_validate_json(text), recipe)
            errors = check(recipe, short)
        except ValidationError as e:
            errors = format_validation_error(e)
        except Exception as e:  # noqa: BLE001 - API/network errors also get the one retry
            errors = [f"{type(e).__name__}: {e}"]
        call = usage.add("shorten", gen.model, None, attempt, time.monotonic() - t0, resp,
                         "; ".join(errors)[:2000] if errors else None)
        if not errors:
            log(f"[{tag}] attempt {attempt}: {describe_call(call)}")
            for line in notes(recipe, short):
                log(f"[{tag}] note: {line}")
            return short
        log(f"[{tag}] attempt {attempt} rejected ({describe_call(call)}):")
        for line in errors:
            log(f"    - {line}")
        prompt = base + SHORTEN_RETRY_SUFFIX.format(errors="\n".join(f"- {x}" for x in errors),
                                                    previous=text) if text else base
    raise ShortenError(f"{tag}: rejected twice; left unchanged:\n" + "\n".join(f"  - {x}" for x in errors))


def apply(recipe: dict, short: ShortRecipe) -> dict:
    out = copy.deepcopy(recipe)
    by_order = {s.order: s for s in short.steps}
    for step in out["steps"]:
        s = by_order[step["order"]]
        step["substeps"] = [{"text": x.text, "detail": x.detail} for x in s.substeps]
        step["uses"] = [{"name": u.name, "amount": u.amount} for u in s.uses]
        step["tip"] = s.tip
    Recipe.model_validate(out)  # never write a recipe the app's contract rejects
    return out


def from_recipe(recipe: dict) -> ShortRecipe | None:
    """A copy's existing substeps/uses/tip, when every step has them."""
    if not recipe["steps"] or not all(s.get("substeps") for s in recipe["steps"]):
        return None
    return ShortRecipe(steps=[ShortStep(order=s["order"], substeps=s["substeps"], uses=s.get("uses") or [],
                                        tip=s.get("tip")) for s in recipe["steps"]])


# ---------- files ----------

def signature(recipe: dict) -> str:
    """Two copies with the same signature can share one answer."""
    return json.dumps([[(s["order"], s["title"], s["instruction"], s.get("sensory_cue"), s.get("quote"))
                        for s in recipe["steps"]],
                       [(i["name"], i["estimate"]) for i in recipe["ingredients"]]])


_COMPACT_TAIL = re.compile(r'^( *)("story_ids": \[[^\]\n]*\], "special_ids": \[[^\]\n]*\])'
                           r'(?:,\n.*?\n *"tip": [^\n]*)?$', re.M | re.S)


def _compact_fields(indent: str, step: dict) -> str:
    q = lambda v: json.dumps(v, ensure_ascii=False)  # noqa: E731
    inner = indent + "  "

    def block(key: str, rows: list[str]) -> list[str]:
        if not rows:
            return [f'{indent}"{key}": [],']
        return [f'{indent}"{key}": [', *[f"{inner}{r}," for r in rows[:-1]], f"{inner}{rows[-1]}", f"{indent}],"]

    lines = block("substeps", [f'{{ "text": {q(x["text"])}, "detail": {q(x["detail"])} }}' for x in step["substeps"]])
    lines += block("uses", [f'{{ "name": {q(u["name"])}, "amount": {q(u["amount"])} }}' for u in step["uses"]])
    lines.append(f'{indent}"tip": {q(step["tip"])}')
    return "\n".join(lines)


def render(path: Path, old_text: str, data: dict) -> str:
    """Synthetic recipes are hand-formatted: add the fields after each step's ids line and keep the rest as is.
    Everything else is pipeline output (2-space JSON, as process.py writes it): only the new fields change."""
    if path.parent != SYNTHETIC:
        return json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if len(_COMPACT_TAIL.findall(old_text)) != len(data["steps"]):
        raise ShortenError(f"{path}: expected one story_ids/special_ids line per step (hand formatting changed?)")
    steps = iter(data["steps"])
    new = _COMPACT_TAIL.sub(lambda m: f"{m.group(1)}{m.group(2)},\n{_compact_fields(m.group(1), next(steps))}",
                            old_text)
    if json.loads(new) != data:
        raise ShortenError(f"{path}: could not keep its hand formatting (step layout changed?)")
    return new


def rel(path: Path) -> str:
    """Repo-relative for logs (process.py's tests write recipes to a temp folder outside the repo)."""
    return str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)


def copies(recipe_id: str) -> list[Path]:
    return [p for p in (OUT / recipe_id / "recipe.json", BUNDLED / f"{recipe_id}.json", SYNTHETIC / f"{recipe_id}.json")
            if p.exists()]


def all_ids() -> list[str]:
    return sorted({p.stem for p in BUNDLED.glob("*.json")} | {p.stem for p in SYNTHETIC.glob("*.json")})


def make_model() -> TextModel:
    cfg = load_config()  # loads .env, fails without GEMINI_API_KEY
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                          http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS, retry_options=HTTP_RETRY))
    return text_model(cfg, client, cfg["merge_model"], "medium")


def shorten_paths(paths: list[Path], gen: TextModel | None, usage: Usage, force: bool = False,
                  dry_run: bool = False, tag: str = "shorten") -> list[tuple[Path, dict, dict]]:
    """Shorten copies of one recipe. One call per distinct step list; returns [(path, before, after)] written
    (or, with dry_run, that would be written)."""
    loaded = [(p, p.read_text()) for p in paths]
    recipes = [(p, text, json.loads(text)) for p, text in loaded]
    answers: dict[str, ShortRecipe] = {}
    if not force:  # reuse a copy's existing substeps for every copy with the same steps
        for _, _, r in recipes:
            have = from_recipe(r)
            if have is not None:
                answers.setdefault(signature(r), have)
    results = []
    for p, text, r in recipes:
        sig = signature(r)
        if not force and from_recipe(r) is not None:
            log(f"[{tag}] {rel(p)}: already has substeps (--force redoes them)")
            continue
        if sig not in answers:
            if gen is None:
                raise ShortenError(f"{tag}: no model to ask")
            answers[sig] = ask(gen, r, usage, tag)
        after = apply(r, answers[sig])
        if not dry_run:
            p.write_text(render(p, text, after))
        results.append((p, r, after))
        log(f"[{tag}] {'would write' if dry_run else 'wrote'} {rel(p)}: {len(after['steps'])} steps")
    return results


def shorten_file(path: Path, gen: TextModel, usage: Usage) -> int:
    """process.py, right after the merge: shorten one new recipe.json in place. Returns the steps written."""
    done = shorten_paths([path], gen, usage, force=True, tag=f"shorten {path.parent.name}")
    return sum(len(after["steps"]) for _, _, after in done)


def show(after: dict) -> None:
    for s in after["steps"]:
        log(f"  {s['order']:>2}. {s['title']}")
        for x in s["substeps"]:
            log(f"        - {x['text']}" + (f"   [detail: {x['detail']}]" if x["detail"] else ""))
        log("        uses: " + ("; ".join(f"{u['amount'] or ''} {u['name']}".strip() for u in s["uses"]) or "nothing"))
        if s["tip"]:
            log(f"        tip: {s['tip']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Write short substeps, step ingredients and tips into recipes.")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--id", help="one recipe: every copy in data/out, app/assets/data/recipes, data/synthetic")
    group.add_argument("--all", action="store_true", help="every bundled and synthetic recipe")
    ap.add_argument("--dry-run", action="store_true", help="call the model and print the result; write nothing")
    ap.add_argument("--force", action="store_true", help="redo recipes that already have substeps")
    args = ap.parse_args()

    ids = all_ids() if args.all else [args.id]
    if not args.all and not copies(args.id):
        sys.exit(f"shorten: error: no recipe named {args.id!r} in data/out, app/assets/data/recipes or data/synthetic")
    try:
        gen = make_model()
    except ProcessError as e:
        sys.exit(f"shorten: error: {e}")
    usage = MemoryUsage()
    log(f"[shorten] {len(ids)} recipe(s) with {gen.model}{' (dry run: nothing is written)' if args.dry_run else ''}")

    def one(recipe_id: str):
        return shorten_paths(copies(recipe_id), gen, usage, args.force, args.dry_run, f"shorten {recipe_id}")

    failed, written = [], []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for recipe_id, fut in [(i, pool.submit(one, i)) for i in ids]:
            try:
                written += fut.result()
            except (ShortenError, ValidationError, ValueError) as e:
                failed.append(recipe_id)
                log(f"[shorten {recipe_id}] FAILED: {e}")
    if args.dry_run:
        for p, _, after in written:
            log(f"\n{rel(p)}")
            show(after)
    steps = sum(len(after["steps"]) for _, _, after in written)
    cost = sum(c["cost_usd"] for c in usage.calls)
    log(f"\n[shorten] {'would write' if args.dry_run else 'wrote'} {len(written)} file(s), {steps} steps; "
        f"{len(usage.calls)} model call(s), ~${cost:.4f}" + (f"; FAILED: {', '.join(failed)}" if failed else ""))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
