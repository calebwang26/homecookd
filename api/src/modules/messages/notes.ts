// Recipe notes and the questions asked in chat: a cook's answer, saved into the shared family recipe. Keyed by library id, because a dish can be a public sample
// with no row in `recipes`. These are Supabase's "question" messages, which are not the `questions` table (questions.ts): SCHEMA.md keeps the two apart.
import type { Signed } from "../../auth.js";
import { db, tx, type Queryable } from "../../db.js";
import { ApiError, forbidden, notFound } from "../../errors.js";
import { answersFor, questionTargets } from "./answers.js";
import * as data from "./data.js";
import type { MessageRow, NoteRow, ThreadRow } from "./data.js";
import { library } from "./library.js";
import { actorOf } from "./actor.js";
import { threadFor } from "./threadAccess.js";
import { bad, decodeCursor, encodeCursor, isRowId, LIBRARY_ID, norm, pageSize } from "./values.js";
import { messageViews, NOTE_KINDS, noteViews, personView } from "./views.js";

const QUESTION_KINDS = new Set(["question", "step"]);

/** Saves `answer` as a note, once per answer message. Null when it has no content. */
export async function saveNote(c: Queryable, familyId: string, answer: MessageRow, question: MessageRow | null): Promise<NoteRow | null> {
  const q = question && QUESTION_KINDS.has(question.kind) ? question : null;
  let dish = answer.library_id;
  let step = answer.step_order;
  if (!dish && q?.library_id) {
    dish = q.library_id;
    step = q.step_order;
  } else if (dish && step === null && q?.library_id === dish) {
    step = q.step_order;
  }
  if (!dish) throw bad("not_about_a_recipe");
  const words = answer.body ?? answer.transcript;
  if (!words && !answer.audio_key && !answer.clip_key) return null;
  return await data.insertNote(c, {
    familyId,
    libraryId: dish,
    stepOrder: step,
    questionMessageId: q?.id ?? null,
    question: q ? (q.body ?? q.transcript) : null,
    askedBy: q?.sender_id ?? null,
    answerMessageId: answer.id,
    answerText: words,
    answerAudioKey: answer.audio_key,
    answerClipKey: answer.audio_key ? null : answer.clip_key,
    answerDurationS: answer.duration_s,
    answeredBy: answer.sender_id,
  });
}

export async function saveNoteByHand(signed: Signed, body: Record<string, unknown>) {
  const actor = await actorOf(signed);
  if (actor.me.role !== "cook") throw forbidden();
  if (!isRowId(body.messageId)) throw bad("bad_message_id");
  const msg = await data.messageInFamily(db(), body.messageId, actor.familyId);
  if (!msg) throw notFound();
  // Someone outside the pair reads it as no message at all.
  await threadFor(db(), actor, msg.thread_id);
  if (msg.sender_id !== actor.me.id) throw new ApiError(403, "not_your_message");
  if (!NOTE_KINDS.has(msg.kind)) throw bad("cant_save_that_kind");
  const question = msg.reply_to ? await data.messageInFamily(db(), msg.reply_to, actor.familyId) : null;
  const note = await tx((c) => saveNote(c, actor.familyId, msg, question));
  if (!note) throw bad("nothing_to_save");
  return (await noteViews(actor.familyId, actor.everyone, [note]))[0];
}

/**
 * Takes a saved answer back out of the recipe. The answer's author, the person who asked, or the dish's cook may. The note goes, and the answer no longer replies
 * to the question, so the question is open again unless someone else answered it too. The message stays in the chat.
 */
export async function removeNote(signed: Signed, id: string) {
  const actor = await actorOf(signed);
  if (!isRowId(id)) throw notFound();
  const note = await data.noteInFamily(db(), id, actor.familyId);
  if (!note) throw notFound();
  const me = actor.me;
  const cook = (await library().recipeInfo(note.library_id))?.cook_name ?? null;
  const allowed = note.answered_by === me.id || note.asked_by === me.id || (!!norm(me.name) && norm(cook) === norm(me.name));
  if (!allowed) throw new ApiError(403, "cant_take_this_out");
  await tx(async (c) => {
    if (!(await data.deleteNote(c, note.id, actor.familyId))) throw notFound();
    await data.clearReply(c, note.answer_message_id, actor.familyId);
  });
  return { ok: true, answerMessageId: note.answer_message_id, questionMessageId: note.question_message_id };
}

function dishParam(id: string): string {
  if (!LIBRARY_ID.test(id)) throw bad("bad_library_id");
  return id;
}

const NOTES_PAGE = { default: 200, max: 500 };

export async function notesOfDish(signed: Signed, libraryId: string, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const dish = dishParam(libraryId);
  const limit = pageSize(query.limit, NOTES_PAGE);
  const cursor = decodeCursor(query.cursor);
  const split = cursor?.id.indexOf(":") ?? -1;
  const after = cursor && split > 0 ? { step: Number(cursor.id.slice(0, split)), at: cursor.at, id: cursor.id.slice(split + 1) } : null;
  if (cursor && (!after || !Number.isInteger(after.step) || after.step < 0 || after.step > 2147483647)) throw bad("bad_request");
  const rows = await data.notesOfDish(db(), actor.familyId, dish, limit, after);
  const end = rows.at(-1);
  return {
    notes: await noteViews(actor.familyId, actor.everyone, rows),
    nextCursor: rows.length === limit && end ? encodeCursor(end.created_at, `${end.step_order ?? 2147483647}:${end.id}`) : null,
  };
}

const OPEN_LIMIT = 50;
const SCAN = 200;

/**
 * Open questions for "Waiting for your answer": the circle's (not my own, and none asked before I joined: a newcomer starts with no backlog), plus, for a cook, the
 * 1:1 questions asked of me. Newest first, at most 50.
 */
export async function openChatQuestions(signed: Signed) {
  const actor = await actorOf(signed);
  const { me } = actor;
  const ring = await data.ensureCircle(db(), actor.familyId);
  const threads = new Map<string, ThreadRow>([[ring.id, ring]]);
  const joined = Date.parse(me.created_at);
  let rows = (await data.questionsInThreads(db(), [ring.id], ["question"], SCAN)).filter(
    (m) => m.sender_id !== me.id && !(Date.parse(m.created_at) < joined),
  );
  if (me.role === "cook") {
    const pairs = await data.pairsOf(db(), me.id, actor.familyId);
    for (const t of pairs) threads.set(t.id, t);
    const asked = (await data.questionsInThreads(db(), pairs.map((t) => t.id), ["question", "step"], SCAN)).filter((m) => m.sender_id !== me.id);
    const targets = questionTargets(actor.everyone, asked, threads);
    rows = [...rows, ...asked.filter((m) => targets.get(m.id)?.answerer === me.id)].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : -1),
    );
  }
  const answers = await answersFor(actor.familyId, actor.everyone, rows, threads);
  const open = rows.filter((m) => !answers.has(m.id)).slice(0, OPEN_LIMIT);
  const views = await messageViews(actor.familyId, actor.everyone, open, threads);
  const here = new Map(actor.here.map((p) => [p.id, p]));
  return views.flatMap((message, i) => {
    const asker = here.get(open[i].sender_id);
    return asker ? [{ message, asker: personView(asker), threadKind: threads.get(open[i].thread_id)?.kind ?? "circle" }] : [];
  });
}

/**
 * The open questions about one dish, for cook mode's "waiting" line under a step's Ask: the circle's plus the ones I asked in a 1:1. Other people's 1:1 questions
 * stay private. A question whose asker, or the person asked, has left the family is dropped: nobody is waiting on it.
 */
export async function chatQuestionsOfDish(signed: Signed, libraryId: string) {
  const actor = await actorOf(signed);
  const dish = dishParam(libraryId);
  const { me } = actor;
  const rows = await data.questionsAboutDish(db(), actor.familyId, dish, SCAN);
  const threads = new Map((await data.threadsByIds(db(), [...new Set(rows.map((m) => m.thread_id))], actor.familyId)).map((t) => [t.id, t]));
  const targets = questionTargets(actor.everyone, rows, threads);
  const visible = rows.filter((m) => {
    const t = targets.get(m.id);
    return !!t && (t.answerer === null || m.sender_id === me.id);
  });
  const answers = await answersFor(actor.familyId, actor.everyone, visible, threads);
  const here = new Map(actor.here.map((p) => [p.id, p]));
  return visible
    .filter((m) => !answers.has(m.id))
    .flatMap((m) => {
      const asker = here.get(m.sender_id);
      const to = targets.get(m.id)!.answerer;
      const waiting = to ? here.get(to) : null;
      if (!asker || waiting === undefined) return [];
      return [
        {
          id: m.id,
          threadId: m.thread_id,
          threadKind: threads.get(m.thread_id)?.kind ?? "circle",
          stepOrder: m.step_order,
          body: m.body ?? m.transcript,
          createdAt: m.created_at,
          asker: personView(asker),
          mine: m.sender_id === me.id,
          waitingFor: waiting ? personView(waiting) : null,
        },
      ];
    })
    .slice(0, OPEN_LIMIT);
}
