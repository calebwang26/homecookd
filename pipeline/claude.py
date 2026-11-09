"""Claude for the pipeline's model calls. Gemini credits are nearly gone (Oct 24), so the calls move to Claude, each
behind its own flag (unset or gemini keeps Gemini, so rolling back is one line in .env):
- TEXT_PROVIDER=claude: the clip order and cook mode's short substeps on Haiku (process.order_asker, shorten.py),
  and the writer's fallback when Muse fails on Sonnet (writer.py; RECIPE_WRITER=claude also makes it the writer).
- COVER_PROVIDER=claude: the cover pick from still frames (cover.py).

ClaudeText.generate has GeminiWriter's shape and returns a Gemini-shaped reply (.text, .usage_metadata), so
process.response_text and process.Usage treat both the same. Claude's structured outputs hold the reply to the
same pydantic schema Gemini gets; images go before the prompt, each after its label. Models other than Haiku opt
into server-side fallbacks: a request the model declines is run again on Anthropic's recommended model.

A call made with batch=True goes through the Message Batches API instead: half price, but each answer waits about
2 minutes (125-147 s over 6 calls, Nov 8). Since Nov 8 (the cost cut to under $0.10 a recipe) the two big Sonnet calls
batch, the extraction and the recipe writer (process.extract_model, writer.claude_writer); the small ones don't, so a
10-minute recording adds about 4 minutes. CLAUDE_BATCH=1 batches every call (the language eval sets it), and
CLAUDE_BATCH=0 none (the rollback).

A batch call's lifecycle (BatchState; ALLOWED holds every move and BatchCall.advance refuses the rest):
    OPEN --ends in time--> ENDED --succeeded--> USED (generate returns it; the caller records it at batch price)
     |                       |---canceled, errored, expired--> UNBILLED (Anthropic bills none of these)
     |                       '---succeeded, found by reap()--> RECORDED (handed to process.Usage)
     '--the wait (CLAUDE_BATCH_WAIT_S, 5 min) runs out, or any error or stop while open--> CANCELLING --ends--> ENDED
reap() takes the OPEN batches of a killed run the same way: cancelled, then ENDED, then RECORDED or UNBILLED.
Guards: after the cancel it gets SETTLE_S to end. A succeeded answer is used even then (it is billed, so sending it
again would pay twice), a canceled one is sent again the normal way, errored and expired raise, and one still ending
goes ahead the normal way while reap() settles it later. A refusal on batch is sent again the normal way with the
server-side fallback a batch can't carry; what the refusal billed rides along (reply.billed_before) to be recorded.
Invariant: every batch that may still bill is in its run's registry (BatchRegistry, work/claude_batches.json,
written whole and renamed into place) until it is USED, UNBILLED or RECORDED. process.run reaps it when it starts and
ends, and queue_worker runs pipeline/batch_reap.py after it kills a job, so no billed answer goes uncounted.

Env (.env): ANTHROPIC_API_KEY, TEXT_PROVIDER and COVER_PROVIDER (gemini | claude), CLAUDE_TEXT_MODEL (default
claude-haiku-5-5).
"""
from __future__ import annotations

import base64
import json
import os
import threading
import time
from collections.abc import Callable, Sequence
from enum import Enum
from pathlib import Path
from types import SimpleNamespace

import anthropic
from anthropic import transform_schema
from pydantic import BaseModel

MODEL = "claude-haiku-5-5"
MAX_TOKENS = 64_000  # streamed, so a long recipe's reply never hits an HTTP timeout
RETRIES = 4  # the SDK backs off on 429 / 5xx; a burst of rate limits shouldn't end a recording's run
BATCH_POLL_S, BATCH_WAIT_S = 5, 300
# How long a cancelled batch gets to end: in the call and process.run's reaps (a live cancel took 21-33 s, Nov 8),
# and in batch_reap.py, inside queue_worker's REAP_TIMEOUT_S.
SETTLE_S, REAP_S = 60, 25
BATCHES = "claude_batches.json"  # the registry, in a recipe's work/


class ClaudeError(RuntimeError):
    pass


class BatchState(str, Enum):
    OPEN = "open"
    CANCELLING = "cancelling"
    ENDED = "ended"
    USED = "used"
    UNBILLED = "unbilled"
    RECORDED = "recorded"


S = BatchState
ALLOWED = {(S.OPEN, S.ENDED), (S.OPEN, S.CANCELLING), (S.CANCELLING, S.ENDED),
           (S.ENDED, S.USED), (S.ENDED, S.UNBILLED), (S.ENDED, S.RECORDED)}
DONE = {S.USED, S.UNBILLED, S.RECORDED}


class BatchRegistry:
    """{batch id: {"state", "model"}} for every batch that may still bill, one JSON file written whole and renamed."""

    def __init__(self, path: Path):
        self.path, self.lock = Path(path), threading.Lock()

    def read(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

    def put(self, batch_id: str, entry: dict | None) -> None:
        with self.lock:
            batches = self.read()
            if entry is None:
                batches.pop(batch_id, None)
            else:
                batches[batch_id] = entry
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(batches))
            tmp.replace(self.path)


class BatchCall:
    def __init__(self, batch_id: str, model: str, registry: BatchRegistry | None, state: BatchState = S.OPEN):
        self.id, self.model, self.registry, self.state = batch_id, model, registry, state
        self._save()

    def advance(self, to: BatchState) -> None:
        if (self.state, to) not in ALLOWED:
            raise ClaudeError(f"batch {self.id}: {self.state.value} -> {to.value} is not allowed")
        self.state = to
        self._save()

    def _save(self) -> None:
        if self.registry is not None:
            self.registry.put(self.id, None if self.state in DONE else {"state": self.state.value, "model": self.model})


def settle(client, call: BatchCall, wait_s: float) -> None:
    """Cancels an OPEN batch and gives it wait_s to end. Never raises: a batch still ending stays CANCELLING."""
    if call.state is S.OPEN:
        try:
            client.messages.batches.cancel(call.id)
        except Exception:  # noqa: BLE001 - it already ended, or the API is down: the checks below (or reap) see
            pass
        call.advance(S.CANCELLING)
    deadline = time.monotonic() + wait_s
    while call.state is S.CANCELLING:
        try:
            if client.messages.batches.retrieve(call.id).processing_status == "ended":
                call.advance(S.ENDED)
                return
        except Exception:  # noqa: BLE001
            return
        if time.monotonic() >= deadline:
            return
        time.sleep(BATCH_POLL_S)


def result_of(client, call: BatchCall):
    return next(iter(client.messages.batches.results(call.id))).result


def reply_of(msg, batched: bool, model: str | None = None, **more) -> SimpleNamespace:
    """A Gemini-shaped reply (.text, .usage_metadata) for process.response_text and process.Usage."""
    use = msg.usage
    details = getattr(use, "output_tokens_details", None)
    thinking = (details.thinking_tokens if details else 0) or 0
    meta = SimpleNamespace(
        prompt_token_count=use.input_tokens + (use.cache_read_input_tokens or 0)
        + (use.cache_creation_input_tokens or 0),
        candidates_token_count=max(use.output_tokens - thinking, 0), thoughts_token_count=thinking)
    text = "".join(b.text for b in msg.content if b.type == "text")
    return SimpleNamespace(text=text, usage_metadata=meta, candidates=None, prompt_feedback=msg.stop_reason,
                           batch=batched, model=model, **more)


def reap(path: Path, record: Callable[[SimpleNamespace], None], client=None, wait_s: float = REAP_S) -> int:
    """Settles every batch the registry at `path` still lists: open ones are cancelled, all get wait_s to end, and
    each that ended with a billed answer goes to record() (a reply with .model) before it leaves the registry.
    Returns how many were recorded. One still ending stays listed for the next reap."""
    registry = BatchRegistry(path)
    listed = registry.read()
    if not listed:
        return 0
    if client is None:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"), max_retries=RETRIES)
    calls = [BatchCall(i, e.get("model") or "", registry, S(e["state"])) for i, e in listed.items()]
    deadline = time.monotonic() + wait_s
    while True:
        for call in calls:
            if call.state in (S.OPEN, S.CANCELLING):
                settle(client, call, 0)
        if all(c.state not in (S.OPEN, S.CANCELLING) for c in calls) or time.monotonic() >= deadline:
            break
        time.sleep(BATCH_POLL_S)
    recorded = 0
    for call in calls:
        if call.state is not S.ENDED:
            continue
        try:
            result = result_of(client, call)
        except Exception:  # noqa: BLE001 - left listed for the next reap
            continue
        if result.type == "succeeded":
            record(reply_of(result.message, True, call.model))
            call.advance(S.RECORDED)
            recorded += 1
        else:
            call.advance(S.UNBILLED)
    return recorded


def provider(flag: str = "TEXT_PROVIDER") -> str:
    """gemini or claude, from the env var `flag`. Call after .env is loaded."""
    want = (os.environ.get(flag) or "gemini").strip().lower()
    if want not in ("gemini", "claude"):
        raise ClaudeError(f"{flag}={want!r} must be gemini or claude")
    return want


def text_model() -> str:
    return os.environ.get("CLAUDE_TEXT_MODEL") or MODEL


class ClaudeText:
    name = "claude"

    def __init__(self, model: str | None = None, effort: str = "medium", system: str | None = None,
                 client: anthropic.Anthropic | None = None, batch: bool = False):
        self.batches: BatchRegistry | None = None  # process.run sets its run's registry
        if client is None:
            key = os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                raise ClaudeError("ANTHROPIC_API_KEY is not set (add it to .env, or set TEXT_PROVIDER=gemini)")
            client = anthropic.Anthropic(api_key=key, max_retries=RETRIES)
        self.client, self.model, self.effort, self.system = client, model or text_model(), effort, system
        want = (os.environ.get("CLAUDE_BATCH") or "").strip()
        self.batch = want == "1" or (batch and want != "0")

    def generate(self, prompt: str, schema: type[BaseModel], temperature: float | None = None,
                 images: Sequence[tuple[str, bytes]] = ()) -> SimpleNamespace:
        """One structured call; images are (label, JPEG bytes). temperature is ignored: current Claude models
        only take their default."""
        content: list[dict] = []
        for label, jpeg in images:
            content += [{"type": "text", "text": label},
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                     "data": base64.b64encode(jpeg).decode()}}]
        content.append({"type": "text", "text": prompt})
        extra = {"system": self.system} if self.system else {}
        msg = self._batched(content, schema, extra) if self.batch else None
        billed_before = []
        if msg is not None and msg.stop_reason == "refusal" and self.model != MODEL:
            # A batch can't carry the server-side fallback: the normal way can. The refusal was billed all the same.
            billed_before.append(reply_of(msg, True, error="refused on batch; sent again with the fallback"))
            msg = None
        batched = msg is not None
        if msg is None:
            if self.model != MODEL:  # Haiku has no server-side fallback
                extra.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            with self.client.beta.messages.stream(model=self.model, max_tokens=MAX_TOKENS, output_format=schema,
                                                  output_config={"effort": self.effort},
                                                  messages=[{"role": "user", "content": content}], **extra) as stream:
                msg = stream.get_final_message()
        if msg.stop_reason == "max_tokens":
            raise ClaudeError(f"Claude stopped at its output limit ({msg.usage.output_tokens} tokens)")
        if msg.stop_reason == "refusal":
            raise ClaudeError(f"Claude declined: {getattr(msg.stop_details, 'category', None)}")
        return reply_of(msg, batched, billed_before=billed_before)

    def _batched(self, content: list[dict], schema: type[BaseModel], extra: dict):
        """The call as a one-request Message Batch (half price): its message, or None to send it the normal way (it
        was cancelled before it ran, or is still ending). Raises when the request failed. The lifecycle: the module
        docstring."""
        params = {"model": self.model, "max_tokens": MAX_TOKENS, "messages": [{"role": "user", "content": content}],
                  "output_config": {"effort": self.effort,
                                    "format": {"type": "json_schema", "schema": transform_schema(schema)}}, **extra}
        batch = self.client.messages.batches.create(requests=[{"custom_id": "call", "params": params}])
        call = BatchCall(batch.id, self.model, self.batches)
        try:
            deadline = time.monotonic() + float(os.environ.get("CLAUDE_BATCH_WAIT_S") or BATCH_WAIT_S)
            while call.state is S.OPEN:
                if self.client.messages.batches.retrieve(batch.id).processing_status == "ended":
                    call.advance(S.ENDED)
                elif time.monotonic() > deadline:
                    settle(self.client, call, SETTLE_S)
                else:
                    time.sleep(BATCH_POLL_S)
            if call.state is not S.ENDED:
                return None
            result = result_of(self.client, call)
        except BaseException:
            settle(self.client, call, 0)  # stop what it may still bill; reap() records it if it already did
            raise
        if result.type == "succeeded":
            call.advance(S.USED)
            return result.message
        call.advance(S.UNBILLED)
        if result.type == "canceled":
            return None
        raise ClaudeError(f"batch request {result.type}: {getattr(result, 'error', None)}")
