"""[C] Real-time analysis: while the cook cooks, every 30 s of glasses footage (1 frame per second plus
the audio) goes to Gemini with the same prompt and schema as pipeline/extract.py, and what comes back
(steps, ingredients, cues, quotes, stories) is posted to Convex as live events.

Windows overlap by 5 s so a step that starts on a boundary isn't missed; a step that starts in the
overlap was already reported by the previous window and is skipped, unless that window failed.

Every window is posted, including the ones that fail, are skipped because Gemini is still busy with
earlier ones, or have no footage (a Wi-Fi gap): `ok: false` marks a hole in the live coverage. The
final recipe is still made from the full backup video, so holes cost speed and hints, never steps.
"""
from __future__ import annotations

import base64
import json
import sys
import tempfile
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from edg_protocol import JPEG, PCM, Packet  # noqa: E402
import session_builder as sb  # noqa: E402

WINDOW_S = 30.0
OVERLAP_S = 5.0
SETTLE_S = 2.0  # cut a window once the stream is this far past its end (late audio)
MAX_IN_FLIGHT = 2  # windows waiting for Gemini; more than this and the newest is skipped
RESOLUTION = "medium"

LIVE_NOTE = """
This is a live pass: the video is a {window:.0f}-second window, sent while the cook is still cooking.
Report only what happens in it; partial steps at its edges are fine.
Steps already reported earlier in this session (do not repeat them unless they continue here): {so_far}
"""


@dataclass
class _Session:
    sid: str
    meta: dict
    started_at_ms: int
    frames: list[tuple[float, bytes]] = field(default_factory=list)
    audio: list[tuple[float, bytes]] = field(default_factory=list)
    markers: list[float] = field(default_factory=list)
    k: int = 0
    start: float = -1.0  # set by the first packet
    max_t: float = 0.0
    last_frame_t: float = -10.0
    ok: dict[int, bool] = field(default_factory=dict)  # window k -> analysed
    titles: list[str] = field(default_factory=list)


Post = Callable[[dict], None]


class LiveAnalyzer:
    def __init__(self, post: Post, model: str, client=None, window_s: float = WINDOW_S,
                 overlap_s: float = OVERLAP_S) -> None:
        self.post = post
        self.model = model
        self._client = client
        self.window_s, self.overlap_s = window_s, overlap_s
        self.sessions: dict[str, _Session] = {}
        self.pool = ThreadPoolExecutor(max_workers=1)
        self.in_flight = 0
        self.futures: list[Future] = []
        self.lock = threading.Lock()  # in_flight and futures change on the loop and in the worker
        self.cut_lock = threading.Lock()  # the loop cuts windows; a finish (another thread) cuts the last one

    @property
    def client(self):
        if self._client is None:
            from google import genai
            self._client = genai.Client()  # reads GEMINI_API_KEY
        return self._client

    # ---- fed from the receiver's loop; cheap ----

    def start(self, sid: str, meta: dict, started_at_ms: int) -> None:
        """Analyse this session from its next packet on, until flush. (Footage from before it was paired with
        a recording isn't analysed live; the full pass over the backup covers it.)"""
        if sid not in self.sessions:
            self.sessions[sid] = _Session(sid, meta, started_at_ms)

    def frame(self, sid: str, jpeg: bytes, t: float) -> None:
        s = self.sessions.get(sid)
        if s is None:
            return
        if s.start < 0:
            s.start = t
        if t - s.last_frame_t >= 1.0:  # Gemini reads 1 fps; keep only what it will look at
            s.last_frame_t = t
            s.frames.append((t, jpeg))
        self._advance(s, t)

    def audio(self, sid: str, pcm: bytes, t: float) -> None:
        s = self.sessions.get(sid)
        if s is None:
            return
        s.audio.append((t, pcm))
        self._advance(s, t)

    def marker(self, sid: str, t: float) -> None:
        if s := self.sessions.get(sid):
            s.markers.append(t)

    def _advance(self, s: _Session, t: float) -> None:
        if s.start < 0:
            s.start = t
        s.max_t = max(s.max_t, t)
        if s.max_t >= s.start + self.window_s + SETTLE_S:
            with self.cut_lock:
                while s.max_t >= s.start + self.window_s + SETTLE_S:
                    self._cut(s, s.start + self.window_s)

    def flush(self, sid: str, timeout: float = 120) -> None:
        """The session is over: analyse what's left and wait for every window to be posted."""
        with self.cut_lock:
            s = self.sessions.pop(sid, None)
            if s and s.start >= 0 and s.max_t - s.start > 1.0:
                self._cut(s, s.max_t)
        with self.lock:
            pending = list(self.futures)
        for f in pending:
            f.result(timeout=timeout)

    def _cut(self, s: _Session, end: float) -> None:
        start, k = s.start, s.k
        frames = [(t, j) for t, j in s.frames if start <= t < end]
        audio = [(t, p) for t, p in s.audio if start <= t < end]
        markers = [t for t in s.markers if start <= t < end]
        s.k += 1
        s.start = end - self.overlap_s
        s.frames = [x for x in s.frames if x[0] >= s.start]
        s.audio = [x for x in s.audio if x[0] >= s.start]
        # The cook's button taps are facts, not guesses: they go in whatever happens to the window.
        taps = [{"kind": "marker", "atS": round(t, 1), "title": "step marker", "text": "", "confidence": 1.0}
                for t in markers if not (k and t < start + self.overlap_s)]
        base = {"sessionId": s.sid, "sessionStartedAt": s.started_at_ms, "windowStartS": round(start, 2),
                "windowEndS": round(end, 2)}
        if not frames:
            s.ok[k] = False
            self.post({**base, "ok": False, "reason": "no footage", "events": taps})
            return
        with self.lock:
            busy = self.in_flight >= MAX_IN_FLIGHT
            if not busy:
                self.in_flight += 1
        if busy:
            s.ok[k] = False
            self.post({**base, "ok": False, "reason": "analysis behind", "events": taps})
            return
        fut = self.pool.submit(self._analyse, s, k, start, end, frames, audio, markers, base, taps)
        with self.lock:
            self.futures.append(fut)
        fut.add_done_callback(self._done)

    def _done(self, fut: Future) -> None:
        with self.lock:
            self.in_flight -= 1
            if fut in self.futures:
                self.futures.remove(fut)

    # ---- one window, in the worker thread ----

    def _analyse(self, s: _Session, k: int, start: float, end: float, frames, audio, markers, base: dict,
                 taps: list[dict]) -> None:
        t0 = time.time()
        # Windows are analysed in order on one thread, so window k-1's outcome is known by now.
        skip_before = start + self.overlap_s if s.ok.get(k - 1) else start
        try:
            result = self._ask(s, k, start, end, frames, audio, markers)
            events = to_events(result, start, skip_before)
            s.titles += [e["title"] for e in events if e["kind"] == "step"]
            s.ok[k] = True
            self.post({**base, "ok": True, "events": taps + events})
            print(f"[live] {s.sid} {sb.mmss(start)}-{sb.mmss(end)}: {len(events)} events in {time.time() - t0:.1f} s")
        except Exception as e:  # Gemini down or slow: a hole in the live log, filled from the backup later
            s.ok[k] = False
            self.post({**base, "ok": False, "reason": f"{type(e).__name__}: {e}"[:300], "events": taps})
            print(f"[live] {s.sid} {sb.mmss(start)}-{sb.mmss(end)} failed: {e}")

    def _ask(self, s: _Session, k: int, start: float, end: float, frames, audio, markers):
        import extract  # pipeline/extract.py: the same prompt and schema as the full pass
        from schema import ChunkRecipe

        session = sb.Session(
            session_id=s.sid, hello={},
            frames=[Packet(JPEG, 0, 0, int(t * 1000), j) for t, j in frames],
            audio=[Packet(PCM, 0, 0, int(t * 1000), p) for t, p in audio],
            events=[], duration=end)
        with tempfile.TemporaryDirectory() as tmp:
            mp4 = Path(tmp) / "window.mp4"
            sb.build_mp4(session, start, end, mp4, fps=1)
            video = mp4.read_bytes()
        sidecar = {
            "cook_name": s.meta.get("cook_name", ""), "relationship": s.meta.get("relationship", ""),
            "spoken_languages": s.meta.get("spoken_languages", []), "dish_name": s.meta.get("dish_name", ""),
            "capture_mode": "ai", "chunk_index": k, "chunk_start_s": round(start, 3),
            "chunk_duration_s": round(end - start, 3), "overlap_with_previous_s": self.overlap_s if k else 0,
            "markers": [{"at": sb.mmss(t - start)} for t in markers], "gaps": [],
        }
        prompt = extract.build_prompt(sidecar) + LIVE_NOTE.format(
            window=end - start, so_far="; ".join(s.titles[-8:]) or "none yet")
        interaction = self.client.interactions.create(
            model=self.model,
            input=[
                {"type": "video", "data": base64.b64encode(video).decode(), "mime_type": "video/mp4",
                 "processing": {"type": "static", "fps": 1}, "resolution": RESOLUTION},
                {"type": "text", "text": prompt},
            ],
            response_format={"type": "text", "mime_type": "application/json",
                             "schema": ChunkRecipe.model_json_schema()},
        )
        return ChunkRecipe.model_validate_json(interaction.output_text)


def _secs(mmss: str) -> float:
    try:
        parts = [float(x) for x in mmss.strip().split(":")]
    except ValueError:
        return 0.0
    out = 0.0
    for p in parts:
        out = out * 60 + p
    return out


def to_events(result, start: float, skip_before: float) -> list[dict]:
    """A ChunkRecipe for one window -> Convex live events, in session seconds."""
    events: list[dict] = []
    for st in result.steps:
        at, end = start + _secs(st.start), start + _secs(st.end)
        if at < skip_before:
            continue
        conf = round(max(0.0, min(1.0, st.confidence)), 2)
        events.append({"kind": "step", "atS": round(at, 1), "endS": round(max(end, at), 1), "title": st.title,
                       "text": st.instruction, "confidence": conf})
        for ing in st.ingredients:
            events.append({"kind": "ingredient", "atS": round(start + _secs(ing.at), 1), "title": ing.name,
                           "text": ing.estimated_amount, "saidAs": ing.said_as, "confidence": conf})
        if st.doneness_cue:
            events.append({"kind": "cue", "atS": round(at, 1), "title": st.title, "text": st.doneness_cue,
                           "confidence": conf})
        if st.quote_original:
            events.append({"kind": "quote", "atS": round(at, 1), "title": st.title,
                           "text": st.quote_english or st.quote_original, "quoteOriginal": st.quote_original,
                           "confidence": conf})
        if st.story:
            events.append({"kind": "story", "atS": round(at, 1), "title": st.title, "text": st.story,
                           "confidence": conf})
    for e in events:  # the cook's words are optional; leave them out rather than send ""
        for key in ("saidAs", "quoteOriginal"):
            if not e.get(key, True):
                del e[key]
    return events


if __name__ == "__main__":  # quick look at what one window of a saved session gives
    import argparse

    ap = argparse.ArgumentParser(description="Run the live analysis over a saved session, as if it were live.")
    ap.add_argument("session_dir", type=Path)
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--max-windows", type=int, default=2)
    a = ap.parse_args()
    session = sb.load_session(sb.raw_files_for(a.session_dir))
    meta = json.loads((a.session_dir / "meta.json").read_text())
    an = LiveAnalyzer(lambda w: print(json.dumps(w, ensure_ascii=False, indent=2)), a.model)
    an.start(session.session_id, meta, 0)
    limit = a.max_windows * (WINDOW_S - OVERLAP_S) + OVERLAP_S + SETTLE_S
    for p in sorted(session.frames + session.audio, key=lambda p: p.t_ms):
        if p.t > limit:
            break
        (an.frame if p.type == JPEG else an.audio)(session.session_id, p.payload, p.t)
    an.flush(session.session_id)
