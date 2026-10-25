// homie's step lines, made once (Caleb, Oct 24: "it should be pre-generated, so there's no lag"). Sonic's audio
// for a line is kept by voice, language, kind, format and text, in one cache for the whole process: a second kid on
// the same recipe, or a reconnect, costs nothing. A line still being made is shared too: whoever asks gets what's
// made so far at once, then the rest as it arrives, so it's never made twice. Least recently used lines go first,
// past 300 lines or 64 MB.
// When making a line fails, it isn't kept, and asking for it again within FAILED_MS fails at once (the caller says
// it another way) instead of asking Sonic again. Sonic out of credits or rate-limited (402, 429) fails every line
// that way for FAILED_MS, so reconnects and other kids don't all fire at it. Lines made ahead of time (`ahead`) go
// AHEAD_AT_ONCE at a time across the whole process.
import type { AudioFormat, Voice } from "./sonic.js";

/** Makes a line's audio: calls onChunk with each piece, resolves when done, rejects when it failed. */
export type Make = (onChunk: (audio: Buffer) => void, signal: AbortSignal) => Promise<void>;

/** A line still being made after this fails: a stream stalled mid-line would hold everyone waiting on it. */
export const MAKE_MAX_MS = 20_000;
/** How long a failed line (or a busy Sonic) is remembered. */
export const FAILED_MS = 60_000;
/** Lines made ahead at once, across every session. */
export const AHEAD_AT_ONCE = 2;
/** Sonic's error for no credits or too many requests (sonic.ts SonicFailed: "402: …", "429: …"). */
const BUSY = /^(402|429)\b/;

export class Line {
  readonly chunks: Buffer[] = [];
  bytes = 0;
  state: "making" | "done" | "failed" = "making";
  error?: Error;
  /** Resolves (never rejects) once the line is done or failed. */
  readonly ready: Promise<void>;
  private settle!: () => void;
  private listeners = new Set<() => void>();

  constructor() {
    this.ready = new Promise((r) => (this.settle = r));
  }

  /** A line that failed already, for one remembered as failed. */
  static failed(error: Error) {
    const line = new Line();
    line.end(error);
    return line;
  }

  add(chunk: Buffer) {
    if (this.state !== "making") return;
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    this.notify();
  }

  /** Ends the line (once): done with audio, else failed. Returns how it ended. */
  end(error?: Error): Line["state"] {
    if (this.state !== "making") return this.state;
    this.state = error || !this.bytes ? "failed" : "done";
    this.error = error ?? (this.bytes ? undefined : new Error("no audio"));
    this.settle();
    this.notify();
    return this.state;
  }

  /** Tells every reader; one reader's error never stops the others. */
  private notify() {
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        console.warn("line reader", (err as Error).message);
      }
    }
  }

  /**
   * Sends the line to onChunk: everything made so far at once, then each new piece as it comes. Resolves when the
   * line ends, `signal` aborts or onChunk throws, with how many bytes went out (0: nothing to play, the caller says
   * it another way).
   */
  play(signal: AbortSignal, onChunk: (audio: Buffer) => void): Promise<number> {
    return new Promise((resolve) => {
      let sent = 0;
      let bytes = 0;
      const finish = () => {
        this.listeners.delete(pump);
        signal.removeEventListener("abort", finish);
        resolve(bytes);
      };
      const pump = () => {
        try {
          if (signal.aborted) return finish();
          while (sent < this.chunks.length) {
            const chunk = this.chunks[sent++];
            onChunk(chunk);
            bytes += chunk.length;
          }
          if (this.state !== "making") finish();
        } catch (err) {
          console.warn("line reader", (err as Error).message);
          finish();
        }
      };
      signal.addEventListener("abort", finish, { once: true });
      this.listeners.add(pump);
      pump();
    });
  }
}

export class LineCache {
  private lines = new Map<string, Line>();
  /** Lines that failed lately, and why: asked for again before FAILED_MS, they fail at once. */
  private failed = new Map<string, { until: number; error: Error }>();
  /** Sonic said 402 or 429: until then every new line fails at once. */
  private busy = { until: 0, error: new Error("busy") };
  /** Lines being made ahead, and who waits for a turn. */
  private aheadNow = 0;
  private aheadQueue: (() => void)[] = [];

  constructor(
    readonly maxLines = 300,
    readonly maxBytes = 64 * 2 ** 20,
    readonly aheadAtOnce = AHEAD_AT_ONCE,
  ) {}

  /** True while Sonic is out of credits or rate-limited (a 402 or 429 in the last FAILED_MS). */
  get sonicBusy() {
    return Date.now() < this.busy.until;
  }

  /** The line for `key`: kept, still being made, made now with `make`, or failed at once (see FAILED_MS). */
  get(key: string, make: Make): Line {
    const kept = this.lines.get(key);
    if (kept) {
      // Most recently used goes last; eviction starts from the front.
      this.lines.delete(key);
      this.lines.set(key, kept);
      return kept;
    }
    const now = Date.now();
    const failed = this.failed.get(key);
    if (failed && now < failed.until) return Line.failed(failed.error);
    if (this.sonicBusy) return Line.failed(this.busy.error);
    this.failed.delete(key);
    const line = new Line();
    this.lines.set(key, line);
    const ctrl = new AbortController();
    // Whichever comes first, the make settling or the time running out, ends the line (once).
    const settle = (error?: Error) => {
      if (line.state !== "making") return;
      clearTimeout(timer);
      if (line.end(error) === "done") return this.trim();
      if (this.lines.get(key) === line) this.lines.delete(key);
      const remembered = { until: Date.now() + FAILED_MS, error: line.error! };
      for (const [k, f] of this.failed) if (Date.now() >= f.until) this.failed.delete(k);
      this.failed.set(key, remembered);
      if (BUSY.test(remembered.error.message)) this.busy = remembered;
    };
    const timer = setTimeout(() => {
      ctrl.abort();
      settle(new Error(`not made in ${MAKE_MAX_MS / 1000} s`));
    }, MAKE_MAX_MS);
    make((chunk) => line.add(chunk), ctrl.signal).then(
      () => settle(),
      (err: Error) => settle(err),
    );
    return line;
  }

  /**
   * Makes `key` ahead of time, at most `aheadAtOnce` lines at a time across the process (a line kept already
   * doesn't wait); resolves with the line once it's done or failed.
   */
  async ahead(key: string, make: Make): Promise<Line> {
    if (this.lines.has(key)) {
      const line = this.get(key, make);
      await line.ready;
      return line;
    }
    if (this.aheadNow < this.aheadAtOnce) this.aheadNow++;
    else await new Promise<void>((r) => this.aheadQueue.push(r)); // handed a turn by the one before
    try {
      const line = this.get(key, make);
      await line.ready;
      return line;
    } finally {
      const next = this.aheadQueue.shift();
      if (next) next();
      else this.aheadNow = Math.max(0, this.aheadNow - 1);
    }
  }

  get size() {
    return this.lines.size;
  }

  get bytes() {
    let total = 0;
    for (const l of this.lines.values()) total += l.bytes;
    return total;
  }

  /** Forgets everything (tests: each one opens its recipes on a fresh "instance"). */
  clear() {
    this.lines.clear();
    this.failed.clear();
    this.busy = { until: 0, error: new Error("busy") };
    this.aheadNow = 0;
    this.aheadQueue = [];
  }

  /** Drops the least recently used lines that are done until both limits hold. Lines being made stay. */
  private trim() {
    let bytes = this.bytes;
    for (const [key, line] of this.lines) {
      if (this.lines.size <= this.maxLines && bytes <= this.maxBytes) return;
      if (line.state === "making") continue;
      this.lines.delete(key);
      bytes -= line.bytes;
    }
  }
}

/** The process's one cache of homie's step lines. */
export const lineCache = new LineCache();

/** A line's key: who says it, how (language and kind set the voice's locale and mood), in what format, and what. */
export const lineKey = (text: string, format: AudioFormat, voice: Voice) =>
  JSON.stringify([voice.voice ?? "", voice.language ?? "en", voice.kind ?? "", format, text]);
