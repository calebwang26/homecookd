// Messages and questions for 1.1: the family circle and one-to-one threads, messages, chat and cook-mode questions,
// recipe notes, voice and photo uploads, postcards and the photo note, shares, send-recipe and pending sends,
// hearts, events and stats, the table and the recap, and push tokens. Contract: docs/build/contracts/MESSAGES.md on
// aws-migration. Screens move onto these behind AWS_ON (config.ts); nothing calls them while it's off.
//
// Two ids for a dish: chat, notes, shares, hearts, events and stats take a `libraryId`; cook-mode questions, the photo
// note, photo messages and "made my dish" take a family recipe's `_id` (`recipeId`). Times are ISO text. Every write
// that creates what someone wrote takes an Idempotency-Key, and the app repeats it only with the same key.

import { request } from './client';

export type Person = { id: string; name: string; role: 'cook' | 'kid'; relation: string | null; avatarKey: string | null; removed?: boolean };

export type MessageKind = 'text' | 'voice' | 'step' | 'recipe' | 'cooked' | 'request' | 'question' | 'reaction' | 'photo' | 'system';

export type Message = {
  id: string;
  threadId: string;
  senderId: string;
  createdAt: string;
  kind: MessageKind;
  body?: string | null;
  libraryId?: string | null;
  stepOrder?: number | null;
  recipeId?: string | null;
  audioUrl?: string | null;
  durationS?: number | null;
  transcript?: string | null;
  clipStartS?: number | null;
  clipEndS?: number | null;
  photoUrl?: string | null;
  rating?: number | null;
  replyTo?: string | null;
  aiDrafted?: boolean;
  answeredBy?: string | null;
  answeredAt?: string | null;
  savedToRecipe?: boolean;
  noteId?: string | null;
};

export type Thread = {
  id: string;
  kind: 'circle' | 'pair';
  other: Person;
  members: Person[];
  last: Message | null;
  unread: number;
  libraryId: string | null;
  postcards: number;
};

/** What a send carries (`POST /v1/threads/:id/messages`); which fields each kind needs is in MESSAGES.md, "Sending". */
export type NewMessage = {
  kind: Exclude<MessageKind, 'photo' | 'system'>;
  body?: string;
  libraryId?: string;
  stepOrder?: number;
  replyTo?: string;
  audioKey?: string;
  clipKey?: string;
  durationS?: number;
  transcript?: string;
  clipStartS?: number;
  clipEndS?: number;
  photoKey?: string;
};

export type Question = {
  id: string;
  familyId: string;
  recipeId: string;
  recipeTitle: string;
  stepOrder: number | null;
  createdAt: string;
  askedBy: string;
  askedByName: string;
  text: string;
  /** The question in the cook's language, once the task has run. Show `textForCook ?? text`. */
  textForCook: string | null;
  kind: 'cooking' | 'share' | 'followUp';
  status: 'asked_cook' | 'answered' | 'found_in_video';
  found: { startS: number; endS: number; quote: string } | null;
  answer: { by: string; text: string | null; transcript: string | null; translation: string | null; at: string } | null;
  answerAudioUrl: string | null;
};

export type Note = {
  id: string;
  libraryId: string;
  stepOrder: number | null;
  question: string | null;
  questionMessageId: string | null;
  questionAudioUrl: string | null;
  questionDurationS: number | null;
  asker: Person | null;
  answerText: string | null;
  answerAudioUrl: string | null;
  answerDurationS: number | null;
  answerMessageId: string | null;
  author: Person;
  createdAt: string;
};

export type UploadKind = 'voice' | 'photo';
export type NewFile = { key: string; kind: UploadKind; contentType: string; size: number; uploadUrl: string; uploadHeaders: Record<string, string>; expiresInS: number; maxBytes: number };

/** The types flow 4 takes, and the 20 MB cap: checked before asking for a link. */
export const UPLOAD_TYPES: Record<UploadKind, readonly string[]> = {
  voice: ['audio/m4a', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/ogg'],
  photo: ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/webp'],
};
export const UPLOAD_MAX_BYTES = 20_971_520;

export function checkUpload(kind: UploadKind, contentType: string, size: number): 'type' | 'size' | null {
  if (!UPLOAD_TYPES[kind].includes(contentType.toLowerCase())) return 'type';
  return Number.isInteger(size) && size > 0 && size <= UPLOAD_MAX_BYTES ? null : 'size';
}

type Page<K extends string, T> = { [P in K]: T[] } & { nextCursor: string | null };

const enc = encodeURIComponent;
const q = (params: Record<string, string | number | null | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${enc(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

/** Every page of a list, following nextCursor (a guard of `maxPages`). */
async function all<K extends string, T>(key: K, read: (cursor: string | null) => Promise<Page<K, T>>, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page: Page<K, T> = await read(cursor);
    out.push(...page[key]);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

export const messages = {
  // Threads and messages.
  threads: (as?: string | null) => all('threads', (cursor) => request<Page<'threads', Thread>>(`/v1/threads${q({ cursor })}`, { auth: 'session', as })),
  openThread: (otherId: string, as?: string | null) => request<{ id: string; other: Person }>('/v1/threads', { auth: 'session', as, body: { otherId } }),
  circle: (as?: string | null) => request<{ id: string; kind: 'circle'; members: Person[] }>('/v1/circle', { auth: 'session', as }),
  unread: (as?: string | null) => request<{ total: number; lastMessageAt: string | null }>('/v1/unread', { auth: 'session', as }),
  /** A thread's newest page, oldest first; or everything since `after` (a createdAt as it came), following nextCursor. */
  async thread(threadId: string, after?: string | null, as?: string | null): Promise<Message[]> {
    const path = (cursor: string | null) => `/v1/threads/${enc(threadId)}/messages${q({ after, cursor })}`;
    if (!after) return (await request<Page<'messages', Message>>(path(null), { auth: 'session', as })).messages;
    // More than a page waiting: page back with the cursor, keeping `after`, and put them in order.
    const pages: Message[][] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page: Page<'messages', Message> = await request<Page<'messages', Message>>(path(cursor), { auth: 'session', as });
      pages.unshift(page.messages);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return pages.flat();
  },
  send: (threadId: string, msg: NewMessage, idempotencyKey: string, as?: string | null) =>
    request<Message>(`/v1/threads/${enc(threadId)}/messages`, { auth: 'session', as, body: msg, idempotencyKey }),
  markRead: (threadId: string, as?: string | null) => request<{ ok: true }>(`/v1/threads/${enc(threadId)}/read`, { auth: 'session', as, body: {} }),
  /** A message to one person (`to`) or the circle (no `to`): text, voice or a photo with its note. */
  sendTo: (
    msg: { kind: 'text' | 'voice' | 'photo'; text?: string; audioKey?: string; photoKey?: string; to?: string; recipeId?: string; aiDrafted?: boolean },
    idempotencyKey: string,
    as?: string | null,
  ) => request<Message>('/v1/messages', { auth: 'session', as, body: msg, idempotencyKey }),
  madeMyDish: (as?: string | null) =>
    request<{ messageId: string; fromName: string; recipeTitle: string; libraryId: string | null; photoUrl: string; text: string | null; at: string } | null>(
      '/v1/messages/made-my-dish',
      { auth: 'session', as },
    ),

  // Cook-mode questions (a kid asks in cook mode; a cook answers).
  ask: (input: { recipeId: string; stepOrder?: number; text: string }, idempotencyKey: string, as?: string | null) =>
    request<{ questionId: string; status: 'asked_cook' | 'found_in_video' }>('/v1/questions', { auth: 'session', as, body: input, idempotencyKey }),
  openQuestions: (as?: string | null) =>
    all('questions', (cursor) => request<Page<'questions', Question>>(`/v1/questions/open${q({ cursor })}`, { auth: 'session', as })),
  recipeQuestions: (recipeId: string, as?: string | null) =>
    all('questions', (cursor) => request<Page<'questions', Question>>(`/v1/recipes/${enc(recipeId)}/questions${q({ cursor })}`, { auth: 'session', as })),
  /** Typed (`text`) or by voice (`audioKey`, an upload of kind voice). A second answer is 409 `answered`. */
  answer: (questionId: string, a: { text?: string; audioKey?: string }, idempotencyKey: string, as?: string | null) =>
    request<{ ok: true }>(`/v1/questions/${enc(questionId)}/answer`, { auth: 'session', as, body: a, idempotencyKey }),

  // Chat questions and recipe notes.
  openChatQuestions: (as?: string | null) =>
    request<{ message: Message; asker: Person; threadKind: 'circle' | 'pair' }[]>('/v1/chat-questions/open', { auth: 'session', as }),
  dishChatQuestions: (libraryId: string, as?: string | null) =>
    request<
      { id: string; threadId: string; threadKind: 'circle' | 'pair'; stepOrder: number | null; body: string | null; createdAt: string; asker: Person; mine: boolean; waitingFor: Person | null }[]
    >(`/v1/dishes/${enc(libraryId)}/chat-questions`, { auth: 'session', as }),
  notes: (libraryId: string, as?: string | null) =>
    all('notes', (cursor) => request<Page<'notes', Note>>(`/v1/dishes/${enc(libraryId)}/notes${q({ cursor })}`, { auth: 'session', as })),
  saveNote: (messageId: string, as?: string | null) => request<Note>('/v1/notes', { auth: 'session', as, body: { messageId } }),
  removeNote: (noteId: string, as?: string | null) =>
    request<{ ok: true; answerMessageId: string | null; questionMessageId: string | null }>(`/v1/notes/${enc(noteId)}/remove`, { auth: 'session', as, body: {} }),

  // Uploads: ask for a link, PUT the exact bytes with exactly uploadHeaders within 2 minutes, then confirm.
  newFile: (kind: UploadKind, contentType: string, size: number, as?: string | null) =>
    request<NewFile>('/v1/uploads', { auth: 'session', as, body: { kind, contentType, size } }),
  confirmFile: (key: string, as?: string | null) =>
    request<{ key: string; kind: UploadKind; contentType: string }>('/v1/uploads/confirm', { auth: 'session', as, body: { key } }),

  // Postcards and the photo note.
  postcard: (messageId: string, photoKey: string, rating?: number | null, as?: string | null) =>
    request<Message>(`/v1/messages/${enc(messageId)}/postcard`, { auth: 'session', as, body: rating ? { photoKey, rating } : { photoKey } }),
  photoNote: (recipeId: string, photoKey: string, as?: string | null) =>
    request<{ draft: string; aiDrafted: true }>('/v1/messages/photo-note', { auth: 'session', as, body: { recipeId, photoKey }, timeoutMs: 100_000 }),

  // Share asks (MESSAGES.md, "Share asks"): anyone asks a dish's cook to put it on the map; the cook's own tap shares it.
  shareAsk: (recipeId: string, as?: string | null) => request<{ result: 'asked' | 'shared' }>('/v1/share-requests', { auth: 'session', as, body: { recipeId } }),
  shareDishes: (as?: string | null) =>
    all('dishes', (cursor) =>
      request<Page<'dishes', { recipeId: string; dish: string; cookName: string; mine: boolean; shared: boolean; asked: boolean; notNowAt: number | null }>>(
        `/v1/share-requests/dishes${q({ cursor })}`,
        { auth: 'session', as },
      ),
    ),

  // Shares, sending a recipe, recordings on their way.
  share: (libraryId: string, as?: string | null) => request<{ token: string; url: string }>('/v1/shares', { auth: 'session', as, body: { libraryId } }),
  openShare: (token: string) =>
    request<{ token: string; libraryId: string; recipeUrl: string; sender: { name: string; relation: string | null; avatarKey: string | null } | null; familyName: string | null }>(
      '/v1/shares/open',
      { auth: 'none', body: { token } },
    ),
  sendRecipe: (input: { libraryId: string; note?: string; to: 'everyone' | string[] }, idempotencyKey: string, as?: string | null) =>
    request<{ sent: { personId: string; threadId: string; messageId: string }[] }>('/v1/send-recipe', { auth: 'session', as, body: input, idempotencyKey }),
  pendingSend: (input: { uploadId: string; recipientIds: string[]; helloKey?: string; helloDurationS?: number }, idempotencyKey: string, as?: string | null) =>
    request<{ ok: true; delivered?: number }>('/v1/pending-sends', { auth: 'session', as, body: input, idempotencyKey }),

  // Hearts, events, stats, the table and the recap.
  event: (input: { libraryId: string; kind: 'viewed' | 'cooked' | 'started' | 'heard'; cookId?: string; durationS?: number; startS?: number }, as?: string | null) =>
    request<{ ok: true; counted: boolean }>('/v1/events', { auth: 'session', as, body: input }),
  favorites: (as?: string | null) =>
    all('libraryIds', (cursor) => request<Page<'libraryIds', string>>(`/v1/favorites${q({ cursor })}`, { auth: 'session', as })),
  setFavorite: (libraryId: string, on: boolean, as?: string | null) =>
    request<{ ok: true; libraryId: string; on: boolean }>('/v1/favorites', { auth: 'session', as, body: { libraryId, on } }),
  myStats: (as?: string | null) => all('stats', (cursor) => request<Page<'stats', unknown>>(`/v1/me/recipe-stats${q({ cursor })}`, { auth: 'session', as })),
  dishStats: (ids: string[], as?: string | null) => request<Record<string, unknown>>(`/v1/dish-stats${q({ ids: ids.join(',') })}`, { auth: 'session', as }),
  heartsRecent: (since?: string | null, as?: string | null) =>
    request<{ personId: string; libraryId: string; at: string }[]>(`/v1/hearts/recent${q({ since })}`, { auth: 'session', as }),
  activity: (libraryId: string, as?: string | null) => request<unknown>(`/v1/dishes/${enc(libraryId)}/activity`, { auth: 'session', as }),
  /** Supabase's shape, unchanged. `tz` is the phone's IANA zone. */
  table: (tz: string | null, as?: string | null) => request<unknown>('/v1/table', { auth: 'session', as, headers: tz ? { 'x-tz': tz } : undefined }),
  recap: (month?: string | null, as?: string | null) => request<unknown>(`/v1/recap${q({ month })}`, { auth: 'session', as }),

  // Push tokens: register only with this phone's own person's session, never a lent phone's (MESSAGES.md flow 9).
  // `owner` is this phone's own person (sign-in's profile_id), passed explicitly so it can't be whoever borrowed it.
  registerPush: (input: { token: string; platform: 'ios' | 'android'; tz?: string | null }, owner: string) =>
    request<{ ok: true }>('/v1/push-tokens', { auth: 'session', as: owner, body: input }),
  removePush: (token: string, owner: string) => request<{ ok: true }>('/v1/push-tokens/remove', { auth: 'session', as: owner, body: { token } }),
};
