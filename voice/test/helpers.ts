// Shared by the unit tests: a fake socket the services talk to, and a fake clock to move.
import assert from "node:assert/strict";
import { mock } from "node:test";
import WebSocket from "ws";
import type { Voice } from "../src/sonic.js";

/** Every line homie says is this long, in the fakes' Sonic (24 kHz s16le = 48,000 bytes a second). */
export const AUDIO_S = 5;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
};
/** Moves the fake clock forward in small steps, letting promises settle in between. */
export async function advance(ms: number, step = 50) {
  for (let done = 0; done < ms; done += step) {
    mock.timers.tick(Math.min(step, ms - done));
    await settle();
  }
}
export async function waitFor(what: string, check: () => boolean, maxMs = 60_000) {
  for (let waited = 0; !check(); waited += 50) {
    if (waited > maxMs) assert.fail(`no ${what} within ${maxMs / 1000} s`);
    await advance(50);
  }
}

export type Ev = { type: string; [k: string]: unknown };

/** The phone's end of the socket: keeps every JSON message the service sends, and where each audio frame came. */
export class FakeSocket {
  readyState: number = WebSocket.OPEN;
  events: Ev[] = [];
  /** Each binary frame: its size, `after` how many JSON messages, and when (the fake clock). */
  frames: { after: number; bytes: number; at: number }[] = [];
  closeCode?: number;
  send(data: string | Buffer) {
    if (typeof data === "string") this.events.push(JSON.parse(data));
    else this.frames.push({ after: this.events.length, bytes: data.length, at: Date.now() });
  }
  /** The audio bytes sent between the event at index `say` and the next say_end. */
  audioOf(say: number) {
    const end = this.events.findIndex((e, i) => i > say && e.type === "say_end");
    return this.frames.filter((f) => f.after > say && (end < 0 || f.after <= end)).reduce((n, f) => n + f.bytes, 0);
  }
  close(code?: number) {
    this.closeCode = code;
    this.readyState = WebSocket.CLOSED;
  }
  of(type: string) {
    return this.events.filter((e) => e.type === type);
  }
  phases() {
    return this.of("phase").map((e) => e.phase);
  }
}

/**
 * Sonic, faked: AUDIO_S seconds of silence 100 ms after the call; an abort ends it early. `voices` gets each call's
 * voice. `stream`: the audio in `chunks` pieces, one every `everyMs` instead (like real Sonic, faster than it plays).
 */
export function fakeSpeak(spoken: string[], voices: Voice[] = [], stream = { chunks: 1, everyMs: 100 }) {
  return (text: string, _format: unknown, signal: AbortSignal, onChunk: (audio: Buffer) => void, voice: Voice = {}) =>
    new Promise<void>((resolve) => {
      spoken.push(text);
      voices.push(voice);
      const timers = Array.from({ length: stream.chunks }, (_, i) =>
        setTimeout(() => {
          onChunk(Buffer.alloc((AUDIO_S * 48_000) / stream.chunks));
          if (i === stream.chunks - 1) resolve();
        }, (i + 1) * stream.everyMs),
      );
      signal.addEventListener("abort", () => (timers.forEach(clearTimeout), resolve()), { once: true });
    });
}
