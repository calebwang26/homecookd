// Live speech-to-text, picked by language: Cartesia Ink 2 for the languages it knows (it detects which on its
// own), Gemini Live for Marathi (as before Oct 24; a move off Gemini is planned separately), and Cartesia
// ink-whisper for the other languages it knows (Gujarati, Tamil, Mandarin, …). All give the same turn events.
import { GeminiLiveStt } from "./geminiLive.js";
import { InkStream } from "./ink.js";
import { InkWhisperStream } from "./inkWhisper.js";

export type SttEvents = {
  /** Someone started talking: stop any speech we're playing. */
  onTurnStart: () => void;
  /** Text of the turn so far. */
  onPartial: (text: string) => void;
  /** The turn is over: act on this. */
  onTurnEnd: (text: string) => void;
  onError: (message: string) => void;
};

export type Stt = { send: (pcm: Buffer) => void; close: () => void };

export const INK_LANGUAGES = ["en", "fr", "hi", "ja", "es"];
/**
 * The app's languages (app/src/lib/languages.ts) that go to ink-whisper. It knows Marathi too, but Marathi stays on
 * Gemini Live, which heard it better in the Oct 24 probe. Odia isn't in ink-whisper's list, so it stays there too.
 */
export const WHISPER_LANGUAGES = [
  "zh", "ar", "bn", "pt", "ru", "ur", "id", "de", "te", "tr", "ta", "vi", "ko", "tl", "it", "gu", "th", "kn", "pa",
  "ml", "ms", "pl", "uk",
];

export type SttEngine = "ink-2" | "gemini-live" | "ink-whisper";

export function sttEngine(language: string): SttEngine {
  if (INK_LANGUAGES.includes(language)) return "ink-2";
  if (WHISPER_LANGUAGES.includes(language)) return "ink-whisper";
  return "gemini-live";
}

/** `keyterms` reach Ink 2 and Gemini; ink-whisper takes none. */
export function createStt(language: string, events: SttEvents, keyterms: string[] = []): Stt {
  const engine = sttEngine(language);
  if (engine === "ink-2") return new InkStream(events, keyterms);
  if (engine === "gemini-live") return new GeminiLiveStt(language, events, keyterms);
  return new InkWhisperStream(language, events);
}
