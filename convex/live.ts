// homie's live session while a cook records (STACK.md, "Oct 24 additions"). The app starts one and
// watches it; the voice service reads and moves it through lib/liveRoutes.ts with the cook's own
// session token, so every write is checked against her family.
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { findSession, requireCook, requireSession, type Signed } from "./lib/auth";
import schema from "./schema";

const IDLE_MS = 2 * 3600 * 1000;
const LIVE = ["intro", "recording", "wrapping_up"] as const;

const promptKind = schema.tables.homiePrompts.validator.fields.kind;
const promptStatus = schema.tables.homiePrompts.validator.fields.status;
const answer = schema.tables.homiePrompts.validator.fields.answer;
const failure = v.object({ error: v.union(v.literal("signed_out"), v.literal("not_found"), v.literal("ended")) });

export const startRecording = mutation({
  args: {
    sessionToken: v.string(),
    dish: v.optional(v.string()),
    forKidId: v.optional(v.id("people")),
    language: v.optional(v.string()),
    source: v.union(v.literal("phone"), v.literal("glasses")),
  },
  returns: v.object({ recordingId: v.id("recordings") }),
  handler: async (ctx, { sessionToken, dish, forKidId, language, source }) => {
    const signed = await requireSession(ctx, sessionToken);
    requireCook(signed);
    if (forKidId) {
      const kid = await ctx.db.get("people", forKidId);
      if (!kid || kid.familyId !== signed.family._id || kid.role !== "kid") throw new ConvexError("That kid isn't in this family.");
    }
    const name = dish?.trim().slice(0, 120);
    const lang = (language || signed.person.language || "en").trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(lang)) throw new ConvexError("language must be a code like mr or en.");
    const recordingId = await ctx.db.insert("recordings", {
      familyId: signed.family._id,
      cookId: signed.person._id,
      forKidId,
      dish: name || undefined,
      language: lang,
      source,
      status: "intro",
      updatedAt: Date.now(),
    });
    return { recordingId };
  },
});

/**
 * The stop button when the app can't reach the voice service: ends the cook's own recording here, so the
 * glasses VM finalizes the video without homie. Only `recording` or `wrapping_up` moves to `ended`; calling it
 * again is fine. `ok` is false when there's nothing to end (still at the hello, or abandoned).
 */
export const endRecording = mutation({
  args: { sessionToken: v.string(), recordingId: v.id("recordings") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { sessionToken, recordingId }) => {
    const signed = await requireSession(ctx, sessionToken);
    requireCook(signed);
    const row = await ctx.db.get("recordings", recordingId);
    if (!row || row.cookId !== signed.person._id) throw new ConvexError("That recording isn't yours.");
    if (row.status === "ended") return { ok: true };
    if (row.status !== "recording" && row.status !== "wrapping_up") return { ok: false };
    const now = Date.now();
    await ctx.db.patch("recordings", row._id, { status: "ended", endedAt: now, updatedAt: now });
    return { ok: true };
  },
});

/** The recording screen's live view of one recording (own family only). */
export const recording = query({
  args: { sessionToken: v.string(), recordingId: v.id("recordings") },
  returns: v.union(v.null(), schema.doc("recordings")),
  handler: async (ctx, { sessionToken, recordingId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const row = await ctx.db.get("recordings", recordingId);
    return row && row.familyId === signed.family._id ? row : null;
  },
});

// ---- for the voice service (lib/liveRoutes.ts) ----

/** The signed-in person, for /live/person and /speak. */
export const person = internalQuery({
  args: { sessionToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      personId: v.id("people"),
      familyId: v.id("families"),
      name: v.string(),
      role: v.union(v.literal("cook"), v.literal("kid")),
      language: v.string(),
      relation: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { sessionToken }) => {
    const signed = await findSession(ctx, sessionToken);
    if (!signed) return null;
    const p = signed.person;
    return { personId: p._id, familyId: p.familyId, name: p.name, role: p.role, language: p.language ?? "en", relation: p.relation };
  },
});

/** The cook's own recording, or why not. */
async function own(ctx: QueryCtx, sessionToken: string, recordingId: string): Promise<{ signed: Signed; row: Doc<"recordings"> } | { error: "signed_out" | "not_found" }> {
  const signed = await findSession(ctx, sessionToken);
  // Mutations may read the clock; queries rely on the purge.
  if (!signed || ("scheduler" in ctx && signed.session.expiresAt < Date.now())) return { error: "signed_out" };
  const id = ctx.db.normalizeId("recordings", recordingId);
  const row = id && (await ctx.db.get("recordings", id));
  if (!row || row.cookId !== signed.person._id) return { error: "not_found" };
  return { signed, row };
}

export const sessionView = internalQuery({
  args: { sessionToken: v.string(), recordingId: v.string() },
  returns: v.union(
    failure,
    v.object({
      recording: schema.doc("recordings"),
      cook: v.object({ name: v.string(), relation: v.optional(v.string()), language: v.string() }),
      kid: v.optional(v.object({ name: v.string() })),
      dish: v.optional(v.string()),
      /** homie has recorded with her before (another of her recordings started filming): no second introduction. */
      metBefore: v.boolean(),
    }),
  ),
  handler: async (ctx, { sessionToken, recordingId }) => {
    const found = await own(ctx, sessionToken, recordingId);
    if ("error" in found) return found;
    const { signed, row } = found;
    const kid = row.forKidId ? await ctx.db.get("people", row.forKidId) : null;
    const started = await ctx.db
      .query("recordings")
      .withIndex("by_cookId_and_startedAt", (q) => q.eq("cookId", row.cookId).gt("startedAt", 0))
      .take(2);
    return {
      recording: row,
      cook: { name: signed.person.name, relation: signed.person.relation, language: signed.person.language ?? "en" },
      kid: kid ? { name: kid.name } : undefined,
      dish: row.dish,
      metBefore: started.some((r) => r._id !== row._id),
    };
  },
});

export const setStatus = internalMutation({
  args: { sessionToken: v.string(), recordingId: v.string(), status: v.union(v.literal("recording"), v.literal("wrapping_up"), v.literal("ended")) },
  returns: v.union(failure, v.object({ ok: v.literal(true), startedAt: v.optional(v.number()) })),
  handler: async (ctx, args) => {
    const found = await own(ctx, args.sessionToken, args.recordingId);
    if ("error" in found) return found;
    const { row } = found;
    if (row.status === "ended" || row.status === "abandoned") return { error: "ended" as const };
    const now = Date.now();
    const startedAt = row.startedAt ?? (args.status === "recording" ? now : undefined);
    await ctx.db.patch("recordings", row._id, {
      status: args.status,
      startedAt,
      ...(args.status === "ended" ? { endedAt: now } : {}),
      updatedAt: now,
    });
    return { ok: true as const, startedAt };
  },
});

/** The voice service's heartbeat while her socket is open, so a long cook isn't taken for idle. */
export const touch = internalMutation({
  args: { sessionToken: v.string(), recordingId: v.string() },
  returns: v.union(failure, v.object({ ok: v.literal(true) })),
  handler: async (ctx, { sessionToken, recordingId }) => {
    const found = await own(ctx, sessionToken, recordingId);
    if ("error" in found) return found;
    if (found.row.status === "ended" || found.row.status === "abandoned") return { error: "ended" as const };
    await ctx.db.patch("recordings", found.row._id, { updatedAt: Date.now() });
    return { ok: true as const };
  },
});

export const addPrompt = internalMutation({
  args: {
    sessionToken: v.string(),
    recordingId: v.string(),
    kind: promptKind,
    text: v.string(),
    textEn: v.string(),
    atS: v.number(),
    status: promptStatus,
  },
  returns: v.union(failure, v.object({ promptId: v.id("homiePrompts") })),
  handler: async (ctx, { sessionToken, recordingId, ...prompt }) => {
    const found = await own(ctx, sessionToken, recordingId);
    if ("error" in found) return found;
    // Nothing is said after the end. Only the goodbye may land then: it races the "ended" status write.
    const { status } = found.row;
    if (status === "abandoned" || (status === "ended" && prompt.kind !== "closing")) return { error: "ended" as const };
    const promptId = await ctx.db.insert("homiePrompts", { ...prompt, recordingId: found.row._id, familyId: found.row.familyId });
    await ctx.db.patch("recordings", found.row._id, { updatedAt: Date.now() });
    return { promptId };
  },
});

export const updatePrompt = internalMutation({
  args: { sessionToken: v.string(), promptId: v.string(), status: promptStatus, answer },
  returns: v.union(failure, v.object({ ok: v.literal(true) })),
  handler: async (ctx, { sessionToken, promptId, status, answer }) => {
    const id = ctx.db.normalizeId("homiePrompts", promptId);
    const prompt = id && (await ctx.db.get("homiePrompts", id));
    if (!prompt) return { error: "not_found" as const };
    const found = await own(ctx, sessionToken, prompt.recordingId);
    if ("error" in found) return found;
    await ctx.db.patch("homiePrompts", prompt._id, { status, ...(answer ? { answer } : {}) });
    await ctx.db.patch("recordings", found.row._id, { updatedAt: Date.now() });
    return { ok: true as const };
  },
});

export const setOptIn = internalMutation({
  args: { sessionToken: v.string(), recordingId: v.string(), optIn: v.boolean() },
  returns: v.union(failure, v.object({ ok: v.literal(true) })),
  handler: async (ctx, { sessionToken, recordingId, optIn }) => {
    const found = await own(ctx, sessionToken, recordingId);
    if ("error" in found) return found;
    await ctx.db.patch("recordings", found.row._id, { memoriesOptIn: optIn, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/**
 * A recording nobody touched for 2 hours was left behind (the app closed mid-intro, say). While her socket
 * is open the voice service touches it every 10 minutes, so a long cook stays live.
 */
export const abandonIdle = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - IDLE_MS;
    for (const s of LIVE) {
      const rows = await ctx.db
        .query("recordings")
        .withIndex("by_status", (q) => q.eq("status", s))
        .take(200);
      for (const r of rows) {
        if (r.updatedAt < cutoff) await ctx.db.patch("recordings", r._id, { status: "abandoned", updatedAt: Date.now() });
      }
    }
    return null;
  },
});
