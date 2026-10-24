// Cartesia Sonic, text to speech. /tts/bytes streams the audio back as it's made, so we forward
// chunks to the phone as they arrive. Docs: https://docs.cartesia.ai/api-reference/tts/bytes
import { env } from "./env.js";
import { CARTESIA_VERSION } from "./ink.js";

export type AudioFormat = "pcm" | "wav";
export const SONIC_SAMPLE_RATE = 24000;

/** Speak `text`, calling onChunk with each piece of audio. Resolves when done or aborted. */
export async function speak(
  text: string,
  format: AudioFormat,
  signal: AbortSignal,
  onChunk: (audio: Buffer) => void,
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
      voice: env.cartesiaVoice,
      output_format: { container: format === "wav" ? "wav" : "raw", encoding: "pcm_s16le", sample_rate: SONIC_SAMPLE_RATE },
      language: "en",
      generation_config: { speed: 0.95 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`sonic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  for await (const chunk of res.body) onChunk(Buffer.from(chunk));
}
