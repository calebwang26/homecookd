// Gemini TTS, homie's backup voice: when Sonic fails before a line starts (sonic.ts), Gemini says the same line.
// The Interactions API, streamed: raw 16-bit mono PCM at the rate we ask for, as base64 in server-sent events.
// It detects the language itself (Marathi included). Docs: https://ai.google.dev/gemini-api/docs/speech-generation
import { env } from "./env.js";

const URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** One short delivery note, kept the same on every line (the docs: long style prompts make the voice drift). */
export const GEMINI_STYLE = "warm and gentle, like a caring older cousin";

/** The request for one line. `store: false`: the family's words aren't kept on Google's side. */
export function geminiRequest(text: string, sampleRate: number) {
  return {
    model: env.geminiTtsModel,
    input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: GEMINI_STYLE }] }] }],
    response_format: { type: "audio", mime_type: "audio/l16", sample_rate: sampleRate },
    generation_config: { speech_config: [{ voice: env.geminiTtsVoice }] },
    stream: true,
    store: false,
  };
}

/** A WAV header for `bytes` of 16-bit mono PCM. */
export function wavHeader(bytes: number, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + bytes, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

/** The PCM in each `step.delta` audio event of the stream. */
async function* audioOf(body: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  let buf = "";
  const decoder = new TextDecoder();
  for await (const bytes of body) {
    buf += decoder.decode(bytes, { stream: true });
    let end: number;
    while ((end = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, end).trim();
      buf = buf.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const ev = JSON.parse(data) as { event_type?: string; delta?: { type?: string; data?: string }; error?: { code?: string; message?: string } };
      if (ev.event_type === "error") throw new Error(`gemini tts: ${ev.error?.code ?? ""} ${ev.error?.message ?? ""}`.trim());
      if (ev.event_type === "step.delta" && ev.delta?.type === "audio" && ev.delta.data) yield Buffer.from(ev.delta.data, "base64");
    }
  }
}

/**
 * Speaks `text` with Gemini, calling onChunk the way Sonic does: PCM pieces as they arrive, or (wav) one whole WAV
 * at the end, so the frames joined are still one file. Throws on an HTTP or stream error, or an abort.
 */
export async function geminiSpeak(
  text: string,
  format: "pcm" | "wav",
  signal: AbortSignal,
  onChunk: (audio: Buffer) => void,
  sampleRate: number,
): Promise<void> {
  const res = await fetch(URL, {
    method: "POST",
    signal,
    headers: { "x-goog-api-key": env.geminiKey, "Content-Type": "application/json" },
    body: JSON.stringify(geminiRequest(text, sampleRate)),
  });
  if (!res.ok || !res.body) throw new Error(`gemini tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parts: Buffer[] = [];
  for await (const pcm of audioOf(res.body)) {
    if (signal.aborted) return;
    if (format === "pcm") onChunk(pcm);
    else parts.push(pcm);
  }
  if (format === "wav" && parts.length && !signal.aborted) {
    const pcm = Buffer.concat(parts);
    onChunk(Buffer.concat([wavHeader(pcm.length, sampleRate), pcm]));
  }
}
