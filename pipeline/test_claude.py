"""Tests for the pipeline's Claude text calls (pipeline/claude.py) and the TEXT_PROVIDER switch.

    .venv/bin/python pipeline/test_claude.py         # plain runner (pytest is not in the venv)

No network and no paid calls: Claude is a fake client with scripted answers.
"""
from __future__ import annotations

import contextlib
import json
import math
import os
import sys
import tempfile
import traceback
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import align, claude, cover, order, process, shorten, writer  # noqa: E402
from pipeline.schema import RecipeDraft  # noqa: E402
from pipeline.test_coverage import MANIFEST, draft, patched  # noqa: E402


class FakeStream:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def get_final_message(self):
        return self.msg


class FakeAnthropic:
    """Stands in for anthropic.Anthropic: each call returns the next scripted answer (an object, a string, or
    (text, stop_reason)) and keeps its arguments."""

    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))

    def __call__(self, **_kwargs):  # used as the anthropic.Anthropic class
        return self

    def _stream(self, **kwargs):
        self.calls.append(kwargs)
        answer = self.answers.pop(0)
        text, stop = answer if isinstance(answer, tuple) else (answer, "end_turn")
        usage = SimpleNamespace(input_tokens=1000, output_tokens=300, cache_read_input_tokens=0,
                                cache_creation_input_tokens=None,
                                output_tokens_details=SimpleNamespace(thinking_tokens=100))
        return FakeStream(SimpleNamespace(
            content=[SimpleNamespace(type="text", text=text if isinstance(text, str) else json.dumps(text))],
            stop_reason=stop, stop_details=None, usage=usage))


@contextlib.contextmanager
def env(**values: str | None):
    saved = {k: os.environ.get(k) for k in values}
    for k, v in values.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


ORDER = {"order": [2, 1], "confidence": "high", "reason": "the onions are chopped before they fry"}


def test_reply_is_shaped_like_geminis():
    fake = FakeAnthropic(ORDER)
    reply = claude.ClaudeText(effort="low", system="Be brief.", client=fake).generate("Which first?",
                                                                                      order.OrderAnswer, temperature=0)
    assert json.loads(process.response_text(reply)) == ORDER
    meta = reply.usage_metadata
    assert (meta.prompt_token_count, meta.candidates_token_count, meta.thoughts_token_count) == (1000, 200, 100)
    [call] = fake.calls
    assert call["model"] == "claude-haiku-5-5" and call["output_format"] is order.OrderAnswer, call
    assert call["output_config"] == {"effort": "low"} and call["system"] == "Be brief.", call
    assert call["messages"] == [{"role": "user", "content": [{"type": "text", "text": "Which first?"}]}], call
    assert "temperature" not in call, call
    assert "fallbacks" not in call, call  # Haiku has none


def test_sonnet_and_opus_fall_back_on_a_refusal():
    for model in ("claude-sonnet-5-5", "claude-opus-5-5"):
        fake = FakeAnthropic(ORDER)
        claude.ClaudeText(model, client=fake).generate("Which first?", order.OrderAnswer)
        assert fake.calls[0]["fallbacks"] == "default", fake.calls
        assert fake.calls[0]["betas"] == ["server-side-fallback-2026-07-01"], fake.calls


def test_a_cut_off_or_declined_reply_raises():
    for stop in ("max_tokens", "refusal"):
        try:
            claude.ClaudeText(client=FakeAnthropic(('{"order": [1', stop))).generate("p", order.OrderAnswer)
        except claude.ClaudeError:
            continue
        raise AssertionError(f"{stop} should raise")


def test_text_provider_flag():
    with env(TEXT_PROVIDER=None):
        assert claude.provider() == "gemini"
    with env(TEXT_PROVIDER=" Claude "):
        assert claude.provider() == "claude"
    with env(TEXT_PROVIDER="openai"):
        with contextlib.suppress(claude.ClaudeError):
            claude.provider()
            raise AssertionError("openai should be refused")
    with env(TEXT_PROVIDER="claude", ANTHROPIC_API_KEY=None):
        with contextlib.suppress(claude.ClaudeError):
            claude.ClaudeText()
            raise AssertionError("no key should be refused")


def test_gemini_key_is_needed_only_while_a_step_is_on_gemini():
    all_claude = dict(TEXT_PROVIDER="claude", COVER_PROVIDER="claude", ALIGN_PROVIDER="claude", EXTRACTOR="claude")
    with patched(process, "load_dotenv", lambda *a, **k: None), \
            env(GEMINI_API_KEY=None, RECIPE_WRITER=None, GEMINI_MEDIA_RESOLUTION=None, COVERAGE_GAP_S=None, **all_claude):
        assert process.load_config()["extractor"] == "claude" and process.gemini_client() is None
        with env(COVER_PROVIDER=None, RECIPE_WRITER="gemini"):
            try:
                process.load_config()
            except process.ProcessError as e:
                assert "COVER_PROVIDER, RECIPE_WRITER still use Gemini" in str(e), e
            else:
                raise AssertionError("a step on Gemini needs the key")


def test_writer_fallback_follows_text_provider():
    with env(TEXT_PROVIDER=None):
        assert writer.fallback(None, "fake-pro").name == "gemini"
    with env(TEXT_PROVIDER="claude", ANTHROPIC_API_KEY="fake", CLAUDE_WRITER_MODEL=None):
        w = writer.fallback(None, "fake-pro")
        assert (w.name, w.model, w.system) == ("claude", "claude-sonnet-5-5", writer.CLAUDE_SYSTEM)
    with env(RECIPE_WRITER="claude", ANTHROPIC_API_KEY="fake", CLAUDE_WRITER_MODEL="claude-opus-5-5"):
        assert writer.choose(None, "fake-pro").model == "claude-opus-5-5"


def test_haiku_costs_more_above_100k_prompt_tokens():
    cost = lambda prompt, batch=False: process.estimate_cost("claude-haiku-5-5", prompt, 1_000, batch)  # noqa: E731
    assert cost(100_000) == (math_close(0.0105), True)
    assert cost(100_001)[0] == math_close(100_001 * 0.50e-6 + 1_000 * 2.50e-6)
    assert cost(100_000, batch=True)[0] == math_close(0.00525)


class math_close(float):  # noqa: N801 - reads like a value in the asserts above
    def __eq__(self, other):
        return math.isclose(self, other, abs_tol=1e-9)

    __hash__ = float.__hash__


def test_clip_order_on_claude_is_logged_at_haiku_prices():
    fake = FakeAnthropic("not json", ORDER)  # the first answer is rejected, so the one retry is used
    with tempfile.TemporaryDirectory() as tmp:
        usage = process.Usage(Path(tmp) / "usage.json")
        ask = process.order_asker(claude.ClaudeText(effort="low", client=fake), usage)
        assert ask("Which first?", [1, 2]).order == [2, 1]
        assert [(c["kind"], c["model"], c["ok"], c["price_known"]) for c in usage.calls] == [
            ("order", "claude-haiku-5-5", False, True), ("order", "claude-haiku-5-5", True, True)], usage.calls
        assert usage.calls[1]["cost_usd"] == round((1000 * 0.10 + 300 * 0.50) / 1e6, 6)


def test_shorten_on_claude_keeps_its_checks():
    path = shorten.copies("dad-sunday-chili")[0]
    recipe = json.loads(path.read_text())
    good = shorten.from_recipe(recipe).model_dump()
    bad = json.loads(json.dumps(good))
    bad["steps"][0]["substeps"][0]["text"] = "Add **17 cups** of water"  # a number the recipe never gives
    fake = FakeAnthropic(bad, good)
    short = shorten.ask(claude.ClaudeText(client=fake), recipe, shorten.MemoryUsage(), "test")
    assert short.model_dump() == shorten.normalize(shorten.ShortRecipe.model_validate(good), recipe).model_dump()
    assert fake.calls[0]["output_format"] is shorten.ShortRecipe
    assert "17" in fake.calls[1]["messages"][0]["content"][-1]["text"]  # the retry tells Claude what was wrong


def test_run_falls_back_from_muse_to_claude_and_shortens_with_claude():
    """process.run on a cached one-file extraction with TEXT_PROVIDER=claude: Muse fails, Claude writes the recipe,
    and shorten gets a Claude model."""
    raws = [{"type": "step", "start": "00:10", "end": "00:40", "action": "Chop the onions", "ingredients": None,
             "sensory_cue": None, "quote": None, "text": None, "why": None}]
    fake = FakeAnthropic(draft((10, 40, "Chop the onions")))
    shortened = []

    def muse_down(*_a, **_k):
        raise writer.WriterError("Muse HTTP 503")

    def broken(*_a, **_k):
        raise RuntimeError("no model here")

    with env(GEMINI_API_KEY="fake-key-for-tests", GEMINI_MODEL="fake-pro", GEMINI_EXTRACT_MODEL="",
             GEMINI_MEDIA_RESOLUTION="LOW", COVERAGE_GAP_S="", RECIPE_WRITER="muse", MUSE_API_KEY="fake",
             TEXT_PROVIDER="claude", ANTHROPIC_API_KEY="fake", CLAUDE_WRITER_MODEL=None, CLAUDE_TEXT_MODEL=None), \
            tempfile.TemporaryDirectory() as tmp, \
            patched(process, "OUT_ROOT", Path(tmp)), patched(process, "load_dotenv", lambda *a, **k: None), \
            patched(process.genai, "Client", lambda **_k: None), patched(claude.anthropic, "Anthropic", fake), \
            patched(writer.MuseWriter, "generate", muse_down), patched(process, "make_poster", lambda *a: None), \
            patched(cover, "make_cover", broken), patched(align, "align_file", broken), \
            patched(shorten, "shorten_file", lambda p, gen, usage: shortened.append((gen.name, gen.effort))):
        out = Path(tmp) / "t-cover"
        (out / "work").mkdir(parents=True)
        (out / "work" / "manifest.json").write_text(json.dumps(MANIFEST))
        (out / "work" / "chunk_01.raw.json").write_text(json.dumps({"chunk_index": 1, "events": raws}))
        process.run("t-cover")
        recipe = json.loads((out / "recipe.json").read_text())
        assert [s["title"] for s in recipe["steps"]] == ["Chop the onions"], recipe
        [call] = fake.calls
        assert call["output_format"] is RecipeDraft and call["system"] == writer.CLAUDE_SYSTEM, call
        assert shortened == [("claude", "medium")], shortened
        usage = json.loads((out / "work" / "usage.json").read_text())["calls"]
        assert [(c["kind"], c["model"], c["ok"]) for c in usage][-1] == ("merge", "claude-sonnet-5-5", True), usage


def main() -> None:
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("test_") and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet):
                fn()
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"ok   {name}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
