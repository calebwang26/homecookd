"""Run Gemini over the AI copies from prep.py and merge the events into a validated recipe.json.

python pipeline/process.py --id weed-pancakes [--force] [--no-shorten]     # reads data/out/<id>/work/manifest.json
python pipeline/process.py --id weed-pancakes --batch [--batch-timeout-min 1440]
python pipeline/process.py --id weed-pancakes --rewrite [--writer gemini]   # re-merge from the cached extraction

--batch sends the extraction calls as one Gemini Batch API job (half price; results within 24 h, usually
much sooner) instead of parallel synchronous calls. The merge is always a normal synchronous call.

With 2+ clips, a cheap text-only call (Flash) and a keyword scorer then decide the clips' cooking order;
if it clearly differs from the file-date order (see order.decide for when), play.mp4,
voice.m4a, the manifest and every event time are rebuilt in that order before the merge (pipeline/order.py).

After the merge, pipeline/coverage.py checks that every extracted step made it into the recipe. If some did
not, the merge is retried once with them listed; anything still missing is warned about loudly at the end of
the run and saved, with long suspicious gaps between steps, in work/coverage.json (see ensure_coverage).

The merge (and its coverage retry) is the writing step: Muse Spark writes it by default, Gemini when
RECIPE_WRITER=gemini or when Muse fails twice (pipeline/writer.py). Extraction always stays on Gemini.

The cover (poster.jpg) is the cook's own plate photo when an in-app recording has one (the worker passes it as
cover_photo), else the sharpest real frame of the finished dish where Gemini says it looks best
(pipeline/cover.py), else the middle of the last step.

Last, one more text call (pipeline/shorten.py) writes cook mode's short substeps, step ingredients and tips
into recipe.json, and pipeline/align.py times each substep on the recording; --no-shorten skips both.

Env (.env; already-set variables win): GEMINI_API_KEY, GEMINI_MODEL (merge),
GEMINI_EXTRACT_MODEL (blank = GEMINI_MODEL), GEMINI_MEDIA_RESOLUTION (default MEDIA_RESOLUTION_LOW),
COVERAGE_GAP_S (default 120: report longer gaps between steps while the cook was still working),
RECIPE_WRITER and MUSE_* (pipeline/writer.py).
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import shutil
import sys
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
from pydantic import ValidationError  # noqa: E402

from pipeline import coverage, order, writer  # noqa: E402
from pipeline.prep import OUT_ROOT, PrepError, make_poster  # noqa: E402
from pipeline.prompts import (COVERAGE_RETRY_SUFFIX, EXTRACT_PROMPT, EXTRACT_RETRY_SUFFIX,  # noqa: E402
                              MERGE_PROMPT, MERGE_RETRY_SUFFIX, context)
from pipeline.schema import ChunkOutput, Recipe, RecipeDraft, TimedChunkOutput  # noqa: E402

# USD per 1M tokens, Standard paid tier, from https://ai.google.dev/gemini-api/docs/pricing
# (fetched 2026-10-11). Output prices include thinking tokens. Pairs are (prompt <= 200k, prompt > 200k).
# gemini-3.8-flash: $0.75 in / $3.75 out through Dec 31 2026 ($1.50 / $7.50 from Jan 1 2027); no >200k tier listed.
# Neither model lists a separate audio/video input price.
# Batch API (same page): 50% of Standard. gemini-3.1-pro-preview $1.00 in / $6.00 out (prompt <= 200k; the
# > 200k pair is likewise half of Standard); gemini-3.8-flash $0.375 / $1.875 through Dec 31 2026.
PRICES: dict[str, dict[str, tuple[float, float]]] = {
    "gemini-3.1-pro-preview": {"input": (2.00, 4.00), "output": (12.00, 18.00),
                               "batch_input": (1.00, 2.00), "batch_output": (6.00, 9.00)},
    "gemini-3.8-flash": {"input": (0.75, 0.75), "output": (3.75, 3.75),
                         "batch_input": (0.375, 0.375), "batch_output": (1.875, 1.875)},
    # https://dev.meta.ai/docs/pricing-rate-limits (fetched 2026-10-23); no batch tier, so batch = standard.
    "muse-spark-1.3": {"input": (1.25, 1.25), "output": (4.25, 4.25),
                       "batch_input": (1.25, 1.25), "batch_output": (4.25, 4.25)},
}
FALLBACK_PRICE_MODEL = "gemini-3.1-pro-preview"  # unknown models are costed at the most expensive known rate
ORDER_MODEL = "gemini-3.8-flash"  # the clip-order call; GEMINI_EXTRACT_MODEL instead when that is a Flash model

UPLOAD_TIMEOUT_S = 300
REQUEST_TIMEOUT_MS = 10 * 60 * 1000
# The SDK never retries unless retry_options is set; a burst of 429s on a 12-file video would otherwise
# use up extract_one's single (immediate) retry and drop whole 15-minute chunks. Covers every request,
# including uploads and batch polling. Timeouts are retried too, so one hung call can take 4 x 10 min.
HTTP_RETRY = types.HttpRetryOptions(attempts=4, initial_delay=10, max_delay=120,
                                    http_status_codes=[429, 500, 502, 503, 504])
FLASH_HINT_S = 180
MAX_WORKERS = 4  # parallel extraction calls & uploads; smaller bursts against per-minute rate limits
BATCH_POLL_S = 30
BATCH_TIMEOUT_S = 24 * 3600  # uploaded files live 48 h on the File API, so they outlast the job
BATCH_DONE = {"JOB_STATE_SUCCEEDED", "JOB_STATE_PARTIALLY_SUCCEEDED", "JOB_STATE_FAILED",
              "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}


class ProcessError(RuntimeError):
    pass


def log(msg: str) -> None:
    print(msg, flush=True)


def show_sdk_retries() -> None:
    """Print the SDK's HTTP retry notices (logged at INFO), so a 429 back-off is not a silent pause."""
    sdk = logging.getLogger("google_genai._api_client")
    if not sdk.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("[gemini] %(message)s"))
        sdk.addHandler(handler)
        sdk.setLevel(logging.INFO)
        sdk.propagate = False


# ---------- cost & usage ----------

def estimate_cost(model: str, prompt: int, output: int, batch: bool = False) -> tuple[float, bool]:
    """Returns (usd, price_known). `output` includes thinking tokens. batch=True uses Batch API prices."""
    price = PRICES.get(model)
    known = price is not None
    price = price or PRICES[FALLBACK_PRICE_MODEL]
    tier = 1 if prompt > 200_000 else 0
    pre = "batch_" if batch else ""
    return (prompt * price[pre + "input"][tier] + output * price[pre + "output"][tier]) / 1_000_000, known


class Usage:
    """work/usage.json: {"estimated_cost_usd": float, "calls": [...]}. Every run appends, --force included,
    so estimated_cost_usd is everything ever spent on this recipe (the worker's spend cap sums it)."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.calls: list[dict] = []
        if path.exists():
            self.calls = json.loads(path.read_text()).get("calls", [])
        self.run_start = len(self.calls)

    def add(self, kind: str, model: str, file: str | None, attempt: int, seconds: float,
            resp: types.GenerateContentResponse | None, error: str | None = None) -> dict:
        """kind is "extract", "extract-batch" (costed at Batch API prices), "order" or "merge"."""
        meta = resp.usage_metadata if resp is not None else None
        prompt = (meta.prompt_token_count or 0) if meta else 0
        cand = (meta.candidates_token_count or 0) if meta else 0
        thoughts = (meta.thoughts_token_count or 0) if meta else 0
        cost, known = estimate_cost(model, prompt, cand + thoughts, batch=kind.endswith("-batch"))
        call = {
            "kind": kind, "model": model, "file": file, "attempt": attempt, "seconds": round(seconds, 1),
            "prompt_token_count": prompt, "candidates_token_count": cand, "thoughts_token_count": thoughts,
            "cost_usd": round(cost, 6), "price_known": known, "ok": error is None, "error": error,
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        with self.lock:
            self.calls.append(call)
            self.save()
        return call

    def save(self) -> None:
        total = round(sum(c["cost_usd"] for c in self.calls), 6)
        self.path.write_text(json.dumps({"estimated_cost_usd": total, "calls": self.calls}, indent=2) + "\n")

    def this_run(self) -> list[dict]:
        return self.calls[self.run_start:]


def describe_call(call: dict) -> str:
    price = "" if call["price_known"] else " (price unknown, costed as Pro)"
    return (f"{call['seconds']:.1f} s, tokens in {call['prompt_token_count']} / out {call['candidates_token_count']}"
            f" / thinking {call['thoughts_token_count']}, ~${call['cost_usd']:.4f}{price}")


# ---------- Gemini helpers ----------

def response_text(resp: types.GenerateContentResponse) -> str:
    text = resp.text
    if not text:
        reason = resp.candidates[0].finish_reason if resp.candidates else resp.prompt_feedback
        raise ValueError(f"empty response from model (finish reason / feedback: {reason})")
    return text


def upload_and_wait(client: genai.Client, path: Path, uploaded: list[str]) -> types.File:
    f = client.files.upload(file=path)
    uploaded.append(f.name)
    deadline = time.monotonic() + UPLOAD_TIMEOUT_S
    while True:
        state = f.state.name if f.state else "STATE_UNSPECIFIED"
        if state == "ACTIVE":
            return f
        if state == "FAILED":
            raise RuntimeError(f"Gemini could not process the upload of {path.name}: {f.error}")
        if time.monotonic() > deadline:
            raise TimeoutError(f"upload of {path.name} not ACTIVE after {UPLOAD_TIMEOUT_S} s (state {state})")
        time.sleep(2)
        f = client.files.get(name=f.name)


def format_validation_error(e: ValidationError) -> list[str]:
    lines = []
    for err in e.errors(include_url=False):
        loc = ".".join(str(p) for p in err["loc"])
        msg = err["msg"].removeprefix("Value error, ")
        # Recipe's model validator joins several problems with "; "; list them one per line.
        lines += [f"{loc}: {m}" if loc else m for m in msg.split("; ")]
    return lines


# ---------- extraction ----------

def offset_events(chunk: ChunkOutput, i: int, session: dict, ai: dict, media_dur: int) -> list[dict]:
    base = session["offset_s"] + ai["start_in_file_s"]
    limit = min(session["offset_s"] + session["duration_s"], math.floor(base + ai["duration_s"]), media_dur)
    events = []
    for ev in chunk.events:
        d = ev.model_dump(exclude_none=True)
        if not d.get("ingredients"):
            d.pop("ingredients", None)
        end = min(round(base + ev.end_s), limit)
        d["start_s"], d["end_s"] = min(round(base + ev.start_s), end), end
        d["file"] = i
        events.append(d)
    return events


def load_raw_chunk(text: str) -> ChunkOutput:
    """Raw chunks are MM:SS (TimedChunkOutput); older cached ones were plain seconds."""
    try:
        return TimedChunkOutput.model_validate_json(text).to_seconds()
    except ValidationError:
        return ChunkOutput.model_validate_json(text)


def late_events(chunk: ChunkOutput, clip_len: float) -> list[str]:
    return [f"{ev.type} {ev.start_s}-{ev.end_s}" for ev in chunk.events if ev.end_s > clip_len + 2]


def extract_config(cfg: dict) -> types.GenerateContentConfig:
    """The extraction config, shared by the sync and batch paths so both ask for exactly the same thing."""
    return types.GenerateContentConfig(
        response_mime_type="application/json", response_schema=TimedChunkOutput,
        temperature=0.2, media_resolution=cfg["media_resolution"])


def delete_uploaded(client: genai.Client, names: list[str], tag: str) -> None:
    for name in names:
        try:
            client.files.delete(name=name)
        except Exception as e:  # noqa: BLE001 - cleanup only
            log(f"{tag} warning: could not delete uploaded file {name}: {e}")


class Extraction:
    """One AI file: its prompt, cache, response validation, offsets and result. The sync path (extract_one)
    and the batch path (extract_batch) both go through accept(), so they validate and cache identically.

    A response with events ending after the clip is retried once with the error fed back; if the retry
    still has some, only those events are dropped (and reported). Any other failure twice -> whole file
    reported as not processed."""

    def __init__(self, cfg: dict, i: int, n: int, session: dict, ai: dict, out_dir: Path, media_dur: int,
                 usage: Usage, manifest: dict | None = None):
        self.cfg, self.i, self.session, self.ai, self.media_dur, self.usage = cfg, i, session, ai, media_dur, usage
        self.work = out_dir / "work"
        self.path = out_dir / ai["path"]
        self.clip_len = ai["duration_s"]
        self.base_s = session["offset_s"] + ai["start_in_file_s"]
        self.raw_path = self.work / f"chunk_{i:02d}.raw.json"
        self.offset_path = self.work / f"chunk_{i:02d}.offset.json"
        self.tag = f"[extract {i}/{n} {self.path.name}]"
        clip_s = math.floor(self.clip_len)
        m = manifest or {}
        self.base_prompt = EXTRACT_PROMPT.format(
            i=i, n=n, clip_mmss=f"{clip_s // 60:02d}:{clip_s % 60:02d}",
            context=context(m.get("language"), m.get("homie_log"), self.base_s, self.clip_len, m.get("live")))
        self.prompt = self.base_prompt  # gains EXTRACT_RETRY_SUFFIX after a rejected answer
        self.error = "unknown error"

    def gap(self, error: str) -> dict:
        return {"file": self.ai["path"], "chunk": self.i, "start_s": round(self.base_s),
                "end_s": min(round(self.base_s + self.clip_len), self.media_dur), "error": error}

    def finish(self, chunk: ChunkOutput, how: str) -> dict:
        """Returns {"events": [...], "not_processed": [...]} and writes work/chunk_NN.offset.json."""
        late = late_events(chunk, self.clip_len)
        gaps = []
        if late:
            reason = f"dropped events ending after the clip ({self.clip_len:.0f} s): {', '.join(late)}"
            log(f"{self.tag} {reason}")
            gaps.append(self.gap(reason))
            chunk = ChunkOutput(chunk_index=chunk.chunk_index,
                                events=[ev for ev in chunk.events if ev.end_s <= self.clip_len + 2])
        events = offset_events(chunk, self.i, self.session, self.ai, self.media_dur)
        self.offset_path.write_text(json.dumps({"chunk_index": self.i, "events": events}, indent=2,
                                               ensure_ascii=False) + "\n")
        log(f"{self.tag} {how}: {len(events)} events")
        return {"events": events, "not_processed": gaps}

    def cached(self, force: bool) -> dict | None:
        """The result from work/chunk_NN.raw.json, or None after clearing stale files for a fresh extraction."""
        if self.raw_path.exists() and not force:
            try:
                return self.finish(load_raw_chunk(self.raw_path.read_text()), "cached")
            except (ValidationError, ValueError) as e:
                log(f"{self.tag} cached result invalid, re-extracting: {e}")
        for old in (self.raw_path, self.offset_path, *self.work.glob(f"chunk_{self.i:02d}.failed*.json")):
            old.unlink(missing_ok=True)  # never leave a stale result next to a failed re-extraction
        return None

    def accept(self, attempt: int, kind: str, seconds: float, resp: types.GenerateContentResponse | None,
               exc: Exception | None = None, billed: bool = True) -> dict | None:
        """Validate one attempt's response (or the exception that replaced it) and record its usage.
        Returns the result, or None after logging the failure; a rejected answer is fed back in self.prompt."""
        model = self.cfg["extract_model"]
        text = None
        try:
            if exc is not None:
                raise exc
            text = response_text(resp)
            chunk = TimedChunkOutput.model_validate_json(text).to_seconds()
            late = late_events(chunk, self.clip_len)
            if late and attempt == 1:
                raise ValueError(f"events end after the clip ({self.clip_len:.0f} s): {', '.join(late)}")
        except Exception as e:  # noqa: BLE001 - any failure gets one retry, then is logged as not processed
            self.error = f"{type(e).__name__}: {e}"
            if billed:
                call = self.usage.add(kind, model, self.ai["path"], attempt, seconds, resp, self.error[:2000])
                log(f"{self.tag} attempt {attempt} failed after {describe_call(call)}: {self.error[:500]}")
            else:
                log(f"{self.tag} attempt {attempt} failed: {self.error[:500]}")
            if text is not None:
                (self.work / f"chunk_{self.i:02d}.failed{attempt}.json").write_text(text)
                self.prompt = self.base_prompt + EXTRACT_RETRY_SUFFIX.format(error=self.error[:2000])
            return None

        call = self.usage.add(kind, model, self.ai["path"], attempt, seconds, resp)
        log(f"{self.tag} attempt {attempt}{' (batch)' if kind == 'extract-batch' else ''}: {describe_call(call)}")
        if kind == "extract" and seconds > FLASH_HINT_S and "flash" not in model:
            log(f"{self.tag} hint: extraction took > {FLASH_HINT_S} s; set GEMINI_EXTRACT_MODEL to a Flash model "
                "(e.g. gemini-3.8-flash) to speed it up")
        self.raw_path.write_text(json.dumps(json.loads(text), indent=2, ensure_ascii=False) + "\n")
        return self.finish(chunk, "extracted")

    def not_processed(self) -> dict:
        gap = self.gap(self.error)
        log(f"{self.tag} NOT PROCESSED ({gap['start_s']}-{gap['end_s']} s): {self.error[:500]}")
        return {"events": [], "not_processed": [gap]}


def extract_sync(client: genai.Client, job: Extraction, attempts: tuple[int, ...], uploaded: list[str],
                 gemini_file: types.File | None = None) -> dict | None:
    """Synchronous generate_content attempts for one file (uploading it first if needed)."""
    for attempt in attempts:
        resp, exc, t0 = None, None, time.monotonic()
        try:
            if gemini_file is None:
                gemini_file = upload_and_wait(client, job.path, uploaded)
                log(f"{job.tag} uploaded in {time.monotonic() - t0:.1f} s")
            t0 = time.monotonic()
            resp = client.models.generate_content(
                model=job.cfg["extract_model"], contents=[gemini_file, job.prompt], config=extract_config(job.cfg))
        except Exception as e:  # noqa: BLE001 - handled (and retried) like an invalid answer
            exc = e
        result = job.accept(attempt, "extract", time.monotonic() - t0, resp, exc, billed=gemini_file is not None)
        if result is not None:
            return result
    return None


def extract_one(client: genai.Client, cfg: dict, i: int, n: int, session: dict, ai: dict,
                out_dir: Path, media_dur: int, usage: Usage, force: bool, manifest: dict | None = None) -> dict:
    """Returns {"events": [...], "not_processed": [...]}. Never raises."""
    job = Extraction(cfg, i, n, session, ai, out_dir, media_dur, usage, manifest)
    result = job.cached(force)
    if result is not None:
        return result
    uploaded: list[str] = []
    try:
        result = extract_sync(client, job, (1, 2), uploaded)
    finally:
        delete_uploaded(client, uploaded, job.tag)
    return result or job.not_processed()


# ---------- extraction via the Batch API ----------

def run_batch_job(client: genai.Client, cfg: dict, jobs: list[Extraction], files: dict[int, types.File],
                  timeout_s: float, display_name: str) -> tuple[dict[int, tuple], float, str | None]:
    """Submit one inline-request batch job (one request per file, same prompt & config as the sync path)
    and poll it to a terminal state. Returns ({file index: (response, error)}, wall seconds, job error).
    Cancels the job on timeout or Ctrl-C so it does not keep running (and billing) unattended."""
    requests = [types.InlinedRequest(contents=[files[job.i], job.prompt], metadata={"file": str(job.i)},
                                     config=extract_config(cfg)) for job in jobs]
    t0 = time.monotonic()
    try:
        bj = client.batches.create(model=cfg["extract_model"], src=requests,
                                   config=types.CreateBatchJobConfig(display_name=display_name))
    except Exception as e:  # noqa: BLE001 - every file falls back to the synchronous retry
        return {}, time.monotonic() - t0, f"batch job not created: {type(e).__name__}: {e}"
    log(f"[batch] submitted {bj.name} ({len(requests)} request(s), {cfg['extract_model']}); "
        f"polling every {BATCH_POLL_S} s, timeout {timeout_s / 3600:.1f} h")
    state = None
    try:
        while True:
            new = bj.state.name if bj.state else "JOB_STATE_UNSPECIFIED"
            if new != state:
                state = new
                log(f"[batch] {bj.name}: {state} at {time.monotonic() - t0:.0f} s")
            if state in BATCH_DONE:
                break
            if time.monotonic() - t0 > timeout_s:
                raise TimeoutError(f"batch job still {state} after {timeout_s:.0f} s")
            time.sleep(BATCH_POLL_S)
            try:
                bj = client.batches.get(name=bj.name)
            except Exception as e:  # noqa: BLE001 - a failed poll is not a failed job; poll again
                log(f"[batch] poll failed, will retry: {type(e).__name__}: {e}")
    except BaseException as e:
        try:
            client.batches.cancel(name=bj.name)
            log(f"[batch] cancelled {bj.name}")
        except Exception as ce:  # noqa: BLE001
            log(f"[batch] warning: could not cancel {bj.name}: {ce}")
        if not isinstance(e, Exception):
            raise  # Ctrl-C
        return {}, time.monotonic() - t0, f"{type(e).__name__}: {e} (job cancelled)"
    seconds = time.monotonic() - t0
    if state not in ("JOB_STATE_SUCCEEDED", "JOB_STATE_PARTIALLY_SUCCEEDED"):
        return {}, seconds, f"batch job ended {state}: {bj.error}"
    out = (bj.dest.inlined_responses if bj.dest else None) or []
    responses: dict[int, tuple] = {}
    for k, r in enumerate(out):
        meta = r.metadata or {}
        i = int(meta["file"]) if "file" in meta else (jobs[k].i if k < len(jobs) else None)
        if i is not None:  # responses come back in request order; metadata confirms it
            responses[i] = (r.response, f"batch request failed: {r.error}" if r.error else None)
    return responses, seconds, None if out else f"batch job {state} but returned no responses"


def extract_batch(client: genai.Client, cfg: dict, jobs: list[Extraction], force: bool, timeout_s: float,
                  display_name: str) -> list[dict]:
    """Batch-mode extraction: upload every uncached file, run ONE batch job (attempt 1, Batch API price),
    then give each file that failed or came back invalid one synchronous retry (attempt 2), exactly like
    the sync path's retry. Uploaded files are deleted at the end."""
    results = {job.i: r for job in jobs if (r := job.cached(force)) is not None}
    todo = [job for job in jobs if job.i not in results]
    if not todo:
        return [results[job.i] for job in jobs]
    uploaded: list[str] = []
    files: dict[int, types.File] = {}
    try:
        def upload(job: Extraction) -> types.File:
            t0 = time.monotonic()
            f = upload_and_wait(client, job.path, uploaded)
            log(f"{job.tag} uploaded in {time.monotonic() - t0:.1f} s")
            return f

        with ThreadPoolExecutor(max_workers=min(len(todo), MAX_WORKERS)) as pool:
            futures = {job.i: pool.submit(upload, job) for job in todo}
        for job in todo:
            try:
                files[job.i] = futures[job.i].result()
            except Exception as e:  # noqa: BLE001 - counts as attempt 1; the sync retry uploads again
                job.accept(1, "extract-batch", 0.0, None, e, billed=False)

        batched = [job for job in todo if job.i in files]
        if batched:
            responses, seconds, job_error = run_batch_job(client, cfg, batched, files, timeout_s, display_name)
            if job_error:
                log(f"[batch] {job_error}")
            for job in batched:
                resp, err = responses.get(job.i, (None, job_error or "no response for this file in the batch"))
                result = job.accept(1, "extract-batch", seconds, resp, RuntimeError(err) if err else None)
                if result is not None:
                    results[job.i] = result

        retry = [job for job in todo if job.i not in results]
        if retry:
            log(f"[batch] {len(retry)} file(s) failed or invalid in the batch; one synchronous retry each")
            with ThreadPoolExecutor(max_workers=min(len(retry), MAX_WORKERS)) as pool:
                futures = {job.i: pool.submit(extract_sync, client, job, (2,), uploaded, files.get(job.i))
                           for job in retry}
            for job in retry:
                results[job.i] = futures[job.i].result() or job.not_processed()
    finally:
        delete_uploaded(client, uploaded, "[batch]")
    return [results[job.i] for job in jobs]


# ---------- merge ----------

def sessions_for_prompt(sessions: list[dict], dates_trusted: bool = True) -> list[dict]:
    """dates_trusted=False (clips reordered by content) leaves every gap unknown: the file dates are wrong."""
    out, prev_end = [], None
    for s in sessions:
        try:
            start = datetime.fromisoformat(s["recorded_at"]) if s.get("recorded_at") else None
        except ValueError:
            start = None
        gap = round((start - prev_end).total_seconds() / 60) if start and prev_end and dates_trusted else None
        if gap is not None and gap < 0:
            gap = None  # overlapping file dates: no real gap to report
        prev_end = start + timedelta(seconds=s["duration_s"]) if start else None
        out.append({"index": s["index"], "recorded_at": s.get("recorded_at"), "offset_s": s["offset_s"],
                    "duration_s": s["duration_s"], "gap_before_min": gap})
    return out


def build_recipe(draft: RecipeDraft, manifest: dict) -> dict:
    d = draft.model_dump(mode="json")
    steps = []
    for s in d["steps"]:
        s["story_ids"] = [st["id"] for st in d["stories"] if st["step"] == s["order"]]
        s["special_ids"] = [sp["id"] for sp in d["special"] if sp["step"] == s["order"]]
        steps.append(s)
    return {
        "id": manifest["id"],
        # The title given to prep.py wins over the model's; a Convex upload has none, so the model names it.
        "title": manifest["title"] or d["title"],
        "cook": {"name": manifest["cook"], "relation": manifest["relation"]},
        "language": manifest.get("language"),
        "intro": d["intro"],
        "servings": d["servings"],
        "total_time": d["total_time"],
        "sample": bool(manifest.get("sample", False)),  # YouTube recipes: real media, marked as samples
        "source": manifest.get("source"),
        "tags": d["tags"],
        # Relative names; publish.py rewrites them to public URLs.
        "media": {"video_url": "play.mp4", "audio_url": "voice.m4a", "poster_url": "poster.jpg",
                  "duration_s": manifest["duration_s"]},
        "sessions": [{k: s[k] for k in ("index", "recorded_at", "offset_s", "duration_s")}
                     for s in manifest["sessions"]],
        "ingredients": d["ingredients"],
        "steps": steps,
        "stories": d["stories"],
        "special": d["special"],
        "follow_up_questions": d["follow_up_questions"],
    }


NO_TITLE = "(no title yet: name the main dish shown, in a few plain words, as the recipe's title)"


def merge(w: writer.GeminiWriter | writer.MuseWriter, manifest: dict, events: list[dict], n_files: int,
          out_dir: Path, usage: Usage, extra: str = "", tag: str = "merge") -> Recipe:
    """extra is appended to the merge prompt (ensure_coverage's retry); tag labels the log lines."""
    base_prompt = MERGE_PROMPT.format(
        n=n_files, title=json.dumps(manifest["title"], ensure_ascii=False) if manifest["title"] else NO_TITLE,
        duration_s=manifest["duration_s"],
        sessions=json.dumps(sessions_for_prompt(manifest["sessions"],
                                                not (manifest.get("order") or {}).get("reordered")),
                            separators=(",", ":")),
        events=json.dumps(events, separators=(",", ":"), ensure_ascii=False),
        context=context(manifest.get("language"), manifest.get("homie_log"), live=manifest.get("live"))) + extra
    prompt, errors, saved, model = base_prompt, ["no attempt made"], None, w.model
    tag = f"{tag} {w.name}"
    for attempt in (1, 2):
        resp, text, candidate, t0 = None, None, None, time.monotonic()
        try:
            resp = w.generate(prompt, RecipeDraft)
            seconds = time.monotonic() - t0
            text = response_text(resp)
            draft = RecipeDraft.model_validate_json(text)
            candidate = build_recipe(draft, manifest)
            recipe = Recipe.model_validate(candidate)
        except ValidationError as e:
            errors = format_validation_error(e)
        except Exception as e:  # noqa: BLE001 - API/network errors also get one retry
            errors = [f"{type(e).__name__}: {e}"]
        else:
            call = usage.add("merge", model, None, attempt, seconds, resp)
            log(f"[{tag}] attempt {attempt}: {describe_call(call)}")
            return recipe

        call = usage.add("merge", model, None, attempt, time.monotonic() - t0, resp, "; ".join(errors)[:2000])
        log(f"[{tag}] attempt {attempt} rejected ({describe_call(call)}):")
        for line in errors:
            log(f"    - {line}")
        if text is not None:
            prompt = base_prompt + MERGE_RETRY_SUFFIX.format(errors="\n".join(f"- {x}" for x in errors), previous=text)
            if candidate is None:  # the model's JSON did not even parse as a RecipeDraft
                try:
                    candidate = json.loads(text)
                except json.JSONDecodeError:
                    candidate = {"raw_model_output": text}
            saved = candidate
        else:
            prompt = base_prompt

    invalid = out_dir / "recipe.invalid.json"
    invalid.write_text(json.dumps(saved or {"errors": errors}, indent=2, ensure_ascii=False) + "\n")
    hint = (f"the last attempt is saved in {invalid}; fix it by hand, validate with "
            f"`python pipeline/schema.py {invalid}`, then save it as recipe.json") if saved else f"errors saved in {invalid}"
    raise ProcessError(f"merge failed twice ({hint}):\n" + "\n".join(f"  - {x}" for x in errors))


def ensure_coverage(w: writer.GeminiWriter | writer.MuseWriter, manifest: dict, events: list[dict], n_files: int,
                    out_dir: Path, usage: Usage, recipe: Recipe, gap_s: int = coverage.GAP_S) -> tuple[Recipe, dict]:
    """No step the extraction found may vanish in the merge. If the recipe leaves some out, merge once more
    with them listed and keep the answer only if it misses fewer. Never drops silently: what is still
    missing stays in the returned report (summarize warns about it) and in work/coverage.json."""
    report = coverage.check(events, [s.model_dump() for s in recipe.steps], gap_s)
    first_missing = report["missing"]
    if first_missing:
        log(f"[coverage] the merge left out {len(first_missing)} extracted step(s); merging once more with them:")
        for ev in first_missing:
            log(f"    - {coverage.line(ev)}")
        previous = RecipeDraft.model_validate(recipe.model_dump(mode="json")).model_dump_json()
        extra = COVERAGE_RETRY_SUFFIX.format(missing=coverage.retry_lines(first_missing), previous=previous)
        try:
            retried = merge(w, manifest, events, n_files, out_dir, usage, extra, tag="merge coverage retry")
        except ProcessError:  # merge() already logged why each attempt was rejected
            log("[coverage] the retry failed; keeping the first recipe")
        else:
            again = coverage.check(events, [s.model_dump() for s in retried.steps], gap_s)
            if len(again["missing"]) < len(first_missing):
                recipe, report = retried, again
                log(f"[coverage] the retry recovered {len(first_missing) - len(again['missing'])} step(s)")
            else:
                log("[coverage] the retry recovered no step; keeping the first recipe")
        report["missing_before_retry"] = first_missing
    (out_dir / "work" / "coverage.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return recipe, report


# ---------- main ----------

def load_config() -> dict:
    load_dotenv(ROOT / ".env")  # does not override variables already set in the environment
    if not os.environ.get("GEMINI_API_KEY"):
        raise ProcessError("GEMINI_API_KEY is not set (add it to .env)")
    model = os.environ.get("GEMINI_MODEL") or "gemini-3.1-pro-preview"
    res = (os.environ.get("GEMINI_MEDIA_RESOLUTION") or "MEDIA_RESOLUTION_LOW").strip().upper()
    if not res.startswith("MEDIA_RESOLUTION_"):
        res = f"MEDIA_RESOLUTION_{res}"
    try:
        media_resolution = types.MediaResolution(res)
    except ValueError:
        raise ProcessError(f"GEMINI_MEDIA_RESOLUTION={res!r} is not one of {[m.value for m in types.MediaResolution]}")
    extract_model = os.environ.get("GEMINI_EXTRACT_MODEL") or model
    gap = os.environ.get("COVERAGE_GAP_S") or str(coverage.GAP_S)
    if not gap.strip().isdigit() or int(gap) <= 0:
        raise ProcessError(f"COVERAGE_GAP_S={gap!r} must be a whole number of seconds above 0")
    return {"merge_model": model, "extract_model": extract_model,
            "order_model": extract_model if "flash" in extract_model.lower() else ORDER_MODEL,
            "media_resolution": media_resolution, "coverage_gap_s": int(gap)}


def order_asker(client: genai.Client, model: str, usage: Usage):
    """The clip-order model call for order.order_sessions: text only, JSON schema, one retry.
    Returns None (no model opinion) when both attempts fail."""
    def ask(prompt: str, ids: list[int]) -> order.OrderAnswer | None:
        for attempt in (1, 2):
            resp, t0 = None, time.monotonic()
            try:
                resp = client.models.generate_content(
                    model=model, contents=prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json",
                                                       response_schema=order.OrderAnswer, temperature=0))
                answer = order.parse_answer(response_text(resp), ids)
            except Exception as e:  # noqa: BLE001 - any failure: retry once, then fall back to keywords
                call = usage.add("order", model, None, attempt, time.monotonic() - t0, resp,
                                 f"{type(e).__name__}: {e}"[:2000])
                log(f"[order] attempt {attempt} failed ({describe_call(call)}): {type(e).__name__}: {e}"[:600])
                continue
            call = usage.add("order", model, None, attempt, time.monotonic() - t0, resp)
            log(f"[order] {model}: {answer.order} ({answer.confidence}), {describe_call(call)}")
            return answer
        return None
    return ask


def summarize(recipe: Recipe, not_processed: list[dict], usage: Usage, cover: dict | None = None) -> None:
    log(f"\n{len(recipe.steps)} steps, {len(recipe.stories)} stories, {len(recipe.special)} specials, "
        f"{len(recipe.ingredients)} ingredients, {len(recipe.follow_up_questions)} questions "
        f"(video {recipe.media.duration_s} s)")
    for s in recipe.steps:
        extras = "".join(f" [{x}]" for x in s.story_ids + s.special_ids)
        log(f"  {s.order:>2}. {s.start_s}-{s.end_s} s  {s.title}{extras}")
    if not_processed:
        log("NOT PROCESSED (steps may be missing from these ranges; details in work/not_processed.json):")
        for g in not_processed:
            log(f"  {g['start_s']}-{g['end_s']} s  {g['file']}: {g['error'][:200]}")
    run_calls = usage.this_run()
    tokens = sum(c["prompt_token_count"] + c["candidates_token_count"] + c["thoughts_token_count"] for c in run_calls)
    run_cost = sum(c["cost_usd"] for c in run_calls)
    total_cost = sum(c["cost_usd"] for c in usage.calls)
    log(f"Models this run: {len(run_calls)} calls, {tokens} tokens, ~${run_cost:.4f}"
        f" (all runs for this recipe: ~${total_cost:.4f}; details in work/usage.json)")
    if cover:  # last, so a dropped step is hard to miss
        for line in coverage.warnings(cover):
            log(line)


def write_recipe(w: writer.GeminiWriter | writer.MuseWriter, fallback: writer.GeminiWriter, manifest: dict,
                 events: list[dict], n: int, out_dir: Path, usage: Usage, gap_s: int) -> tuple[Recipe, dict]:
    """The writing step: merge + coverage retry with `w`; the whole step again with Gemini if Muse fails."""
    try:
        recipe = merge(w, manifest, events, n, out_dir, usage)
    except (ProcessError, writer.WriterError) as e:
        if w.name == "gemini":
            raise
        log(f"[merge] WARNING: Muse could not write the recipe ({str(e)[:300]}); falling back to Gemini")
        w = fallback
        recipe = merge(w, manifest, events, n, out_dir, usage)
    if not recipe.steps:
        raise ProcessError("the merged recipe has no steps; see work/chunk_*.offset.json")
    return ensure_coverage(w, manifest, events, n, out_dir, usage, recipe, gap_s)


COVER_PHOTO = "cover_photo.jpg"  # in work/: the cook's plate photo, kept for a later --rewrite


def make_cover(client: genai.Client, model: str, recipe: Recipe, out_dir: Path, usage: Usage) -> str:
    """poster.jpg = the cook's own plate photo (work/cover_photo.jpg) when she took one, with no frame pick.
    Else the finished dish where it looks best in the video (pipeline/cover.py). When Gemini sees no finished
    dish or the pick fails, the middle of the last step, which is usually plating or serving (the hackathon
    spec's step 2 is usually raw prep). Returns where the poster came from, for the log."""
    from pipeline import cover  # here: cover.py imports this module
    photo = out_dir / "work" / COVER_PHOTO
    if photo.exists():
        try:
            cover.use_photo(photo, out_dir / "poster.jpg")
            return "the cook's plate photo"
        except Exception as e:  # noqa: BLE001 - a broken photo: pick a frame instead
            log(f"[cover] WARNING: the cook's plate photo can't be used ({type(e).__name__}: {str(e)[:300]}); "
                f"picking a frame from the video")
    try:
        at = cover.make_cover(client, model, recipe.model_dump(mode="json"), out_dir / "play.mp4",
                              out_dir / "poster.jpg", usage)
        if at is not None:
            return f"the finished dish at {at:.1f} s"
    except Exception as e:  # noqa: BLE001 - any failure: the old cover
        log(f"[cover] WARNING: could not pick the finished dish ({type(e).__name__}: {str(e)[:300]}); "
            f"using the last step")
    last = recipe.steps[-1]
    make_poster(out_dir / "play.mp4", (last.start_s + last.end_s) / 2, out_dir / "poster.jpg")
    return f"step {last.order}"


Report = Callable[[str, float], None]  # (Convex job stage, progress 0..1 across the whole job)


def run(recipe_id: str, force: bool = False, batch: bool = False, batch_timeout_s: float = BATCH_TIMEOUT_S,
        shorten: bool = True, rewrite: bool = False, report: Report | None = None,
        language: str | None = None, homie_log: list[dict] | None = None, live: dict | None = None,
        cover_photo: Path | None = None) -> Path:
    """Extract, merge and validate one recipe. Returns the recipe.json path. Raises ProcessError on failure.
    batch=True runs the extraction as one Batch API job (half price, slower); see extract_batch.
    shorten=False skips the short substeps (pipeline/shorten.py) and their times (pipeline/align.py).
    rewrite=True writes recipe.json again from the cached extraction (no new Gemini video calls).
    report gets the worker's stages: understanding 0.2 -> 0.7 per extracted file, then writing 0.7 -> 0.95.
    language (ISO 639-1) and homie_log (Convex /worker/claim's homieLog, video seconds) come from the worker's
    job, and so does live (the glasses bridge's liveLog, liveGaps and videoGaps); they are saved in the manifest,
    so a later --rewrite keeps them. cover_photo is the cook's plate photo from an in-app recording (the worker
    downloads the claim's coverUrl); it is kept as work/cover_photo.jpg and becomes the cover (make_cover)."""
    report = report or (lambda stage, progress: None)
    out_dir = OUT_ROOT / recipe_id
    work = out_dir / "work"
    manifest_path = work / "manifest.json"
    recipe_path = out_dir / "recipe.json"
    if not manifest_path.exists():
        raise ProcessError(f"{manifest_path} not found; run prep.py --id {recipe_id} first")
    order.restore_interrupted(out_dir, log)  # a clip reorder that stopped part-way: finish or undo it first
    if recipe_path.exists() and not force and not rewrite:
        log(f"[process {recipe_id}] {recipe_path} exists; use --force to rebuild or --rewrite to re-merge")
        return recipe_path

    cfg = load_config()
    show_sdk_retries()
    manifest = json.loads(manifest_path.read_text())
    if language is not None or homie_log is not None or live is not None:
        manifest.update({k: v for k, v in (("language", language), ("homie_log", homie_log), ("live", live))
                         if v is not None})
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    if cover_photo is not None:
        shutil.copyfile(cover_photo, work / COVER_PHOTO)
    media_dur = manifest["duration_s"]
    jobs = order.chunk_jobs(manifest)  # recorded-order numbering: chunk caches survive a reorder
    n = len(jobs)
    if n == 0:
        raise ProcessError(f"{manifest_path} lists no AI files")
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                          http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS, retry_options=HTTP_RETRY))
    gemini_writer = writer.GeminiWriter(client, cfg["merge_model"])
    try:
        w = writer.choose(client, cfg["merge_model"])
    except writer.WriterError as e:
        raise ProcessError(str(e))
    log(f"[process {recipe_id}] {n} AI file(s); extract with {cfg['extract_model']} "
        f"({cfg['media_resolution'].value}{', Batch API' if batch else ''}), write with {w.name} {w.model}")
    report("understanding", 0.2)
    usage = Usage(work / "usage.json")
    t0 = time.monotonic()
    if batch:
        results = extract_batch(client, cfg, [Extraction(cfg, i, n, s, ai, out_dir, media_dur, usage, manifest)
                                              for i, (s, ai) in enumerate(jobs, 1)],
                                force, batch_timeout_s, f"homecookd-{recipe_id}")
    else:
        with ThreadPoolExecutor(max_workers=min(n, MAX_WORKERS)) as pool:
            futures = [pool.submit(extract_one, client, cfg, i, n, s, ai, out_dir, media_dur, usage, force, manifest)
                       for i, (s, ai) in enumerate(jobs, 1)]
            for done, _ in enumerate(as_completed(futures), 1):
                report("understanding", 0.2 + 0.5 * done / n)
            results = [f.result() for f in futures]
    log(f"[process {recipe_id}] extraction done in {time.monotonic() - t0:.1f} s")

    events = [e for r in results for e in r["events"]]
    not_processed = [g for r in results for g in r["not_processed"]]
    (work / "not_processed.json").write_text(json.dumps(not_processed, indent=2) + "\n")
    if not events and not_processed:
        raise ProcessError("extraction failed for every AI file; see the errors above")
    if not any(e["type"] == "step" for e in events):
        raise ProcessError(f"no steps found in any file ({len(events)} events); see work/chunk_*.raw.json")

    # Camera-roll clips can arrive out of order: put them in cooking order before the merge.
    manifest, events, not_processed = order.order_sessions(
        out_dir, manifest, events, not_processed, order_asker(client, cfg["order_model"], usage),
        model_name=cfg["order_model"], force=force, log=log)
    events.sort(key=lambda e: (e["start_s"], e["end_s"]))
    (work / "not_processed.json").write_text(json.dumps(not_processed, indent=2) + "\n")

    report("writing", 0.7)
    t_write = time.monotonic()
    recipe, cover = write_recipe(w, gemini_writer, manifest, events, n, out_dir, usage, cfg["coverage_gap_s"])
    log(f"[process {recipe_id}] writing took {time.monotonic() - t_write:.1f} s")
    report("writing", 0.85)

    poster_from = make_cover(client, cfg["extract_model"], recipe, out_dir, usage)
    recipe_path.write_text(json.dumps(recipe.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
    (out_dir / "recipe.invalid.json").unlink(missing_ok=True)
    order.cleanup(out_dir)  # the recipe matches the (possibly reordered) play.mp4; drop the old copies
    log(f"[process {recipe_id}] wrote {recipe_path} in {time.monotonic() - t0:.1f} s (poster from {poster_from})")
    if shorten:
        # Cook mode's short substeps, step ingredients & tips, then when each substep starts in the video (so
        # tapping one jumps there). A failure only warns: the app splits the instruction itself and shows
        # untimed substeps, and `shorten.py --id` / `align.py --id` can add them later.
        from pipeline.align import align_file  # here: both import this module
        from pipeline.shorten import shorten_file
        try:
            shorten_file(recipe_path, client, cfg["merge_model"], usage)
        except Exception as e:  # noqa: BLE001
            log(f"[process {recipe_id}] WARNING: no short substeps ({type(e).__name__}: {e}); "
                f"recipe.json is fine without them. Retry: python pipeline/shorten.py --id {recipe_id} --force")
        else:
            try:
                how = align_file(recipe_path, client, cfg["order_model"], usage)
                log(f"[process {recipe_id}] substep times: "
                    + ", ".join(f"step {o} {h}" for o, h in sorted(how.items())))
            except Exception as e:  # noqa: BLE001
                log(f"[process {recipe_id}] WARNING: no substep times ({type(e).__name__}: {e}); recipe.json is "
                    f"fine without them. Retry: python pipeline/align.py --id {recipe_id} --force")
    summarize(recipe, not_processed, usage, cover)
    return recipe_path


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract with Gemini, then write the recipe with Muse (or Gemini).")
    ap.add_argument("--id", required=True, help="recipe id (data/out/<id>/work/manifest.json must exist)")
    ap.add_argument("--force", action="store_true", help="re-extract and re-merge even if outputs exist")
    ap.add_argument("--batch", action="store_true",
                    help="extract via one Gemini Batch API job: half price, results within 24 h (usually sooner)")
    ap.add_argument("--batch-timeout-min", type=float, default=BATCH_TIMEOUT_S / 60,
                    help="cancel the batch job and fall back to synchronous calls after this many minutes "
                         "(default %(default).0f)")
    ap.add_argument("--no-shorten", action="store_true",
                    help="skip cook mode's short substeps and their times (add them later with shorten.py, align.py)")
    ap.add_argument("--rewrite", action="store_true",
                    help="write recipe.json again from the cached extraction (no new video calls)")
    ap.add_argument("--writer", choices=["muse", "gemini"], help="override RECIPE_WRITER for this run")
    args = ap.parse_args()
    if args.writer:
        os.environ["RECIPE_WRITER"] = args.writer
    try:
        run(args.id, force=args.force, batch=args.batch, batch_timeout_s=args.batch_timeout_min * 60,
            shorten=not args.no_shorten, rewrite=args.rewrite)
    except (ProcessError, PrepError) as e:
        sys.exit(f"process: error: {e}")


if __name__ == "__main__":
    main()
