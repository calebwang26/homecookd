// Cartesia ink-whisper, live speech-to-text for the cook's languages Ink 2 doesn't know (Gujarati, Tamil,
// Mandarin, Arabic, …). Docs: https://docs.cartesia.ai/api-reference/stt/websocket (the manual endpoint: no turn
// detection). It takes her language (ISO 639-1) and writes in its script. max_silence_duration_secs finalizes a
// piece of speech after a short pause (without it, the last words of a sentence wait for the next piece); we join
// the pieces into one turn and end it PAUSE_MS after the last piece, once the mic has been quiet that long and
// every voiced second has its words: a piece arrives after its sentence ends, sometimes well after (Oct 24 live
// run: 1.3 s after she stopped), so between two sentences nothing new comes for a while.
// Like Ink 2 it bills for the audio it's fed, so a stream with no audio for IDLE_CLOSE_MS closes until the next frame.
import WebSocket from "ws";
import { cartesiaKey, keyExhausted, socketOutOfCredits } from "./cartesiaKeys.js";
import { CARTESIA_VERSION, IDLE_CLOSE_MS, type InkConnect } from "./ink.js";
import type { SttEvents } from "./stt.js";

/** Silence that finalizes a piece of speech (Oct 24 probe: 0.8 s kept every sentence's last words). */
const SILENCE_S = "0.8";
/** Nothing new for this long after a final piece ends her turn. */
export const PAUSE_MS = 1500;
/** Louder than this (RMS of 16-bit samples) is her voice; speech in the Oct 24 test audio is ~1400, pauses ~10. */
export const VOICE_RMS = 400;
/** A noisy kitchen can't hold a turn open forever: it ends this long after the last piece regardless. */
export const MAX_HOLD_MS = 5000;
/** Voice this far (in seconds of audio) past the last transcribed word means a piece is still coming. */
const UNHEARD_S = 0.5;
const BYTES_PER_S = 16_000 * 2;
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
  private lastVoiceAt = 0;
  private lastPieceAt = 0;
  /** This socket's audio clock (seconds sent), the last voiced second, and the end of the last word heard. */
  private sentS = 0;
  private voiceS = 0;
  private heardS = 0;
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
    this.sentS = this.voiceS = this.heardS = 0;
    const key = cartesiaKey();
    const ws = this.connect(`wss://api.cartesia.ai/stt/websocket?${q}`, {
      "X-API-Key": key,
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
      let ev: { type: string; text?: string; is_final?: boolean; words?: { end: number }[]; message?: string; title?: string; status_code?: number; error_code?: string | null };
      try {
        ev = JSON.parse(data.toString());
      } catch {
        return;
      }
      const lastWord = ev.words?.at(-1)?.end;
      if (ev.type === "transcript" && ev.is_final && typeof lastWord === "number") this.heardS = Math.max(this.heardS, lastWord);
      if (ev.type === "transcript" && ev.text?.trim()) this.heard(ev.text, ev.is_final === true);
      else if (ev.type === "error") {
        this.events.onError(ev.message || ev.title || "ink-whisper error");
        // Out of credits mid-session: close, and the reopen below uses the next key.
        if (socketOutOfCredits(ev) && keyExhausted(key)) {
          this.retryMs = RETRY_FIRST_MS;
          ws.close();
        }
      }
    });
    ws.on("error", (err) => {
      this.events.onError(`ink-whisper socket: ${err.message}`);
      // A key out of credits is refused at the handshake (402): the reopen after this uses the next key, at once.
      if (socketOutOfCredits(err) && keyExhausted(key)) this.retryMs = RETRY_FIRST_MS;
    });
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
    this.lastPieceAt = Date.now();
    clearTimeout(this.pauseTimer);
    // After interim words, wait for their final (the silence or a flush brings it).
    this.pauseTimer = setTimeout(() => this.maybeEndTurn(), final ? PAUSE_MS : INTERIM_MS);
  }

  /** Ends the turn unless she's still talking or a piece of what she said is still on its way. */
  private maybeEndTurn() {
    const now = Date.now();
    const talking = now - this.lastVoiceAt < PAUSE_MS;
    const coming = this.voiceS > this.heardS + UNHEARD_S;
    if (!(talking || coming) || now - this.lastPieceAt >= MAX_HOLD_MS) return this.endTurn();
    const wait = Math.min(PAUSE_MS - (now - this.lastVoiceAt), MAX_HOLD_MS - (now - this.lastPieceAt));
    this.pauseTimer = setTimeout(() => this.maybeEndTurn(), Math.max(100, wait));
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
    this.sentS += pcm.length / BYTES_PER_S;
    if (rms(pcm) > VOICE_RMS) {
      this.lastVoiceAt = this.lastFrameAt;
      this.voiceS = this.sentS;
    }
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

/** Loudness of 16-bit little-endian PCM. */
export function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += pcm.readInt16LE(i * 2) ** 2;
  return Math.sqrt(sum / n);
}
