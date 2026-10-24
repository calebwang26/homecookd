// What's new for this person, for a tap on homie (Caleb, Oct 24: a tap always gets a spoken answer, and when
// there's something real to say, homie says it). A few plain facts, newest first, each with a stable id and a
// line homie can say as it is; the app keeps this query live, so a tap answers at once, and the voice service
// (POST /homie/line) has Claude say the same fact warmly. `now` comes from the caller (queries don't read the
// clock), rounded to the minute so the subscription stays put.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { findSession, requireSession, type Signed } from "./lib/auth";

const DAY = 24 * 3600 * 1000;
const ANSWER_DAYS = 14;
const NEW_RECIPE_DAYS = 3;
/** A cooking session nobody touched for this long isn't "right now" any more. */
const COOKING_NOW_MS = 30 * 60 * 1000;
const QUIET_DAYS = 7;
const MAX_FACTS = 3;

const fact = v.object({
  id: v.string(),
  kind: v.union(v.literal("answer"), v.literal("asked"), v.literal("cooking"), v.literal("recipe"), v.literal("quiet")),
  line: v.string(),
  at: v.number(),
});
export type Fact = { id: string; kind: "answer" | "asked" | "cooking" | "recipe" | "quiet"; line: string; at: number };

/** What the family calls a cook ("Grandma"), else her name. */
const call = (p: Doc<"people"> | null) => (p ? p.relation || p.name : "Your family");

export async function newsFor(ctx: QueryCtx, signed: Signed, now: number): Promise<Fact[]> {
  const me = signed.person;
  const familyId = signed.family._id;
  const people = new Map<string, Doc<"people">>();
  const personOf = async (id: Doc<"people">["_id"]) => {
    if (!people.has(id)) {
      const p = await ctx.db.get("people", id);
      if (p) people.set(id, p);
    }
    return people.get(id) ?? null;
  };
  const recipes = await ctx.db
    .query("recipes")
    .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
    .order("desc")
    .take(100);
  const recipe = new Map(recipes.map((r) => [r._id as string, r]));
  const facts: Fact[] = [];

  // Someone in the family cooking right now (the cook hears about her own dishes).
  const sessions = await ctx.db
    .query("cookingSessions")
    .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
    .order("desc")
    .take(50);
  for (const s of sessions) {
    if (s.endedAt !== undefined || s.kidId === me._id || now - s.updatedAt > COOKING_NOW_MS) continue;
    const r = recipe.get(s.recipeId);
    const kid = await personOf(s.kidId);
    if (!r || !kid) continue;
    if (me.role === "cook" && r.cookId !== me._id) continue;
    facts.push({
      id: `cooking:${s._id}`,
      kind: "cooking",
      line: r.cookId === me._id ? `${kid.name} is cooking your ${r.title} right now.` : `${kid.name} is cooking ${r.title} right now.`,
      at: s.updatedAt,
    });
  }

  if (me.role === "kid") {
    // The cook answered one of my questions.
    const answered = await ctx.db
      .query("questions")
      .withIndex("by_familyId_and_status", (q) => q.eq("familyId", familyId).eq("status", "answered"))
      .order("desc")
      .take(50);
    for (const q of answered) {
      if (q.askedBy !== me._id || q.kind === "share" || !q.answer || now - q._creationTime > ANSWER_DAYS * DAY) continue;
      const r = recipe.get(q.recipeId);
      if (!r) continue;
      const cook = await personOf(q.answer.by);
      facts.push({ id: `answer:${q._id}`, kind: "answer", line: `${call(cook)} answered your question about the ${r.title}.`, at: q._creationTime });
    }
    // A new dish from the family.
    for (const r of recipes) {
      if (r.status !== "ready" || r.cookId === me._id || now - r._creationTime > NEW_RECIPE_DAYS * DAY) continue;
      facts.push({ id: `recipe:${r._id}`, kind: "recipe", line: `${call(await personOf(r.cookId))} just added ${r.title}.`, at: r._creationTime });
    }
    // A quiet week: I've cooked before, but not for a while.
    const mine = sessions.filter((s) => s.kidId === me._id);
    const last = mine.length ? Math.max(...mine.map((s) => s.updatedAt)) : 0;
    if (last && now - last > QUIET_DAYS * DAY) {
      facts.push({ id: `quiet:${last}`, kind: "quiet", line: "It's been a quiet week in the kitchen. Want to cook something from home?", at: last });
    }
  } else {
    // Questions waiting for me.
    const open = await ctx.db
      .query("questions")
      .withIndex("by_familyId_and_status", (q) => q.eq("familyId", familyId).eq("status", "asked_cook"))
      .order("desc")
      .take(50);
    for (const q of open) {
      const r = recipe.get(q.recipeId);
      if (q.kind === "share" || !r || r.cookId !== me._id) continue;
      const kid = await personOf(q.askedBy);
      facts.push({ id: `asked:${q._id}`, kind: "asked", line: `${kid?.name ?? "Someone"} asked you about the ${r.title}.`, at: q._creationTime });
    }
    // A quiet week: she has recorded before, but nothing new for a while.
    const last = Math.max(0, ...recipes.filter((r) => r.cookId === me._id).map((r) => r._creationTime));
    if (last && now - last > QUIET_DAYS * DAY) {
      facts.push({ id: `quiet:${last}`, kind: "quiet", line: "It's been a week since your last dish. Your family would love another.", at: last });
    }
  }

  // Newest first, but a quiet week only when nothing else is new.
  return facts.sort((a, b) => Number(a.kind === "quiet") - Number(b.kind === "quiet") || b.at - a.at).slice(0, MAX_FACTS);
}

/** The app's live copy: what a tap on homie can say right now. */
export const news = query({
  args: { sessionToken: v.string(), now: v.number() },
  returns: v.array(fact),
  handler: async (ctx, { sessionToken, now }) => newsFor(ctx, await requireSession(ctx, sessionToken), now),
});

/** The same facts for the voice service (POST /homie/news), with who's asking. Null: signed out. */
export const newsByToken = internalQuery({
  args: { sessionToken: v.string(), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({ name: v.string(), role: v.union(v.literal("cook"), v.literal("kid")), facts: v.array(fact) }),
  ),
  handler: async (ctx, { sessionToken, now }) => {
    const signed = await findSession(ctx, sessionToken);
    if (!signed) return null;
    return { name: signed.person.name, role: signed.person.role, facts: await newsFor(ctx, signed, now) };
  },
});
