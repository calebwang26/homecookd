// Live speech-to-text, picked by language: Cartesia Ink 2 for the languages it knows (it detects which
// on its own), Gemini Live for the rest (Marathi). Both give the same turn events.
import { GeminiLiveStt } from "./geminiLive.js";
import { InkStream } from "./ink.js";

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

export function createStt(language: string, events: SttEvents, keyterms: string[] = []): Stt {
  if (INK_LANGUAGES.includes(language)) return new InkStream(events, keyterms);
  return new GeminiLiveStt(language, events, keyterms);
}
