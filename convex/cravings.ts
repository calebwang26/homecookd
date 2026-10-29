// Cravings (docs/build/DISH-ASK-SPEC.md §8, PRD-V2 Phase 5): a parent in the app asks her kids what they miss from
// home. She shares her craving link (createLink); a kid names a dish on homecookd.app/miss with no account
// (POST /dish/craving/peek, then POST /dish/cards with the link's token, lib/dishAskRoutes.ts), and the card is a
// request to her. She sees her requests here (forCook, get), says which day she'll film it (setFilmingDay), or tells
// the kid how she makes it by voice (sendVoiceRecipe): one answer, merged into her version at once, as Mom's Send on
// the web is (dishAsks.ts). A craving card never joins anyone to her family.
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { answersOf, finishCard, putAnswer, voiceRecipeOf } from "./dishAsks";
import { requireSession, type Signed } from "./lib/auth";
import {
  checkLinkCaps,
  CRAVING_MESSAGE_CHARS,
  cravingUrl,
  DEFAULT_CRAVING_MESSAGE,
  firstName,
  isLive,
  newestLink,
  openLink,
  relationFrom,
} from "./lib/cravingLinks";
import type { QuestionId } from "./lib/dishAsk/types";
import { baseType, OWN_IDS } from "./lib/dishAsk/validate";
import { randomBase62 } from "./lib/dishAskRoutes";
import { CLIP_BYTES, CLIP_SLACK_S, LANGS, MAX_CLIP_S, ORPHAN_MS, relationV, VOICE_TYPES, voiceRecipeV, WORDS } from "./lib/dishAskValues";
import { flagged } from "./lib/moderation";

type Row = Doc<"dishAsks">;

/** What her voice recipe answers: one question, among the kid's own ids (q4–q6). */
export const VOICE_RECIPE_QUESTION = "How do you make it?";
/** Her requests, newest first. */
const MAX_ASKS = 50;
const NOT_FOUND = "Not found.";

// ---------------------------------------------------------------------------------------------
// Her link

function messageOf(raw: string): string {
  const line = raw.trim();
  if (!line || line.length > CRAVING_MESSAGE_CHARS) {
    throw new ConvexError(`Your message must be 1 to ${CRAVING_MESSAGE_CHARS} characters.`);
  }
  if (flagged(line)) throw new ConvexError(WORDS);
  return line;
}

/**
 * Her craving link: her one live link, reused (a new `message` replaces its line). A new one is made when she has
 * none, stopped it, or it made CRAVING_TOTAL cards.
 */
export const createLink = mutation({
  args: { sessionToken: v.string(), message: v.optional(v.string()) },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { sessionToken, message }) => {
    const { person, family } = await requireSession(ctx, sessionToken);
    const line = message === undefined ? undefined : messageOf(message);
    const live = await newestLink(ctx, person._id);
    if (live && isLive(live)) {
      if (line !== undefined && line !== live.message) await ctx.db.patch("cravingLinks", live._id, { message: line });
      return { url: cravingUrl(live.token) };
    }
    const token = randomBase62();
    await ctx.db.insert("cravingLinks", {
      familyId: family._id,
      personId: person._id,
      token,
      message: line ?? DEFAULT_CRAVING_MESSAGE,
      uses: 0,
      createdAt: Date.now(),
    });
    return { url: cravingUrl(token) };
  },
});

/** "Stop this link": her live link makes no new cards (the ones it made stay); her next createLink makes a new one. */
export const revokeLink = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const { person } = await requireSession(ctx, sessionToken);
    const link = await newestLink(ctx, person._id);
    if (link && link.revokedAt === undefined) await ctx.db.patch("cravingLinks", link._id, { revokedAt: Date.now() });
    return null;
  },
});

/** POST /dish/craving/peek: who's asking, for the kid's page. 404 for an unknown or stopped link. */
export const peekLink = internalQuery({
  args: { token: v.string() },
  returns: v.object({ parentName: v.string(), relation: v.union(v.string(), v.null()), message: v.string() }),
  handler: async (ctx, { token }) => {
    const { link, maker } = await openLink(ctx, token);
    return { parentName: firstName(maker.name), relation: maker.relation?.trim() || null, message: link.message };
  },
});

/**
 * POST /dish/cards with a craving token, before any model runs: 404 for a link that can't make cards, 429 past its
 * caps; else who the kid asks by default (her people.relation when it's one of the six, else mom).
 */
export const linkForCard = internalQuery({
  args: { token: v.string(), now: v.number() },
  returns: v.object({ relation: relationV }),
  handler: async (ctx, { token, now }) => {
    const { link, maker } = await openLink(ctx, token);
    await checkLinkCaps(ctx, link, now);
    return { relation: relationFrom(maker.relation) };
  },
});

// ---------------------------------------------------------------------------------------------
// Her requests (the cards asked of her)

const cravingAskV = v.object({
  id: v.id("dishAsks"),
  kidName: v.string(), // "" when the kid deleted their account
  dish: v.string(),
  guess: v.array(v.object({ amount: v.string(), name: v.string() })),
  kidVoiceUrl: v.union(v.string(), v.null()),
  photoUrl: v.union(v.string(), v.null()),
  message: v.string(),
  createdAt: v.number(),
  answered: v.boolean(),
  voiceRecipe: v.union(voiceRecipeV, v.null()),
  filmingDay: v.union(v.number(), v.null()),
});
export type CravingAsk = Infer<typeof cravingAskV>;

async function cravingAsk(ctx: QueryCtx, row: Row): Promise<CravingAsk> {
  return {
    id: row._id,
    kidName: row.kidName ?? "",
    dish: row.guess.dish,
    guess: row.guess.ingredients.map((i) => ({ amount: i.amount, name: i.name })),
    kidVoiceUrl: row.kidVoiceNote ? await ctx.storage.getUrl(row.kidVoiceNote) : null,
    photoUrl: row.photos.length ? await ctx.storage.getUrl(row.photos[0]) : null,
    message: row.message,
    createdAt: row.createdAt,
    answered: !!row.version,
    voiceRecipe: voiceRecipeOf(row, await answersOf(ctx, row._id)),
    filmingDay: row.filmingDay ?? null,
  };
}

/** The card `id` names, when it's asked of her; null for any other (or a malformed id: the push's deep link). */
async function hers(ctx: QueryCtx, person: Doc<"people">, id: string): Promise<Row | null> {
  const askId = ctx.db.normalizeId("dishAsks", id);
  const row = askId ? await ctx.db.get("dishAsks", askId) : null;
  return row && row.requestedOf === person._id ? row : null;
}

/** The cards made of her (from her craving link, or a web ask she claimed), newest first, answered and not. */
export const forCook = query({
  args: { sessionToken: v.string() },
  returns: v.array(cravingAskV),
  handler: async (ctx, { sessionToken }) => {
    const { person } = await requireSession(ctx, sessionToken);
    const rows = await ctx.db
      .query("dishAsks")
      .withIndex("by_requested_of", (q) => q.eq("requestedOf", person._id))
      .order("desc")
      .take(MAX_ASKS);
    return await Promise.all(rows.map((row) => cravingAsk(ctx, row)));
  },
});

/** One of her requests (the push opens /request/<id>); null when it isn't hers or doesn't exist. */
export const get = query({
  args: { sessionToken: v.string(), id: v.string() },
  returns: v.union(cravingAskV, v.null()),
  handler: async (ctx, { sessionToken, id }) => {
    const { person } = await requireSession(ctx, sessionToken);
    const row = await hers(ctx, person, id);
    return row ? await cravingAsk(ctx, row) : null;
  },
});

/**
 * A card she may act on. Another family's (or none) is "Not found."; her family's that was asked of someone else
 * names who can (`only`: "Only Dad can answer this one.").
 */
async function askedOfMe(ctx: MutationCtx, { person, family }: Signed, id: string, only: (name: string) => string): Promise<Row> {
  const askId = ctx.db.normalizeId("dishAsks", id);
  const row = askId ? await ctx.db.get("dishAsks", askId) : null;
  if (!row || (row.requestedOf !== person._id && row.familyId !== family._id)) throw new ConvexError(NOT_FOUND);
  if (row.requestedOf !== person._id) {
    const them = row.requestedOf ? await ctx.db.get("people", row.requestedOf) : null;
    throw new ConvexError(only(them && them.deletedAt === undefined ? firstName(them.name) : "the person it was asked of"));
  }
  return row;
}

/** The day she plans to film it, 0 (Sunday) to 6; null clears it. The kid's card shows it (Card.filmingDay). */
export const setFilmingDay = mutation({
  args: { sessionToken: v.string(), id: v.string(), day: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { sessionToken, id, day }) => {
    const signed = await requireSession(ctx, sessionToken);
    const row = await askedOfMe(ctx, signed, id, (name) => `Only ${name} can pick the day.`);
    if (day !== null && !(Number.isInteger(day) && day >= 0 && day <= 6)) throw new ConvexError("Pick a day of the week.");
    await ctx.db.patch("dishAsks", row._id, { filmingDay: day ?? undefined });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------
// "Tell him how you make it now": her voice recipe

const voiceRecipeArgs = {
  sessionToken: v.string(),
  id: v.string(),
  audioId: v.id("_storage"), // from files.uploadUrl
  durationS: v.number(),
  language: v.optional(v.string()), // an Ink code (§4's list); her people.language or "en" when left out
};

/**
 * Her 2-minute voice note becomes her version on the kid's card: it's one answer to "How do you make it?", and the
 * card finishes at once, as Mom's Send on the web does (Ink, the translation and the merge run after the reply,
 * within the budget's Mom overage). A second one replaces the first. A public action, so a recording of the wrong
 * type or size can be deleted while the call still fails (a mutation that throws keeps nothing it did).
 */
export const sendVoiceRecipe = action({
  args: voiceRecipeArgs,
  returns: v.null(),
  handler: async (ctx, a): Promise<null> => {
    const refused: string | null = await ctx.runMutation(internal.cravings.saveVoiceRecipe, a);
    if (refused) throw new ConvexError(refused);
    return null;
  },
});

/**
 * The question her voice recipe answers: the one her earlier voice recipe answered (a second one replaces it), else
 * the next kid's-own id that isn't asked, else one asked and not answered yet (its question gives way); null when
 * all three are answered.
 */
function voiceRecipeQuestion(row: Row, answered: Set<QuestionId>): QuestionId | null {
  if (row.voiceRecipeQ && row.asked.some((q) => q.id === row.voiceRecipeQ)) return row.voiceRecipeQ;
  const asked = new Set(row.asked.map((q) => q.id));
  return OWN_IDS.find((id) => !asked.has(id)) ?? OWN_IDS.find((id) => !answered.has(id)) ?? null;
}

/** Why a recording can't be used, from its storage metadata; null when it can. */
function badRecording(file: { contentType?: string; size: number }): string | null {
  if (!VOICE_TYPES.includes(baseType(file.contentType ?? ""))) return "That recording type isn't supported.";
  if (file.size > CLIP_BYTES) return "That recording is too long.";
  if (file.size === 0) return "The recording is empty.";
  return null;
}

/**
 * sendVoiceRecipe's work, in one transaction. A recording that can't be used is deleted and the reason returned
 * (so the delete is kept and the action fails with it); any other refusal throws, and nothing is written.
 */
export const saveVoiceRecipe = internalMutation({
  args: voiceRecipeArgs,
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, a) => {
    const signed = await requireSession(ctx, a.sessionToken);
    const row = await askedOfMe(ctx, signed, a.id, (name) => `Only ${name} can answer this one.`);
    const d = a.durationS;
    if (!Number.isFinite(d) || d < 1 || d > MAX_CLIP_S + CLIP_SLACK_S) {
      throw new ConvexError(`A voice recipe is 1 second to ${MAX_CLIP_S / 60} minutes long.`);
    }
    if (a.language !== undefined && !LANGS.includes(a.language)) throw new ConvexError("Pick a language from the list.");
    const mine = signed.person.language;
    const language = a.language ?? (mine && LANGS.includes(mine) ? mine : "en");

    const now = Date.now();
    const file = await ctx.db.system.get("_storage", a.audioId);
    // Only a fresh upload no card holds: storage ids show in file URLs, so an older or used one may be someone
    // else's photo or clip. It's refused and never deleted or shared.
    const inUse =
      (await ctx.db.query("dishAnswers").withIndex("by_audio", (q) => q.eq("audio", a.audioId)).first()) ??
      (await ctx.db.query("dishFiles").withIndex("by_storage", (q) => q.eq("storageId", a.audioId)).first());
    if (!file || inUse || file._creationTime <= now - ORPHAN_MS) throw new ConvexError("Upload the recording first.");
    const bad = badRecording(file);
    if (bad) {
      await ctx.storage.delete(a.audioId);
      return bad;
    }

    const answers = await answersOf(ctx, row._id);
    const questionId = voiceRecipeQuestion(row, new Set(answers.map((x) => x.questionId)));
    if (!questionId) throw new ConvexError("This one already has her answer.");
    const clip = { audio: a.audioId, durationS: Math.min(MAX_CLIP_S, Math.round(d * 100) / 100), language };
    await putAnswer(ctx, row, answers, questionId, clip, now);
    const question = { id: questionId, text: VOICE_RECIPE_QUESTION };
    const asked = row.asked.some((q) => q.id === questionId)
      ? row.asked.map((q) => (q.id === questionId ? question : q))
      : [...row.asked, question];
    await ctx.db.patch("dishAsks", row._id, {
      asked,
      voiceRecipeQ: questionId,
      ...(row.status === "draft" ? { status: "asked" as const } : {}),
    });
    // No `hear` here: the merge, scheduled now, has Ink write it down.
    await finishCard(ctx, (await ctx.db.get("dishAsks", row._id))!, now);
    return null;
  },
});
