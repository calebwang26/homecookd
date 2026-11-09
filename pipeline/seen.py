"""Ingredients the cook adds without saying them, found in the video's frames.

The Claude extraction leans on what she says, and speech-to-text can miss a word (Poha, Oct 26: Cartesia never
heard "कढीपत्ता", so curry leaves left the recipe although they crackle on screen). After the merge, check() shows
Claude (CLAUDE_SEEN_MODEL, default Sonnet) FRAMES_PER_STEP frames from every step of play.mp4 beside the recipe's
ingredient list, and asks what goes into the food that isn't listed:
- sure (seen clearly in at least two frames of one step, and not a listed ingredient under another name): added to
  the ingredients with no amount she said ("feel" stays empty), and named in that step's instruction;
- unsure: a follow-up question for the cook about that step ("did you add …?"), never a change to the recipe.
It never removes or rewrites what she said; at most MAX_ADD additions and MAX_ASK questions. Runs with
EXTRACTOR=claude (Gemini watching the video sees them itself); INGREDIENT_CHECK=off turns it off.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pydantic import BaseModel

from pipeline import claude
from pipeline.prep import ffmpeg
from pipeline.prompts import SEEN_PROMPT
from pipeline.schema import Ingredient, Recipe, RecipeQuestion

# Haiku found 8 of 18 ingredients taken out of the steak, Biryani and gnocchi lists (Nov 8), Sonnet 16, so it stays.
SEEN_MODEL = "claude-sonnet-5-5"
# Poha (Oct 26): 4 frames a step found its curry leaves in 4 runs of 4; 8 found nothing in 2 of 2. 384 px since
# Nov 8 (was 512): a third cheaper ($0.015 on the steak, was $0.023), and it found 17 of the 18 (512 px: 16).
# CLAUDE_SEEN_FRAME_PX=512 rolls it back.
FRAMES_PER_STEP, MAX_FRAMES, FRAME_PX = 4, 96, 384
MAX_ADD, MAX_ASK = 3, 2
SAME_NAME = 0.8  # names this alike (difflib, lowercased) are the same ingredient


class SeenItem(BaseModel):
    name: str
    step: int
    frames: list[str]  # the frame labels it shows in ("4.2")
    sure: bool
    estimate: str  # "~1 sprig" from what she uses, or "unknown"
    why: str


class SeenAnswer(BaseModel):
    items: list[SeenItem]


def enabled(cfg: dict) -> bool:
    return cfg.get("extractor") == "claude" and (os.environ.get("INGREDIENT_CHECK") or "on").strip().lower() != "off"


# ---------- rules (pure, tested in test_seen.py) ----------

def _words(name: str) -> str:
    """A name for comparing: lowercase, no brackets, no plural ("Green chillies (hari mirch)" -> "green chilli")."""
    name = re.sub(r"\(.*?\)", "", name.lower())
    return " ".join(_one(w) for w in re.findall(r"[a-z]+", name))


def _one(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-2]  # chillies -> chilli
    return word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word


def listed(name: str, ingredients: list[str]) -> bool:
    """Whether `name` is already in the recipe, under its own name or as one word of a listed one ("chilli" in
    "green chillies")."""
    mine = _words(name)
    for other in map(_words, ingredients):
        if not mine or not other:
            continue
        if mine == other or difflib.SequenceMatcher(None, mine, other).ratio() >= SAME_NAME:
            return True
        if set(mine.split()) <= set(other.split()) or set(other.split()) <= set(mine.split()):
            return True
    return False


def frame_times(start: float, end: float, n: int = FRAMES_PER_STEP) -> list[float]:
    """n seconds spread across a step, none on its edges."""
    return [round(start + (k + 0.5) * (end - start) / n, 2) for k in range(n)]


def decide(answer: SeenAnswer, recipe: Recipe) -> tuple[list[SeenItem], list[SeenItem]]:
    """(to add, to ask about). Sure means at least two of that step's frames; anything listed, on an unknown step or
    seen only once goes to asking, or is dropped when it is already listed. Capped at MAX_ADD and MAX_ASK."""
    steps = {s.order for s in recipe.steps}
    names = [i.name for i in recipe.ingredients]
    add, ask = [], []
    for item in answer.items:
        if item.step not in steps or listed(item.name, names + [x.name for x in add + ask]):
            continue
        own = {f for f in item.frames if f.split(".")[0] == str(item.step)}
        (add if item.sure and len(own) >= 2 else ask).append(item)
    return add[:MAX_ADD], ask[:MAX_ASK]


def apply(recipe: Recipe, add: list[SeenItem], ask: list[SeenItem]) -> Recipe:
    """The recipe with `add` in its ingredients and steps, and a question to the cook for each of `ask`."""
    r = recipe.model_copy(deep=True)
    by_order = {s.order: s for s in r.steps}
    for item in add:
        step = by_order[item.step]
        estimate = item.estimate if item.estimate.startswith("~") else "unknown"
        r.ingredients.append(Ingredient(name=item.name, feel="", estimate=estimate, confidence="medium",
                                        first_seen_s=step.start_s))
        step.instruction = f"{step.instruction.rstrip()} Add the {item.name} too."
    for item in ask:
        # The id comes from the name, so a re-publish keeps it and Convex never asks her twice.
        r.follow_up_questions.append(RecipeQuestion(
            id="seen-" + re.sub(r"[^a-z0-9]+", "-", item.name.lower()).strip("-"), about_step=item.step,
            question=f"Step {item.step}: we saw {item.name} but didn't hear it named. Does that go in, and how much?",
            ingredient=item.name))
    return Recipe.model_validate(r.model_dump())  # never hand on a recipe the contract rejects


# ---------- frames and the call ----------

def grab(play: Path, recipe: Recipe) -> list[tuple[str, bytes]]:
    """("Step N: title. instruction" or "N.k", JPEG) in step order: the step's header goes on its first frame."""
    per = max(1, min(FRAMES_PER_STEP, MAX_FRAMES // max(1, len(recipe.steps))))
    jobs = [(s, k, t) for s in recipe.steps for k, t in enumerate(frame_times(s.start_s, s.end_s, per), 1)]
    px = int(os.environ.get("CLAUDE_SEEN_FRAME_PX") or FRAME_PX)
    with tempfile.TemporaryDirectory() as tmp:
        def one(job):
            s, k, t = job
            out = Path(tmp) / f"{s.order:03d}_{k}.jpg"
            ffmpeg("-ss", f"{t:.2f}", "-i", str(play), "-frames:v", "1", "-vf",
                   f"scale='min({px},iw)':'min({px},ih)':force_original_aspect_ratio=decrease",
                   "-q:v", "5", "-update", "1", str(out))
            head = f"Step {s.order}: {s.title}. {s.instruction}\n" if k == 1 else ""
            return f"{head}Frame {s.order}.{k}", out.read_bytes()

        with ThreadPoolExecutor(max_workers=6) as pool:
            return list(pool.map(one, jobs))


def check(recipe: Recipe, play: Path, work: Path, usage, log, gen: claude.ClaudeText | None = None) -> Recipe:
    """The recipe with the ingredients the frames show and nobody said, or as it was. Raises on errors (the caller
    keeps the recipe); work/seen.json keeps what Claude saw and what was done with it."""
    gen = gen or claude.ClaudeText(os.environ.get("CLAUDE_SEEN_MODEL") or SEEN_MODEL)
    images = grab(play, recipe)
    t0, resp = time.monotonic(), None
    try:
        names = "\n".join(f"- {i.name}" for i in recipe.ingredients) or "(none)"
        resp = gen.generate(SEEN_PROMPT.format(title=json.dumps(recipe.title), ingredients=names), SeenAnswer,
                            images=images)
        answer = SeenAnswer.model_validate_json(resp.text)
    except Exception as e:
        usage.add("seen", gen.model, None, 1, time.monotonic() - t0, resp, f"{type(e).__name__}: {e}"[:2000])
        raise
    usage.add("seen", gen.model, None, 1, time.monotonic() - t0, resp)
    add, ask = decide(answer, recipe)
    (work / "seen.json").write_text(json.dumps({
        "frames": len(images), "seen": [i.model_dump() for i in answer.items],
        "added": [i.name for i in add], "asked": [i.name for i in ask]}, indent=1, ensure_ascii=False) + "\n")
    log(f"[seen] {len(images)} frames: added {[i.name for i in add] or 'nothing'}, "
        f"asked about {[i.name for i in ask] or 'nothing'} (Claude saw {len(answer.items)} unlisted)")
    return apply(recipe, add, ask) if add or ask else recipe
