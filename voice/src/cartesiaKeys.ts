// Cartesia API keys, in order: CARTESIA_API_KEY, then CARTESIA_API_KEYS_BACKUP (comma-separated). When Cartesia says
// a key is out of credits (402 quota_exceeded), every caller in this process moves on to the next key and stays
// there. Other errors never switch keys: they aren't about credits.
import { env } from "./env.js";

const pool = [env.cartesiaKey, ...env.cartesiaBackupKeys];
let at = 0;

/** The key to use now. */
export const cartesiaKey = () => pool[at];

/** Does this HTTP error (status and body) say the key is out of credits? */
export function outOfCredits(status: number | undefined, body: string): boolean {
  return status === 402 && /quota_exceeded|credits limit|out of credits/i.test(body);
}

/** A Cartesia WebSocket error that means out of credits: a rejected handshake, or an error event mid-session. */
export function socketOutOfCredits(e: { message?: string; title?: string; status_code?: number; error_code?: string | null }): boolean {
  if (/Unexpected server response: 402\b/.test(e.message ?? "")) return true;
  return e.error_code === "quota_exceeded" || (e.status_code === 402 && /credit|quota/i.test(`${e.message} ${e.title}`));
}

/** `key` ran out of credits: move past it. True when there's a different key to try now. */
export function keyExhausted(key: string): boolean {
  if (pool[at] === key && at < pool.length - 1) {
    at++;
    console.warn(`cartesia: key ${at + 1} of ${pool.length} now (the one before ran out of credits)`);
  } else if (pool[at] === key) {
    console.error(`cartesia: all ${pool.length} keys are out of credits`);
  }
  return pool[at] !== key;
}

/** One HTTP call, made again with the next key each time Cartesia says the key is out of credits. */
export async function withCartesiaKey(call: (key: string) => Promise<Response>): Promise<Response> {
  for (;;) {
    const key = cartesiaKey();
    const res = await call(key);
    if (res.status !== 402) return res;
    const body = await res.clone().text().catch(() => "");
    if (!outOfCredits(res.status, body) || !keyExhausted(key)) return res;
  }
}

/** For tests: start again from the first key. */
export function resetCartesiaKeys() {
  at = 0;
}
