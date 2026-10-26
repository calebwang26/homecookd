// The cook's language (Oct 24): which speech-to-text hears it (stt.ts), and ink-whisper's turns (inkWhisper.ts)
// with a fake socket on a fake clock: pieces join into one turn, a pause ends it, a muted mic asks for the last
// words, and the URL carries her language.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, mock, test } from "node:test";
import WebSocket from "ws";
import type { SttEvents } from "../src/stt.js";
import { advance } from "./helpers.js";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
const { sttEngine, INK_LANGUAGES, WHISPER_LANGUAGES } = await import("../src/stt.js");
const { InkWhisperStream, PAUSE_MS, FLUSH_MS, MAX_HOLD_MS } = await import("../src/inkWhisper.js");
const { languageName } = await import("../src/homie.js");
const { env } = await import("../src/env.js");
const { answerGapMs, ANSWER_GAP_MS } = await import("../src/record.js");

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T17:00:00Z") }));
afterEach(() => mock.timers.reset());

const FRAME = Buffer.alloc(3200);
/** 100 ms of voice: a loud square wave. */
const VOICE = Buffer.alloc(3200);
for (let i = 0; i < 1600; i++) VOICE.writeInt16LE(i % 20 < 10 ? 2000 : -2000, i * 2);
/** The 12 languages added Oct 24, plus Marathi and English. */
const FIRST_SET = ["en", "mr", "hi", "gu", "ta", "te", "pa", "ur", "zh", "ko", "tl", "es", "pt", "ar"];

test("each language goes to the speech-to-text that hears it; Marathi on Gemini Live until MARATHI_STT=cartesia", () => {
  assert.equal(sttEngine("en"), "ink-2");
  assert.equal(sttEngine("hi"), "ink-2");
  assert.equal(sttEngine("es"), "ink-2");
  assert.equal(sttEngine("mr"), "gemini-live");
  for (const l of ["gu", "ta", "te", "pa", "ur", "zh", "ko", "tl", "pt", "ar", "bn", "vi"]) assert.equal(sttEngine(l), "ink-whisper", l);
  assert.equal(sttEngine("or"), "gemini-live", "ink-whisper doesn't know Odia (hidden from the app's picker)");
  for (const l of FIRST_SET) assert.ok(INK_LANGUAGES.includes(l) || WHISPER_LANGUAGES.includes(l) || l === "mr", l);
  const before = env.marathiStt;
  try {
    env.marathiStt = "cartesia";
    assert.equal(sttEngine("mr"), "ink-whisper", "Caleb's Oct 26 choice: Marathi on Cartesia as it is");
    assert.equal(sttEngine("or"), "gemini-live");
    // A Marathi cook keeps the longer wait for her whole answer on either engine (homie-waits-for-answers).
    assert.equal(answerGapMs("mr"), ANSWER_GAP_MS["gemini-live"]);
    assert.equal(answerGapMs("ta"), ANSWER_GAP_MS["ink-whisper"]);
  } finally {
    env.marathiStt = before;
  }
  assert.equal(answerGapMs("mr"), 4000);
  assert.equal(answerGapMs("en"), 3500);
});

test("every language in the first set has a name for Claude's prompts, not a bare code", () => {
  for (const l of FIRST_SET) assert.notEqual(languageName(l), l, l);
  assert.equal(languageName("tl"), "Tagalog");
  assert.equal(languageName("zh"), "Mandarin Chinese");
  assert.equal(languageName("xx"), "xx");
});

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  sent: (Buffer | string)[] = [];
  constructor(readonly url: string) {
    super();
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }
  send(b: Buffer | string) {
    this.sent.push(b);
  }
  /** A transcript piece; a final one carries its last word's end (seconds of this socket's audio), as ink-whisper's do. */
  say(text: string, final: boolean, endS = 0) {
    const words = final ? [{ word: text, start: 0, end: endS }] : undefined;
    this.emit("message", Buffer.from(JSON.stringify({ type: "transcript", text, is_final: final, words })), false);
  }
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

function whisper(language = "ta") {
  const sockets: FakeSocket[] = [];
  const got = { starts: 0, partials: [] as string[], turns: [] as string[], errors: [] as string[] };
  const events: SttEvents = {
    onTurnStart: () => void got.starts++,
    onPartial: (t) => void got.partials.push(t),
    onTurnEnd: (t) => void got.turns.push(t),
    onError: (m) => void got.errors.push(m),
  };
  const s = new InkWhisperStream(language, events, (url) => {
    const f = new FakeSocket(url);
    sockets.push(f);
    return f as unknown as WebSocket;
  });
  sockets[0].open();
  return { s, got, ws: () => sockets.at(-1)! };
}

test("ink-whisper: her language and the short silence go in the URL", () => {
  const { s, ws } = whisper("gu");
  const q = new URL(ws().url).searchParams;
  assert.equal(q.get("model"), "ink-whisper");
  assert.equal(q.get("language"), "gu");
  assert.equal(q.get("max_silence_duration_secs"), "0.8");
  s.close();
});

test("ink-whisper: pieces of one sentence join into one turn, ended by a pause", async () => {
  const { s, got, ws } = whisper();
  ws().say("இப்போ எண்ணெயில்", false);
  assert.equal(got.starts, 1);
  ws().say("இப்போ எண்ணெயில் கடுகு போட்டு", true);
  await advance(PAUSE_MS - 300);
  ws().say(" கொஞ்சம் வெடிக்க விடுங்க.", true);
  assert.equal(got.turns.length, 0, "a new piece inside the pause keeps the turn open");
  await advance(PAUSE_MS + 100);
  assert.deepEqual(got.turns, ["இப்போ எண்ணெயில் கடுகு போட்டு கொஞ்சம் வெடிக்க விடுங்க."]);
  assert.equal(got.starts, 1, "one turn");
  s.close();
});

test("ink-whisper: while the mic still hears her, a second sentence joins the same turn", async () => {
  const { s, got, ws } = whisper();
  ws().say("ஒரு சின்ன ஸ்பூன் உப்பு போதும்.", true, 0);
  for (let i = 0; i < 18; i++) {
    s.send(VOICE); // she keeps talking: the next sentence's piece only comes after it ends
    await advance(100);
  }
  assert.equal(got.turns.length, 0, "1.8 s after the first piece, but she's still talking");
  ws().say(" ரொம்ப வேண்டாம்.", true, 1.8);
  for (let i = 0; i < 20; i++) {
    s.send(FRAME);
    await advance(100);
  }
  assert.deepEqual(got.turns, ["ஒரு சின்ன ஸ்பூன் உப்பு போதும். ரொம்ப வேண்டாம்."]);
  s.close();
});

test("ink-whisper: she stopped, but her last sentence's words are still on their way: the turn waits for them", async () => {
  const { s, got, ws } = whisper();
  for (let i = 0; i < 30; i++) {
    s.send(VOICE); // 3 s of speech
    await advance(100);
  }
  ws().say("好，先把西红柿切成块，", true, 1.4); // the first piece only covers the first 1.4 s
  for (let i = 0; i < 25; i++) {
    s.send(FRAME); // she's quiet now
    await advance(100);
  }
  assert.equal(got.turns.length, 0, "2.5 s of quiet, but 1.6 s of her voice has no words yet");
  ws().say("然后加一点盐。", true, 3);
  await advance(PAUSE_MS + 200);
  assert.deepEqual(got.turns, ["好，先把西红柿切成块，然后加一点盐。"]);
  s.close();
});

test("ink-whisper: a loud kitchen holds the turn at most MAX_HOLD_MS", async () => {
  const { s, got, ws } = whisper();
  ws().say("Agora coloca o alho.", true);
  for (let t = 0; t < MAX_HOLD_MS + 1000; t += 100) {
    s.send(VOICE);
    await advance(100);
  }
  assert.deepEqual(got.turns, ["Agora coloca o alho."]);
  s.close();
});

test("ink-whisper: a muted mic with words still unfinalized asks for them", async () => {
  const { s, ws } = whisper();
  s.send(FRAME);
  ws().say("现在往油里放点姜", false);
  await advance(FLUSH_MS + 100);
  assert.ok(ws().sent.includes("finalize"));
  s.close();
});

test("ink-whisper: no flush when nothing is waiting, and interim words alone still end the turn", async () => {
  const { s, got, ws } = whisper();
  s.send(FRAME);
  await advance(FLUSH_MS + 100);
  assert.ok(!ws().sent.includes("finalize"), "silence with nothing heard: no request");
  ws().say("Agora coloca o alho", false);
  await advance(4100);
  assert.deepEqual(got.turns, ["Agora coloca o alho"], "a final that never came doesn't hold the turn forever");
  s.close();
});

test("ink-whisper: a dropped socket reopens with the same language", async () => {
  const { s, ws } = whisper("ko");
  const first = ws();
  first.close();
  await advance(300);
  assert.notEqual(ws(), first);
  assert.equal(new URL(ws().url).searchParams.get("language"), "ko");
  s.close();
});

const { yesNoWords, isNotNow } = await import("../src/homie.js");
const { GREETINGS } = await import("../src/cook.js");

test("a plain yes or no in each language is understood without Claude; a mix still goes to Claude", () => {
  for (const y of ["હા", "ஆமா", "సరే.", "ਹਾਂ", "ہاں", "好。", "네", "Sí, claro.", "Sim!", "Oo", "نعم", "हाँ", "होय"]) assert.equal(yesNoWords(y), true, y);
  for (const n of ["ના", "வேண்டாம்", "లేదు", "ਨਹੀਂ", "نہیں", "不用", "아니요", "No, gracias.", "Não.", "Hindi", "لا", "नको"]) assert.equal(yesNoWords(n), false, n);
  assert.equal(yesNoWords("Yes, no problem"), null, "both: Claude decides");
  assert.equal(yesNoWords("好的谢谢你"), null, "no spaces: Claude decides");
});

test("'not now' in each language, only as a short reply", () => {
  for (const t of ["आत्ता नको", "अभी नहीं", "પછી", "அப்புறம்", "తర్వాత", "ਹੁਣ ਨਹੀਂ", "ابھی نہیں", "等一下", "나중에", "Ahora no.", "Agora não.", "Mamaya na.", "ليس الآن", "Not now"]) {
    assert.ok(isNotNow(t), t);
  }
  assert.ok(!isNotNow("Después de eso, ponemos el arroz en la olla con agua."), "a long sentence isn't a 'not now'");
});

test("the kid's pot greets in every language of the first set but English", () => {
  for (const l of FIRST_SET.filter((l) => l !== "en")) assert.ok(GREETINGS[l]?.[0] && GREETINGS[l][1], l);
});
