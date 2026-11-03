// A kid's question while cooking (Convex's questions.ts, followUps.ts and transcribe.ts). The voice service records it, then the video answered it (Moss found the
// moment) or it goes to the cook, who answers by text or voice note. A "share" ask and the pipeline's own follow-up questions reach her the same way.
//
// Reading her yes writes `recipes`, which moves later: recipeEffects is where that plugs in (docs/build/MESSAGES-MIGRATION.md, blockers). The question row records
// what was read either way, so nothing is lost and the recipes area can apply old answers when it moves. A share's yes goes through storyCards.shareOn, behind the switch.
//
// SQL, with its index:
//   A recipe's questions               questions_recipe_recent
//   Questions waiting on a cook        questions_family_status_recent
//   One follow-up per recipe and id    questions_one_follow_up
import type { Signed } from "../../auth.js";
import { db, tx, type Queryable } from "../../db.js";
import { forbidden, invalid, notFound, refused } from "../../errors.js";
import { once, requestHash } from "../../idempotency.js";
import { enqueue } from "../../outbox.js";
import { objectStore } from "../../storage.js";
import type { Trace } from "../dish/budget.js";
import { memberById, type Member } from "../people/family.js";
import { familyRecipe, recipeFor, recipesByIds, type RecipeBrief } from "../recipes/read.js";
import { iso } from "./data.js";
import { models, type YesNo } from "./models.js";
import { actorOf, type Write } from "./actor.js";
import { shareOnYes } from "./storyCards.js";
import { attachFile } from "./uploads.js";
import { decodeCursor, encodeCursor, isRowId, MAX_BODY, noSuchRecipe, number, pageSize, text, WRITE_SOMETHING } from "./values.js";
import { readLinks } from "./views.js";

export type QuestionRow = {
  id: string;
  family_id: string;
  recipe_id: string;
  step_order: number | null;
  asked_by: string;
  text: string;
  text_for_cook: string | null;
  kind: "cooking" | "share" | "follow_up";
  follow_up_id: string | null;
  follow_up_ingredient: string | null;
  follow_up_said: YesNo | null;
  share_said: YesNo | null;
  share_decided_at: string | null;
  status: "found_in_video" | "asked_cook" | "answered";
  found_start_s: number | null;
  found_end_s: number | null;
  found_quote: string | null;
  answer_by: string | null;
  answer_text: string | null;
  answer_audio_key: string | null;
  answer_transcript: string | null;
  answer_translation: string | null;
  answered_at: string | null;
  created_at: string;
};

const COLUMNS = `id, family_id, recipe_id, step_order, asked_by, text, text_for_cook, kind, follow_up_id, follow_up_ingredient, follow_up_said, share_said,
  ${iso("share_decided_at")} as share_decided_at, status, found_start_s, found_end_s, found_quote, answer_by, answer_text, answer_audio_key, answer_transcript,
  answer_translation, ${iso("answered_at")} as answered_at, ${iso("created_at")} as created_at`;

export const YES_NO_QUESTION = "May homie put your recipe on the neighborhood map?";
const MAX_SAID = 300;

/**
 * Where a clear yes reaches `recipes`, in the settle's transaction, and a test can watch them. An ingredient does nothing until those writes move here (blockers). A share
 * puts the recipe on the map and queues its story card, and does nothing either while writes are off.
 */
export const recipeEffects = {
  ingredientYes: async (_c: Queryable, _yes: { recipeId: string; name: string; said: string | null; step: number | null; questionId: string }): Promise<void> => {},
  shareYes: (c: Queryable, yes: { recipeId: string; familyId: string }, requestId?: string): Promise<void> => shareOnYes(c, yes, requestId),
};

async function questionById(q: Queryable, id: string): Promise<QuestionRow | null> {
  const { rows } = await q.query(`select ${COLUMNS} from questions where id = $1`, [id]);
  return rows[0] ?? null;
}

async function views(rows: QuestionRow[], everyone: Member[], recipes: Map<string, RecipeBrief>) {
  const links = await readLinks(rows.map((q) => q.answer_audio_key));
  const names = new Map(everyone.map((p) => [p.id, p.name]));
  return rows.map((q) => ({
    id: q.id,
    familyId: q.family_id,
    recipeId: q.recipe_id,
    stepOrder: q.step_order,
    askedBy: q.asked_by,
    text: q.text,
    textForCook: q.text_for_cook,
    kind: q.kind === "follow_up" ? "followUp" : q.kind,
    status: q.status,
    found: q.found_quote !== null ? { startS: q.found_start_s, endS: q.found_end_s, quote: q.found_quote } : null,
    followUp: q.follow_up_id ? { id: q.follow_up_id, ingredient: q.follow_up_ingredient, said: q.follow_up_said } : null,
    shareDecision: q.share_said ? { said: q.share_said, at: q.share_decided_at } : null,
    answer: q.answer_by ? { by: q.answer_by, text: q.answer_text, transcript: q.answer_transcript, translation: q.answer_translation, at: q.answered_at } : null,
    answerAudioUrl: q.answer_audio_key ? links.get(q.answer_audio_key) ?? null : null,
    recipeTitle: recipes.get(q.recipe_id)?.title ?? "",
    askedByName: q.kind === "follow_up" ? "homie" : names.get(q.asked_by) ?? "",
    createdAt: q.created_at,
  }));
}

const PAGE = { default: 100, max: 100 };

/** questions.forRecipe. A share ask isn't about cooking: cook mode never plays its answer. A recipe that isn't ready lists nothing but to its cook, like a missing one. */
export async function forRecipe(signed: Signed, recipeId: string, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const recipe = isRowId(recipeId) ? await recipeFor(db(), actor.familyId, actor.me.id, recipeId) : null;
  if (!recipe) return { questions: [], nextCursor: null };
  const limit = pageSize(query.limit, PAGE);
  const cursor = decodeCursor(query.cursor);
  const { rows } = await db().query(
    `select ${COLUMNS} from questions
      where recipe_id = $1 and kind <> 'share' ${cursor ? "and (questions.created_at, id) < ($3::timestamptz, $4)" : ""}
      order by questions.created_at desc, id desc limit $2`,
    cursor ? [recipe.id, limit, cursor.at, cursor.id] : [recipe.id, limit],
  );
  const end = rows.at(-1);
  return {
    questions: await views(rows, actor.everyone, new Map([[recipe.id, recipe]])),
    nextCursor: rows.length === limit && end ? encodeCursor(end.created_at, end.id) : null,
  };
}

/** questions.openForCook: the ones about recipes this cook cooked. A page can come back short; nextCursor says there's more to look through. */
export async function openForCook(signed: Signed, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  if (actor.me.role !== "cook") return { questions: [], nextCursor: null };
  const limit = pageSize(query.limit, PAGE);
  const cursor = decodeCursor(query.cursor);
  const { rows } = await db().query(
    `select ${COLUMNS} from questions
      where family_id = $1 and status = 'asked_cook' ${cursor ? "and (questions.created_at, id) < ($3::timestamptz, $4)" : ""}
      order by questions.created_at desc, id desc limit $2`,
    cursor ? [actor.familyId, limit, cursor.at, cursor.id] : [actor.familyId, limit],
  );
  const recipes = new Map((await recipesByIds(db(), [...new Set(rows.map((q: QuestionRow) => q.recipe_id))])).map((r) => [r.id, r]));
  const mine = rows.filter((q: QuestionRow) => recipes.get(q.recipe_id)?.cook_id === actor.me.id);
  const end = rows.at(-1);
  return { questions: await views(mine, actor.everyone, recipes), nextCursor: rows.length === limit && end ? encodeCursor(end.created_at, end.id) : null };
}

const after = (c: Queryable, payload: { task: string; questionId: string; language?: string }, requestId?: string) =>
  enqueue(c, { queue: "scheduled", payload, requestId });

const ASK_FIELDS = ["recipeId", "stepOrder", "text", "found"];

/** From the voice service (Convex's /voice/question), with the kid's own session. Cook mode needs a finished recipe, so one that isn't ready is no recipe, to its cook too. */
export async function ask(signed: Signed, body: Record<string, unknown>, w: Write) {
  const actor = await actorOf(signed);
  const words = text(body.text, "text", MAX_BODY);
  if (!words) throw invalid("text", WRITE_SOMETHING);
  const stepOrder = number(body.stepOrder, "stepOrder", { int: true });
  let found: { startS: number; endS: number; quote: string } | null = null;
  if (body.found !== undefined && body.found !== null) {
    const f = body.found as Record<string, unknown>;
    if (typeof f !== "object" || typeof f.startS !== "number" || typeof f.endS !== "number" || typeof f.quote !== "string") throw invalid("found");
    found = { startS: f.startS, endS: f.endS, quote: f.quote.slice(0, MAX_BODY) };
  }
  const recipe = isRowId(body.recipeId) ? await recipeFor(db(), actor.familyId, actor.me.id, body.recipeId, { readyOnly: true }) : null;
  if (!recipe) throw noSuchRecipe();
  const status = found ? "found_in_video" : "asked_cook";
  const cook = await memberById(db(), recipe.cook_id);
  const { resourceId } = await once(
    { scope: actor.me.id, key: w.key, route: "POST /v1/questions", hash: requestHash(ASK_FIELDS.map((f) => body[f])), statusCode: 201 },
    async (c) => {
      const { rows } = await c.query(
        `insert into questions (family_id, recipe_id, step_order, asked_by, text, status, found_start_s, found_end_s, found_quote)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [actor.familyId, recipe.id, stepOrder, actor.me.id, words, status, found?.startS ?? null, found?.endS ?? null, found?.quote ?? null],
      );
      const id: string = rows[0].id;
      if (status === "asked_cook" && cook?.language && cook.language !== "en") {
        await after(c, { task: "questions.translate", questionId: id, language: cook.language }, w.requestId);
      }
      return id;
    },
  );
  return { questionId: resourceId, status };
}

const ANSWER_FIELDS = ["text", "audioKey"];

export async function answer(signed: Signed, questionId: string, body: Record<string, unknown>, w: Write) {
  const actor = await actorOf(signed);
  if (actor.me.role !== "cook") throw forbidden();
  const words = text(body.text, "text", MAX_BODY);
  const audioKey = typeof body.audioKey === "string" && body.audioKey ? body.audioKey : null;
  if (!isRowId(questionId)) throw notFound();
  await once(
    { scope: actor.me.id, key: w.key, route: "POST /v1/questions/:id/answer", hash: requestHash([questionId, ANSWER_FIELDS.map((f) => body[f])]) },
    async (c) => {
      const { rows } = await c.query(`select ${COLUMNS} from questions where id = $1 and family_id = $2 for update`, [questionId, actor.familyId]);
      const q: QuestionRow | undefined = rows[0];
      // A question about a recipe this cook can't see is no question.
      const recipe = q ? await recipeFor(c, actor.familyId, actor.me.id, q.recipe_id) : null;
      if (!q || !recipe) throw notFound();
      if (q.status !== "asked_cook") throw refused(409, "answered", "That question already has an answer.");
      // Sharing a recipe, or saying what went into it, is its cook's answer alone, not any cook's in the family.
      if (q.kind !== "cooking" && recipe.cook_id !== actor.me.id) throw forbidden("Only the recipe's cook can answer this.");
      if (!words && !audioKey) throw invalid(undefined, "Say or type an answer first.");
      if (audioKey) await attachFile(c, actor, audioKey, ["voice"]);
      await c.query(
        `update questions set status = 'answered', answer_by = $2, answer_text = $3, answer_audio_key = $4, answered_at = now() where id = $1`,
        [questionId, actor.me.id, words, audioKey],
      );
      if (audioKey) await after(c, { task: "questions.transcribe", questionId }, w.requestId);
      // A typed yes is read now; a voice note once its transcript is in.
      else if (q.kind === "share") await after(c, { task: "questions.read_share", questionId }, w.requestId);
      else if (q.follow_up_ingredient) await after(c, { task: "questions.read_follow_up", questionId }, w.requestId);
      return questionId;
    },
  );
  return { ok: true };
}

export type FollowUp = { id: string; question: string; step?: number; ingredient?: string };

/** Each follow-up she hasn't been asked yet (by its recipe.json id) becomes her open question. The worker calls this when a recipe is published. */
export async function askFollowUps(c: Queryable, to: { recipeId: string; familyId: string; cookId: string; cookLanguage: string | null }, followUps: FollowUp[], requestId?: string): Promise<void> {
  for (const f of followUps) {
    const { rows } = await c.query(
      `insert into questions (family_id, recipe_id, step_order, asked_by, text, kind, follow_up_id, follow_up_ingredient, status)
       values ($1, $2, $3, $4, $5, 'follow_up', $6, $7, 'asked_cook')
       on conflict (recipe_id, follow_up_id) where follow_up_id is not null do nothing returning id`,
      [to.familyId, to.recipeId, f.step ?? null, to.cookId, f.question, f.id, f.ingredient ?? null],
    );
    if (rows[0] && to.cookLanguage && to.cookLanguage !== "en") {
      await after(c, { task: "questions.translate", questionId: rows[0].id, language: to.cookLanguage }, requestId);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The long work. Every one can arrive twice, and one for a question that's gone does nothing.

/** The kid's question in the cook's language. On any failure it stays English only: it's a nicety, and she can still read it. */
export async function translateTask(questionId: string, language: string, trace: Trace): Promise<void> {
  const q = await questionById(db(), questionId);
  if (!q || q.text_for_cook) return;
  try {
    const out = (await models.translateForCook(q.text, language)).slice(0, MAX_BODY);
    await db().query(`update questions set text_for_cook = $2 where id = $1 and text_for_cook is null`, [questionId, out]);
  } catch (error) {
    trace.log.error({ task: "questions.translate", err: { type: (error as Error).name } }, "a question stayed in English");
  }
}

/** Ink writes her voice note out in her own language, with the English beside it. A note nobody could write out still gets read: no words is not a yes. */
export async function transcribeTask(questionId: string, trace: Trace): Promise<void> {
  const q = await questionById(db(), questionId);
  if (!q?.answer_audio_key || !q.answer_by) return;
  const key = q.answer_audio_key;
  const claim = await db().query(
    `update questions set answer_transcribing_at = now()
      where id = $1 and answer_audio_key = $2 and answer_transcript is null and (answer_transcribing_at is null or answer_transcribing_at < now() - interval '4 minutes')`,
    [questionId, key],
  );
  if (!claim.rowCount) return;
  let transcript = "";
  let translation: string | null = null;
  try {
    const stored = await objectStore().read(key);
    if (stored) {
      const language = (await memberById(db(), q.answer_by))?.language ?? "en";
      transcript = await models.transcribe(stored.bytes, stored.contentType, language);
      if (transcript && language !== "en") translation = await models.toEnglish(transcript);
    }
  } catch (error) {
    trace.log.error({ task: "questions.transcribe", err: { type: (error as Error).name } }, "a voice answer wasn't written out");
  }
  // The words and what reads them land together: a crash before this runs it all again after the holder's 4 minutes, and one after it has nothing left to do.
  await tx(async (c) => {
    // Only if the answer is still that voice note.
    if (transcript) await c.query(`update questions set answer_transcript = $3, answer_translation = $4 where id = $1 and answer_audio_key = $2`, [questionId, key, transcript, translation]);
    if (q.kind === "share") await after(c, { task: "questions.read_share", questionId }, trace.requestId);
    else if (q.follow_up_ingredient) await after(c, { task: "questions.read_follow_up", questionId }, trace.requestId);
  });
}

const answerWords = (q: QuestionRow) => (q.answer_translation ?? q.answer_transcript ?? q.answer_text ?? "").trim();

/** Only a clear yes counts. No words, a failed read or no key are all unclear. */
async function readAnswer(question: string, words: string, trace: Trace): Promise<YesNo> {
  if (!words) return "unclear";
  try {
    return await models.yesNo(question, words);
  } catch (error) {
    trace.log.error({ task: "questions.read", err: { type: (error as Error).name } }, "an answer couldn't be read");
    return "unclear";
  }
}

/** After her answer is in. A yes from the recipe's own cook adds the ingredient, with her words for how much. Noted once. */
export async function readFollowUp(questionId: string, trace: Trace): Promise<void> {
  const q = await questionById(db(), questionId);
  const ingredient = q?.follow_up_ingredient;
  if (!q || q.kind !== "follow_up" || !ingredient || q.status !== "answered" || q.follow_up_said) return;
  const words = answerWords(q);
  const said = await readAnswer(`Did you add ${ingredient} to this dish?`, words, trace);
  await tx(async (c) => {
    const { rowCount } = await c.query(`update questions set follow_up_said = $2 where id = $1 and follow_up_said is null and status = 'answered'`, [questionId, said]);
    if (!rowCount || said !== "yes") return;
    const recipe = await familyRecipe(c, q.family_id, q.recipe_id);
    if (!recipe || q.answer_by !== recipe.cook_id) return;
    await recipeEffects.ingredientYes(c, { recipeId: recipe.id, name: ingredient, said: words.slice(0, MAX_SAID) || null, step: q.step_order, questionId });
  });
}

/** After her answer to a share ask. Only a clear yes from her, about her own ready recipe, shares it. */
export async function readShare(questionId: string, trace: Trace): Promise<void> {
  const q = await questionById(db(), questionId);
  if (!q || q.kind !== "share" || q.status !== "answered" || q.share_said) return;
  const said = await readAnswer(YES_NO_QUESTION, answerWords(q), trace);
  await tx(async (c) => {
    const { rowCount } = await c.query(`update questions set share_said = $2, share_decided_at = now() where id = $1 and share_said is null and status = 'answered'`, [questionId, said]);
    if (!rowCount || said !== "yes") return;
    const recipe = await familyRecipe(c, q.family_id, q.recipe_id);
    if (!recipe || recipe.status !== "ready" || q.answer_by !== recipe.cook_id) return;
    await recipeEffects.shareYes(c, { recipeId: recipe.id, familyId: recipe.family_id }, trace.requestId);
  });
}
