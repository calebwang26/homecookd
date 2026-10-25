// Recording's phases (record.ts) with a fake socket, speech-to-text, voice, Claude and Convex, on a fake
// clock: start/done ordering, double start, done during a question, reconnects, a socket closed mid-wrap-up,
// a recording the app ended underneath an open socket, the hello for a cook homie has met before, the
// wrap-up's turn-taking (an answer in several turns, "still there?", the let-off), and its order: the count line,
// the questions back to back inside {type:"hold"}, the plate photo, goodbye.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { RecordingStatus } from "../src/convex.js";
import type { Decision, HomieAgent, Line, Who } from "../src/homie.js";
import type { RecordingDeps } from "../src/record.js";
import type { Voice } from "../src/sonic.js";
import type { SttEvents } from "../src/stt.js";
import { advance, AUDIO_S, FakeSocket, fakeSpeak, settle, sleep, waitFor } from "./helpers.js";

// env.ts wants these at import. Nothing here calls a real service.
process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.VOICE_STUB = "1";
const { Recording, ANSWER_GAP_MS, PLAYER_LOAD_MS, SILENT_MS, wrapUpCount } = await import("../src/record.js");
const { countLine } = await import("../src/lines.js");
const { Ended } = await import("../src/convex.js");
const { env } = await import("../src/env.js");

const RULES = { firstS: 10, gapS: 30, maxLive: 2, maxEnd: 2 };
const LATENCY_MS = 100; // every Convex call
/** The fake Sonic makes each line in 5 pieces, one every 200 ms (faster than it plays, like the real one). */
const STREAM = { chunks: 5, everyMs: 200 };
const MAKE_MS = STREAM.chunks * STREAM.everyMs;
const THINK_MS = 1000; // every Claude call

/** Every phone socket a test opened: none may break the /record contract (FakeSocket.violations). */
const sockets: FakeSocket[] = [];

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") }));
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  assert.deepEqual(sockets.splice(0).flatMap((ws) => ws.violations), []);
});

const line = (textEn: string): Line => ({ text: textEn, textEn });
const ask = (textEn: string): Decision => ({ action: "ask", kind: "amount", line: line(textEn) });
const quiet = (storyInProgress = false): Decision => ({ action: "quiet", storyInProgress });

type Call = { fn: string; args: unknown[]; at: number };

/** One recording's backend: a Convex row, Claude's answers, the voice and the mic. */
function world(status: RecordingStatus = "intro", metBefore?: boolean, language = "en") {
  const row: { status: RecordingStatus; startedAt?: number } = { status };
  const over = () => row.status === "ended" || row.status === "abandoned";
  const calls: Call[] = [];
  const decisions: Decision[] = [];
  const decided: { nowS: number; mayAsk: boolean; asked: string[]; heard: string[]; frame: boolean }[] = [];
  /** Every prompt Convex was sent, in full (`said` included). */
  const logged: { kind: string; textEn: string; atS: number; said?: { atS: number; endS: number } }[] = [];
  const endQuestions: { kind: "cue"; line: Line }[] = [{ kind: "cue", line: line("How do you know the dal is done?") }];
  const endCalls: { asked: string[]; max: number }[] = [];
  const spoken: string[] = [];
  /** When each line went to Sonic: it has played on the phone AUDIO_S s and 100 ms later (fakeSpeak). */
  const spokenAt: number[] = [];
  /** When each mic chunk reached her speech-to-text (the rest were muted). */
  const heardAudioAt: number[] = [];
  const voices: Voice[] = [];
  /** Every answer saved with /live/prompt-update. */
  const answers: { promptId: string; transcript: string; atS: number; endS: number }[] = [];
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
      decided.push({ nowS: input.nowS, mayAsk: input.mayAsk, asked: [...input.asked], heard: input.heard.map((h) => h.text), frame: !!input.frame });
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

  const speak = fakeSpeak(spoken, voices, STREAM);
  const deps: RecordingDeps = {
    rules: RULES,
    agent: () => agent,
    translate: async (text) => text,
    createStt: (_language, events) => {
      stt = events;
      return { send: () => void heardAudioAt.push(Date.now()), close: () => {} };
    },
    speak: (text, format, signal, onChunk, voice) => (spokenAt.push(Date.now()), speak(text, format, signal, onChunk, voice)),
    // Like Convex (live.ts): once a recording is over, status writes, heartbeats and new lines are refused
    // (only the goodbye may still land).
    convex: {
      recordingSession: (_token, recordingId) =>
        convexCall("recordingSession", [recordingId], () => ({
          recording: { _id: recordingId, language, status: row.status, startedAt: row.startedAt, dish: "Dal Tadka" },
          cook: { name: "Rajani", relation: "Aaji", language },
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
          logged.push(prompt);
          if (row.status === "abandoned" || (row.status === "ended" && prompt.kind !== "closing")) throw new Ended("/live/prompt");
          return { promptId: `p${++ids}` };
        }),
      updatePrompt: (_token, promptId, s, answer) =>
        convexCall("updatePrompt", [promptId, s], () => {
          if (answer) answers.push({ promptId, transcript: answer.transcript, atS: answer.atS, endS: answer.endS });
        }),
      promptSaid: (_token, promptId, said) => convexCall("promptSaid", [promptId, said], () => undefined),
      setOptIn: (_token, _id, optIn) => convexCall("setOptIn", [optIn], () => undefined),
    },
  };

  /** Opens a socket for `recordingId`, as the phone would. `drop()` is the socket closing. */
  function connect(recordingId: string) {
    const ws = new FakeSocket();
    sockets.push(ws);
    const rec = new Recording(ws as unknown as WebSocket, "token", recordingId, "pcm", deps);
    void rec.start();
    return {
      ws,
      send: (msg: object) => rec.onMessage(Buffer.from(JSON.stringify(msg)), false),
      /** 100 ms of mic audio: loud (her voice, or the kitchen) or silent. */
      mic: (loud: boolean) => rec.onMessage(loud ? LOUD : Buffer.alloc(3200), true),
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

  /** Her words as the speech-to-text shows them while she still talks (no turn end yet). */
  function partial(text: string) {
    stt!.onPartial(text);
  }

  /** When homie's nth line (0 = the first) finished playing on the phone: it plays once it has all of it. */
  const playedAt = (n: number) => spokenAt[n] + MAKE_MS + PLAYER_LOAD_MS + AUDIO_S * 1000;
  const named = (fn: string) => calls.filter((c) => c.fn === fn);
  return { row, calls, named, logged, decisions, decided, endQuestions, endCalls, spoken, spokenAt, playedAt, heardAudioAt, voices, intros, hello, answers, connect, says, partial, stt: () => stt!, deps };
}

/** 100 ms of loud 16 kHz s16le audio (RMS 3000, well above the voice threshold). */
const LOUD = Buffer.alloc(3200);
for (let i = 0; i < LOUD.length; i += 2) LOUD.writeInt16LE(i % 4 ? -3000 : 3000, i);

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
  // Her speech-to-text never showed a thing: a plain wait on each question, no "still there?" or let-off.
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro", "reaction", "end", "optin", "closing"]);
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
  // The hold comes before the card's drop, so the app never shrinks homie and grows it again.
  assert.deepEqual(after.slice(0, 4).map((e) => [e.type, e.on]), [["phase", undefined], ["say_end", undefined], ["hold", true], ["drop", undefined]]);
  assert.equal(after[1].interrupted, true);
  assert.equal(after[3].promptId, question.promptId);
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.named("updatePrompt").map((u) => u.args), [[question.promptId, "ignored"]]);

  // The end flow starts now (the count line), not after the question would have finished playing.
  await waitFor("the count line", () => c.ws.of("say").length === 3);
  assert.ok(Date.now() - doneAt < AUDIO_S * 1000, "the count line waited for the dropped question");
  assert.equal(c.ws.of("say")[2].kind, "reaction");
  await waitFor("the end question", () => c.ws.of("ask").length === 2);
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
  await heardOut(c, "the count line");
  await heardOut(c, "the end question");
  w.says("When it smells nutty");
  await heardOut(c, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the end", () => c.ws.phases().includes("ended"), 120_000);
  assert.deepEqual(w.voices.map((v) => v.kind), ["intro", "amount", "reaction", "end", "optin", "closing"]);
  assert.ok(w.voices.every((v) => v.voice === env.homieVoice && v.language === "en"));
});

test("a socket closed during the wrap-up writes nothing more; the reconnect finishes it once, with the same questions", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const a = w.connect("rec-closed-wrap");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  a.send({ type: "done" });
  await waitFor("the first end question", () => a.ws.of("ask").length === 1);
  assert.equal(a.ws.of("ask")[0].textEn, "How do you know the dal is done?", "no lead-in: the count line said it");
  assert.deepEqual(a.ws.of("hold"), [{ type: "hold", on: true }]);
  // Claude would write a new one by now: the reconnect still asks the second of the two it counted.
  w.endQuestions.splice(1, 1, { kind: "cue", line: line("A question nobody counted?") });
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
  // The new socket holds homie in the middle again, right after ready and phase; no second count line.
  const opening = b.ws.events.filter((e) => e.type !== "state").slice(0, 3);
  assert.deepEqual(opening.map((e) => [e.type, e.on]), [["ready", undefined], ["phase", undefined], ["hold", true]]);
  assert.ok(b.ws.eventsAt[b.ws.events.indexOf(opening[2])] - b.ws.eventsAt[0] < 100, "hold on came right away");
  assert.deepEqual(b.ws.of("say").map((e) => e.kind), ["end"]);
  w.says("Butter works too");
  await heardOut(b, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the end", () => b.ws.phases().includes("ended"), 60_000);

  assert.deepEqual(w.endCalls, [{ asked: [], max: 2 }], "Claude wrote the end questions once");
  assert.deepEqual(b.ws.of("ask").map((q) => [q.kind, q.textEn]), [
    ["end", "What do you use instead of ghee?"],
    ["optin", "Can Shreya hear your stories too?"],
  ]);
  assert.equal(b.ws.of("answered").length, 2);
  assert.deepEqual(w.named("setOptIn").map((c) => c.args), [[true]]);
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro", "reaction", "end", "end", "optin", "closing"]);
  assert.deepEqual(b.ws.of("hold").map((h) => h.on), [true, false]);
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
  // Done holds at once; the refused status write ends it one round trip later, off before `ended`.
  assert.deepEqual(c.ws.of("hold").map((h) => h.on), [true, false]);
  assert.deepEqual(c.ws.events.filter((e) => e.type === "hold" || e.type === "phase").slice(-2).map((e) => e.type), ["hold", "phase"]);
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

test("HOMIE_SCRIPTED: a fixed question on the clock, with no Claude deciding, even when she's ignored one", async () => {
  const w = world();
  w.deps.rules = { firstS: 10, gapS: 30, maxLive: 12, maxEnd: 2, backoff: false };
  w.deps.scripted = true;
  const c = w.connect("rec-scripted");
  await helloDone(c);
  c.send({ type: "start" });
  await waitFor("the first scripted question", () => c.ws.of("ask").length === 1, 30_000);
  const first = c.ws.of("ask")[0];
  assert.equal(first.kind, "amount");
  assert.match(String(first.textEn), /what did you just add, and about how much\?/);
  assert.equal(w.decided.length, 0, "Claude never decides in scripted mode");
  // No answer: it fades, and the next one still comes a single gap later (no backing off).
  await waitFor("the second scripted question", () => c.ws.of("ask").length === 2, 60_000);
  assert.equal(c.ws.of("ask")[1].kind, "story");
  assert.equal(w.named("logPrompt").filter((p) => p.args[0] === "story").length, 1, "logged like any question");
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");

test("filming in the app: the phone's frames reach Claude while fresh, and a pause keeps homie quiet", async () => {
  const w = world();
  const c = w.connect("rec-camera-frames");
  await helloDone(c);
  c.send({ type: "start", camera: true });
  await advance(1000);
  c.send({ type: "frame", jpeg: "not a jpeg" });
  c.send({ type: "frame", jpeg: JPEG });
  w.says("Now the tadka goes in");
  await waitFor("a decision", () => w.decided.some((d) => d.mayAsk), 60_000);
  assert.equal(w.decided.find((d) => d.mayAsk)!.frame, true, "a fresh picture goes with the question");

  // She left the app: nothing is decided or said until the camera films again.
  c.send({ type: "pause" });
  const before = w.decided.length;
  await advance(120_000, 1000);
  assert.equal(w.decided.length, before);
  assert.equal(c.ws.of("ask").length, 0);
  c.send({ type: "resume", gapS: 120 });
  w.says("I am back, now the dal");
  await waitFor("deciding again", () => w.decided.length > before, 60_000);
  const after = w.decided.at(-1)!;
  assert.equal(after.frame, false, "the picture from before the pause is stale");
  c.drop();
});

test("a pause moves every later atS back onto the video's clock, and homie's spans are saved", async () => {
  const w = world();
  w.decisions.push(ask("How much salt was that?"));
  const c = w.connect("rec-camera-gap");
  await helloDone(c);
  c.send({ type: "start", camera: true });
  await advance(1000);
  c.send({ type: "pause" });
  await advance(60_000);
  c.send({ type: "resume", gapS: 60 });
  w.says("A pinch of salt");
  await waitFor("the question", () => c.ws.of("say_end").length === 2, 60_000);
  await advance(AUDIO_S * 1000 + 500);

  const q = w.logged.find((p) => p.kind === "amount")!;
  // About 30 s of video (the decide wait after the resume), not 90 s of wall time.
  assert.ok(q.atS > 10 && q.atS < 40, `atS ${q.atS} is on the video's clock`);
  const said = w.named("promptSaid")[0]?.args[1] as { atS: number; endS: number };
  assert.ok(said && said.atS >= q.atS && said.endS > said.atS, "the question's voice span is saved");
  assert.ok(w.logged.find((p) => p.kind === "intro")!.said!.endS < 0, "the hello played before filming started");
  c.drop();
});

test("filmed in the app, the end asks for the plate photo after the opt-in; the phone's ok thanks her, then goodbye", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const c = w.connect("rec-camera-plate");
  await helloDone(c);
  c.send({ type: "start", camera: true });
  await advance(1000);
  c.send({ type: "done" });
  await heardOut(c, "the count line");
  assert.equal(w.spoken[1], "Before we send it, one quick question and a photo of your plate.");
  await heardOut(c, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the plate ask", () => c.ws.of("ask").some((a) => a.kind === "plate"), 60_000);
  const plate = c.ws.of("ask").find((a) => a.kind === "plate")!;
  assert.match(String(plate.textEn), /plate up to the camera/);
  await advance(AUDIO_S * 1000 + 500);
  c.send({ type: "plate", ok: true });
  await waitFor("the thanks", () => w.spoken.includes("Got it. Thank you!"), 30_000);
  assert.equal(c.ws.of("answered").at(-1)!.promptId, plate.promptId);
  await waitFor("the end", () => c.ws.phases().includes("ended"), 30_000);
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro", "reaction", "optin", "plate", "closing"]);
  assert.deepEqual(w.named("setOptIn").map((x) => x.args), [[true]]);
});

test("no camera (glasses or the system camera): no plate step", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const c = w.connect("rec-no-camera");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  c.send({ type: "done" });
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 60_000);
  assert.equal(c.ws.of("ask").filter((a) => a.kind === "plate").length, 0);
  c.drop();
});

test("the plate photo can be skipped by saying not now", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const c = w.connect("rec-camera-plate-skip");
  await helloDone(c);
  c.send({ type: "start", camera: true });
  await advance(1000);
  c.send({ type: "done" });
  await waitFor("the plate ask", () => c.ws.of("ask").some((a) => a.kind === "plate"), 60_000);
  const plate = c.ws.of("ask").find((a) => a.kind === "plate")!;
  await advance(AUDIO_S * 1000 + 500);
  w.says("not now");
  await waitFor("the end", () => c.ws.phases().includes("ended"), 30_000);
  assert.ok(!w.spoken.includes("Got it. Thank you!"));
  assert.ok(w.named("updatePrompt").some((u) => u.args[0] === plate.promptId && u.args[1] === "ignored"));
});

test("the plate photo taken while homie is still asking for it counts (and stops the line)", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const c = w.connect("rec-camera-plate-early");
  await helloDone(c);
  c.send({ type: "start", camera: true });
  await advance(1000);
  c.send({ type: "done" });
  await waitFor("the plate ask", () => c.ws.of("ask").some((a) => a.kind === "plate"), 60_000);
  c.send({ type: "plate", ok: true }); // the phone's shutter, before the line has played out
  await waitFor("the thanks", () => w.spoken.includes("Got it. Thank you!"), 30_000);
  assert.ok(c.ws.of("say_end").some((e) => e.interrupted), "the plate line was cut short");
  await waitFor("the end", () => c.ws.phases().includes("ended"), 30_000);
});

// ---- the wrap-up waits for her (Caleb, Oct 24: "you have to give time for the person to actually respond") ----

/** Starts filming, says done, and waits until the first end question has finished playing on the phone. */
async function firstEndQuestion(w: ReturnType<typeof world>, id: string) {
  const c = w.connect(id);
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  w.says("Now the tadka goes in"); // her speech-to-text works
  await advance(ANSWER_GAP_MS["gemini-live"]);
  c.send({ type: "done" });
  await waitFor("the end question", () => c.ws.of("ask").some((a) => a.kind === "end"), 60_000);
  const n = w.spokenAt.length - 1;
  await waitFor("the end question played", () => w.spokenAt.length === n + 1 && Date.now() >= w.playedAt(n), 30_000);
  return { c, question: c.ws.of("ask").find((a) => a.kind === "end")!, n };
}

const STILL_THERE = "Still there, Rajani Aaji? Take your time. I'm listening.";
const LET_OFF = "That's okay, Rajani Aaji. No need to answer today. All good, let's finish up.";

test("an answer in two parts with a 2 s pause is one answer: homie doesn't move on mid-answer", async () => {
  const w = world();
  const { c, question } = await firstEndQuestion(w, "rec-two-part");
  await advance(1000);
  w.says("Hmm, the dal...");
  const asksBefore = c.ws.of("ask").length;
  const linesBefore = w.spoken.length;
  await advance(2000); // she stops to think
  assert.equal(c.ws.of("ask").length, asksBefore, "no next question in her pause");
  assert.equal(w.spoken.length, linesBefore, "homie says nothing in her pause");
  w.says("you know it's done when it smells nutty.");
  const lastWords = Date.now();

  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 30_000);
  const waited = Date.now() - lastWords;
  assert.ok(waited >= ANSWER_GAP_MS["ink-2"] && waited < ANSWER_GAP_MS["ink-2"] + 600, `the next question came ${waited} ms after her last words`);
  assert.deepEqual(c.ws.of("answered").map((a) => a.promptId), [question.promptId]);
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.answers.map((a) => [a.promptId, a.transcript]), [[question.promptId, "Hmm, the dal... you know it's done when it smells nutty."]]);
  assert.ok(!w.spoken.includes(STILL_THERE), "she answered: no nudge");
  c.drop();
});

test("a long answer with many pauses is never cut off (no 15 s cap)", async () => {
  const w = world();
  const { c, question } = await firstEndQuestion(w, "rec-long-answer");
  await advance(4000); // she thinks first: no nudge before 5 s
  assert.ok(!w.spoken.includes(STILL_THERE));
  for (let i = 0; i < 10; i++) {
    w.says(`part ${i + 1}`);
    await advance(2500);
    assert.ok(!c.ws.of("ask").some((a) => a.kind === "optin"), `homie moved on during her answer (part ${i + 1})`);
  }
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 30_000);
  await advance(LATENCY_MS + 50);
  assert.equal(w.answers[0].promptId, question.promptId);
  assert.equal(w.answers[0].transcript.split("part").length - 1, 10, "all ten parts in one answer");
  c.drop();
});

test("silence: 'still there?' 5 s after the question played, a kind let-off 5 s after that, then no more questions", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const { c, question, n } = await firstEndQuestion(w, "rec-silent");
  await waitFor("the nudge", () => w.spoken.length > n + 1, 30_000);
  assert.equal(w.spoken[n + 1], STILL_THERE);
  const nudgeAfter = w.spokenAt[n + 1] - w.playedAt(n);
  assert.ok(nudgeAfter >= SILENT_MS && nudgeAfter < SILENT_MS + 300, `the nudge came ${nudgeAfter} ms after the question played`);
  assert.equal(c.ws.of("drop").length, 0, "the question is still up while homie waits");

  await waitFor("the let-off", () => w.spoken.length > n + 2, 30_000);
  assert.equal(w.spoken[n + 2], LET_OFF);
  const letOffAfter = w.spokenAt[n + 2] - w.playedAt(n + 1);
  assert.ok(letOffAfter >= SILENT_MS && letOffAfter < SILENT_MS + 300, `the let-off came ${letOffAfter} ms after the nudge played`);
  assert.equal(c.ws.of("drop").at(-1)!.promptId, question.promptId);

  await waitFor("the end", () => c.ws.phases().includes("ended"), 60_000);
  assert.equal(w.spoken.at(-1), "That's a wrap! Shreya is going to hear every bit of this. Thank you for sharing it.");
  assert.deepEqual(c.ws.of("ask").map((a) => a.kind), ["end"], "no second end question, no opt-in");
  assert.deepEqual(w.named("setOptIn"), [], "the opt-in stays unset");
  assert.deepEqual(w.named("updatePrompt").map((u) => u.args), [[question.promptId, "ignored"]]);
  assert.deepEqual(
    w.logged.filter((p) => p.kind === "reaction").map((p) => [p.textEn, !!p.said]),
    [["Just three quick questions before we send it.", true], [STILL_THERE, true], [LET_OFF, true]],
  );
  // "Still there?" and the let-off come inside the hold; it ends once the let-off has played, with the goodbye.
  const holds = c.ws.events.flatMap((e, i) => (e.type === "hold" ? [{ on: e.on, at: c.ws.eventsAt[i], i }] : []));
  assert.deepEqual(holds.map((h) => h.on), [true, false]);
  assert.ok(holds[1].at >= w.playedAt(n + 2), "hold off before the let-off had played");
  assert.equal(c.ws.events.slice(holds[1].i + 1).find((e) => e.type === "say")!.kind, "closing");
});

test("talking after 'still there?' is waited for, and the questions go on", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const { c, question, n } = await firstEndQuestion(w, "rec-after-nudge");
  await waitFor("the nudge", () => w.spoken[n + 1] === STILL_THERE, 30_000);
  await waitFor("the nudge played", () => Date.now() >= w.playedAt(n + 1), 30_000);
  await advance(4000); // nearly the let-off, then she answers
  w.says("Oh, sorry. When it turns golden");
  await advance(2000);
  w.says("and the cumin crackles.");
  const lastWords = Date.now();
  await waitFor("the second question", () => c.ws.of("ask").length === 2, 30_000);
  assert.ok(Date.now() - lastWords >= ANSWER_GAP_MS["ink-2"]);
  assert.equal(c.ws.of("ask")[1].textEn, "What do you use instead of ghee?");
  assert.ok(!w.spoken.includes(LET_OFF));
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.answers.map((a) => a.transcript), ["Oh, sorry. When it turns golden and the cumin crackles."]);
  assert.equal(c.ws.of("answered")[0].promptId, question.promptId);
  c.drop();
});

test("Marathi (Gemini Live) waits longer after her last words than English (Ink 2)", async () => {
  assert.ok(ANSWER_GAP_MS["gemini-live"] > ANSWER_GAP_MS["ink-2"]);
  const waits: Record<string, number> = {};
  for (const language of ["en", "mr"]) {
    const w = world("intro", undefined, language);
    const { c } = await firstEndQuestion(w, `rec-gap-${language}`);
    w.says("When it smells nutty.");
    const lastWords = Date.now();
    await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 30_000);
    waits[language] = Date.now() - lastWords;
    if (language === "mr") assert.match(String(c.ws.of("ask").at(-1)!.text), /ऐकू द्यायच्या का/);
    c.drop();
  }
  assert.ok(waits.mr >= ANSWER_GAP_MS["gemini-live"], `Marathi waited ${waits.mr} ms`);
  assert.ok(waits.en >= ANSWER_GAP_MS["ink-2"] && waits.en < ANSWER_GAP_MS["gemini-live"], `English waited ${waits.en} ms`);
});

test("Marathi: 'still there?' and the let-off in her language", async () => {
  const w = world("intro", undefined, "mr");
  const { n } = await firstEndQuestion(w, "rec-silent-mr");
  await waitFor("the let-off", () => w.spoken.length > n + 2, 60_000);
  assert.equal(w.spoken[n + 1], "Rajani Aaji, आहात ना? सावकाश सांगा, मी ऐकतेय.");
  assert.match(w.spoken[n + 2], /^काही हरकत नाही, Rajani Aaji\./);
  // The count line, then "still there?" (saved in English).
  assert.deepEqual(w.logged.filter((p) => p.kind === "reaction").map((p) => p.textEn).slice(0, 2), ["Just two quick questions before we send it.", STILL_THERE]);
});

test("her words still on their way: sound on the mic and an open turn hold 'still there?'", async () => {
  const w = world();
  const { c, n } = await firstEndQuestion(w, "rec-hold-nudge");
  await advance(4500);
  // She starts talking at 4.5 s; her first words show ~1 s later (Gemini Live's lag).
  for (let i = 0; i < 12; i++) {
    c.mic(true);
    await advance(100);
  }
  w.stt().onTurnStart();
  w.partial("When the");
  await advance(1000);
  w.stt().onTurnEnd("When the oil separates.");
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 30_000);
  assert.ok(!w.spoken.includes(STILL_THERE), "homie talked over her first words");
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.answers.map((a) => a.transcript), ["When the oil separates."]);
  assert.equal(w.spoken.length, n + 2, "the opt-in came next");
  c.drop();
});

test("a turn with no words (a cough, the pan) isn't an answer", async () => {
  const w = world();
  const { c, question, n } = await firstEndQuestion(w, "rec-noise-turn");
  await advance(500);
  w.stt().onTurnStart();
  w.stt().onTurnEnd("");
  await waitFor("the nudge", () => w.spoken.length > n + 1, 30_000);
  assert.equal(w.spoken[n + 1], STILL_THERE);
  assert.equal(c.ws.of("answered").length, 0);
  assert.ok(!w.named("updatePrompt").some((u) => u.args[0] === question.promptId), "not saved as answered");
  c.drop();
});

test("loud kitchen noise with no words holds 'still there?' only a little", async () => {
  const w = world();
  const { c, n } = await firstEndQuestion(w, "rec-noise-mic");
  const from = Date.now();
  while (w.spoken.length === n + 1) {
    c.mic(true); // the extractor fan, the whole time
    await advance(100);
    assert.ok(Date.now() - from < 15_000, "no nudge in a noisy kitchen");
  }
  assert.equal(w.spoken[n + 1], STILL_THERE);
  c.drop();
});

test("the plate skipped with a spoken 'not now' and more: the goodbye waits for the rest", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const c = w.connect("rec-plate-not-now-more");
  await helloDone(c);
  c.send({ type: "start", camera: true });
  await advance(1000);
  c.send({ type: "done" });
  await heardOut(c, "the count line");
  await heardOut(c, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the plate ask", () => c.ws.of("ask").some((a) => a.kind === "plate"), 60_000);
  await advance(AUDIO_S * 1000 + 500);
  w.says("not now");
  await advance(2000);
  assert.ok(!c.ws.of("say").some((s) => s.kind === "closing"), "the goodbye started while she was still talking");
  w.says("I'll take a nicer one tomorrow, the plate is a mess.");
  const lastWords = Date.now();
  await waitFor("the goodbye", () => c.ws.of("say").some((s) => s.kind === "closing"), 30_000);
  assert.ok(Date.now() - lastWords >= ANSWER_GAP_MS["ink-2"]);
  await waitFor("the end", () => c.ws.phases().includes("ended"), 60_000);
  assert.deepEqual(w.named("setOptIn").map((x) => x.args), [[true]]);
});

// ---- review fixes (Oct 24) ----

/** Seconds into the recording, as record.ts's atS. */
const atS = (w: ReturnType<typeof world>, ms: number) => Math.round((ms - w.row.startedAt!) / 100) / 10;

test("the 5 s count from when the phone has played the question, which it plays only once it has all of it", async () => {
  const w = world();
  const { question, n } = await firstEndQuestion(w, "rec-played-on-phone");
  const sayEnd = w.spokenAt[n] + MAKE_MS;
  await waitFor("the nudge", () => w.spoken.length > n + 1, 30_000);
  const after = w.spokenAt[n + 1] - (sayEnd + PLAYER_LOAD_MS + AUDIO_S * 1000);
  assert.ok(after >= SILENT_MS && after < SILENT_MS + 300, `the nudge came ${after} ms after the phone finished the question`);
  // The question's saved span is when the phone played it, too.
  const said = w.named("promptSaid").find((p) => p.args[0] === question.promptId)!.args[1] as { atS: number; endS: number };
  assert.equal(said.atS, atS(w, sayEnd + PLAYER_LOAD_MS));
  assert.equal(Math.round((said.endS - said.atS) * 10) / 10, AUDIO_S);
});

test("'not now' tapped while homie still asks: the line stops, that question is skipped at once, the next one comes", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const c = w.connect("rec-tap-not-now");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  w.says("Now the tadka goes in");
  await advance(4000);
  c.send({ type: "done" });
  await waitFor("the end question", () => c.ws.of("ask").some((a) => a.kind === "end"), 60_000);
  const first = c.ws.of("ask")[0];
  await advance(MAKE_MS + 1000); // the phone is playing it
  const endsBefore = c.ws.of("say_end").length;
  c.send({ type: "text", text: "not now" }); // the card's tap
  const tappedAt = Date.now();
  await settle();
  assert.equal(c.ws.of("say_end").length, endsBefore + 1, "the line was stopped");
  assert.equal(c.ws.of("say_end").at(-1)!.interrupted, true);
  await waitFor("the second question", () => c.ws.of("ask").length === 2, 10_000);
  assert.ok(Date.now() - tappedAt < 1000, `the next question waited ${Date.now() - tappedAt} ms after the tap`);
  assert.equal(c.ws.of("ask")[1].textEn, "What do you use instead of ghee?");
  assert.equal(c.ws.of("drop")[0].promptId, first.promptId);
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.named("updatePrompt").map((u) => u.args), [[first.promptId, "not_now"]]);
  assert.ok(!w.spoken.includes(STILL_THERE) && !w.spoken.includes(LET_OFF), "a skip is no let-off");
  c.drop();
});

test("'not now' tapped, then she talks to family: nothing she says answers the skipped question", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const { c, question } = await firstEndQuestion(w, "rec-tap-then-talk");
  await advance(500);
  c.send({ type: "text", text: "not now" });
  w.says("Beta, bring the plates, the food is getting cold"); // as she taps
  const talkedAt = Date.now();
  await waitFor("the second question", () => c.ws.of("ask").length === 2, 30_000);
  assert.ok(Date.now() - talkedAt >= ANSWER_GAP_MS["ink-2"], "homie waited for her to finish talking");
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.answers, [], "no answer saved");
  assert.deepEqual(w.named("updatePrompt").map((u) => u.args), [[question.promptId, "not_now"]]);
  c.drop();
});

test("'not now' said as her first words skips the question; 'later' at the end of an answer doesn't", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const { c, question } = await firstEndQuestion(w, "rec-said-not-now");
  w.says("Not now");
  await advance(150);
  assert.equal(c.ws.of("drop").at(-1)?.promptId, question.promptId, "skipped at once");
  await waitFor("the second question", () => c.ws.of("ask").length === 2, 30_000);
  await waitFor("it played", () => Date.now() >= w.playedAt(w.spokenAt.length - 1), 30_000);
  w.says("Butter works too.");
  await advance(1500);
  w.says("I'll tell you more later");
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 30_000);
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.answers.map((a) => a.transcript), ["Butter works too. I'll tell you more later"]);
  assert.ok(!w.spoken.includes(STILL_THERE));
  c.drop();
});

test("her words that come while 'still there?' plays still answer the question: no let-off", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const { c, question, n } = await firstEndQuestion(w, "rec-words-during-nudge");
  await waitFor("the nudge", () => w.spoken[n + 1] === STILL_THERE, 30_000);
  w.says("When it smells nutty."); // she started just before; her words show up late
  await waitFor("the second question", () => c.ws.of("ask").length === 2, 30_000);
  assert.ok(!w.spoken.includes(LET_OFF));
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.answers.map((a) => [a.promptId, a.transcript]), [[question.promptId, "When it smells nutty."]]);
  c.drop();
});

test("the saved answer ends at her last words, not when homie stopped waiting", async () => {
  const w = world();
  const { c } = await firstEndQuestion(w, "rec-answer-end");
  w.says("Hmm, the dal...");
  await advance(2000);
  w.says("when it smells nutty.");
  const lastWords = Date.now();
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 30_000);
  await advance(LATENCY_MS + 50);
  assert.equal(w.answers[0].endS, atS(w, lastWords));
  assert.equal(w.answers[0].atS, atS(w, lastWords - 2000));
  c.drop();
});

test("turns with no words, one after another (Ink on kitchen noise), hold an answer only a little", async () => {
  const w = world();
  const { c } = await firstEndQuestion(w, "rec-noise-turns");
  w.says("When it smells nutty.");
  const answeredAt = Date.now();
  let next = 0;
  while (!c.ws.of("ask").some((a) => a.kind === "optin")) {
    if (Date.now() >= next) {
      w.stt().onTurnEnd(""); // the range hood: a turn every 2 s, ended empty
      w.stt().onTurnStart();
      next = Date.now() + 2000;
    }
    await advance(100);
    assert.ok(Date.now() - answeredAt < 10_000, "the opt-in waited on the noise");
  }
  assert.ok(Date.now() - answeredAt <= 4000 + 400, `the opt-in came ${Date.now() - answeredAt} ms after her answer`);
  c.drop();
});

test("live question: a cough (a turn with no words) doesn't stop its card from fading", async () => {
  const w = world();
  w.decisions.push(ask("How much salt is a pinch?"));
  const c = w.connect("rec-live-cough");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  w.says("Now I add a pinch of salt");
  await waitFor("the question", () => c.ws.of("ask").length === 1, 60_000);
  const q = c.ws.of("ask")[0];
  await waitFor("it played", () => Date.now() >= w.playedAt(w.spokenAt.length - 1), 30_000);
  await advance(2000);
  w.stt().onTurnStart(); // a cough
  w.stt().onTurnEnd("");
  const coughAt = Date.now();
  await waitFor("the card fading", () => c.ws.of("drop").length === 1, 15_000);
  assert.ok(Date.now() - coughAt >= 10_000 - 100, "it fades the usual 10 s after the cough");
  assert.equal(c.ws.of("drop")[0].promptId, q.promptId);
  w.says("okay now the turmeric");
  await advance(LATENCY_MS + 50);
  assert.equal(c.ws.of("answered").length, 0, "her next words aren't taken as its answer");
  c.drop();
});

test("a speech-to-text that never showed anything: a plain 15 s wait, no 'still there?' or let-off", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const c = w.connect("rec-no-stt");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  c.send({ type: "done" });
  await waitFor("the end question", () => c.ws.of("ask").length === 1, 60_000);
  const n = w.spokenAt.length - 1;
  await waitFor("it played", () => Date.now() >= w.playedAt(n), 30_000);
  await advance(14_000);
  assert.equal(c.ws.of("drop").length, 0, "still waiting at 14 s");
  await waitFor("the second question", () => c.ws.of("ask").length === 2, 5000);
  await waitFor("the end", () => c.ws.phases().includes("ended"), 120_000);
  assert.ok(!w.spoken.includes(STILL_THERE) && !w.spoken.includes(LET_OFF), "no nudge over a cook homie can't hear");
  assert.deepEqual(c.ws.of("ask").map((a) => a.kind), ["end", "end", "optin"], "every question still asked");
});

test("a speech-to-text error with nothing after it: no 'still there?' either", async () => {
  const warn = quietly();
  const w = world();
  const { c, n } = await firstEndQuestion(w, "rec-stt-error");
  w.stt().onError("gemini live: socket closed");
  await advance(SILENT_MS + 1000);
  assert.equal(w.spoken.length, n + 1, "no nudge");
  assert.equal(warn.mock.callCount(), 1);
  // It waits the plain 15 s from the question, then the opt-in comes with no let-off.
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 15_000);
  assert.ok(Date.now() - w.playedAt(n) >= 15_000);
  assert.ok(!w.spoken.includes(LET_OFF));
  c.drop();
});

test("loudness is logged per wait, so phone runs can set the voice threshold", async () => {
  const log = mock.method(console, "log", () => {});
  const w = world();
  const { c } = await firstEndQuestion(w, "rec-loudness");
  await advance(400); // the mic is muted 300 ms past homie's line
  c.mic(true);
  w.says("When it smells nutty.");
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 30_000);
  const lines = log.mock.calls.map((x) => String(x.arguments[0])).filter((m) => m.startsWith("wrap-up mic:"));
  assert.match(lines[0], /^wrap-up mic: loudest 3000 rms \(-20\.8 dBFS\), voice above 400 \(-38\.3 dBFS\)$/);
  c.drop();
});

// ---- second review (Oct 24): talk from before a question never answers it ----

test("an afterthought she started just as homie asked doesn't answer the new question", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const { c } = await firstEndQuestion(w, "rec-afterthought");
  w.says("When it smells nutty.");
  await waitFor("the second question being saved", () => w.named("logPrompt").filter((p) => p.args[0] === "end").length === 2, 30_000);
  // She adds a few words as homie starts; the mic is muted under homie's line, so her turn ends during it.
  w.stt().onTurnStart();
  w.partial("and a little");
  await waitFor("the second question", () => c.ws.of("ask").length === 2, 5000);
  await advance(1500);
  w.stt().onTurnEnd("and a little salt");
  const n = w.spokenAt.length - 1;
  await waitFor("it played", () => Date.now() >= w.playedAt(n), 30_000);
  await waitFor("the nudge", () => w.spoken.length > n + 1, 30_000);
  assert.equal(w.spoken[n + 1], STILL_THERE, "the second question still waits for its own answer");
  assert.ok(w.spokenAt[n + 1] - w.playedAt(n) >= SILENT_MS);
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.answers.map((a) => a.transcript), ["When it smells nutty."], "the afterthought answered nothing");
  c.drop();
});

test("family talk begun before the opt-in and ending under it doesn't decide the opt-in", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const c = w.connect("rec-family-optin");
  await helloDone(c);
  c.send({ type: "start" });
  await advance(1000);
  w.says("Now the tadka goes in");
  await advance(5000);
  c.send({ type: "done" });
  await waitFor("the opt-in being saved", () => w.named("logPrompt").some((p) => p.args[0] === "optin"), 30_000);
  w.stt().onTurnStart(); // someone in the kitchen, as homie starts asking
  w.partial("No, beta, come");
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 5000);
  await advance(1000);
  w.stt().onTurnEnd("No, beta, come and eat");
  const n = w.spokenAt.length - 1;
  await waitFor("it played", () => Date.now() >= w.playedAt(n) + 1000, 30_000);
  assert.deepEqual(w.named("setOptIn"), [], "nothing decided yet");
  w.says("Yes, of course");
  await waitFor("the end", () => c.ws.phases().includes("ended"), 60_000);
  assert.deepEqual(w.named("setOptIn").map((x) => x.args), [[true]]);
});

test("Marathi: her answer starting just before 'still there?' (words a little late) gets no nudge", async () => {
  const w = world("intro", undefined, "mr");
  const { c, n } = await firstEndQuestion(w, "rec-mr-just-in-time");
  await advance(4900);
  w.stt().onTurnStart();
  w.partial("जेव्हा");
  await advance(1500);
  w.stt().onTurnEnd("जेव्हा वास येतो");
  await waitFor("the opt-in", () => c.ws.of("ask").some((a) => a.kind === "optin"), 60_000);
  assert.ok(!w.spoken.slice(n + 1).includes("Rajani Aaji, आहात ना? सावकाश सांगा, मी ऐकतेय."), "no nudge over her");
  await advance(LATENCY_MS + 50);
  assert.deepEqual(w.answers.map((a) => a.transcript), ["जेव्हा वास येतो"]);
  c.drop();
});

test("a quick reply right after the line reaches her speech-to-text (the mute ends when the phone can have finished)", async () => {
  const w = world();
  const { c, n } = await firstEndQuestion(w, "rec-quick-reply");
  // The phone may load the line faster than the 250 ms homie allows: the mic is live from say_end + its length.
  const earliest = w.spokenAt[n] + MAKE_MS + AUDIO_S * 1000;
  assert.ok(Date.now() >= earliest);
  const before = w.heardAudioAt.length;
  c.mic(true);
  assert.equal(w.heardAudioAt.length, before + 1, "her first syllable was muted");
  c.drop();
});

test("'still there?' held by noise is said later, and the let-off never comes without it", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const { c, n } = await firstEndQuestion(w, "rec-noise-then-letoff");
  await advance(4500);
  // The extractor fan comes on and stays on, loud, with no words; at 8.4 s Ink opens a turn on it. So the first wait
  // runs to its cap (9 s) while she may still be talking, and "still there?" waits for another round.
  let turnOpened = false;
  while (!w.spoken.includes(LET_OFF) && !c.ws.phases().includes("ended")) {
    c.mic(true);
    await advance(100);
    if (!turnOpened && Date.now() - w.playedAt(n) >= 8400) {
      turnOpened = true;
      w.stt().onTurnStart();
    }
    assert.ok(Date.now() - w.playedAt(n) < 60_000, "stuck");
  }
  const nudge = w.spoken.indexOf(STILL_THERE);
  assert.ok(nudge > n && nudge < w.spoken.indexOf(LET_OFF), `the let-off came without "still there?" first: ${JSON.stringify(w.spoken.slice(n + 1))}`);
  assert.ok(w.spokenAt[nudge] - w.playedAt(n) > SILENT_MS + 4000, "the nudge waited for the noise round");
  c.drop();
});

// ---- the count line and the hold (Caleb, Oct 25: "homie should specify the number of questions it has", and "homie
// should STAY in center expanded view until all questions are finished") ----

test("the count: end questions left plus the opt-in, and the plate photo when filmed in the app, in English and Marathi", async () => {
  const en: Who = { language: "en", call: "Rajani Aaji", kid: "Shreya", dish: "Dal Tadka" };
  const mr: Who = { ...en, language: "mr" };
  // [end questions left, opt-in done, filmed in the app] → the line in English, in Marathi (null: no count line)
  const cases: [number, boolean, boolean, string | null, string | null][] = [
    [0, false, false, "Just one quick question before we send it.", "पाठवण्याआधी फक्त एक छोटा प्रश्न."],
    [0, false, true, "Before we send it, one quick question and a photo of your plate.", "पाठवण्याआधी एक छोटा प्रश्न, आणि तुमच्या ताटाचा एक फोटो."],
    [0, true, false, null, null],
    [0, true, true, "Before we send it, one photo of your plate.", "पाठवण्याआधी तुमच्या ताटाचा एक फोटो."],
    [1, false, false, "Just two quick questions before we send it.", "पाठवण्याआधी फक्त दोन छोटे प्रश्न."],
    [1, false, true, "Before we send it, two quick questions and a photo of your plate.", "पाठवण्याआधी दोन छोटे प्रश्न, आणि तुमच्या ताटाचा एक फोटो."],
    [1, true, false, "Just one quick question before we send it.", "पाठवण्याआधी फक्त एक छोटा प्रश्न."],
    [1, true, true, "Before we send it, one quick question and a photo of your plate.", "पाठवण्याआधी एक छोटा प्रश्न, आणि तुमच्या ताटाचा एक फोटो."],
    [2, false, false, "Just three quick questions before we send it.", "पाठवण्याआधी फक्त तीन छोटे प्रश्न."],
    [2, false, true, "Before we send it, three quick questions and a photo of your plate.", "पाठवण्याआधी तीन छोटे प्रश्न, आणि तुमच्या ताटाचा एक फोटो."],
    [2, true, false, "Just two quick questions before we send it.", "पाठवण्याआधी फक्त दोन छोटे प्रश्न."],
    [2, true, true, "Before we send it, two quick questions and a photo of your plate.", "पाठवण्याआधी दोन छोटे प्रश्न, आणि तुमच्या ताटाचा एक फोटो."],
  ];
  for (const [endLeft, optInDone, camera, wantEn, wantMr] of cases) {
    const { questions, photo } = wrapUpCount(endLeft, { optInDone, letOff: false, camera, plateDone: false });
    assert.equal(questions, endLeft + (optInDone ? 0 : 1));
    assert.equal(photo, camera);
    const said = await countLine(questions, photo, en);
    const saidMr = await countLine(questions, photo, mr);
    const what = `${endLeft} end, opt-in ${optInDone ? "done" : "left"}, camera ${camera}`;
    assert.equal(said?.text ?? null, wantEn, what);
    assert.equal(said?.textEn ?? null, wantEn, what);
    assert.equal(saidMr?.text ?? null, wantMr, what);
    assert.equal(saidMr?.textEn ?? null, wantEn, `${what}: saved in English`);
    if (wantEn) {
      assert.ok(wantEn.split(" ").length <= 14, `${what}: short`);
      assert.doesNotMatch(wantEn, /\b(last|more|another)\b/i, `${what}: nothing a later line contradicts`);
    }
  }
  // After a let-off nothing spoken is left (the plate photo still is); once the photo is taken, nothing.
  assert.deepEqual(wrapUpCount(2, { optInDone: false, letOff: true, camera: true, plateDone: false }), { questions: 0, photo: true });
  assert.deepEqual(wrapUpCount(0, { optInDone: true, letOff: false, camera: true, plateDone: true }), { questions: 0, photo: false });
});

/** The wrap-up as the phone sees it, from the phase on: homie's lines, its cards and the holds. */
const afterDone = (c: Phone) =>
  c.ws.events
    .slice(c.ws.events.findIndex((e) => e.phase === "wrapping_up"))
    .filter((e) => ["hold", "say", "ask", "answered", "drop", "phase"].includes(e.type))
    .map((e) => (e.type === "hold" ? `hold ${e.on ? "on" : "off"}` : e.type === "phase" ? `phase ${e.phase}` : e.kind ? `${e.type} ${e.kind}` : e.type));

test("filmed in the app: the count line, the questions back to back inside the hold, then the plate photo and goodbye", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const c = w.connect("rec-order");
  await helloDone(c);
  c.send({ type: "start", camera: true });
  await advance(1000);
  c.send({ type: "done" });
  await heardOut(c, "the count line");
  assert.equal(w.spoken[1], "Before we send it, three quick questions and a photo of your plate.");
  await heardOut(c, "the first end question");
  w.says("When it smells nutty.");
  await heardOut(c, "the second end question");
  w.says("Butter works too.");
  await heardOut(c, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the plate ask", () => c.ws.of("ask").some((a) => a.kind === "plate"), 30_000);
  await advance(1000);
  c.send({ type: "plate", ok: true });
  await waitFor("the end", () => c.ws.phases().includes("ended"), 60_000);

  assert.deepEqual(afterDone(c), [
    "phase wrapping_up",
    "hold on",
    "say reaction", // the count line
    "ask end", "say end", "answered",
    "ask end", "say end", "answered",
    "ask optin", "say optin", "answered",
    "hold off",
    "ask plate", "say plate", "answered",
    "say reaction", // "Got it. Thank you!"
    "say closing",
    "phase ended",
  ]);
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro", "reaction", "end", "end", "optin", "plate", "closing"]);
  assert.equal(w.logged[1].textEn, "Before we send it, three quick questions and a photo of your plate.");
  assert.ok(w.logged[1].said, "the count line's voice span is saved");
});

test("no camera, in Marathi: the count line in her language, and the hold ends right before the goodbye", async () => {
  const w = world("intro", undefined, "mr");
  const { c } = await firstEndQuestion(w, "rec-order-mr");
  assert.deepEqual(
    w.voices.map((v, i) => [v.kind, w.spoken[i]]).filter(([kind]) => kind === "reaction"),
    [["reaction", "पाठवण्याआधी फक्त दोन छोटे प्रश्न."]],
  );
  w.says("जेव्हा वास येतो");
  await waitFor("the opt-in played", () => c.ws.of("ask").some((a) => a.kind === "optin") && Date.now() >= w.playedAt(w.spokenAt.length - 1), 30_000);
  w.says("हो");
  await waitFor("the end", () => c.ws.phases().includes("ended"), 60_000);
  assert.deepEqual(afterDone(c), [
    "phase wrapping_up",
    "hold on",
    "say reaction",
    "ask end", "say end", "answered",
    "ask optin", "say optin", "answered",
    "hold off",
    "say closing",
    "phase ended",
  ]);
  assert.equal(w.logged.find((p) => p.kind === "reaction")!.textEn, "Just two quick questions before we send it.");
});

test("after a let-off, filmed in the app: the hold ends once the let-off has played, then the plate photo still comes", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const c = w.connect("rec-letoff-plate");
  await helloDone(c);
  c.send({ type: "start", camera: true });
  await advance(1000);
  w.says("Now the tadka goes in"); // her speech-to-text works
  await advance(ANSWER_GAP_MS["ink-2"]);
  c.send({ type: "done" });
  await waitFor("the plate ask", () => c.ws.of("ask").some((a) => a.kind === "plate"), 90_000);
  const letOff = w.spoken.indexOf(LET_OFF);
  const off = c.ws.events.findIndex((e) => e.type === "hold" && !e.on);
  assert.ok(letOff > 0 && c.ws.eventsAt[off] >= w.playedAt(letOff), "hold off before the let-off had played");
  await advance(1000);
  c.send({ type: "plate", ok: true });
  await waitFor("the end", () => c.ws.phases().includes("ended"), 60_000);
  assert.deepEqual(afterDone(c), [
    "phase wrapping_up",
    "hold on",
    "say reaction", // the count line
    "ask end", "say end",
    "say reaction", // still there?
    "drop",
    "say reaction", // the let-off
    "hold off",
    "ask plate", "say plate", "answered",
    "say reaction",
    "say closing",
    "phase ended",
  ]);
  assert.equal(w.spoken[w.voices.findIndex((v) => v.kind === "reaction")], "Before we send it, three quick questions and a photo of your plate.");
  assert.deepEqual(w.named("setOptIn"), []);
});

test("a reconnect after the questions (during the plate photo): no hold and no count line, the plate again, goodbye", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const a = w.connect("rec-reconnect-plate");
  await helloDone(a);
  a.send({ type: "start", camera: true });
  await advance(1000);
  a.send({ type: "done" });
  await heardOut(a, "the count line");
  await heardOut(a, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the plate ask", () => a.ws.of("ask").some((x) => x.kind === "plate"), 30_000);
  assert.deepEqual(a.ws.of("hold").map((h) => h.on), [true, false]);
  a.drop();
  await advance(5000);

  const b = w.connect("rec-reconnect-plate");
  await waitFor("the plate ask again", () => b.ws.of("ask").some((x) => x.kind === "plate"), 30_000);
  await advance(1000);
  b.send({ type: "plate", ok: true });
  await waitFor("the end", () => b.ws.phases().includes("ended"), 60_000);
  assert.deepEqual(b.ws.of("hold"), [], "nothing spoken is left to hold for");
  assert.deepEqual(afterDone(b), ["phase wrapping_up", "ask plate", "say plate", "answered", "say reaction", "say closing", "phase ended"]);
  assert.deepEqual(w.named("setOptIn").map((x) => x.args), [[true]], "the opt-in isn't asked again");
});

// ---- second review (Oct 25) ----

test("done while homie is still making a live question: its say_end, then the hold, then the card's drop", async () => {
  const w = world();
  w.decisions.push(ask("How much salt is a pinch?"));
  const c = w.connect("rec-done-making");
  await helloDone(c);
  c.send({ type: "start" });
  await waitFor("the question being made", () => c.ws.of("say").length === 2 && c.ws.of("say_end").length === 1, 60_000);
  const before = c.ws.events.length;
  const frames = c.ws.frames.length;
  c.send({ type: "done" });
  await settle();
  const after = c.ws.events.slice(before);
  assert.deepEqual(after.slice(0, 4).map((e) => [e.type, e.on ?? e.interrupted]), [["phase", undefined], ["say_end", true], ["hold", true], ["drop", undefined]]);
  await advance(500);
  assert.equal(c.ws.of("say_end").length, 2, "the stopped line has one say_end");
  assert.equal(c.ws.frames.length, frames, "no audio after its say_end");
  c.drop();
});

test("ended underneath while homie is still making the count line: its say_end first, then hold off and ended", async () => {
  const warn = quietly();
  const w = world();
  const a = w.connect("rec-ended-mid-count");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  a.send({ type: "done" });
  await waitFor("the count line being made", () => a.ws.of("say").some((s) => s.kind === "reaction"), 30_000);
  const say = a.ws.events.findIndex((e) => e.type === "say" && e.kind === "reaction");
  w.row.status = "ended"; // the app's stop button, while it couldn't reach us; a new socket finds out
  const b = w.connect("rec-ended-mid-count");
  await waitFor("the close", () => a.ws.closeCode === 4404, 5000);
  assert.deepEqual(
    a.ws.events.slice(say + 1).filter((e) => e.type !== "state").map((e) => [e.type, e.interrupted ?? e.on ?? e.phase]),
    [["say_end", true], ["hold", false], ["phase", "ended"]],
  );
  await advance(2000);
  assert.equal(b.ws.closeCode, 4404);
  assert.equal(warn.mock.callCount(), 0);
});

test("a reconnect while the count line plays: it's said again, with the same count and the same questions", async () => {
  const w = world();
  w.endQuestions.push({ kind: "cue", line: line("What do you use instead of ghee?") });
  const a = w.connect("rec-count-reconnect");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  a.send({ type: "done" });
  await waitFor("the count line made", () => a.ws.of("say_end").length === 2, 30_000);
  await advance(1000); // the phone is playing it
  a.drop();
  await advance(3000);

  const b = w.connect("rec-count-reconnect");
  await heardOut(b, "the count line again");
  await heardOut(b, "the first end question");
  w.says("When it smells nutty.");
  await heardOut(b, "the second end question");
  w.says("Butter works too.");
  await heardOut(b, "the opt-in");
  w.says("Yes, of course");
  await waitFor("the end", () => b.ws.phases().includes("ended"), 60_000);
  assert.equal(w.spoken.filter((s) => s === "Just three quick questions before we send it.").length, 2);
  assert.equal(w.endCalls.length, 1, "the same questions");
  assert.deepEqual(afterDone(b), [
    "phase wrapping_up",
    "hold on",
    "say reaction",
    "ask end", "say end", "answered",
    "ask end", "say end", "answered",
    "ask optin", "say optin", "answered",
    "hold off",
    "say closing",
    "phase ended",
  ]);
  assert.deepEqual(w.named("logPrompt").map((p) => p.args[0]), ["intro", "reaction", "end", "end", "optin", "closing"], "the cut count line isn't saved");
});

test("the opt-in skipped with 'not now', then a reconnect before the goodbye: it isn't asked again, and nothing is held", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const a = w.connect("rec-optin-skip-reconnect");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  w.says("Now the tadka goes in");
  await advance(ANSWER_GAP_MS["ink-2"]);
  a.send({ type: "done" });
  await heardOut(a, "the count line");
  await waitFor("the opt-in", () => a.ws.of("ask").some((x) => x.kind === "optin"), 30_000);
  a.send({ type: "not_now" }); // the card's tap
  w.says("Beta, bring the plates, the food is getting cold"); // the goodbye waits for her
  await advance(1000);
  assert.ok(!a.ws.of("say").some((s) => s.kind === "closing"));
  a.drop();
  await advance(5000);

  const b = w.connect("rec-optin-skip-reconnect");
  await waitFor("the end", () => b.ws.phases().includes("ended"), 60_000);
  assert.deepEqual(afterDone(b), ["phase wrapping_up", "say closing", "phase ended"]);
  assert.deepEqual(w.named("updatePrompt").map((u) => u.args[1]), ["not_now"]);
  assert.deepEqual(w.named("setOptIn"), []);
});

test("an unanswered opt-in, then a reconnect during the goodbye: the goodbye again, no opt-in, nothing held", async () => {
  const w = world();
  w.endQuestions.length = 0;
  const a = w.connect("rec-optin-ignored-reconnect");
  await helloDone(a);
  a.send({ type: "start" });
  await advance(1000);
  a.send({ type: "done" }); // her speech-to-text never showed anything: a plain 15 s wait
  await waitFor("the goodbye", () => a.ws.of("say").some((s) => s.kind === "closing"), 60_000);
  a.drop();
  await advance(5000);

  const b = w.connect("rec-optin-ignored-reconnect");
  await waitFor("the end", () => b.ws.phases().includes("ended"), 60_000);
  assert.deepEqual(afterDone(b), ["phase wrapping_up", "say closing", "phase ended"]);
  assert.deepEqual(w.named("updatePrompt").map((u) => u.args[1]), ["ignored"]);
  assert.deepEqual(w.named("setOptIn"), []);
});
