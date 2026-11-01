// What a phone gets. A file's key never leaves the server: a private one goes out as a short-lived read link, a public clip as its media address.
import * as Sentry from "@sentry/node";
import { db } from "../../db.js";
import { objectStore } from "../../storage.js";
import type { Member } from "../people/family.js";
import { answersFor } from "./answers.js";
import * as data from "./data.js";
import type { MessageRow, NoteRow, ThreadRow } from "./data.js";

/** Where public recipe media is served from. Null until it's set: the row keeps the key, so nothing is lost. */
export function mediaUrl(key: string | null): string | null {
  const base = process.env.MEDIA_BASE_URL?.trim().replace(/\/+$/, "");
  return key && base ? `${base}/${key}` : null;
}

/** A read link, or null when one can't be made (the same shape as a missing file). A page still answers. */
export async function readLink(key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return await objectStore().presignGet(key);
  } catch (error) {
    Sentry.captureException(error);
    return null;
  }
}

export async function readLinks(keys: (string | null)[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(keys.filter((k): k is string => !!k))];
  return new Map(await Promise.all(unique.map(async (k) => [k, await readLink(k)] as const)));
}

export const personView = (p: Member) => ({ id: p.id, name: p.name, role: p.role, relation: p.relation, avatarKey: p.avatar_key });

const NOTE_KINDS = new Set(["text", "voice", "step", "recipe", "cooked"]);
export { NOTE_KINDS };

export async function messageViews(familyId: string, everyone: Member[], rows: MessageRow[], threads?: Map<string, ThreadRow>) {
  const [links, answers, saved] = await Promise.all([
    readLinks(rows.flatMap((m) => [m.audio_key, m.photo_key])),
    answersFor(familyId, everyone, rows, threads),
    data.notesOfAnswers(db(), rows.filter((m) => NOTE_KINDS.has(m.kind)).map((m) => m.id)),
  ]);
  return rows.map((m) => ({
    id: m.id,
    threadId: m.thread_id,
    senderId: m.sender_id,
    kind: m.kind,
    body: m.body,
    libraryId: m.library_id,
    recipeId: m.recipe_id,
    stepOrder: m.step_order,
    audioUrl: m.audio_key ? links.get(m.audio_key) ?? null : mediaUrl(m.clip_key),
    durationS: m.duration_s,
    clipStartS: m.clip_start_s,
    clipEndS: m.clip_end_s,
    transcript: m.transcript,
    createdAt: m.created_at,
    replyTo: m.reply_to,
    photoUrl: m.photo_key ? links.get(m.photo_key) ?? null : null,
    rating: m.rating,
    aiDrafted: m.ai_drafted,
    answeredBy: answers.get(m.id)?.by ?? null,
    answeredAt: answers.get(m.id)?.at ?? null,
    savedToRecipe: saved.has(m.id),
    noteId: saved.get(m.id) ?? null,
  }));
}

export async function noteViews(familyId: string, everyone: Member[], rows: NoteRow[]) {
  // A spoken question plays in the asker's own voice on the step screen.
  const asked = await data.messagesByIds(db(), [...new Set(rows.flatMap((r) => (r.question_message_id ? [r.question_message_id] : [])))], familyId);
  const questions = new Map(asked.map((q) => [q.id, q]));
  const links = await readLinks([...rows.map((r) => r.answer_audio_key), ...asked.map((q) => q.audio_key)]);
  // Removed people included: a note keeps its author's name and face.
  const byId = new Map(everyone.map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const author = byId.get(r.answered_by);
    if (!author) return [];
    const asker = r.asked_by ? byId.get(r.asked_by) : undefined;
    const q = r.question_message_id ? questions.get(r.question_message_id) : undefined;
    const questionAudio = q ? (q.audio_key ? links.get(q.audio_key) ?? null : mediaUrl(q.clip_key)) : null;
    return [
      {
        id: r.id,
        libraryId: r.library_id,
        stepOrder: r.step_order,
        question: r.question,
        questionMessageId: r.question_message_id,
        questionAudioUrl: questionAudio,
        questionDurationS: questionAudio ? q!.duration_s : null,
        asker: asker ? personView(asker) : null,
        answerText: r.answer_text,
        answerAudioUrl: r.answer_audio_key ? links.get(r.answer_audio_key) ?? null : mediaUrl(r.answer_clip_key),
        answerDurationS: r.answer_duration_s,
        answerMessageId: r.answer_message_id,
        author: personView(author),
        createdAt: r.created_at,
      },
    ];
  });
}
