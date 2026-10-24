"""Data contract for homecookd. Source of truth; app/lib/types.ts mirrors it.

All times are whole seconds from the start of the recipe's play.mp4.

The LLM-facing models (ChunkOutput, RecipeDraft) have no default values because
the Gemini response_schema rejects defaults. Recipe is the full file the app reads.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ValidationError, field_validator, model_validator

Confidence = Literal["low", "medium", "high"]


def _no_original_ok(data):
    """quote_original (the cook's Marathi words) has no default, because Gemini's response_schema rejects
    defaults; files and cached chunks written before it existed simply leave it out."""
    if isinstance(data, dict):
        data.setdefault("quote_original", None)
    return data


def _check_estimate(v: str) -> str:
    if not (v.startswith("~") or v == "unknown"):
        raise ValueError(f'estimate must start with "~" or be "unknown", got {v!r}')
    return v


# ---------- Chunk output (one per recording file, returned by Gemini) ----------

class ChunkIngredient(BaseModel):
    name: str
    feel: str  # the cook's exact words for the amount
    estimate: str  # "~1.5 cups" or "unknown"

    _estimate = field_validator("estimate")(_check_estimate)


class ChunkEvent(BaseModel):
    type: Literal["step", "story", "special"]
    start_s: int
    end_s: int
    action: Optional[str]  # step
    ingredients: Optional[list[ChunkIngredient]]  # step
    sensory_cue: Optional[str]  # step
    quote: Optional[str]  # step, in English
    quote_original: Optional[str]  # step, the cook's words as spoken when not English (Devanagari)
    text: Optional[str]  # story / special
    why: Optional[str]  # special

    _original = model_validator(mode="before")(_no_original_ok)

    @model_validator(mode="after")
    def _times(self) -> "ChunkEvent":
        # Equal start/end is allowed here (a momentary event); the recipe merge must widen it.
        if self.start_s < 0 or self.end_s < self.start_s:
            raise ValueError(f"bad chunk times {self.start_s}-{self.end_s}")
        if self.type == "step" and not self.action:
            raise ValueError("step event without action")
        if self.type in ("story", "special") and not self.text:
            raise ValueError(f"{self.type} event without text")
        return self


class ChunkOutput(BaseModel):
    chunk_index: int
    events: list[ChunkEvent]


def parse_timestamp(ts: str) -> int:
    """'M:SS', 'MM:SS' or 'H:MM:SS' -> whole seconds. Rejects impossible values like '1:75'."""
    parts = ts.strip().split(":")
    if not 2 <= len(parts) <= 3 or not all(p.isdigit() for p in parts):
        raise ValueError(f"timestamp must look like MM:SS, got {ts!r}")
    nums = [int(p) for p in parts]
    if any(n >= 60 for n in nums[1:]):
        raise ValueError(f"minutes/seconds must be under 60 in {ts!r}")
    return nums[-3] * 3600 + nums[-2] * 60 + nums[-1] if len(nums) == 3 else nums[0] * 60 + nums[1]


class TimedIngredient(BaseModel):
    """Gemini-facing ingredient. The "~" is added in to_seconds() when missing: an estimate is
    approximate by definition, and rejecting the whole 15-minute file for it costs a paid retry."""
    name: str
    feel: str
    estimate: str


class TimedChunkEvent(BaseModel):
    """What Gemini returns: MM:SS strings. Asking for plain seconds on 15-minute clips made
    gemini-3.1-pro-preview write 5:08 as 508, which is valid-looking but wrong."""
    type: Literal["step", "story", "special"]
    start: str  # MM:SS from the start of the clip
    end: str
    action: Optional[str]
    ingredients: Optional[list[TimedIngredient]]
    sensory_cue: Optional[str]
    quote: Optional[str]
    quote_original: Optional[str]
    text: Optional[str]
    why: Optional[str]

    _original = model_validator(mode="before")(_no_original_ok)


class TimedChunkOutput(BaseModel):
    chunk_index: int
    events: list[TimedChunkEvent]

    def to_seconds(self) -> ChunkOutput:
        events = []
        for ev in self.events:
            d = ev.model_dump(exclude={"start", "end"})
            for ing in d.get("ingredients") or []:
                est = ing["estimate"].strip()
                if est.lower() == "unknown" or not est:
                    ing["estimate"] = "unknown"
                elif not est.startswith("~"):
                    ing["estimate"] = "~" + est
            events.append(ChunkEvent(**d, start_s=parse_timestamp(ev.start), end_s=parse_timestamp(ev.end)))
        return ChunkOutput(chunk_index=self.chunk_index, events=events)


# ---------- Recipe (what the app reads) ----------

class Cook(BaseModel):
    name: str
    relation: str


class Media(BaseModel):
    video_url: Optional[str] = None
    audio_url: Optional[str] = None
    poster_url: Optional[str] = None
    duration_s: int
    width: Optional[int] = None  # play.mp4 frame size, so the player box matches the video
    height: Optional[int] = None


class Session(BaseModel):
    index: int
    recorded_at: Optional[str] = None
    offset_s: int
    duration_s: int


class Ingredient(BaseModel):
    name: str
    feel: str
    estimate: str
    confidence: Confidence
    first_seen_s: Optional[int]

    _estimate = field_validator("estimate")(_check_estimate)


class DraftStep(BaseModel):
    order: int
    title: str
    instruction: str
    sensory_cue: Optional[str]
    start_s: int
    end_s: int
    quote: Optional[str]  # in English
    quote_original: Optional[str]  # the cook's words as spoken when not English (Devanagari), else None
    wait_after: Optional[str]

    _original = model_validator(mode="before")(_no_original_ok)


class Substep(BaseModel):
    text: str  # one short line; **bold** marks amounts, heat & times
    detail: Optional[str] = None  # the longer version, shown on tap
    # Absolute whole seconds on play.mp4/voice.m4a (the step's clock) where this substep begins, added by
    # align.py. None/absent on recipes without media. Within a step: all or none, the first = step.start_s,
    # strictly increasing, every one inside [step.start_s, step.end_s).
    start_s: Optional[int] = None


class StepIngredient(BaseModel):
    name: str  # matches an Ingredient name
    amount: Optional[str] = None


class Step(DraftStep):
    story_ids: list[str] = []
    special_ids: list[str] = []
    image_url: Optional[str] = None  # a still from this step's video, added by publish.py
    # Cook mode's short version, added by shorten.py (old recipes don't have them).
    substeps: Optional[list[Substep]] = None
    uses: Optional[list[StepIngredient]] = None
    tip: Optional[str] = None


class Story(BaseModel):
    id: str
    step: int
    start_s: int
    end_s: int
    title: str
    text: str


class Special(BaseModel):
    id: str
    step: int
    start_s: int
    end_s: Optional[int]
    text: str
    why: str


class FollowUpQuestion(BaseModel):
    id: str
    about_step: Optional[int]
    question: str


class RecipeDraft(BaseModel):
    """What the merge call returns. process.py adds id, cook, media, sessions, source,
    sample and each step's story_ids/special_ids (derived from story.step / special.step)."""
    title: str
    intro: str
    servings: Optional[str]
    total_time: Optional[str]
    tags: list[str]
    ingredients: list[Ingredient]
    steps: list[DraftStep]
    stories: list[Story]
    special: list[Special]
    follow_up_questions: list[FollowUpQuestion]


class Recipe(BaseModel):
    id: str
    title: str
    cook: Cook
    language: Optional[str] = None  # what the cook spoke (ISO 639-1, from the Convex job); None = not recorded
    intro: str
    servings: Optional[str] = None
    total_time: Optional[str] = None
    sample: bool = False
    # A family's own recipe (worker.py, Convex mode), set by publish.without_memories: Convex keeps her stories
    # and tips, and it never goes into the shared library.json or the app's bundle (publish.rebuild_library).
    family: bool = False
    source: Optional[str] = None  # credit for a YouTube creator
    tags: list[str] = []
    media: Media
    sessions: list[Session] = []
    ingredients: list[Ingredient]
    steps: list[Step]
    stories: list[Story] = []
    special: list[Special] = []
    follow_up_questions: list[FollowUpQuestion] = []

    @model_validator(mode="after")
    def _check(self) -> "Recipe":
        errors: list[str] = []
        dur = self.media.duration_s

        def span(label: str, start: int, end: Optional[int]) -> None:
            if end is None:
                if not 0 <= start < dur:
                    errors.append(f"{label}: start_s {start} outside 0..{dur}")
            elif not 0 <= start < end <= dur:
                errors.append(f"{label}: times {start}-{end} violate 0 <= start < end <= {dur}")

        orders = [s.order for s in self.steps]
        if orders != list(range(1, len(self.steps) + 1)):
            errors.append(f"step order must be 1..{len(self.steps)}, got {orders}")
        starts = [s.start_s for s in self.steps]
        if starts != sorted(starts):
            errors.append(f"steps not ordered by start_s: {starts}")
        for s in self.steps:
            span(f"step {s.order}", s.start_s, s.end_s)
        for st in self.stories:
            span(f"story {st.id}", st.start_s, st.end_s)
        for sp in self.special:
            span(f"special {sp.id}", sp.start_s, sp.end_s)
        for ing in self.ingredients:
            if ing.first_seen_s is not None and not 0 <= ing.first_seen_s <= dur:
                errors.append(f"ingredient {ing.name}: first_seen_s {ing.first_seen_s} outside 0..{dur}")

        valid_steps = set(orders)
        story_ids = {st.id for st in self.stories}
        special_ids = {sp.id for sp in self.special}
        for label, ids in (("story", [st.id for st in self.stories]), ("special", [sp.id for sp in self.special])):
            if len(ids) != len(set(ids)):
                errors.append(f"duplicate {label} ids: {ids}")
        for st in self.stories:
            if st.step not in valid_steps:
                errors.append(f"story {st.id}: step {st.step} does not exist")
        for sp in self.special:
            if sp.step not in valid_steps:
                errors.append(f"special {sp.id}: step {sp.step} does not exist")
        for s in self.steps:
            for sid in s.story_ids:
                if sid not in story_ids:
                    errors.append(f"step {s.order}: story_ids has unknown {sid!r}")
                elif next(st for st in self.stories if st.id == sid).step != s.order:
                    errors.append(f"step {s.order}: story {sid!r} belongs to another step")
            for xid in s.special_ids:
                if xid not in special_ids:
                    errors.append(f"step {s.order}: special_ids has unknown {xid!r}")
                elif next(sp for sp in self.special if sp.id == xid).step != s.order:
                    errors.append(f"step {s.order}: special {xid!r} belongs to another step")
        for st in self.stories:
            if st.id not in next((s.story_ids for s in self.steps if s.order == st.step), []):
                errors.append(f"story {st.id}: not listed in step {st.step}'s story_ids")
        for sp in self.special:
            if sp.id not in next((s.special_ids for s in self.steps if s.order == sp.step), []):
                errors.append(f"special {sp.id}: not listed in step {sp.step}'s special_ids")
        for s in self.steps:
            timed = [x.start_s for x in s.substeps or []]
            if not any(t is not None for t in timed):
                continue
            label = f"step {s.order} substeps start_s {timed}"
            if any(t is None for t in timed):
                errors.append(f"{label}: some substeps have start_s and some do not")
            elif timed[0] != s.start_s:
                errors.append(f"{label}: the first must equal the step's start_s {s.start_s}")
            elif any(b <= a for a, b in zip(timed, timed[1:])):
                errors.append(f"{label}: must be strictly increasing")
            elif not all(s.start_s <= t < s.end_s for t in timed):
                errors.append(f"{label}: outside the step's {s.start_s}-{s.end_s}")
        for q in self.follow_up_questions:
            if q.about_step is not None and q.about_step not in valid_steps:
                errors.append(f"question {q.id}: about_step {q.about_step} does not exist")
        if not self.sample and not (self.media.video_url and self.media.audio_url):
            # Real recipes need media once published; unpublished local output may still be relative paths.
            errors.append("real recipe is missing media.video_url or media.audio_url")

        if errors:
            raise ValueError("; ".join(errors))
        return self


class LibraryEntry(BaseModel):
    id: str
    title: str
    cook_name: str
    relation: str
    poster_url: Optional[str]
    tags: list[str]
    sample: bool
    recipe_url: str


def validate_file(path: Path) -> Recipe:
    return Recipe.model_validate_json(path.read_text())


if __name__ == "__main__":
    # python pipeline/schema.py data/sample-recipe.json data/synthetic/*.json data/out/*/recipe.json
    failed = False
    for arg in sys.argv[1:]:
        try:
            r = validate_file(Path(arg))
            print(f"OK   {arg}  ({len(r.steps)} steps, {len(r.stories)} stories, {len(r.special)} specials)")
        except (ValidationError, ValueError, json.JSONDecodeError) as e:
            failed = True
            print(f"FAIL {arg}\n{e}")
    sys.exit(1 if failed else 0)
