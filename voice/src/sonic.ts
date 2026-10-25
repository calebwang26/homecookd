// Cartesia Sonic, text to speech. /tts/bytes streams the audio back as it's made, so we forward
// chunks to the phone as they arrive. Docs: https://docs.cartesia.ai/api-reference/tts/bytes
// homie sounds the way Caleb picked in the Oct 24 audition ("Riya bilingual", env.homieVoice): Marathi as locale
// mr-IN, English as locale en-IN with a mood for the kind of line, both at one slow pace.
// When Sonic fails before any audio went out (an HTTP error such as 402 or 429, a network error, or no audio within
// 4 s), Gemini says the line instead (geminiTts.ts). Once audio has started, a failure just ends the line.
import { env } from "./env.js";
import { geminiSpeak } from "./geminiTts.js";
import { CARTESIA_VERSION } from "./ink.js";

export type AudioFormat = "pcm" | "wav";
/** Gemini's backup voice is asked for the same rate, so the rate a `say` message announces holds either way. */
export const SONIC_SAMPLE_RATE = 24000;
export const SONIC_MODEL = "sonic-3.6";
/** homie's one pace, everywhere. HOMIE_SPEED overrides it; Sonic takes 0.6–1.5. */
export const SPEED = Math.min(1.5, Math.max(0.6, Number(env.homieSpeed) || 0.85));
/** No audio from Sonic by then, and Gemini says the line. */
export const FIRST_AUDIO_MS = 4000;

type Emotion = "content" | "curious" | "affectionate" | "grateful" | "calm";
/**
 * The mood of each kind of line: the `kind` of record.ts's and cook.ts's `say` (/speak's caller may name one).
 * Sonic takes emotion guidance for English only, and only these values from Cartesia's list
 * (https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion).
 */
const MOODS: Record<string, Emotion> = {
  // A cook recording: the hello, homie's questions, a reaction to her story, the goodbye.
  intro: "content",
  amount: "curious",
  cue: "curious",
  substitution: "curious",
  story: "curious",
  end: "curious",
  optin: "curious",
  reaction: "affectionate",
  closing: "grateful",
  // The kid cooking: steps and hints read calmly, the cook's words passed on with love.
  greeting: "content",
  step: "calm",
  hint: "calm",
  reply: "content",
  nudge: "content",
  timer: "content",
  translation: "affectionate",
};
export const moodOf = (kind?: string): Emotion => (kind && Object.hasOwn(MOODS, kind) ? MOODS[kind] : "content");

/** Who speaks, in what language, and what kind of line it is. Defaults: homie's voice, English. */
export type Voice = { language?: string; voice?: string; kind?: string };

/** Sonic's language fields and generation_config for one line. Never `language` and `locale` together. */
export function sonicFields(language = "en", kind?: string) {
  if (language === "mr") return { locale: "mr-IN", generation_config: { speed: SPEED } };
  if (language === "en") return { locale: "en-IN", generation_config: { speed: SPEED, emotion: moodOf(kind) } };
  return { language, generation_config: { speed: SPEED } };
}

/** The /tts/bytes body for one line. */
export function sonicRequest(text: string, format: AudioFormat, voice: Voice = {}) {
  return {
    model_id: SONIC_MODEL,
    transcript: text,
    voice: voice.voice ?? env.homieVoice,
    output_format: { container: format === "wav" ? "wav" : "raw", encoding: "pcm_s16le", sample_rate: SONIC_SAMPLE_RATE },
    ...sonicFields(voice.language, voice.kind),
  };
}

/** Sonic failed before any of its audio went out, so another voice may still say the line. */
class SonicFailed extends Error {
  constructor(
    readonly reason: string,
    detail = "",
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

/** Sonic alone. Throws SonicFailed when nothing was sent yet, anything else once audio started (or on abort). */
async function sonic(text: string, format: AudioFormat, signal: AbortSignal, onChunk: (audio: Buffer) => void, voice: Voice) {
  const firstAudio = new AbortController();
  const timer = setTimeout(() => firstAudio.abort(), FIRST_AUDIO_MS);
  let started = false;
  const body = sonicRequest(text, format, voice);
  if (env.ttsLog) {
    const { transcript, output_format, ...settings } = body;
    console.log(`tts: sonic ${voice.kind ?? "-"} ${JSON.stringify(settings)}`);
  }
  try {
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      signal: AbortSignal.any([signal, firstAudio.signal]),
      headers: {
        "X-API-Key": env.cartesiaKey,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) throw new SonicFailed(String(res.status), (await res.text()).slice(0, 200));
    for await (const chunk of res.body) {
      if (!started) clearTimeout(timer);
      started = true;
      onChunk(Buffer.from(chunk));
    }
    if (!started) throw new SonicFailed("no audio");
  } catch (err) {
    if (started || signal.aborted || err instanceof SonicFailed) throw err;
    if (firstAudio.signal.aborted) throw new SonicFailed(`no audio in ${FIRST_AUDIO_MS / 1000} s`);
    throw new SonicFailed("network", (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which voices may say a line. `backup: false` is Sonic alone, with no Gemini: for a line made ahead and kept
 * (cook.ts), which must be homie's voice. `sonic: false` is Gemini alone: Sonic just failed on this line.
 */
export type Route = { sonic?: boolean; backup?: boolean };

/** Speak `text`, calling onChunk with each piece of audio. Resolves when done; rejects on a failure or an abort. */
export async function speak(
  text: string,
  format: AudioFormat,
  signal: AbortSignal,
  onChunk: (audio: Buffer) => void,
  voice: Voice = {},
  { sonic: useSonic = true, backup = true }: Route = {},
): Promise<void> {
  if (!useSonic) {
    if (!env.geminiKey) throw new Error("sonic failed, and there's no backup voice");
    console.log("tts: gemini (sonic failed on this line already)");
    return geminiSpeak(text, format, signal, onChunk, SONIC_SAMPLE_RATE);
  }
  try {
    await sonic(text, format, signal, onChunk, voice);
  } catch (err) {
    if (!(err instanceof SonicFailed) || signal.aborted || !backup || !env.geminiKey) throw err;
    console.log(`tts: gemini fallback (sonic ${err.reason})`);
    await geminiSpeak(text, format, signal, onChunk, SONIC_SAMPLE_RATE).catch((gemini: Error) => {
      if (signal.aborted) throw gemini;
      throw new Error(`${err.message}, then ${gemini.message}`);
    });
  }
}

/** One whole WAV (for POST /speak). */
export async function speakWav(text: string, voice: Voice): Promise<Buffer> {
  const parts: Buffer[] = [];
  await speak(text, "wav", new AbortController().signal, (c) => parts.push(c), voice);
  return Buffer.concat(parts);
}
