"""Coverage check run after the merge: no step the video shows may be left out of the recipe.

Deterministic and offline. Times are seconds on the full-video timeline (the merge's events and steps).
- missing: an extracted step event the recipe's steps cover less than half of in time (see covered),
  i.e. the merge dropped it.
- gaps: more than gap_s seconds between two recipe steps while extracted step events show the cook
  working for at least ACTIVE_S of it (a step there may be cut short or missing). Reported only.

process.ensure_coverage retries the merge once with the missing steps listed (retry_lines), keeps
whatever is still missing in the report, writes it to work/coverage.json and warns loudly (warnings).
Tests: pipeline/test_coverage.py.
"""
from __future__ import annotations

GAP_S = 120  # COVERAGE_GAP_S in .env overrides it (process.load_config)
ACTIVE_S = 30  # seconds of extracted step activity inside a long gap before it is reported


def mmss(s: int) -> str:
    return f"{s // 60:02d}:{s % 60:02d}"


def busy_s(events: list[dict], start: int, end: int) -> int:
    """Seconds of start..end during which at least one of the events is happening."""
    spans = sorted((max(ev["start_s"], start), min(ev["end_s"], end)) for ev in events)
    total, cursor = 0, start
    for a, b in spans:
        a = max(a, cursor)
        if b > a:
            total += b - a
            cursor = b
    return total


def covered(ev: dict, steps: list[dict]) -> bool:
    """Did the recipe keep this step event? A momentary event (start == end) must fall inside a step, edges
    included. A longer one must be at least half inside the steps: extracted ranges often overlap their
    neighbours by a second or two, so a dropped step must not pass just by brushing the next one."""
    a, b = ev["start_s"], ev["end_s"]
    if b <= a:
        return any(s["start_s"] <= a <= s["end_s"] for s in steps)
    return 2 * busy_s(steps, a, b) >= b - a


def summary(ev: dict) -> dict:
    out = {"start_s": ev["start_s"], "end_s": ev["end_s"], "action": ev.get("action") or ""}
    if "file" in ev:
        out["file"] = ev["file"]
    return out


def missing_steps(events: list[dict], steps: list[dict]) -> list[dict]:
    return [summary(ev) for ev in events
            if ev["type"] == "step" and not covered(ev, steps)]


def long_gaps(events: list[dict], steps: list[dict], gap_s: int = GAP_S) -> list[dict]:
    step_events = [ev for ev in events if ev["type"] == "step"]
    gaps, prev = [], None
    for s in sorted(steps, key=lambda s: (s["start_s"], s["end_s"])):
        if prev is not None and s["start_s"] - prev["end_s"] > gap_s:
            start, end = prev["end_s"], s["start_s"]
            active = busy_s(step_events, start, end)
            if active >= ACTIVE_S:
                inside = [ev for ev in step_events if min(ev["end_s"], end) > max(ev["start_s"], start)]
                gaps.append({"start_s": start, "end_s": end, "seconds": end - start, "active_s": active,
                             "after_step": prev["order"], "before_step": s["order"],
                             "events": [summary(ev) for ev in inside]})
        if prev is None or s["end_s"] >= prev["end_s"]:  # an overlapped step never ends a gap early
            prev = s
    return gaps


def check(events: list[dict], steps: list[dict], gap_s: int = GAP_S) -> dict:
    """The coverage report saved as work/coverage.json."""
    return {"extracted_steps": sum(ev["type"] == "step" for ev in events), "recipe_steps": len(steps),
            "gap_s": gap_s, "missing": missing_steps(events, steps), "gaps": long_gaps(events, steps, gap_s)}


def line(ev: dict) -> str:
    return f"{mmss(ev['start_s'])}-{mmss(ev['end_s'])}  {ev['action']}"


def retry_lines(missing: list[dict]) -> str:
    """The missing steps for the merge retry prompt, in the prompt's own units (seconds)."""
    return "\n".join(f"- {ev['start_s']}-{ev['end_s']} s: {ev['action']}" for ev in missing)


def warnings(report: dict) -> list[str]:
    """Lines to print at the end of a run; empty when nothing is missing and no gap is suspicious."""
    out = []
    if report["missing"]:
        out.append(f"!!! COVERAGE WARNING: {len(report['missing'])} step(s) the video shows are NOT in the recipe "
                   "(fine only if they belong to another dish; details in work/coverage.json):")
        out += [f"!!!   {line(ev)}" for ev in report["missing"]]
    for g in report["gaps"]:
        acts = "; ".join(ev["action"] for ev in g["events"])
        out.append(f"coverage: {g['seconds']} s between step {g['after_step']} and step {g['before_step']} "
                   f"({mmss(g['start_s'])}-{mmss(g['end_s'])}) while the cook was working: {acts}")
    return out
