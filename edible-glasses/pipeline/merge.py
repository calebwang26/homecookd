"""Merge per-chunk Gemini results into one recipe with session-time steps.

Each chunk owns the steps that START in its core range [k*L, (k+1)*L); the
30 s overlap only exists so a step cut by a boundary is seen whole somewhere.
A step cut short at a chunk's end gets its end time from the next chunk.

    python merge.py sessions/<session_id>
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema import ChunkRecipe, Recipe, RecipeIngredient, RecipeStep  # noqa: E402

CHUNK_SECONDS = 900
BOUNDARY_SLACK = 3.0     # a step ending this close to a chunk end counts as cut off
MATCH_WINDOW = 20.0      # same step seen in two chunks if starts are this close


def parse_mmss(s: str) -> float:
    s = (s or "").strip()
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,3}):(\d{2})(?:\.\d+)?", s)
    if not m:
        return 0.0
    h, mm, ss = m.groups()
    return (int(h) * 3600 if h else 0) + int(mm) * 60 + int(ss)


def mmss(seconds: float) -> str:
    s = max(0, int(round(seconds)))
    return f"{s // 60:02d}:{s % 60:02d}"


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()


def _in_gap(start: float, end: float, gaps: list[dict]) -> bool:
    return any(g["start_s"] <= start and end <= g["end_s"] for g in gaps)


def merge(session_dir: Path) -> Recipe:
    session = json.loads((session_dir / "session.json").read_text())
    chunk_seconds = session.get("chunk_seconds", CHUNK_SECONDS)
    gaps = session.get("gaps", [])
    chunks_dir = session_dir / "chunks"

    per_chunk: list[tuple[int, float, float, ChunkRecipe]] = []
    for c in session["chunks"]:
        k = c["chunk_index"]
        path = chunks_dir / f"chunk_{k:02d}.recipe.json"
        if not path.exists():
            print(f"warning: chunk {k} has no Gemini result yet ({path.name}); skipping it")
            continue
        per_chunk.append((k, c["start_s"], c["end_s"], ChunkRecipe.model_validate_json(path.read_text())))

    steps: list[RecipeStep] = []
    notes: list[str] = []
    dish_votes: dict[str, int] = {}
    seen_by_chunk: dict[int, list[tuple[float, float]]] = {}

    for k, c_start, c_end, result in per_chunk:
        if result.dish_guess:
            dish_votes[result.dish_guess] = dish_votes.get(result.dish_guess, 0) + 1
        if result.notes:
            notes.append(f"[{mmss(c_start)}-{mmss(c_end)}] {result.notes}")
        core_start, core_end = k * chunk_seconds, (k + 1) * chunk_seconds
        seen_by_chunk[k] = []
        for st in result.steps:
            s0 = c_start + parse_mmss(st.start)
            s1 = max(s0, c_start + parse_mmss(st.end))
            s1 = min(s1, c_end)
            seen_by_chunk[k].append((s0, s1))
            if not (core_start <= s0 < core_end) and k > 0:
                continue  # belongs to the previous chunk (overlap region)
            if _in_gap(s0, s1, gaps):
                continue
            ingredients = [i.model_copy(update={"at": mmss(c_start + parse_mmss(i.at))}) for i in st.ingredients]
            steps.append(RecipeStep(
                index=0, start_s=round(s0, 1), end_s=round(s1, 1), start=mmss(s0),
                title=st.title, instruction=st.instruction, ingredients=ingredients,
                doneness_cue=st.doneness_cue, quote_original=st.quote_original,
                quote_english=st.quote_english, story=st.story,
                confidence=st.confidence, source_chunk=k,
            ))

    # Extend steps cut off at a chunk boundary using the next chunk's view.
    chunk_end = {k: e for k, _, e, _ in per_chunk}
    for step in steps:
        k = step.source_chunk
        if k + 1 in seen_by_chunk and step.end_s >= chunk_end[k] - BOUNDARY_SLACK:
            for s0, s1 in seen_by_chunk[k + 1]:
                if abs(s0 - step.start_s) <= MATCH_WINDOW or s0 <= step.end_s <= s1:
                    step.end_s = round(max(step.end_s, s1), 1)
                    break

    steps.sort(key=lambda s: s.start_s)
    for i, s in enumerate(steps, 1):
        s.index = i

    ingredients: dict[str, RecipeIngredient] = {}
    for s in steps:
        for ing in s.ingredients:
            key = _norm(ing.name)
            if key and key not in ingredients:
                ingredients[key] = RecipeIngredient(name=ing.name, said_as=ing.said_as,
                                                    estimated_amount=ing.estimated_amount,
                                                    first_used_s=parse_mmss(ing.at))

    title = session.get("dish_name") or (max(dish_votes, key=dish_votes.get) if dish_votes else "Family recipe")
    cook = session.get("cook_name", "")
    recipe = Recipe(
        session_id=session["session_id"],
        title=f"{cook}'s {title}" if cook and title and not title.lower().startswith(cook.lower()) else title,
        cook_name=cook, relationship=session.get("relationship", ""),
        spoken_languages=session.get("spoken_languages", []),
        duration_s=session.get("duration_s", 0), ingredients=list(ingredients.values()), steps=steps,
        notes=notes, consent_recorded_at=session.get("consent_recorded_at", "00:00"),
        license_opt_in=session.get("license_opt_in", False),
    )
    (session_dir / "recipe.json").write_text(recipe.model_dump_json(indent=2))
    return recipe


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session_dir", type=Path)
    r = merge(ap.parse_args().session_dir)
    print(f"recipe.json: {r.title} - {len(r.steps)} steps, {len(r.ingredients)} ingredients")


if __name__ == "__main__":
    main()
