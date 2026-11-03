// Threads and messages: Supabase's shape, which Convex's messages move into (SCHEMA.md). A thread is a pair (two people, the smaller id first) or the family's
// one circle. Sending is one transaction: the idempotency key, the file's attach, the message, the thread's time, the recipe note and the push's outbox row all
// land together or not at all, so a failure is visible to the phone and its retry can't write twice.
import type { PoolClient } from "pg";
import type { Signed } from "../../auth.js";
import { db, type Queryable } from "../../db.js";
import { forbidden, invalid, notFound, refused } from "../../errors.js";
import { once, requestHash } from "../../idempotency.js";
import { enqueue } from "../../outbox.js";
import type { Member } from "../people/family.js";
import { recipeFor } from "../recipes/read.js";
import { type Actor, actorOf, type Write } from "./actor.js";
import { threadFor } from "./threadAccess.js";
import { canAnswer, questionTargets } from "./answers.js";
import * as data from "./data.js";
import type { MessageRow, NewMessage, ThreadRow } from "./data.js";
import { attachFile, isPublicClip, markForDeletion } from "./uploads.js";
import { checkDish } from "./library.js";
import { isReaction } from "./pushRules.js";
import { saveNote } from "./notes.js";
import { decodeCursor, encodeCursor, isoTime, isRowId, libraryId, MAX_BODY, MAX_RECIPIENTS, MAX_STEP, MAX_TRANSCRIPT, MAX_VOICE_S, noSuchRecipe, number, pageSize, text, WRITE_SOMETHING } from "./values.js";
import { messageViews, personView } from "./views.js";

type Body = Record<string, unknown>;

/** The circle is the people in the family now. A pair keeps both people even after one left, so its history still shows who it was with. */
const membersOf = (actor: Pick<Actor, "here" | "everyone">, t: ThreadRow) =>
  t.kind === "circle" ? actor.here : actor.everyone.filter((p) => p.id === t.a_person_id || p.id === t.b_person_id);

export const otherOf = (t: ThreadRow, personId: string) => (t.a_person_id === personId ? t.b_person_id : t.a_person_id);

/** A pair with someone who left or deleted their account: its history stays readable, but nothing new goes to them. */
function refuseIfOtherLeft(actor: Actor, t: ThreadRow): void {
  if (t.kind !== "pair") return;
  const other = actor.everyone.find((p) => p.id === otherOf(t, actor.me.id));
  if (other && (other.removed_at || other.deleted_at)) throw refused(403, "other_left", "They aren't in the family anymore.");
}

// ---------------------------------------------------------------------------------------------
// Reading

/** `other` stays a person for older screens. For the circle it's this stand-in, not a real person. */
const CIRCLE_OTHER = { id: "family", name: "Family", role: "cook", relation: null, avatarKey: null };

function inboxRow(actor: Actor, row: data.InboxRow, lasts: Map<string, unknown>) {
  const t = row as ThreadRow;
  let other: Record<string, unknown>;
  if (t.kind === "circle") other = CIRCLE_OTHER;
  else {
    const p = actor.everyone.find((x) => x.id === otherOf(t, actor.me.id));
    if (!p) return null;
    other = p.removed_at || p.deleted_at ? { ...personView(p), removed: true } : personView(p);
  }
  return {
    id: t.id,
    kind: t.kind,
    other,
    members: membersOf(actor, t).map(personView),
    last: row.last_id ? lasts.get(row.last_id) ?? null : null,
    unread: row.unread,
    libraryId: row.library_id,
    postcards: row.postcards,
  };
}

/** The circle (always, first) then my pairs with messages, newest first. */
export async function inbox(signed: Signed, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const cursor = decodeCursor(query.cursor);
  const limit = pageSize(query.limit);
  const circle = await data.ensureCircle(db(), actor.familyId);
  const pairs = await data.pairSummaries(db(), actor.me.id, actor.familyId, limit, cursor);
  const rows = cursor ? pairs : [await data.circleSummary(db(), circle.id, actor.me.id), ...pairs];
  const lastRows = await data.messagesByIds(db(), rows.flatMap((r) => (r.last_id ? [r.last_id] : [])), actor.familyId);
  const threads = new Map<string, ThreadRow>(rows.map((r) => [r.id, r]));
  const lasts = new Map((await messageViews(actor.familyId, actor.everyone, lastRows, threads)).map((m) => [m.id, m]));
  const threadsOut = rows.map((r) => inboxRow(actor, r, lasts)).filter((r) => r !== null);
  const end = pairs.at(-1);
  return { threads: threadsOut, nextCursor: pairs.length === limit && end?.last_message_at ? encodeCursor(end.last_message_at, end.id) : null };
}

export async function startPair(signed: Signed, body: Body) {
  const actor = await actorOf(signed);
  const other = personHere(actor, body.otherId, "otherId");
  if (other.id === actor.me.id) throw invalid("otherId");
  const t = await data.ensurePair(db(), actor.familyId, actor.me.id, other.id);
  return { id: t.id, other: personView(other) };
}

function personHere(actor: Actor, id: unknown, field: string): Member {
  if (!isRowId(id)) throw invalid(field);
  const p = actor.here.find((x) => x.id === id);
  if (!p) throw notFound();
  return p;
}

export async function circle(signed: Signed) {
  const actor = await actorOf(signed);
  const t = await data.ensureCircle(db(), actor.familyId);
  return { id: t.id, kind: "circle", members: actor.here.map(personView) };
}

/** Newest page, returned oldest first. `after` (the newest createdAt a phone has) is what a poll sends; `cursor` pages further back. */
export async function threadPage(signed: Signed, threadId: string, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const t = await threadFor(db(), actor, threadId);
  const limit = pageSize(query.limit);
  const rows = await data.threadMessages(db(), t.id, limit, decodeCursor(query.cursor), isoTime(query.after, "after"));
  const views = await messageViews(actor.familyId, actor.everyone, [...rows].reverse(), new Map([[t.id, t]]));
  const oldest = rows.at(-1);
  return { messages: views, nextCursor: rows.length === limit && oldest ? encodeCursor(oldest.created_at, oldest.id) : null };
}

export async function readThread(signed: Signed, threadId: string) {
  const actor = await actorOf(signed);
  const t = await threadFor(db(), actor, threadId);
  await data.markRead(db(), t.id, actor.me.id);
  return { ok: true };
}

/** What a poll needs: has anything changed since I last looked? `lastMessageAt` moves on every new message, and `total` on every unread one. */
export async function unread(signed: Signed) {
  const actor = await actorOf(signed);
  const t = await data.ensureCircle(db(), actor.familyId);
  const row = await data.unreadSummary(db(), actor.me.id, actor.familyId, t.id);
  return { total: row.total, lastMessageAt: row.last_message_at };
}

// ---------------------------------------------------------------------------------------------
// Sending

type Parsed = NewMessage & { kind: string; replyToId: string | null };

const KINDS = new Set(["text", "voice", "step", "recipe", "cooked", "request", "question", "reaction"]);

/** The voice fields of a voice message or a spoken question. */
function parseVoice(body: Body, m: Parsed): void {
  const duration = number(body.durationS, "durationS", { min: 0, max: MAX_VOICE_S });
  if (!duration) throw invalid("durationS");
  const audioKey = text(body.audioKey, "audioKey", 1024);
  const clipKey = text(body.clipKey, "clipKey", 1024);
  if (audioKey) m.audioKey = audioKey;
  else if (clipKey) {
    // A clip of a cook's recorded voice from the public library ("Hear Dad").
    if (!isPublicClip(clipKey)) throw notFound();
    m.clipKey = clipKey;
  } else throw invalid("audioKey");
  m.durationS = duration;
}

/** Everything that can be said about a body without the database. */
export function parseMessage(body: Body): Parsed {
  if (typeof body.kind !== "string" || !body.kind) throw invalid("kind");
  const kind = body.kind;
  const words = text(body.body, "body", MAX_BODY);
  const dish = libraryId(body.libraryId, false);
  const step = number(body.stepOrder, "stepOrder", { int: true, min: 1, max: MAX_STEP });
  const clipStart = number(body.clipStartS, "clipStartS", { min: 0, max: 86_400 });
  const clipEnd = number(body.clipEndS, "clipEndS", { min: 0, max: 86_400 });
  if (clipStart !== null && clipEnd !== null && clipEnd <= clipStart) throw invalid("clipEndS");
  const transcript = text(body.transcript, "transcript", MAX_TRANSCRIPT);
  const m: Parsed = { kind, body: words, libraryId: dish, stepOrder: step, clipStartS: clipStart, clipEndS: clipEnd, replyToId: null };
  const spoken = !!body.audioKey || !!body.clipKey;

  switch (kind) {
    case "text":
    case "request":
      if (!words) throw invalid("body", WRITE_SOMETHING);
      break;
    case "recipe":
    case "cooked":
      if (!dish) throw invalid("libraryId");
      if (kind === "cooked" && body.photoKey) m.photoKey = String(body.photoKey);
      break;
    case "step":
      if (!dish || step === null) throw invalid(dish ? "stepOrder" : "libraryId");
      break;
    case "voice":
      parseVoice(body, m);
      m.transcript = transcript;
      break;
    case "question":
      if (spoken) {
        parseVoice(body, m);
        m.transcript = transcript;
      } else if (!words) throw invalid("body", WRITE_SOMETHING);
      if (step !== null && !dish) throw invalid("libraryId");
      break;
    case "reaction":
      if (!isReaction(words)) throw invalid("body");
      break;
    case "system": // homecookd writes these; nobody sends one
    default:
      throw invalid("kind");
  }
  if (kind !== "voice" && kind !== "question" && (body.audioKey || body.clipKey)) throw invalid(body.audioKey ? "audioKey" : "clipKey");
  if (kind !== "cooked" && body.photoKey) throw invalid("photoKey");
  if (body.replyTo !== undefined && body.replyTo !== null) {
    if (!isRowId(body.replyTo)) throw invalid("replyTo");
    m.replyToId = body.replyTo;
  }
  return m;
}

/** The body of a send, in its transaction. Returns the message, which for a repeated "Just like mine" is the first one. */
async function sendIn(c: PoolClient, actor: Actor, t: ThreadRow, m: Parsed, requestId?: string): Promise<MessageRow> {
  let replyTo: MessageRow | null = null;
  if (m.replyToId) {
    replyTo = await data.messageInFamily(c, m.replyToId, actor.familyId);
    if (!replyTo || replyTo.thread_id !== t.id) throw invalid("replyTo");
    m.replyTo = replyTo.id;
  }
  if (m.kind === "reaction") {
    // A reaction answers a dish someone else made, or nothing (a heart mid-cook); never a question.
    const madeByOther = replyTo && replyTo.kind === "cooked" && replyTo.sender_id !== actor.me.id;
    if ((replyTo && !madeByOther) || (m.body === "just_like_mine" && !replyTo)) throw invalid("replyTo");
  }
  if (m.clipKey && !(await clipIsPublic(c, m.clipKey))) throw notFound();
  if (m.audioKey) await attachFile(c, actor, m.audioKey, ["voice"]);
  if (m.photoKey) await attachFile(c, actor, m.photoKey, ["photo"]);

  const row = await data.insertMessage(c, t, actor.me.id, m);
  if (!row) {
    // Tapping "Just like mine" twice sends one.
    const same = await data.sameReaction(c, t.id, actor.me.id, m.replyTo!, m.body!);
    if (!same) throw new Error("A reaction was neither saved nor found");
    return same;
  }
  // A cook answering a question about a recipe answers it, and the answer is kept in the recipe for the whole family.
  const target = replyTo ? questionTargets(actor.everyone, [replyTo], new Map([[t.id, t]])).get(replyTo.id) : undefined;
  if (target && replyTo?.library_id && actor.me.role === "cook" && canAnswer(actor.everyone, target, actor.me.id) && (row.kind === "text" || row.kind === "voice")) {
    await saveNote(c, actor.familyId, row, replyTo);
  }
  if (row.kind !== "system") await enqueue(c, { queue: "scheduled", payload: { task: "messages.push", messageId: row.id }, requestId });
  return row;
}

/** A clip names public media, which has no row in `files`. So one that does is someone's private file, whatever it's called. */
async function clipIsPublic(q: Queryable, key: string): Promise<boolean> {
  const { rowCount } = await q.query(`select 1 from files where key = $1`, [key]);
  return !rowCount;
}

const fields = (body: Body, names: string[]) => Object.fromEntries(names.map((name) => [name, body[name]]));
const SEND_FIELDS = ["kind", "body", "libraryId", "stepOrder", "audioKey", "clipKey", "clipStartS", "clipEndS", "durationS", "transcript", "photoKey", "replyTo"];

export async function sendToThread(signed: Signed, threadId: string, body: Body, w: Write) {
  const actor = await actorOf(signed);
  const t = await threadFor(db(), actor, threadId);
  refuseIfOtherLeft(actor, t);
  const m = parseMessage(body);
  await checkDish(actor.familyId, m.libraryId);
  const { resourceId } = await once(
    { scope: actor.me.id, key: w.key, route: "POST /v1/threads/:id/messages", hash: requestHash([t.id, fields(body, SEND_FIELDS)]) },
    async (c) => (await sendIn(c, actor, t, m, w.requestId)).id,
  );
  return await oneMessage(actor, resourceId, t);
}

async function oneMessage(actor: Actor, id: string, t?: ThreadRow) {
  const row = await data.messageInFamily(db(), id, actor.familyId);
  if (!row) throw notFound();
  return (await messageViews(actor.familyId, actor.everyone, [row], t ? new Map([[t.id, t]]) : undefined))[0];
}

// ---------------------------------------------------------------------------------------------
// Convex's messages: text, voice and the finished-dish photo, addressed to a person or to everyone

const CONVEX_KINDS = new Set(["text", "voice", "photo"]);
const CONVEX_FIELDS = ["kind", "text", "audioKey", "photoKey", "to", "recipeId", "aiDrafted"];

/** messages.send. No `to` is the family's circle; with `to`, that pair's thread, made if it's missing. */
export async function sendToPerson(signed: Signed, body: Body, w: Write) {
  const actor = await actorOf(signed);
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!CONVEX_KINDS.has(kind)) throw invalid("kind");
  const words = text(body.text, "text", MAX_BODY);
  if (kind === "text" && !words) throw invalid("text", WRITE_SOMETHING);
  if (kind === "text" && (body.audioKey || body.photoKey)) throw invalid(body.audioKey ? "audioKey" : "photoKey");
  if (kind === "voice" && !body.audioKey) throw invalid("audioKey");
  if (kind === "photo" && !body.photoKey) throw invalid("photoKey");
  if (kind === "voice" && body.photoKey) throw invalid("photoKey");
  if (kind === "photo" && body.audioKey) throw invalid("audioKey");
  const to = body.to === undefined || body.to === null ? null : personHere(actor, body.to, "to");
  if (to?.id === actor.me.id) throw invalid("to");
  let recipeId: string | null = null;
  if (body.recipeId !== undefined && body.recipeId !== null) {
    // The recipient reads the recipe's id, and its push names it, so one that isn't ready is no recipe here, to its cook too.
    if (!isRowId(body.recipeId) || !(await recipeFor(db(), actor.familyId, actor.me.id, body.recipeId, { readyOnly: true }))) throw noSuchRecipe();
    recipeId = body.recipeId;
  }
  const m: Parsed = {
    kind,
    body: words,
    recipeId,
    audioKey: kind === "voice" ? String(body.audioKey) : null,
    photoKey: kind === "photo" ? String(body.photoKey) : null,
    aiDrafted: body.aiDrafted === true,
    replyToId: null,
  };
  const { resourceId } = await once(
    { scope: actor.me.id, key: w.key, route: "POST /v1/messages", hash: requestHash(fields(body, CONVEX_FIELDS)) },
    async (c) => {
      const t = to ? await data.ensurePair(c, actor.familyId, actor.me.id, to.id) : await data.ensureCircle(c, actor.familyId);
      if (m.audioKey) await attachFile(c, actor, m.audioKey, ["voice"]);
      if (m.photoKey) await attachFile(c, actor, m.photoKey, ["photo"]);
      const row = await data.insertMessage(c, t, actor.me.id, m);
      await enqueue(c, { queue: "scheduled", payload: { task: "messages.push", messageId: row!.id }, requestId: w.requestId });
      return row!.id;
    },
  );
  return await oneMessage(actor, resourceId);
}

/** messages.list: the family's messages to everyone, plus the ones to or from me. Newest first. */
export async function familyMessages(signed: Signed, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const limit = pageSize(query.limit);
  const ring = await data.ensureCircle(db(), actor.familyId);
  const pairs = await data.pairsOf(db(), actor.me.id, actor.familyId);
  const threads = new Map([ring, ...pairs].map((t) => [t.id, t]));
  const rows = await data.messagesAcross(db(), [...threads.keys()], limit, decodeCursor(query.cursor));
  const views = await messageViews(actor.familyId, actor.everyone, rows, threads);
  const names = new Map(actor.everyone.map((p) => [p.id, p.name]));
  const end = rows.at(-1);
  return {
    messages: views.map((v, i) => {
      const t = threads.get(rows[i].thread_id);
      return { ...v, to: t?.kind === "pair" ? otherOf(t, rows[i].sender_id) : null, fromName: names.get(rows[i].sender_id) ?? "" };
    }),
    nextCursor: rows.length === limit && end ? encodeCursor(end.created_at, end.id) : null,
  };
}

const MADE_DAYS = 14;

/** The cook's Home card "Leo made your Poha": the newest photo someone else in the family sent of one of my dishes, from the last two weeks. */
export async function madeMyDish(signed: Signed) {
  const actor = await actorOf(signed);
  const pairsMine = new Set((await data.pairsOf(db(), actor.me.id, actor.familyId)).map((t) => t.id));
  const ring = await data.ensureCircle(db(), actor.familyId);
  const recent = await data.photosOfDishes(db(), actor.familyId, MADE_DAYS, 200);
  for (const m of recent) {
    if (m.kind !== "photo" || m.sender_id === actor.me.id || !m.recipe_id || !m.photo_key) continue;
    if (m.thread_id !== ring.id && !pairsMine.has(m.thread_id)) continue;
    const recipe = await recipeFor(db(), actor.familyId, actor.me.id, m.recipe_id);
    if (!recipe || recipe.cook_id !== actor.me.id) continue;
    const views = await messageViews(actor.familyId, actor.everyone, [m]);
    if (!views[0].photoUrl) continue;
    return {
      messageId: m.id,
      fromName: actor.everyone.find((p) => p.id === m.sender_id)?.name ?? "",
      recipeTitle: recipe.title,
      libraryId: recipe.library_id,
      photoUrl: views[0].photoUrl,
      text: m.body,
      at: m.created_at,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Postcards, recipes sent inside the family, system notes

const POSTCARD_FIELDS = ["photoKey", "rating"];

function postcardRating(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) throw invalid("rating");
  return v;
}

/**
 * "Send it home": the photo goes on the `cooked` message "I made it" already sent, so the cook's chat and Home keep one card per dish made. Only its sender may.
 * Posting again replaces the photo and the rating (a retry, "Take another"); the dish's cook is pushed once per message.
 */
export async function postcard(signed: Signed, messageId: string, body: Body, w: Write) {
  const actor = await actorOf(signed);
  if (!isRowId(messageId)) throw notFound();
  const row = await data.messageInFamily(db(), messageId, actor.familyId);
  if (!row) throw notFound();
  // Someone outside the pair reads it as no message at all.
  const t = await threadFor(db(), actor, row.thread_id);
  if (row.sender_id !== actor.me.id) throw forbidden("Only whoever made the dish can send its postcard.");
  if (row.kind !== "cooked") throw invalid("id");
  refuseIfOtherLeft(actor, t);
  if (!body.photoKey) throw invalid("photoKey");
  const photoKey = String(body.photoKey);
  const rating = postcardRating(body.rating);
  await once(
    { scope: actor.me.id, key: w.key, route: "POST /v1/messages/:id/postcard", hash: requestHash([messageId, fields(body, POSTCARD_FIELDS)]) },
    async (c) => {
      // Under the row's lock, so two at once see each other's photo and the one replaced is marked.
      const current = await data.messageInFamilyForUpdate(c, messageId, actor.familyId);
      // The same photo again is the same attach, with a new rating at most.
      if (current?.photo_key !== photoKey) {
        await attachFile(c, actor, photoKey, ["photo"]);
        if (current?.photo_key) await markForDeletion(c, [current.photo_key]);
      }
      await data.setPostcard(c, messageId, actor.familyId, photoKey, rating);
      await enqueue(c, { queue: "scheduled", payload: { task: "messages.push_postcard", messageId }, requestId: w.requestId });
      return messageId;
    },
  );
  return await oneMessage(actor, messageId, t);
}

const SEND_RECIPE_FIELDS = ["libraryId", "note", "to"];

export async function sendRecipe(signed: Signed, body: Body, w: Write) {
  const actor = await actorOf(signed);
  const dish = libraryId(body.libraryId, true)!;
  const note = text(body.note, "note", MAX_BODY);
  let targets: Member[];
  if (body.to === "everyone") targets = actor.here.filter((p) => p.id !== actor.me.id);
  else if (Array.isArray(body.to) && body.to.length > 0 && body.to.length <= MAX_RECIPIENTS) {
    targets = [...new Set(body.to.map((id) => personHere(actor, id, "to")))].filter((p) => p.id !== actor.me.id);
  } else throw invalid("to");
  if (targets.length === 0) throw invalid("to");
  await checkDish(actor.familyId, dish);
  const { resourceId } = await once(
    { scope: actor.me.id, key: w.key, route: "POST /v1/send-recipe", hash: requestHash(fields(body, SEND_RECIPE_FIELDS)) },
    async (c) => {
      const sent = await deliverRecipe(c, actor.familyId, actor.me.id, targets.map((p) => p.id), dish, { note }, w.requestId);
      return JSON.stringify(sent);
    },
  );
  return { sent: JSON.parse(resourceId) as { personId: string; threadId: string; messageId: string }[] };
}

/**
 * A recipe to each person, in their pair with the sender, and the hello voice note after it when there is one. In id order, so two senders can't deadlock on
 * threads. Only the recipe message pushes ("Just in from Dad"), never the hello beside it.
 */
export async function deliverRecipe(
  c: PoolClient,
  familyId: string,
  senderId: string,
  recipientIds: string[],
  dish: string,
  o: { note?: string | null; helloKey?: string | null; helloDurationS?: number | null },
  requestId?: string,
): Promise<{ personId: string; threadId: string; messageId: string }[]> {
  const sent = [];
  for (const to of [...recipientIds].sort()) {
    const t = await data.ensurePair(c, familyId, senderId, to);
    const row = await data.insertMessage(c, t, senderId, { kind: "recipe", libraryId: dish, body: o.note ?? null });
    sent.push({ personId: to, threadId: t.id, messageId: row!.id });
    if (o.helloKey) {
      await data.insertMessage(c, t, senderId, { kind: "voice", libraryId: dish, audioKey: o.helloKey, durationS: o.helloDurationS ?? null }, 1);
    }
    await enqueue(c, { queue: "scheduled", payload: { task: "messages.push", messageId: row!.id }, requestId });
  }
  return sent;
}

/** A note from homecookd in the circle ("Sam joined."). The accounts area calls this: its "sender" is who it's about, and it never counts as unread. */
export async function postSystemNote(c: PoolClient, familyId: string, personId: string, body: string): Promise<string> {
  const t = await data.ensureCircle(c, familyId);
  const row = await data.insertMessage(c, t, personId, { kind: "system", body: body.slice(0, MAX_BODY) });
  return row!.id;
}

