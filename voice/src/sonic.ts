// Cartesia Sonic, text to speech. /tts/bytes streams the audio back as it's made, so we forward
// chunks to the phone as they arrive. Docs: https://docs.cartesia.ai/api-reference/tts/bytes
import { env } from "./env.js";
import { CARTESIA_VERSION } from "./ink.js";

export type AudioFormat = "pcm" | "wav";
export const SONIC_SAMPLE_RATE = 24000;

/** Who speaks and in what language. Defaults: the kid-side voice, English. */
export type Voice = { language?: string; voice?: string; speed?: number };

/** Sonic takes Marathi as a locale; the two fields can't both be sent. */
const languageField = (lang = "en") => (lang === "mr" ? { locale: "mr-IN" } : { language: lang });

/** Speak `text`, calling onChunk with each piece of audio. Resolves when done or aborted. */
export async function speak(
  text: string,
  format: AudioFormat,
  signal: AbortSignal,
  onChunk: (audio: Buffer) => void,
  voice: Voice = {},
): Promise<void> {
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    signal,
    headers: {
      "X-API-Key": env.cartesiaKey,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript: text,
      voice: voice.voice ?? env.cartesiaVoice,
      output_format: { container: format === "wav" ? "wav" : "raw", encoding: "pcm_s16le", sample_rate: SONIC_SAMPLE_RATE },
      ...languageField(voice.language),
      generation_config: { speed: voice.speed ?? 0.95 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`sonic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  for await (const chunk of res.body) onChunk(Buffer.from(chunk));
}

/** One whole WAV (for POST /speak). */
export async function speakWav(text: string, voice: Voice): Promise<Buffer> {
  const parts: Buffer[] = [];
  await speak(text, "wav", new AbortController().signal, (c) => parts.push(c), voice);
  return Buffer.concat(parts);
}
