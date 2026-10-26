"""Claude for the pipeline's text calls. Gemini credits are nearly gone (Oct 24), so the text-only calls move to
Claude: the clip order and cook mode's short substeps on Haiku (process.order_asker, shorten.py), and the
writer's fallback when Muse fails on Sonnet (writer.py; RECIPE_WRITER=claude also makes it the writer).
TEXT_PROVIDER=claude turns that on; unset (or gemini) keeps Gemini, so rolling back is one line in .env.

ClaudeText.generate has GeminiWriter's shape and returns a Gemini-shaped reply (.text, .usage_metadata), so
process.response_text and process.Usage treat both the same. Claude's structured outputs hold the reply to the
same pydantic schema Gemini gets. Models other than Haiku opt into server-side fallbacks: a request the model
declines is run again on Anthropic's recommended model instead of failing.

Env (.env): ANTHROPIC_API_KEY, TEXT_PROVIDER (gemini | claude), CLAUDE_TEXT_MODEL (default claude-haiku-5-5).
"""
from __future__ import annotations

import os
from types import SimpleNamespace

import anthropic
from pydantic import BaseModel

MODEL = "claude-haiku-5-5"
MAX_TOKENS = 64_000  # streamed, so a long recipe's reply never hits an HTTP timeout
RETRIES = 4  # the SDK backs off on 429 / 5xx; a burst of rate limits shouldn't end a recording's run


class ClaudeError(RuntimeError):
    pass


def provider() -> str:
    """gemini or claude, from TEXT_PROVIDER. Call after .env is loaded."""
    want = (os.environ.get("TEXT_PROVIDER") or "gemini").strip().lower()
    if want not in ("gemini", "claude"):
        raise ClaudeError(f"TEXT_PROVIDER={want!r} must be gemini or claude")
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

    def generate(self, prompt: str, schema: type[BaseModel], temperature: float | None = None) -> SimpleNamespace:
        """One structured call. temperature is ignored: current Claude models only take their default."""
        extra = {"system": self.system} if self.system else {}
        if self.model != MODEL:  # Haiku has no server-side fallback
            extra.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        with self.client.beta.messages.stream(model=self.model, max_tokens=MAX_TOKENS, output_format=schema,
                                              output_config={"effort": self.effort},
                                              messages=[{"role": "user", "content": prompt}], **extra) as stream:
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
