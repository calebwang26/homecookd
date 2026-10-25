// homie's backup voice from the outside, with fetch stubbed (Sonic out of credits): a stalled Gemini still ends the
// kid's line (say_end, so the phone stops "speaking" and the mic opens again), and /speak answers an error status
// (the app then uses the phone's own voice) instead of an empty 200 WAV. No network beyond localhost.
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { CookSession } from "../src/convex.js";
import type { CookingDeps } from "../src/cook.js";
import { advance, FakeSocket, settle } from "./helpers.js";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
process.env.GEMINI_API_KEY = "test-gemini";
process.env.VOICE_STUB = "1";
process.env.PORT = "0";
const { Cooking } = await import("../src/cook.js");
const { speak } = await import("../src/sonic.js");
const { GEMINI_FIRST_AUDIO_MS } = await import("../src/geminiTts.js");

const realFetch = globalThis.fetch;
let geminiCalls = 0;
let warnings: string[] = [];

/** Sonic answers 402; Gemini answers with `gemini`. Anything else (our own server) goes to the real fetch. */
function stub(gemini: (signal?: AbortSignal) => Response) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.cartesia.ai/")) return new Response("insufficient credits", { status: 402 });
    if (u.startsWith("https://generativelanguage.googleapis.com/")) return (geminiCalls++, gemini(init?.signal ?? undefined));
    if (u.startsWith("http://127.0.0.1:")) return realFetch(url, init);
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
}

/** Headers, then nothing until the request is aborted. */
const stalls = (signal?: AbortSignal) =>
  new Response(new ReadableStream({ start: (ctrl) => signal?.addEventListener("abort", () => ctrl.error(signal.reason)) }));

/** A stream that completes with no audio at all. */
const silent = () =>
  new Response(`data: ${JSON.stringify({ event_type: "interaction.completed", interaction: { id: "i1", status: "completed" } })}\n\ndata: [DONE]\n\n`);

/** A stream whose interaction fails. */
const failed = () => new Response(`data: ${JSON.stringify({ event_type: "interaction.failed", interaction: { id: "i1", status: "failed" } })}\n\n`);

beforeEach(() => {
  geminiCalls = 0;
  warnings = [];
  mock.method(console, "log", () => {});
  mock.method(console, "error", () => {});
  mock.method(console, "warn", (...args: unknown[]) => void warnings.push(args.join(" ")));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
  mock.restoreAll();
});

const session: CookSession = {
  familyId: "fam-1",
  mossIndex: "family-fam-1",
  kid: { id: "kid-fallback", name: "Shreya" },
  cook: { name: "Grandma", language: "en" },
  recipe: {
    id: "recipe-1",
    title: "Varan Bhaat",
    steps: [{ order: 1, title: "Wash the rice", text: "Wash the rice three times.", moment: { startS: 0, endS: 30 } }],
    memories: [],
  },
  stepOrder: 1,
};

test("Gemini stalls after Sonic failed: each line still ends at 6 s (say_end), then the mic opens again", { timeout: 30_000 }, async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") });
  stub(stalls);
  let inkFrames = 0;
  const deps: CookingDeps = {
    convex: { startSession: async () => session, setStep: async () => {}, logQuestion: async () => ({ status: "asked_cook", questionId: "q" }) },
    listen: () => ({ send: () => void inkFrames++, close: () => {} }),
    speak, // the real one: Sonic, then Gemini
    agent: () => ({ turn: async () => {} }),
    findMoments: async () => [],
    warm: async () => false,
    translateQuote: async (quote) => quote,
  };
  const ws = new FakeSocket();
  const cooking = new Cooking(ws as unknown as WebSocket, "token", "recipe-1", "pcm", deps);
  void cooking.start();
  await settle();
  await settle();
  assert.deepEqual(ws.of("say").map((s) => s.kind), ["greeting"]);
  assert.equal(geminiCalls, 1, "Sonic's 402 went to Gemini");

  await advance(GEMINI_FIRST_AUDIO_MS - 50);
  assert.deepEqual(ws.of("say_end"), [], "still waiting on Gemini");
  cooking.onMessage(Buffer.alloc(3200), true);
  assert.equal(inkFrames, 0, "half duplex: the mic is muted while homie speaks");

  await advance(100);
  assert.deepEqual(ws.of("say_end"), [{ type: "say_end", interrupted: false }]);
  // The step's line couldn't be made ahead (Sonic alone, never Gemini for a line that's kept).
  assert.deepEqual(warnings, ["step 1 line not made ahead: 402: insufficient credits", "sonic 402: insufficient credits, then gemini tts: no audio in 6 s"]);
  assert.equal(geminiCalls, 1);
  // The session moves on: "repeat" says the step's line live, Gemini stalls on it too, and it ends the same way.
  cooking.onMessage(Buffer.from(JSON.stringify({ type: "text", text: "repeat" })), false);
  await settle();
  assert.deepEqual(ws.of("say").map((s) => s.kind), ["greeting", "step"]);
  assert.equal(geminiCalls, 2, "said live, the step's line may use the backup voice");
  await advance(GEMINI_FIRST_AUDIO_MS);
  assert.equal(ws.of("say_end").length, 2);
  cooking.onMessage(Buffer.alloc(3200), true);
  assert.equal(inkFrames, 1, "the mic is open again");
  cooking.close();
});

test("/speak answers 502 when Gemini gives no audio or fails, never an empty 200 WAV", async () => {
  const { server } = await import("../src/server.js");
  if (!server.listening) await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    for (const gemini of [silent, failed]) {
      stub(gemini);
      const res = await fetch(`http://127.0.0.1:${port}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: "test-session", text: "Hi, Rajani Aaji.", lang: "en", kind: "intro" }),
      });
      assert.equal(res.status, 502, gemini.name);
      assert.equal(res.headers.get("content-type"), "application/json");
      assert.deepEqual(await res.json(), { error: "couldn't speak that" });
    }
    assert.equal(geminiCalls, 2);
  } finally {
    server.close();
  }
});
