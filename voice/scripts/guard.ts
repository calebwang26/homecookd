// How a test client runs. By default it streams the recorded audio to a real service, so Ink 2 and Sonic are tested
// for real (Caleb, Oct 24: we have the credits, use them to check voice quality). FAKE=1 is the quick offline check:
// it needs a service started with fake speech (`npm run dev:fake`, which it checks on /health) and sends each recorded
// line's words as text. Every run stops at MAX_S seconds (default 15 min), only so a stuck run can't stream for hours.
import { basename } from "node:path";
import { LINES } from "./testLines.js";

export const fake = process.env.FAKE === "1";
export const live = !fake;

/** Arms the safety cap; with FAKE=1, checks the service runs with fake speech and exits if it doesn't. */
export async function guard(base: string, defaultCapS = 15 * 60): Promise<void> {
  const cap = Number(process.env.MAX_S) || defaultCapS;
  setTimeout(() => {
    console.log(`stopped: the ${cap} s safety cap (MAX_S) ran out`);
    process.exit(3);
  }, cap * 1000).unref();
  if (!fake) return;
  const health = await fetch(`${base.replace(/^ws/, "http")}/health`).catch(() => null);
  if (health?.headers.get("x-fake-speech") !== "1") {
    console.error(`FAKE=1, but ${base} isn't running with fake speech. Start it with \`npm run dev:fake\`, or drop FAKE=1.`);
    process.exit(2);
  }
}

/** The words a recorded line says ("test-audio/next-step.wav" → "Next step."), for sending as text. */
export function wordsOf(file: string): string {
  const line = LINES[basename(file, ".wav")];
  if (!line) throw new Error(`${file}: not one of the lines in scripts/testLines.ts, so there are no words to send`);
  return line.text;
}
