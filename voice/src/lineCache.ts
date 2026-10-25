// homie's step lines, made once (Caleb, Oct 24: "it should be pre-generated, so there's no lag"). Sonic's audio
// for a line is kept by voice, language, kind, format and text, in one cache for the whole process: a second kid on
// the same recipe, or a reconnect, costs nothing. A line still being made is shared too: whoever asks gets what's
// made so far at once, then the rest as it arrives, so it's never made twice. A line that fails isn't kept, and
// the next ask makes it again. Least recently used lines go first, past 300 lines or 64 MB.
import type { AudioFormat, Voice } from "./sonic.js";

/** Makes a line's audio: calls onChunk with each piece, resolves when done, rejects when it failed. */
export type Make = (onChunk: (audio: Buffer) => void, signal: AbortSignal) => Promise<void>;

/** A line still being made after this is dropped: a stream stalled mid-line would hold everyone waiting on it. */
export const MAKE_MAX_MS = 20_000;

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

  add(chunk: Buffer) {
    if (this.state !== "making") return;
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    for (const l of this.listeners) l();
  }

  end(error?: Error) {
    if (this.state !== "making") return;
    this.state = error || !this.bytes ? "failed" : "done";
    this.error = error ?? (this.bytes ? undefined : new Error("no audio"));
    this.settle();
    for (const l of this.listeners) l();
  }

  /**
   * Sends the line to onChunk: everything made so far at once, then each new piece as it comes. Resolves when the
   * line ends or `signal` aborts, with how many bytes went out (0: nothing to play, the caller says it another way).
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
        if (signal.aborted) return finish();
        while (sent < this.chunks.length) {
          bytes += this.chunks[sent].length;
          onChunk(this.chunks[sent++]);
        }
        if (this.state !== "making") finish();
      };
      signal.addEventListener("abort", finish, { once: true });
      this.listeners.add(pump);
      pump();
    });
  }
}

export class LineCache {
  private lines = new Map<string, Line>();

  constructor(
    readonly maxLines = 300,
    readonly maxBytes = 64 * 2 ** 20,
  ) {}

  /** The line for `key`: kept, still being made, or made now with `make`. */
  get(key: string, make: Make): Line {
    const kept = this.lines.get(key);
    if (kept) {
      // Most recently used goes last; eviction starts from the front.
      this.lines.delete(key);
      this.lines.set(key, kept);
      return kept;
    }
    const line = new Line();
    this.lines.set(key, line);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MAKE_MAX_MS);
    make((chunk) => line.add(chunk), ctrl.signal)
      .then(
        () => line.end(ctrl.signal.aborted ? new Error(`not made in ${MAKE_MAX_MS / 1000} s`) : undefined),
        (err: Error) => line.end(err),
      )
      .finally(() => {
        clearTimeout(timer);
        if (line.state === "failed" && this.lines.get(key) === line) this.lines.delete(key);
        else this.trim();
      });
    return line;
  }

  get size() {
    return this.lines.size;
  }

  get bytes() {
    let total = 0;
    for (const l of this.lines.values()) total += l.bytes;
    return total;
  }

  clear() {
    this.lines.clear();
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
