// Recording's phases (record.ts) with a fake socket, speech-to-text, voice, Claude and Convex, on a fake
// clock: start/done ordering, double start, done during a question, reconnects, a socket closed mid-wrap-up,
// a recording the app ended underneath an open socket, and the hello for a cook homie has met before.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { RecordingStatus } from "../src/convex.js";
import type { Decision, HomieAgent, Line } from "../src/homie.js";
import type { RecordingDeps } from "../src/record.js";
import type { Voice } from "../src/sonic.js";
import type { SttEvents } from "../src/stt.js";
import { advance, AUDIO_S, FakeSocket, fakeSpeak, settle, sleep, waitFor } from "./helpers.js";

// env.ts wants these at import. Nothing here calls a real service.
process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.VOICE_STUB = "1";
const { Recording } = await import("../src/record.js");
const { Ended } = await import("../src/convex.js");
const { env } = await import("../src/env.js");

const RULES = { firstS: 10, gapS: 30, maxLive: 2, maxEnd: 2 };
const LATENCY_MS = 100; // every Convex call
const THINK_MS = 1000; // every Claude call

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") }));
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

const line = (textEn: string): Line => ({ text: textEn, textEn });
const ask = (textEn: string): Decision => ({ action: "ask", kind: "amount", line: line(textEn) });
const quiet = (storyInProgress = false): Decision => ({ action: "quiet", storyInProgress });

type Call = { fn: string; args: unknown[]; at: number };

/** One recording's backend: a Convex row, Claude's answers, the voice and the mic. */
function world(status: RecordingStatus = "intro", metBefore?: boolean) {
  const row: { status: RecordingStatus; startedAt?: number } = { status };
  const over = () => row.status === "ended" || row.status === "abandoned";
  const calls: Call[] = [];
  const decisions: Decision[] = [];
  const decided: { nowS: number; mayAsk: boolean; asked: string[]; heard: string[] }[] = [];
  const endQuestions: { kind: "cue"; line: Line }[] = [{ kind: "cue", line: line("How do you know the dal is done?") }];
  const endCalls: { asked: string[]; max: number }[] = [];
  const spoken: string[] = [];
  const voices: Voice[] = [];
  /** Each hello Claude was asked for: true = a welcome back. `hello.fails`: Claude can't write it. */
  const intros: boolean[] = [];
  const hello = { fails: false };
  let stt: SttEvents | undefined;
  let ids = 0;

  async function convexCall<T>(fn: string, args: unknown[], result: () => T): Promise<T> {
    calls.push({ fn, args, at: Date.now() });
    await sleep(LATENCY_MS);
    return result();
  }

  const agent: ReturnType<RecordingDeps["agent"]> = {
    intro: async (again = false) => {
      intros.push(again);
      await sleep(THINK_MS);
      return hello.fails ? null : line(again ? "Good to see you again, Rajani Aaji!" : "Hello Rajani Aaji!");
    },
    decide: async (input: Parameters<HomieAgent["decide"]>[0]) => {
      decided.push({ nowS: input.nowS, mayAsk: input.mayAsk, asked: [...input.asked], heard: input.heard.map((h) => h.text) });
      await sleep(THINK_MS);
      // Like the real one: an ask only comes back when it's allowed.
      if (decisions[0]?.action === "ask" && !input.mayAsk) return quiet();
      return decisions.shift() ?? quiet();
    },
    endQuestions: async (_heard, asked, max) => {
      endCalls.push({ asked: [...asked], max });
      await sleep(THINK_MS);
      // Like the real one: nothing already asked.
      return endQuestions.filter((q) => !asked.some((a) => a.includes(q.line.textEn))).slice(0, max);
    },
    yesNo: async (answer) => (/\byes\b/i.test(answer) ? true : /\bno\b/i.test(answer) ? false : null),
    setWho: () => {},
  };

  const deps: RecordingDeps = {
    rules: RULES,
    agent: () => agent,
    translate: async (text) => text,
    createStt: (_language, events) => {
      stt = events;
      return { send: () => {}, close: () => {} };
    },
    speak: fakeSpeak(spoken, voices),
    // Like Convex (live.ts): once a recording is over, status writes, heartbeats and new lines are refused
    // (only the goodbye may still land).
    convex: {
      recordingSession: (_token, recordingId) =>
        convexCall("recordingSession", [recordingId], () => ({
          recording: { _id: recordingId, language: "en", status: row.status, startedAt: row.startedAt, dish: "Dal Tadka" },
          cook: { name: "Rajani", relation: "Aaji", language: "en" },
          kid: { name: "Shreya" },
          dish: "Dal Tadka",
          metBefore,
        })),
      setRecordingStatus: (_token, _id, s) =>
        convexCall("status", [s], () => {
          if (over()) throw new Ended("/live/status");
          if (s === "recording") row.startedAt ??= Date.now();
          row.status = s;
          return { ok: true as const, startedAt: row.startedAt };
        }),
      touchRecording: (_token, _id) =>
        convexCall("touch", [], () => {
          if (over()) throw new Ended("/live/status");
        }),
      logPrompt: (_token, _id, prompt) =>
        convexCall("logPrompt", [prompt.kind, prompt.textEn], () => {
          if (row.status === "abandoned" || (row.status === "ended" && prompt.kind !== "closing")) throw new Ended("/live/prompt");
          return { promptId: `p${++ids}` };
        }),
      updatePrompt: (_token, promptId, s) => convexCall("updatePrompt", [promptId, s], () => undefined),
      setOptIn: (_token, _id, optIn) => convexCall("setOptIn", [optIn], () => undefined),
    },
  };

  /** Opens a socket for `recordingId`, as the phone would. `drop()` is the socket closing. */
  function connect(recordingId: string) {
    const ws = new FakeSocket();
    const rec = new Recording(ws as unknown as WebSocket, "token", recordingId, "pcm", deps);
    void rec.start();
    return {
      ws,
      send: (msg: object) => rec.onMessage(Buffer.from(JSON.stringify(msg)), false),
      drop: () => {
        ws.close(1001);
        rec.close();
      },
    };
  }

  /** She says something: the turn starts, then ends with `text`. */
  function says(text: string) {
    stt!.onTurnStart();
    stt!.onTurnEnd(text);
  }

  const named = (fn: string) => calls.filter((c) => c.fn === fn);
  return { row, calls, named, decisions, decided, endQuestions, endCalls, spoken, voices, intros, hello, connect, says, deps };
}

type Phone = ReturnType<ReturnType<typeof world>["connect"]>;

/** Waits for homie's next line to be sent, then for the phone to finish playing it. */
async function heardOut(c: Phone, what: string) {
  const ends = c.ws.of("say_end").length;
  await waitFor(what, () => c.ws.of("say_end").length > ends);
  await advance(AUDIO_S * 1000 + 500);
}

/** Loads the recording and waits out the hello (written, then ~5 s of audio). */
const helloDone = (c: Phone) => heardOut(c, "hello");

test("a cook homie has recorded with before gets a welcome back, not the introduction", async () => {
  const w = world("intro", true);
  const c = w.connect("rec-met-before");
  await helloDone(c);

  assert.deepEqual(w.intros, [true]);
  assert.deepEqual(w.spoken, ["Good to see you again, Rajani Aaji!"]);
  // It goes to Convex as the hello once filming starts.
  c.send({ type: "start" });
  await waitFor("the hello in Convex", () => w.named("logPrompt").length > 0);
  assert.deepEqual(w.named("logPrompt").map((p) => p.args), [["intro", "Good to see you again, Rajani Aaji!"]]);
  c.drop();
});

test("when Claude can't write the hello: the written welcome back never says homie's name", async () => {
  const w = world("intro", true);
  w.hello.fails = true;
  const c = w.connect("rec-met-before-written");
  await helloDone(c);

  assert.equal(w.spoken.length, 1);
  assert.equal(w.spoken[0], "Hi, Rajani Aaji. Good to see you again. You're making Dal Tadka for Shreya today. How lovely. Start whenever you're ready.");
  assert.doesNotMatch(w.spoken[0], /homie/i);
  c.drop();
});

test("a first recording, or a Convex that doesn't say (metBefore missing), still gets the introduction", async () => {
  for (const metBefore of [false, undefined]) {
    const w = world("intro", metBefore);
    w.hello.fails = true;
    const c = w.connect(`rec-first-${metBefore}`);
    await helloDone(c);

    assert.deepEqual(w.intros, [false]);
    assert.match(w.spoken[0], /^Hi, Rajani Aaji\. I'm homie\./);
    c.drop();
  }
});

test("done while start is still saving: straight to the end, recording never comes back", async () => {
  const w = world();
  const c = w.connect("rec-start-done");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(20); // the "recording" write is still on its way
  c.send({ type: "done" });
  await waitFor("the end", () => c.ws.phases().includes("ended"), 120_000);
  await advance(LATENCY_MS + 50); // the last status write lands

  assert.deepEqual(c.ws.phases(), ["intro", "wrapping_up", "ended"]);
  assert.deepEqual(w.named("status").map((s) => s.args[0]), ["recording", "wrapping_up", "ended"]);
  assert.equal(w.row.status, "ended");
  assert.equal(w.decided.length, 0, "no live questions once she's done");
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro", "end", "optin", "closing"]);
});

test("two quick starts: one status write and one recording phase", async () => {
  const w = world();
  const c = w.connect("rec-double-start");
  await helloDone(c);
  c.send({ type: "start" });
  c.send({ type: "start" });
  await advance(500);
  c.send({ type: "start" });
  await advance(30_000);

  assert.deepEqual(w.named("status").map((s) => s.args[0]), ["recording"]);
  assert.deepEqual(c.ws.phases(), ["intro", "recording"]);
  assert.equal(w.named("logPrompt").filter((p) => p.args[0] === "intro").length, 1);
  c.drop();
});

test("messages sent before the recording has loaded wait for it", async () => {
  const w = world();
  const c = w.connect("rec-early-done");
  c.send({ type: "done" }); // before /live/session answers
  await waitFor("the end", () => c.ws.phases().includes("ended"), 120_000);

  assert.deepEqual(c.ws.phases(), ["intro", "wrapping_up", "ended"]);
  assert.ok(!w.spoken.includes("Hello Rajani Aaji!"), "no hello once she's done");
  assert.deepEqual(w.named("status").map((s) => s.args[0]), ["wrapping_up", "ended"]);
});

test("done while homie is asking: the question stops and is dropped before the end flow", async () => {
  const w = world();
  w.decisions.push(ask("How much salt is a pinch?"));
  const c = w.connect("rec-done-asking");
  await helloDone(c);
  c.send({ type: "start" });
  await waitFor("the question's audio", () => c.ws.of("say_end").length === 2);
  const question = c.ws.of("ask")[0];
  assert.equal(question.textEn, "How much salt is a pinch?");

  // Sonic is done; the phone is still playing it (5 s of audio).
  const before = c.ws.events.length;
  const doneAt = Date.now();
  c.send({ type: "done" });
  await settle();
  const after = c.ws.events.slice(before);
  assert.deepEqual(after.slice(0, 3).map((e) => e.type), ["phase", "say_end", "drop"]);
  assert.equal(after[1].interrupted, true);
  assert.equal(after[2].promptId, question.promptId);
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.named("updatePrompt").map((u) => u.args), [[question.promptId, "ignored"]]);

  // The end flow starts now, not after the question would have finished playing.
  await waitFor("the end question", () => c.ws.of("ask").length === 2);
  assert.ok(Date.now() - doneAt < AUDIO_S * 1000, "the end question waited for the dropped one");
  assert.equal(c.ws.of("ask")[1].kind, "end");
  await waitFor("the end", () => c.ws.phases().includes("ended"), 120_000);
  assert.equal(c.ws.of("ask").filter((a) => a.kind === "amount").length, 1);
});

test("a reconnect while recording keeps the pacing, the questions and what she said", async () => {
  const w = world();
  w.decisions.push(ask("How much salt is a pinch?"));
  const a = w.connect("rec-reconnect");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  w.says("Now I add a pinch of salt");
  await waitFor("the first question", () => a.ws.of("say_end").length === 2);
  await advance(AUDIO_S * 1000);
  w.says("About half a teaspoon");
  assert.equal(a.ws.of("answered").length, 1);
  const firstAskS = w.decided.find((d) => d.mayAsk)!.nowS;
  a.drop();

  // She's back once the gap has passed: still no question right away.
  await advance(45_000);
  w.decisions.push(ask("How do you know the dal is done?"));
  const decidedBefore = w.decided.length;
  const b = w.connect("rec-reconnect");
  await advance(14_000);
  assert.deepEqual(b.ws.phases(), ["recording"]);
  assert.equal(b.ws.of("ask").length, 0);
  assert.equal(w.decided.length, decidedBefore, "listens before deciding anything");

  await waitFor("the second question", () => b.ws.of("ask").length === 1, 30_000);
  const second = w.decided.filter((d) => d.mayAsk).at(-1)!;
  assert.ok(second.nowS - firstAskS >= RULES.gapS, "the gap counts from the question before the drop");
  assert.deepEqual(second.asked, ["How much salt is a pinch?"]);
  assert.deepEqual(second.heard, ["Now I add a pinch of salt", "About half a teaspoon"]);
  assert.equal(w.named("logPrompt").filter((p) => p.args[0] === "intro").length, 1, "the hello is logged once");

  // That was the second of maxLive 2: no third, ever.
  w.decisions.push(ask("A third one?"));
  await advance(300_000, 500);
  assert.equal(b.ws.of("ask").length, 1);
  b.drop();
});

test("every line goes to Sonic in homie's voice, in her language, with its kind (the mood)", async () => {
  const w = world();
  w.decisions.push(ask("How much salt is a pinch?"));
  const c = w.connect("rec-voices");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  w.says("Now I add a pinch of salt");
  await waitFor("the question", () => c.ws.of("say_end").length === 2);
  await advance(AUDIO_S * 1000);
  w.says("About half a teaspoon");
  c.send({ type: "done" });
  await heardOut(c, "the end question");
  w.says("When it smells nutty");
  await heardOut(c, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the end", () => c.ws.phases().includes("ended"), 120_000);
  assert.deepEqual(w.voices.map((v) => v.kind), ["intro", "amount", "end", "optin", "closing"]);
  assert.ok(w.voices.every((v) => v.voice === env.homieVoice && v.language === "en"));
});

test("a socket closed during the wrap-up writes nothing more; the reconnect finishes it once", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const a = w.connect("rec-closed-wrap");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  a.send({ type: "done" });
  await waitFor("the first end question", () => a.ws.of("ask").length === 1);
  assert.match(String(a.ws.of("ask")[0].textEn), /^Before you go, two quick ones\. How do you know/);
  a.drop(); // mid-question
  const droppedAt = Date.now();
  await advance(120_000, 200);

  assert.deepEqual(
    w.calls.filter((c) => c.at > droppedAt).map((c) => c.fn),
    [],
    "nothing logged, no opt-in, no status after the socket closed",
  );
  assert.equal(w.row.status, "wrapping_up");

  const b = w.connect("rec-closed-wrap");
  await heardOut(b, "the second end question");
  assert.deepEqual(b.ws.phases(), ["wrapping_up"]);
  w.says("Butter works too");
  await heardOut(b, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the end", () => b.ws.phases().includes("ended"), 60_000);

  assert.deepEqual(w.endCalls, [
    { asked: [], max: 2 },
    { asked: ["Before you go, two quick ones. How do you know the dal is done?"], max: 1 },
  ]);
  assert.deepEqual(b.ws.of("ask").map((q) => [q.kind, q.textEn]), [
    ["end", "What do you use instead of ghee?"],
    ["optin", "Can Shreya hear your stories too?"],
  ]);
  assert.equal(b.ws.of("answered").length, 2);
  assert.deepEqual(w.named("setOptIn").map((c) => c.args), [[true]]);
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro", "end", "end", "optin", "closing"]);
  assert.deepEqual(w.named("status").map((s) => s.args[0]), ["recording", "wrapping_up", "ended"]);
});

test("closed while the end questions are being written: they're never asked", async () => {
  const w = world();
  const a = w.connect("rec-closed-thinking");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  a.send({ type: "done" });
  await advance(THINK_MS / 2);
  assert.equal(w.endCalls.length, 1);
  a.drop();
  await advance(60_000, 200);
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro"]);
  assert.equal(w.row.status, "wrapping_up");
});

test("never asks while she's telling a story, even when the pacing allows", async () => {
  const w = world();
  w.decisions.push(quiet(true), quiet(false), ask("How long does it simmer?"));
  const c = w.connect("rec-story");
  await helloDone(c);
  c.send({ type: "start" });
  await waitFor("three decisions", () => w.decided.length === 3, 120_000);
  assert.deepEqual(w.decided.map((d) => d.mayAsk), [true, false, true]);
  await waitFor("the question", () => c.ws.of("ask").length === 1);
  c.drop();
});

test("a heartbeat every 10 minutes while the socket is open, none after", async () => {
  const w = world();
  const c = w.connect("rec-heartbeat");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(21 * 60_000, 1000);
  assert.equal(w.named("touch").length, 2);
  c.drop();
  await advance(30 * 60_000, 5000);
  assert.equal(w.named("touch").length, 2);
});

test("a newer socket for the same recording replaces the older one", async () => {
  const w = world();
  const a = w.connect("rec-replaced");
  await helloDone(a);
  const b = w.connect("rec-replaced");
  await advance(500);
  assert.equal(a.ws.closeCode, 4409);
  assert.deepEqual(b.ws.phases(), ["intro"]);
  b.drop();
});

test("closed while a question is being saved: it's marked ignored and never asked", async () => {
  const w = world();
  w.decisions.push(ask("How much salt is a pinch?"));
  const a = w.connect("rec-closed-asking");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  w.says("Now I add a pinch of salt");
  await waitFor("the question being saved", () => w.named("logPrompt").some((p) => p.args[0] === "amount"));
  a.drop(); // inside the save's round trip
  await advance(LATENCY_MS * 3);
  assert.equal(a.ws.of("ask").length, 0, "the question went out after the socket closed");
  const saved = w.named("logPrompt").filter((p) => p.args[0] === "amount");
  assert.equal(saved.length, 1);
  assert.deepEqual(w.named("updatePrompt").map((u) => u.args[1]), ["ignored"]);
});

// ---- the app's stop button ended it (live.endRecording) while this socket was still open ----

/** Counts warnings: a recording ended underneath closes quietly. */
const quietly = () => mock.method(console, "warn", () => {});

test("ended underneath while she cooks: the heartbeat finds out, and nothing more is said or written", async () => {
  const warn = quietly();
  const w = world();
  const c = w.connect("rec-ended-heartbeat");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  w.row.status = "ended"; // the app's stop button, while it couldn't reach us
  const before = w.calls.length;
  await waitFor("the close", () => c.ws.closeCode === 4404, 11 * 60_000);
  assert.deepEqual(c.ws.phases(), ["intro", "recording", "ended"]);
  await advance(30 * 60_000, 5000);
  assert.deepEqual(w.calls.slice(before).map((x) => x.fn), ["touch"], "only the heartbeat that was refused");
  assert.equal(warn.mock.callCount(), 0);
});

test("ended underneath: homie's next question is refused, so it's never asked", async () => {
  const warn = quietly();
  const w = world();
  w.decisions.push(ask("How much salt is a pinch?"));
  const c = w.connect("rec-ended-ask");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  w.row.status = "ended";
  w.says("Now I add a pinch of salt");
  await waitFor("the close", () => c.ws.closeCode === 4404);
  await advance(120_000, 500);

  assert.equal(c.ws.of("ask").length, 0);
  assert.ok(!w.spoken.includes("How much salt is a pinch?"));
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro", "amount"]);
  assert.deepEqual(w.named("updatePrompt"), []);
  assert.deepEqual(c.ws.phases(), ["intro", "recording", "ended"]);
  assert.equal(warn.mock.callCount(), 0);
});

test("ended underneath, then done: no last questions, no opt-in, no goodbye", async () => {
  const warn = quietly();
  const w = world();
  const c = w.connect("rec-ended-done");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  w.row.status = "ended";
  c.send({ type: "done" });
  await waitFor("the close", () => c.ws.closeCode === 4404);
  await advance(120_000, 500);

  assert.deepEqual(c.ws.phases(), ["intro", "recording", "wrapping_up", "ended"]);
  assert.equal(c.ws.of("ask").length, 0);
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro"]);
  assert.deepEqual(w.named("status").map((s) => s.args[0]), ["recording", "wrapping_up"]);
  assert.deepEqual(w.named("setOptIn"), []);
  assert.equal(w.row.status, "ended");
  assert.equal(warn.mock.callCount(), 0);
});

test("a new socket that finds it ended also ends an older one still open", async () => {
  const warn = quietly();
  const w = world();
  const a = w.connect("rec-ended-reconnect");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  w.row.status = "ended";
  const b = w.connect("rec-ended-reconnect");
  await advance(500);
  assert.equal(b.ws.closeCode, 4404);
  assert.equal(a.ws.closeCode, 4404);
  assert.equal(a.ws.phases().at(-1), "ended");
  const before = w.calls.length;
  await advance(15 * 60_000, 5000);
  assert.equal(w.calls.length, before, "the old one writes nothing more (no heartbeat)");
  assert.equal(warn.mock.callCount(), 0);
});
