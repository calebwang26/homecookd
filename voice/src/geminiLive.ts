// Live speech-to-text for the languages Ink 2 doesn't know (Marathi), with Gemini's transcription-only
// Live model. Docs: https://ai.google.dev/gemini-api/docs/live-api/live-transcribe
// A Live session lasts about 10 minutes, so we open the next one before then (and on GoAway or a drop)
// and buffer audio while it connects. A turn ends when the transcript has been still for ~1.5 s.
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { env } from "./env.js";
import type { SttEvents } from "./stt.js";

const ROTATE_MS = 9 * 60 * 1000;
const PAUSE_MS = 1500;
/** Server VAD's final usually lands ~1.2 s after speech; if it never does, use the interim text. */
const INTERIM_MS = 4000;
const MAX_QUEUE = 50; // 5 s of audio while a session connects

/** Ink-style code → the BCP-47 code Gemini wants. */
const LOCALES: Record<string, string> = { mr: "mr-IN", hi: "hi-IN", gu: "gu-IN", bn: "bn-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", ta: "ta-IN" };

let client: GoogleGenAI | null = null;

export class GeminiLiveStt {
  private session: Session | null = null;
  private connecting = false;
  private queue: Buffer[] = [];
  private closedByUs = false;
  private rotateTimer?: NodeJS.Timeout;
  private handle?: string;
  /** Finished segments of this turn, and the live segment still being heard. */
  private finals: string[] = [];
  private interim = "";
  private inTurn = false;
  private pauseTimer?: NodeJS.Timeout;

  constructor(
    private language: string,
    private events: SttEvents,
    private vocabulary: string[] = [],
  ) {
    if (!env.geminiKey) {
      events.onError("GEMINI_API_KEY isn't set: no live transcript for this language");
      return;
    }
    client ??= new GoogleGenAI({ apiKey: env.geminiKey });
    void this.open();
  }

  private async open() {
    if (this.closedByUs || this.connecting) return;
    this.connecting = true;
    const old = this.session;
    // Callbacks can fire before connect() resolves, so they read the session through this.
    const ref: { session?: Session } = {};
    try {
      const session = await client!.live.connect({
        model: env.geminiLiveModel,
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: {
            languageCodes: [LOCALES[this.language] ?? this.language],
            ...(this.vocabulary.length ? { customVocabulary: this.vocabulary.slice(0, 100) } : {}),
          },
          sessionResumption: this.handle ? { handle: this.handle } : {},
          contextWindowCompression: { slidingWindow: {} },
        },
        callbacks: {
          onmessage: (m) => this.onServer(m, ref.session),
          onerror: (e) => this.events.onError(`gemini live: ${e.message}`),
          onclose: () => {
            // Only the current session's close matters; a rotated-out one closes on purpose.
            if (ref.session && this.session === ref.session) {
              this.session = null;
              if (!this.closedByUs) setTimeout(() => void this.open(), 250);
            }
          },
        },
      });
      ref.session = session;
      if (this.closedByUs) return session.close();
      this.session = session;
      for (const chunk of this.queue) this.sendTo(session, chunk);
      this.queue = [];
      clearTimeout(this.rotateTimer);
      this.rotateTimer = setTimeout(() => void this.open(), ROTATE_MS);
      if (old && old !== session) {
        // Let the old one finish the words it's on, then drop it.
        old.sendRealtimeInput({ audioStreamEnd: true });
        setTimeout(() => old.close(), 3000);
      }
    } catch (err) {
      this.events.onError(`gemini live connect: ${(err as Error).message}`);
      if (!this.closedByUs) setTimeout(() => void this.open(), 2000);
    } finally {
      this.connecting = false;
    }
  }

  private onServer(m: LiveServerMessage, from?: Session) {
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway && from && from === this.session) void this.open();
    const interim = m.serverContent?.interimInputTranscription?.text;
    const final = m.serverContent?.inputTranscription?.text;
    if (interim) this.heard(interim, false);
    if (final) this.heard(final, true);
  }

  private heard(text: string, final: boolean) {
    if (!this.inTurn) {
      this.inTurn = true;
      this.events.onTurnStart();
    }
    if (final) {
      this.finals.push(text.trim());
      this.interim = "";
    } else {
      this.interim = text.trim();
    }
    this.events.onPartial(this.text());
    clearTimeout(this.pauseTimer);
    // After interim text, wait for its final (it lags the speech a little).
    this.pauseTimer = setTimeout(() => this.endTurn(), final ? PAUSE_MS : INTERIM_MS);
  }

  private text() {
    return [...this.finals, this.interim].filter(Boolean).join(" ");
  }

  private endTurn() {
    const text = this.text();
    this.finals = [];
    this.interim = "";
    this.inTurn = false;
    if (text) this.events.onTurnEnd(text);
  }

  private sendTo(session: Session, pcm: Buffer) {
    session.sendRealtimeInput({ audio: { data: pcm.toString("base64"), mimeType: "audio/pcm;rate=16000" } });
  }

  /** One chunk of 16 kHz mono s16le PCM. */
  send(pcm: Buffer) {
    // During a rotation the old session keeps hearing us until the new one is up.
    if (this.session) return this.sendTo(this.session, pcm);
    this.queue.push(pcm);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.rotateTimer);
    clearTimeout(this.pauseTimer);
    this.session?.close();
    this.session = null;
  }
}
