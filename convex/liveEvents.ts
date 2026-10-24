// The glasses' live analysis (glasses/BRIDGE.md): the laptop bridge posts each analysed window through
// /glasses/live-events (lib/glassesRoutes.ts); the app shows the log while the cook cooks, and the worker
// gets it with the job as hints for the final recipe (worker.ts claim).
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { requireSession } from "./lib/auth";
import schema from "./schema";

const MAX_EVENTS = 100; // per 30 s window; a real one has a handful

const fields = schema.tables.liveEvents.validator.fields;
export const liveEvent = v.object({
  kind: fields.kind,
  atS: v.number(),
  endS: v.optional(v.number()),
  title: v.string(),
  text: v.string(),
  saidAs: v.optional(v.string()),
  quoteOriginal: v.optional(v.string()),
  confidence: v.number(),
});

/** One analysed window and its events. A window that failed comes with ok: false and only button taps. */
export const ingest = internalMutation({
  args: {
    recordingId: v.string(),
    sessionId: v.string(),
    sessionStartedAt: v.number(),
    windowStartS: v.number(),
    windowEndS: v.number(),
    ok: v.boolean(),
    reason: v.optional(v.string()),
    events: v.array(liveEvent),
  },
  returns: v.union(
    v.object({ events: v.number() }),
    v.object({ error: v.string(), status: v.union(v.literal(400), v.literal(404)) }),
  ),
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("recordings", a.recordingId);
    const rec = id && (await ctx.db.get(id));
    if (!rec || rec.source !== "glasses") return { error: "no such glasses recording", status: 404 as const };
    if (rec.status === "abandoned") return { error: "the recording was abandoned", status: 400 as const };
    if (a.events.length > MAX_EVENTS) return { error: `at most ${MAX_EVENTS} events per window`, status: 400 as const };
    const base = { recordingId: rec._id, familyId: rec.familyId, sessionId: a.sessionId, sessionStartedAt: a.sessionStartedAt };
    await ctx.db.insert("liveWindows", {
      ...base,
      startS: a.windowStartS,
      endS: a.windowEndS,
      ok: a.ok,
      reason: a.reason?.slice(0, 300),
    });
    for (const e of a.events) await ctx.db.insert("liveEvents", { ...base, ...e });
    await ctx.db.patch(rec._id, { updatedAt: Date.now() }); // live footage keeps it from going idle
    return { events: a.events.length };
  },
});

/**
 * The laptop bridge's newest glasses frame (already in storage), several a second. Keeps one per recording: the
 * previous file is deleted, and a frame older than the kept one (`t`, same glasses session) is dropped. A frame for a recording that isn't a live glasses one is refused and its file deleted.
 */
export const setFrame = internalMutation({
  args: {
    recordingId: v.string(),
    storageId: v.id("_storage"),
    at: v.number(),
    sessionId: v.optional(v.string()),
    t: v.optional(v.number()),
  },
  returns: v.union(v.object({ ok: v.boolean() }), v.object({ error: v.string(), status: v.union(v.literal(400), v.literal(404)) })),
  handler: async (ctx, { recordingId, storageId, at, sessionId, t }) => {
    const id = ctx.db.normalizeId("recordings", recordingId);
    const rec = id && (await ctx.db.get(id));
    if (!rec || rec.source !== "glasses") {
      await ctx.storage.delete(storageId);
      return { error: "no such glasses recording", status: 404 as const };
    }
    if (rec.status === "ended" || rec.status === "abandoned") {
      await ctx.storage.delete(storageId);
      return { error: `the recording is ${rec.status}`, status: 400 as const };
    }
    const old = await ctx.db
      .query("liveFrames")
      .withIndex("by_recordingId", (q) => q.eq("recordingId", rec._id))
      .unique();
    // An older frame from the same glasses session that arrived late: keep the newer one.
    if (old && t !== undefined && old.t !== undefined && old.sessionId === sessionId && t <= old.t) {
      await ctx.storage.delete(storageId);
      return { ok: true };
    }
    if (old) {
      await ctx.storage.delete(old.storageId);
      await ctx.db.patch(old._id, { storageId, at, sessionId, t });
    } else {
      await ctx.db.insert("liveFrames", { recordingId: rec._id, storageId, at, sessionId, t });
    }
    return { ok: true };
  },
});

/** What the glasses see right now, for the recording screen (own family only): the newest frame's URL and when it came. */
export const frame = query({
  args: { sessionToken: v.string(), recordingId: v.id("recordings") },
  returns: v.union(v.null(), v.object({ url: v.string(), at: v.number() })),
  handler: async (ctx, { sessionToken, recordingId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const rec = await ctx.db.get(recordingId);
    if (!rec || rec.familyId !== signed.family._id) return null;
    const row = await ctx.db
      .query("liveFrames")
      .withIndex("by_recordingId", (q) => q.eq("recordingId", recordingId))
      .unique();
    const url = row && (await ctx.storage.getUrl(row.storageId));
    return row && url ? { url, at: row.at } : null;
  },
});

/** The live log for the app's recording screen (own family only), oldest first, wall-clock ms in `at`. */
export const forRecording = query({
  args: { sessionToken: v.string(), recordingId: v.id("recordings") },
  returns: v.union(
    v.null(),
    v.object({
      events: v.array(v.object({ at: v.number(), kind: fields.kind, title: v.string(), text: v.string(), saidAs: v.optional(v.string()) })),
      windows: v.object({ analysed: v.number(), missed: v.number() }),
    }),
  ),
  handler: async (ctx, { sessionToken, recordingId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const rec = await ctx.db.get(recordingId);
    if (!rec || rec.familyId !== signed.family._id) return null;
    const events = await ctx.db
      .query("liveEvents")
      .withIndex("by_recordingId", (q) => q.eq("recordingId", recordingId))
      .take(2000);
    const windows = await ctx.db
      .query("liveWindows")
      .withIndex("by_recordingId", (q) => q.eq("recordingId", recordingId))
      .take(2000);
    return {
      events: events
        .map((e) => ({ at: e.sessionStartedAt + e.atS * 1000, kind: e.kind, title: e.title, text: e.text, saidAs: e.saidAs }))
        .sort((a, b) => a.at - b.at),
      windows: { analysed: windows.filter((w) => w.ok).length, missed: windows.filter((w) => !w.ok).length },
    };
  },
});

/**
 * For the worker: the live events and the spans the live pass missed, in seconds of the uploaded video
 * (from videoStartedAt, the first clip's start), oldest first. Events before the video started are left out.
 */
export async function liveLog(ctx: QueryCtx, rec: Doc<"recordings">) {
  if (rec.videoStartedAt === undefined) return { liveLog: [], liveGaps: [] };
  const v0 = rec.videoStartedAt;
  const t = (startedAt: number, s: number) => Math.round(((startedAt - v0) / 1000 + s) * 10) / 10;
  const events = await ctx.db
    .query("liveEvents")
    .withIndex("by_recordingId", (q) => q.eq("recordingId", rec._id))
    .take(2000);
  const windows = await ctx.db
    .query("liveWindows")
    .withIndex("by_recordingId", (q) => q.eq("recordingId", rec._id))
    .take(2000);
  return {
    liveLog: events
      .map((e) => ({
        kind: e.kind,
        atS: t(e.sessionStartedAt, e.atS),
        endS: e.endS === undefined ? undefined : t(e.sessionStartedAt, e.endS),
        title: e.title,
        text: e.text,
        saidAs: e.saidAs,
        quoteOriginal: e.quoteOriginal,
        confidence: e.confidence,
      }))
      .filter((e) => e.atS >= 0)
      .sort((a, b) => a.atS - b.atS),
    liveGaps: windows
      .filter((w) => !w.ok)
      .map((w) => ({ startS: t(w.sessionStartedAt, w.startS), endS: t(w.sessionStartedAt, w.endS) }))
      .filter((g) => g.endS > 0)
      .sort((a, b) => a.startS - b.startS),
  };
}
