// The one way a push goes out. queuePush decides inside the caller's transaction and writes the log row and an outbox row together; push.deliver then
// calls Expo with no connection held, and a receipts check 15 minutes later deletes the tokens Expo says are gone. Every step tolerates a repeat.
//
// Supabase's kinds (chat, postcards, nudges, recaps) and Convex's (answered, craving, joined, filmed) keep their own rules (SCHEMA.md). They differ on purpose:
//   - Supabase's: a person-caused push is never capped; one homecookd sends on its own is capped and skipped in quiet hours; no phone means no log row.
//   - Convex's: a 20-a-day flood guard, at most 3 cravings a day, a craving waits out quiet hours rather than being skipped; no phone logs `none`.
import type { Queryable } from "../../db.js";
import { db, tx } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { memberById, signedOutDevices } from "../people/family.js";
import { type ExpoMessage, pushSender } from "./expo.js";
import * as data from "./pushData.js";
import { capCheck, quietDelayMs, type CapReason } from "./pushRules.js";
import { DEFAULT_TZ, zoneOf } from "./time.js";

const CONVEX_KINDS = ["answered", "craving", "joined", "filmed"];
/** Pushes to one person in 24 hours among Convex's kinds. */
export const DAILY_MAX = 20;
/** Cravings come from an anonymous web page, so one parent gets at most this many a day. More still list in-app. */
export const CRAVINGS_PER_DAY = 3;
export const RECEIPTS_AFTER_MS = 15 * 60_000;
export const KEEP_LOG_DAYS = 40;

export type PushInput = {
  personId: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  /** Homecookd sent it on its own: capped, and skipped in quiet hours. */
  appInitiated?: boolean;
  dedupeKey?: string | null;
  quoteKey?: string | null;
};

export type PushResult = "queued" | "dup" | "none" | "capped" | "gone" | CapReason;

/** This person's tokens, minus (and deleting) any on a phone that was signed out. */
async function liveTokens(q: Queryable, personId: string): Promise<data.TokenRow[]> {
  const rows = await data.tokensOf(q, personId);
  const signedOut = await signedOutDevices(q, [...new Set(rows.flatMap((r) => (r.device_id ? [r.device_id] : [])))]);
  const stale = rows.filter((r) => r.device_id && signedOut.has(r.device_id)).map((r) => r.token);
  await data.dropTokens(q, stale);
  return rows.filter((r) => !stale.includes(r.token));
}

/** Does this person have a phone a push could reach? For the jobs that would otherwise build a month for nobody. */
export const hasLivePhone = async (q: Queryable, personId: string) => (await liveTokens(q, personId)).length > 0;

/**
 * Decides on one push. Call it inside a transaction. Removed, memorial and deleted people get nothing. A person's pushes are decided one at a time, so two
 * at once can't both fit under a cap.
 */
export async function queuePush(c: Queryable, p: PushInput, now = new Date()): Promise<PushResult> {
  await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`push:${p.personId}`]);
  const person = await memberById(c, p.personId);
  if (!person || person.deleted_at || person.removed_at || person.memorial) return "gone";
  const dedupeKey = p.dedupeKey ?? null;
  const convex = CONVEX_KINDS.includes(p.kind);

  if (convex && dedupeKey && (await data.hasKey(c, p.personId, dedupeKey))) return "dup";
  const tokens = await liveTokens(c, p.personId);
  const base = {
    personId: p.personId,
    kind: p.kind,
    appInitiated: p.appInitiated ?? false,
    dedupeKey,
    quoteKey: p.quoteKey ?? null,
    title: p.title,
    body: p.body,
    url: p.url,
    createdAt: now,
  };
  const queue = async (delayMs: number): Promise<PushResult> => {
    const sendAt = new Date(now.getTime() + delayMs);
    const id = await data.insertLog(c, { ...base, status: "queued", skippedReason: null, sendAt });
    if (!id) return "dup";
    await enqueue(c, { queue: "scheduled", payload: { task: "push.deliver", logId: id }, sendAfter: delayMs > 0 ? sendAt : undefined });
    return "queued";
  };

  if (convex) {
    if (tokens.length === 0) {
      return (await data.insertLog(c, { ...base, status: "none", skippedReason: null, title: null, body: null, sendAt: now })) ? "none" : "dup";
    }
    const recent = await data.recentConvexKinds(c, p.personId, CONVEX_KINDS, now, DAILY_MAX * 2);
    if (recent.length >= DAILY_MAX || (p.kind === "craving" && recent.filter((r) => r.kind === "craving").length >= CRAVINGS_PER_DAY)) {
      return (await data.insertLog(c, { ...base, status: "capped", skippedReason: null, title: null, body: null, sendAt: now })) ? "capped" : "dup";
    }
    const delay = p.kind === "craving" ? quietDelayMs(now.getTime(), tokens[0].tz ?? person.tz ?? DEFAULT_TZ) : 0;
    return await queue(delay);
  }

  if (tokens.length === 0) return "none";
  if (dedupeKey && (await data.hasKey(c, p.personId, dedupeKey))) return "dup";
  if (p.appInitiated) {
    const verdict = capCheck({
      role: person.role === "cook" ? "cook" : "learner",
      appInitiated: true,
      now,
      tz: zoneOf(person.tz ?? tokens[0].tz),
      recent: await data.recentAppInitiated(c, p.personId, now),
    });
    if (!verdict.ok) {
      const id = await data.insertLog(c, { ...base, status: "skipped", skippedReason: verdict.reason, title: null, body: null, sendAt: now });
      return id ? verdict.reason : "dup";
    }
  }
  return await queue(0);
}

/** push.deliver: what's still due goes to Expo, with no database connection held while it waits. */
export async function deliver(logId: string): Promise<void> {
  const log = await data.claimDelivery(db(), logId);
  if (!log) return;
  const person = await memberById(db(), log.person_id);
  if (!person || person.deleted_at || person.removed_at || person.memorial) {
    await data.finishDelivery(db(), logId, "none", [], null);
    return;
  }
  const tokens = await liveTokens(db(), log.person_id);
  if (tokens.length === 0) {
    await data.finishDelivery(db(), logId, "none", [], null);
    return;
  }
  const messages: ExpoMessage[] = tokens.slice(0, data.MAX_TOKENS).map((t) => ({
    to: t.token,
    title: log.title ?? "",
    body: log.body ?? "",
    sound: "default",
    priority: "high",
    channelId: "default",
    // profile_id: on a shared phone the tap must not open someone else's chat. The Supabase id while old builds are out there.
    data: { url: log.url ?? "/", kind: log.kind, profile_id: person.supabase_id ?? person.id },
  }));
  const { tickets, dead } = await pushSender().send(messages);
  const ok = tickets.flatMap((t, i) => (t.status === "ok" ? [{ id: t.id, token: messages[i].to }] : []));
  const failed = tickets.find((t) => t.status === "error");
  await tx(async (c) => {
    await data.finishDelivery(c, logId, ok.length ? "sent" : "failed", ok, failed && failed.status === "error" ? failed.message.slice(0, 200) : null);
    await data.dropTokens(c, dead.slice(0, 200));
    if (ok.length) await enqueue(c, { queue: "scheduled", payload: { task: "push.receipts", logId }, sendAfter: new Date(Date.now() + RECEIPTS_AFTER_MS) });
  });
}

/** push.receipts: Expo reports most dead tokens here, not in tickets. A repeat finds no tickets left. */
export async function receipts(logId: string): Promise<void> {
  const tickets = await data.ticketsOf(db(), logId);
  if (tickets.length === 0) return;
  const deadIds = new Set(await pushSender().deadReceipts(tickets.map((t) => t.id)));
  await tx(async (c) => {
    await data.dropTokens(c, tickets.filter((t) => deadIds.has(t.id)).map((t) => t.token));
    await data.clearTickets(c, logId);
  });
}
