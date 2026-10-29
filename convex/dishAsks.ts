// The dish ask's data (docs/build/DISH-ASK-SPEC.md): a kid's card (their guess at a dish from home, made with no
// account), what Mom is asked, her voice answers, and her version made from them. Only lib/dishAskRoutes.ts calls
// in here (POST /dish/*), and cravings.ts (the parent's side in the app, §8) uses its helpers; every function is
// internal. Ported from the MVP "The dish I miss"
// (supabase/functions/miss/handler.ts on calebwang26/homecookd feat/dish-i-miss):
// - Asking: her answered questions stay first, at most 3 open and 6 in all (askedOf).
// - Her version is rebuilt from the guess with all of her answers each time. Each answer has `merged`; a new or
//   re-recorded one isn't, and gives the card 5 fresh tries. A try takes `mergeTries` and `mergeStartedAt` together
//   (claimMerge), only while none started in the last 3 minutes, and writes her version only while it still holds
//   that claim, so a try a newer answer overtook writes nothing. A failed try is tried again 3 minutes later, by the
//   scheduler and by the kid's /dish/cards/get.
// - Answers she left 20 minutes without Send count as sent (kidGet).
// - The status the pages see is worked out from the answers (cardJson): when no version will come (no words heard,
//   every try failed, or today's budget is spent), the kid gets her clips as they are.
// - The daily budget: every model call's cost goes into dishSpend (addSpend). Mom's transcription, translation and
//   merge stop past $11 a day and start again with the kid's next look on a later day.
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { send } from "./alerts";
import { DishModelError, type Spend, toEnglish, transcribe, writeVersion } from "./dishAskModel";
import { checkLinkCaps, openLink } from "./lib/cravingLinks";
import type { MissQuestion, QuestionId, Relation } from "./lib/dishAsk/types";
import { askedText, isSuggestionId, LIMITS, OWN_IDS, RELATION_LABEL } from "./lib/dishAsk/validate";
import {
  ABANDONED_MS,
  type Ask,
  askV,
  badRequest,
  type Card,
  cardV,
  DAILY_BUDGET_USD,
  dayOf,
  fail,
  MAX_MERGES,
  MERGE_STALE_MS,
  MOM_OVERAGE_USD,
  notFound,
  ORPHAN_MS,
  questionIdV,
  questionV,
  recipeTexts,
  recipeV,
  relationV,
  missRecipe,
  shownRecipe,
  storedRecipe,
  viaV,
  voiceRecipeV,
  WORDS,
} from "./lib/dishAskValues";
import { flagged } from "./lib/moderation";

type Row = Doc<"dishAsks">;
type Answer = Doc<"dishAnswers">;

const WEB = "https://homecookd.app";
export const askUrlOf = (askToken: string) => `${WEB}/a?t=${askToken}`;

/** The Ask Mom text a card starts with. */
export const defaultMessage = (relation: Relation, dish: string) =>
  `${RELATION_LABEL[relation]}, how do you make your ${dish}? I'm trying to make it here.`;

const theirs = (r: Relation) => (r === "dad" || r === "grandpa" || r === "uncle" ? "his" : "her");

// ---------------------------------------------------------------------------------------------
// Reading a card

async function byKid(ctx: QueryCtx, kidTokenHash: string): Promise<Row> {
  const row = await ctx.db.query("dishAsks").withIndex("by_kid_token", (q) => q.eq("kidTokenHash", kidTokenHash)).unique();
  if (!row) throw notFound();
  return row;
}

async function byAsk(ctx: QueryCtx, askTokenHash: string): Promise<Row> {
  const row = await ctx.db.query("dishAsks").withIndex("by_ask_token", (q) => q.eq("askTokenHash", askTokenHash)).unique();
  if (!row) throw notFound();
  return row;
}

/** Her answers, one per question at most (q1–q6), in question order. */
export const answersOf = (ctx: QueryCtx, askId: Id<"dishAsks">): Promise<Answer[]> =>
  ctx.db.query("dishAnswers").withIndex("by_ask_question", (q) => q.eq("askId", askId)).take(LIMITS.askTotal);

async function spentOn(ctx: QueryCtx, now: number): Promise<number> {
  const day = dayOf(now);
  return (await ctx.db.query("dishSpend").withIndex("by_day", (q) => q.eq("day", day)).unique())?.usd ?? 0;
}

/** What the status and the merge are worked out from. */
type State = { row: Row; answers: Answer[]; now: number; spent: number };

async function stateOf(ctx: QueryCtx, row: Row, now = Date.now()): Promise<State> {
  return { row, answers: await answersOf(ctx, row._id), now, spent: await spentOn(ctx, now) };
}

/** A try that started under 3 minutes ago may still be running (a try takes at most 2). */
const running = (s: State) => s.row.mergeStartedAt !== undefined && s.row.mergeStartedAt > s.now - MERGE_STALE_MS;
/** Ink heard no words in any of her clips: trying again won't change that. */
const heardNothing = (answers: Answer[]) => answers.length > 0 && answers.every((a) => a.words === "");
/** Her answers not in her version yet (all of them before the first version). */
const fresh = (answers: Answer[]) => answers.filter((a) => !a.merged);
/** Something to merge: a new answer, unless no clip has words and there's no version. */
const mergeable = (s: State) => fresh(s.answers).length > 0 && (!!s.row.version || !heardNothing(s.answers));
/** Past today's budget and Mom's overage: her answers wait for another day. */
const momOver = (spent: number) => spent >= DAILY_BUDGET_USD + MOM_OVERAGE_USD;
/** No version is coming for her new answers for now: every try failed, or today's budget is spent. */
const stalled = (s: State) =>
  fresh(s.answers).length > 0 && !running(s) && (s.row.mergeTries >= MAX_MERGES || (!!s.row.finishedAt && momOver(s.spent)));
/** From Send until her version lands or no version will come (Mom's page polls while it's true). */
const merging = (s: State) => !!s.row.finishedAt && mergeable(s) && !stalled(s);
/** A merge try can start now. */
const due = (s: State) =>
  !!s.row.finishedAt && s.row.mergeTries < MAX_MERGES && !running(s) && mergeable(s) && !momOver(s.spent);

async function mergeLater(ctx: MutationCtx, s: State) {
  if (due(s)) await ctx.scheduler.runAfter(0, internal.dishAsks.merge, { askId: s.row._id });
}

/**
 * Her voice recipe from the app (cravings.sendVoiceRecipe), for the parent's screen; null when she sent none.
 * - failed: Ink heard no words in it, or the last try failed (merge releases it), so she can send it again;
 * - ready: it's in her version;
 * - writing: until then, also while today's budget holds it for a later day.
 * No clock: the parent's queries read it.
 */
export function voiceRecipeOf(row: Row, answers: Answer[]): Infer<typeof voiceRecipeV> | null {
  const id = row.voiceRecipeQ;
  const a = id && answers.find((x) => x.questionId === id);
  if (!a) return null;
  if (a.words === "") return "failed";
  if (a.merged) return row.version ? "ready" : "failed";
  return row.mergeTries >= MAX_MERGES && row.mergeStartedAt === undefined ? "failed" : "writing";
}

// ---------------------------------------------------------------------------------------------
// What the pages get

const url = (ctx: QueryCtx, id: Id<"_storage"> | undefined) => (id ? ctx.storage.getUrl(id) : Promise.resolve(null));

async function photoUrls(ctx: QueryCtx, row: Row): Promise<string[]> {
  return (await Promise.all(row.photos.map((id) => ctx.storage.getUrl(id)))).filter((u): u is string => !!u);
}

/**
 * The kid's card. Its status is worked out here (the stored one changes only on send, version and reopen):
 * - no version: 'answered' with her clips (words "") once Send is done and no version will come;
 * - a version: 'asked' while her link is open again or her new answers are being merged, else 'answered', with the
 *   answers it was made from (and her new clips too when they'll never be in it).
 */
async function cardJson(ctx: QueryCtx, s: State, askToken: string): Promise<Card> {
  const { row, answers } = s;
  let status = row.status;
  let list: Answer[] = [];
  if (!row.version) {
    if (row.finishedAt && answers.length && (heardNothing(answers) || stalled(s))) [status, list] = ["answered", answers];
  } else {
    const done = !!row.finishedAt && (!fresh(answers).length || stalled(s));
    status = done ? "answered" : "asked";
    list = answers.filter((a) => (a.merged && a.words) || (done && !a.merged));
  }
  return {
    dish: row.dish || row.guess.dish,
    relation: row.relation,
    kidName: row.kidName ?? null,
    status,
    guess: shownRecipe(row.guess),
    version: row.version ? shownRecipe(row.version) : null,
    answers: await Promise.all(
      list.map(async (a) => ({
        id: a.questionId,
        words: row.version ? (a.words ?? "") : "",
        english: row.version && a.words ? (a.english ?? null) : null,
        audioUrl: await ctx.storage.getUrl(a.audio),
        durationS: a.durationS,
      })),
    ),
    merging: merging(s),
    asked: row.asked,
    message: row.message,
    kidVoiceUrl: await url(ctx, row.kidVoiceNote),
    photoUrls: await photoUrls(ctx, row),
    askUrl: askUrlOf(askToken),
    askedAt: row.askedAt ?? null,
    openedAt: row.openedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
    filmingDay: row.filmingDay ?? null,
  };
}

/** What Mom's page in another language was translated from: while it matches, the translation stands. */
const momLangKey = (row: Row) => JSON.stringify([row.asked.map((q) => [q.id, q.text]), row.message]);

/** The card in Mom's page language, from the cache (never translated here); null for English or none yet. */
function inLangOf(row: Row, lang: string | undefined, open: MissQuestion[]): Ask["inLang"] {
  if (!lang || lang === "en") return null;
  const key = momLangKey(row);
  const hit = row.momLang?.find((m) => m.lang === lang && m.key === key);
  if (!hit) return null;
  const text = new Map(hit.questions.map((q) => [q.id, q.text]));
  return {
    lang,
    guess: shownRecipe(hit.guess),
    questions: open.map((q) => ({ id: q.id, text: text.get(q.id) ?? q.text })),
    message: hit.message,
  };
}

/**
 * Mom's page: the kid's guess and photos, the questions she hasn't answered, her own clips; never the kid token.
 * `lang`: her page's language, for `inLang` (cached translations only).
 */
async function askJson(ctx: QueryCtx, s: State, lang?: string): Promise<Ask> {
  const { row, answers } = s;
  const answered = new Set(answers.map((a) => a.questionId));
  const open = row.asked.filter((q) => !answered.has(q.id));
  const isMerging = merging(s);
  return {
    dish: row.guess.dish,
    relation: row.relation,
    kidName: row.kidName ?? null,
    message: row.message,
    kidVoiceUrl: await url(ctx, row.kidVoiceNote),
    guess: shownRecipe(row.guess),
    inLang: inLangOf(row, lang, open),
    photoUrls: await photoUrls(ctx, row),
    questions: open,
    answered: [...answered].sort(),
    clips: await Promise.all(
      answers.map(async (a) => ({ id: a.questionId, audioUrl: await ctx.storage.getUrl(a.audio), durationS: a.durationS })),
    ),
    finished:
      !!row.finishedAt || (row.asked.length > 0 && row.asked.every((q) => answers.some((a) => a.questionId === q.id && a.merged))),
    version: row.version && !isMerging ? shownRecipe(row.version) : null,
    merging: isMerging,
  };
}

// ---------------------------------------------------------------------------------------------
// Files

/** An upload that can go on a card: there, of this kind, and on no card yet. */
async function usableFile(ctx: QueryCtx, fileIdHash: string, kind: "photo" | "voice"): Promise<Doc<"dishFiles">> {
  const f = await ctx.db.query("dishFiles").withIndex("by_file_id", (q) => q.eq("fileIdHash", fileIdHash)).unique();
  if (!f || f.askId) throw notFound("That file doesn't work anymore. Add it again.");
  if (f.kind !== kind) throw badRequest(kind === "photo" ? "photos must be photos" : "voiceNote must be a voice note");
  return f;
}

async function dropFile(ctx: MutationCtx, id: Id<"_storage">) {
  if (await ctx.db.system.get("_storage", id)) await ctx.storage.delete(id);
}

/** One of a card's uploads, with its dishFiles row. */
async function dropCardFile(ctx: MutationCtx, askId: Id<"dishAsks">, storageId: Id<"_storage">) {
  const rows = await ctx.db.query("dishFiles").withIndex("by_unattached_created", (q) => q.eq("askId", askId)).take(20);
  for (const f of rows) if (f.storageId === storageId) await ctx.db.delete("dishFiles", f._id);
  await dropFile(ctx, storageId);
}

export const addFile = internalMutation({
  args: {
    fileIdHash: v.string(),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("photo"), v.literal("voice")),
    contentType: v.string(),
    size: v.number(),
    ipKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("dishFiles", { ...a, createdAt: Date.now() });
    return null;
  },
});

const fileOut = v.object({ storageId: v.id("_storage"), contentType: v.string() });

/** The uploads a new card is made from, checked before any model runs (create checks them again). */
export const filesToUse = internalQuery({
  args: { photos: v.array(v.string()), voiceNote: v.union(v.string(), v.null()) },
  returns: v.object({ photos: v.array(fileOut), voiceNote: v.union(fileOut, v.null()) }),
  handler: async (ctx, { photos, voiceNote }) => {
    const pick = (f: Doc<"dishFiles">) => ({ storageId: f.storageId, contentType: f.contentType });
    return {
      photos: (await Promise.all(photos.map((h) => usableFile(ctx, h, "photo")))).map(pick),
      voiceNote: voiceNote ? pick(await usableFile(ctx, voiceNote, "voice")) : null,
    };
  },
});

/** The cron: uploads no card took within an hour are deleted, a batch at a time. */
export const dropOrphanFiles = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const batch = 200;
    const old = await ctx.db
      .query("dishFiles")
      .withIndex("by_unattached_created", (q) => q.eq("askId", undefined).lt("createdAt", Date.now() - ORPHAN_MS))
      .take(batch);
    for (const f of old) {
      await dropFile(ctx, f.storageId);
      await ctx.db.delete("dishFiles", f._id);
    }
    if (old.length === batch) await ctx.scheduler.runAfter(0, internal.dishAsks.dropOrphanFiles, {});
    return null;
  },
});

/** The kid's own files on a card: photos, the voice note about the dish, the voice note to Mom. */
const kidFiles = (card: Row) => [
  ...card.photos,
  ...(card.dishVoiceNote ? [card.dishVoiceNote] : []),
  ...(card.kidVoiceNote ? [card.kidVoiceNote] : []),
];

/**
 * The kid deleted their account and Mom (requestedOf) is still here: the card stays for her, without the kid's
 * name, photos or voice notes. Returns the rows deleted or changed (account.ts).
 */
export async function dropKid(ctx: MutationCtx, card: Row): Promise<number> {
  let n = 1;
  for (const id of kidFiles(card)) {
    await dropCardFile(ctx, card._id, id);
    n++;
  }
  await ctx.db.patch("dishAsks", card._id, {
    personId: undefined,
    kidName: undefined,
    kidVoiceNote: undefined,
    dishVoiceNote: undefined,
    photos: [],
    kidClaimedAt: undefined,
  });
  return n;
}

/**
 * Mom (requestedOf) deleted her account: her answers and clips go, and so do her version and her filming day; the
 * card goes back to waiting for an answer, and stays for the kid. Returns the rows deleted or changed (account.ts).
 */
export async function dropCook(ctx: MutationCtx, card: Row): Promise<number> {
  let n = 1;
  for (const a of await answersOf(ctx, card._id)) {
    await dropFile(ctx, a.audio);
    await ctx.db.delete("dishAnswers", a._id);
    n++;
  }
  await ctx.db.patch("dishAsks", card._id, {
    requestedOf: undefined,
    cookClaimedAt: undefined,
    version: undefined,
    status: "asked",
    openedAt: undefined,
    finishedAt: undefined,
    mergeTries: 0,
    mergeStartedAt: undefined,
    mergedAt: undefined,
    momLang: undefined,
    filmingDay: undefined,
    voiceRecipeQ: undefined,
  });
  return n;
}

/** A card with everything it holds: her answers and clips, its uploads. Returns the rows deleted (account.ts). */
export async function deleteCard(ctx: MutationCtx, card: Row): Promise<number> {
  let n = 1;
  for (const a of await ctx.db.query("dishAnswers").withIndex("by_ask_question", (q) => q.eq("askId", card._id)).take(50)) {
    await dropFile(ctx, a.audio);
    await ctx.db.delete("dishAnswers", a._id);
    n++;
  }
  for (const f of await ctx.db.query("dishFiles").withIndex("by_unattached_created", (q) => q.eq("askId", card._id)).take(50)) {
    await dropFile(ctx, f.storageId);
    await ctx.db.delete("dishFiles", f._id);
    n++;
  }
  for (const id of kidFiles(card)) await dropFile(ctx, id);
  await ctx.db.delete("dishAsks", card._id);
  return n;
}

// ---------------------------------------------------------------------------------------------
// The kid

export const create = internalMutation({
  args: {
    kidTokenHash: v.string(),
    askTokenHash: v.string(),
    askToken: v.string(),
    dish: v.string(),
    relation: relationV,
    kidName: v.union(v.string(), v.null()),
    photos: v.array(v.string()),
    voiceNote: v.union(v.string(), v.null()),
    guess: recipeV,
    genMs: v.number(),
    ipKey: v.string(),
    /** From a parent's craving link (§8): the card is a request to her. Its checks run again here. */
    cravingToken: v.optional(v.string()),
  },
  returns: cardV,
  handler: async (ctx, a) => {
    const photos = await Promise.all(a.photos.map((h) => usableFile(ctx, h, "photo")));
    const voice = a.voiceNote ? await usableFile(ctx, a.voiceNote, "voice") : null;
    const now = Date.now();
    let craving = null;
    if (a.cravingToken !== undefined) {
      if (!a.kidName) throw badRequest("kidName is required");
      craving = (await openLink(ctx, a.cravingToken)).link;
      await checkLinkCaps(ctx, craving, now);
      await ctx.db.patch("cravingLinks", craving._id, { uses: craving.uses + 1 });
    }
    const askId = await ctx.db.insert("dishAsks", {
      kidTokenHash: a.kidTokenHash,
      askTokenHash: a.askTokenHash,
      dish: a.dish,
      relation: a.relation,
      ...(a.kidName ? { kidName: a.kidName } : {}),
      photos: photos.map((f) => f.storageId),
      // The voice note about the dish stays on the card, privately: no page gets it.
      ...(voice ? { dishVoiceNote: voice.storageId } : {}),
      guess: a.guess,
      message: defaultMessage(a.relation, a.guess.dish),
      asked: [],
      status: "draft",
      mergeTries: 0,
      genMs: a.genMs,
      createdAt: now,
      ipKey: a.ipKey,
      // Tied to her, never joining anyone to her family; the cook side is held from the start (V2-LINKING.md).
      ...(craving
        ? { familyId: craving.familyId, requestedOf: craving.personId, cravingId: craving._id, cookClaimedAt: now }
        : {}),
    });
    for (const f of [...photos, ...(voice ? [voice] : [])]) await ctx.db.patch("dishFiles", f._id, { askId });
    // Phase 4 (Notifications & linking): ctx.scheduler.runAfter(0, internal.pushEvents.requested, { askId });
    const row = (await ctx.db.get("dishAsks", askId))!;
    return await cardJson(ctx, await stateOf(ctx, row, now), a.askToken);
  },
});

const kidArgs = { kidTokenHash: v.string(), askToken: v.string() };

/** The kid's card. Answers she left 20 minutes count as sent, and a merge that's due starts after the reply. */
export const kidGet = internalMutation({
  args: kidArgs,
  returns: cardV,
  handler: async (ctx, { kidTokenHash, askToken }) => {
    let row = await byKid(ctx, kidTokenHash);
    const now = Date.now();
    const mine = fresh(await answersOf(ctx, row._id));
    if (!row.finishedAt && mine.length) {
      const last = Math.max(...mine.map((a) => a.createdAt), row.questionsAt ?? 0);
      if (last <= now - ABANDONED_MS) {
        await ctx.db.patch("dishAsks", row._id, { finishedAt: now });
        row = { ...row, finishedAt: now };
      }
    }
    const s = await stateOf(ctx, row, now);
    await mergeLater(ctx, s);
    return await cardJson(ctx, s, askToken);
  },
});

export const kidUpdate = internalMutation({
  args: {
    ...kidArgs,
    relation: v.optional(relationV),
    kidName: v.optional(v.union(v.string(), v.null())),
    message: v.optional(v.string()),
    voiceNote: v.optional(v.union(v.string(), v.null())),
  },
  returns: cardV,
  handler: async (ctx, a) => {
    const row = await byKid(ctx, a.kidTokenHash);
    if (row.finishedAt && (a.message !== undefined || a.voiceNote !== undefined)) {
      throw fail(409, "closed", `${RELATION_LABEL[row.relation]} already sent ${theirs(row.relation)} answers.`);
    }
    const patch: { relation?: Relation; kidName?: string; message?: string; kidVoiceNote?: Id<"_storage"> } = {};
    if (a.relation !== undefined && a.relation !== row.relation) {
      patch.relation = a.relation;
      // A message the kid never changed follows who they're asking.
      if (a.message === undefined && row.message === defaultMessage(row.relation, row.guess.dish)) {
        patch.message = defaultMessage(a.relation, row.guess.dish);
      }
    }
    if (a.kidName !== undefined) patch.kidName = a.kidName ?? undefined;
    if (a.message !== undefined) patch.message = a.message;
    if (a.voiceNote !== undefined) {
      const next = a.voiceNote === null ? null : await usableFile(ctx, a.voiceNote, "voice");
      if (next) await ctx.db.patch("dishFiles", next._id, { askId: row._id });
      if (row.kidVoiceNote) await dropCardFile(ctx, row._id, row.kidVoiceNote);
      patch.kidVoiceNote = next?.storageId;
    }
    if (Object.keys(patch).length) await ctx.db.patch("dishAsks", row._id, patch);
    const now = Date.now();
    return await cardJson(ctx, await stateOf(ctx, (await ctx.db.get("dishAsks", row._id))!, now), a.askToken);
  },
});

/**
 * What Mom is asked now (POST /dish/cards/ask), checked: 1 to 3 questions, each a suggestion (q1–q3, in the kid's
 * words) or the kid's own (no id: the next free q4–q6), no id twice, and at most 6 asked in all. One she answered
 * already is left out (the kid's page learns of her answers only with her version), and 409 when that leaves
 * nothing. Returns her answered questions as they were, then these.
 */
export function askedOf(given: { id: string | null; text: string }[], before: MissQuestion[], answered: Set<QuestionId>): MissQuestion[] {
  const [min, max] = LIMITS.asked;
  if (!given.length) throw badRequest("questions must be a list of 1 to 3 questions");
  if (given.length > LIMITS.askOpen) throw badRequest(`At most ${LIMITS.askOpen} questions at a time`);
  const all = given.map((q, i) => {
    const text = askedText(q.text);
    if (text.length < min || text.length > max) throw badRequest(`questions[${i}].text must be ${min} to ${max} characters`);
    if (q.id !== null && !isSuggestionId(q.id)) {
      throw badRequest(`questions[${i}].id must be q1, q2 or q3, or left out for the kid's own question`);
    }
    return { id: q.id as QuestionId | null, text };
  });
  const ids = all.flatMap((q) => (q.id ? [q.id] : []));
  if (new Set(ids).size !== ids.length) throw badRequest("The same question is in the list twice");
  if (flagged(...all.map((q) => q.text))) throw fail(422, "words", WORDS);
  const open = all.filter((q) => !q.id || !answered.has(q.id));
  if (!open.length) throw fail(409, "closed", "That was already answered.");
  const kept = before.filter((q) => answered.has(q.id));
  if (kept.length + open.length > LIMITS.askTotal) throw badRequest(`At most ${LIMITS.askTotal} questions in all`);
  const free = OWN_IDS.filter((id) => !answered.has(id));
  return [
    ...kept,
    ...open.map((q) => {
      const id = q.id ?? free.shift();
      if (!id) throw badRequest("At most 3 questions of your own");
      return { id, text: q.text };
    }),
  ];
}

/** Her answered questions stay; these replace the rest. When she had sent, her link opens again on them. */
export const kidAsk = internalMutation({
  args: { ...kidArgs, questions: v.array(v.object({ id: v.union(v.string(), v.null()), text: v.string() })) },
  returns: cardV,
  handler: async (ctx, a) => {
    const row = await byKid(ctx, a.kidTokenHash);
    const answers = await answersOf(ctx, row._id);
    const asked = askedOf(a.questions, row.asked, new Set(answers.map((x) => x.questionId)));
    const now = Date.now();
    await ctx.db.patch("dishAsks", row._id, {
      asked,
      questionsAt: now,
      ...(row.finishedAt ? { finishedAt: undefined, status: "asked" as const } : {}),
    });
    return await cardJson(ctx, await stateOf(ctx, (await ctx.db.get("dishAsks", row._id))!, now), a.askToken);
  },
});

/** The share sheet opened a channel: the first time sets askedAt, and a draft becomes 'asked'. */
export const kidSent = internalMutation({
  args: { ...kidArgs, via: viaV },
  returns: cardV,
  handler: async (ctx, a) => {
    const row = await byKid(ctx, a.kidTokenHash);
    const now = Date.now();
    const patch = {
      ...(row.askedAt === undefined ? { askedAt: now, askedVia: a.via } : {}),
      ...(row.status === "draft" ? { status: "asked" as const } : {}),
    };
    if (Object.keys(patch).length) await ctx.db.patch("dishAsks", row._id, patch);
    return await cardJson(ctx, await stateOf(ctx, (await ctx.db.get("dishAsks", row._id))!, now), a.askToken);
  },
});

// ---------------------------------------------------------------------------------------------
// Mom

export const momPeek = internalMutation({
  args: { askTokenHash: v.string(), lang: v.optional(v.string()) },
  returns: askV,
  handler: async (ctx, { askTokenHash, lang }) => {
    let row = await byAsk(ctx, askTokenHash);
    const now = Date.now();
    if (row.openedAt === undefined) {
      await ctx.db.patch("dishAsks", row._id, { openedAt: now });
      row = { ...row, openedAt: now };
    }
    return await askJson(ctx, await stateOf(ctx, row, now), lang);
  },
});

const forMomV = v.object({ guess: recipeV, questions: v.array(questionV), message: v.string() });

/** What peek translates for Mom's page in `lang`: null when a translation for the card as it is now is cached. */
export const momLangSource = internalQuery({
  args: { askTokenHash: v.string(), lang: v.string() },
  returns: v.union(v.object({ askId: v.id("dishAsks"), key: v.string(), english: forMomV }), v.null()),
  handler: async (ctx, { askTokenHash, lang }) => {
    const row = await byAsk(ctx, askTokenHash);
    const key = momLangKey(row);
    if (row.momLang?.some((m) => m.lang === lang && m.key === key)) return null;
    return { askId: row._id, key, english: { guess: row.guess, questions: row.asked, message: row.message } };
  },
});

/** Keeps a translation of the card for Mom's page, in place of that language's older one. */
export const saveMomLang = internalMutation({
  args: { askId: v.id("dishAsks"), lang: v.string(), key: v.string(), translated: forMomV },
  returns: v.null(),
  handler: async (ctx, { askId, lang, key, translated }) => {
    const row = await ctx.db.get("dishAsks", askId);
    if (!row) return null;
    const momLang = [...(row.momLang ?? []).filter((m) => m.lang !== lang), { lang, key, ...translated }];
    await ctx.db.patch("dishAsks", askId, { momLang });
    return null;
  },
});

/** Mom may record an answer to a question she was asked: a new one, or again until it's in her version. */
function canAnswer(row: Row, answers: Answer[], questionId: QuestionId) {
  if (row.finishedAt) throw fail(409, "closed", "These answers were already sent.");
  if (!row.asked.some((q) => q.id === questionId)) throw badRequest("That question wasn't asked.");
  if (answers.some((a) => a.questionId === questionId && a.merged)) throw fail(409, "closed", "That answer was already sent.");
}

/** The answer route's checks before it stores her clip (momAnswer checks again). */
export const answerable = internalQuery({
  args: { askTokenHash: v.string(), questionId: questionIdV },
  returns: v.null(),
  handler: async (ctx, { askTokenHash, questionId }) => {
    const row = await byAsk(ctx, askTokenHash);
    canAnswer(row, await answersOf(ctx, row._id), questionId);
    return null;
  },
});

type Clip = { audio: Id<"_storage">; durationS: number; language: string };

/**
 * Saves (or replaces) her answer to one question, and the card's merges start over. A replaced clip is deleted.
 * Mom's web answer (momAnswer) and her voice recipe from the app (cravings.sendVoiceRecipe) both go through here.
 */
export async function putAnswer(
  ctx: MutationCtx,
  row: Row,
  answers: Answer[],
  questionId: QuestionId,
  clip: Clip,
  now: number,
): Promise<Id<"dishAnswers">> {
  const fields = { ...clip, merged: false, createdAt: now };
  const old = answers.find((x) => x.questionId === questionId);
  let answerId: Id<"dishAnswers">;
  if (old) {
    answerId = old._id;
    await ctx.db.patch("dishAnswers", old._id, { ...fields, words: undefined, english: undefined });
    if (old.audio !== clip.audio) await dropFile(ctx, old.audio);
  } else {
    answerId = await ctx.db.insert("dishAnswers", { askId: row._id, questionId, ...fields });
  }
  await ctx.db.patch("dishAsks", row._id, { mergeTries: 0, mergeStartedAt: undefined });
  return answerId;
}

/**
 * Send: her answers go to the kid, and the merge (Ink, the translation, her version) runs after the reply. Nothing
 * answered changes nothing. Mom's web Send (momFinish) and cravings.sendVoiceRecipe both end here.
 */
export async function finishCard(ctx: MutationCtx, row: Row, now: number): Promise<State> {
  if (!row.finishedAt && fresh(await answersOf(ctx, row._id)).length) {
    await ctx.db.patch("dishAsks", row._id, { finishedAt: now });
    row = { ...row, finishedAt: now };
  }
  const s = await stateOf(ctx, row, now);
  await mergeLater(ctx, s);
  return s;
}

/** Saves (or replaces) one answer: its words are written down after the reply, and the card's merges start over. */
export const momAnswer = internalMutation({
  args: {
    askTokenHash: v.string(),
    questionId: questionIdV,
    audio: v.id("_storage"),
    durationS: v.number(),
    language: v.string(),
  },
  returns: askV,
  handler: async (ctx, a) => {
    const row = await byAsk(ctx, a.askTokenHash);
    const answers = await answersOf(ctx, row._id);
    canAnswer(row, answers, a.questionId);
    const now = Date.now();
    const clip = { audio: a.audio, durationS: a.durationS, language: a.language };
    const answerId = await putAnswer(ctx, row, answers, a.questionId, clip, now);
    await ctx.scheduler.runAfter(0, internal.dishAsks.hear, { answerId, audio: a.audio });
    return await askJson(ctx, await stateOf(ctx, (await ctx.db.get("dishAsks", row._id))!, now), a.language);
  },
});

/** Send: her answers go to the kid, and her version is written after the reply. Nothing answered changes nothing. */
export const momFinish = internalMutation({
  args: { askTokenHash: v.string(), lang: v.optional(v.string()) },
  returns: askV,
  handler: async (ctx, { askTokenHash, lang }) => {
    const row = await byAsk(ctx, askTokenHash);
    return await askJson(ctx, await finishCard(ctx, row, Date.now()), lang);
  },
});

// ---------------------------------------------------------------------------------------------
// Her words and her version (after the reply)

const heardV = v.object({
  answerId: v.id("dishAnswers"),
  questionId: questionIdV,
  audio: v.id("_storage"),
  durationS: v.number(),
  language: v.string(),
  words: v.optional(v.string()),
  english: v.optional(v.union(v.string(), v.null())),
  merged: v.boolean(),
});
type Heard = Infer<typeof heardV>;

const heard = (a: Answer): Heard => ({
  answerId: a._id,
  questionId: a.questionId,
  audio: a.audio,
  durationS: a.durationS,
  language: a.language,
  words: a.words,
  english: a.english,
  merged: a.merged,
});

export const answerToHear = internalQuery({
  args: { answerId: v.id("dishAnswers") },
  returns: v.union(heardV, v.null()),
  handler: async (ctx, { answerId }) => {
    const a = await ctx.db.get("dishAnswers", answerId);
    return a ? heard(a) : null;
  },
});

/** The words of one clip, kept only while it's still the answer's clip (a re-record keeps none). */
export const setAnswerWords = internalMutation({
  args: {
    answerId: v.id("dishAnswers"),
    audio: v.id("_storage"),
    words: v.optional(v.string()),
    english: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { answerId, audio, words, english }) => {
    const a = await ctx.db.get("dishAnswers", answerId);
    if (!a || a.audio !== audio) return null;
    await ctx.db.patch("dishAnswers", answerId, {
      ...(words !== undefined ? { words } : {}),
      ...(english !== undefined ? { english } : {}),
    });
    return null;
  },
});

const claimV = v.object({
  claimedAt: v.number(),
  tries: v.number(),
  guess: recipeV,
  relation: relationV,
  asked: v.array(questionV),
  hasVersion: v.boolean(),
  answers: v.array(heardV),
});

/** Takes the next merge try when one is due (with her answers as they are now); null when none is. */
export const claimMerge = internalMutation({
  args: { askId: v.id("dishAsks") },
  returns: v.union(claimV, v.null()),
  handler: async (ctx, { askId }) => {
    const row = await ctx.db.get("dishAsks", askId);
    if (!row) return null;
    const now = Date.now();
    const s = await stateOf(ctx, row, now);
    if (!due(s)) return null;
    await ctx.db.patch("dishAsks", askId, { mergeTries: row.mergeTries + 1, mergeStartedAt: now });
    return {
      claimedAt: now,
      tries: row.mergeTries + 1,
      guess: row.guess,
      relation: row.relation,
      asked: row.asked,
      hasVersion: !!row.version,
      answers: s.answers.map(heard),
    };
  },
});

/**
 * Ends a try that isn't running anymore, while it still holds the merge. `giveBack`: it didn't really try (a key
 * isn't set, or today's budget ran out), so the try doesn't count. Else it was the last try and it failed: the
 * kid's card and Mom's page stop waiting at once.
 */
export const releaseMerge = internalMutation({
  args: { askId: v.id("dishAsks"), claimedAt: v.number(), giveBack: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { askId, claimedAt, giveBack }) => {
    const row = await ctx.db.get("dishAsks", askId);
    if (row && row.mergeStartedAt === claimedAt) {
      await ctx.db.patch("dishAsks", askId, {
        mergeStartedAt: undefined,
        ...(giveBack ? { mergeTries: Math.max(0, row.mergeTries - 1) } : {}),
      });
    }
    return null;
  },
});

async function markMergedClips(ctx: MutationCtx, askId: Id<"dishAsks">, audios: Id<"_storage">[]) {
  for (const a of await answersOf(ctx, askId)) {
    if (!a.merged && audios.includes(a.audio)) await ctx.db.patch("dishAnswers", a._id, { merged: true });
  }
}

/** Her new clips held no words: her version stands as it is. */
export const markMerged = internalMutation({
  args: { askId: v.id("dishAsks"), audios: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { askId, audios }) => {
    await markMergedClips(ctx, askId, audios);
    return null;
  },
});

/** Writes her version, only while the try that started at `claimedAt` still holds the merge. */
export const saveVersion = internalMutation({
  args: { askId: v.id("dishAsks"), claimedAt: v.number(), version: recipeV, audios: v.array(v.id("_storage")) },
  returns: v.boolean(),
  handler: async (ctx, { askId, claimedAt, version, audios }) => {
    const row = await ctx.db.get("dishAsks", askId);
    if (!row || row.mergeStartedAt !== claimedAt) return false;
    await ctx.db.patch("dishAsks", askId, { version, status: "answered", mergedAt: Date.now() });
    await markMergedClips(ctx, askId, audios);
    // Phase 4 (Notifications & linking): ctx.scheduler.runAfter(0, internal.pushEvents.answered, { askId });
    return true;
  },
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function momBudgetLeft(ctx: ActionCtx): Promise<boolean> {
  return !momOver(await ctx.runQuery(internal.dishAsks.spentToday, { now: Date.now() }));
}

/**
 * Ink writes her clip down, then Claude puts it in English when she spoke another language; each is saved as it
 * lands, so a later try doesn't pay for it again. Updates `a` in place.
 */
async function hearOne(ctx: ActionCtx, a: Heard, spend: Spend): Promise<"ok" | "budget" | "missing"> {
  if (a.words === undefined) {
    if (!(await momBudgetLeft(ctx))) return "budget";
    const blob = await ctx.storage.get(a.audio);
    if (!blob) return "missing";
    a.words = (await transcribe(blob, a.language, a.durationS, spend)).trim().slice(0, LIMITS.words);
    if (a.language === "en" || !a.words) a.english = null;
    await ctx.runMutation(internal.dishAsks.setAnswerWords, { answerId: a.answerId, audio: a.audio, words: a.words, english: a.english });
  }
  if (a.english === undefined) {
    if (a.words && a.language !== "en") {
      if (!(await momBudgetLeft(ctx))) return "budget";
      a.english = await toEnglish(a.words, spend);
    } else a.english = null;
    await ctx.runMutation(internal.dishAsks.setAnswerWords, { answerId: a.answerId, audio: a.audio, english: a.english });
  }
  return "ok";
}

/** Adds what an action spent on models to today's total. Never throws. */
export async function recordSpend(ctx: ActionCtx, spend: Spend): Promise<void> {
  if (!(spend.usd > 0)) return;
  try {
    await ctx.runMutation(internal.dishAsks.addSpend, { usd: spend.usd });
  } catch (e) {
    console.error(`dish spend of $${spend.usd.toFixed(4)} wasn't recorded: ${errText(e)}`);
  }
}

/** Right after she answers: Ink writes it down (and Claude translates), so Send seldom waits on it. */
export const hear = internalAction({
  args: { answerId: v.id("dishAnswers"), audio: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { answerId, audio }) => {
    const spend: Spend = { usd: 0 };
    try {
      const a = await ctx.runQuery(internal.dishAsks.answerToHear, { answerId });
      if (!a || a.audio !== audio) return null;
      const r = await hearOne(ctx, a, spend);
      if (r === "budget") console.warn("dish answer: today's budget is spent; her clip is heard on a later day");
      if (r === "missing") console.error(`dish answer ${a.questionId}: its clip is missing`);
    } catch (e) {
      console.error(`dish answer: hearing failed (the merge tries again): ${errText(e)}`);
    } finally {
      await recordSpend(ctx, spend);
    }
    return null;
  },
});

/**
 * One merge try. Mom's version is rebuilt from the guess with all of her answers: Ink writes down the clips with no
 * words yet, Claude translates, then Claude writes her version from all her words, and the word filter reads it. It
 * is all her answers or nothing: a version without one would hide it from the kid. A failure is logged and tried
 * again 3 minutes later (her answers stay saved), up to 5 tries.
 */
export const merge = internalAction({
  args: { askId: v.id("dishAsks") },
  returns: v.null(),
  handler: async (ctx, { askId }) => {
    const claim = await ctx.runMutation(internal.dishAsks.claimMerge, { askId });
    if (!claim) return null;
    const tag = `dish merge (try ${claim.tries} of ${MAX_MERGES})`;
    const started = Date.now();
    const spend: Spend = { usd: 0 };
    const release = (giveBack = true) =>
      ctx.runMutation(internal.dishAsks.releaseMerge, { askId, claimedAt: claim.claimedAt, giveBack });
    /** The next try 3 minutes on; after the last one, nothing more is coming. */
    const retry = async () => {
      if (claim.tries < MAX_MERGES) await ctx.scheduler.runAfter(MERGE_STALE_MS + 1000, internal.dishAsks.merge, { askId });
      else await release(false);
    };
    const overBudget = async () => {
      console.warn(`${tag}: today's budget is spent; the kid's next look on a later day starts it again`);
      await release();
    };
    try {
      for (const a of claim.answers) {
        const r = await hearOne(ctx, a, spend);
        if (r === "budget") {
          await overBudget();
          return null;
        }
        if (r === "missing") throw new Error(`the clip for ${a.questionId} is missing`);
      }
      const audios = claim.answers.map((a) => a.audio);
      if (claim.hasVersion && !claim.answers.some((a) => !a.merged && a.words)) {
        await ctx.runMutation(internal.dishAsks.markMerged, { askId, audios });
        console.log(`${tag}: no speech in her new clips`);
        return null;
      }
      const spoken = claim.answers.flatMap((a) => (a.words ? [{ id: a.questionId, words: a.words, english: a.english ?? null }] : []));
      if (!spoken.length) {
        console.log(`${tag}: no speech in her clips`);
        return null;
      }
      if (!(await momBudgetLeft(ctx))) {
        await overBudget();
        return null;
      }
      const version = storedRecipe(
        await writeVersion({ draft: missRecipe(claim.guess), relation: claim.relation, asked: claim.asked, answers: spoken }, spend),
      );
      if (flagged(...recipeTexts(version))) throw new Error("her version has a filtered word");
      if (!(await ctx.runMutation(internal.dishAsks.saveVersion, { askId, claimedAt: claim.claimedAt, version, audios }))) {
        console.log(`${tag}: a newer try has her later answers; this one is dropped`);
        return null;
      }
      console.log(`${tag}: done in ${Date.now() - started} ms`);
    } catch (e) {
      console.error(`${tag} failed: ${errText(e)}`);
      if (e instanceof DishModelError && e.kind === "not_set_up") await release();
      else await retry();
    } finally {
      await recordSpend(ctx, spend);
    }
    return null;
  },
});

// ---------------------------------------------------------------------------------------------
// The daily budget (spec §6)

export const spentToday = internalQuery({
  args: { now: v.number() },
  returns: v.number(),
  handler: async (ctx, { now }) => await spentOn(ctx, now),
});

/** Adds a model call's cost to today's total; the first time a day reaches the budget, the team is told once. */
export const addSpend = internalMutation({
  args: { usd: v.number() },
  returns: v.null(),
  handler: async (ctx, { usd }) => {
    if (!Number.isFinite(usd) || usd <= 0) return null;
    const now = Date.now();
    const day = dayOf(now);
    const row = await ctx.db.query("dishSpend").withIndex("by_day", (q) => q.eq("day", day)).unique();
    const total = (row?.usd ?? 0) + usd;
    const alert = total >= DAILY_BUDGET_USD && row?.alertedAt === undefined;
    const fields = { usd: total, ...(alert ? { alertedAt: now } : {}) };
    if (row) await ctx.db.patch("dishSpend", row._id, fields);
    else await ctx.db.insert("dishSpend", { day, ...fields });
    if (alert) {
      console.error(
        `ALERT dish budget: $${total.toFixed(2)} spent on ${day} (UTC), the $${DAILY_BUDGET_USD} daily budget. ` +
          `New cards are refused until tomorrow; Mom's answers go on to $${DAILY_BUDGET_USD + MOM_OVERAGE_USD}.`,
      );
      await ctx.scheduler.runAfter(0, internal.dishAsks.budgetAlert, { day, usd: total });
    }
    return null;
  },
});

export const budgetAlert = internalAction({
  args: { day: v.string(), usd: v.number() },
  returns: v.null(),
  handler: async (_ctx, { day, usd }) => {
    await send(
      "homecookd: dish budget reached",
      `The dish ask spent $${usd.toFixed(2)} on ${day} (UTC), its $${DAILY_BUDGET_USD} daily budget. New cards are refused ` +
        `until tomorrow; Mom's answers still go through, up to $${DAILY_BUDGET_USD + MOM_OVERAGE_USD}.`,
    );
    return null;
  },
});
