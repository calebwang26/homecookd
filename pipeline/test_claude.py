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


class FakeBatches:
    """Stands in for client.messages.batches: the batch ends after `polls` checks (never, with None)."""

    def __init__(self, answer, polls: int | None = 1, outcome: str = "succeeded"):
        self.answer, self.polls, self.outcome, self.created, self.cancelled = answer, polls, outcome, [], []

    def create(self, requests):
        self.created.append(requests)
        return SimpleNamespace(id="batch_1")

    def retrieve(self, batch_id):
        if self.polls is not None:
            self.polls -= 1
        return SimpleNamespace(processing_status="ended" if self.polls is not None and self.polls <= 0 else "in_progress")

    def cancel(self, batch_id):
        self.cancelled.append(batch_id)

    def results(self, batch_id):
        usage = SimpleNamespace(input_tokens=1000, output_tokens=300, cache_read_input_tokens=0,
                                cache_creation_input_tokens=None)
        msg = SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(self.answer))],
                              stop_reason="end_turn", stop_details=None, usage=usage)
        yield SimpleNamespace(custom_id="call", result=SimpleNamespace(type=self.outcome, message=msg, error="boom"))


def test_claude_batch_sends_one_request_at_half_price():
    fake = FakeAnthropic(ORDER)
    fake.messages = SimpleNamespace(batches=FakeBatches(ORDER, polls=2))
    with env(CLAUDE_BATCH="1"), patched(claude, "BATCH_POLL_S", 0):
        gen = claude.ClaudeText("claude-sonnet-5-5", effort="low", client=fake)
        reply = gen.generate("Which first?", order.OrderAnswer, images=[("Frame 1", b"jpeg")])
    assert json.loads(reply.text) == ORDER and reply.batch is True and fake.calls == []  # no streamed call
    params = fake.messages.batches.created[0][0]["params"]
    assert params["model"] == "claude-sonnet-5-5" and params["output_config"]["effort"] == "low"
    assert params["output_config"]["format"]["type"] == "json_schema" and "fallbacks" not in params  # Batches refuse it
    assert [c["type"] for c in params["messages"][0]["content"]] == ["text", "image", "text"]
    with tempfile.TemporaryDirectory() as tmp:
        call = process.Usage(Path(tmp) / "usage.json").add("merge", "claude-sonnet-5-5", None, 1, 1.0, reply)
    assert call["batch"] is True and call["cost_usd"] == math_close((1000 * 1.00 + 300 * 5.00) / 1e6)


def test_a_slow_batch_is_cancelled_and_sent_the_normal_way_and_a_failed_one_raises():
    fake = FakeAnthropic(ORDER)
    fake.messages = SimpleNamespace(batches=FakeBatches(ORDER, polls=None))
    with env(CLAUDE_BATCH="1", CLAUDE_BATCH_WAIT_S="0"), patched(claude, "BATCH_POLL_S", 0), \
            patched(claude, "SETTLE_S", 0):
        reply = claude.ClaudeText("claude-sonnet-5-5", client=fake).generate("p", order.OrderAnswer)
    assert fake.messages.batches.cancelled == ["batch_1"] and len(fake.calls) == 1 and reply.batch is False
    fake = FakeAnthropic()
    fake.messages = SimpleNamespace(batches=FakeBatches(ORDER, outcome="errored"))
    with env(CLAUDE_BATCH="1"), patched(claude, "BATCH_POLL_S", 0):
        try:
            claude.ClaudeText("claude-sonnet-5-5", client=fake).generate("p", order.OrderAnswer)
            raise AssertionError("an errored batch request should raise")
        except claude.ClaudeError as e:
            assert "errored" in str(e)
    with env(CLAUDE_BATCH=None):
        assert claude.ClaudeText(client=FakeAnthropic()).batch is False  # the small calls don't wait
        assert claude.ClaudeText(client=FakeAnthropic(), batch=True).batch is True  # the extraction and the writer
    with env(CLAUDE_BATCH="0"):
        assert claude.ClaudeText(client=FakeAnthropic(), batch=True).batch is False  # the rollback
    with env(CLAUDE_BATCH="1"):
        assert claude.ClaudeText(client=FakeAnthropic()).batch is True  # the language eval


# ---------- a batch call's lifecycle (claude.BatchState): one test per move in ALLOWED ----------

S = claude.BatchState


class ScriptedBatches:
    """client.messages.batches: ends after `ends_after` checks (None: never on its own), ends at once once cancelled
    (unless cancel_ends is False), and answers `outcome`, or `after_cancel` once cancelled. fail: {method: exception}."""

    def __init__(self, ends_after: int | None = 1, outcome: str = "succeeded", after_cancel: str = "canceled",
                 cancel_ends: bool = True, stop: str = "end_turn", fail: dict | None = None):
        self.ends_after, self.outcome, self.after_cancel, self.cancel_ends = ends_after, outcome, after_cancel, cancel_ends
        self.stop, self.fail = stop, fail or {}
        self.created, self.cancelled, self.checks = [], [], 0

    def create(self, requests):
        self.created.append(requests)
        return SimpleNamespace(id=f"batch_{len(self.created)}")

    def retrieve(self, batch_id):
        if "retrieve" in self.fail:
            raise self.fail["retrieve"]
        self.checks += 1
        ended = (self.ends_after is not None and self.checks >= self.ends_after) or \
            (batch_id in self.cancelled and self.cancel_ends)
        return SimpleNamespace(processing_status="ended" if ended else "in_progress")

    def cancel(self, batch_id):
        self.cancelled.append(batch_id)

    def results(self, batch_id):
        if "results" in self.fail:
            raise self.fail["results"]
        usage = SimpleNamespace(input_tokens=1000, output_tokens=300, cache_read_input_tokens=0,
                                cache_creation_input_tokens=None)
        msg = SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(ORDER))], stop_reason=self.stop,
                              stop_details=None, usage=usage)
        kind = self.after_cancel if batch_id in self.cancelled else self.outcome
        yield SimpleNamespace(custom_id="call", result=SimpleNamespace(type=kind, message=msg, error="boom"))


@contextlib.contextmanager
def batch_call(batches: ScriptedBatches, *answers, model: str = "claude-sonnet-5-5", wait: str = "300"):
    """A batched ClaudeText on `batches` with its run's registry in a temp folder: yields (gen, registry, fake)."""
    fake = FakeAnthropic(*answers)
    fake.messages = SimpleNamespace(batches=batches)
    with tempfile.TemporaryDirectory() as tmp, env(CLAUDE_BATCH=None, CLAUDE_BATCH_WAIT_S=wait), \
            patched(claude, "BATCH_POLL_S", 0), patched(claude, "SETTLE_S", 0):
        gen = claude.ClaudeText(model, client=fake, batch=True)
        gen.batches = claude.BatchRegistry(Path(tmp) / claude.BATCHES)
        yield gen, gen.batches, fake


def test_every_move_outside_the_table_is_refused():
    for a in S:
        for b in S:
            call = claude.BatchCall("b", "m", None, a)
            try:
                call.advance(b)
                assert (a, b) in claude.ALLOWED, (a, b)
                assert call.state is b
            except claude.ClaudeError:
                assert (a, b) not in claude.ALLOWED, (a, b)


def test_open_ended_used_answers_from_the_batch_and_leaves_the_registry_empty():
    with batch_call(ScriptedBatches(ends_after=2)) as (gen, registry, fake):
        reply = gen.generate("p", order.OrderAnswer)
        assert reply.batch is True and json.loads(reply.text) == ORDER and fake.calls == []
        assert registry.read() == {} and not registry.path.with_name(claude.BATCHES + ".tmp").exists()


def test_waited_out_but_finished_anyway_is_used_not_paid_for_twice():
    batches = ScriptedBatches(ends_after=None, after_cancel="succeeded")  # open -> cancelling -> ended -> used
    with batch_call(batches, wait="0") as (gen, registry, fake):
        reply = gen.generate("p", order.OrderAnswer)
        assert batches.cancelled == ["batch_1"] and reply.batch is True and fake.calls == [] and registry.read() == {}


def test_waited_out_and_cancelled_before_it_ran_goes_the_normal_way():
    batches = ScriptedBatches(ends_after=None, after_cancel="canceled")  # ... -> ended -> unbilled
    with batch_call(batches, ORDER, wait="0") as (gen, registry, fake):
        reply = gen.generate("p", order.OrderAnswer)
        assert batches.cancelled == ["batch_1"] and reply.batch is False and len(fake.calls) == 1
        assert registry.read() == {}


def test_a_cancel_still_ending_stays_listed_and_reap_records_what_it_billed():
    batches = ScriptedBatches(ends_after=None, cancel_ends=False, after_cancel="succeeded")
    with batch_call(batches, ORDER, wait="0") as (gen, registry, fake):
        assert gen.generate("p", order.OrderAnswer).batch is False and len(fake.calls) == 1  # the normal way, at once
        assert registry.read() == {"batch_1": {"state": "cancelling", "model": "claude-sonnet-5-5"}}
        recorded = []
        assert claude.reap(registry.path, recorded.append, fake, wait_s=0) == 0  # still ending: listed for later
        batches.cancel_ends = True
        assert claude.reap(registry.path, recorded.append, fake, wait_s=0) == 1  # cancelling -> ended -> recorded
        assert [(r.batch, r.model, r.usage_metadata.prompt_token_count) for r in recorded] == \
            [(True, "claude-sonnet-5-5", 1000)]
        assert registry.read() == {} and claude.reap(registry.path, recorded.append, fake) == 0  # never twice


def test_an_error_or_stop_while_open_cancels_the_batch_before_it_raises():
    for failure in (RuntimeError("connection reset"), KeyboardInterrupt()):
        batches = ScriptedBatches(ends_after=None, fail={"retrieve": failure})
        with batch_call(batches) as (gen, registry, _):
            try:
                gen.generate("p", order.OrderAnswer)
                raise AssertionError("it should raise")
            except (RuntimeError, KeyboardInterrupt) as e:
                assert e is failure
            assert batches.cancelled == ["batch_1"]  # open -> cancelling; attempt 2 won't leave it running unseen
            assert registry.read()["batch_1"]["state"] == "cancelling"


def test_an_ended_batch_whose_results_cant_be_read_stays_listed_for_reap():
    batches = ScriptedBatches(fail={"results": RuntimeError("502")})
    with batch_call(batches) as (gen, registry, fake):
        try:
            gen.generate("p", order.OrderAnswer)
            raise AssertionError("it should raise")
        except RuntimeError:
            pass
        assert batches.cancelled == [] and registry.read()["batch_1"]["state"] == "ended"
        batches.fail = {}
        recorded = []
        assert claude.reap(registry.path, recorded.append, fake, wait_s=0) == 1 and registry.read() == {}


def test_an_errored_or_expired_batch_raises_and_bills_nothing():
    for outcome in ("errored", "expired"):
        with batch_call(ScriptedBatches(outcome=outcome)) as (gen, registry, _):
            try:
                gen.generate("p", order.OrderAnswer)
                raise AssertionError("it should raise")
            except claude.ClaudeError as e:
                assert outcome in str(e)
            assert registry.read() == {}  # ended -> unbilled


def test_reap_cancels_a_killed_runs_open_batches_and_records_only_what_billed():
    for after_cancel, billed in (("canceled", 0), ("succeeded", 1)):
        with tempfile.TemporaryDirectory() as tmp:
            registry = claude.BatchRegistry(Path(tmp) / claude.BATCHES)
            claude.BatchCall("batch_1", "claude-sonnet-5-5", registry)  # left open by a killed run
            batches = ScriptedBatches(ends_after=None, after_cancel=after_cancel)
            fake = SimpleNamespace(messages=SimpleNamespace(batches=batches))
            recorded = []
            with patched(claude, "BATCH_POLL_S", 0):  # open -> cancelling -> ended -> unbilled or recorded
                assert claude.reap(registry.path, recorded.append, fake, wait_s=0) == billed
            assert batches.cancelled == ["batch_1"] and len(recorded) == billed and registry.read() == {}


def test_a_refusal_on_batch_is_sent_again_with_the_fallback_and_both_are_recorded():
    with batch_call(ScriptedBatches(stop="refusal"), ORDER) as (gen, _, fake):
        reply = gen.generate("p", order.OrderAnswer)
        assert reply.batch is False and fake.calls[0]["fallbacks"] == "default"  # the normal way carries it
        with tempfile.TemporaryDirectory() as tmp:
            usage = process.Usage(Path(tmp) / "usage.json")
            usage.add("merge", gen.model, None, 1, 2.0, reply)
            refused, answer = usage.calls
        assert refused["batch"] is True and refused["error"].startswith("refused on batch") and not refused["ok"]
        assert refused["cost_usd"] == math_close((1000 * 1.00 + 300 * 5.00) / 1e6)  # billed at batch prices
        assert answer["ok"] and answer["batch"] is False
    with batch_call(ScriptedBatches(stop="refusal"), model="claude-haiku-5-5") as (gen, _, fake):
        try:  # Haiku has no fallback to try
            gen.generate("p", order.OrderAnswer)
            raise AssertionError("it should raise")
        except claude.ClaudeError as e:
            assert "declined" in str(e) and fake.calls == []


def test_the_registry_is_never_read_half_written():
    import threading
    with tempfile.TemporaryDirectory() as tmp:
        registry = claude.BatchRegistry(Path(tmp) / claude.BATCHES)
        bad, done = [], threading.Event()

        def reader():
            while not done.is_set():
                if registry.path.exists():
                    try:
                        json.loads(registry.path.read_text())
                    except ValueError:
                        bad.append(1)

        watcher = threading.Thread(target=reader)
        watcher.start()
        writers = [threading.Thread(target=lambda n=n: [registry.put(f"b{n}-{i}", {"state": "open", "model": "m"})
                                                          for i in range(40)]) for n in range(6)]
        for t in writers:
            t.start()
        for t in writers:
            t.join()
        done.set()
        watcher.join()
        assert bad == [] and len(registry.read()) == 240


def test_process_reap_batches_records_a_killed_runs_bill_at_batch_price():
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        registry = claude.BatchRegistry(work / claude.BATCHES)
        claude.BatchCall("batch_1", "claude-sonnet-5-5", registry, S.CANCELLING)
        batches = ScriptedBatches(ends_after=1, outcome="succeeded")
        fake = SimpleNamespace(messages=SimpleNamespace(batches=batches))
        usage = process.Usage(work / "usage.json")
        with patched(claude.anthropic, "Anthropic", lambda **_k: fake), env(ANTHROPIC_API_KEY="fake"):
            assert process.reap_batches(work, usage) == 1
        saved = json.loads((work / "usage.json").read_text())["calls"]
        assert [(c["kind"], c["model"], c["batch"], c["ok"]) for c in saved] == \
            [("batch-reaped", "claude-sonnet-5-5", True, True)]
        assert saved[0]["cost_usd"] == math_close((1000 * 1.00 + 300 * 5.00) / 1e6)
        assert process.reap_batches(work, usage) == 0  # an empty registry opens no client


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

    with env(GEMINI_API_KEY="fake-key-for-tests", GEMINI_MODEL="fake-pro", GEMINI_EXTRACT_MODEL="", CLAUDE_BATCH="0",
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
        assert shortened == [("claude", "low")], shortened  # shorten.effort(): low since Nov 8
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
