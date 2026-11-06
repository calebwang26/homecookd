// The rules of live updates (docs/build/LIVE-UPDATES.md). There's no connection to keep: a phone asks "anything new since this
// version?" and gets the current state, so it can't miss a final state, and any api task can answer.
import { createHash } from "node:crypto";

/** A pure function of what the phone would see: the same on every task, and any change to any field changes it. */
export const versionOf = (data: unknown): string =>
  createHash("sha256").update(JSON.stringify(data)).digest("base64url").slice(0, 22);

/**
 * Counts per key in a fixed window, in this task's memory. It's a brake on a broken or hostile phone, not a promise: a restart
 * forgets it, and N tasks allow N times the limit. `hit` (rateLimit.ts) is exact but writes to Postgres, which on a route
 * called this often would be the biggest cost, and it would stop working in the outage where the brake matters most.
 */
export function windowCounter(max: number, windowMs: number, now: () => number = Date.now, maxKeys = 100_000) {
  let start = now();
  const counts = new Map<string, number>();
  const roll = () => {
    if (now() - start >= windowMs || counts.size >= maxKeys) {
      counts.clear();
      start = now();
    }
  };
  return {
    /** Seconds until this key may go again; 0 when it may go now. */
    waitS(key: string): number {
      roll();
      return (counts.get(key) ?? 0) >= max ? (start + windowMs - now()) / 1000 : 0;
    },
    add(key: string): void {
      roll();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
  };
}

/** When to ask next. The server picks, so it can slow every phone down without a release, and ±10% keeps phones from lining up. */
export function pollAfterMs(baseMs: number, floorMs: number, random: () => number = Math.random): number {
  return Math.round(Math.max(baseMs, floorMs) * (0.9 + 0.2 * random()));
}

const DOWN_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "57P01", "57P02", "57P03", "57014", "53300"]);

/** The database is away or overloaded, rather than a bug in this code. A phone should wait and ask again. */
export function isDatabaseDown(error: unknown): boolean {
  const { code, message } = error as { code?: string; message?: string };
  if (code && (DOWN_CODES.has(code) || code.startsWith("08"))) return true;
  return /^(timeout exceeded when trying to connect|Connection terminated)/.test(message ?? "");
}
