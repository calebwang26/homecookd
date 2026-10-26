// "Delete my account" in the app (App Store guideline 5.1.1(v)). deleteMe takes the caller out of Convex
// at once: their person row becomes a blank tombstone (other rows may point at it), every session as them
// ends, sign-in as them is refused (lib/auth.ts findSession, sessions.mirror), and a cook's recipes are gone
// for the whole family, Community included. The rest is purged right after, in batches: their messages and
// voice notes, their questions and answers, what they were cooking, their Community dinners and asks, and a
// cook's jobs, recordings (homie's prompts, the glasses' live log and frames) and the family's Moss index.
// The accountDeletions row lists what Convex can't delete itself: their Supabase rows (the app calls
// POST /profiles/:id/remove next) and their media in GCS.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { PUBLIC_COVER } from "./community";
import { requireSession } from "./lib/auth";
import { requestMossSync } from "./worker";

/** Rows deleted (or changed) per purge run; the next run carries on where this one stopped. */
export const PURGE_BATCH = 500;

export const deleteMe = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const { person, family } = await requireSession(ctx, sessionToken);
    const now = Date.now();
    const mine = (row: { cookId: Id<"people"> }) => row.cookId === person._id;
    const recipes = await pick(ctx.db.query("recipes").withIndex("by_familyId", (q) => q.eq("familyId", family._id)), mine);
    const jobs = await pick(ctx.db.query("jobs").withIndex("by_familyId", (q) => q.eq("familyId", family._id)), mine);
    const recordings = ctx.db.query("recordings").withIndex("by_cookId_and_startedAt", (q) => q.eq("cookId", person._id));
    const videos = (await pick(recordings, (r) => !!r.videoUrl)).map((r) => r.videoUrl);
    // Only recipes the pipeline made from her uploads: a seeded demo recipe's files are the public library's.
    const uploaded = new Set(jobs.map((j) => j.recipeId));
    const files = recipes.filter((r) => uploaded.has(r._id)).flatMap((r) => [r.recipeJsonUrl, r.coverUrl]);
    const mediaUrls = [...files, ...videos].filter((u): u is string => !!u && !PUBLIC_COVER.test(u));

    const deletionId = await ctx.db.insert("accountDeletions", {
      familyId: family._id,
      personId: person._id,
      supabaseProfileId: person.supabaseProfileId,
      requestedAt: now,
      recipeIds: recipes.map((r) => r._id),
      jobIds: jobs.map((j) => j._id),
      uploadPaths: [...new Set(jobs.map((j) => j.uploadPath))],
      mediaUrls: [...new Set(mediaUrls)],
    });
    // Only what other rows and sessions.mirror need: no name, voice, language, place or campus.
    await ctx.db.replace("people", person._id, {
      familyId: person.familyId,
      supabaseProfileId: person.supabaseProfileId,
      name: "Deleted",
      role: person.role,
      deletedAt: now,
    });
    for (const r of recipes) await ctx.db.delete("recipes", r._id);
    // Off the map now; the purge deletes them.
    const hosting = await ctx.db.query("dinners").withIndex("by_hostId", (q) => q.eq("hostId", person._id)).take(200);
    for (const dinner of hosting) await ctx.db.patch("dinners", dinner._id, { status: "cancelled" });
    const sessions = await ctx.db.query("sessions").withIndex("by_personId", (q) => q.eq("personId", person._id)).take(1000);
    for (const s of sessions) await ctx.db.delete("sessions", s._id);
    await ctx.scheduler.runAfter(0, internal.account.purge, { deletionId, step: 0 });
    return null;
  },
});

export const purge = internalMutation({
  args: { deletionId: v.id("accountDeletions"), step: v.number() },
  returns: v.null(),
  handler: async (ctx, { deletionId, step }) => {
    const d = await ctx.db.get("accountDeletions", deletionId);
    if (!d || d.purgedAt !== undefined) return null;
    let left = PURGE_BATCH;
    for (let i = step; i < STEPS.length; i++) {
      left -= await STEPS[i](ctx, d, left);
      if (left <= 0) {
        await ctx.scheduler.runAfter(0, internal.account.purge, { deletionId, step: i });
        return null;
      }
    }
    await ctx.db.patch("accountDeletions", deletionId, { purgedAt: Date.now() });
    // The sync drops every doc of a recipe that's gone (moss.ts).
    if (d.recipeIds.length) await requestMossSync(ctx, d.familyId);
    return null;
  },
});

type Deletion = Doc<"accountDeletions">;
/** Deletes (or changes) at most `max` rows and says how many; fewer than `max` means this step is done. */
type Step = (ctx: MutationCtx, d: Deletion, max: number) => Promise<number>;

/** The rows `keep` picks, at most `max`. */
async function pick<T>(rows: AsyncIterable<T>, keep: (row: T) => boolean, max = Infinity): Promise<T[]> {
  const out: T[] = [];
  if (max <= 0) return out;
  for await (const row of rows) {
    if (!keep(row)) continue;
    out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

async function dropFile(ctx: MutationCtx, id: Id<"_storage"> | undefined) {
  if (id && (await ctx.db.system.get("_storage", id))) await ctx.storage.delete(id);
}

const messages: Step = async (ctx, d, max) => {
  const family = ctx.db.query("messages").withIndex("by_familyId", (q) => q.eq("familyId", d.familyId));
  const sent = await pick(family, (m) => m.from === d.personId, max);
  for (const m of sent) {
    await dropFile(ctx, m.fileId);
    await ctx.db.delete("messages", m._id);
  }
  return sent.length;
};

/** The questions they asked and the ones about their recipes go; their answer to anyone else's comes off it. */
const questions: Step = async (ctx, d, max) => {
  const recipes = new Set<string>(d.recipeIds);
  const gone = (q: Doc<"questions">) =>
    q.askedBy === d.personId || recipes.has(q.recipeId) || (q.shareRecipeId !== undefined && recipes.has(q.shareRecipeId));
  const family = ctx.db.query("questions").withIndex("by_familyId_and_status", (q) => q.eq("familyId", d.familyId));
  const rows = await pick(family, (q) => gone(q) || q.answer?.by === d.personId, max);
  for (const q of rows) {
    await dropFile(ctx, q.answer?.audioId);
    if (gone(q)) await ctx.db.delete("questions", q._id);
    else await ctx.db.patch("questions", q._id, { status: "asked_cook", answer: undefined });
  }
  return rows.length;
};

const cooking: Step = async (ctx, d, max) => {
  const recipes = new Set<string>(d.recipeIds);
  const family = ctx.db.query("cookingSessions").withIndex("by_familyId", (q) => q.eq("familyId", d.familyId));
  const rows = await pick(family, (s) => s.kidId === d.personId || recipes.has(s.recipeId), max);
  for (const s of rows) await ctx.db.delete("cookingSessions", s._id);
  return rows.length;
};

/** A cook's recordings, each after everything saved with it. */
const recordings: Step = async (ctx, d, max) => {
  let n = 0;
  while (n < max) {
    const rec = await ctx.db.query("recordings").withIndex("by_cookId_and_startedAt", (q) => q.eq("cookId", d.personId)).first();
    if (!rec) break;
    for (const table of ["homiePrompts", "liveEvents", "liveWindows", "liveFrames"] as const) {
      const rows = await ctx.db.query(table).withIndex("by_recordingId", (q) => q.eq("recordingId", rec._id)).take(max - n);
      for (const row of rows) {
        if ("storageId" in row) await dropFile(ctx, row.storageId);
        await ctx.db.delete(table, row._id);
      }
      n += rows.length;
      if (n >= max) return n;
    }
    await dropFile(ctx, rec.coverStorageId);
    await ctx.db.delete("recordings", rec._id);
    n++;
  }
  return n;
};

const jobs: Step = async (ctx, d, max) => {
  const family = ctx.db.query("jobs").withIndex("by_familyId", (q) => q.eq("familyId", d.familyId));
  const rows = await pick(family, (j) => j.cookId === d.personId, max);
  for (const j of rows) await ctx.db.delete("jobs", j._id);
  return rows.length;
};

/** Dinners they host, each after its guests' asks and its invite link's opens. */
const hostedDinners: Step = async (ctx, d, max) => {
  let n = 0;
  while (n < max) {
    const dinner = await ctx.db.query("dinners").withIndex("by_hostId", (q) => q.eq("hostId", d.personId)).first();
    if (!dinner) break;
    const asks = await ctx.db.query("dinnerRequests").withIndex("by_dinnerId", (q) => q.eq("dinnerId", dinner._id)).take(max - n);
    for (const r of asks) await ctx.db.delete("dinnerRequests", r._id);
    n += asks.length;
    if (n >= max) return n;
    const opens = await ctx.db
      .query("dinnerInviteOpens")
      .withIndex("by_dinnerId_and_deviceId", (q) => q.eq("dinnerId", dinner._id))
      .take(max - n);
    for (const o of opens) await ctx.db.delete("dinnerInviteOpens", o._id);
    n += opens.length;
    if (n >= max) return n;
    await ctx.db.delete("dinners", dinner._id);
    n++;
  }
  return n;
};

const dinnerAsks: Step = async (ctx, d, max) => {
  const rows = await ctx.db.query("dinnerRequests").withIndex("by_guestId", (q) => q.eq("guestId", d.personId)).take(max);
  for (const r of rows) await ctx.db.delete("dinnerRequests", r._id);
  return rows.length;
};

/** Swaps and "cook together" asks they made, and any with one of their recipes in it. */
const swaps: Step = async (ctx, d, max) => {
  const recipes = new Set<string>(d.recipeIds);
  const involved = (s: Doc<"swapRequests">) =>
    s.requesterId === d.personId || recipes.has(s.theirRecipeId) || (s.myRecipeId !== undefined && recipes.has(s.myRecipeId));
  const asked = ctx.db.query("swapRequests").withIndex("by_requesterFamilyId", (q) => q.eq("requesterFamilyId", d.familyId));
  const askedOfUs = ctx.db.query("swapRequests").withIndex("by_otherFamilyId", (q) => q.eq("otherFamilyId", d.familyId));
  const rows = await pick(asked, involved, max);
  rows.push(...(await pick(askedOfUs, involved, max - rows.length)));
  for (const s of rows) await ctx.db.delete("swapRequests", s._id);
  return rows.length;
};

/** deleteMe took her recipes already; this catches one the worker published a moment later. */
const recipes: Step = async (ctx, d, max) => {
  const family = ctx.db.query("recipes").withIndex("by_familyId", (q) => q.eq("familyId", d.familyId));
  const rows = await pick(family, (r) => r.cookId === d.personId, max);
  for (const r of rows) await ctx.db.delete("recipes", r._id);
  return rows.length;
};

const STEPS: Step[] = [messages, questions, cooking, recordings, jobs, hostedDinners, dinnerAsks, swaps, recipes];
