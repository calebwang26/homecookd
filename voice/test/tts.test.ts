// homie's voice (sonic.ts) and its backup, Sonic's previous model, with fetch stubbed: the exact Sonic requests (Caleb's
// Oct 24 recipe), the moods, and when the backup model says a line instead. No network.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.VOICE_STUB = "1";
const sonic = await import("../src/sonic.js");
const { env } = await import("../src/env.js");

const RIYA = "930eda72-c1af-4637-8d07-87d881d615fe";
/** Every emotion Cartesia lists for generation_config.emotion (Volume, Speed, and Emotion; read Oct 24). */
const CARTESIA_EMOTIONS = new Set(
  "neutral happy excited enthusiastic elated euphoric triumphant amazed surprised flirtatious curious content peaceful serene calm grateful affectionate trust sympathetic anticipation mysterious angry mad outraged frustrated agitated threatened disgusted contempt envious sarcastic ironic sad dejected melancholic disappointed hurt guilty bored tired rejected nostalgic wistful apologetic hesitant insecure confused resigned anxious panicked alarmed scared proud confident distant skeptical contemplative determined".split(" "),
);

type Call = { url: string; body: Record<string, unknown>; signal?: AbortSignal };
let calls: Call[] = [];
let logs: string[] = [];
const realFetch = globalThis.fetch;

/** Stubs fetch: Sonic 3.6's answers come from `sonic`, the backup model's (Sonic 3.5) from `backup`. */
function stub(answers: { sonic: (c: Call) => Response | Promise<Response>; backup?: (c: Call) => Response | Promise<Response> }) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const c: Call = { url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal ?? undefined };
    calls.push(c);
    if (!c.url.startsWith("https://api.cartesia.ai/tts/bytes")) throw new Error(`unexpected fetch ${c.url}`);
    if (c.body.model_id === sonic.SONIC_MODEL) return answers.sonic(c);
    if (c.body.model_id === sonic.BACKUP_MODEL && answers.backup) return answers.backup(c);
    throw new Error(`unexpected model ${String(c.body.model_id)}`);
  }) as typeof fetch;
}

/** A streamed body: these chunks one read at a time, then `end` (close, or an error mid-stream). */
function streamed(chunks: Uint8Array[], end: "close" | Error = "close") {
  const left = [...chunks];
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      const next = left.shift();
      if (next) ctrl.enqueue(next);
      else if (end === "close") ctrl.close();
      else ctrl.error(end);
    },
  });
}

const sonicChunk = Buffer.alloc(4800, 1); // 100 ms
const backupPieces = [Buffer.alloc(4800, 2), Buffer.alloc(9600, 3)];

async function say(text: string, voice: Parameters<typeof sonic.speak>[4], format: "pcm" | "wav" = "pcm", signal = new AbortController().signal) {
  const out: Buffer[] = [];
  const result = await sonic.speak(text, format, signal, (c) => out.push(c), voice).then(
    () => "ok" as const,
    (err: Error) => err,
  );
  return { out, result };
}

beforeEach(() => {
  calls = [];
  logs = [];
  mock.method(console, "log", (...args: unknown[]) => void logs.push(args.join(" ")));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
  mock.timers.reset();
});

test("the defaults are Caleb's pick: Riya bilingual, Sonic 3.6, 24 kHz, one pace of 0.85", () => {
  assert.equal(env.homieVoice, RIYA);
  assert.equal(sonic.SONIC_MODEL, "sonic-3.6");
  assert.equal(sonic.SONIC_SAMPLE_RATE, 24000);
  assert.equal(sonic.SPEED, 0.85);
});

test("Marathi: locale mr-IN, speed 0.85, no emotion, never `language`", async () => {
  stub({ sonic: () => new Response(streamed([sonicChunk])) });
  const { out, result } = await say("नमस्कार, रजनी आजी!", { language: "mr", voice: env.homieVoice, kind: "intro" });
  assert.equal(result, "ok");
  assert.deepEqual(out, [sonicChunk]);
  assert.deepEqual(calls[0].body, {
    model_id: "sonic-3.6",
    transcript: "नमस्कार, रजनी आजी!",
    voice: RIYA,
    output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
    locale: "mr-IN",
    generation_config: { speed: 0.85 },
  });
});

test("English: locale en-IN, speed 0.85 and the line's mood; no language field", async () => {
  stub({ sonic: () => new Response(streamed([sonicChunk])) });
  await say("Quick one... about how much ginger was that?", { language: "en", voice: env.homieVoice, kind: "amount" });
  await say("Step 2. Heat the ghee until it shimmers, then add the cumin.", { voice: env.homieVoice, kind: "step" }, "wav");
  assert.deepEqual(calls[0].body, {
    model_id: "sonic-3.6",
    transcript: "Quick one... about how much ginger was that?",
    voice: RIYA,
    output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
    locale: "en-IN",
    generation_config: { speed: 0.85, emotion: "curious" },
  });
  // No language given is English; wav asks Sonic for its WAV container.
  assert.deepEqual(calls[1].body, {
    model_id: "sonic-3.6",
    transcript: "Step 2. Heat the ghee until it shimmers, then add the cumin.",
    voice: RIYA,
    output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
    locale: "en-IN",
    generation_config: { speed: 0.85, emotion: "calm" },
  });
});

test("other languages: `language` with speed 0.85, no locale, no emotion", () => {
  assert.deepEqual(sonic.sonicFields("hi", "greeting"), { language: "hi", generation_config: { speed: 0.85 } });
});

test("every kind's mood is one Cartesia lists, as auditioned; anything else is content", () => {
  const expected = {
    intro: "content", amount: "curious", cue: "curious", substitution: "curious", story: "curious", end: "curious", optin: "curious",
    reaction: "affectionate", closing: "grateful",
    greeting: "content", step: "calm", hint: "calm", reply: "content", nudge: "content", timer: "content",
    translation: "affectionate",
  };
  for (const [kind, mood] of Object.entries(expected)) {
    assert.equal(sonic.moodOf(kind), mood, kind);
    assert.ok(CARTESIA_EMOTIONS.has(mood), mood);
  }
  // "offer" was the read-aloud offer's (gone Oct 24).
  for (const kind of [undefined, "", "toString", "something new", "offer"]) assert.equal(sonic.moodOf(kind), "content");
});

test("Sonic 3.6 fails before any audio: Sonic 3.5 says the line in the same voice, locale, pace and mood", async () => {
  stub({ sonic: () => new Response("busy", { status: 503 }), backup: () => new Response(streamed(backupPieces)) });
  const voice = { language: "mr", voice: env.homieVoice, kind: "amount" };
  const { out, result } = await say("आजी, आलं साधारण किती घातलं?", voice);
  assert.equal(result, "ok");
  assert.deepEqual(out, backupPieces);
  assert.deepEqual(calls.map((c) => c.body.model_id), ["sonic-3.6", "sonic-3.5"]);
  assert.deepEqual(calls[1].body, sonic.sonicRequest("आजी, आलं साधारण किती घातलं?", "pcm", voice, "sonic-3.5"));
  assert.deepEqual({ ...calls[1].body, model_id: "sonic-3.6" }, calls[0].body, "only the model differs");
  assert.deepEqual(logs, ["tts: sonic-3.5 fallback (sonic 503)"]);
});

test("backup off (a step line made ahead and kept): Sonic's failure fails the line, and the backup isn't asked", async () => {
  stub({ sonic: () => new Response("busy", { status: 503 }), backup: () => assert.fail("no backup for a kept line") });
  const out: Buffer[] = [];
  const voice = { voice: env.homieVoice, kind: "step" };
  const err = await sonic
    .speak("Step 2. Melt the sugar to amber.", "pcm", new AbortController().signal, (c) => out.push(c), voice, { backup: false })
    .catch((e: Error) => e);
  assert.ok(err instanceof Error && err.message.startsWith("503"), String(err));
  assert.deepEqual(out, []);
  assert.equal(calls.length, 1);
  // The same request as a line said live: one voice, one locale and mood, whether made ahead or not.
  assert.deepEqual(calls[0].body, sonic.sonicRequest("Step 2. Melt the sugar to amber.", "pcm", voice));
});

test("Sonic off (it just failed on this line): the backup says it straight away, and Sonic 3.6 isn't asked again", async () => {
  stub({ sonic: () => assert.fail("no second Sonic 3.6 try"), backup: () => new Response(streamed(backupPieces)) });
  const out: Buffer[] = [];
  await sonic.speak("Step 2. Melt the sugar to amber.", "pcm", new AbortController().signal, (c) => out.push(c), { kind: "step" }, { sonic: false });
  assert.deepEqual(out, backupPieces);
  assert.deepEqual(calls.map((c) => c.body.model_id), ["sonic-3.5"]);
  assert.deepEqual(logs, ["tts: sonic-3.5 (sonic failed on this line already)"]);
});

test("429, 500, 401, a network error, no audio and no first audio in 4 s all go to the backup", async () => {
  for (const sonicAnswer of [429, 500, 401, "network", "empty"] as const) {
    calls = [];
    logs = [];
    stub({
      sonic: () => {
        if (sonicAnswer === "network") throw new TypeError("fetch failed");
        if (sonicAnswer === "empty") return new Response(streamed([]));
        return new Response("no", { status: sonicAnswer });
      },
      backup: () => new Response(streamed(backupPieces)),
    });
    const { out, result } = await say("Hey, your timer is done.", { voice: env.homieVoice, kind: "timer" });
    assert.equal(result, "ok", String(sonicAnswer));
    assert.deepEqual(out, backupPieces);
    assert.deepEqual(logs, [`tts: sonic-3.5 fallback (sonic ${sonicAnswer === "empty" ? "no audio" : sonicAnswer})`]);
  }
});

test("no first audio from Sonic within 4 s: the backup says it", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  stub({
    // Headers come, then the body never sends anything until the request is aborted.
    sonic: (c) =>
      new Response(
        new ReadableStream({
          start(ctrl) {
            c.signal?.addEventListener("abort", () => ctrl.error(c.signal?.reason));
          },
        }),
      ),
    backup: () => new Response(streamed(backupPieces)),
  });
  const pending = say("Ready? Let's cook!", { voice: env.homieVoice, kind: "greeting" });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  mock.timers.tick(3999);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, "still waiting on Sonic at 3.999 s");
  mock.timers.tick(1);
  const { out, result } = await pending;
  assert.equal(result, "ok");
  assert.deepEqual(out, backupPieces);
  assert.deepEqual(logs, ["tts: sonic-3.5 fallback (sonic no audio in 4 s)"]);
});

test("Sonic fails after its first chunk: no backup, no splice, the line just ends", async () => {
  stub({
    sonic: () => new Response(streamed([sonicChunk], new Error("connection reset"))),
    backup: () => assert.fail("the backup must not be asked once Sonic's audio went out"),
  });
  const { out, result } = await say("Oh, I love that.", { voice: env.homieVoice, kind: "reaction" });
  assert.ok(result instanceof Error);
  assert.deepEqual(out, [sonicChunk]);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, []);
});

test("an abort is respected: while Sonic waits, no backup; while the backup streams, nothing more goes out", async () => {
  // Cut off while Sonic is still thinking (the cook tapped start over the hello).
  const a = new AbortController();
  stub({
    sonic: (c) =>
      new Promise<Response>((_, reject) => {
        c.signal?.addEventListener("abort", () => reject(c.signal?.reason));
        setTimeout(() => a.abort(), 5);
      }),
    backup: () => assert.fail("no fallback after an abort"),
  });
  const first = await say("Hi, Rajani Aaji.", { voice: env.homieVoice, kind: "intro" }, "pcm", a.signal);
  assert.ok(first.result instanceof Error);
  assert.deepEqual(first.out, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, []);

  // Cut off while the backup streams: its first piece went out, the rest never does.
  calls = [];
  const b = new AbortController();
  stub({ sonic: () => new Response("busy", { status: 503 }), backup: () => new Response(streamed(backupPieces)) });
  const out: Buffer[] = [];
  const result = await sonic.speak("Hey, the rice timer is done.", "pcm", b.signal, (c) => (out.push(c), b.abort()), { voice: env.homieVoice, kind: "timer" }).then(
    () => "ok" as const,
    (err: Error) => err,
  );
  assert.deepEqual(out, [backupPieces[0]]);
  assert.ok(result instanceof Error, "an abort rejects");
});

test("fake speech (VOICE_FAKE_SPEECH=1) never calls Sonic", async () => {
  process.env.VOICE_FAKE_SPEECH = "1";
  const speech = await import("../src/speech.js");
  assert.equal(speech.fakeSpeech, true);
  stub({ sonic: () => assert.fail("no Sonic in fake speech"), backup: () => assert.fail("no backup in fake speech") });
  const out: Buffer[] = [];
  await speech.speak("Ready? Let's cook!", "pcm", new AbortController().signal, (c) => out.push(c), { kind: "greeting" });
  const wav = await speech.speakWav("Hi, Rajani Aaji.", { language: "en", kind: "intro" });
  assert.equal(out.length, 1);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(calls, []);
});

test("/speak's WAV comes from the backup when Sonic 3.6 fails", async () => {
  stub({ sonic: () => new Response("busy", { status: 503 }), backup: () => new Response(streamed(backupPieces)) });
  const wav = await sonic.speakWav("Can Shreya hear your stories too?", { language: "en", voice: env.homieVoice, kind: "optin" });
  assert.deepEqual(wav, Buffer.concat(backupPieces), "a WAV request's body is the WAV Sonic sent");
  assert.equal(calls[1].body.model_id, "sonic-3.5");
  assert.deepEqual(calls[1].body.output_format, { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 });
});

test("both models fail: the line fails with both reasons and nothing went out (the caller's say_end says failed)", async () => {
  stub({ sonic: () => new Response("busy", { status: 503 }), backup: () => new Response("busy too", { status: 503 }) });
  const { out, result } = await say("Hi, Rajani Aaji.", { language: "en", voice: env.homieVoice, kind: "intro" });
  assert.ok(result instanceof Error);
  assert.equal(result.message, "503: busy, then sonic-3.5 503: busy too");
  assert.deepEqual(out, []);
  await assert.rejects(sonic.speakWav("Hi, Rajani Aaji.", { language: "en", kind: "intro" }), /then sonic-3\.5 503/);
});

test("wavHeader: 16-bit mono PCM at the rate asked", () => {
  const h = sonic.wavHeader(4800, 24000);
  assert.equal(h.toString("ascii", 0, 4), "RIFF");
  assert.equal(h.readUInt16LE(22), 1);
  assert.equal(h.readUInt32LE(24), 24000);
  assert.equal(h.readUInt32LE(40), 4800);
});
