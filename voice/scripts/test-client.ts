// Streams WAV files to the voice service like the app's mic would, prints every event, and saves
// what the service says to test-audio/out/. One file = one turn; we wait for the reply (and for homie to
// go quiet) before the next. It waits out the greeting and the read-aloud offer first (with
// VOICE_READ_OFFER=1; else it waits 10 s for it). `text:<words>` sends { type: "text" } instead (the app's own
// answer), `moment:<kind>` / `moment:off` opens or closes one of the app's homie moments, `video:on` /
// `video:off` says a video started or stopped on the phone, and `wait:<seconds>` keeps the mic open that long. It streams the audio for real (Ink 2 and Sonic); FAKE=1 against `npm run dev:fake`
// sends each WAV's words as text instead, for a quick offline check (scripts/guard.ts).
//   VOICE_STUB=1 npm run dev                                        (in another terminal)
//   npm run test-client -- test-audio/yes.wav test-audio/next-step.wav test-audio/question.wav
//   npm run test-client -- test-audio/no.wav test-audio/next-step.wav      # no to reading: silent steps
//   npm run test-client -- text:no test-audio/next-step.wav
//   npm run test-client -- video:on "text:Set a timer for 10 seconds." wait:15 video:off wait:8   # held line
//   URL=wss://<cloud run host> npm run test-client -- test-audio/next-step.wav   # against the deployed one
//   FAKE=1 npm run test-client -- test-audio/next-step.wav                       # offline, against dev:fake
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import WebSocket from "ws";
import { guard, live, wordsOf } from "./guard.js";

const base = process.env.URL ?? "ws://localhost:8080";
const files = process.argv.slice(2);
if (!files.length) throw new Error("pass one or more 16 kHz mono 16-bit WAV files (or text:<words>, moment:<kind>)");
await guard(base);
const token = process.env.SESSION ?? "test-session";
const recipe = process.env.RECIPE ?? "grandma-red-braised-pork";
const outDir = new URL("../test-audio/out/", import.meta.url);
mkdirSync(outDir, { recursive: true });

/** The PCM inside a WAV (the "data" chunk). */
function pcmOf(file: string): Buffer {
  const wav = readFileSync(file);
  if (wav.readUInt32LE(24) !== 16000 || wav.readUInt16LE(22) !== 1) throw new Error(`${file}: need 16 kHz mono`);
  for (let i = 12; i < wav.length - 8; ) {
    const id = wav.toString("ascii", i, i + 4);
    const size = wav.readUInt32LE(i + 4);
    if (id === "data") return wav.subarray(i + 8, Math.min(wav.length, i + 8 + size));
    i += 8 + size;
  }
  throw new Error(`${file}: no data chunk`);
}

function wavOf(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`.padStart(7);

const ws = new WebSocket(`${base}/cook?session=${encodeURIComponent(token)}&recipe=${encodeURIComponent(recipe)}`);
let audio: Buffer[] = [];
let rate = 24000;
let said = 0;
let replied: () => void = () => {};
let lastEnd = 0;
let lastEventAt = Date.now();
let speaking = false;
let sayAt = 0;
let playingUntil = 0; // when a phone would finish playing the last line
let offered: () => void = () => {};
let lastKind = "";

ws.on("message", (data, isBinary) => {
  if (isBinary) return void audio.push(data as Buffer);
  const ev = JSON.parse(data.toString());
  if (ev.type === "transcript" && !ev.final) return; // partials are noisy; the final one is printed
  lastEventAt = Date.now();
  if (ev.type === "say") { audio = []; rate = ev.audio.sampleRate; speaking = true; lastKind = ev.kind; sayAt = Date.now(); }
  if (ev.type === "say_end") {
    speaking = false;
    playingUntil = sayAt + (Buffer.concat(audio).length / 2 / rate) * 1000;
    if (lastKind === "offer") offered();
    const file = new URL(`say-${++said}.wav`, outDir);
    writeFileSync(file, wavOf(Buffer.concat(audio), rate));
    console.log(`${stamp()}  say_end → ${file.pathname} (${(Buffer.concat(audio).length / 2 / rate).toFixed(1)}s of audio)`);
    replied();
    return;
  }
  if (ev.type === "transcript") lastEnd = Date.now();
  const lag = ev.type !== "transcript" && lastEnd ? `  (+${Date.now() - lastEnd}ms after transcript)` : "";
  console.log(`${stamp()}  ${JSON.stringify(ev)}${lag}`);
  // A clip answers with the cook's voice, and a declined offer or a silent step needs no say. (A step that is
  // read sends its say right after go_to_step, and the wait below covers it.)
  if (ev.type === "play_clip" || ev.type === "offer_closed" || ev.type === "go_to_step") replied();
});
ws.on("close", (code) => { console.log(`${stamp()}  closed ${code}`); process.exit(code === 1000 ? 0 : 1); });
await new Promise((r) => ws.once("open", r));
// The hello and "Want me to read it out loud?" come first (a returning kid gets neither).
await Promise.race([new Promise<void>((r) => (offered = r)), sleep(10_000)]);
while (Date.now() < playingUntil + 500) { ws.send(Buffer.alloc(3200)); await sleep(100); }

const silence = Buffer.alloc(3200); // 100 ms
for (const file of files) {
  if (file.startsWith("moment:")) {
    const kind = file.slice("moment:".length);
    const msg = kind === "off" ? { type: "moment", open: false } : { type: "moment", open: true, kind };
    console.log(`${stamp()}  ▶ ${JSON.stringify(msg)}`);
    ws.send(JSON.stringify(msg));
    continue;
  }
  if (file === "video:on" || file === "video:off") {
    const msg = { type: "video", playing: file === "video:on" };
    console.log(`${stamp()}  ▶ ${JSON.stringify(msg)}`);
    ws.send(JSON.stringify(msg));
    continue;
  }
  if (file.startsWith("wait:")) {
    console.log(`${stamp()}  ▶ waiting ${file.slice(5)} s`);
    for (const end = Date.now() + Number(file.slice(5)) * 1000; Date.now() < end; ) { ws.send(Buffer.alloc(3200)); await sleep(100); }
    continue;
  }
  const done = new Promise<void>((r) => (replied = r));
  if (file.startsWith("text:") || !live) {
    // FAKE=1: the service hears nothing, so a recorded line goes as its words (same path as a spoken turn).
    const text = file.startsWith("text:") ? file.slice("text:".length) : wordsOf(file);
    console.log(`${stamp()}  ▶ sending text "${text}"${file.startsWith("text:") ? "" : ` (for ${file})`}`);
    ws.send(JSON.stringify({ type: "text", text }));
  } else {
    console.log(`${stamp()}  ▶ streaming ${file}`);
    const pcm = pcmOf(file);
    for (let i = 0; i < pcm.length; i += 3200) { ws.send(pcm.subarray(i, i + 3200)); await sleep(100); }
  }
  // Keep the mic "open" with silence, as the app does, until the reply lands (or 20 s).
  let waited = 0;
  const pump = setInterval(() => { ws.send(silence); waited += 100; }, 100);
  await Promise.race([done, sleep(20_000)]);
  clearInterval(pump);
  if (waited >= 20_000) console.log(`${stamp()}  (no reply in 20 s)`);
  // Like a kid listening: wait until a phone would have played it all, and homie has gone quiet (a reply can be
  // two lines: a hint, then "I'll ask Grandma too"; a step can be followed by a story offer).
  while (speaking || Date.now() < playingUntil + 1500 || Date.now() - lastEventAt < 1500) { ws.send(silence); await sleep(100); }
}
ws.close(1000);
