// homie's backup voice from the outside, with fetch stubbed (Sonic 3.6 busy): when the backup model stalls too, the
// kid's line still ends (say_end `failed`, so the phone says it in its own voice and the mic opens again after about
// as long as that takes), and /speak answers an error status (the app then uses the phone's own voice) instead of an
// empty 200 WAV. No network beyond localhost.
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
process.env.VOICE_STUB = "1";
process.env.PORT = "0";
const { Cooking } = await import("../src/cook.js");
const { speak, FIRST_AUDIO_MS } = await import("../src/sonic.js");
const { speakingSeconds } = await import("../src/speech.js");

const realFetch = globalThis.fetch;
let backupCalls = 0;
let sonicCalls = 0;
let warnings: string[] = [];

/** Sonic 3.6 answers 503; the backup model (Sonic 3.5) answers with `backup`. Our own server gets the real fetch. */
function stub(backup: (signal?: AbortSignal) => Response) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1:")) return realFetch(url, init);
    if (!u.startsWith("https://api.cartesia.ai/tts/bytes")) throw new Error(`unexpected fetch ${u}`);
    const model = JSON.parse(String(init?.body)).model_id;
    if (model === "sonic-3.6") return (sonicCalls++, new Response("busy", { status: 503 }));
    return (backupCalls++, backup(init?.signal ?? undefined));
  }) as typeof fetch;
}

/** Headers, then nothing until the request is aborted. */
const stalls = (signal?: AbortSignal) =>
  new Response(new ReadableStream({ start: (ctrl) => signal?.addEventListener("abort", () => ctrl.error(signal.reason)) }));

/** A 200 with no audio at all. */
const silent = () => new Response(new ReadableStream({ start: (ctrl) => ctrl.close() }));

/** An error status. */
const failed = () => new Response("busy too", { status: 503 });

beforeEach(() => {
  backupCalls = 0;
  sonicCalls = 0;
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

test("both voices fail: say_end says failed, and the mic stays shut about as long as the phone's own voice takes", { timeout: 30_000 }, async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") });
  stub(stalls);
  let inkFrames = 0;
  const deps: CookingDeps = {
    convex: { startSession: async () => session, setStep: async () => {}, logQuestion: async () => ({ status: "asked_cook", questionId: "q" }) },
    listen: () => ({ send: () => void inkFrames++, close: () => {} }),
    speak, // the real one: Sonic 3.6, then Sonic 3.5
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
  const [hello] = ws.of("say");
  assert.equal(hello.kind, "greeting");
  assert.equal(backupCalls, 1, "Sonic 3.6's 503 went to Sonic 3.5");

  await advance(FIRST_AUDIO_MS - 50);
  assert.deepEqual(ws.of("say_end"), [], "still waiting on the backup");
  await advance(100);
  assert.deepEqual(ws.of("say_end"), [{ type: "say_end", interrupted: false, failed: true }]);
  // The phone says the hello in its own voice now: the mic stays shut (half duplex) about as long as that takes.
  cooking.onMessage(Buffer.alloc(3200), true);
  assert.equal(inkFrames, 0, "the phone's own voice is still saying the hello");
  await advance(speakingSeconds(String(hello.text)) * 1000 + 1600);
  cooking.onMessage(Buffer.alloc(3200), true);
  assert.equal(inkFrames, 1, "the mic is open again");
  // Once the hello is over, the step's line is asked for ahead, and can't be made (Sonic 3.6 alone for a kept line).
  assert.deepEqual(warnings, ["sonic 503: busy, then sonic-3.5 no audio in 4 s", "step 1 line not made ahead: 503: busy"]);
  const sonicBefore = sonicCalls;
  // "repeat" says the step live, straight from the backup (Sonic 3.6 just failed on it), which stalls too.
  cooking.onMessage(Buffer.from(JSON.stringify({ type: "text", text: "repeat" })), false);
  await settle();
  assert.deepEqual(ws.of("say").map((m) => m.kind), ["greeting", "step"]);
  assert.equal(backupCalls, 2, "the step's line, asked of the backup");
  assert.equal(sonicCalls, sonicBefore, "no second Sonic 3.6 try");
  await advance(FIRST_AUDIO_MS);
  assert.deepEqual(ws.of("say_end").at(-1), { type: "say_end", interrupted: false, failed: true });
  cooking.close();
});

test("/speak answers 502 when the backup gives no audio or fails too, never an empty 200 WAV", async () => {
  const { server } = await import("../src/server.js");
  if (!server.listening) await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    for (const backup of [silent, failed]) {
      stub(backup);
      const res = await fetch(`http://127.0.0.1:${port}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: "test-session", text: "Hi, Rajani Aaji.", lang: "en", kind: "intro" }),
      });
      assert.equal(res.status, 502, backup.name);
      assert.equal(res.headers.get("content-type"), "application/json");
      assert.deepEqual(await res.json(), { error: "couldn't speak that" });
    }
    assert.equal(backupCalls, 2);
  } finally {
    server.close();
  }
});
