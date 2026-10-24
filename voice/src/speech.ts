// Real or fake speech, picked once at start. VOICE_FAKE_SPEECH=1 (`npm run dev:fake`) runs the service with no
// Cartesia or Gemini Live at all, so local test runs cost nothing: the listeners hear nothing (send the kid's words as
// { type: "text" }, which the test client does by default), and every spoken line is silence about as long as it
// would take to say. Never set it on Cloud Run.
import { InkStream } from "./ink.js";
import { SONIC_SAMPLE_RATE, speak as sonicSpeak, speakWav as sonicSpeakWav, type Voice } from "./sonic.js";
import { createStt as realCreateStt, type Stt, type SttEvents } from "./stt.js";

export const fakeSpeech = process.env.VOICE_FAKE_SPEECH === "1";

const deaf = (): Stt => ({ send() {}, close() {} });

/** The kid's speech to text in cook mode (Ink 2). */
export const listenInk = (events: SttEvents, keyterms: string[] = []): Stt =>
  fakeSpeech ? deaf() : new InkStream(events, keyterms);

/** The cook's speech to text while she records (Ink 2, or Gemini Live for Marathi). */
export const createStt: typeof realCreateStt = (language, events, keyterms = []) =>
  fakeSpeech ? deaf() : realCreateStt(language, events, keyterms);

/** Roughly how long a line takes to say: 15 characters a second, 0.5–8 s. */
const seconds = (text: string) => Math.min(8, Math.max(0.5, text.length / 15));

function wavHeader(bytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + bytes, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SONIC_SAMPLE_RATE, 24);
  h.writeUInt32LE(SONIC_SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

/** Sonic, faked: the line's length in silence, 100 ms after the call. An abort ends it with no audio. */
const fakeSpeak: typeof sonicSpeak = (text, format, signal, onChunk) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      const pcm = Buffer.alloc(Math.round(seconds(text) * SONIC_SAMPLE_RATE) * 2);
      onChunk(format === "wav" ? Buffer.concat([wavHeader(pcm.length), pcm]) : pcm);
      resolve();
    }, 100);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export const speak: typeof sonicSpeak = fakeSpeech ? fakeSpeak : sonicSpeak;

/** One whole WAV (for POST /speak). */
export async function speakWav(text: string, voice: Voice): Promise<Buffer> {
  if (!fakeSpeech) return sonicSpeakWav(text, voice);
  const parts: Buffer[] = [];
  await fakeSpeak(text, "wav", new AbortController().signal, (c) => parts.push(c), voice);
  return Buffer.concat(parts);
}
