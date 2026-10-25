// The kid's cooking session (cook.ts) with a fake socket, speech-to-text, voice, Claude and Convex, on a fake
// clock: every step's short line made when the recipe opens and said at once on every step change (a tap, a
// command, Claude), the app's restore step left silent, rapid flips, the cache across sessions; the story nudge
// and its yes or no; and the app's own homie moments, which keep the kid's yes or no for themselves.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { Actions } from "../src/agent.js";
import type { CookSession } from "../src/convex.js";
import type { CookingDeps } from "../src/cook.js";
import type { Route, Voice } from "../src/sonic.js";
import type { SttEvents } from "../src/stt.js";
import { advance, AUDIO_S, FakeSocket, settle, waitFor, type Ev } from "./helpers.js";

// env.ts wants these at import. Nothing here calls a real service.
process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.VOICE_STUB = "1";
const { Cooking } = await import("../src/cook.js");
const { lineCache, AHEAD_AT_ONCE, FAILED_MS } = await import("../src/lineCache.js");
const { env } = await import("../src/env.js");

beforeEach(() => {
  lineCache.clear(); // each test opens the recipe for the first time on this "instance"
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") });
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

const GREETING = "चला, स्वयंपाक करूया!";
const LINE: Record<number, string> = {
  1: "Step 1. Wash the rice three times.",
  2: "Step 2. Heat the ghee and add the cumin.",
  3: "Step 3. Simmer it for ten minutes.",
};
/** Step 3 in full, what "say that again" says there (its short line is only the first sentence). */
const WHOLE_3 = "Step 3. Simmer it for ten minutes. Stir it now and then so the rice doesn't catch on the bottom of the pot.";
const STORY = "Grandma has a story about this one. Want to hear it?";
const LINE_BYTES = AUDIO_S * 48_000;
let kids = 0;

/** Grandma's three-step recipe, with a story on step 2, for one kid. */
const session = (kidId: string, stepOrder = 1): CookSession => ({
  familyId: "fam-1",
  mossIndex: "family-fam-1",
  kid: { id: kidId, name: "Shreya" },
  cook: { name: "Grandma", language: "mr", relation: "Aaji" },
  recipe: {
    id: "recipe-1",
    title: "Varan Bhaat",
    steps: [
      { order: 1, title: "Wash the rice", text: "Wash the rice three times.", moment: { startS: 0, endS: 30 } },
      { order: 2, title: "Temper", text: "Heat the ghee and add the cumin.", moment: { startS: 30, endS: 90 } },
      { order: 3, title: "Simmer", text: WHOLE_3.slice("Step 3. ".length), moment: { startS: 90, endS: 200 } },
    ],
    memories: [{ kind: "story", text: "My mother made this every Sunday.", moment: { startS: 40, endS: 70 }, stepOrder: 2 }],
  },
  stepOrder,
});

type Speak = CookingDeps["speak"];
/** Sonic, faked: AUDIO_S of silence in `chunks` pieces, the first `firstMs` after the call, then one every 100 ms. */
const sonic =
  (firstMs = 100, chunks = 1): Speak =>
  (_text, _format, signal, onChunk) =>
    new Promise<void>((resolve) => {
      let sent = 0;
      let timer = setTimeout(function tick() {
        onChunk(Buffer.alloc(LINE_BYTES / chunks));
        if (++sent < chunks) timer = setTimeout(tick, 100);
        else resolve();
      }, firstMs);
      signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });
/** Step lines that take Sonic 8 s to start (5 pieces), so the kid can flip before they're made. Other lines as usual. */
const slowSteps: Speak = (text, format, signal, onChunk, voice) => (voice?.kind === "step" ? sonic(8000, 5) : sonic())(text, format, signal, onChunk);

/**
 * One kid's phone and backend. Every connect is the same kid (a reconnect), unless a new world is made. `claude`:
 * what the fake Claude does with a turn (nothing, by default). `speak`: the fake Sonic (done 100 ms after the call).
 */
function world(opts: { claude?: (actions: Actions) => Promise<void>; speak?: Speak; stepOrder?: number } = {}) {
  const kidId = `kid-${++kids}`;
  const spoken: string[] = []; // every line sent to Sonic, made ahead or said live
  const voices: Voice[] = []; // how each line went to Sonic
  const routes: Route[] = []; // and which voices could say it (Sonic, Gemini)
  const turns: string[] = []; // what reached Claude
  const notes: (string | undefined)[] = []; // and the service's note with each
  let inkFrames = 0;
  let stt: SttEvents | undefined;
  const fake = opts.speak ?? sonic();
  const deps: CookingDeps = {
    convex: {
      startSession: async () => session(kidId, opts.stepOrder),
      setStep: async () => {},
      logQuestion: async (_token, _recipe, _step, text, found) => ({ status: found ? "found_in_video" : "asked_cook", questionId: `q-${text}` }),
    },
    listen: (events) => {
      stt = events;
      return { send: () => void inkFrames++, close: () => {} };
    },
    speak: (text, format, signal, onChunk, voice = {}, route = {}) => {
      spoken.push(text);
      voices.push(voice);
      routes.push(route);
      return fake(text, format, signal, onChunk, voice, route);
    },
    agent: (_session, actions) => ({
      turn: async (text, note) => {
        turns.push(text);
        notes.push(note);
        await opts.claude?.(actions);
      },
    }),
    findMoments: async () => [],
    warm: async () => false,
    translateQuote: async (quote) => quote,
  };

  function connect() {
    const ws = new FakeSocket();
    const cooking = new Cooking(ws as unknown as WebSocket, "token", "recipe-1", "pcm", deps);
    void cooking.start();
    const send = (msg: object) => cooking.onMessage(Buffer.from(JSON.stringify(msg)), false);
    return {
      ws,
      send,
      /** The kid taps Next, Back or a step on the screen. */
      tap: (stepOrder: number) => send({ type: "step", stepOrder }),
      /** 100 ms of mic audio. */
      mic: () => cooking.onMessage(Buffer.alloc(3200), true),
      close: () => cooking.close(),
      /** [kind, text] of every say. */
      says: () => ws.of("say").map((s) => [s.kind, s.text]),
      /** Everything sent from here on. */
      mark: () => {
        const from = ws.events.length;
        return () => ws.events.slice(from);
      },
    };
  }
  /** The kid says something (Ink's turn ends with it). */
  const says = (text: string) => stt!.onTurnEnd(text);
  /** The short step lines that went to Sonic. */
  const stepLines = () => spoken.filter((t) => Object.values(LINE).includes(t));
  return { spoken, voices, routes, turns, notes, connect, says, stepLines, inkFrames: () => inkFrames };
}

type Phone = ReturnType<ReturnType<typeof world>["connect"]>;
const types = (evs: Ev[]) => evs.map((e) => e.type);
const sayOf = (text: string) => ({ type: "say", text, kind: "step", ai: true, audio: { format: "pcm", encoding: "pcm_s16le", sampleRate: 24000 } });

/** Waits for the hello, and for the phone to finish playing it. */
async function greeted(c: Phone) {
  await waitFor("the greeting's end", () => c.ws.of("say_end").length >= 1);
  await advance(AUDIO_S * 1000 + 500);
  assert.deepEqual(c.says()[0], ["greeting", GREETING]);
}

/** "Next." to step 2, whose line is followed by the story nudge; waits until the nudge has played. */
async function nudged(w: ReturnType<typeof world>, c: Phone) {
  w.says("Next.");
  await waitFor("the story nudge", () => c.ws.of("say").some((s) => s.kind === "nudge"));
  await waitFor("the nudge's end", () => c.ws.of("say_end").length === 3);
  await advance(AUDIO_S * 1000 + 500);
  assert.deepEqual(c.says(), [["greeting", GREETING], ["step", LINE[2]], ["nudge", STORY]]);
}

test("every step's line is made once the hello is playing: two at a time, from the step they're on, then back", async () => {
  let making = 0;
  let most = 0;
  let helloAudio = 0;
  const counting: Speak = (text, format, signal, onChunk, voice) => {
    if (voice?.kind !== "step") return sonic()(text, format, signal, (c) => ((helloAudio ||= Date.now()), onChunk(c)));
    assert.ok(helloAudio && Date.now() >= helloAudio, "not before the hello's first audio");
    most = Math.max(most, ++making);
    return sonic()(text, format, signal, onChunk).finally(() => making--);
  };
  const w = world({ speak: counting, stepOrder: 2 });
  const c = w.connect();
  await greeted(c);
  assert.deepEqual(w.spoken, [GREETING, LINE[2], LINE[3], LINE[1]], "Sonic says the hello first");
  assert.equal(most, AHEAD_AT_ONCE);
  assert.equal(AHEAD_AT_ONCE, 2);
  // In homie's voice for steps, exactly as a step said live goes; Sonic alone (no backup voice for a kept line).
  const step = { voice: env.homieVoice, language: undefined, kind: "step" };
  assert.deepEqual(w.voices, [{ voice: env.homieVoice, language: "mr", kind: "greeting" }, step, step, step]);
  const ahead = { backup: false };
  assert.deepEqual(w.routes, [{ sonic: true }, ahead, ahead, ahead]);
  // Nothing is read until a step changes.
  assert.deepEqual(c.says(), [["greeting", GREETING]]);
  assert.deepEqual(types(c.ws.events).slice(0, 2), ["ready", "go_to_step"]);
  c.close();
});

test("a tapped step says its line at once from the cache: say, all its audio, say_end, and no new Sonic call", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c); // well over 3 s after ready: a step from the phone now is a tap, not the restore
  const before = w.spoken.length;
  const since = c.mark();
  const at = Date.now();
  c.tap(3);
  await settle();
  assert.deepEqual(since(), [sayOf(LINE[3]), { type: "say_end", interrupted: false }], "no go_to_step: the phone moved itself");
  const i = c.ws.events.findIndex((e) => e.text === LINE[3]);
  assert.equal(c.ws.audioOf(i), LINE_BYTES, "the whole line");
  assert.ok(c.ws.frames.filter((f) => f.after > i).every((f) => f.at === at), "sent the moment the kid tapped");
  assert.equal(w.spoken.length, before, "made ahead: Sonic isn't called again");

  // Played on the phone like a streamed line: the mic is muted until it ends, and our own words coming back are
  // ignored as an echo.
  c.mic();
  assert.equal(w.inkFrames(), 0, "homie's line is playing");
  w.says("Simmer it for ten minutes.");
  await settle();
  assert.equal(c.ws.of("transcript").length, 0, "an echo");
  await advance(AUDIO_S * 1000 + 100);
  c.mic();
  assert.equal(w.inkFrames(), 1, "it's over: the mic is heard again");
  c.close();
});

test("the step the app restores on open isn't read (the screen's step wins); a tap on the step it's on says nothing", async () => {
  // Before ready (the app sends it as the socket opens): the session starts on the screen's step.
  const w = world();
  const a = w.connect();
  a.tap(2);
  await greeted(a);
  assert.deepEqual(a.ws.of("go_to_step"), [{ type: "go_to_step", stepOrder: 2 }]);
  assert.deepEqual(a.says(), [["greeting", GREETING]], "not read");
  w.says("Next.");
  await waitFor("step 3's line", () => a.says().some(([, text]) => text === LINE[3]));
  a.close();

  // Just after ready (it can come either side): still the restore.
  const v = world();
  const b = v.connect();
  await settle();
  assert.deepEqual(types(b.ws.events).slice(0, 2), ["ready", "go_to_step"]);
  b.tap(3);
  await greeted(b);
  assert.deepEqual(b.says(), [["greeting", GREETING]], "not read");
  b.tap(3);
  await advance(2000);
  assert.deepEqual(b.says(), [["greeting", GREETING]], "the same step: nothing");
  b.tap(1);
  await settle();
  assert.deepEqual(b.says().at(-1), ["step", LINE[1]]);
  b.close();
});

test("a tap while the recipe loads (after the restore) is read once it's ready, and a hello cut off unheard isn't counted", async () => {
  const w = world();
  const a = w.connect();
  a.tap(2); // the restore, as the socket opens
  a.tap(3); // the kid taps Next before `ready`
  await settle();
  assert.deepEqual(a.ws.of("go_to_step"), [{ type: "go_to_step", stepOrder: 3 }]);
  assert.deepEqual(a.says(), [["greeting", GREETING], ["step", LINE[3]]], "the tap's line cuts off the hello");
  assert.equal(a.ws.of("say_end")[0].interrupted, true);
  await advance(AUDIO_S * 1000 + 500);
  a.close();
  // The hello was cut off before any of it played: the reconnect still says it.
  const b = w.connect();
  await greeted(b);
  b.close();

  // A tap before `ready` to the step the restore set changes nothing, so nothing is read.
  const v = world();
  const c = v.connect();
  c.tap(2);
  c.tap(2);
  await greeted(c);
  assert.deepEqual(c.says(), [["greeting", GREETING]]);
  c.close();
});

test("voice and Claude moves say the new step's line; repeat says the whole step; a move to the same step says nothing", async () => {
  const w = world({ claude: (a) => a.goToStep(3) });
  const c = w.connect();
  await greeted(c);
  const since = c.mark();
  w.says("Next step.");
  await settle();
  assert.deepEqual(since(), [
    { type: "transcript", text: "Next step.", final: true },
    { type: "go_to_step", stepOrder: 2 },
    sayOf(LINE[2]),
    { type: "say_end", interrupted: false },
  ]);
  await waitFor("the story nudge's end", () => c.ws.of("say_end").length === 3);
  await advance(AUDIO_S * 1000 + 500);
  for (const words of ["Wait, go back.", "Say that again.", "Go back."]) {
    w.says(words);
    await advance(AUDIO_S * 1000 + 500);
  }
  assert.deepEqual(c.ws.of("go_to_step").map((g) => g.stepOrder), [1, 2, 1, 1, 1], "go back on step 1 stays on 1");
  w.says("Take me to the simmering part.");
  await advance(AUDIO_S * 1000 + 500);
  assert.deepEqual(c.says(), [
    ["greeting", GREETING],
    ["step", LINE[2]],
    ["nudge", STORY],
    ["step", LINE[1]],
    ["step", LINE[1]], // say that again: step 1's line is the whole step
    ["step", LINE[3]], // Claude's go_to_step
  ]);
  assert.deepEqual(w.turns, ["Take me to the simmering part."], "only that one needed Claude");
  // Say that again on step 3: the whole step, said live (Sonic, then Gemini if it must); never kept.
  w.says("Say that again.");
  await advance(AUDIO_S * 1000 + 500);
  assert.deepEqual(c.says().at(-1), ["step", WHOLE_3]);
  assert.deepEqual(w.routes[w.spoken.indexOf(WHOLE_3)], { sonic: true });
  assert.equal(lineCache.size, 3, "only the short lines are kept");
  // The last step: no next, and a timer still works without Claude.
  w.says("Next.");
  w.says("Set a timer for 5 minutes for the rice.");
  await waitFor("the timer", () => c.ws.of("timer").length === 1);
  assert.equal(c.ws.of("timer")[0].label, "rice");
  assert.ok(c.says().some(([, text]) => text === "That was the last step. Enjoy it!"));
  assert.equal(w.turns.length, 1);
  assert.deepEqual(w.stepLines(), [LINE[1], LINE[2], LINE[3]], "every line made once, ahead");
  c.close();
});

test("rapid flips: each flip cuts off the line before it, and only the latest step's line plays", async () => {
  const w = world({ speak: slowSteps });
  const c = w.connect();
  await greeted(c); // steps 1 and 2 are still being made (Sonic starts at 8 s), step 3 waits its turn
  const from = c.ws.events.length;
  c.tap(2);
  c.tap(3);
  c.tap(2);
  await waitFor("the last line's end", () => c.ws.of("say_end").length === 4);
  const evs = c.ws.events.slice(from);
  assert.deepEqual(evs.filter((e) => e.type === "say").map((e) => e.text), [LINE[2], LINE[3], LINE[2]]);
  assert.deepEqual(evs.filter((e) => e.type === "say_end").map((e) => e.interrupted), [true, true, false]);
  const last = c.ws.events.findLastIndex((e) => e.type === "say");
  const audio = (pick: (after: number) => boolean) => c.ws.frames.filter((f) => pick(f.after)).reduce((n, f) => n + f.bytes, 0);
  assert.equal(audio((after) => after > from && after <= last), 0, "no audio for the lines cut off");
  assert.equal(audio((after) => after > last), LINE_BYTES, "the latest line, whole");
  // Step 3's line, asked for by the flip, went on being made, and is kept: no line is made twice.
  await advance(20_000, 500);
  assert.deepEqual(w.stepLines().sort(), [LINE[1], LINE[2], LINE[3]]);
  c.close();
});

test("a line not made yet when the kid flips streams as Sonic makes it, is kept, and isn't made again", async () => {
  const w = world({ speak: slowSteps });
  const c = w.connect();
  await greeted(c);
  const at = Date.now();
  c.tap(3); // step 3 is still waiting behind 1 and 2
  await settle();
  assert.deepEqual(c.ws.events.at(-1), sayOf(LINE[3]), "the say goes out at once");
  const i = c.ws.events.length - 1;
  await waitFor("its end", () => c.ws.of("say_end").length === 2);
  const frames = c.ws.frames.filter((f) => f.after > i);
  assert.deepEqual(frames.map((f) => f.at - at), [8000, 8100, 8200, 8300, 8400], "each piece as Sonic made it");
  assert.equal(c.ws.audioOf(i), LINE_BYTES);
  await advance(20_000, 500); // the made-ahead queue gets to step 3: it's there already
  assert.equal(w.stepLines().filter((t) => t === LINE[3]).length, 1);

  // Kept: back to 2 and on to 3 again, all at once (step 2's line, cut off by the second tap, ends interrupted).
  c.tap(2);
  c.tap(3);
  await settle();
  const again = c.ws.events.findLastIndex((e) => e.type === "say");
  assert.deepEqual(c.ws.events[again], sayOf(LINE[3]));
  assert.deepEqual(c.ws.of("say_end").slice(-2), [{ type: "say_end", interrupted: true }, { type: "say_end", interrupted: false }]);
  assert.equal(c.ws.audioOf(again), LINE_BYTES);
  assert.ok(c.ws.frames.filter((f) => f.after > again).every((f) => f.at === Date.now()));
  c.close();
});

test("a second kid on the same recipe, and a reconnect, cost nothing: Sonic makes each line once", async () => {
  const first = world();
  const a = first.connect();
  await greeted(a);
  a.tap(2);
  await settle();
  a.close();
  assert.deepEqual(first.stepLines(), [LINE[1], LINE[2], LINE[3]]);

  const second = world();
  const b = second.connect();
  await greeted(b);
  b.tap(3);
  await settle();
  assert.deepEqual(b.says().at(-1), ["step", LINE[3]]);
  assert.equal(b.ws.audioOf(b.ws.events.length - 2), LINE_BYTES);
  assert.deepEqual(second.spoken, [GREETING], "only the hello: every step line came from the cache");
  b.close();

  // The first kid's socket drops and comes back: no second hello, and nothing to make.
  const spokenBefore = first.spoken.length;
  const again = first.connect();
  await advance(10_000);
  assert.deepEqual(types(again.ws.events), ["ready", "go_to_step"]);
  again.tap(2);
  await settle();
  assert.deepEqual(again.says(), [["step", LINE[2]]]);
  assert.equal(first.spoken.length, spokenBefore);
  again.close();
});

/** Sonic refuses step lines made ahead (`failing` decides which, with what error); everything else is said. */
const refusing =
  (failing: (text: string) => string | null): Speak =>
  (text, format, signal, onChunk, voice, route = {}) => {
    const error = voice?.kind === "step" && route.backup === false ? failing(text) : null;
    return error ? Promise.reject(new Error(error)) : sonic()(text, format, signal, onChunk);
  };
/** The routes each try at `text` took: { backup: false } = Sonic alone, { sonic: false } = Gemini alone. */
const triesAt = (w: ReturnType<typeof world>, text: string) => w.routes.filter((_, n) => w.spoken[n] === text);

test("Sonic out of credits: making ahead stops, nothing is kept, and a flip goes straight to the backup voice", async () => {
  const warnings: string[] = [];
  mock.method(console, "warn", (...args: unknown[]) => void warnings.push(args.join(" ")));
  const w = world({ speak: refusing(() => "402: insufficient credits") });
  const c = w.connect();
  await greeted(c);
  assert.ok(warnings.includes("step 1 line not made ahead: 402: insufficient credits"), warnings.join("\n"));
  assert.deepEqual(w.stepLines(), [LINE[1], LINE[2]], "the two under way; step 3 is never asked for");
  assert.equal(lineCache.size, 0, "nothing kept");
  c.tap(2);
  await waitFor("step 2's line", () => c.ws.of("say_end").length === 2);
  const i = c.ws.events.findIndex((e) => e.text === LINE[2]);
  assert.equal(c.ws.audioOf(i), LINE_BYTES, "said by the backup voice");
  assert.deepEqual(triesAt(w, LINE[2]), [{ backup: false }, { sonic: false }], "one Sonic try in all, then Gemini");
  c.tap(3);
  await settle();
  assert.deepEqual(triesAt(w, LINE[3]), [{ sonic: false }], "Sonic is busy: not asked at all");

  // A minute on, Sonic gets asked again (once), and Gemini says it when it still can't.
  await advance(FAILED_MS, 1000);
  c.tap(1);
  await waitFor("step 1's line", () => c.says().at(-1)?.[1] === LINE[1] && c.ws.of("say_end").length === 4);
  assert.deepEqual(triesAt(w, LINE[1]), [{ backup: false }, { backup: false }, { sonic: false }]);
  c.close();
});

test("a line Sonic failed to make (a network error) is remembered for a minute: the flip goes straight to the backup voice", async () => {
  const w = world({ speak: refusing((text) => (text === LINE[2] ? "network: socket hang up" : null)) });
  const c = w.connect();
  await greeted(c);
  assert.equal(lineCache.size, 2, "the other lines are kept: one failure doesn't stop the rest");
  c.tap(2);
  await waitFor("step 2's line", () => c.ws.of("say_end").length === 2);
  assert.deepEqual(triesAt(w, LINE[2]), [{ backup: false }, { sonic: false }]);
  c.tap(3);
  await settle();
  assert.deepEqual(triesAt(w, LINE[3]), [{ backup: false }], "kept: no new call");
  c.close();
});

test("after a step's line, the story nudge once; not now closes it quietly, yes plays her story", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  await nudged(w, c);
  const says = c.says().length;
  w.says("Not now.");
  await advance(5000);
  assert.equal(c.says().length, says);
  assert.equal(c.ws.of("play_clip").length, 0);
  assert.deepEqual(w.turns, [], "the nudge's answer, not Claude's");
  // Back and on again: her story isn't offered twice.
  w.says("Go back.");
  await advance(AUDIO_S * 1000 + 500);
  w.says("Next.");
  await advance(AUDIO_S * 1000 + 20_000);
  assert.equal(c.says().filter(([kind]) => kind === "nudge").length, 1);
  c.close();

  const v = world();
  const d = v.connect();
  await greeted(d);
  await nudged(v, d);
  v.says("Yes.");
  await settle();
  assert.deepEqual(d.ws.of("play_clip"), [{ type: "play_clip", startS: 40, endS: 70, quote: "My mother made this every Sunday." }]);
  d.close();
});

test("while an app moment is up, a yes or no is the moment's: transcripts still come, the story nudge stays open", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  await nudged(w, c);
  c.send({ type: "moment", open: true, kind: "answer" });
  const since = c.mark();
  w.says("Yes.");
  w.says("No thanks.");
  w.says("Okay sure.");
  await advance(5000);
  assert.deepEqual(since(), [
    { type: "transcript", text: "Yes.", final: true },
    { type: "transcript", text: "No thanks.", final: true },
    { type: "transcript", text: "Okay sure.", final: true },
  ]);

  // A question while it's up still goes the usual way, and isn't taken as a yes to the nudge.
  w.says("Okay, how much salt do I add?");
  await advance(1000);
  assert.deepEqual(w.turns, ["Okay, how much salt do I add?"]);
  assert.equal(c.ws.of("play_clip").length, 0);

  // Once it closes, the kid's yes is ours again.
  c.send({ type: "moment", open: false });
  w.says("Yes.");
  await settle();
  assert.equal(c.ws.of("play_clip").length, 1);
  c.close();
});

test("with a moment up, the app's own text answer still counts", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  await nudged(w, c);
  c.send({ type: "moment", open: true, kind: "help" });
  c.send({ type: "text", text: "yes" });
  await settle();
  assert.equal(c.ws.of("play_clip").length, 1);
  c.close();
});

test("homie never nudges over an app moment: the story nudge waits for it to close", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  c.send({ type: "moment", open: true, kind: "ask" });
  w.says("Next."); // a plain command still works with a moment up
  await waitFor("step 2", () => c.says().length === 2);
  await advance(60_000, 500);
  assert.deepEqual(c.says().map(([kind]) => kind), ["greeting", "step"]);
  c.send({ type: "moment", open: false });
  await waitFor("the story nudge", () => c.says().length === 3);
  assert.deepEqual(c.says().at(-1), ["nudge", STORY]);
  c.close();
});

test("in the app's ask moment (a long press on homie), the question goes straight to the cook without Claude, and a command still works", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  c.send({ type: "moment", open: true, kind: "ask" });
  w.says("Next step.");
  await waitFor("step 2", () => c.ws.of("go_to_step").at(-1)?.stepOrder === 2);
  assert.equal(c.ws.of("asked_cook").length, 0, "a command isn't a question");
  const question = "Can I use butter instead of ghee?";
  w.says(question);
  await waitFor("homie's answer", () => c.says().some(([, text]) => text === "Good question. I'll ask Grandma."));
  assert.deepEqual(c.ws.of("asked_cook"), [{ type: "asked_cook", questionId: `q-${question}`, text: question }]);
  assert.deepEqual(w.turns, [], "never reaches Claude");
  // Once the moment closes, a question goes the usual way again.
  c.send({ type: "moment", open: false });
  w.says("Is it okay if it browns a bit?");
  await waitFor("Claude's turn", () => w.turns.length === 1);
  assert.deepEqual(w.turns, ["Is it okay if it browns a bit?"]);
  assert.equal(c.ws.of("asked_cook").length, 1);
  c.close();
});

test("the long-quiet nudge waits while an app moment is up", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  c.send({ type: "moment", open: true, kind: "answer" });
  await advance(8 * 60_000, 1000);
  assert.deepEqual(c.says().map(([kind]) => kind), ["greeting"]);
  c.send({ type: "moment", open: false });
  await waitFor("the quiet nudge", () => c.says().length === 2);
  assert.deepEqual(c.says().at(-1), ["nudge", 'Still on step 1? No rush. Say "next" when you\'re ready.']);
  c.close();
});

test("every everyday no closes the story nudge quietly, and a later yes doesn't play it", async () => {
  const nos = ["No, not right now.", "Nah, I'm good.", "No, I don't want that.", "Don't.", "Not now, thanks.", "Oh, no thanks.", "Oh no, not now.", "Yeah, no.",
    "No, no need to read it.", "Nope, no need to read it out loud.", "Nah, no need for that.", "No, no need to play it."];
  for (const no of nos) {
    const w = world();
    const c = w.connect();
    await greeted(c);
    await nudged(w, c);
    const since = c.mark();
    w.says(no);
    await settle();
    assert.deepEqual(since(), [{ type: "transcript", text: no, final: true }, { type: "quiet" }], no);
    assert.deepEqual(w.turns, [], no);
    w.says("Yes.");
    await advance(2000);
    assert.equal(c.ws.of("play_clip").length, 0, `${no}: the nudge is closed`);
    c.close();
  }
});

test("with a moment up, everyday yes and no answers are the moment's, and never reach Claude", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  await nudged(w, c);
  c.send({ type: "moment", open: true, kind: "answer" });
  const replies = [
    "Sure, read it.", "Yeah, go ahead.", "Yes, play it.", "Yes, I want to hear it.", "Please do.", "Okay, let's do it.", "Okay cool.",
    "Don't.", "No, not right now.", "Nah, I'm good.", "Oh, no thanks.",
  ];
  const since = c.mark();
  for (const reply of replies) w.says(reply);
  await advance(5000);
  assert.deepEqual(since(), replies.map((text) => ({ type: "transcript", text, final: true })));
  assert.deepEqual(w.turns, []);

  // A command or question isn't an answer: it still goes the usual way with the moment up.
  w.says("Okay, what's the next step?");
  w.says("Not really sure how much salt.");
  await advance(1000);
  assert.deepEqual(w.turns, ["Okay, what's the next step?", "Not really sure how much salt."]);

  // Once it closes, a no is ours again: it closes the nudge, so a yes after it plays nothing.
  c.send({ type: "moment", open: false });
  w.says("Nah, I'm good.");
  w.says("Yes.");
  await advance(1000);
  assert.equal(c.ws.of("play_clip").length, 0);
  assert.equal(w.turns.length, 3, "only the yes reached Claude (nothing was open for it)");

  // A command after a no still runs, without Claude, and the new step's line is said.
  c.send({ type: "moment", open: true, kind: "answer" });
  w.says("No, next step.");
  await advance(AUDIO_S * 1000 + 2000);
  assert.equal(c.ws.of("go_to_step").at(-1)?.stepOrder, 3);
  assert.deepEqual(c.says().at(-1), ["step", LINE[3]]);
  assert.equal(w.turns.length, 3);
  c.close();
});

test("okay or please with more words says yes to the nudge, and a no with a command closes it and still runs it", async () => {
  for (const yes of ["Please do.", "Okay, let's do it.", "Okay, I want to hear it."]) {
    const w = world();
    const c = w.connect();
    await greeted(c);
    await nudged(w, c);
    w.says(yes);
    await settle();
    assert.equal(c.ws.of("play_clip").length, 1, yes);
    assert.deepEqual(w.turns, [], yes);
    c.close();
  }

  const w = world();
  const c = w.connect();
  await greeted(c);
  await nudged(w, c);
  const since = c.mark();
  w.says("No, next step.");
  await settle();
  assert.deepEqual(since(), [
    { type: "transcript", text: "No, next step.", final: true },
    { type: "go_to_step", stepOrder: 3 },
    sayOf(LINE[3]),
    { type: "say_end", interrupted: false },
  ]);
  assert.deepEqual(w.turns, []);
  c.close();
});

const DECLINED = /^They just said no to hearing Grandma's story, and that's done\./;

test("a no with more after it closes the nudge, and Claude hears the kid's whole sentence, told what the no was to", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  await nudged(w, c);
  w.says("No, I'm out of ginger. Can I skip it?");
  await settle();
  assert.deepEqual(w.turns, ["No, I'm out of ginger. Can I skip it?"]);
  assert.match(w.notes[0]!, DECLINED);
  assert.doesNotMatch(w.notes[0]!, /read/, "nothing about reading steps any more");

  // With a moment up it isn't held for the app either, and Claude hears that the no was the screen's.
  c.send({ type: "moment", open: true, kind: "answer" });
  w.says("No, it's burning, what do I do?");
  w.says("No, maybe later.");
  await settle();
  assert.deepEqual(w.turns, ["No, I'm out of ginger. Can I skip it?", "No, it's burning, what do I do?"]);
  assert.match(w.notes[1]!, /^They just said no to what's on their screen/);
  c.close();
});

test("the verifiers' no's to the nudge: the fast path, Claude with the whole sentence, or nothing; never a piece", async () => {
  const toClaude = [
    "No point in reading it.", "No, no point reading it out loud.", "No, no need at all to read it.", "No, no need of reading it.",
    "Nah, no need really to read it.", "No, I'm out of ginger. Can I skip it?", "No, it's burning, what do I do?",
    "No, don't set a timer for 5 minutes.",
  ];
  const nothing = ["No, no need to read it.", "No, thanks."];
  for (const no of [...toClaude, "No, next step.", ...nothing]) {
    const w = world();
    const c = w.connect();
    await greeted(c);
    await nudged(w, c);
    const since = c.mark();
    w.says(no);
    await advance(AUDIO_S * 1000 + 2000);
    // Claude (faked) does nothing, so a turn that only reached it ends quiet too.
    const after = no === "No, next step." ? ["go_to_step", "say", "say_end"] : ["quiet"];
    assert.deepEqual(types(since()), ["transcript", ...after], no);
    assert.deepEqual(w.turns, toClaude.includes(no) ? [no] : [], no);
    for (const note of w.notes) assert.match(note!, DECLINED, no);
    assert.equal(c.ws.of("play_clip").length, 0, no);
    assert.equal(c.ws.of("timer").length, 0, no);
    c.close();
  }
});

test("a question Ink ends mid-sentence waits for the rest: one turn with the whole sentence, not two", async () => {
  const w = world();
  const c = w.connect();
  await greeted(c);
  w.says("How do I know when the sugar is");
  await advance(800); // Ink's next turn.end, as seen live
  w.says("ready?");
  await waitFor("the joined turn", () => w.turns.length === 1);
  await advance(2000);
  assert.deepEqual(w.turns, ["How do I know when the sugar is ready?"]);
  // A piece that never gets its rest still goes, after the hold.
  w.says("Can I use butter instead of the ghee");
  await waitFor("the held piece", () => w.turns.length === 2);
  assert.equal(w.turns[1], "Can I use butter instead of the ghee");
  // A plain command or a word or two never waits.
  const mark = c.mark();
  w.says("next step");
  await waitFor("the step", () => mark().some((e) => e.type === "go_to_step"));
  c.close();
});
