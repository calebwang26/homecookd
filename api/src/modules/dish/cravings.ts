// Cravings' signed-in side (convex/cravings.ts, DISH-ASK-SPEC.md §8, PRD-V2 Phase 5): a parent in the app asks her kids what they miss from home. She shares her craving link;
// a kid names a dish with no account, and the card is a request to her (card-making is routes.ts's). She sees her requests here, says which day she'll film it, or tells the
// kid how she makes it by voice: one answer, merged into her version at once, as Mom's Send on the web is. A craving card never joins anyone to her family.
import { randomUUID } from "node:crypto";
import type { Signed } from "../../auth.js";
import { db, tx, type Queryable } from "../../db.js";
import { notFound, refused } from "../../errors.js";
import { afterCursor, pageOf } from "../../paging.js";
import { objectStore } from "../../storage.js";
import { peopleByIds } from "../people/service.js";
import type { Trace } from "./budget.js";
import * as cravingData from "./cravingData.js";
import type { AskedRow } from "./cravingData.js";
import type { AnswerRow } from "./data.js";
import * as data from "./data.js";
import { flagged } from "./moderation.js";
import { fresh, stateOf } from "./pages.js";
import type { QuestionId } from "./recipe/types.js";
import { OWN_IDS } from "./recipe/validate.js";
import { mergeLater } from "./service.js";
import { checkUpload, confirmUpload, readLink } from "./uploads.js";
import { CLIP_SLACK_S, DishFail, fail, LANGS, MAX_CLIP_S, MAX_MERGES, randomBase62, sha256Hex, webOrigin, WORDS } from "./values.js";

export const DEFAULT_CRAVING_MESSAGE = "What do you miss from home? Tell me and I'll make it for you.";
export const CRAVING_MESSAGE_CHARS = 300;
/** TODO(caleb): cards one link may make in all; then createLink makes her a new one. */
export const CRAVING_TOTAL = 20;
/** What her voice recipe answers: one question, among the kid's own ids (q4–q6). */
export const VOICE_RECIPE_QUESTION = "How do you make it?";
/** Her requests, newest first. */
const ASKS_PAGE = 50;
const NOT_FOUND = "Not found.";

const cravingUrl = (token: string) => `${webOrigin()}/miss?c=${token}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// ---------------------------------------------------------------------------------------------
// Her link

function messageOf(raw: string): string {
  const line = raw.trim();
  if (!line || line.length > CRAVING_MESSAGE_CHARS) throw refused(400, "bad_request", `Your message must be 1 to ${CRAVING_MESSAGE_CHARS} characters.`);
  if (flagged(line)) throw refused(422, "words", WORDS);
  return line;
}

/** Her craving link: her one live link, reused (a new `message` replaces its line). A new one is made when she has none, stopped it, or it made CRAVING_TOTAL cards. */
export async function createLink(signed: Signed, message?: string): Promise<{ url: string }> {
  const line = message === undefined ? undefined : messageOf(message);
  return await tx(async (c) => {
    await cravingData.lockLinksOf(c, signed.personId);
    const live = await cravingData.newestLink(c, signed.personId);
    if (live && live.revoked_at === null && live.uses < CRAVING_TOTAL) {
      if (line !== undefined && line !== live.message) await cravingData.setLinkMessage(c, live.id, line);
      return { url: cravingUrl(live.token) };
    }
    const token = randomBase62();
    await cravingData.insertLink(c, { familyId: signed.familyId, personId: signed.personId, token, message: line ?? DEFAULT_CRAVING_MESSAGE });
    return { url: cravingUrl(token) };
  });
}

/** "Stop this link": her live link makes no new cards (the ones it made stay); her next createLink makes a new one. */
export async function revokeLink(signed: Signed): Promise<void> {
  const link = await cravingData.newestLink(db(), signed.personId);
  if (link) await cravingData.revokeLink(db(), link.id);
}

// ---------------------------------------------------------------------------------------------
// Her requests (the cards asked of her)

/** convex/dishAsks.ts voiceRecipeOf: being written, ready, or failed (she can send again); null before one. */
function voiceRecipeOf(row: AskedRow, answers: AnswerRow[]): "writing" | "ready" | "failed" | null {
  const a = row.voice_recipe_q && answers.find((x) => x.question_id === row.voice_recipe_q);
  if (!a) return null;
  if (a.words === "") return "failed";
  if (a.merged) return row.version ? "ready" : "failed";
  return row.merge_tries >= MAX_MERGES && row.merge_started_at === null ? "failed" : "writing";
}

async function cravingAsk(row: AskedRow, answers: AnswerRow[]) {
  return {
    id: row.id,
    kidName: row.kid_name ?? "", // "" when the kid deleted their account
    dish: row.guess.dish,
    guess: row.guess.ingredients.map((i) => ({ amount: i.amount, name: i.name })),
    kidVoiceUrl: row.kid_voice_note_key ? await readLink(row.kid_voice_note_key) : null,
    photoUrl: row.photo_keys.length ? await readLink(row.photo_keys[0]) : null,
    message: row.message,
    createdAt: row.created_at.getTime(),
    answered: !!row.version,
    voiceRecipe: voiceRecipeOf(row, answers),
    filmingDay: row.filming_day,
  };
}

/** The cards made of her (from her craving link, or a web ask she claimed), newest first, answered and not. */
export async function forCook(signed: Signed, cursor?: string) {
  const { rows, nextCursor } = pageOf(await cravingData.askedOf(db(), signed.personId, afterCursor(cursor), ASKS_PAGE + 1), ASKS_PAGE);
  const answers = await cravingData.answersOfCards(db(), rows.map((r) => r.id));
  return { asks: await Promise.all(rows.map((row) => cravingAsk(row, answers.get(row.id) ?? []))), nextCursor };
}

/** One of her requests (the push opens /request/<id>). */
export async function getAsk(signed: Signed, id: string) {
  const row = await cravingData.askById(db(), id);
  if (!row || row.requested_of !== signed.personId) throw notFound();
  return await cravingAsk(row, await data.answersOf(db(), row.id));
}

/**
 * A card she may act on. Another family's, or none, is the one not-found. Her family's that was asked of someone else names who can: the family knows that much.
 */
async function askedOfMe(c: Queryable, signed: Signed, id: string, only: (name: string) => string, lock: boolean): Promise<AskedRow> {
  const row = await cravingData.askById(c, id, lock);
  if (!row || (row.requested_of !== signed.personId && row.family_id !== signed.familyId)) throw notFound(NOT_FOUND);
  if (row.requested_of !== signed.personId) {
    const them = row.requested_of ? (await peopleByIds(c, [row.requested_of])).get(row.requested_of) : null;
    throw refused(403, "not_asked_of_you", only(them && !them.deleted_at ? firstName(them.name) : "the person it was asked of"));
  }
  return row;
}

/** The day she plans to film it, 0 (Sunday) to 6; null clears it. The kid's card shows it. */
export async function setFilmingDay(signed: Signed, id: string, day: unknown): Promise<void> {
  await tx(async (c) => {
    const row = await askedOfMe(c, signed, id, (name) => `Only ${name} can pick the day.`, true);
    if (day !== null && !(typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)) throw refused(400, "bad_request", "Pick a day of the week.");
    await data.patchCard(c, row.id, { filming_day: day });
  });
}

// ---------------------------------------------------------------------------------------------
// "Tell him how you make it now": her voice recipe

/** Her upload link, for this card. The type and size are checked before anything exists, so there's no recording to delete on a refusal. */
export async function requestVoiceUpload(signed: Signed, id: string, contentType: unknown, size: unknown) {
  await askedOfMe(db(), signed, id, (name) => `Only ${name} can answer this one.`, false);
  const { type, bytes } = checkUpload("clip", contentType, size);
  const key = `private/dish/${randomUUID()}`;
  await cravingData.insertClip(db(), { key, contentType: type, size: bytes, capabilityHash: sha256Hex(randomBase62()), familyId: signed.familyId, personId: signed.personId, askId: id });
  const link = await objectStore().presignPut(key, type, bytes).catch((error) => {
    throw Object.assign(fail(502, "storage", "Something went wrong on our side. Please try again."), { cause: error });
  });
  return { audioKey: key, contentType: type, size: bytes, uploadUrl: link.url, uploadHeaders: link.headers, expiresInS: link.expiresInS };
}

/**
 * S3 has her bytes: from here files.ts's guard will take the key. Runs before that guard, and touches only her own unconfirmed clip for this card, so anyone else's key
 * passes through to the guard's plain not-found. A recording that isn't what its link was for is deleted and refused, as Convex's is.
 */
export async function confirmOwnClip(signed: Signed, id: string, key: string): Promise<void> {
  const clip = await cravingData.clipByKey(db(), key);
  if (!clip?.capability_hash || clip.uploaded_at || clip.owner_person_id !== signed.personId || clip.ask_id !== id) return;
  try {
    await confirmUpload(clip.capability_hash);
  } catch (error) {
    if (!(error instanceof DishFail) || error.code !== "not_found") throw error;
  }
}

/**
 * The question her voice recipe answers: the one her earlier voice recipe answered (a second one replaces it), else the next kid's-own id that isn't asked, else one asked
 * and not answered yet (its question gives way); null when all three are answered.
 */
function voiceRecipeQuestion(row: AskedRow, answered: Set<QuestionId>): QuestionId | null {
  if (row.voice_recipe_q && row.asked.some((q) => q.id === row.voice_recipe_q)) return row.voice_recipe_q;
  const asked = new Set(row.asked.map((q) => q.id));
  return OWN_IDS.find((id) => !asked.has(id)) ?? OWN_IDS.find((id) => !answered.has(id)) ?? null;
}

/**
 * Her 2-minute voice note becomes her version on the kid's card: it's one answer to "How do you make it?", and the card finishes at once. The merge has Ink write it down,
 * after the reply. A second one replaces the first. The same clip again is a retry: it succeeds and changes nothing.
 */
export async function sendVoiceRecipe(signed: Signed, a: { id: string; audioKey: string; durationS: number; language?: string }, trace: Trace): Promise<void> {
  const d = a.durationS;
  const now = Date.now();
  await tx(async (c) => {
    const row = await askedOfMe(c, signed, a.id, (name) => `Only ${name} can answer this one.`, true);
    if (!Number.isFinite(d) || d < 1 || d > MAX_CLIP_S + CLIP_SLACK_S) throw refused(400, "bad_request", `A voice recipe is 1 second to ${MAX_CLIP_S / 60} minutes long.`);
    if (a.language !== undefined && !LANGS.includes(a.language)) throw refused(400, "bad_request", "Pick a language from the list.");
    const mine = (await peopleByIds(c, [signed.personId])).get(signed.personId)?.language;
    const language = a.language ?? (mine && LANGS.includes(mine) ? mine : "en");

    const answers = await data.answersOf(c, row.id);
    if (answers.some((x) => x.audio_key === a.audioKey)) return;
    const questionId = voiceRecipeQuestion(row, new Set(answers.map((x) => x.question_id)));
    if (!questionId) throw refused(409, "closed", "This one already has her answer.");
    if (!(await cravingData.attachOwnClip(c, a.audioKey, signed.personId, row.id))) throw notFound(NOT_FOUND);

    const clip = { audioKey: a.audioKey, durationS: Math.min(MAX_CLIP_S, Math.round(d * 100) / 100), language, now: new Date(now) };
    const old = answers.find((x) => x.question_id === questionId);
    if (old) {
      await data.replaceAnswer(c, old.id, clip);
      await data.markFilesForDeletion(c, [old.audio_key]);
    } else {
      await data.insertAnswer(c, { askId: row.id, questionId, ...clip });
    }
    const question = { id: questionId, text: VOICE_RECIPE_QUESTION };
    const asked = row.asked.some((q) => q.id === questionId) ? row.asked.map((q) => (q.id === questionId ? question : q)) : [...row.asked, question];
    const after = await data.answersOf(c, row.id);
    const patch = {
      asked,
      voice_recipe_q: questionId,
      merge_tries: 0,
      merge_started_at: null,
      ...(row.status === "draft" ? { status: "asked" as const } : {}),
      ...(!row.finished_at && fresh(after).length ? { finished_at: new Date(now) } : {}),
    };
    await data.patchCard(c, row.id, patch);
    await mergeLater(c, await stateOf(c, { ...row, ...patch }, now), trace);
  });
}
