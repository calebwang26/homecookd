"""Put camera-roll clips in cooking order (docs/build/FEEDBACK-OCT16.md, section B).

Never a recording filmed in the app (manifest "keep_order", from prep.run): its files come in the order she filmed
them (5-minute rolls, a Pause, a flip), so a stove-then-chopping recording stays that way.

prep.py orders clips by file date. Phone dates can be missing, identical or wrong, so after extraction
process.py calls order_sessions(), which decides the cooking order from what happens in each clip:

- a keyword scorer (deterministic): each step's action is a phase, 0 setup/prep (preheat, wash, chop,
  measure, marinate), 0.5 mixing, 1 cooking/assembling (fry, boil, simmer, bake), 2 plating/serving;
  a clip's score is the mean over its steps;
- a cheap text-only model call (an injected `ask`): order + confidence + reason.

decide() is conservative. It keeps the file-date order unless the content order clearly differs AND
one of: the model is "high" and (the file dates are unreliable, or the keywords clearly give the same
order); the dates are unreliable, the model is "medium" and the keywords agree; or there is no model
answer, the dates are unreliable and the keywords alone are clear. A keyword clash with the model, or a
model order that moves a clip the keywords cannot place (no steps), always keeps the file-date order.

On a reorder: play.mp4 & voice.m4a are rebuilt from work/play_NN.mp4 in the new order (prep.concat,
same encoders), sessions get new offsets, every event shifts by its session's new offset, the manifest
records the original vs chosen order and why, and a placeholder poster is redrawn. An existing
recipe.json no longer matches play.mp4, so it moves to work/recipe.stale.json. The swap is guarded by
work/swap.pending.json and hard links to the pre-swap media (play.prev.mp4, voice.prev.m4a);
restore_interrupted() undoes a swap that did not commit. work/chunk_NN.* keep their recorded-order
numbers (chunk_jobs()).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from pipeline import prep
from pipeline.prompts import ORDER_PROMPT

MARGIN = 0.6  # keyword scores this far apart count as a clear phase difference
MAX_STEPS_PER_CLIP = 30  # caps the order prompt for long clips
TEXT_CHARS = 140

Log = Callable[[str], None]


def _log(msg: str) -> None:
    print(msg, flush=True)


# ---------- numbering ----------

def recorded_index(session: dict) -> int:
    return session.get("recorded_index", session["index"])


def chunk_jobs(manifest: dict) -> list[tuple[dict, dict]]:
    """(session, ai_file) pairs numbered 1..n in RECORDED order, so work/chunk_NN.* caches and the
    "file" field of events keep pointing at the same AI file after a reorder."""
    return [(s, ai) for s in sorted(manifest["sessions"], key=recorded_index) for ai in s["ai_files"]]


def chunk_sessions(manifest: dict) -> dict[int, int]:
    """Chunk number -> recorded index of its session."""
    return {i: recorded_index(s) for i, (s, _ai) in enumerate(chunk_jobs(manifest), 1)}


# ---------- keyword scorer ----------

def _words(pattern: str) -> re.Pattern:
    return re.compile(rf"\b(?:{pattern})\b")


# Imperative (base) and -ing forms only. Participles ("chopped onions", "fried rice") describe an
# ingredient, and -s forms are mostly nouns ("apple slices", "the plates").
PHASES: list[tuple[float, re.Pattern]] = [
    (0.0, _words(r"pre-?heat(?:ing)?|wash(?:ing)?|rins(?:e|ing)|peel(?:ing)?|chop(?:ping)?|dic(?:e|ing)"
                 r"|minc(?:e|ing)|slic(?:e|ing)(?!\s+of)|cut(?:ting)?|grat(?:e|ing)|shred(?:ding)?|measur(?:e|ing)"
                 r"|weigh(?:ing)?|marinat(?:e|ing)|soak(?:ing)?|trim(?:ming)?|thaw(?:ing)?|defrost(?:ing)?"
                 r"|gather(?:ing)?|prep(?:ping)?|prepar(?:e|ing)|greas(?:e|ing)|zest(?:ing)?|crack(?:ing)?"
                 r"|pat\s+(?:\w+\s+){0,3}dry")),
    (0.5, _words(r"mix(?:ing)?|whisk(?:ing)?|combin(?:e|ing)|knead(?:ing)?|beat(?:ing)?|blend(?:ing)?"
                 r"|fold(?:ing)?|season(?:ing)?")),
    (1.0, _words(r"(?:deep|pan|stir)[- ]?fr(?:y|ying)|fr(?:y|ying)(?!\s+pan)|sear(?:ing)?|saut[eé](?:ing|eing)?"
                 r"|boil(?:ing)?|simmer(?:ing)?|bak(?:e|ing)(?!\s+(?:soda|powder|sheet|dish|tray|pan|paper|mat))"
                 r"|roast(?:ing)?(?!\s+(?:pan|tray))|grill(?:ing)?|broil(?:ing)?|steam(?:ing)?|poach(?:ing)?"
                 r"|toast(?:ing)?|brown(?:ing)?(?!\s+(?:sugar|rice|bread))|cook(?:ing)?(?!\s+(?:oil|spray|wine|pot))"
                 r"|flip(?:ping)?|stir(?:ring)?|carameli[sz](?:e|ing)|reduc(?:e|ing)|heat(?:ing)?|melt(?:ing)?"
                 r"|deglaz(?:e|ing)|blanch(?:ing)?|brais(?:e|ing)|stew(?:ing)?|bast(?:e|ing)|microwav(?:e|ing)"
                 r"|scrambl(?:e|ing)|assembl(?:e|ing)|layer(?:ing)?|stuff(?:ing)?|wrap(?:ping)?|spread(?:ing)?"
                 r"|shap(?:e|ing)|arrang(?:e|ing)")),
    (2.0, _words(r"plat(?:e|ing|ed)|serv(?:e|ing)|garnish(?:ing)?|dish\s+(?:up|out)|enjoy(?:ing)?|eat(?:ing)?"
                 r"|taste[- ]test(?:ing)?|dig\s+in")),
]


def step_phase(action: str) -> float | None:
    """Mean phase of the cooking verbs in one step's action, or None if it has none ("Add salt")."""
    text = action.lower()
    hits = [(m.start(), phase) for phase, rx in PHASES for m in rx.finditer(text)]
    if not hits:
        return None
    return sum(phase for _, phase in hits) / len(hits)


def session_scores(manifest: dict, events: list[dict]) -> dict[int, float | None]:
    """Recorded index -> mean phase of the clip's steps (None when no step has a cooking verb)."""
    owner = chunk_sessions(manifest)
    phases: dict[int, list[float]] = {recorded_index(s): [] for s in manifest["sessions"]}
    for ev in events:
        if ev.get("type") == "step" and ev.get("file") in owner:
            phase = step_phase(ev.get("action") or "")
            if phase is not None:
                phases[owner[ev["file"]]].append(phase)
    return {r: (round(sum(p) / len(p), 3) if p else None) for r, p in phases.items()}


def keyword_order(recorded: list[int], scores: dict[int, float | None]) -> tuple[list[int], bool]:
    """(order by score, clear). Clear = it differs from `recorded` and every pair it swaps is at least
    MARGIN apart. Any unscored clip -> no keyword opinion (recorded order, not clear)."""
    if any(scores.get(r) is None for r in recorded):
        return list(recorded), False
    order = sorted(recorded, key=lambda r: scores[r])  # stable: ties keep the file-date order
    pos = {r: k for k, r in enumerate(order)}
    swapped = [(a, b) for k, a in enumerate(recorded) for b in recorded[k + 1:] if pos[b] < pos[a]]
    return order, bool(swapped) and all(scores[a] - scores[b] >= MARGIN for a, b in swapped)


def contradictions(order: list[int], scores: dict[int, float | None]) -> list[tuple[int, int]]:
    """Pairs (a, b) that `order` puts a-before-b although the keywords clearly put b first."""
    out = []
    for k, a in enumerate(order):
        for b in order[k + 1:]:
            sa, sb = scores.get(a), scores.get(b)
            if sa is not None and sb is not None and sa - sb >= MARGIN:
                out.append((a, b))
    return out


# ---------- file dates ----------

def timestamp_issues(sessions: list[dict]) -> list[str]:
    """Why the file dates can't be trusted for order (empty = they look fine). Sessions in recorded order."""
    issues = []
    for s in sessions:
        if not s.get("recorded_at") or s.get("recorded_at_source") == "file mtime":
            issues.append(f"clip {recorded_index(s)} has no creation date")
    sources = {s.get("recorded_at_source") for s in sessions if s.get("recorded_at_source") != "file mtime"}
    if len(sources) > 1:
        issues.append("creation dates come from different kinds of metadata")
    for a, b in zip(sessions, sessions[1:]):
        try:
            ta, tb = datetime.fromisoformat(a["recorded_at"]), datetime.fromisoformat(b["recorded_at"])
        except (KeyError, TypeError, ValueError):
            continue
        ra, rb = recorded_index(a), recorded_index(b)
        if ta == tb:
            issues.append(f"clips {ra} and {rb} have the same creation date")
        elif (tb - ta).total_seconds() < a["duration_s"] - 5:
            issues.append(f"clip {rb} starts before clip {ra} ends")
    return issues


# ---------- the model call ----------

class OrderAnswer(BaseModel):
    """What the order call returns (no defaults: Gemini's response_schema rejects them)."""
    order: list[int]
    confidence: Literal["low", "medium", "high"]
    reason: str


def parse_answer(text: str, ids: list[int]) -> OrderAnswer:
    answer = OrderAnswer.model_validate_json(text)
    if sorted(answer.order) != sorted(ids):
        raise ValueError(f"order {answer.order} must list every clip id {sorted(ids)} exactly once")
    return answer


def _mmss(s: float) -> str:
    s = max(0, int(s))
    return f"{s // 60:02d}:{s % 60:02d}"


def _clip(text: str | None) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= TEXT_CHARS else text[:TEXT_CHARS - 3] + "..."


SOURCE_LABEL = {"com.apple.quicktime.creationdate": "the phone's creation date",
                "creation_time": "the file's creation time", "file mtime": "file modified time; no creation date"}


def dates_note(issues: list[str]) -> str:
    return "; ".join(issues) if issues else "look consistent"


def build_prompt(manifest: dict, events: list[dict]) -> str:
    """The order prompt. Clips are listed by recorded index with clip-relative times, so the text (and
    its hash, the cache key) is the same before and after a reorder."""
    owner = chunk_sessions(manifest)
    by_r = {recorded_index(s): s for s in manifest["sessions"]}
    steps: dict[int, list[dict]] = {r: [] for r in by_r}
    for ev in events:
        if ev.get("type") == "step" and ev.get("file") in owner:
            steps[owner[ev["file"]]].append(ev)
    blocks = []
    for r in sorted(by_r):
        s = by_r[r]
        evs = sorted(steps[r], key=lambda e: (e["start_s"], e["end_s"]))
        if len(evs) > MAX_STEPS_PER_CLIP:
            half = MAX_STEPS_PER_CLIP // 2
            evs = [*evs[:half], None, *evs[-half:]]
        source = SOURCE_LABEL.get(s.get("recorded_at_source"), s.get("recorded_at_source") or "unknown")
        lines = [f"Clip {r}: {_mmss(s['duration_s'])} long; file date {s.get('recorded_at') or 'unknown'} "
                 f"(from {source})"]
        for ev in evs:
            if ev is None:
                lines.append("  ...")
                continue
            line = (f"  {_mmss(ev['start_s'] - s['offset_s'])}-{_mmss(ev['end_s'] - s['offset_s'])} "
                    f"{_clip(ev.get('action'))}")
            if ev.get("quote"):
                line += f' Says: "{_clip(ev["quote"])}"'
            lines.append(line)
        if not evs:
            lines.append("  (no steps found)")
        blocks.append("\n".join(lines))
    issues = timestamp_issues([by_r[r] for r in sorted(by_r)])
    return ORDER_PROMPT.format(n=len(by_r), title=json.dumps(manifest.get("title", ""), ensure_ascii=False),
                               dates=dates_note(issues), clips="\n\n".join(blocks))


# ---------- the decision ----------

def decide(recorded: list[int], scores: dict[int, float | None], answer: OrderAnswer | None,
           issues: list[str]) -> tuple[list[int], str]:
    """(chosen order, why). See the module docstring for the rule."""
    kw, kw_clear = keyword_order(recorded, scores)
    dates = "file dates unreliable (" + "; ".join(issues) + ")" if issues else "file dates look fine"
    if answer is None:
        if kw_clear and issues:
            return kw, f"keywords put the clips in cooking order {kw}; {dates}; no model answer"
        if kw_clear:
            return list(recorded), f"kept file-date order: keywords suggest {kw} but {dates} and no model answer"
        return list(recorded), "kept file-date order: no model answer and no clear keyword order"
    m = list(answer.order)
    said = f"model ({answer.confidence}): {answer.reason}"
    if m == list(recorded):
        return list(recorded), f"kept file-date order: content agrees; {said}"
    # Nothing is known about a clip without scored steps, so it stays where its file date put it.
    moved = [r for r in recorded if scores.get(r) is None and m.index(r) != recorded.index(r)]
    if moved:
        return list(recorded), (f"kept file-date order: model order {m} moves clip(s) {moved}, which have no "
                                f"steps the keywords can place; {said}")
    clash = contradictions(m, scores)
    if clash:
        pairs = ", ".join(f"{b} before {a}" for a, b in clash)
        return list(recorded), f"kept file-date order: model order {m} clashes with keywords ({pairs}); {said}"
    if answer.confidence == "high" and (issues or (kw_clear and kw == m)):
        agree = "; keywords agree" if kw_clear and kw == m else ""
        return m, f"cooking order {m}{agree}; {said}; {dates}"
    if answer.confidence == "medium" and issues and kw_clear and kw == m:
        return m, f"cooking order {m}; keywords agree; {said}; {dates}"
    if answer.confidence == "high":  # good dates, keywords not clearly the same order
        return list(recorded), f"kept file-date order: {dates} and keywords do not clearly back {m}; {said}"
    return list(recorded), f"kept file-date order: model suggests {m} but is not sure enough; {said}; {dates}"


# ---------- applying an order ----------

def shift_events(events: list[dict], owner: dict[int, int], deltas: dict[int, int],
                 limits: dict[int, int]) -> list[dict]:
    """Move each event by its session's offset change; clamp like process.offset_events (end to the
    chunk's limit in the new layout, start to end). owner: chunk -> recorded index."""
    out = []
    for ev in events:
        d = dict(ev)
        i = ev["file"]
        delta = deltas[owner[i]]
        end = min(ev["end_s"] + delta, limits[i])
        d["start_s"], d["end_s"] = min(ev["start_s"] + delta, end), end
        out.append(d)
    return out


def chunk_limits(manifest: dict) -> dict[int, int]:
    """Chunk -> last whole second its events may reach (same rule as process.offset_events)."""
    out = {}
    for i, (s, ai) in enumerate(chunk_jobs(manifest), 1):
        base = s["offset_s"] + ai["start_in_file_s"]
        out[i] = min(s["offset_s"] + s["duration_s"], math.floor(base + ai["duration_s"]), manifest["duration_s"])
    return out


def shift_gaps(gaps: list[dict], manifest: dict) -> list[dict]:
    """Recompute not-processed ranges (process.Extraction.gap) for the new layout."""
    jobs = chunk_jobs(manifest)
    out = []
    for g in gaps:
        d = dict(g)
        s, ai = jobs[g["chunk"] - 1]
        base = s["offset_s"] + ai["start_in_file_s"]
        d["start_s"] = round(base)
        d["end_s"] = min(round(base + ai["duration_s"]), manifest["duration_s"])
        out.append(d)
    return out


def _prevs(out_dir: Path) -> list[tuple[Path, Path]]:
    """(pre-swap hard link, live file) for play.mp4 and voice.m4a."""
    work = out_dir / "work"
    return [(work / prep.PREV_PLAY, out_dir / "play.mp4"), (work / prep.PREV_VOICE, out_dir / "voice.m4a")]


def _keep(src: Path, dst: Path) -> None:
    """Keep src's current content at dst without copying gigabytes (hard link; copy if linking fails)."""
    dst.unlink(missing_ok=True)
    if not src.exists():
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def current_order(manifest: dict) -> list[int]:
    return [recorded_index(s) for s in manifest["sessions"]]


def restore_interrupted(out_dir: Path, log: Log = _log) -> None:
    """Finish or undo a clip swap that stopped part-way (apply_order). work/swap.pending.json is written
    before the swap and removed after the manifest: if the manifest on disk already equals its target the
    swap committed; otherwise play.mp4, voice.m4a and recipe.json are put back. Also clears half-built
    files. Safe to call any time; process.run calls it first."""
    work = out_dir / "work"
    pending = work / prep.SWAP_PENDING
    if pending.exists():
        info = json.loads(pending.read_text())
        manifest_path = work / "manifest.json"
        on_disk = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
        if on_disk != info["manifest"]:
            for prev, live in _prevs(out_dir):
                if prev.exists():
                    os.replace(prev, live)
            recipe, stale = out_dir / "recipe.json", work / prep.STALE_RECIPE
            if info.get("recipe_moved") and stale.exists() and not recipe.exists():
                os.replace(stale, recipe)
            log("[order] undid an interrupted clip reorder: play.mp4, voice.m4a and recipe.json are as before")
        pending.unlink()
    for prev, _live in _prevs(out_dir):
        prev.unlink(missing_ok=True)
    for tmp in [*work.glob("*.reorder*"), *(work / name for name in prep.LEGACY_BACKUPS)]:
        tmp.unlink(missing_ok=True)


def apply_order(out_dir: Path, manifest: dict, target: list[int], record: dict, events: list[dict],
                not_processed: list[dict], log: Log = _log) -> tuple[dict, list[dict], list[dict]]:
    """Rebuild the media in `target` order and return (new manifest, shifted events, shifted gaps).
    All encoding happens in work/*.reorder.* first; the live files are swapped only at the end, and the
    manifest written right after, so a failure before the swap changes nothing."""
    work = out_dir / "work"
    by_r = {recorded_index(s): s for s in manifest["sessions"]}
    plays = [out_dir / prep.play_file(by_r[r]) for r in target]
    missing = [p.name for p in plays if not p.exists()]
    if missing:
        raise prep.PrepError(f"playback copies missing ({', '.join(missing)}); re-run prep.py")

    new_play, new_voice = work / "play.reorder.mp4", work / "voice.reorder.m4a"
    prep.concat(plays, work, new_play)
    prep.encode(new_voice, ["-i", str(new_play), "-vn", "-c:a", "copy", "-movflags", "+faststart"], True)

    # recorded_index & play_file made explicit: manifests from before this change only had "index".
    sessions = [{**by_r[r], "recorded_index": r, "play_file": prep.play_file(by_r[r])} for r in target]
    for n, s in enumerate(sessions, 1):
        s["index"] = n
    summed = prep.lay_out(sessions, out_dir)
    total = prep.probe_duration(new_play)
    if abs(summed - total) > 2:
        log(f"[order] warning: play.mp4 is {total:.1f} s but the copies sum to {summed:.1f} s; offsets may drift")
    new = {**manifest, "duration_s": math.floor(total), "sessions": sessions, "order": record}

    owner = chunk_sessions(new)
    old_off = {recorded_index(s): s["offset_s"] for s in manifest["sessions"]}
    deltas = {recorded_index(s): s["offset_s"] - old_off[recorded_index(s)] for s in sessions}
    events = shift_events(events, owner, deltas, chunk_limits(new))
    not_processed = shift_gaps(not_processed, new)

    # The swap. Anything that fails before the manifest write is undone by restore_interrupted().
    play, voice = out_dir / "play.mp4", out_dir / "voice.m4a"
    for prev, live in _prevs(out_dir):
        _keep(live, prev)
    recipe, stale = out_dir / "recipe.json", work / prep.STALE_RECIPE
    moved = recipe.exists()
    prep.write_json(work / prep.SWAP_PENDING, {"manifest": new, "recipe_moved": moved})
    if moved:  # its times point into the old play.mp4: keep it out of publish.py's reach
        os.replace(recipe, stale)
        log(f"[order] moved the old recipe.json to work/{prep.STALE_RECIPE}: its times no longer match play.mp4")
    os.replace(new_play, play)
    os.replace(new_voice, voice)
    prep.write_json(work / "manifest.json", new)  # commit

    try:  # committed above; what follows is cleanup, debug output & a placeholder, never worth a rollback
        restore_interrupted(out_dir, log)  # the manifest matches: just drops the pending file & links
        for i in sorted(owner):
            path = work / f"chunk_{i:02d}.offset.json"
            if path.exists():
                mine = [e for e in events if e["file"] == i]
                path.write_text(json.dumps({"chunk_index": i, "events": mine}, indent=2, ensure_ascii=False) + "\n")
        prep.make_poster(play, total * 0.2, out_dir / "poster.jpg")  # placeholder; process.py redraws it
    except Exception as e:  # noqa: BLE001
        log(f"[order] warning: after the reorder: {type(e).__name__}: {e}")
    log(f"[order] rebuilt play.mp4 & voice.m4a in clip order {target} ({total:.0f} s); "
        f"offsets {[s['offset_s'] for s in sessions]}")
    return new, events, not_processed


def order_sessions(out_dir: Path, manifest: dict, events: list[dict], not_processed: list[dict],
                   ask: Callable[[str, list[int]], OrderAnswer | None] | None, model_name: str | None = None,
                   force: bool = False, log: Log = _log) -> tuple[dict, list[dict], list[dict]]:
    """Decide the cooking order of the clips and apply it. Returns (manifest, events, not_processed),
    reordered when the decision changed the order. `ask(prompt, ids)` is the model call (None = skip it);
    it returns None when the model gave no usable answer. The decision is cached in the manifest and
    reused (no model call) while the extracted steps are unchanged, unless force."""
    if len(manifest["sessions"]) < 2:
        return manifest, events, not_processed
    if manifest.get("keep_order"):
        log("[order] filmed in the app: keeping the order it was filmed in")
        return manifest, events, not_processed
    recorded = sorted(current_order(manifest))
    prompt = build_prompt(manifest, events)
    basis = hashlib.sha256(prompt.encode()).hexdigest()[:16]
    cached = manifest.get("order")
    if cached and cached.get("basis") == basis and not force and sorted(cached.get("chosen", [])) == recorded:
        record = cached
        log(f"[order] reusing the clip-order decision: {record['why']}")
    else:
        scores = session_scores(manifest, events)
        issues = timestamp_issues(sorted(manifest["sessions"], key=recorded_index))
        answer = ask(prompt, recorded) if ask else None
        target, why = decide(recorded, scores, answer, issues)
        kw, kw_clear = keyword_order(recorded, scores)
        record = {
            "recorded": recorded, "chosen": target, "reordered": target != recorded, "why": why,
            "timestamp_issues": issues,
            "keywords": {"scores": {str(r): v for r, v in scores.items()}, "order": kw, "clear": kw_clear},
            "model": ({"model": model_name, **answer.model_dump()} if answer else None),
            # no model answer: don't cache, so the next run asks again
            "basis": basis if answer is not None else None, "decided_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        log(f"[order] {why}")
    target = record["chosen"]
    if target == current_order(manifest):
        if manifest.get("order") != record:
            manifest = {**manifest, "order": record}
            prep.write_json(out_dir / "work" / "manifest.json", manifest)
        return manifest, events, not_processed
    try:
        return apply_order(out_dir, manifest, target, record, events, not_processed, log)
    except Exception as e:  # noqa: BLE001 - a failed reorder must not lose the recipe: keep the current order
        restore_interrupted(out_dir, log)
        log(f"[order] WARNING: could not rebuild the media in order {target}; keeping clip order "
            f"{current_order(manifest)}: {type(e).__name__}: {e}")
        failed = {**record, "chosen": current_order(manifest), "reordered": current_order(manifest) != recorded,
                  "why": f"reorder to {target} failed ({type(e).__name__}); {record['why']}", "basis": None}
        manifest = {**manifest, "order": failed}
        prep.write_json(out_dir / "work" / "manifest.json", manifest)
        return manifest, events, not_processed


def cleanup(out_dir: Path) -> None:
    """After recipe.json is written: the set-aside recipe is outdated, and older runs' backups unused."""
    work = out_dir / "work"
    for name in (prep.STALE_RECIPE, *prep.LEGACY_BACKUPS):
        (work / name).unlink(missing_ok=True)
