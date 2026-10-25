// Runs one homie recording against the voice service like the phone by the stove would: hears the
// hello, sends start, says a line with a vague amount, answers homie's question, sends done, hears the
// count line, answers the end questions and the stories opt-in, and waits for the goodbye. Every run checks the
// wrap-up's order (the count line, the questions back to back inside {type:"hold"}, the plate photo, goodbye) and
// prints the count line and the hold's timings. The mic streams silence
// between lines. Prints every event with timings and saves homie's lines to test-audio/out/. It streams the recorded
// audio for real; FAKE=1 against `npm run dev:fake` sends the cook's lines as text instead (scripts/guard.ts).
//   VOICE_STUB=1 HOMIE_DEMO=1 npm run dev                       (in another terminal)
//   npm run test-record                                          Marathi (stub recording "stub-mr")
//   COOK_LANG=en npm run test-record                                  English ("stub-en"); ta, zh: Tamil, Mandarin
//   RECORDING=stub-mr-again npm run test-record                       a cook homie has met (the short hello)
//   RECORDING=stub-mr-ajoba npm run test-record                       a grandfather, for the whole family (no kid name)
//   COOK_LANG=en RECORDING=stub-en-dad npm run test-record            Vijay, whom the family calls "Dad", for Shreya
//   SESSION=<cook's sessionToken> RECORDING=<recordings _id> npm run test-record   live Convex
//   CAMERA=1 npm run test-record      filmed in the app: {type:"start", camera:true}, a still every 5 s
//                                     (FRAME=<jpeg>, default a pot of chili), a 6 s pause and resume, and
//                                     the plate photo at the end ({type:"plate", ok:true})
// The wrap-up's turn-taking (record.ts listen), on the first question after done:
//   SCENARIO=long npm run test-record    a long, slow answer: three of her lines with 2.5 s and 3 s pauses between
//                                        them. PASS needs homie silent until she's finished, then one answer.
//   SCENARIO=silent npm run test-record  she says nothing: "still there?" ~5 s after the question played, the
//                                        let-off ~5 s after that, then no more questions (no opt-in) and goodbye.
//   SCENARIO=late npm run test-record    she answers 2 s after "still there?" played: no let-off, the questions go on.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import WebSocket from "ws";
import { guard, live, wordsOf } from "./guard.js";

const base = process.env.URL ?? "ws://localhost:8080";
/** The phone starts playing a line about this long after its say_end (record.ts PLAYER_LOAD_MS). */
const PLAYER_LOAD_MS = 250;
/** mr (default), en, ta or zh: the stub recording and the cook's test lines in that language. */
const lang = ["en", "ta", "zh"].includes(process.env.COOK_LANG ?? "") ? process.env.COOK_LANG! : "mr";
const token = process.env.SESSION ?? "test-session";
const recording = process.env.RECORDING ?? `stub-${lang}`;
const camera = process.env.CAMERA === "1";
const scenario = ["long", "silent", "late"].includes(process.env.SCENARIO ?? "") ? process.env.SCENARIO! : "";
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
/** Every time a line of hers finished playing into the mic (SCENARIO=long finds its answer's end here). */
const speechEnds: number[] = [];
const mic = setInterval(() => {
  const chunk = queue.shift();
  ws.send(chunk ?? Buffer.alloc(3200));
  if (chunk && !queue.length) speechEnds.push((speechEndAt = Date.now()));
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
  play(name, pcmOf(name));
}
function play(name: string, pcm: Buffer) {
  console.log(`${stamp()}  ▶ cook says ${name} (${(pcm.length / 32000).toFixed(1)}s)`);
  queue = [];
  for (let i = 0; i < pcm.length; i += 3200) queue.push(pcm.subarray(i, i + 3200));
}
/** SCENARIO=long: three of her lines with 2.5 s and 3 s of silence between them, like a cook stopping to think. */
function longAnswer(): Buffer {
  const quiet = (s: number) => Buffer.alloc(Math.round(s * 16_000) * 2);
  return Buffer.concat([pcmOf("answer"), quiet(2.5), pcmOf("cooking"), quiet(3), pcmOf("yes")]);
}

type Ev = { type: string; [k: string]: unknown };

const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
/** Fails the run (exit code 1) with `what` unless `ok`. */
function check(ok: boolean, what: string) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

/** The SCENARIO's checks, from what homie said and asked after the tested question (`seen`). */
function checkScenario(t: { ask: Ev; playedAt: number; start: number; end: number } | undefined) {
  console.log(`\nscenario ${scenario}:`);
  if (!t) return check(false, "no wrap-up question to test");
  const after = seen.filter((e) => e.at >= t.start);
  const lines = after.filter((e) => e.type === "say");
  const asks = after.filter((e) => e.type === "ask");
  const answered = after.filter((e) => e.type === "answered" && e.promptId === t.ask.promptId);
  if (scenario === "silent") {
    const [nudge, letOff] = lines;
    check(/^Still there/.test(nudge?.textEn ?? ""), `"still there?" first: ${nudge?.textEn}`);
    if (nudge) check(nudge.at - t.playedAt >= 4800 && nudge.at - t.playedAt < 6500, `…${s(nudge.at - t.playedAt)} after the ${t.ask.kind} question played (5 s wanted)`);
    check(/No need to answer today/.test(letOff?.textEn ?? ""), `then the let-off: ${letOff?.textEn}`);
    if (letOff && nudge?.playedAt) check(letOff.at - nudge.playedAt >= 4800 && letOff.at - nudge.playedAt < 6500, `…${s(letOff.at - nudge.playedAt)} after "still there?" played (5 s wanted)`);
    check(!asks.some((a) => a.kind === "end" || a.kind === "optin"), `no more questions after the let-off (asked: ${asks.map((a) => a.kind).join(", ") || "none"})`);
    check(answered.length === 0, "nothing marked answered");
    check(lines.at(-1)?.kind === "closing", `the goodbye last: ${lines.at(-1)?.textEn}`);
  } else {
    let from = t.start;
    if (scenario === "late") {
      const nudge = lines[0];
      check(/^Still there/.test(nudge?.textEn ?? ""), `"still there?" ${nudge ? s(nudge.at - t.playedAt) : "never"} after the ${t.ask.kind} question played`);
      check(!lines.some((l) => /No need to answer today/.test(l.textEn ?? "")), "no let-off once she answered");
      from = (nudge?.playedAt ?? t.start) + 1000;
    }
    const end = speechEnds.find((x) => x > t.start) ?? t.end;
    const during = after.filter((e) => (e.type === "say" || e.type === "ask") && e.at > from && e.at < end);
    check(during.length === 0, `homie silent for the whole ${s(end - from)} answer${during.length ? ` (said ${during.map((e) => e.textEn).join(" | ")})` : ""}`);
    const finals = after.filter((e) => e.type === "transcript" && e.at <= (answered[0]?.at ?? Infinity));
    check(answered.length === 1 && answered[0].at > end, `one answer, after she finished (${finals.length} final transcript${finals.length === 1 ? "" : "s"} joined)`);
    const nextLine = after.find((e) => (e.type === "say" || e.type === "ask") && e.at >= end);
    if (nextLine) check(nextLine.at - end >= 2500 && nextLine.at - end < 12_000, `homie's next line ${s(nextLine.at - end)} after her last word: ${nextLine.textEn}`);
    else check(false, "homie said nothing after her answer");
    if (scenario === "long") check(!lines.some((l) => /^Still there/.test(l.textEn ?? "")), `no "still there?" while she answered`);
  }
}
/**
 * The wrap-up (record.ts wrapUp), from done on: the count line first, then the end questions and the opt-in back to
 * back with the hold on from done until the last one's wait is over (and the let-off has
 * played), then the plate photo (CAMERA=1) and goodbye. As many questions as the count line said (fewer after a let-off).
 */
function checkWrapUp(doneAt: number) {
  console.log("\nwrap-up:");
  const after = seen.filter((e) => e.at >= doneAt);
  const lines = after.filter((e) => e.type === "say");
  const asks = after.filter((e) => e.type === "ask");
  const holds = after.filter((e) => e.type === "hold");
  const count = lines[0];
  console.log(`  count line: "${count?.text}"${count?.text !== count?.textEn ? ` ("${count?.textEn}")` : ""}`);
  const said = /\b(one|two|three) quick question/.exec(count?.textEn ?? "")?.[1];
  const photo = /photo of your plate/.test(count?.textEn ?? "");
  check(count?.kind === "reaction" && (!!said || photo), "the count line first, before any question");
  const n = said ? ["one", "two", "three"].indexOf(said) + 1 : 0;
  const spoken = asks.filter((a) => a.kind === "end" || a.kind === "optin");
  const letOff = lines.find((l) => /No need to answer today/.test(l.textEn ?? ""));
  check(letOff ? spoken.length <= n : spoken.length === n, `${spoken.length} question${spoken.length === 1 ? "" : "s"} asked; the count line said ${n}${letOff ? " (a let-off)" : ""}`);
  check(photo === camera, `the plate photo ${photo ? "counted" : "not counted"} (CAMERA=${camera ? 1 : 0})`);
  const rank = { end: 0, optin: 1, plate: 2 } as Record<string, number>;
  const kinds = asks.map((a) => a.kind ?? "");
  check(kinds.every((k, i) => i === 0 || rank[kinds[i - 1]] <= rank[k]) && kinds.includes("plate") === camera, `order: ${kinds.join(" → ")} → goodbye`);
  check(holds.map((h) => (h.on ? "on" : "off")).join(" ") === (spoken.length ? "on off" : ""), `hold: ${holds.map((h) => (h.on ? "on" : "off")).join(", ") || "none"}`);
  const on = holds.find((h) => h.on);
  const off = holds.find((h) => !h.on);
  if (on && count) check(on.at - doneAt < 1000 && on.at <= count.at, `hold on ${s(count.at - on.at)} before the count line (${s(on.at - doneAt)} after done)`);
  const last = spoken.at(-1);
  const waitEnd = after.find((e) => (e.type === "answered" || e.type === "drop") && e.promptId === last?.promptId);
  if (off && waitEnd) check(off.at >= waitEnd.at, `hold off ${s(off.at - waitEnd.at)} after the last question's wait ended (${last?.kind})`);
  if (off && letOff) check(off.at >= (letOff.playedAt ?? Infinity) - 100, `hold off ${s(off.at - (letOff.playedAt ?? 0))} after the let-off played`);
  const next = off && after.find((e) => (e.type === "say" || e.type === "ask") && e.at >= off.at);
  if (off) check(next?.kind === (camera ? "plate" : "closing"), `then the ${next?.kind} ${next ? s(next.at - off.at) : "never"} after hold off`);
  check(!holds.at(-1)?.on, "hold is off before ended");
  check(holdsInSay === 0, `no hold between a say and its say_end (${holdsInSay})`);
}

const waiters: { match: (e: Ev) => boolean; resolve: (e: Ev) => void }[] = [];
const next = (match: (e: Ev) => boolean, ms: number, what: string) =>
  Promise.race([
    new Promise<Ev>((resolve) => waiters.push({ match, resolve })),
    sleep(ms).then(() => {
      throw new Error(`no ${what} in ${ms / 1000}s`);
    }),
  ]);

let audio: Buffer[] = [];
/** A hold sent while a line's audio was still coming (an older app would cut the line there): never. */
let inSay = false;
let holdsInSay = 0;
let sayAt = 0;
let firstAudioAt = 0;
let said = 0;
/** When the phone would finish playing homie's last line (the cook waits for it, like a person would). */
let playedAt = 0;
/** homie's lines and questions with when they came, and when each line finished playing (the scenarios' checks). */
const seen: { type: string; kind?: string; text?: string; textEn?: string; promptId?: string; on?: boolean; at: number; playedAt?: number }[] = [];
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    if (!audio.length && sayAt) {
      firstAudioAt = Date.now();
      timings.push(`say → first audio ${firstAudioAt - sayAt}ms`);
    }
    audio.push(data as Buffer);
    return;
  }
  const ev = JSON.parse(data.toString()) as Ev;
  if (ev.type === "say") inSay = true;
  else if (ev.type === "say_end") inSay = false;
  else if (ev.type === "hold" && inSay) holdsInSay++;
  if (ev.type === "transcript" && !ev.final) return;
  if (ev.type === "state") return;
  if (["say", "ask", "answered", "drop", "transcript", "hold"].includes(ev.type)) {
    const text = ev.text as string | undefined;
    seen.push({ type: ev.type, kind: ev.kind as string, text, textEn: (ev.textEn as string) ?? text, promptId: ev.promptId as string, on: ev.on as boolean, at: Date.now() });
  }
  if (ev.type === "say") {
    audio = [];
    sayAt = Date.now();
    firstAudioAt = 0;
  }
  if (ev.type === "say_end") {
    const pcm = Buffer.concat(audio);
    const file = new URL(`record-${lang}-${++said}.wav`, outDir);
    writeFileSync(file, wavOf(pcm, 24000));
    // Like the phone: it plays a line only once it has all of it, ~250 ms after say_end (lib/live/homie.ts flushSay).
    if (!ev.interrupted) playedAt = Date.now() + PLAYER_LOAD_MS + (pcm.length / 48000) * 1000;
    const line = seen.findLast((s) => s.type === "say");
    if (line) line.playedAt = playedAt;
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
  const doneAt = Date.now();
  ws.send(JSON.stringify({ type: "done" }));
  // The count line; end questions, then the opt-in; the plate (CAMERA=1); then the goodbye. SCENARIO picks how she
  // answers the first question.
  let tested: { ask: Ev; playedAt: number; start: number; end: number } | undefined;
  for (;;) {
    const ev = await next((e) => e.type === "ask" || (e.type === "phase" && e.phase === "ended"), 90_000, "end question");
    if (ev.type === "phase") break;
    await next((e) => e.type === "say_end", 30_000, "end question audio");
    const asked = playedAt;
    await sleep(playedAt - Date.now() + 800);
    if (ev.kind === "plate") {
      console.log(`${stamp()}  ▶ plate photo taken`);
      ws.send(JSON.stringify({ type: "plate", ok: true }));
      continue;
    }
    if (scenario && !tested && live) {
      const start = Date.now();
      if (scenario === "silent") {
        console.log(`${stamp()}  ▶ cook stays quiet`);
        tested = { ask: ev, playedAt: asked, start, end: start };
        continue;
      }
      if (scenario === "late") {
        console.log(`${stamp()}  ▶ cook stays quiet until "still there?" has played`);
        await next((e) => e.type === "say" && e.kind === "reaction", 15_000, `"still there?"`);
        await next((e) => e.type === "say_end", 30_000, `"still there?" audio`);
        await sleep(playedAt - Date.now() + 2000);
        say(ev.kind === "optin" ? "yes" : "answer");
        tested = { ask: ev, playedAt: asked, start, end: start };
        continue;
      }
      const pcm = longAnswer();
      play("a long answer (answer, 2.5 s, cooking, 3 s, yes)", pcm);
      tested = { ask: ev, playedAt: asked, start, end: start + (pcm.length / 32000) * 1000 };
      continue;
    }
    say(ev.kind === "optin" ? "yes" : "answer");
  }
  clearInterval(frames);
  console.log("\nlatency:\n  " + timings.join("\n  "));
  checkWrapUp(doneAt);
  if (scenario) checkScenario(tested);
  console.log(process.exitCode ? "\nFAIL" : "\nPASS");
} catch (err) {
  console.log(`\nFAIL: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  clearInterval(mic);
  ws.close(1000);
  await sleep(200);
  process.exit();
}
