// Runs one homie recording against the voice service like the phone by the stove would: hears the
// hello, sends start, says a line with a vague amount, answers homie's question, sends done, answers
// the end questions and the stories opt-in, and waits for the goodbye. The mic streams silence
// between lines. Prints every event with timings and saves homie's lines to test-audio/out/. It streams the recorded
// audio for real; FAKE=1 against `npm run dev:fake` sends the cook's lines as text instead (scripts/guard.ts).
//   VOICE_STUB=1 HOMIE_DEMO=1 npm run dev                       (in another terminal)
//   npm run test-record                                          Marathi (stub recording "stub-mr")
//   COOK_LANG=en npm run test-record                                  English ("stub-en"); ta, zh: Tamil, Mandarin
//   RECORDING=stub-mr-again npm run test-record                       a cook homie has met (the short hello)
//   RECORDING=stub-mr-ajoba npm run test-record                       a grandfather, for the whole family (no kid name)
//   COOK_LANG=en RECORDING=stub-en-dad npm run test-record            a cook named "Dad", for Shreya
//   SESSION=<cook's sessionToken> RECORDING=<recordings _id> npm run test-record   live Convex
//   CAMERA=1 npm run test-record      filmed in the app: {type:"start", camera:true}, a still every 5 s
//                                     (FRAME=<jpeg>, default a pot of chili), a 6 s pause and resume, and
//                                     the plate photo at the end ({type:"plate", ok:true})
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import WebSocket from "ws";
import { guard, live, wordsOf } from "./guard.js";

const base = process.env.URL ?? "ws://localhost:8080";
/** mr (default), en, ta or zh: the stub recording and the cook's test lines in that language. */
const lang = ["en", "ta", "zh"].includes(process.env.COOK_LANG ?? "") ? process.env.COOK_LANG! : "mr";
const token = process.env.SESSION ?? "test-session";
const recording = process.env.RECORDING ?? `stub-${lang}`;
const camera = process.env.CAMERA === "1";
const frame = camera ? readFileSync(process.env.FRAME ?? new URL("../../data/synthetic/posters/dad-sunday-chili.jpg", import.meta.url)).toString("base64") : "";
const audioDir = new URL("../test-audio/", import.meta.url);
const outDir = new URL("out/", audioDir);
mkdirSync(outDir, { recursive: true });
await guard(base);

function pcmOf(name: string): Buffer {
  const wav = readFileSync(new URL(`cook-${lang}-${name}.wav`, audioDir));
  for (let i = 12; i < wav.length - 8; ) {
    const id = wav.toString("ascii", i, i + 4);
    const size = wav.readUInt32LE(i + 4);
    if (id === "data") return wav.subarray(i + 8, Math.min(wav.length, i + 8 + size));
    i += 8 + size;
  }
  throw new Error(`${name}: no data chunk`);
}

function wavOf(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`.padStart(8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timings: string[] = [];

const ws = new WebSocket(`${base}/record?session=${encodeURIComponent(token)}&recording=${encodeURIComponent(recording)}`);
await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));

// The mic: whatever line is queued, else silence, 100 ms at a time.
let queue: Buffer[] = [];
let speechEndAt = 0;
const mic = setInterval(() => {
  const chunk = queue.shift();
  ws.send(chunk ?? Buffer.alloc(3200));
  if (chunk && !queue.length) speechEndAt = Date.now();
}, 100);
function say(name: string) {
  if (!live) {
    // FAKE=1: fake speech hears nothing, so send the line's words, as the phone does for a typed answer.
    const text = wordsOf(`cook-${lang}-${name}`);
    console.log(`${stamp()}  ▶ cook says ${name} as text "${text}"`);
    ws.send(JSON.stringify({ type: "text", text }));
    speechEndAt = Date.now();
    return;
  }
  const pcm = pcmOf(name);
  console.log(`${stamp()}  ▶ cook says ${name} (${(pcm.length / 32000).toFixed(1)}s)`);
  queue = [];
  for (let i = 0; i < pcm.length; i += 3200) queue.push(pcm.subarray(i, i + 3200));
}

type Ev = { type: string; [k: string]: unknown };
const waiters: { match: (e: Ev) => boolean; resolve: (e: Ev) => void }[] = [];
const next = (match: (e: Ev) => boolean, ms: number, what: string) =>
  Promise.race([
    new Promise<Ev>((resolve) => waiters.push({ match, resolve })),
    sleep(ms).then(() => {
      throw new Error(`no ${what} in ${ms / 1000}s`);
    }),
  ]);

let audio: Buffer[] = [];
let sayAt = 0;
let said = 0;
/** When the phone would finish playing homie's last line (the cook waits for it, like a person would). */
let playedAt = 0;
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    if (!audio.length && sayAt) timings.push(`say → first audio ${Date.now() - sayAt}ms`);
    audio.push(data as Buffer);
    return;
  }
  const ev = JSON.parse(data.toString()) as Ev;
  if (ev.type === "transcript" && !ev.final) return;
  if (ev.type === "state") return;
  if (ev.type === "say") {
    audio = [];
    sayAt = Date.now();
  }
  if (ev.type === "say_end") {
    const pcm = Buffer.concat(audio);
    const file = new URL(`record-${lang}-${++said}.wav`, outDir);
    writeFileSync(file, wavOf(pcm, 24000));
    if (!ev.interrupted) playedAt = sayAt + (pcm.length / 48000) * 1000;
    console.log(`${stamp()}  say_end → ${file.pathname} (${(pcm.length / 48000).toFixed(1)}s)`);
  } else {
    if (ev.type === "transcript" && speechEndAt) timings.push(`speech end → final transcript ${Date.now() - speechEndAt}ms`);
    console.log(`${stamp()}  ${JSON.stringify(ev)}`);
  }
  for (const w of [...waiters]) if (w.match(ev)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(ev));
});
ws.on("close", (code) => console.log(`${stamp()}  closed ${code}`));

try {
  await next((e) => e.type === "say_end", 30_000, "intro");
  await sleep(playedAt - Date.now() + 500);
  ws.send(JSON.stringify(camera ? { type: "start", camera: true } : { type: "start" }));
  const frames = camera ? setInterval(() => ws.send(JSON.stringify({ type: "frame", jpeg: frame })), 5000) : undefined;
  if (camera) {
    ws.send(JSON.stringify({ type: "frame", jpeg: frame }));
    // She steps away (a call): the camera stops for 6 s, then films again.
    await sleep(1500);
    console.log(`${stamp()}  ▶ pause`);
    ws.send(JSON.stringify({ type: "pause" }));
    await sleep(6000);
    console.log(`${stamp()}  ▶ resume (gapS 6)`);
    ws.send(JSON.stringify({ type: "resume", gapS: 6 }));
  }
  await sleep(1000);
  say("cooking");
  const ask = await next((e) => e.type === "ask", 150_000, "question");
  const askedAt = Date.now();
  await next((e) => e.type === "say_end", 30_000, "question audio");
  timings.push(`question decided after ${((askedAt - speechEndAt) / 1000).toFixed(1)}s of quiet`);
  await sleep(playedAt - Date.now() + 800);
  say("answer");
  await next((e) => e.type === "answered" && e.promptId === ask.promptId, 20_000, "answered");
  await sleep(1000);
  ws.send(JSON.stringify({ type: "done" }));
  // End questions, then the opt-in; then the goodbye.
  for (;;) {
    const ev = await next((e) => e.type === "ask" || (e.type === "phase" && e.phase === "ended"), 60_000, "end question");
    if (ev.type === "phase") break;
    await next((e) => e.type === "say_end", 30_000, "end question audio");
    await sleep(playedAt - Date.now() + 800);
    if (ev.kind === "plate") {
      console.log(`${stamp()}  ▶ plate photo taken`);
      ws.send(JSON.stringify({ type: "plate", ok: true }));
      continue;
    }
    say(ev.kind === "optin" ? "yes" : "answer");
  }
  clearInterval(frames);
  console.log("\nlatency:\n  " + timings.join("\n  "));
  console.log("\nPASS");
} catch (err) {
  console.log(`\nFAIL: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  clearInterval(mic);
  ws.close(1000);
  await sleep(200);
  process.exit();
}
