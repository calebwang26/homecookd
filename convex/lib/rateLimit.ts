// A fixed-window limiter for the public routes (the dish ask's, docs/build/DISH-ASK-SPEC.md). One rateHits row per
// bucket key and window counts the hits; a key is a bucket name plus an HMAC of the caller's IP, never the IP.
// Old windows are pruned by a cron (crons.ts).
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalMutation } from "../_generated/server";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type Limit = { bucket: string; max: number; windowMs: number };

export const LIMITS = {
  cards: { bucket: "dish-cards", max: 6, windowMs: 10 * MINUTE },
  cardsDay: { bucket: "dish-cards-day", max: 30, windowMs: DAY },
  badTokens: { bucket: "dish-bad", max: 20, windowMs: 10 * MINUTE },
  files: { bucket: "dish-files", max: 30, windowMs: 10 * MINUTE },
  ask: { bucket: "dish-ask", max: 30, windowMs: 10 * MINUTE },
  answer: { bucket: "dish-answer", max: 30, windowMs: 10 * MINUTE },
  /** Translating one card's page into one language (keyed by card and language, not IP): her 2-second polls
   *  never pay for more than 3 tries an hour when Claude fails or a reload lands mid-translation. */
  momLang: { bucket: "dish-mom-lang", max: 3, windowMs: 60 * MINUTE },
} satisfies Record<string, Limit>;

/** A window this old is over for every bucket (the longest is a day). */
const KEEP_MS = 2 * DAY;
const PRUNE_BATCH = 500;

/**
 * One hit on each bucket, all or none: false (and nothing counted) when any of them is full this window.
 * `key` is `<bucket>:<HMAC of the IP>`.
 */
export const hit = internalMutation({
  args: { buckets: v.array(v.object({ key: v.string(), max: v.number(), windowMs: v.number() })) },
  returns: v.boolean(),
  handler: async (ctx, { buckets }) => {
    const now = Date.now();
    const found = [];
    for (const b of buckets) {
      const windowStart = Math.floor(now / b.windowMs) * b.windowMs;
      const row = await ctx.db
        .query("rateHits")
        .withIndex("by_key_window", (q) => q.eq("key", b.key).eq("windowStart", windowStart))
        .unique();
      if (row && row.count >= b.max) return false;
      found.push({ key: b.key, windowStart, row });
    }
    for (const { key, windowStart, row } of found) {
      if (row) await ctx.db.patch("rateHits", row._id, { count: row.count + 1 });
      else await ctx.db.insert("rateHits", { key, windowStart, count: 1 });
    }
    return true;
  },
});

/** The cron: drops windows that ended a while ago, a batch at a time. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query("rateHits")
      .withIndex("by_window", (q) => q.lt("windowStart", Date.now() - KEEP_MS))
      .take(PRUNE_BATCH);
    for (const row of old) await ctx.db.delete("rateHits", row._id);
    if (old.length === PRUNE_BATCH) await ctx.scheduler.runAfter(0, internal.lib.rateLimit.prune, {});
    return null;
  },
});

/** One hit on each limit for this IP key: false when any is full (and then none is counted). */
export async function allowed(ctx: ActionCtx, ipKey: string, limits: Limit[]): Promise<boolean> {
  const buckets = limits.map((l) => ({ key: `${l.bucket}:${ipKey}`, max: l.max, windowMs: l.windowMs }));
  return await ctx.runMutation(internal.lib.rateLimit.hit, { buckets });
}

// ---------------------------------------------------------------------------------------------
// The IP, as an HMAC

const FALLBACK_SALT = "homecookd-dish-ip-v1";
let keyFor: { salt: string; key: Promise<CryptoKey> } | null = null;
let warned = false;

function hmacKey(): Promise<CryptoKey> {
  let salt = process.env.DISH_IP_SALT?.trim();
  if (!salt) {
    if (!warned) console.warn("DISH_IP_SALT isn't set: the rate limits hash IPs with a fixed salt");
    warned = true;
    salt = FALLBACK_SALT;
  }
  if (keyFor?.salt !== salt) {
    const key = crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyFor = { salt, key };
  }
  return keyFor.key;
}

/** The caller's IP: X-Forwarded-For's first entry (spec §5), else "unknown". */
export function clientIp(req: Request): string {
  return (req.headers.get("X-Forwarded-For") ?? "").split(",")[0].trim() || "unknown";
}

/** HMAC-SHA256(DISH_IP_SALT, ip) as hex: what rateHits keys and dishAsks.ipKey hold. */
export async function ipKeyOf(ip: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(ip));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
