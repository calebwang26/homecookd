// Cartesia Ink 2, streaming speech-to-text with built-in turn detection.
// Docs: https://docs.cartesia.ai/api-reference/stt/turns/websocket
// We send 16 kHz mono 16-bit PCM as binary frames; Ink sends turn.start / turn.update / turn.end events.
import WebSocket from "ws";
import { env } from "./env.js";

export const CARTESIA_VERSION = "2026-08-14";

export type InkEvents = {
  /** The kid started talking: stop any speech we're playing. */
  onTurnStart: () => void;
  /** Cumulative text of the turn so far (never revised). */
  onPartial: (text: string) => void;
  /** The turn is over: act on this. */
  onTurnEnd: (text: string) => void;
  onError: (message: string) => void;
};

// Words Ink should expect in a kitchen; the session adds the cook's name and the recipe title.
const KEYTERMS = ["next step", "go back", "repeat that"];

export class InkStream {
  private ws: WebSocket;
  private queue: Buffer[] = [];
  private closedByUs = false;

  constructor(
    private events: InkEvents,
    private keyterms: string[] = [],
  ) {
    this.ws = this.open();
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
    const ws = new WebSocket(`wss://api.cartesia.ai/stt/turns/websocket?${q}`, {
      headers: { "X-API-Key": env.cartesiaKey, "Cartesia-Version": CARTESIA_VERSION },
    });
    ws.on("open", () => {
      for (const chunk of this.queue) ws.send(chunk);
      this.queue = [];
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let ev: { type: string; transcript?: string; message?: string; title?: string };
      try {
        ev = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (ev.type === "turn.start") this.events.onTurnStart();
      else if (ev.type === "turn.update" && ev.transcript) this.events.onPartial(ev.transcript);
      else if (ev.type === "turn.end") this.events.onTurnEnd((ev.transcript ?? "").trim());
      else if (ev.type === "error") this.events.onError(ev.message || ev.title || "ink error");
    });
    ws.on("error", (err) => this.events.onError(`ink socket: ${err.message}`));
    ws.on("close", () => {
      // Ink can drop a long session; reopen while the kid is still cooking.
      if (!this.closedByUs) setTimeout(() => !this.closedByUs && (this.ws = this.open()), 250);
    });
    return ws;
  }

  /** One chunk of 16 kHz mono s16le PCM (100 ms = 3200 bytes is a good size). */
  send(pcm: Buffer) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(pcm);
  }

  close() {
    this.closedByUs = true;
    this.ws.close();
  }
}
