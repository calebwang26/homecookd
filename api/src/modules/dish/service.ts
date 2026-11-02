// The dish ask's rules (DISH-ASK-SPEC.md, ported from convex/dishAsks.ts and lib/dishAskRoutes.ts): a kid's card made with no account,
// what Mom is asked, her voice answers. Her version is written after the reply (merge.ts).
// - Asking: her answered questions stay first, at most 3 open and 6 in all (askedOf).
// - Answers she left 20 minutes without Send count as sent (kidGet).
// - A card is always changed under its row lock (tx + lock), because Postgres won't serialize these for us the way Convex did.
// - No model or S3 call happens inside a transaction: each would hold a database connection while it waits.
import { db, tx, type Queryable } from "../../db.js";
import { ApiError } from "../../errors.js";
import { enqueue } from "../../outbox.js";
import { hit } from "../../rateLimit.js";
import { recordSpend, spentToday, type Trace } from "./budget.js";
import type { AnswerRow, CardRow } from "./data.js";
import * as data from "./data.js";
import { type GuessResult, models, newSpend, type Photo } from "./model.js";
import { flagged } from "./moderation.js";
import { askJson, cardJson, due, fresh, saveTranslationIfCurrent, type State, stateOf, translationHash } from "./pages.js";
import type { MissQuestion, QuestionId, Relation } from "./recipe/types.js";
import { askedText, isSuggestionId, LIMITS, OWN_IDS, RELATION_LABEL } from "./recipe/validate.js";
import { attachFile, checkUpload, confirmUpload, fileGone, type FileKind, makeUpload, readFile, usableFile } from "./uploads.js";
import {
  ABANDONED_MS,
  askTokenFor,
  badRequest,
  budgetSpent,
  DAILY_BUDGET_USD,
  fail,
  missRecipe,
  MOM_OVERAGE_USD,
  notFound,
  RATE,
  randomBase62,
  recipeTexts,
  sha256Hex,
  type StoredRecipe,
  storedRecipe,
  WORDS,
} from "./values.js";

/** The Ask Mom text a card starts with. */
/** What a push about a card needs (messages/tasks.ts): read-only, and the only thing another module asks of a card. */
export const cardForPush = (askId: string) => data.cardById(db(), askId);

export const defaultMessage = (relation: Relation, dish: string) =>
  relation === "none" ? "" : `${RELATION_LABEL[relation]}, how do you make your ${dish}? I'm trying to make it here.`;

const PICK_SOMEONE = "Pick who you're asking first.";
const theirs = (r: Relation) => (r === "dad" || r === "grandpa" || r === "uncle" ? "his" : "her");

export type Kid = { kidTokenHash: string; askToken: string };
export type About = { kind: "ingredient"; index: number } | { kind: "line"; step: number; line: number };
export type Edit =
  | { kind: "ingredient"; index: number; name?: string; amount?: string }
  | { kind: "line"; step: number; line: number; text?: string };

async function byKid(q: Queryable, hash: string, lock = false): Promise<CardRow> {
  const row = await data.cardByKidHash(q, hash, lock);
  if (!row) throw notFound();
  return row;
}

async function byAsk(q: Queryable, hash: string, lock = false): Promise<CardRow> {
  const row = await data.cardByAskHash(q, hash, lock);
  if (!row) throw notFound();
  return row;
}

/**
 * Starts a merge after the reply, in the same transaction as what made it due. A page polls every few seconds while it waits, so one message waits on the queue at a time, and
 * a message lost is sent again a minute on. A merge picking it up lets the next one go at once, for an answer that comes after.
 */
export async function mergeLater(q: Queryable, s: State, trace: Trace): Promise<void> {
  if (due(s) && (await data.noteMergeQueued(q, s.row.id))) {
    await enqueue(q, { queue: "scheduled", payload: { task: "dish.merge", askId: s.row.id }, requestId: trace.requestId });
  }
}

// ---------------------------------------------------------------------------------------------
// The guess: what the kid edits and asks about

type Part = StoredRecipe["ingredients"][number] | StoredRecipe["steps"][number]["lines"][number];

/** The part of the guess `about` names, or a 400. */
function partOf(guess: StoredRecipe, about: About, field: string): Part {
  const part = about.kind === "ingredient" ? guess.ingredients[about.index] : guess.steps[about.step]?.lines[about.line];
  if (!part) throw badRequest(`${field} doesn't point at a part of the guess`, field);
  return part;
}

/** The guess with the kid's edits: each edited part is `stated` (the kid's own knowledge) and keeps its `ask`. */
function editedGuess(before: StoredRecipe, edits: Edit[]): StoredRecipe {
  const guess = JSON.parse(JSON.stringify(before)) as StoredRecipe;
  edits.forEach((e, i) => {
    const part = partOf(guess, e, `edits[${i}]`);
    if (e.kind === "ingredient") {
      Object.assign(part, { ...(e.name ? { name: e.name } : {}), ...(e.amount ? { amount: e.amount } : {}), status: "stated" });
    } else {
      if (e.text && e.text !== (part as { text: string }).text) Object.assign(part, { text: e.text, detail: null, short: null });
      part.status = "stated";
    }
  });
  return guess;
}

/** The kid's question about a part of the guess, when they didn't word it: a template, no model. */
function questionAbout(guess: StoredRecipe, about: About, field: string): string {
  const part = partOf(guess, about, field);
  if (about.kind === "ingredient") return `How much ${(part as { name: string }).name.split(",")[0].trim()} do you use?`;
  const line = (part as { text: string }).text.replaceAll("**", "").replace(/\s+/g, " ").trim();
  const short = line.length <= 60 ? line : `${line.slice(0, 59).replace(/\s+\S*$/, "")}…`;
  return `How do you do this part: ${short.replace(/[.!?]+$/, "")}?`;
}

/**
 * What Mom is asked now, checked: 1 to 3 questions, each a suggestion (q1–q3, in the kid's words) or the kid's own (no id: the next free
 * q4–q6), no id twice, and at most 6 asked in all. One she answered already is left out, and 409 when that leaves nothing. Returns her
 * answered questions as they were, then these.
 */
export function askedOf(
  given: { id: string | null; text: string; about?: About }[],
  before: MissQuestion[],
  answered: Set<QuestionId>,
  linked: { id: QuestionId; about: About }[] = [],
): MissQuestion[] {
  const [min, max] = LIMITS.asked;
  if (!given.length) throw badRequest("questions must be a list of 1 to 3 questions", "questions");
  if (given.length > LIMITS.askOpen) throw badRequest(`At most ${LIMITS.askOpen} questions at a time`, "questions");
  const all = given.map((q, i) => {
    const text = askedText(q.text);
    if (text.length < min || text.length > max) throw badRequest(`questions[${i}].text must be ${min} to ${max} characters`, `questions[${i}].text`);
    if (q.id !== null && !isSuggestionId(q.id)) {
      throw badRequest(`questions[${i}].id must be q1, q2 or q3, or left out for the kid's own question`, `questions[${i}].id`);
    }
    if (q.id !== null && q.about) throw badRequest(`questions[${i}] can't have both an id and about`, `questions[${i}]`);
    return { id: q.id as QuestionId | null, text, about: q.about };
  });
  const ids = all.flatMap((q) => (q.id ? [q.id] : []));
  if (new Set(ids).size !== ids.length) throw badRequest("The same question is in the list twice", "questions");
  if (flagged(...all.map((q) => q.text))) throw fail(422, "words", WORDS);
  const open = all.filter((q) => !q.id || !answered.has(q.id));
  if (!open.length) throw fail(409, "closed", "That was already answered.");
  const kept = before.filter((q) => answered.has(q.id));
  if (kept.length + open.length > LIMITS.askTotal) throw badRequest(`At most ${LIMITS.askTotal} questions in all`, "questions");
  const free = OWN_IDS.filter((id) => !answered.has(id));
  return [
    ...kept,
    ...open.map((q) => {
      const id = q.id ?? free.shift();
      if (!id) throw badRequest("At most 3 questions of your own", "questions");
      if (q.about) linked.push({ id, about: q.about });
      return { id, text: q.text };
    }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Files

export async function requestUpload(kind: FileKind, contentType: unknown, size: unknown, ipKey: string) {
  const { type, bytes } = checkUpload(kind, contentType, size);
  return await makeUpload({ kind, type, bytes, ipKey, askId: null });
}

export async function confirmFileUpload(fileIdHash: string, fileId: string) {
  const f = await confirmUpload(fileIdHash);
  return { fileId, kind: f.kind, contentType: f.content_type, size: Number(f.size_bytes) };
}

// ---------------------------------------------------------------------------------------------
// The kid

/**
 * Makes a card: Ink on the voice note, Claude's guess, the filter on the guess. The kid waits on this (the site's contract), so the models
 * run in the request, outside any transaction. A retry of this route can't be recognized: the first try's kid token isn't stored, so it
 * can't be handed back, and its files answer not-found (DISH-MIGRATION.md).
 */
export async function createCard(
  input: { dish: string; relation: Relation; kidName: string | null; photos: string[]; voiceNote: string | null; ipKey: string },
  trace: Trace,
) {
  if ((await spentToday()) >= DAILY_BUDGET_USD) throw budgetSpent();
  const photoFiles = await Promise.all(input.photos.map((h) => usableFile(db(), h, "photo")));
  const voiceFile = input.voiceNote ? await usableFile(db(), input.voiceNote, "voice") : null;

  const started = Date.now();
  const spend = newSpend(trace.log);
  let askId: string | null = null;
  try {
    let voiceWords: string | null = null;
    if (voiceFile) {
      const file = await readFile(voiceFile.key);
      if (!file) throw fileGone();
      const blob = new Blob([Buffer.from(file.bytes)], { type: voiceFile.content_type ?? "" });
      voiceWords = (await models.transcribe(blob, "en", undefined, spend)).trim();
      if ((await spentToday()) >= DAILY_BUDGET_USD) throw budgetSpent();
    }
    const images: Photo[] = [];
    for (const p of photoFiles) {
      const file = await readFile(p.key);
      if (!file) throw fileGone();
      images.push({ mime: p.content_type ?? "", data: file.bytes });
    }
    const made: GuessResult = await models.writeGuess({ dish: input.dish, relation: input.relation, kidName: input.kidName, photos: images, voiceWords }, spend);
    if (made.notADish) throw fail(422, "not_a_dish", "Tell us a dish.");
    const guess = storedRecipe(made.recipe);
    if (flagged(...recipeTexts(guess))) throw fail(422, "words", WORDS);

    const kidToken = randomBase62();
    const askToken = askTokenFor(kidToken);
    const now = Date.now();
    const state = await tx(async (c) => {
      const id = await data.insertCard(c, {
        kidTokenHash: sha256Hex(kidToken),
        askTokenHash: sha256Hex(askToken),
        dish: input.dish,
        relation: input.relation,
        kidName: input.kidName,
        guess,
        message: defaultMessage(input.relation, guess.dish),
        genMs: now - started,
        ipKey: input.ipKey,
      });
      const photoKeys: string[] = [];
      for (const h of input.photos) photoKeys.push(await attachFile(c, h, id, "photo"));
      // The voice note about the dish stays on the card, privately: no page gets it.
      const voiceKey = input.voiceNote ? await attachFile(c, input.voiceNote, id, "voice") : null;
      await data.patchCard(c, id, { photo_keys: photoKeys, dish_voice_note_key: voiceKey });
      askId = id;
      return await stateOf(c, (await data.cardById(c, id))!, now);
    });
    return { kidToken, card: await cardJson(state, askToken) };
  } finally {
    await recordSpend(spend, askId, trace);
  }
}

/** The kid's card. Answers she left 20 minutes count as sent, and a merge that's due starts after the reply. */
export async function kidGet(kid: Kid, trace: Trace) {
  const now = Date.now();
  const row = await byKid(db(), kid.kidTokenHash);
  const first = await stateOf(db(), row, now);
  const left = (s: State) => {
    const mine = fresh(s.answers);
    if (s.row.finished_at || !mine.length) return false;
    return Math.max(...mine.map((a) => a.created_at.getTime()), s.row.questions_at?.getTime() ?? 0) <= now - ABANDONED_MS;
  };
  // Most looks change nothing, and stay out of the row lock.
  if (!left(first) && !due(first)) return await cardJson(first, kid.askToken);
  const state = await tx(async (c) => {
    let locked = await byKid(c, kid.kidTokenHash, true);
    let s = await stateOf(c, locked, now);
    if (left(s)) {
      await data.patchCard(c, locked.id, { finished_at: new Date(now) });
      locked = { ...locked, finished_at: new Date(now) };
      s = { ...s, row: locked };
    }
    await mergeLater(c, s, trace);
    return s;
  });
  return await cardJson(state, kid.askToken);
}

export async function kidUpdate(
  a: Kid & { relation?: Relation; kidName?: string | null; message?: string; voiceNote?: string | null; voiceNoteS?: number; edits?: Edit[] },
) {
  const now = Date.now();
  const state = await tx(async (c) => {
    const row = await byKid(c, a.kidTokenHash, true);
    // The same note again is a retry of this same attach: it succeeds and changes nothing, even once she has sent.
    const held = a.voiceNote ? await data.fileByCapability(c, a.voiceNote) : null;
    const sameNote = !!held && held.ask_id === row.id && held.key === row.kid_voice_note_key;
    const voiceChange = a.voiceNote !== undefined && !sameNote;
    if (row.finished_at && (a.message !== undefined || voiceChange || a.edits?.length)) {
      throw fail(409, "closed", `${RELATION_LABEL[row.relation]} already sent ${theirs(row.relation)} answers.`);
    }
    if (a.relation === "none" && row.relation !== "none" && row.asked_at !== null) {
      throw fail(409, "closed", "This one was already sent.");
    }
    const patch: Partial<CardRow> = {};
    if (a.edits?.length) patch.guess = editedGuess(row.guess, a.edits);
    if (a.relation !== undefined && a.relation !== row.relation) {
      patch.relation = a.relation;
      // A message the kid never changed follows who they're asking.
      if (a.message === undefined && row.message === defaultMessage(row.relation, row.guess.dish)) {
        patch.message = defaultMessage(a.relation, row.guess.dish);
      }
    }
    if (a.kidName !== undefined) patch.kid_name = a.kidName;
    if (a.message !== undefined) patch.message = a.message;
    if (voiceChange) {
      const next = a.voiceNote ? await attachFile(c, a.voiceNote, row.id, "voice") : null;
      if (row.kid_voice_note_key) await data.markFilesForDeletion(c, [row.kid_voice_note_key]);
      patch.kid_voice_note_key = next;
      patch.kid_voice_s = next ? (a.voiceNoteS ?? null) : null;
    }
    await data.patchCard(c, row.id, patch);
    return await stateOf(c, { ...row, ...patch }, now);
  });
  return await cardJson(state, a.askToken);
}

/** Her answered questions stay; these replace the rest. When she had sent, her link opens again on them. */
export async function kidAsk(a: Kid & { questions: { id: string | null; text: string | null; about?: About }[] }) {
  const now = Date.now();
  const state = await tx(async (c) => {
    const row = await byKid(c, a.kidTokenHash, true);
    if (row.relation === "none") throw badRequest(PICK_SOMEONE);
    const answers = await data.answersOf(c, row.id);
    // A question about a part of the guess gets the template's words when the kid gave none (§10).
    const given = a.questions.map((q, i) => {
      if (q.about) partOf(row.guess, q.about, `questions[${i}].about`);
      const text = q.text ?? (q.about ? questionAbout(row.guess, q.about, `questions[${i}].about`) : null);
      if (text === null) throw badRequest(`questions[${i}].text must be a string`, `questions[${i}].text`);
      return { id: q.id, text, about: q.about };
    });
    const linked: { id: QuestionId; about: About }[] = [];
    const asked = askedOf(given, row.asked, new Set(answers.map((x) => x.question_id)), linked);
    // Her answer to it goes where it belongs in the merge: the part's `ask` names the question, as q1–q3 do.
    const guess = linked.length ? (JSON.parse(JSON.stringify(row.guess)) as StoredRecipe) : row.guess;
    for (const { id, about } of linked) partOf(guess, about, "about").ask = id;
    const patch: Partial<CardRow> = {
      asked,
      ...(linked.length ? { guess } : {}),
      questions_at: new Date(now),
      ...(row.finished_at ? { finished_at: null, status: "asked" as const } : {}),
    };
    await data.patchCard(c, row.id, patch);
    return await stateOf(c, { ...row, ...patch }, now);
  });
  return await cardJson(state, a.askToken);
}

/** The share sheet opened a channel: the first time sets asked_at, and a draft becomes 'asked'. */
export async function kidSent(a: Kid & { via: string }) {
  const now = Date.now();
  const state = await tx(async (c) => {
    const row = await byKid(c, a.kidTokenHash, true);
    if (row.relation === "none") throw badRequest(PICK_SOMEONE);
    const patch: Partial<CardRow> = {
      ...(row.asked_at === null ? { asked_at: new Date(now), asked_via: a.via } : {}),
      ...(row.status === "draft" ? { status: "asked" as const } : {}),
    };
    await data.patchCard(c, row.id, patch);
    return await stateOf(c, { ...row, ...patch }, now);
  });
  return await cardJson(state, a.askToken);
}

// ---------------------------------------------------------------------------------------------
// Mom

/**
 * The card in Mom's page language, translated once (Claude) and cached until the asked questions or the message change. Mom-side, so it
 * runs to the budget's overage. Never fails the peek: without it, the page shows English.
 */
async function translateForPage(askTokenHash: string, lang: string, trace: Trace): Promise<void> {
  const row = await byAsk(db(), askTokenHash);
  const sourceHash = translationHash(row);
  if ((await data.translationOf(db(), row.id, lang))?.source_hash === sourceHash) return;
  if ((await spentToday()) >= DAILY_BUDGET_USD + MOM_OVERAGE_USD) return;
  try {
    await hit(`${row.id}:${lang}`, [RATE.momLang]);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 429) return;
    throw error;
  }
  const spend = newSpend(trace.log);
  try {
    const out = await models.translateForMom(
      { guess: missRecipe(row.guess), questions: row.asked, message: row.message, ...(row.version ? { version: missRecipe(row.version) } : {}) },
      lang,
      spend,
    );
    if (!out) return;
    const guess = storedRecipe(out.guess);
    const questions = out.questions.map((q) => ({ id: q.id, text: q.text }));
    if (flagged(...recipeTexts(guess), ...questions.map((q) => q.text), out.message)) {
      trace.log.warn({ lang }, "a translation has a filtered word; her page stays in English");
      return;
    }
    await saveTranslationIfCurrent(row.id, lang, sourceHash, {
      guess,
      questions,
      message: out.message,
      version: out.version ? storedRecipe(out.version) : null,
    });
  } catch (error) {
    trace.log.error({ lang, err: { type: (error as Error).name } }, "translating Mom's page failed");
  } finally {
    await recordSpend(spend, row.id, trace);
  }
}

export async function momPeek(askTokenHash: string, lang: string | undefined, trace: Trace) {
  if (lang) await translateForPage(askTokenHash, lang, trace);
  const now = Date.now();
  let row = await byAsk(db(), askTokenHash);
  if (row.opened_at === null || (lang && row.mom_page_lang !== lang)) {
    row = { ...row, ...(await data.markOpened(db(), row.id, new Date(now), lang ?? null)) };
  }
  return await askJson(db(), await stateOf(db(), row, now), lang);
}

/** Mom may record an answer to a question she was asked: a new one, or again until it's in her version. */
function canAnswer(row: CardRow, answers: AnswerRow[], questionId: QuestionId) {
  if (row.finished_at) throw fail(409, "closed", "These answers were already sent.");
  if (!row.asked.some((q) => q.id === questionId)) throw badRequest("That question wasn't asked.", "q");
  if (answers.some((a) => a.question_id === questionId && a.merged)) throw fail(409, "closed", "That answer was already sent.");
}

/** The upload link for one answer. Every check the old raw route ran before it stored her clip runs here, before the link exists. */
export async function requestAnswerUpload(
  a: { askTokenHash: string; questionId: QuestionId; contentType: unknown; size: unknown; ipKey: string },
) {
  const { type, bytes } = checkUpload("clip", a.contentType, a.size);
  const row = await byAsk(db(), a.askTokenHash);
  canAnswer(row, await data.answersOf(db(), row.id), a.questionId);
  return await makeUpload({ kind: "voice", type, bytes, ipKey: a.ipKey, askId: row.id });
}

/**
 * Saves (or replaces) her answer to one question: its words are written down after the reply, and the card's merges start over. A replaced
 * clip goes. The same clip on the same question again is a retry: it succeeds and changes nothing, even after Send, and two at once stay
 * one attach, because the second waits on the card's row lock and then sees the first.
 */
export async function momAnswer(
  a: { askTokenHash: string; questionId: QuestionId; fileIdHash: string; durationS: number; language: string },
  trace: Trace,
) {
  const owner = await byAsk(db(), a.askTokenHash);
  const before = await data.fileByCapability(db(), a.fileIdHash);
  // Before S3 is asked anything: a clip from another card's link is not found, the same as one that never was.
  if (before?.ask_id !== owner.id) throw fileGone();
  const retried = (answers: AnswerRow[], key: string) => answers.some((x) => x.question_id === a.questionId && x.audio_key === key);
  // Her clip must be seen in S3 before the transaction: that call would hold its connection.
  if (!before.uploaded_at) {
    canAnswer(owner, await data.answersOf(db(), owner.id), a.questionId);
    await confirmUpload(a.fileIdHash);
  }
  const now = Date.now();
  const state = await tx(async (c) => {
    const row = await byAsk(c, a.askTokenHash, true);
    const answers = await data.answersOf(c, row.id);
    if (retried(answers, before.key)) return await stateOf(c, row, now);
    canAnswer(row, answers, a.questionId);
    const key = await data.attachClip(c, a.fileIdHash, row.id);
    if (!key) throw fileGone();
    const old = answers.find((x) => x.question_id === a.questionId);
    const clip = { audioKey: key, durationS: a.durationS, language: a.language, now: new Date(now) };
    let answerId: string;
    if (old) {
      answerId = old.id;
      await data.replaceAnswer(c, old.id, clip);
      await data.markFilesForDeletion(c, [old.audio_key]);
    } else {
      answerId = await data.insertAnswer(c, { askId: row.id, questionId: a.questionId, ...clip });
    }
    await data.patchCard(c, row.id, { merge_tries: 0, merge_started_at: null });
    await enqueue(c, { queue: "scheduled", payload: { task: "dish.hear", answerId, audioKey: key }, requestId: trace.requestId });
    return await stateOf(c, { ...row, merge_tries: 0, merge_started_at: null }, now);
  });
  return await askJson(db(), state, a.language);
}

/** Send: her answers go to the kid, and her version is written after the reply. Nothing answered changes nothing. */
export async function momFinish(askTokenHash: string, lang: string | undefined, trace: Trace) {
  const now = Date.now();
  const state = await tx(async (c) => {
    let row = await byAsk(c, askTokenHash, true);
    if (!row.finished_at && fresh(await data.answersOf(c, row.id)).length) {
      await data.patchCard(c, row.id, { finished_at: new Date(now) });
      row = { ...row, finished_at: new Date(now) };
    }
    const s = await stateOf(c, row, now);
    await mergeLater(c, s, trace);
    return s;
  });
  return await askJson(db(), state, lang);
}
