// Keeps test runs off Cartesia's meter (AGENTS.md: at most one live Cartesia smoke test per merge).
// By default a test client only talks to a service started with fake speech (`npm run dev:fake`), which it checks on
// /health, and sends each recorded line's words as text. LIVE=1 streams the real audio to a real service (Ink 2 bills
// 3 credits a second, silence included; Sonic 1 a character). Every run stops at a hard cap: MAX_S seconds, at most
// 300 when live.
import { basename } from "node:path";
import { LINES } from "./testLines.js";

export const live = process.env.LIVE === "1";

/** Checks the service is safe to run against, and arms the time cap. Exits if it isn't. */
export async function guard(base: string, defaultCapS: { fake: number; live: number }): Promise<void> {
  const asked = Number(process.env.MAX_S);
  const cap = live ? Math.min(asked || defaultCapS.live, 300) : asked || defaultCapS.fake;
  setTimeout(() => {
    console.log(`stopped: the ${cap} s cap (MAX_S) ran out`);
    process.exit(3);
  }, cap * 1000).unref();
  if (live) {
    console.log(`LIVE: real Cartesia (about 3 credits a second while connected, plus 1 a spoken character); stops at ${cap} s`);
    return;
  }
  const health = await fetch(`${base.replace(/^ws/, "http")}/health`).catch(() => null);
  if (health?.headers.get("x-fake-speech") !== "1") {
    console.error(
      `${base} isn't running with fake speech, so this run would spend Cartesia credits.\n` +
        "Start it with `npm run dev:fake`, or make the one live smoke test of this merge with LIVE=1.",
    );
    process.exit(2);
  }
}

/** The words a recorded line says ("test-audio/next-step.wav" → "Next step."), for sending as text. */
export function wordsOf(file: string): string {
  const line = LINES[basename(file, ".wav")];
  if (!line) throw new Error(`${file}: not one of the lines in scripts/testLines.ts, so there are no words to send`);
  return line.text;
}
