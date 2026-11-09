"""Who writes the recipe from Gemini's timestamped events (docs/build/STACK.md: Gemini watches, Muse writes).

RECIPE_WRITER=muse (default) sends the merge prompt to Muse Spark on Meta's Model API; RECIPE_WRITER=gemini
keeps the old all-Gemini path, and RECIPE_WRITER=claude writes with Claude (pipeline/claude.py). process.run
falls back on its own if Muse fails twice: to Claude with TEXT_PROVIDER=claude, else to Gemini (fallback()).

Every writer returns an object shaped like a Gemini response (.text, .usage_metadata, .candidates), so
process.response_text and process.Usage treat them the same.

Env (.env): MUSE_API_KEY (MODEL_API_KEY also read), MUSE_MODEL (default muse-spark-1.3), MUSE_BASE_URL,
CLAUDE_WRITER_MODEL (default claude-sonnet-5-5).
Standard mode on purpose: the "-contributor" models are cheaper but let Meta train on the family's words.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from types import SimpleNamespace

import requests
from google import genai
from google.genai import types
from pydantic import BaseModel

from pipeline import claude

MUSE_BASE_URL = "https://api.meta.ai/v1"
MUSE_MODEL = "muse-spark-1.3"
MUSE_TIMEOUT = (30, 900)  # (connect, read) seconds; a long video's merge can take minutes
MUSE_RETRY_STATUS = {429, 500, 502, 503, 504}
MUSE_ATTEMPTS = 4

MUSE_SYSTEM = """\
You write family recipes for homecookd. A parent cooked a family dish on video; their grown kid, often far
from home, will cook it from what you write. Use plain, warm words a beginner can follow, keep the cook's
own phrases and amounts, and never add anything the cook did not say or do. Answer with JSON only."""


# Claude, given MUSE_SYSTEM alone, retold stories as "The cook went to..." (once guessing "he") and wrote 21-29 steps
# for the Swordfish video where Gemini kept the cook's words and 12 steps. With these lines every model kept the
# words; Sonnet wrote 12 steps ($0.07), Opus 19, Haiku 27 (Oct 25). So the Claude writer is Sonnet.
CLAUDE_WRITER_MODEL = "claude-sonnet-5-5"
CLAUDE_SYSTEM = MUSE_SYSTEM + """
- A story's text is the cook's own words from the input events, in the first person as they said them, only
  trimmed of filler. Never retell it as "the cook..." and never guess anyone's gender.
- Steps are the stages a family would name: about 8 to 12 for a home dish, as the step rules say, and a long
  video stays near 12 unless its stages are clearly separate. Fold short actions (a taste, a stir, checking the
  pan, wiping the plate) into the stage they belong to, and keep every action in a step's instruction.
- A step's quote is all the cook's words from its step events' quotes, joined in order (minus words repeated back
  to back), not a pick of the most useful ones, and its quote_original is those events' quote_original joined
  the same way: the family hears her whole explanation of the stage, as she said it."""


class WriterError(RuntimeError):
    pass


@dataclass
class Reply:
    """The parts of a Gemini GenerateContentResponse that process.py reads."""
    text: str
    usage_metadata: SimpleNamespace
    candidates: None = None
    prompt_feedback: str | None = None


class GeminiWriter:
    name = "gemini"

    def __init__(self, client: genai.Client, model: str):
        self.client, self.model = client, model

    def generate(self, prompt: str, schema: type[BaseModel], temperature: float | None = None):
        return self.client.models.generate_content(
            model=self.model, contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema,
                                               temperature=temperature))


class MuseWriter:
    """Muse Spark through the OpenAI-compatible Chat Completions endpoint, with json_schema output."""
    name = "muse"

    def __init__(self, api_key: str, model: str = MUSE_MODEL, base_url: str = MUSE_BASE_URL):
        self.model, self.url = model, base_url.rstrip("/") + "/chat/completions"
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {api_key}"

    def generate(self, prompt: str, schema: type[BaseModel], temperature: float | None = None) -> Reply:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": MUSE_SYSTEM}, {"role": "user", "content": prompt}],
            "response_format": {"type": "json_schema",
                                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()}},
        }
        if temperature is not None:
            body["temperature"] = temperature
        data = self._post(body)
        choice = (data.get("choices") or [{}])[0]
        text = (choice.get("message") or {}).get("content") or ""
        if choice.get("finish_reason") == "length":
            raise WriterError(f"Muse stopped at its output limit ({len(text)} chars written)")
        use = data.get("usage") or {}
        out = use.get("completion_tokens") or 0
        thinking = (use.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0
        meta = SimpleNamespace(prompt_token_count=use.get("prompt_tokens") or 0,
                               candidates_token_count=max(out - thinking, 0), thoughts_token_count=thinking)
        return Reply(text=text, usage_metadata=meta, prompt_feedback=choice.get("finish_reason"))

    def _post(self, body: dict) -> dict:
        for attempt in range(1, MUSE_ATTEMPTS + 1):
            try:
                res = self.session.post(self.url, json=body, timeout=MUSE_TIMEOUT)
            except (requests.ConnectionError, requests.Timeout) as e:
                if attempt == MUSE_ATTEMPTS:
                    raise WriterError(f"Muse unreachable: {type(e).__name__}") from e
            else:
                if res.ok:
                    return res.json()
                if res.status_code not in MUSE_RETRY_STATUS or attempt == MUSE_ATTEMPTS:
                    raise WriterError(f"Muse HTTP {res.status_code}: {res.text[:500]}")
            wait = min(10 * 2 ** (attempt - 1), 120)
            print(f"[muse] attempt {attempt} failed; retrying in {wait} s", flush=True)
            time.sleep(wait)
        raise AssertionError("unreachable")


def muse_key() -> str | None:
    return os.environ.get("MUSE_API_KEY") or os.environ.get("MODEL_API_KEY")


Writer = GeminiWriter | MuseWriter | claude.ClaudeText


def claude_writer() -> claude.ClaudeText:
    try:
        return claude.ClaudeText(os.environ.get("CLAUDE_WRITER_MODEL") or CLAUDE_WRITER_MODEL, system=CLAUDE_SYSTEM,
                                 batch=True)  # half price, ~2 min longer (claude.py)
    except claude.ClaudeError as e:
        raise WriterError(str(e))


def fallback(client: genai.Client, gemini_model: str) -> GeminiWriter | claude.ClaudeText:
    """Who writes when Muse fails: Claude with TEXT_PROVIDER=claude, else Gemini. Call after .env is loaded."""
    try:
        want = claude.provider()
    except claude.ClaudeError as e:
        raise WriterError(str(e))
    return claude_writer() if want == "claude" else GeminiWriter(client, gemini_model)


def choose(client: genai.Client, gemini_model: str) -> Writer:
    """The writer RECIPE_WRITER asks for. Call after .env is loaded."""
    want = (os.environ.get("RECIPE_WRITER") or "muse").strip().lower()
    if want == "gemini":
        return GeminiWriter(client, gemini_model)
    if want == "claude":
        return claude_writer()
    if want != "muse":
        raise WriterError(f"RECIPE_WRITER={want!r} must be muse, gemini or claude")
    key = muse_key()
    if not key:
        raise WriterError("RECIPE_WRITER=muse needs MUSE_API_KEY in .env (or set RECIPE_WRITER=gemini)")
    return MuseWriter(key, os.environ.get("MUSE_MODEL") or MUSE_MODEL,
                      os.environ.get("MUSE_BASE_URL") or MUSE_BASE_URL)


def main() -> None:
    """python pipeline/writer.py: check the Muse key with one tiny structured call."""
    from pathlib import Path

    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

    class Ping(BaseModel):
        dish: str

    key = muse_key()
    if not key:
        raise SystemExit("writer: MUSE_API_KEY is not set")
    w = MuseWriter(key, os.environ.get("MUSE_MODEL") or MUSE_MODEL, os.environ.get("MUSE_BASE_URL") or MUSE_BASE_URL)
    t0 = time.monotonic()
    reply = w.generate('Name one dumpling dish. Reply as {"dish": "..."}', Ping)
    print(f"{w.model}: {json.loads(reply.text)} in {time.monotonic() - t0:.1f} s, usage {vars(reply.usage_metadata)}")


if __name__ == "__main__":
    main()
