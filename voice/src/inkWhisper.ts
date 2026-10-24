// Cartesia ink-whisper, live speech-to-text for the cook's languages Ink 2 doesn't know (Gujarati, Tamil,
// Mandarin, Arabic, …). Docs: https://docs.cartesia.ai/api-reference/stt/websocket (the manual endpoint: no turn
// detection). It takes her language (ISO 639-1) and writes in its script. max_silence_duration_secs finalizes a
// piece of speech after a short pause (without it, the last words of a sentence wait for the next piece); we join
// the pieces into one turn and end it once nothing new was heard for PAUSE_MS, as geminiLive.ts does.
// Like Ink 2 it bills for the audio it's fed, so a stream with no audio for IDLE_CLOSE_MS closes until the next frame.
import WebSocket from "ws";
import { env } from "./env.js";
import { CARTESIA_VERSION, IDLE_CLOSE_MS, type InkConnect } from "./ink.js";
import type { SttEvents } from "./stt.js";

/** Silence that finalizes a piece of speech (Oct 24 probe: 0.8 s kept every sentence's last words). */
const SILENCE_S = "0.8";
/** Nothing new for this long after a final piece ends her turn. */
export const PAUSE_MS = 1500;
/** Interim words that never got their final end the turn anyway. */
const INTERIM_MS = 4000;
/** No audio for this long with words still unfinalized (homie started speaking, the mic muted): ask for them. */
export const FLUSH_MS = 700;
/** While the socket connects, keep at most the last 2 s of audio (16 kHz s16le). */
const QUEUE_MAX_BYTES = 2 * 16_000 * 2;
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 10_000;

const connectCartesia: InkConnect = (url, headers) => new WebSocket(url, { headers });

export class InkWhisperStream {
  private ws: WebSocket;
  private queue: Buffer[] = [];
  private queued = 0;
  private closedByUs = false;
  private idle = false;
  private lastFrameAt = Date.now();
  private retryMs = RETRY_FIRST_MS;
  private idleCheck: NodeJS.Timeout;
  /** Finished pieces of this turn, and the piece still being heard. */
  private finals: string[] = [];
  private interim = "";
  private inTurn = false;
  private pauseTimer?: NodeJS.Timeout;
  private flushTimer?: NodeJS.Timeout;

  constructor(
    private language: string,
    private events: SttEvents,
    private connect: InkConnect = connectCartesia,
  ) {
    this.ws = this.open();
    this.idleCheck = setInterval(() => this.closeIfIdle(), 30_000);
    this.idleCheck.unref?.();
  }

  private open(): WebSocket {
    const q = new URLSearchParams({
      model: "ink-whisper",
      language: this.language,
      encoding: "pcm_s16le",
      sample_rate: "16000",
      cartesia_version: CARTESIA_VERSION,
      max_silence_duration_secs: SILENCE_S,
    });
    const ws = this.connect(`wss://api.cartesia.ai/stt/websocket?${q}`, {
      "X-API-Key": env.cartesiaKey,
      "Cartesia-Version": CARTESIA_VERSION,
    });
    ws.on("open", () => {
      this.retryMs = RETRY_FIRST_MS;
      for (const chunk of this.queue) ws.send(chunk);
      this.queue = [];
      this.queued = 0;
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let ev: { type: string; text?: string; is_final?: boolean; message?: string; title?: string };
      try {
        ev = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (ev.type === "transcript" && ev.text?.trim()) this.heard(ev.text, ev.is_final === true);
      else if (ev.type === "error") this.events.onError(ev.message || ev.title || "ink-whisper error");
    });
    ws.on("error", (err) => this.events.onError(`ink-whisper socket: ${err.message}`));
    ws.on("close", () => {
      if (this.closedByUs || this.idle || ws !== this.ws) return;
      const wait = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
      setTimeout(() => !this.closedByUs && !this.idle && ws === this.ws && (this.ws = this.open()), wait);
    });
    return ws;
  }

  private heard(text: string, final: boolean) {
    if (!this.inTurn) {
      this.inTurn = true;
      this.events.onTurnStart();
    }
    if (final) {
      this.finals.push(text); // a final's text is a delta with its own spacing: joined as is
      this.interim = "";
    } else {
      this.interim = text.trim();
    }
    this.events.onPartial(this.text());
    clearTimeout(this.pauseTimer);
    // After interim words, wait for their final (the silence or a flush brings it).
    this.pauseTimer = setTimeout(() => this.endTurn(), final ? PAUSE_MS : INTERIM_MS);
  }

  private text() {
    return [this.finals.join("").trim(), this.interim].filter(Boolean).join(" ");
  }

  private endTurn() {
    const text = this.text();
    this.finals = [];
    this.interim = "";
    this.inTurn = false;
    if (text) this.events.onTurnEnd(text);
  }

  private closeIfIdle() {
    if (this.closedByUs || this.idle || Date.now() - this.lastFrameAt < IDLE_CLOSE_MS) return;
    this.idle = true;
    this.ws.close();
  }

  /** One chunk of 16 kHz mono s16le PCM. */
  send(pcm: Buffer) {
    if (this.closedByUs) return;
    this.lastFrameAt = Date.now();
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
    if (this.idle) {
      this.idle = false;
      this.ws = this.open();
    }
    if (this.ws.readyState === WebSocket.OPEN) return void this.ws.send(pcm);
    if (this.ws.readyState !== WebSocket.CONNECTING) return;
    this.queue.push(pcm);
    this.queued += pcm.length;
    while (this.queued > QUEUE_MAX_BYTES && this.queue.length > 1) this.queued -= this.queue.shift()!.length;
  }

  /** The audio stopped mid-sentence, so no silence will finalize it: ask for the words now. */
  private flush() {
    if (this.interim && this.ws.readyState === WebSocket.OPEN) this.ws.send("finalize");
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.idleCheck);
    clearTimeout(this.pauseTimer);
    clearTimeout(this.flushTimer);
    this.ws.close();
  }
}
