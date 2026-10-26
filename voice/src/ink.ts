// Cartesia Ink 2, streaming speech-to-text with built-in turn detection.
// Docs: https://docs.cartesia.ai/api-reference/stt/turns/websocket
// We send 16 kHz mono 16-bit PCM as binary frames; Ink sends turn.start / turn.update / turn.end events.
// Ink detects the language itself (en, fr, hi, ja, es), so there is no language to pass.
// Ink bills for the time it's fed, so a stream with no audio for IDLE_CLOSE_MS is closed and opened again with
// the next frame (a phone that went to the background or quiet, or a screen left open).
import WebSocket from "ws";
import { cartesiaKey, keyExhausted, socketOutOfCredits } from "./cartesiaKeys.js";
import type { SttEvents } from "./stt.js";

export const CARTESIA_VERSION = "2026-08-14";

export type InkEvents = SttEvents;

// Words Ink should expect in a kitchen; the session adds the cook's name and the recipe title.
const KEYTERMS = ["next step", "go back", "repeat that"];

export const IDLE_CLOSE_MS = 2 * 60_000;
/** While the socket connects, keep at most the last 2 s of audio (16 kHz s16le). */
const QUEUE_MAX_BYTES = 2 * 16_000 * 2;
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 10_000;

export type InkConnect = (url: string, headers: Record<string, string>) => WebSocket;
const connectInk: InkConnect = (url, headers) => new WebSocket(url, { headers });

export class InkStream {
  private ws: WebSocket;
  private queue: Buffer[] = [];
  private queued = 0;
  private closedByUs = false;
  /** Closed on purpose for lack of audio: the next frame opens it again. */
  private idle = false;
  private lastFrameAt = Date.now();
  private retryMs = RETRY_FIRST_MS;
  private idleCheck: NodeJS.Timeout;

  constructor(
    private events: InkEvents,
    private keyterms: string[] = [],
    private connect: InkConnect = connectInk,
  ) {
    this.ws = this.open();
    this.idleCheck = setInterval(() => this.closeIfIdle(), 30_000);
    this.idleCheck.unref?.();
  }

  private open(): WebSocket {
    const q = new URLSearchParams({
      model: "ink-2",
      encoding: "pcm_s16le",
      sample_rate: "16000",
      cartesia_version: CARTESIA_VERSION,
      // A little quicker than the default, so "next" doesn't feel slow; 2 s cap when the kid trails off.
      turn_end_timeout_ms: "2000",
    });
    for (const k of [...KEYTERMS, ...this.keyterms].slice(0, 100)) q.append("keyterm", k);
    const key = cartesiaKey();
    const ws = this.connect(`wss://api.cartesia.ai/stt/turns/websocket?${q}`, {
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
      let ev: { type: string; transcript?: string; message?: string; title?: string; status_code?: number; error_code?: string | null };
      try {
        ev = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (ev.type === "turn.start") this.events.onTurnStart();
      else if (ev.type === "turn.update" && ev.transcript) this.events.onPartial(ev.transcript);
      else if (ev.type === "turn.end") this.events.onTurnEnd((ev.transcript ?? "").trim());
      else if (ev.type === "error") {
        this.events.onError(ev.message || ev.title || "ink error");
        // Out of credits mid-session: close, and the reopen below uses the next key.
        if (socketOutOfCredits(ev) && keyExhausted(key)) {
          this.retryMs = RETRY_FIRST_MS;
          ws.close();
        }
      }
    });
    ws.on("error", (err) => {
      this.events.onError(`ink socket: ${err.message}`);
      // A key out of credits is refused at the handshake (402): the reopen after this uses the next key, at once.
      if (socketOutOfCredits(err) && keyExhausted(key)) this.retryMs = RETRY_FIRST_MS;
    });
    ws.on("close", () => {
      if (this.closedByUs || this.idle || ws !== this.ws) return;
      // Ink can drop a long session: reopen while the kid is still cooking, backing off if it keeps failing.
      const wait = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
      setTimeout(() => !this.closedByUs && !this.idle && ws === this.ws && (this.ws = this.open()), wait);
    });
    return ws;
  }

  private closeIfIdle() {
    if (this.closedByUs || this.idle || Date.now() - this.lastFrameAt < IDLE_CLOSE_MS) return;
    this.idle = true;
    this.ws.close();
  }

  /** One chunk of 16 kHz mono s16le PCM (100 ms = 3200 bytes is a good size). */
  send(pcm: Buffer) {
    if (this.closedByUs) return;
    this.lastFrameAt = Date.now();
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

  close() {
    this.closedByUs = true;
    clearInterval(this.idleCheck);
    this.ws.close();
  }
}
