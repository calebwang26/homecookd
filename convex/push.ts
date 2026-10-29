// Pushes from Convex (docs/build/V2-LINKING.md §1). The app registers its Expo token here as well as with
// Supabase; a mutation decides on a push with queuePush (dedupe, the daily limits, quiet hours for a craving)
// and schedules deliver, which calls Expo; a receipts check 15 minutes later deletes the tokens Expo says are
// gone. The rules are Supabase's notify() (plumbing.ts), so both systems behave the same. Supabase still sends
// today's pushes (chat, postcards, nudges); only v2's events come from here.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { findSession, requireSession } from "./lib/auth";
import { DEFAULT_TZ, deadReceipts, quietDelayMs, sendExpoPush, validPushToken, validTz, type ExpoMessage } from "./lib/push";
import type { PushKind } from "./lib/pushWords";
import schema from "./schema";

const MAX_TOKENS = 5;
const DAY_MS = 24 * 3600 * 1000;
/** Pushes to one person in 24 hours, all kinds together: a flood guard. */
export const DAILY_MAX = 20;
/** Cravings come from an anonymous web page, so one parent gets at most this many a day (more still list in-app). */
export const CRAVINGS_PER_DAY = 3;
export const RECEIPTS_AFTER_MS = 15 * 60_000;
const KEEP_LOG_MS = 40 * DAY_MS;

export const register = mutation({
  args: {
    sessionToken: v.string(),
    token: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
    tz: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { sessionToken, token, platform, tz }) => {
    const { person } = await requireSession(ctx, sessionToken);
    if (!validPushToken(token)) throw new ConvexError("That isn't a push token.");
    const row = { personId: person._id, familyId: person.familyId, platform, tz: validTz(tz) ?? undefined, updatedAt: Date.now() };
    const found = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (found) await ctx.db.patch("pushTokens", found._id, row);
    else await ctx.db.insert("pushTokens", { token, ...row });
    // At most MAX_TOKENS phones each: the oldest goes.
    const mine = await ctx.db.query("pushTokens").withIndex("by_personId", (q) => q.eq("personId", person._id)).take(50);
    mine.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of mine.slice(MAX_TOKENS)) await ctx.db.delete("pushTokens", old._id);
    return null;
  },
});

/** Sign-out: this phone's token stops getting the family's pushes. Only within the caller's family. */
export const unregister = mutation({
  args: { sessionToken: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken, token }) => {
    const signed = await findSession(ctx, sessionToken);
    if (!signed) return null;
    const found = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (found && found.familyId === signed.family._id) await ctx.db.delete("pushTokens", found._id);
    return null;
  },
});

export type PushInput = { personId: Id<"people">; kind: PushKind; title: string; body: string; url: string; dedupeKey: string };
export type PushResult = "queued" | "dup" | "none" | "capped" | "gone";

/**
 * Decides on one push, in the caller's transaction: nothing for a deleted person or a dedupe key they've had;
 * the daily limits; a craving waits out quiet hours (21:00–08:00 on their clock). The log row is written before
 * sending, as Supabase does, so a failed or capped push still uses its key. Call it from any mutation.
 */
export async function queuePush(ctx: MutationCtx, p: PushInput): Promise<PushResult> {
  const person = await ctx.db.get("people", p.personId);
  if (!person || person.deletedAt !== undefined) return "gone";
  const dup = await ctx.db
    .query("pushLog")
    .withIndex("by_personId_and_dedupeKey", (q) => q.eq("personId", p.personId).eq("dedupeKey", p.dedupeKey))
    .first();
  if (dup) return "dup";

  const now = Date.now();
  const tokens = await ctx.db.query("pushTokens").withIndex("by_personId", (q) => q.eq("personId", p.personId)).take(MAX_TOKENS);
  const recent = await ctx.db
    .query("pushLog")
    .withIndex("by_personId_and_createdAt", (q) => q.eq("personId", p.personId).gt("createdAt", now - DAY_MS))
    .take(DAILY_MAX * 2);
  const counted = recent.filter((r) => r.status !== "capped" && r.status !== "none");
  const capped =
    counted.length >= DAILY_MAX || (p.kind === "craving" && counted.filter((r) => r.kind === "craving").length >= CRAVINGS_PER_DAY);
  const status = !tokens.length ? "none" : capped ? "capped" : "queued";
  const delay = status === "queued" && p.kind === "craving" ? quietDelayMs(now, tokens[0].tz ?? DEFAULT_TZ) : 0;

  const logId = await ctx.db.insert("pushLog", { ...p, status, sendAt: now + delay, createdAt: now });
  if (status === "queued") await ctx.scheduler.runAfter(delay, internal.push.deliver, { logId });
  return status;
}

/** queuePush on its own, for tests and for a test push to a real phone (`npx convex run push:queue '{…}'`). */
export const queue = internalMutation({
  args: {
    personId: v.id("people"),
    kind: schema.tables.pushLog.validator.fields.kind,
    title: v.string(),
    body: v.string(),
    url: v.string(),
    dedupeKey: v.string(),
  },
  returns: v.union(v.literal("queued"), v.literal("dup"), v.literal("none"), v.literal("capped"), v.literal("gone")),
  handler: (ctx, args) => queuePush(ctx, args),
});

/** What deliver sends: null once the push is no longer due (sent, or the person deleted since). */
export const forDelivery = internalQuery({
  args: { logId: v.id("pushLog") },
  returns: v.union(
    v.null(),
    v.object({ log: schema.tables.pushLog.validator, tokens: v.array(v.string()), profileId: v.string() }),
  ),
  handler: async (ctx, { logId }) => {
    const log = await ctx.db.get("pushLog", logId);
    if (!log || log.status !== "queued") return null;
    const person = await ctx.db.get("people", log.personId);
    if (!person || person.deletedAt !== undefined) return null;
    const tokens = await ctx.db.query("pushTokens").withIndex("by_personId", (q) => q.eq("personId", log.personId)).take(MAX_TOKENS);
    const { _id, _creationTime, ...fields } = log;
    return { log: fields, tokens: tokens.map((t) => t.token), profileId: person.supabaseProfileId };
  },
});

export const deliver = internalAction({
  args: { logId: v.id("pushLog") },
  returns: v.null(),
  handler: async (ctx, { logId }) => {
    const job = await ctx.runQuery(internal.push.forDelivery, { logId });
    if (!job) return null;
    if (!job.tokens.length) {
      await ctx.runMutation(internal.push.finish, { logId, status: "none", tickets: [], dead: [] });
      return null;
    }
    const { log } = job;
    const messages: ExpoMessage[] = job.tokens.map((to) => ({
      to,
      title: log.title,
      body: log.body,
      sound: "default",
      priority: "high",
      channelId: "default",
      // profile_id is the Supabase one, so the app's PushBridge picks the right person on a shared phone.
      data: { url: log.url, kind: log.kind, profile_id: job.profileId },
    }));
    const { tickets, dead } = await sendExpoPush(messages, { accessToken: process.env.EXPO_ACCESS_TOKEN?.trim() || undefined });
    const ok = tickets.flatMap((t, i) => (t.status === "ok" ? [{ id: t.id, token: messages[i].to }] : []));
    const error = tickets.find((t) => t.status === "error");
    await ctx.runMutation(internal.push.finish, {
      logId,
      status: ok.length ? "sent" : "failed",
      tickets: ok,
      dead,
      ...(error && error.status === "error" ? { error: error.message.slice(0, 200) } : {}),
    });
    return null;
  },
});

export const finish = internalMutation({
  args: {
    logId: v.id("pushLog"),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("none")),
    tickets: v.array(v.object({ id: v.string(), token: v.string() })),
    dead: v.array(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { logId, status, tickets, dead, error }) => {
    if (await ctx.db.get("pushLog", logId)) {
      await ctx.db.patch("pushLog", logId, { status, ...(tickets.length ? { tickets } : {}), ...(error ? { error } : {}) });
      if (tickets.length) await ctx.scheduler.runAfter(RECEIPTS_AFTER_MS, internal.push.receipts, { logId });
    }
    await dropTokens(ctx, dead);
    return null;
  },
});

/** Expo reports most dead tokens in receipts, not tickets (Supabase's notify() leaves this as a TODO). */
export const receipts = internalAction({
  args: { logId: v.id("pushLog") },
  returns: v.null(),
  handler: async (ctx, { logId }) => {
    const tickets = await ctx.runQuery(internal.push.ticketsOf, { logId });
    const deadIds = new Set(await deadReceipts(tickets.map((t) => t.id), { accessToken: process.env.EXPO_ACCESS_TOKEN?.trim() || undefined }));
    const dead = tickets.filter((t) => deadIds.has(t.id)).map((t) => t.token);
    if (dead.length) await ctx.runMutation(internal.push.forget, { tokens: dead });
    return null;
  },
});

export const ticketsOf = internalQuery({
  args: { logId: v.id("pushLog") },
  returns: v.array(v.object({ id: v.string(), token: v.string() })),
  handler: async (ctx, { logId }) => (await ctx.db.get("pushLog", logId))?.tickets ?? [],
});

export const forget = internalMutation({
  args: { tokens: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { tokens }) => {
    await dropTokens(ctx, tokens);
    return null;
  },
});

async function dropTokens(ctx: MutationCtx, tokens: string[]) {
  for (const token of tokens.slice(0, 200)) {
    const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (row) await ctx.db.delete("pushTokens", row._id);
  }
}

/** account.deleteMe: nothing reaches a deleted account, even before the purge runs. */
export async function dropTokensOf(ctx: MutationCtx, personId: Id<"people">) {
  const rows = await ctx.db.query("pushTokens").withIndex("by_personId", (q) => q.eq("personId", personId)).take(50);
  for (const r of rows) await ctx.db.delete("pushTokens", r._id);
}

/** The account purge's step: their push log. Deletes at most `max` rows and says how many. */
export async function dropLogOf(ctx: MutationCtx, personId: Id<"people">, max: number): Promise<number> {
  const rows: Doc<"pushLog">[] = await ctx.db
    .query("pushLog")
    .withIndex("by_personId_and_createdAt", (q) => q.eq("personId", personId))
    .take(max);
  for (const r of rows) await ctx.db.delete("pushLog", r._id);
  return rows.length;
}

/** The daily cron: the log is only for dedupe, the limits and debugging, so 40 days is plenty. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query("pushLog")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", Date.now() - KEEP_LOG_MS))
      .take(500);
    for (const r of old) await ctx.db.delete("pushLog", r._id);
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.push.prune, {});
    return null;
  },
});
