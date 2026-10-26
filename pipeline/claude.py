"""Claude for the pipeline's model calls. Gemini credits are nearly gone (Oct 24), so the calls move to Claude, each
behind its own flag (unset or gemini keeps Gemini, so rolling back is one line in .env):
- TEXT_PROVIDER=claude: the clip order and cook mode's short substeps on Haiku (process.order_asker, shorten.py),
  and the writer's fallback when Muse fails on Sonnet (writer.py; RECIPE_WRITER=claude also makes it the writer).
- COVER_PROVIDER=claude: the cover pick from still frames (cover.py).

ClaudeText.generate has GeminiWriter's shape and returns a Gemini-shaped reply (.text, .usage_metadata), so
process.response_text and process.Usage treat both the same. Claude's structured outputs hold the reply to the
same pydantic schema Gemini gets; images go before the prompt, each after its label. Models other than Haiku opt
into server-side fallbacks: a request the model declines is run again on Anthropic's recommended model.

Env (.env): ANTHROPIC_API_KEY, TEXT_PROVIDER and COVER_PROVIDER (gemini | claude), CLAUDE_TEXT_MODEL (default
claude-haiku-5-5).
"""
from __future__ import annotations

import base64
import os
from collections.abc import Sequence
from types import SimpleNamespace

import anthropic
from pydantic import BaseModel

MODEL = "claude-haiku-5-5"
MAX_TOKENS = 64_000  # streamed, so a long recipe's reply never hits an HTTP timeout
RETRIES = 4  # the SDK backs off on 429 / 5xx; a burst of rate limits shouldn't end a recording's run


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
                 client: anthropic.Anthropic | None = None):
        if client is None:
            key = os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                raise ClaudeError("ANTHROPIC_API_KEY is not set (add it to .env, or set TEXT_PROVIDER=gemini)")
            client = anthropic.Anthropic(api_key=key, max_retries=RETRIES)
        self.client, self.model, self.effort, self.system = client, model or text_model(), effort, system

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
        thinking = (use.output_tokens_details.thinking_tokens if use.output_tokens_details else 0) or 0
        meta = SimpleNamespace(
            prompt_token_count=use.input_tokens + (use.cache_read_input_tokens or 0)
            + (use.cache_creation_input_tokens or 0),
            candidates_token_count=max(use.output_tokens - thinking, 0), thoughts_token_count=thinking)
        text = "".join(b.text for b in msg.content if b.type == "text")
        return SimpleNamespace(text=text, usage_metadata=meta, candidates=None, prompt_feedback=msg.stop_reason)
