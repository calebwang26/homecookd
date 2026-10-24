// Shared by the unit tests: a fake socket the services talk to, and a fake clock to move.
import assert from "node:assert/strict";
import { mock } from "node:test";
import WebSocket from "ws";

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

/** The phone's end of the socket: keeps every JSON message the service sends. */
export class FakeSocket {
  readyState: number = WebSocket.OPEN;
  events: Ev[] = [];
  closeCode?: number;
  send(data: string | Buffer) {
    if (typeof data === "string") this.events.push(JSON.parse(data));
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

/** Sonic, faked: AUDIO_S seconds of silence 100 ms after the call; an abort ends it early. */
export function fakeSpeak(spoken: string[]) {
  return (text: string, _format: unknown, signal: AbortSignal, onChunk: (audio: Buffer) => void) =>
    new Promise<void>((resolve) => {
      spoken.push(text);
      const timer = setTimeout(() => (onChunk(Buffer.alloc(AUDIO_S * 48_000)), resolve()), 100);
      signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });
}
