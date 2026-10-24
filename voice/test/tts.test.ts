// homie's voice (sonic.ts) and its Gemini backup (geminiTts.ts) with fetch stubbed: the exact Sonic requests (Caleb's
// Oct 24 recipe), the moods, and when Gemini says a line instead. No network.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.GEMINI_API_KEY = "test-gemini";
process.env.VOICE_STUB = "1";
const sonic = await import("../src/sonic.js");
const { geminiRequest, geminiTotalMs, GEMINI_FIRST_AUDIO_MS } = await import("../src/geminiTts.js");
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

/** Stubs fetch: Sonic's and Gemini's answers come from these. */
function stub(answers: { sonic: (c: Call) => Response | Promise<Response>; gemini?: (c: Call) => Response | Promise<Response> }) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const c: Call = { url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal ?? undefined };
    calls.push(c);
    if (c.url.startsWith("https://api.cartesia.ai/tts/bytes")) return answers.sonic(c);
    if (c.url.startsWith("https://generativelanguage.googleapis.com/v1beta/interactions") && answers.gemini) return answers.gemini(c);
    throw new Error(`unexpected fetch ${c.url}`);
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

const COMPLETED = [{ event_type: "step.stop", index: 0 }, { event_type: "interaction.completed", interaction: { id: "i1", status: "completed" } }];

/** Gemini's server-sent events carrying these PCM pieces, then `end` (by default a completed interaction). */
function geminiEvents(pieces: Buffer[], end: object[] = COMPLETED) {
  const lines = [
    { event_type: "interaction.created", interaction: { id: "i1", status: "in_progress" } },
    { event_type: "step.start", index: 0, step: { type: "model_output" } },
    ...pieces.map((p) => ({ event_type: "step.delta", index: 0, delta: { type: "audio", mime_type: "audio/l16", sample_rate: 24000, channels: 1, data: p.toString("base64") } })),
    ...end,
  ].map((e) => `event: ${(e as { event_type: string }).event_type}\ndata: ${JSON.stringify(e)}\n\n`);
  const text = lines.join("") + "data: [DONE]\n\n";
  // Split mid-line, the way a network delivers it.
  const bytes = Buffer.from(text);
  const mid = Math.floor(bytes.length / 2);
  return new Response(streamed([bytes.subarray(0, mid), bytes.subarray(mid)]), { headers: { "content-type": "text/event-stream" } });
}

const sonicChunk = Buffer.alloc(4800, 1); // 100 ms
const geminiPieces = [Buffer.alloc(4800, 2), Buffer.alloc(9600, 3)];

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
    greeting: "content", step: "calm", hint: "calm", reply: "content", offer: "curious", nudge: "content", timer: "content",
    translation: "affectionate",
  };
  for (const [kind, mood] of Object.entries(expected)) {
    assert.equal(sonic.moodOf(kind), mood, kind);
    assert.ok(CARTESIA_EMOTIONS.has(mood), mood);
  }
  for (const kind of [undefined, "", "toString", "something new"]) assert.equal(sonic.moodOf(kind), "content");
});

test("Sonic 402 before any audio: Gemini says the line, its audio goes out the same way, one log line", async () => {
  stub({
    sonic: () => new Response("insufficient credits", { status: 402 }),
    gemini: () => geminiEvents(geminiPieces),
  });
  const { out, result } = await say("आजी, आलं साधारण किती घातलं?", { language: "mr", voice: env.homieVoice, kind: "amount" });
  assert.equal(result, "ok");
  assert.deepEqual(out, geminiPieces);
  assert.deepEqual(calls.map((c) => c.url.split("/")[2]), ["api.cartesia.ai", "generativelanguage.googleapis.com"]);
  assert.deepEqual(calls[1].body, geminiRequest("आजी, आलं साधारण किती घातलं?", 24000));
  assert.deepEqual(logs, ["tts: gemini fallback (sonic 402)"]);
});

test("the Gemini request: the TTS model, a warm voice, one short style, 24 kHz raw PCM, streamed, not stored", () => {
  assert.deepEqual(geminiRequest("Hi, Rajani Aaji.", 24000), {
    model: "gemini-3.8-flash-tts",
    input: [{ type: "user_input", content: [{ type: "text", text: "Hi, Rajani Aaji.", annotations: [{ type: "speech_metadata", style: "warm and gentle, like a caring older cousin" }] }] }],
    response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24000 },
    generation_config: { speech_config: [{ voice: "en-in-assistant-3" }] },
    stream: true,
    store: false,
  });
});

test("429, 500, 401 and a network error fall back too", async () => {
  for (const sonicAnswer of [429, 500, 401, "network"] as const) {
    calls = [];
    logs = [];
    stub({
      sonic: () => {
        if (sonicAnswer === "network") throw new TypeError("fetch failed");
        return new Response("no", { status: sonicAnswer });
      },
      gemini: () => geminiEvents(geminiPieces),
    });
    const { out, result } = await say("Hey, your timer is done.", { voice: env.homieVoice, kind: "timer" });
    assert.equal(result, "ok", String(sonicAnswer));
    assert.deepEqual(out, geminiPieces);
    assert.deepEqual(logs, [`tts: gemini fallback (sonic ${sonicAnswer})`]);
  }
});

test("Sonic answers 200 with no audio at all: Gemini says it", async () => {
  stub({ sonic: () => new Response(streamed([])), gemini: () => geminiEvents(geminiPieces) });
  const { out, result } = await say("Okay, 5 minutes for the rice. I'll tell you when it's done.", { voice: env.homieVoice, kind: "reply" });
  assert.equal(result, "ok");
  assert.deepEqual(out, geminiPieces);
  assert.deepEqual(logs, ["tts: gemini fallback (sonic no audio)"]);
});

test("no first audio from Sonic within 4 s: Gemini says it", async () => {
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
    gemini: () => geminiEvents(geminiPieces),
  });
  const pending = say("Ready? Let's cook!", { voice: env.homieVoice, kind: "greeting" });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  mock.timers.tick(3999);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, "still waiting on Sonic at 3.999 s");
  mock.timers.tick(1);
  const { out, result } = await pending;
  assert.equal(result, "ok");
  assert.deepEqual(out, geminiPieces);
  assert.deepEqual(logs, ["tts: gemini fallback (sonic no audio in 4 s)"]);
});

test("Sonic fails after its first chunk: no Gemini, no splice, the line just ends", async () => {
  stub({
    sonic: () => new Response(streamed([sonicChunk], new Error("connection reset"))),
    gemini: () => assert.fail("Gemini must not be called once Sonic's audio went out"),
  });
  const { out, result } = await say("Oh, I love that.", { voice: env.homieVoice, kind: "reaction" });
  assert.ok(result instanceof Error);
  assert.deepEqual(out, [sonicChunk]);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, []);
});

test("an abort is respected: while Sonic waits, no Gemini; while Gemini streams, nothing more goes out", async () => {
  // Cut off while Sonic is still thinking (the cook tapped start over the hello).
  const a = new AbortController();
  stub({
    sonic: (c) =>
      new Promise<Response>((_, reject) => {
        c.signal?.addEventListener("abort", () => reject(c.signal?.reason));
        setTimeout(() => a.abort(), 5);
      }),
    gemini: () => assert.fail("no fallback after an abort"),
  });
  const first = await say("Hi, Rajani Aaji.", { voice: env.homieVoice, kind: "intro" }, "pcm", a.signal);
  assert.ok(first.result instanceof Error);
  assert.deepEqual(first.out, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, []);

  // Cut off while Gemini streams: its first piece went out, the rest never does (even one already received).
  calls = [];
  const b = new AbortController();
  stub({
    sonic: () => new Response("busy", { status: 503 }),
    gemini: (c) => {
      const piece = (p: Buffer) => `data: ${JSON.stringify({ event_type: "step.delta", delta: { type: "audio", data: p.toString("base64") } })}\n\n`;
      return new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode(piece(geminiPieces[0]) + piece(geminiPieces[1])));
            c.signal?.addEventListener("abort", () => ctrl.error(c.signal?.reason));
          },
        }),
      );
    },
  });
  const out: Buffer[] = [];
  const result = await sonic.speak("Hey, the rice timer is done.", "pcm", b.signal, (c) => (out.push(c), b.abort()), { voice: env.homieVoice, kind: "timer" }).then(
    () => "ok" as const,
    (err: Error) => err,
  );
  assert.deepEqual(out, [geminiPieces[0]]);
  assert.ok(result instanceof Error && result.name === "AbortError", "an abort rejects, as Sonic's does");
});

test("fake speech (VOICE_FAKE_SPEECH=1) never calls Sonic or Gemini", async () => {
  process.env.VOICE_FAKE_SPEECH = "1";
  const speech = await import("../src/speech.js");
  assert.equal(speech.fakeSpeech, true);
  stub({ sonic: () => assert.fail("no Sonic in fake speech"), gemini: () => assert.fail("no Gemini in fake speech") });
  const out: Buffer[] = [];
  await speech.speak("Ready? Let's cook!", "pcm", new AbortController().signal, (c) => out.push(c), { kind: "greeting" });
  const wav = await speech.speakWav("Hi, Rajani Aaji.", { language: "en", kind: "intro" });
  assert.equal(out.length, 1);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(calls, []);
});

test("/speak's WAV: Gemini's PCM comes back as one whole 24 kHz mono WAV", async () => {
  stub({ sonic: () => new Response("no credits", { status: 402 }), gemini: () => geminiEvents(geminiPieces) });
  const wav = await sonic.speakWav("Can Shreya hear your stories too?", { language: "en", voice: env.homieVoice, kind: "optin" });
  const pcm = Buffer.concat(geminiPieces);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1, "mono");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16, "16-bit");
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});

test("a Gemini error after Sonic's: the line fails with both reasons", async () => {
  stub({ sonic: () => new Response("no credits", { status: 402 }), gemini: () => new Response("quota", { status: 429 }) });
  const { out, result } = await say("Hi, Rajani Aaji.", { language: "en", voice: env.homieVoice, kind: "intro" });
  assert.ok(result instanceof Error);
  assert.match(result.message, /^402: no credits, then gemini tts 429: quota$/);
  assert.deepEqual(out, []);
});

/** A Gemini answer whose headers come, then these pieces, then nothing until the request is aborted. */
const geminiStalls =
  (pieces: Buffer[] = []) =>
  (c: Call) => {
    const delta = (p: Buffer) => `data: ${JSON.stringify({ event_type: "step.delta", delta: { type: "audio", data: p.toString("base64") } })}\n\n`;
    return new Response(
      new ReadableStream({
        start(ctrl) {
          if (pieces.length) ctrl.enqueue(new TextEncoder().encode(pieces.map(delta).join("")));
          c.signal?.addEventListener("abort", () => ctrl.error(c.signal?.reason));
        },
      }),
    );
  };

/** Lets the stubbed fetches and streams move on without moving the fake clock. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

test("Gemini stalls before its first audio: the line fails at 6 s with both reasons, nothing went out", { timeout: 30_000 }, async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  stub({ sonic: () => new Response("no credits", { status: 402 }), gemini: geminiStalls() });
  let done = false;
  const pending = say("Ready? Let's cook!", { voice: env.homieVoice, kind: "greeting" }).finally(() => (done = true));
  await settle();
  assert.equal(calls.length, 2, "Gemini was asked");
  mock.timers.tick(GEMINI_FIRST_AUDIO_MS - 1);
  await settle();
  assert.equal(done, false, "still waiting on Gemini at 5.999 s");
  mock.timers.tick(1);
  const { out, result } = await pending;
  assert.ok(result instanceof Error);
  assert.equal(result.message, "402: no credits, then gemini tts: no audio in 6 s");
  assert.deepEqual(out, []);
});

test("Gemini's audio starts, then stalls: the whole-line cap ends it, keeping what went out", { timeout: 30_000 }, async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  stub({ sonic: () => new Response("no credits", { status: 402 }), gemini: geminiStalls([geminiPieces[0]]) });
  const text = "Step 2. Heat the ghee until it shimmers, then add the cumin.";
  let done = false;
  const pending = say(text, { voice: env.homieVoice, kind: "step" }).finally(() => (done = true));
  await settle();
  mock.timers.tick(geminiTotalMs(text) - 1);
  await settle();
  assert.equal(done, false, "the first audio came in time, so only the cap ends it");
  mock.timers.tick(1);
  const { out, result } = await pending;
  assert.ok(result instanceof Error);
  assert.equal(result.message, `402: no credits, then gemini tts: not done in ${geminiTotalMs(text) / 1000} s`);
  assert.deepEqual(out, [geminiPieces[0]]);
});

test("a Gemini stream with no audio, or a failed interaction, fails the line (never a silent success)", async () => {
  const failures: [string, object[], RegExp][] = [
    ["no audio", COMPLETED, /^402: no credits, then gemini tts: no audio$/],
    ["interaction.failed", [{ event_type: "interaction.failed", interaction: { id: "i1", status: "failed" } }], /then gemini tts: failed$/],
    ["a failed status update", [{ event_type: "interaction.status_update", interaction_id: "i1", status: "budget_exceeded" }], /then gemini tts: budget_exceeded$/],
    ["an error event", [{ event_type: "error", error: { code: "overloaded", message: "try again" } }], /then gemini tts: overloaded try again$/],
  ];
  for (const [what, end, message] of failures) {
    for (const format of ["pcm", "wav"] as const) {
      stub({ sonic: () => new Response("no credits", { status: 402 }), gemini: () => geminiEvents([], end) });
      const { out, result } = await say("Hi, Rajani Aaji.", { language: "en", voice: env.homieVoice, kind: "intro" }, format);
      assert.ok(result instanceof Error, `${what} (${format})`);
      assert.match(result.message, message, `${what} (${format})`);
      assert.deepEqual(out, [], `${what} (${format})`);
    }
  }
  // /speak's speakWav rejects too, so the route answers an error instead of an empty WAV (fallback.test.ts).
  stub({ sonic: () => new Response("no credits", { status: 402 }), gemini: () => geminiEvents([]) });
  await assert.rejects(sonic.speakWav("Hi, Rajani Aaji.", { language: "en", kind: "intro" }), /gemini tts: no audio$/);
});
