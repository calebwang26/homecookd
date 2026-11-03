// This area's work on the `scheduled` queue. Each can arrive twice, so each is safe to repeat; each carries ids only; and one for a person or row that's gone does
// nothing. A task that throws stays on the queue: SQS tries again, and after 3 tries it goes to the dead-letter queue, which raises an alert.
import { db, tx } from "../../db.js";
import { cardForPush } from "../dish/service.js";
import type { Trace } from "../dish/budget.js";
import { everyoneIn, memberById, type Member } from "../people/family.js";
import { recipesByIds } from "../recipes/read.js";
import { questionTargets } from "./answers.js";
import * as data from "./data.js";
import type { MessageRow, ThreadRow } from "./data.js";
import { dishInfo } from "./library.js";
import { deliver, KEEP_LOG_DAYS, queuePush, receipts } from "./push.js";
import { cravingKey, pruneLog } from "./pushData.js";
import { dishName, messagePush, postcardKey, postcardPush, reactionPush } from "./pushRules.js";
import { pushWords, relationLabel } from "./pushWords.js";
import { readFollowUp, readShare, transcribeTask, translateTask } from "./questions.js";
import { hourly, nudgeFamily, recapFamily } from "./retention.js";
import { STORY_CARD_TASK, writeStoryCard } from "./storyCards.js";
import { markSignedInOrphans } from "./uploads.js";

type Payload = Record<string, unknown>;

const text = (payload: Payload, name: string) => {
  const value = payload[name];
  if (typeof value !== "string" || !value) throw new Error(`a task is missing ${name}`);
  return value;
};

const whenOf = (payload: Payload) => (typeof payload.nowMs === "number" ? new Date(payload.nowMs) : new Date());

/** What a dish is called in push copy: its recipe.json's title (dishInfo), or a family recipe's. */
async function dishTitle(m: MessageRow): Promise<string | null> {
  if (m.library_id) return (await dishInfo(m.family_id, m.library_id))?.title || null;
  if (m.recipe_id) return (await recipesByIds(db(), [m.recipe_id]))[0]?.title || null;
  return null;
}

async function context(messageId: string): Promise<{ m: MessageRow; t: ThreadRow; everyone: Member[]; me: Member } | null> {
  const m = await data.messageById(db(), messageId);
  if (!m) return null;
  const everyone = await everyoneIn(db(), m.family_id);
  const me = everyone.find((p) => p.id === m.sender_id);
  const t = await data.threadInFamily(db(), m.thread_id, m.family_id);
  if (!me || me.deleted_at || !t) return null;
  return { m, t, everyone, me };
}

const stillHere = (p: Member) => !p.removed_at && !p.deleted_at;

/**
 * The push for a message someone just sent: to everyone else in the thread still in the family. A question goes only to whoever can answer it; "Just like mine" only
 * to whoever made the dish, even in the circle, because its "your" is theirs alone. Every recipient has the message's id as a dedupe key, so a repeat sends nothing.
 */
async function pushMessage(messageId: string): Promise<void> {
  const ctx = await context(messageId);
  if (!ctx) return;
  const { m, t, everyone, me } = ctx;
  if (m.kind === "reaction") {
    const answered = m.reply_to ? await data.messageInFamily(db(), m.reply_to, m.family_id) : null;
    const info = m.library_id ? await dishInfo(m.family_id, m.library_id) : null;
    const p = reactionPush(m, me, answered, info ? dishName(info.title, info.cook_name) : null);
    const to = p ? everyone.find((x) => x.id === p.to) : null;
    if (p && to && stillHere(to)) await tx((c) => queuePush(c, { personId: to.id, ...p.copy, dedupeKey: p.dedupeKey }));
    return;
  }
  const copy = messagePush(m, me.name, await dishTitle(m));
  if (!copy) return;
  let to = (t.kind === "circle" ? everyone : everyone.filter((p) => p.id === t.a_person_id || p.id === t.b_person_id)).filter((p) => p.id !== me.id && stillHere(p));
  if (copy.kind === "question") {
    const target = questionTargets(everyone, [m], new Map([[t.id, t]])).get(m.id);
    if (target?.answerer) to = to.filter((p) => p.id === target.answerer);
    else if (t.kind === "circle") to = to.filter((p) => p.role === "cook");
  }
  for (const p of to) await tx((c) => queuePush(c, { personId: p.id, ...copy, dedupeKey: `message:${m.id}` }));
}

/**
 * To the dish's cook only, once per cooked message, however often the photo is replaced. The cook is the family member named on the dish, never me; in a pair it must
 * also be the other person, so a card sent to someone else never tells them "your". With the library unreachable, a pair's other person if they're a cook.
 */
async function pushPostcard(messageId: string): Promise<void> {
  const ctx = await context(messageId);
  if (!ctx) return;
  const { m, t, everyone, me } = ctx;
  const info = m.library_id ? await dishInfo(m.family_id, m.library_id) : null;
  const here = everyone.filter(stillHere);
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const other = t.kind === "pair" ? (t.a_person_id === me.id ? t.b_person_id : t.a_person_id) : null;
  const named = info?.cook_name ? here.filter((p) => norm(p.name) === norm(info.cook_name) && p.id !== me.id) : [];
  const to = info ? (other ? named.find((p) => p.id === other) : named.find((p) => p.role === "cook") ?? named[0]) : here.find((p) => p.id === other && p.role === "cook");
  if (!to || to.id === me.id) return;
  await tx((c) => queuePush(c, { personId: to.id, ...postcardPush(me.name, info), dedupeKey: postcardKey(m.id) }));
}

// ---------------------------------------------------------------------------------------------
// v2's pushes about a dish card (Convex's pushEvents.ts). A web-only kid has no person, so nothing is sent; they see Mom's answer when they reopen their link.

const dishOf = (card: { dish: string | null; guess: { dish?: string } | null }) => card.dish || card.guess?.dish || "";

/** Mom's version landed, or her clips went to the kid without one. */
async function pushAnswered(askId: string): Promise<void> {
  const card = await cardForPush(askId);
  if (!card?.person_id) return;
  const language = (await memberById(db(), card.person_id))?.language ?? undefined;
  const { title, body } = pushWords("answered", language, { relation: relationLabel(card.relation ?? undefined), dish: dishOf(card) });
  const stamp = card.merged_at ?? card.finished_at ?? 0;
  await tx((c) => queuePush(c, { personId: card.person_id!, kind: "answered", title, body, url: `/dish/${askId}`, dedupeKey: `answered:${askId}:${new Date(stamp).getTime()}` }));
}

/** A kid named a dish from the parent's craving link. */
async function pushRequested(askId: string): Promise<void> {
  const card = await cardForPush(askId);
  if (!card?.requested_of) return;
  const language = (await memberById(db(), card.requested_of))?.language ?? undefined;
  const { title, body } = pushWords("craving", language, { kid: card.kid_name ?? undefined, dish: dishOf(card) });
  await tx((c) => queuePush(c, { personId: card.requested_of!, kind: "craving", title, body, url: `/request/${askId}`, dedupeKey: cravingKey(askId) }));
}

/** A recipe Mom filmed for this card was published: the video is the upgrade to her voice answer. */
async function pushFilmed(askId: string, recipeId: string): Promise<void> {
  const card = await cardForPush(askId);
  if (!card?.person_id) return;
  const language = (await memberById(db(), card.person_id))?.language ?? undefined;
  const { title, body } = pushWords("filmed", language, { relation: relationLabel(card.relation ?? undefined), dish: dishOf(card) });
  await tx((c) => queuePush(c, { personId: card.person_id!, kind: "filmed", title, body, url: `/recipe/${recipeId}`, dedupeKey: `filmed:${recipeId}` }));
}

const BATCH = 500;

/** A daily schedule: the push log for 40 days, and signed-in uploads nothing took. */
export async function daily(): Promise<void> {
  for (let i = 0; i < 20 && (await pruneLog(db(), KEEP_LOG_DAYS, BATCH)) === BATCH; i += 1);
  for (let i = 0; i < 20 && (await markSignedInOrphans(BATCH)) === BATCH; i += 1);
}

export const messageTasks: Record<string, (payload: Payload, trace: Trace) => Promise<void>> = {
  "messages.push": (payload) => pushMessage(text(payload, "messageId")),
  "messages.push_postcard": (payload) => pushPostcard(text(payload, "messageId")),
  "messages.hourly": (payload, trace) => hourly(whenOf(payload), trace),
  "messages.nudge_family": async (payload) => void (await nudgeFamily(text(payload, "familyId"), whenOf(payload))),
  "messages.recap_family": async (payload) => void (await recapFamily(text(payload, "familyId"), whenOf(payload))),
  "messages.daily": () => daily(),
  "push.deliver": (payload) => deliver(text(payload, "logId")),
  "push.receipts": (payload) => receipts(text(payload, "logId")),
  "push.dish_answered": (payload) => pushAnswered(text(payload, "askId")),
  "push.dish_requested": (payload) => pushRequested(text(payload, "askId")),
  "push.dish_filmed": (payload) => pushFilmed(text(payload, "askId"), text(payload, "recipeId")),
  "questions.translate": (payload, trace) => translateTask(text(payload, "questionId"), text(payload, "language"), trace),
  "questions.transcribe": (payload, trace) => transcribeTask(text(payload, "questionId"), trace),
  "questions.read_follow_up": (payload, trace) => readFollowUp(text(payload, "questionId"), trace),
  "questions.read_share": (payload, trace) => readShare(text(payload, "questionId"), trace),
  [STORY_CARD_TASK]: (payload, trace) => writeStoryCard(text(payload, "recipeId"), trace),
};
