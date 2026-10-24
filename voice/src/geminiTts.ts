// Gemini TTS, homie's backup voice: when Sonic fails before a line starts (sonic.ts), Gemini says the same line.
// The Interactions API, streamed: raw 16-bit mono PCM at the rate we ask for, as base64 in server-sent events.
// It detects the language itself (Marathi included). Docs: https://ai.google.dev/gemini-api/docs/speech-generation
// Like Sonic it has a first-audio guard, plus a cap on the whole line: a stalled Gemini ends the line (say_end goes
// out, the mic opens again) instead of leaving it open until the next line.
import { env } from "./env.js";

const URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** One short delivery note, kept the same on every line (the docs: long style prompts make the voice drift). */
export const GEMINI_STYLE = "warm and gentle, like a caring older cousin";
/** No audio from Gemini by then, and the line ends with no voice. */
export const GEMINI_FIRST_AUDIO_MS = 6000;
/** The most one line may take: 10 s plus 100 ms a character (saying it takes about 67 ms a character). */
export const geminiTotalMs = (text: string) => 10_000 + 100 * text.length;
/** Interaction statuses that mean no line is coming (the SDK's InteractionStatus values). */
const FAILED = new Set(["failed", "cancelled", "budget_exceeded"]);

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

/** A WAV header for `bytes` of 16-bit mono PCM at `rate` (Gemini's /speak WAV and fake speech's). */
export function wavHeader(bytes: number, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + bytes, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

type Event = {
  event_type?: string;
  status?: string;
  interaction?: { status?: string };
  delta?: { type?: string; data?: string };
  error?: { code?: string; message?: string };
};

/** The PCM in each `step.delta` audio event of the stream. Throws on an `error` event or a failed interaction. */
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
      const ev = JSON.parse(data) as Event;
      const status = ev.status ?? ev.interaction?.status;
      if (ev.event_type === "error" || ev.event_type === "interaction.failed" || (status && FAILED.has(status))) {
        throw new Error(`gemini tts: ${ev.error?.code ?? status ?? ev.event_type} ${ev.error?.message ?? ""}`.trim());
      }
      if (ev.event_type === "step.delta" && ev.delta?.type === "audio" && ev.delta.data) yield Buffer.from(ev.delta.data, "base64");
    }
  }
}

/**
 * Speaks `text` with Gemini, calling onChunk the way Sonic does: PCM pieces as they arrive, or (wav) one whole WAV
 * at the end, so the frames joined are still one file. Throws on an HTTP or stream error, no audio at all, no audio
 * within GEMINI_FIRST_AUDIO_MS, a line over geminiTotalMs, or an abort (the signal's AbortError).
 */
export async function geminiSpeak(
  text: string,
  format: "pcm" | "wav",
  signal: AbortSignal,
  onChunk: (audio: Buffer) => void,
  sampleRate: number,
): Promise<void> {
  const firstAudio = new AbortController();
  const whole = new AbortController();
  const firstTimer = setTimeout(() => firstAudio.abort(), GEMINI_FIRST_AUDIO_MS);
  const wholeTimer = setTimeout(() => whole.abort(), geminiTotalMs(text));
  let started = false;
  try {
    const res = await fetch(URL, {
      method: "POST",
      signal: AbortSignal.any([signal, firstAudio.signal, whole.signal]),
      headers: { "x-goog-api-key": env.geminiKey, "Content-Type": "application/json" },
      body: JSON.stringify(geminiRequest(text, sampleRate)),
    });
    if (!res.ok || !res.body) throw new Error(`gemini tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const parts: Buffer[] = [];
    for await (const pcm of audioOf(res.body)) {
      if (!started) clearTimeout(firstTimer);
      started = true;
      signal.throwIfAborted();
      if (format === "pcm") onChunk(pcm);
      else parts.push(pcm);
    }
    if (!started) throw new Error("gemini tts: no audio");
    signal.throwIfAborted();
    if (format === "wav") {
      const pcm = Buffer.concat(parts);
      onChunk(Buffer.concat([wavHeader(pcm.length, sampleRate), pcm]));
    }
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    if (firstAudio.signal.aborted) throw new Error(`gemini tts: no audio in ${GEMINI_FIRST_AUDIO_MS / 1000} s`);
    if (whole.signal.aborted) throw new Error(`gemini tts: not done in ${geminiTotalMs(text) / 1000} s`);
    throw err;
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(wholeTimer);
  }
}
