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
CLAUDE_BATCH=0 none (the rollback). A batch request can't carry server-side fallbacks, and one still waiting after
CLAUDE_BATCH_WAIT_S (default 5 min) is cancelled and sent the normal way.

Env (.env): ANTHROPIC_API_KEY, TEXT_PROVIDER and COVER_PROVIDER (gemini | claude), CLAUDE_TEXT_MODEL (default
claude-haiku-5-5).
"""
from __future__ import annotations

import base64
import os
import time
from collections.abc import Sequence
from types import SimpleNamespace

import anthropic
from anthropic import transform_schema
from pydantic import BaseModel

MODEL = "claude-haiku-5-5"
MAX_TOKENS = 64_000  # streamed, so a long recipe's reply never hits an HTTP timeout
RETRIES = 4  # the SDK backs off on 429 / 5xx; a burst of rate limits shouldn't end a recording's run
BATCH_POLL_S, BATCH_WAIT_S = 5, 300


class ClaudeError(RuntimeError):
    pass


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
        use = msg.usage
        details = getattr(use, "output_tokens_details", None)
        thinking = (details.thinking_tokens if details else 0) or 0
        meta = SimpleNamespace(
            prompt_token_count=use.input_tokens + (use.cache_read_input_tokens or 0)
            + (use.cache_creation_input_tokens or 0),
            candidates_token_count=max(use.output_tokens - thinking, 0), thoughts_token_count=thinking)
        text = "".join(b.text for b in msg.content if b.type == "text")
        return SimpleNamespace(text=text, usage_metadata=meta, candidates=None, prompt_feedback=msg.stop_reason,
                               batch=batched)

    def _batched(self, content: list[dict], schema: type[BaseModel], extra: dict):
        """The call as a one-request Message Batch (half price): the message, or None when it is still waiting
        after CLAUDE_BATCH_WAIT_S (cancelled; the caller sends it the normal way). Raises when the request fails."""
        params = {"model": self.model, "max_tokens": MAX_TOKENS, "messages": [{"role": "user", "content": content}],
                  "output_config": {"effort": self.effort,
                                    "format": {"type": "json_schema", "schema": transform_schema(schema)}}, **extra}
        batch = self.client.messages.batches.create(requests=[{"custom_id": "call", "params": params}])
        deadline = time.monotonic() + float(os.environ.get("CLAUDE_BATCH_WAIT_S") or BATCH_WAIT_S)
        while self.client.messages.batches.retrieve(batch.id).processing_status != "ended":
            if time.monotonic() > deadline:
                self.client.messages.batches.cancel(batch.id)
                return None
            time.sleep(BATCH_POLL_S)
        result = next(iter(self.client.messages.batches.results(batch.id))).result
        if result.type != "succeeded":
            raise ClaudeError(f"batch request {result.type}: {getattr(result, 'error', None)}")
        return result.message
