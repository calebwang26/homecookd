// Her words and her version, after the reply (convex/dishAsks.ts hear and merge). Both run from the `scheduled` queue, so either can arrive
// twice. Safe to repeat:
// - hear saves words only while the clip is still the answer's, and skips what's already heard.
// - merge takes a claim first (mergeTries and mergeStartedAt together, only while none started in the last 3 minutes) and writes her
//   version only while it still holds that claim. So a repeat does nothing, and a try a newer answer overtook writes nothing.
// A failed try is tried again 3 minutes later, by this queue and by the kid's next look, at most 5 times.
import { db, tx } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { recordSpend, type Trace } from "./budget.js";
import type { AnswerRow } from "./data.js";
import * as data from "./data.js";
import { DishModelError, models, newSpend, type Spend } from "./model.js";
import { flagged } from "./moderation.js";
import { due, momOver, stateOf, translationHash } from "./pages.js";
import type { QuestionId } from "./recipe/types.js";
import { readFile } from "./uploads.js";
import { dayOf, LIMITS_WORDS, MAX_MERGES, MERGE_STALE_MS, missRecipe, recipeTexts, type StoredRecipe, storedRecipe } from "./values.js";

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

/**
 * Ink writes her clip down, then Claude puts it in English when she spoke another language; each is saved as it lands, so a later try
 * doesn't pay for it again. Updates `a` in place.
 */
async function hearOne(a: Heard, spend: Spend): Promise<"ok" | "budget" | "missing"> {
  if (a.words === undefined) {
    if (!(await momBudgetLeft())) return "budget";
    const file = await readFile(a.audioKey);
    if (!file) return "missing";
    const blob = new Blob([Buffer.from(file.bytes)], { type: file.contentType ?? "" });
    a.words = (await models.transcribe(blob, a.language, a.durationS, spend)).trim().slice(0, LIMITS_WORDS);
    if (a.language === "en" || !a.words) a.english = null;
    await data.setAnswerWords(db(), a.answerId, a.audioKey, { words: a.words, english: a.english });
  }
  if (a.english === undefined) {
    if (a.words && a.language !== "en") {
      if (!(await momBudgetLeft())) return "budget";
      a.english = await models.toEnglish(a.words, spend);
    } else a.english = null;
    await data.setAnswerWords(db(), a.answerId, a.audioKey, { english: a.english });
  }
  return "ok";
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
    await data.patchCard(c, askId, { merge_tries: row.merge_tries + 1, merge_started_at: claimedAt });
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

/**
 * Ends a try that isn't running anymore, while it still holds the merge. `giveBack`: it didn't really try (a key isn't set, or today's
 * budget ran out), so the try doesn't count. Else it was the last try and it failed: the kid's card and Mom's page stop waiting at once.
 */
async function releaseMerge(askId: string, claimedAt: Date, giveBack: boolean): Promise<void> {
  await tx(async (c) => {
    const row = await data.cardById(c, askId, true);
    if (row?.merge_started_at?.getTime() === claimedAt.getTime()) {
      await data.patchCard(c, askId, { merge_started_at: null, ...(giveBack ? { merge_tries: Math.max(0, row.merge_tries - 1) } : {}) });
    }
  });
}

/** Writes her version, only while the try that started at `claimedAt` still holds the merge. */
export async function saveVersion(askId: string, claimedAt: Date, version: StoredRecipe, audioKeys: string[]): Promise<boolean> {
  return await tx(async (c) => {
    const row = await data.cardById(c, askId, true);
    if (row?.merge_started_at?.getTime() !== claimedAt.getTime()) return false;
    await data.patchCard(c, askId, { version, status: "answered", merged_at: new Date() });
    await data.markAnswersMerged(c, askId, audioKeys);
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
  );
  if (!out?.version) return;
  const translated = {
    guess: storedRecipe(out.guess),
    questions: out.questions.map((q) => ({ id: q.id, text: q.text })),
    message: out.message,
    version: storedRecipe(out.version),
  };
  if (flagged(...recipeTexts(translated.guess), ...recipeTexts(translated.version), translated.message)) return;
  await data.saveTranslation(db(), { askId, lang, sourceHash: translationHash({ ...row, version }), ...translated });
}

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
  const release = (giveBack = true) => releaseMerge(askId, claim.claimedAt, giveBack);
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
  try {
    for (const a of claim.answers) {
      const r = await hearOne(a, spend);
      if (r === "budget") return await overBudget();
      if (r === "missing") throw new Error("a clip is missing");
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
      return;
    }
    if (!(await momBudgetLeft())) return await overBudget();
    const version = storedRecipe(await models.writeVersion({ draft: missRecipe(claim.guess), relation: claim.relation, asked: claim.asked, answers: spoken }, spend));
    if (flagged(...recipeTexts(version))) throw new Error("her version has a filtered word");
    await versionInPageLang(askId, version, spend);
    if (!(await saveVersion(askId, claim.claimedAt, version, audioKeys))) {
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
