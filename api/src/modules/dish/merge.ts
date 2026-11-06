// Her words and her version, after the reply (convex/dishAsks.ts hear and merge). Both run from the `scheduled` queue, together and possibly twice.
// Safe to repeat, and safe at once:
// - A clip is heard by one holder at a time (claimHearing), so Ink and the translation are paid once. Words and English are written only where
//   they're still empty, so a slow holder can't change what a merge already quoted. A merge that finds a clip being heard gives its try back and
//   looks again shortly. A holder that died stops counting after HEAR_STALE_MS.
// - merge takes a claim first (mergeTries and mergeStartedAt together, only while none started in the last 3 minutes) and writes her version only
//   while it still holds that claim. So a repeat does nothing, and a try a newer answer overtook writes nothing.
// A failed try is tried again 3 minutes later, by this queue and by the kid's next look, at most 5 times.
import type { PoolClient } from "pg";
import { db, tx } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { recordSpend, type Trace } from "./budget.js";
import type { AnswerRow } from "./data.js";
import * as data from "./data.js";
import { DishModelError, models, newSpend, type Spend } from "./model.js";
import { flagged } from "./moderation.js";
import { due, momOver, saveTranslationIfCurrent, stateOf, translationHash } from "./pages.js";
import type { QuestionId } from "./recipe/types.js";
import { readFile } from "./uploads.js";
import {
  dayOf,
  HEAR_STALE_MS,
  HEAR_WAIT_MS,
  LIMITS_WORDS,
  MAX_MERGES,
  MERGE_STALE_MS,
  missRecipe,
  recipeTexts,
  type StoredRecipe,
  storedRecipe,
} from "./values.js";

type Heard = {
  answerId: string;
  questionId: QuestionId;
  audioKey: string;
  durationS: number;
  language: string;
  words: string | undefined;
  english: string | null | undefined;
  merged: boolean;
};

/** Convex could tell an unset field from null; here words null is unset, and english_settled says whether english is. */
const heard = (a: AnswerRow): Heard => ({
  answerId: a.id,
  questionId: a.question_id,
  audioKey: a.audio_key,
  durationS: a.duration_s,
  language: a.language,
  words: a.words ?? undefined,
  english: a.english_settled ? a.english : undefined,
  merged: a.merged,
});

const momBudgetLeft = async () => !momOver(await data.spentOn(db(), dayOf(Date.now())));

/** `a` as the database has it now. False when it's no longer the answer's clip. */
async function reread(a: Heard): Promise<boolean> {
  const row = await data.answerById(db(), a.answerId);
  if (row?.audio_key !== a.audioKey) return false;
  Object.assign(a, heard(row));
  return true;
}

/**
 * Ink writes her clip down, then Claude puts it in English when she spoke another language; each is saved as it lands, so a later try doesn't pay
 * for it again. Updates `a` in place to what's stored, which is what a merge must quote. "busy": someone else has this clip, or it was replaced.
 */
async function hearOne(a: Heard, spend: Spend): Promise<"ok" | "budget" | "missing" | "busy"> {
  if (a.words !== undefined && a.english !== undefined) return "ok";
  const claimedAt = new Date();
  const held = await data.claimHearing(db(), a.answerId, a.audioKey, claimedAt, HEAR_STALE_MS);
  if (!held) return (await reread(a)) && a.words !== undefined && a.english !== undefined ? "ok" : "busy";
  Object.assign(a, heard(held));
  try {
    if (a.words === undefined) {
      if (!(await momBudgetLeft())) return "budget";
      const file = await readFile(a.audioKey);
      if (!file) return "missing";
      const blob = new Blob([Buffer.from(file.bytes)], { type: file.contentType ?? "" });
      const words = (await models.transcribe(blob, a.language, a.durationS, spend)).trim().slice(0, LIMITS_WORDS);
      const saved = await data.saveWords(db(), a.answerId, a.audioKey, words, a.language === "en" || !words ? null : undefined);
      if (saved) Object.assign(a, heard(saved));
      else if (!(await reread(a))) return "busy";
    }
    if (a.english === undefined) {
      let english: string | null = null;
      if (a.words && a.language !== "en") {
        if (!(await momBudgetLeft())) return "budget";
        english = await models.toEnglish(a.words, spend);
      }
      const saved = await data.saveEnglish(db(), a.answerId, a.audioKey, english);
      if (saved) Object.assign(a, heard(saved));
      else if (!(await reread(a))) return "busy";
    }
    return "ok";
  } finally {
    await data.releaseHearing(db(), a.answerId, a.audioKey, claimedAt);
  }
}

/** Right after she answers: Ink writes it down (and Claude translates), so Send seldom waits on it. */
export async function hear(answerId: string, audioKey: string, trace: Trace): Promise<void> {
  const spend = newSpend(trace.log);
  let askId: string | null = null;
  try {
    const row = await data.answerById(db(), answerId);
    if (!row || row.audio_key !== audioKey) return;
    askId = row.ask_id;
    const r = await hearOne(heard(row), spend);
    if (r === "budget") trace.log.warn({ answerId }, "today's budget is spent; her clip is heard on a later day");
    if (r === "missing") trace.log.error({ answerId }, "a dish answer's clip is missing");
  } catch (error) {
    // The merge tries again.
    trace.log.warn({ answerId, err: { type: (error as Error).name } }, "hearing a dish answer failed");
  } finally {
    await recordSpend(spend, askId, trace);
  }
}

/** Takes the next merge try when one is due (with her answers as they are now); null when none is. */
export async function claimMerge(askId: string) {
  return await tx(async (c) => {
    const row = await data.cardById(c, askId, true);
    if (!row) return null;
    const now = Date.now();
    const s = await stateOf(c, row, now);
    if (!due(s)) return null;
    const claimedAt = new Date(now);
    // The message has done its job: an answer that comes after this needs one of its own, straight away.
    await data.patchCard(c, askId, { merge_tries: row.merge_tries + 1, merge_started_at: claimedAt, merge_queued_at: null });
    return {
      claimedAt,
      tries: row.merge_tries + 1,
      guess: row.guess,
      relation: row.relation,
      asked: row.asked,
      hasVersion: !!row.version,
      answers: s.answers.map(heard),
    };
  });
}

/** "Mom answered", to the kid in the app (messages/pushEvents.ts). It dedupes on her version's time, else her Send's, so a repeat sends nothing. */
const answered = (c: Pick<PoolClient, "query">, askId: string, requestId?: string) =>
  enqueue(c, { queue: "scheduled", payload: { task: "push.dish_answered", askId }, requestId });

/**
 * Ends a try that isn't running anymore, while it still holds the merge. `giveBack`: it didn't really try (a key isn't set, or today's
 * budget ran out), so the try doesn't count. Else it was the last try and it failed: the kid's card and Mom's page stop waiting at once.
 */
async function releaseMerge(askId: string, claimedAt: Date, giveBack: boolean, requestId?: string): Promise<void> {
  await tx(async (c) => {
    const row = await data.cardById(c, askId, true);
    if (row?.merge_started_at?.getTime() === claimedAt.getTime()) {
      await data.patchCard(c, askId, { merge_started_at: null, ...(giveBack ? { merge_tries: Math.max(0, row.merge_tries - 1) } : {}) });
      // No version is coming: her clips go to the kid as they are (V2-LINKING.md §1.4).
      if (!giveBack) await answered(c, askId, requestId);
    }
  });
}

/** Writes her version, only while the try that started at `claimedAt` still holds the merge. */
export async function saveVersion(askId: string, claimedAt: Date, version: StoredRecipe, audioKeys: string[], requestId?: string): Promise<boolean> {
  return await tx(async (c) => {
    const row = await data.cardById(c, askId, true);
    if (row?.merge_started_at?.getTime() !== claimedAt.getTime()) return false;
    await data.patchCard(c, askId, { version, status: "answered", merged_at: new Date() });
    await data.markAnswersMerged(c, askId, audioKeys);
    await answered(c, askId, requestId);
    return true;
  });
}

/**
 * Mom's page in another language: her version is translated before it's saved, so the fill-in shows it in her language from the start.
 * Mom-side budget; a failure leaves the page's version in English (peek can try again).
 */
async function versionInPageLang(askId: string, version: StoredRecipe, spend: Spend): Promise<void> {
  const row = await data.cardById(db(), askId);
  const lang = row?.mom_page_lang;
  if (!row || !lang || lang === "en" || !(await momBudgetLeft())) return;
  const out = await models.translateForMom(
    { guess: missRecipe(row.guess), questions: row.asked, message: row.message, version: missRecipe(version) },
    lang,
    spend,
    TRY.translate,
  );
  if (!out?.version) return;
  const translated = {
    guess: storedRecipe(out.guess),
    questions: out.questions.map((q) => ({ id: q.id, text: q.text })),
    message: out.message,
    version: storedRecipe(out.version),
  };
  if (flagged(...recipeTexts(translated.guess), ...recipeTexts(translated.version), translated.message)) return;
  await saveTranslationIfCurrent(askId, lang, translationHash({ ...row, version }), translated, version);
}

/**
 * How a try stays under MERGE_STALE_MS and SQS's 300 s visibility, even with 6 unheard clips (six times CLIP_WORST_MS wouldn't). Past hearMs it stops
 * hearing, gives the try back and queues itself: what it heard is saved, so the next one goes on from there. So it's at most hearMs plus one clip's worst
 * case, or hearMs, her version (60 s) and the page's translation (45 s, no retry). A test holds the sum.
 */
export const TRY = { hearMs: 45_000, translate: { timeoutMs: 45_000, retries: 0 } };

/**
 * One merge try. Mom's version is rebuilt from the guess with all of her answers: Ink writes down the clips with no words yet, Claude
 * translates, then Claude writes her version from all her words, and the word filter reads it. It is all her answers or nothing: a version
 * without one would hide it from the kid. A failure is logged and tried again 3 minutes later (her answers stay saved), up to 5 tries.
 */
export async function merge(askId: string, trace: Trace): Promise<void> {
  const claim = await claimMerge(askId);
  if (!claim) return;
  const tag = { askId, try: claim.tries, of: MAX_MERGES };
  const spend = newSpend(trace.log);
  const started = Date.now();
  const release = (giveBack = true) => releaseMerge(askId, claim.claimedAt, giveBack, trace.requestId);
  /** The next try 3 minutes on; after the last one, nothing more is coming. */
  const retry = async () => {
    if (claim.tries < MAX_MERGES) {
      const sendAfter = new Date(Date.now() + MERGE_STALE_MS + 1000);
      await enqueue(db(), { queue: "scheduled", payload: { task: "dish.merge", askId }, requestId: trace.requestId, sendAfter });
    } else await release(false);
  };
  const overBudget = async () => {
    trace.log.warn(tag, "today's budget is spent; the kid's next look on a later day starts the merge again");
    await release();
  };
  /** Not a real try: give it back, and look again. */
  const again = async (afterMs: number) => {
    await release();
    const sendAfter = new Date(Date.now() + afterMs);
    await enqueue(db(), { queue: "scheduled", payload: { task: "dish.merge", askId }, requestId: trace.requestId, sendAfter });
  };
  try {
    for (const a of claim.answers) {
      const unheard = a.words === undefined || a.english === undefined;
      const r = await hearOne(a, spend);
      if (r === "budget") return await overBudget();
      if (r === "missing") throw new Error("a clip is missing");
      if (r === "busy") return await again(HEAR_WAIT_MS);
      if (unheard && Date.now() - started > TRY.hearMs) return await again(0);
    }
    const audioKeys = claim.answers.map((a) => a.audioKey);
    if (claim.hasVersion && !claim.answers.some((a) => !a.merged && a.words)) {
      await data.markAnswersMerged(db(), askId, audioKeys);
      trace.log.info(tag, "no speech in her new clips");
      return;
    }
    const spoken = claim.answers.flatMap((a) => (a.words ? [{ id: a.questionId, words: a.words, english: a.english ?? null }] : []));
    if (!spoken.length) {
      trace.log.info(tag, "no speech in her clips");
      await answered(db(), askId, trace.requestId); // her clips go to the kid as they are
      return;
    }
    if (!(await momBudgetLeft())) return await overBudget();
    const version = storedRecipe(await models.writeVersion({ draft: missRecipe(claim.guess), relation: claim.relation, asked: claim.asked, answers: spoken }, spend));
    if (flagged(...recipeTexts(version))) throw new Error("her version has a filtered word");
    await versionInPageLang(askId, version, spend);
    if (!(await saveVersion(askId, claim.claimedAt, version, audioKeys, trace.requestId))) {
      trace.log.info(tag, "a newer try has her later answers; this one is dropped");
      return;
    }
    trace.log.info({ ...tag, ms: Date.now() - started }, "dish merge done");
  } catch (error) {
    trace.log.error({ ...tag, err: { type: (error as Error).name } }, "dish merge failed");
    if (error instanceof DishModelError && error.kind === "not_set_up") await release();
    else await retry();
  } finally {
    await recordSpend(spend, askId, trace);
  }
}
