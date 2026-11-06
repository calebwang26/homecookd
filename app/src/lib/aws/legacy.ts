// The Messages calls the screens already make (lib/api.ts's `api.*`), answered by the AWS api under AWS_ON (1.1), in the
// shapes the screens read today (Supabase's snake_case). One place turns the AWS answer back, so no screen changes.
// Contract: docs/build/contracts/MESSAGES.md on aws-migration ("What the app calls today, and what replaces it").
//
// Field renames (MESSAGES.md): recipe_id is libraryId, step_order stepOrder, audio_path audioKey, photo_path photoKey,
// reply_to replyTo, duration_s durationS, profile_id personId, other_id otherId. A kid is "learner" on the screens and
// "kid" on /v1. A send gets its own Idempotency-Key, which the client repeats on its own retries.

import type {
  AuthOverride,
  Circle,
  FavoriteResult,
  Message as LegacyMessage,
  NewMessage as LegacyNew,
  OpenQuestion,
  Profile,
  RecipeActivity,
  RecipeEventExtra,
  RecipeEventKind,
  RecipeNote,
  RecipeQuestion,
  RecipeStat,
  SendRecipeResult,
  Share,
  SharePublic,
  ThreadSummary,
} from '../api';

import { messages, type Message, type NewMessage, type Note, type Person, type Thread } from './messages';

export function newKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const as = (o?: AuthOverride) => o?.profileId ?? null;

export function toProfile(p: Person): Profile & { removed?: boolean } {
  return { id: p.id, name: p.name, role: p.role === 'kid' ? 'learner' : 'cook', relation: p.relation, avatar_key: p.avatarKey, ...(p.removed ? { removed: true } : null) };
}

export function toMessage(m: Message): LegacyMessage {
  return {
    id: m.id,
    thread_id: m.threadId,
    sender_id: m.senderId,
    // A photo message (the photo note) has no legacy kind; the screens show it as a postcard-less "cooked" card.
    kind: (m.kind === 'photo' ? 'cooked' : m.kind) as LegacyMessage['kind'],
    body: m.body ?? null,
    recipe_id: m.libraryId ?? null,
    step_order: m.stepOrder ?? null,
    audio_url: m.audioUrl ?? null,
    duration_s: m.durationS ?? null,
    clip_start_s: m.clipStartS ?? null,
    clip_end_s: m.clipEndS ?? null,
    transcript: m.transcript ?? null,
    created_at: m.createdAt,
    reply_to: m.replyTo ?? null,
    answered_by: m.answeredBy ?? null,
    answered_at: m.answeredAt ?? null,
    saved_to_recipe: m.savedToRecipe ?? false,
    note_id: m.noteId ?? null,
    photo_url: m.photoUrl ?? null,
    rating: m.rating ?? null,
  };
}

function toThread(t: Thread): ThreadSummary {
  return {
    id: t.id,
    other: toProfile(t.other),
    last: t.last ? toMessage(t.last) : null,
    unread: t.unread,
    recipe_id: t.libraryId,
    kind: t.kind,
    members: t.members.map(toProfile),
    postcards: t.postcards,
  };
}

/** A screen's send, in the AWS words. */
export function toNew(m: LegacyNew): NewMessage {
  const x = m as Record<string, unknown>;
  const out: Record<string, unknown> = { kind: m.kind };
  const map: [string, string][] = [
    ['body', 'body'],
    ['recipe_id', 'libraryId'],
    ['step_order', 'stepOrder'],
    ['reply_to', 'replyTo'],
    ['audio_path', 'audioKey'],
    ['duration_s', 'durationS'],
    ['transcript', 'transcript'],
    ['clip_start_s', 'clipStartS'],
    ['clip_end_s', 'clipEndS'],
    ['photo_path', 'photoKey'],
  ];
  for (const [from, to] of map) if (x[from] != null) out[to] = x[from];
  // A library clip goes as its key on the media host, without the host (MESSAGES.md: audio_url is clipKey).
  if (typeof x.audio_url === 'string') out.clipKey = x.audio_url.replace(/^https?:\/\/[^/]+\//, '');
  return out as NewMessage;
}

function toNote(n: Note): RecipeNote {
  return {
    id: n.id,
    recipe_id: n.libraryId,
    step_order: n.stepOrder,
    question: n.question,
    question_message_id: n.questionMessageId,
    question_audio_url: n.questionAudioUrl,
    question_duration_s: n.questionDurationS,
    asker: n.asker ? toProfile(n.asker) : null,
    answer_text: n.answerText,
    answer_audio_url: n.answerAudioUrl,
    answer_duration_s: n.answerDurationS,
    answer_message_id: n.answerMessageId ?? '',
    author: toProfile(n.author),
    created_at: n.createdAt,
  };
}

type Stat = { libraryId: string; views: number; lastViewedAt: string | null; cooked: number; lastCookedAt: string | null; favorited: boolean; favoritedAt: string | null; sentToMeAt: string | null };
type Activity = { cooked: { person: Person; at: string; note: string | null }[]; viewed: { person: Person; count: number }[]; lastSentAt: string | null };

/** The `api.*` methods that have moved, with the same signatures; lib/api.ts swaps them in under AWS_ON. */
export const awsMessagesApi = {
  threads: async (o: AuthOverride = {}) => (await messages.threads(as(o))).map(toThread),
  openThread: async (otherId: string, o: AuthOverride = {}) => {
    const t = await messages.openThread(otherId, as(o));
    return { id: t.id, other: toProfile(t.other) };
  },
  circle: async (o: AuthOverride = {}): Promise<Circle> => {
    const c = await messages.circle(as(o));
    return { id: c.id, kind: 'circle', members: c.members.map(toProfile) };
  },
  messages: async (threadId: string, after?: string | null, o: AuthOverride = {}) => (await messages.thread(threadId, after, as(o))).map(toMessage),
  sendMessage: async (threadId: string, msg: LegacyNew, o: AuthOverride = {}) => toMessage(await messages.send(threadId, toNew(msg), newKey(), as(o))),
  markRead: (threadId: string, o: AuthOverride = {}) => messages.markRead(threadId, as(o)),
  unread: async (o: AuthOverride = {}) => ({ total: (await messages.unread(as(o))).total }),
  openQuestions: async (o: AuthOverride = {}): Promise<OpenQuestion[]> =>
    (await messages.openChatQuestions(as(o))).map((q) => ({ message: toMessage(q.message), asker: toProfile(q.asker), thread_kind: q.threadKind })),
  recipeQuestions: async (recipeId: string, o: AuthOverride = {}): Promise<RecipeQuestion[]> =>
    (await messages.dishChatQuestions(recipeId, as(o))).map((q) => ({
      id: q.id,
      thread_id: q.threadId,
      thread_kind: q.threadKind,
      step_order: q.stepOrder,
      body: q.body,
      created_at: q.createdAt,
      asker: toProfile(q.asker),
      mine: q.mine,
      waiting_for: q.waitingFor ? toProfile(q.waitingFor) : null,
    })),
  recipeNotes: async (recipeId: string, o: AuthOverride = {}) => (await messages.notes(recipeId, as(o))).map(toNote),
  saveToRecipe: async (messageId: string, o: AuthOverride = {}) => toNote(await messages.saveNote(messageId, as(o))),
  removeNote: async (noteId: string, o: AuthOverride = {}) => {
    const r = await messages.removeNote(noteId, as(o));
    return { ok: true as const, answer_message_id: r.answerMessageId ?? '', question_message_id: r.questionMessageId };
  },
  postcard: async (messageId: string, input: { photo_path: string; rating?: number | null }, o: AuthOverride = {}) =>
    toMessage(await messages.postcard(messageId, input.photo_path, input.rating, as(o))),
  sendRecipe: async (input: { recipe_id: string; to: string[] | 'everyone'; note?: string | null }, o: AuthOverride = {}): Promise<SendRecipeResult> => {
    const r = await messages.sendRecipe({ libraryId: input.recipe_id, to: input.to, ...(input.note ? { note: input.note } : null) }, newKey(), as(o));
    return { sent: r.sent.map((s) => ({ profile_id: s.personId, thread_id: s.threadId, message_id: s.messageId })) };
  },
  createShare: (recipeId: string, o: AuthOverride = {}): Promise<Share> => messages.share(recipeId, as(o)),
  share: async (token: string): Promise<SharePublic> => {
    const s = await messages.openShare(token);
    return {
      token: s.token,
      recipe_id: s.libraryId,
      recipe_url: s.recipeUrl,
      sender: s.sender ? { name: s.sender.name, relation: s.sender.relation, avatar_key: s.sender.avatarKey } : null,
      family_name: s.familyName ?? '',
    };
  },
  pendingSend: (input: { job_id: string; recipient_ids: string[]; hello_path?: string | null; hello_duration_s?: number | null }, o: AuthOverride = {}) =>
    messages.pendingSend(
      {
        uploadId: input.job_id.replace(/\/+$/, ''),
        recipientIds: input.recipient_ids,
        ...(input.hello_path ? { helloKey: input.hello_path } : null),
        ...(input.hello_duration_s ? { helloDurationS: input.hello_duration_s } : null),
      },
      newKey(),
      as(o),
    ),
  event: (recipeId: string, kind: RecipeEventKind, extra: RecipeEventExtra = {}, o: AuthOverride = {}) =>
    messages.event(
      {
        libraryId: recipeId,
        kind,
        ...(extra.cook_id ? { cookId: extra.cook_id } : null),
        ...(extra.duration_s != null ? { durationS: extra.duration_s } : null),
        ...(extra.start_s != null ? { startS: extra.start_s } : null),
      },
      as(o),
    ),
  favorites: async (o: AuthOverride = {}) => ({ recipe_ids: await messages.favorites(as(o)) }),
  setFavorite: async (recipeId: string, on: boolean, o: AuthOverride = {}): Promise<FavoriteResult> => {
    await messages.setFavorite(recipeId, on, as(o));
    return { ok: true, recipe_id: recipeId, on, recipe_ids: await messages.favorites(as(o)) };
  },
  recipeStats: async (o: AuthOverride = {}): Promise<RecipeStat[]> =>
    ((await messages.myStats(as(o))) as Stat[]).map((s) => ({
      recipe_id: s.libraryId,
      views: s.views,
      last_viewed_at: s.lastViewedAt,
      cooked: s.cooked,
      last_cooked_at: s.lastCookedAt,
      favorited: s.favorited,
      favorited_at: s.favoritedAt,
      sent_to_me_at: s.sentToMeAt,
    })),
  // Push tokens go through lib/live/pushTokens on AWS (as the phone's own person, with the zone): these two are no-ops.
  pushToken: async (_input: { token: string; platform: 'ios' | 'android' }, _o: AuthOverride = {}) => ({ ok: true as const }),
  removePushToken: async (_input: { token: string }, _o: AuthOverride = {}) => ({ ok: true as const }),
  activity: async (recipeId: string, o: AuthOverride = {}): Promise<RecipeActivity> => {
    const a = (await messages.activity(recipeId, as(o))) as Activity;
    return {
      cooked: a.cooked.map((c) => ({ profile: toProfile(c.person), at: c.at, note: c.note })),
      viewed: a.viewed.map((v) => ({ profile: toProfile(v.person), count: v.count })),
      last_sent_at: a.lastSentAt,
    };
  },
};
