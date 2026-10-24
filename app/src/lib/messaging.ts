// Family messages on top of lib/api.ts: inbox + chat hooks with polling and an optimistic send
// queue, plus one-call actions for the screens.
//
//   const { threads, loading, refresh } = useThreads();            // polls every 8 s while focused
//   const chat = useThread(threadId);                               // polls every 3 s, marks read
//   chat.messages, chat.other, chat.send({ kind: 'text', body }), chat.sendVoice(recording), chat.retry(m)
//
//   const threadId = await openChatWith(otherProfileId);
//   const circleId = await openCircle();                            // the family circle thread
//   const { questions, all } = useOpenQuestions();                  // open circle questions; all = + 1:1 ones asked of me
//   const list = inboxOrder(threads);                               // the family circle first, then newest chats
//   useKnownSenders(ids);                                           // someone new wrote: fetch the family once
//   await saveToRecipe(threadId, messageId);                        // "Save to recipe" (a cook's own message)
//   await removeNote({ id, recipe_id, answer_message_id });         // "Undo" / "Remove": take a saved answer out
//   onNoteRemoved((ids) => ...);                                    // tells caches outside this file (kitchen's)
//   const { notes } = useRecipeNotes('dad-sunday-chili');           // answers saved into the recipe
//   const { questions } = useRecipeQuestions('dad-sunday-chili');   // open questions about it (cook mode)
//   await sendRecipe('dad-sunday-chili', [leoId], 'Try it Sunday');
//   const r = await cooked('dad-sunday-chili', 'Made it!');         // 'cooked' event + message to the cook ({ eventSaved, sendFailed, … })
//   await sendPostcard({ recipeId, cooked: r.ref, photo, rating: 4 }); // the postcard on that cooked card (PR 3)
//   await sendJustLikeMine(threadId, cookedMessage);                // the cook's one-tap answer to a postcard
//   await sendVoiceReply(threadId, recording, cookedMessage.id);    // hold to talk on the postcard (no chat open)
//   await request({ to: momId, dish: 'Sunday eggs' });              // "Will you teach me your Sunday eggs?"
//   logViewed(recipeId); const { activity } = useRecipeActivity(recipeId);
// A learner's question reaching the server, and a cook's recipe card going out, may open the push
// explainer (components/push/PushAskSheet askForPush, which decides whether to ask at all).
//
// All calls act as the current profile (SessionProvider keeps the API headers in sync).
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { askForPush, askForPushSoon } from '@/components/push/PushAskSheet';

import {
  api,
  ApiError,
  errorMessage,
  getApiAuth,
  type Message,
  type NewMessage,
  type OpenQuestion,
  type Profile,
  type RecipeActivity,
  type RecipeNote,
  type RecipeQuestion,
  type ThreadKind,
  type ThreadSummary,
} from './api';
import { cookProfile, getCachedEntry, getCachedRecipe } from './recipes';
import { getSession, refreshUnread, useSession } from './session';
import { invalidateTable } from './tableApi';
import { uploadPhoto, type Photo } from './photos';
import { isPostcard, watchForPostcard } from './postcardLogic';
import { uploadVoice, type VoiceRecording } from './voice';

export const INBOX_POLL_MS = 8_000;
export const CHAT_POLL_MS = 3_000;

/** A message as the chat shows it: server messages, plus optimistic ones still sending / failed. */
export type ChatMessage = Message & {
  /** Set on optimistic bubbles only. */
  local?: 'sending' | 'failed';
  localId?: string;
  /** Local file to play / resend for an optimistic voice note. */
  localUri?: string;
};

// ---------------------------------------------------------------------------------------------
// Tiny store helper

function createStore<T>(initial: T) {
  let value = initial;
  const ls = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T | ((prev: T) => T)) => {
      value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      for (const l of ls) l();
    },
    subscribe: (l: () => void) => {
      ls.add(l);
      return () => {
        ls.delete(l);
      };
    },
  };
}

const meId = () => getApiAuth().profileId ?? '';
const familyKey = () => { const a = getApiAuth(); return a.key ?? a.code ?? ''; };

// ---------------------------------------------------------------------------------------------
// Polling

/** Runs `fn` now and every `ms` while `enabled` and the app is in the foreground. */
export function usePolling(fn: () => void | Promise<unknown>, ms: number, enabled: boolean) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!enabled || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        await fnRef.current();
      } catch {
        // the hook's own state carries the error
      }
      if (!stopped) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, active, ms]);
}

/** useIsFocused, but true outside a navigator (e.g. a sheet rendered at the root). */
function useFocusedSafe(): boolean {
  try {
    return useIsFocused();
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Inbox

type InboxState = { owner: string; threads: ThreadSummary[] | null; error: string | null; loading: boolean };
const inbox = createStore<InboxState>({ owner: '', threads: null, error: null, loading: false });
/** The other person (`removed` when they left the family: the chat is read-only). */
const otherByThread = new Map<string, ThreadSummary['other']>();
/** Thread kind + members (the circle needs everyone's face and name). */
const metaByThread = new Map<string, { kind: ThreadKind; members: Profile[] }>();

function rememberMeta(t: Pick<ThreadSummary, 'id' | 'other' | 'kind' | 'members'>) {
  otherByThread.set(t.id, t.other);
  if (t.kind) metaByThread.set(t.id, { kind: t.kind, members: t.members ?? [] });
}

async function loadThreads(): Promise<ThreadSummary[] | null> {
  const owner = meId();
  if (!owner) return null;
  if (inbox.get().owner !== owner) inbox.set({ owner, threads: null, error: null, loading: true });
  else inbox.set((s) => ({ ...s, loading: true }));
  try {
    const threads = await api.threads();
    if (meId() !== owner) return null;
    for (const t of threads) rememberMeta(t);
    inbox.set({ owner, threads, error: null, loading: false });
    return threads;
  } catch (e) {
    if (meId() === owner) inbox.set((s) => ({ ...s, error: errorMessage(e), loading: false }));
    return null;
  }
}

/** Inbox order: the family circle first, then every 1:1 chat, newest message first. */
export function inboxOrder(threads: ThreadSummary[]): ThreadSummary[] {
  const at = (t: ThreadSummary) => t.last?.created_at ?? '';
  return [...threads].sort((a, b) => {
    const ac = a.kind === 'circle' ? 1 : 0;
    const bc = b.kind === 'circle' ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0;
  });
}

/** Re-fetch the inbox now (e.g. after sending a recipe). */
export function refreshThreads() {
  return loadThreads();
}

export function useThreads(opts: { poll?: boolean } = {}) {
  const { me, status } = useSession();
  const focused = useFocusedSafe();
  const s = useSyncExternalStore(inbox.subscribe, inbox.get, inbox.get);
  const mine = s.owner === (me?.id ?? '');
  usePolling(
    async () => {
      await loadThreads();
      refreshUnread();
    },
    INBOX_POLL_MS,
    (opts.poll ?? true) && focused && !!me && status === 'ready',
  );
  return {
    threads: mine ? s.threads ?? [] : [],
    /** True until the first answer (or the first failure) for this profile. */
    loading: !mine || (s.threads == null && !s.error),
    error: mine ? s.error : null,
    refresh: loadThreads,
  };
}

// ---------------------------------------------------------------------------------------------
// One chat

type ChatState = {
  messages: ChatMessage[];
  loaded: boolean;
  error: string | null;
  /** Poll cursor: only GET responses move it (my own sends must not skip the other person's). */
  cursor: string | null;
  /** When the whole thread was last fetched (voice URLs are signed for 1 h). */
  fullAt: number;
  /** The thread is unknown or not ours (404): stop polling. */
  gone: boolean;
};
const chats = new Map<string, ReturnType<typeof createStore<ChatState>>>();
const emptyChat: ChatState = { messages: [], loaded: false, error: null, cursor: null, fullAt: 0, gone: false };
/** Re-fetch the whole thread after this long, so signed voice URLs stay fresh. */
const FULL_REFRESH_MS = 45 * 60 * 1000;

function chatStore(threadId: string) {
  const key = `${meId()}:${threadId}`;
  let s = chats.get(key);
  if (!s) {
    s = createStore<ChatState>(emptyChat);
    chats.set(key, s);
  }
  return s;
}

/** Adds server messages (deduped by id), keeping optimistic ones at the end. */
function mergeServer(list: ChatMessage[], incoming: Message[]): ChatMessage[] {
  if (!incoming.length) return list;
  const have = new Set(list.filter((m) => !m.local).map((m) => m.id));
  const server = list.filter((m) => !m.local);
  const pending = list.filter((m) => m.local);
  for (const m of incoming) if (!have.has(m.id)) server.push(m);
  server.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  return [...server, ...pending];
}

/** Server ids of messages I know I sent this session (each stands for one send, never two). */
const claimed = new Set<string>();
const norm = (v: string | null | undefined) => (v ?? '').trim();
/** The server already holds this optimistic bubble's message (from me, same content, sent around then). */
function sameSend(local: ChatMessage, m: Message): boolean {
  return (
    !m.id.startsWith('local-') &&
    m.sender_id === local.sender_id &&
    m.kind === local.kind &&
    norm(m.body) === norm(local.body) &&
    (m.recipe_id ?? null) === (local.recipe_id ?? null) &&
    (m.step_order ?? null) === (local.step_order ?? null) &&
    (m.reply_to ?? null) === (local.reply_to ?? null) &&
    Date.parse(m.created_at) >= Date.parse(local.created_at) - 60_000
  );
}
/**
 * A send the server stored but whose answer we lost (timeout, dropped connection) leaves a failed
 * bubble beside the real message: drop the bubble (and its draft) so "Tap to try again" can't post
 * a second copy.
 */
function absorbFailed(list: ChatMessage[]): ChatMessage[] {
  if (!list.some((m) => m.local === 'failed')) return list;
  const server = list.filter((m) => !m.local);
  const out: ChatMessage[] = [];
  for (const m of list) {
    if (m.local === 'failed') {
      const hit = server.find((x) => !claimed.has(x.id) && sameSend(m, x));
      if (hit) {
        claimed.add(hit.id);
        if (m.localId) drafts.delete(m.localId);
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

/**
 * Puts a just-sent message into the thread's cache (so the chat shows it instantly). A reaction never
 * becomes the inbox's newest message or moves the chat up (the server keeps it out of `last` too).
 */
function remember(threadId: string, m: Message) {
  claimed.add(m.id);
  const s = chatStore(threadId);
  s.set((st) => ({ ...st, messages: mergeServer(st.messages, [m]) }));
  if (m.kind === 'reaction') return;
  inbox.set((st) =>
    st.threads
      ? {
          ...st,
          threads: [
            ...st.threads
              .filter((t) => t.id === threadId)
              .map((t) => ({ ...t, last: m, recipe_id: m.recipe_id ?? t.recipe_id })),
            ...st.threads.filter((t) => t.id !== threadId),
          ],
        }
      : st,
  );
}

/**
 * A message the server changed in place (a postcard on a `cooked` card): swap it into the thread's
 * cache and, if it is the inbox's newest, there too. Polls only bring newer messages, so without this
 * an open chat would keep the card without its photo until the next full fetch.
 */
function replaceCached(threadId: string, m: Message) {
  claimed.add(m.id);
  chatStore(threadId).set((st) => ({
    ...st,
    messages: st.messages.some((x) => x.id === m.id) ? st.messages.map((x) => (x.id === m.id ? { ...x, ...m } : x)) : mergeServer(st.messages, [m]),
  }));
  inbox.set((st) => (st.threads ? { ...st, threads: st.threads.map((t) => (t.id === threadId && t.last?.id === m.id ? { ...t, last: m } : t)) } : st));
}

async function fetchNew(threadId: string): Promise<Message[]> {
  const s = chatStore(threadId);
  const incoming = await api.messages(threadId, s.get().cursor);
  s.set((st) => ({
    ...st,
    messages: absorbFailed(mergeServer(st.messages, incoming)),
    cursor: incoming.length ? incoming[incoming.length - 1].created_at : st.cursor,
    loaded: true,
    error: null,
    gone: false,
  }));
  return incoming;
}

/** Fetches the whole thread and replaces the server messages (fresh signed voice URLs), keeping local ones. */
async function fetchAll(threadId: string): Promise<Message[]> {
  const s = chatStore(threadId);
  const all = await api.messages(threadId);
  s.set((st) => {
    const fresh = new Map(all.map((m) => [m.id, m]));
    // Keep server messages the full list somehow lacks (just sent, not yet visible), updated where we can.
    const kept = st.messages.filter((m) => !m.local && !fresh.has(m.id));
    const pending = st.messages.filter((m) => m.local);
    return {
      ...st,
      messages: absorbFailed(mergeServer([...kept, ...pending], all)),
      cursor: all.length ? all[all.length - 1].created_at : st.cursor,
      fullAt: Date.now(),
      loaded: true,
      error: null,
      gone: false,
    };
  });
  return all;
}

/** Re-fetch a thread in full now (e.g. when a voice note's signed URL has expired). */
export function refreshThreadMedia(threadId: string) {
  return fetchAll(threadId).catch(() => []);
}

async function markRead(threadId: string) {
  try {
    await api.markRead(threadId);
  } catch {
    return;
  }
  inbox.set((st) => (st.threads ? { ...st, threads: st.threads.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)) } : st));
  refreshUnread();
}

let seq = 0;
const tempId = () => `local-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function optimistic(threadId: string, draft: NewMessage, extra: Partial<ChatMessage> = {}): ChatMessage {
  const d = draft as Partial<Message> & { kind: Message['kind'] };
  const id = tempId();
  return {
    id,
    localId: id,
    local: 'sending',
    thread_id: threadId,
    sender_id: meId(),
    kind: d.kind,
    body: d.body ?? null,
    recipe_id: d.recipe_id ?? null,
    step_order: d.step_order ?? null,
    audio_url: d.audio_url ?? null,
    duration_s: d.duration_s ?? null,
    clip_start_s: d.clip_start_s ?? null,
    clip_end_s: d.clip_end_s ?? null,
    transcript: d.transcript ?? null,
    created_at: new Date().toISOString(),
    reply_to: d.reply_to ?? null,
    answered_by: null,
    answered_at: null,
    saved_to_recipe: false,
    ...extra,
  };
}

/**
 * Extra fields for a voice note. `kind: 'question'` sends it as a spoken question (the family
 * circle); `reply_to` answers a message in the same thread.
 */
export type VoiceExtra = {
  kind?: 'voice' | 'question';
  recipe_id?: string | null;
  step_order?: number | null;
  reply_to?: string | null;
  transcript?: string | null;
  clip_start_s?: number;
  clip_end_s?: number;
};

type Draft = { kind: 'draft'; message: NewMessage } | { kind: 'voice'; recording: VoiceRecording; extra?: VoiceExtra };
const drafts = new Map<string, Draft>();

function voiceMessage(path: string, duration_s: number, extra: VoiceExtra = {}): NewMessage {
  const { kind = 'voice', ...rest } = extra;
  if (kind === 'question') {
    return {
      kind: 'question',
      audio_path: path,
      duration_s,
      transcript: rest.transcript ?? null,
      recipe_id: rest.recipe_id ?? null,
      step_order: rest.recipe_id ? (rest.step_order ?? null) : null,
      reply_to: rest.reply_to ?? null,
    };
  }
  return { kind: 'voice', audio_path: path, duration_s, ...rest };
}

/** A cook's reply landed: the question it answers (circle or 1:1) is answered, here and in the open list. */
function markAnswered(threadId: string, reply: Message) {
  if (!reply.reply_to) return;
  const qid = reply.reply_to;
  chatStore(threadId).set((st) => ({
    ...st,
    messages: st.messages.map((m) =>
      m.id === qid && (m.kind === 'question' || m.kind === 'step') && !m.answered_by
        ? { ...m, answered_by: reply.sender_id, answered_at: reply.created_at }
        : m,
    ),
  }));
  openStore.set((st) => (st.items ? { ...st, items: st.items.filter((q) => q.message.id !== qid) } : st));
  if (reply.saved_to_recipe) notesChanged(reply.recipe_id ?? chatStore(threadId).get().messages.find((m) => m.id === qid)?.recipe_id ?? null);
}

async function deliver(threadId: string, localId: string) {
  const d = drafts.get(localId);
  if (!d) return;
  const s = chatStore(threadId);
  s.set((st) => ({ ...st, messages: st.messages.map((m) => (m.localId === localId ? { ...m, local: 'sending' } : m)) }));
  try {
    let body: NewMessage;
    if (d.kind === 'voice') {
      const { path, duration_s } = await uploadVoice(d.recording);
      body = voiceMessage(path, duration_s, d.extra);
    } else {
      body = d.message;
    }
    const saved = await api.sendMessage(threadId, body);
    claimed.add(saved.id);
    drafts.delete(localId);
    // Any message to family can light a face at the Sunday table: ask again on the next look.
    invalidateTable();
    // Swap the optimistic bubble for the stored message (keeping its place).
    s.set((st) => {
      const without = st.messages.filter((m) => m.localId !== localId && m.id !== saved.id);
      return { ...st, messages: mergeServer(without, [saved]) };
    });
    remember(threadId, saved);
    if (getSession()?.me?.role === 'cook') markAnswered(threadId, saved);
    else askAfterQuestion(threadId, saved);
  } catch (e) {
    s.set((st) => ({
      ...st,
      error: errorMessage(e),
      messages: st.messages.map((m) => (m.localId === localId ? { ...m, local: 'failed' } : m)),
    }));
    // The server may have stored it anyway: look, and drop the failed bubble if so.
    if (e instanceof ApiError && (e.kind === 'timeout' || e.kind === 'network')) {
      await fetchNew(threadId).catch(() => null);
      s.set((st) => ({ ...st, messages: absorbFailed(st.messages) }));
    }
  }
}

export function useThread(threadId: string | null | undefined, opts: { poll?: boolean; markRead?: boolean } = {}) {
  const { me, status, profileById } = useSession();
  const focused = useFocusedSafe();
  const id = threadId ?? '';
  const store = id && me ? chatStore(id) : null;
  const state = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store ? store.get : getEmpty,
    store ? store.get : getEmpty,
  );
  const [other, setOther] = useState<ThreadSummary['other'] | null>(() => (id ? otherByThread.get(id) ?? null : null));
  const [meta, setMeta] = useState(() => (id ? metaByThread.get(id) ?? null : null));
  const shouldMark = opts.markRead ?? true;
  const readOnce = useRef(false);
  // The first poll after each mount fetches the whole thread (old signed voice URLs expire).
  const fullOnce = useRef(false);
  // A postcard lands on a card already here (lib/postcardLogic watchForPostcard): the thread's
  // postcard count as last seen, and when the inbox was last asked.
  const postcards = useRef<number | null>(null);
  const inboxAt = useRef(0);
  useEffect(() => {
    fullOnce.current = false;
    postcards.current = null;
    inboxAt.current = 0;
  }, [id]);

  // Who is on the other side (from the inbox cache, else one GET /threads).
  useEffect(() => {
    if (!id || !me) return;
    const known = otherByThread.get(id);
    if (known && metaByThread.has(id)) {
      setOther(known);
      setMeta(metaByThread.get(id) ?? null);
      return;
    }
    let alive = true;
    loadThreads().then((list) => {
      const t = list?.find((x) => x.id === id);
      if (alive && t) {
        setOther(t.other);
        setMeta(metaByThread.get(id) ?? null);
      }
    });
    return () => {
      alive = false;
    };
  }, [id, me]);

  usePolling(
    async () => {
      if (!id) return;
      try {
        const st = chatStore(id).get();
        const full = !fullOnce.current || Date.now() - st.fullAt > FULL_REFRESH_MS;
        const known = new Set(st.messages.map((m) => m.id));
        const incoming = full ? await fetchAll(id) : await fetchNew(id);
        fullOnce.current = true;
        if (full) postcards.current = incoming.filter(isPostcard).length;
        // The cursor brings only newer messages; a postcard changes a card already here. While one may
        // still come, check the inbox's count (every INBOX_POLL_MS) and fetch everything when it moves.
        const now = Date.now();
        if (!full && now - inboxAt.current >= INBOX_POLL_MS && watchForPostcard(chatStore(id).get().messages, me?.id, now)) {
          inboxAt.current = now;
          const n = (await loadThreads())?.find((t) => t.id === id)?.postcards;
          if (n != null) {
            const moved = postcards.current != null && n !== postcards.current;
            postcards.current = n;
            if (moved) await fetchAll(id);
          }
        }
        const fromOther = incoming.some((m) => m.sender_id !== me?.id && !known.has(m.id));
        if (shouldMark && (fromOther || !readOnce.current)) {
          readOnce.current = true;
          void markRead(id);
        }
      } catch (e) {
        const gone = e instanceof ApiError && e.status === 404;
        chatStore(id).set((st) => ({ ...st, loaded: true, error: errorMessage(e), gone }));
      }
    },
    CHAT_POLL_MS,
    (opts.poll ?? true) && focused && !!id && !!me && status === 'ready' && !state.gone,
  );

  const send = useCallback(
    (draft: NewMessage) => {
      if (!id) return;
      const bubble = optimistic(id, draft);
      drafts.set(bubble.localId!, { kind: 'draft', message: draft });
      chatStore(id).set((st) => ({ ...st, messages: [...st.messages, bubble] }));
      void deliver(id, bubble.localId!);
    },
    [id],
  );

  const sendVoice = useCallback(
    (recording: VoiceRecording, extra?: VoiceExtra) => {
      if (!id) return;
      const draft = voiceMessage('', recording.duration_s, extra);
      const bubble = optimistic(id, draft, { audio_url: recording.uri, localUri: recording.uri });
      drafts.set(bubble.localId!, { kind: 'voice', recording, extra });
      chatStore(id).set((st) => ({ ...st, messages: [...st.messages, bubble] }));
      void deliver(id, bubble.localId!);
    },
    [id],
  );

  const retry = useCallback(
    (m: ChatMessage) => {
      if (id && m.localId) void deliver(id, m.localId);
    },
    [id],
  );

  const discard = useCallback(
    (m: ChatMessage) => {
      if (!id || !m.localId) return;
      drafts.delete(m.localId);
      chatStore(id).set((st) => ({ ...st, messages: st.messages.filter((x) => x.localId !== m.localId) }));
    },
    [id],
  );

  const refresh = useCallback(async () => {
    if (id) await fetchNew(id).catch(() => {});
  }, [id]);

  const m = meta ?? (id ? metaByThread.get(id) ?? null : null);
  return {
    messages: state.messages,
    /** 'circle' = the whole family; null until known. */
    kind: m?.kind ?? null,
    /** Everyone in the thread (circle: the whole family). */
    members: m?.members ?? [],
    /** For the circle this is a stand-in ("Family"), not a person. */
    other: other ?? (id ? otherByThread.get(id) ?? null : null),
    me,
    /** Resolve a sender id to a profile. */
    sender: (m: Pick<Message, 'sender_id'>) => profileById(m.sender_id),
    isMine: (m: Pick<Message, 'sender_id'>) => m.sender_id === me?.id,
    loading: !state.loaded,
    error: state.error,
    /** The thread doesn't exist or isn't ours (404). */
    gone: state.gone,
    send,
    sendVoice,
    retry,
    discard,
    refresh,
  };
}

const noopSubscribe = () => () => {};
const getEmpty = () => emptyChat;

// ---------------------------------------------------------------------------------------------
// Actions

/** Get or create the thread with another family member. Returns its id. */
export async function openChatWith(otherProfileId: string): Promise<string> {
  const t = await api.openThread(otherProfileId);
  const me = getSession()?.me;
  // A new chat isn't in GET /threads until it has a message: remember who it's with now.
  rememberMeta({ id: t.id, other: t.other, kind: 'pair', members: me ? [me, t.other] : [t.other] });
  return t.id;
}

// ---------------------------------------------------------------------------------------------
// The family circle: questions go to everyone, any cook can answer.

const circles = new Map<string, Promise<string>>();

/** The family circle thread id (fetched once per family; created by the server if missing). */
export function openCircle(): Promise<string> {
  const key = familyKey();
  let p = circles.get(key);
  if (!p) {
    p = api.circle().then((c) => {
      rememberMeta({ id: c.id, kind: 'circle', members: c.members, other: { id: 'family', name: 'Family', role: 'cook', relation: null, avatar_key: null } });
      return c.id;
    });
    p.catch(() => circles.delete(key));
    circles.set(key, p);
  }
  return p;
}

// Open questions (GET /questions/open), shared by Parent Home and Messages.
type OpenState = { owner: string; items: OpenQuestion[] | null; error: string | null };
const openStore = createStore<OpenState>({ owner: '', items: null, error: null });

// Keyed by profile id (unique across families). Never read the API auth during render: the React
// Compiler would memoize it.
async function loadOpen(): Promise<void> {
  const owner = meId();
  // The API headers follow the session in an effect; wait until they name this profile.
  if (!familyKey() || !owner) return;
  if (openStore.get().owner !== owner) openStore.set({ owner, items: null, error: null });
  try {
    const [items] = await Promise.all([api.openQuestions(), openCircle().catch(() => null)]);
    if (meId() === owner) openStore.set({ owner, items, error: null });
  } catch (e) {
    if (meId() === owner) openStore.set((st) => ({ ...st, error: errorMessage(e) }));
  }
}

/**
 * Unanswered questions, newest first (polls with the inbox while focused). `questions` = the family
 * circle's (answer in `circleId`); `all` adds, for a cook, the 1:1 questions asked of them (answer in
 * each `message.thread_id`).
 */
export function useOpenQuestions(opts: { poll?: boolean } = {}) {
  const { me, status } = useSession();
  const focused = useFocusedSafe();
  const s = useSyncExternalStore(openStore.subscribe, openStore.get, openStore.get);
  const [circleId, setCircleId] = useState<string | null>(null);
  const on = (opts.poll ?? true) && focused && !!me && status === 'ready';
  usePolling(loadOpen, INBOX_POLL_MS, on);
  // A profile switch: fetch again once the session has updated the API headers (its effect runs
  // after ours, so on the next tick).
  const meKey = me?.id ?? '';
  useEffect(() => {
    if (!on || !meKey) return;
    const t = setTimeout(() => void loadOpen(), 0);
    return () => clearTimeout(t);
  }, [on, meKey]);
  useEffect(() => {
    if (!me || status !== 'ready') return;
    let alive = true;
    openCircle()
      .then((id) => alive && setCircleId(id))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me, status]);
  const mine = !!me && s.owner === me.id;
  const items = mine ? (s.items ?? []) : [];
  return {
    questions: items.filter((q) => q.thread_kind !== 'pair'),
    all: items,
    loading: !mine || (s.items == null && !s.error),
    error: mine ? s.error : null,
    circleId,
    refresh: loadOpen,
  };
}

// ---------------------------------------------------------------------------------------------
// Recipe notes: cooks' answers saved into the shared family recipe.

type NotesEntry = { notes: RecipeNote[] | null; at: number; error: string | null };
const notesStore = createStore<Record<string, NotesEntry>>({});
const NOTES_FRESH_MS = 30_000;
/** Signed voice URLs last 1 h; re-fetch well before that. */
const NOTES_MAX_AGE_MS = 40 * 60 * 1000;
const notesKey = (familyId: string, recipeId: string) => `${familyId}:${recipeId}`;

async function loadNotes(familyId: string, recipeId: string) {
  const key = notesKey(familyId, recipeId);
  try {
    const notes = await api.recipeNotes(recipeId);
    notesStore.set((st) => ({ ...st, [key]: { notes, at: Date.now(), error: null } }));
  } catch (e) {
    notesStore.set((st) => ({ ...st, [key]: { notes: st[key]?.notes ?? null, at: st[key]?.at ?? 0, error: errorMessage(e) } }));
  }
}

/** A note was just saved: fetch that recipe's notes again. */
function notesChanged(recipeId: string | null | undefined) {
  const familyId = getSession()?.family?.id;
  if (!recipeId || !familyId) return;
  void loadNotes(familyId, recipeId);
}

/** The family's saved answers for a recipe (fetched when shown; fresh signed voice URLs). */
export function useRecipeNotes(recipeId: string | null | undefined) {
  const { status, family } = useSession();
  const focused = useFocusedSafe();
  const all = useSyncExternalStore(notesStore.subscribe, notesStore.get, notesStore.get);
  const familyId = family?.id ?? '';
  const key = recipeId && familyId ? notesKey(familyId, recipeId) : '';
  const entry = key ? all[key] : undefined;
  useEffect(() => {
    if (!recipeId || !familyId || status !== 'ready' || !focused) return;
    const e = notesStore.get()[notesKey(familyId, recipeId)];
    if (!e || Date.now() - e.at > NOTES_FRESH_MS) void loadNotes(familyId, recipeId);
    const t = setInterval(() => {
      const cur = notesStore.get()[notesKey(familyId, recipeId)];
      if (!cur || Date.now() - cur.at > NOTES_MAX_AGE_MS) void loadNotes(familyId, recipeId);
    }, 60_000);
    return () => clearInterval(t);
  }, [recipeId, familyId, status, focused]);
  return {
    notes: entry?.notes ?? [],
    loading: !!key && !entry?.notes && !entry?.error,
    error: entry?.error ?? null,
    refresh: () => (recipeId && familyId ? loadNotes(familyId, recipeId) : Promise.resolve()),
  };
}

// ---------------------------------------------------------------------------------------------
// Open questions about one dish (cook mode's "waiting for Dad" line).

const RECIPE_QUESTIONS_POLL_MS = 30_000;

/**
 * The dish's open questions: the circle's, plus the ones I asked 1:1 (others' 1:1s stay private).
 * Fetched on focus (coming back from asking) and every 30 s while focused.
 */
export function useRecipeQuestions(recipeId: string | null | undefined) {
  const { me, status } = useSession();
  const focused = useFocusedSafe();
  const [state, setState] = useState<{ key: string; items: RecipeQuestion[] } | null>(null);
  usePolling(
    async () => {
      const owner = meId();
      if (!recipeId || !owner) return;
      const items = await api.recipeQuestions(recipeId);
      setState({ key: `${owner}:${recipeId}`, items });
    },
    RECIPE_QUESTIONS_POLL_MS,
    !!recipeId && !!me && focused && status === 'ready',
  );
  const key = recipeId && me ? `${me.id}:${recipeId}` : '';
  return { questions: state && state.key === key ? state.items : [] };
}

/** "Save to recipe": keep one of my (a cook's) messages in the recipe it's about. Idempotent. */
export async function saveToRecipe(threadId: string, messageId: string): Promise<RecipeNote> {
  const note = await api.saveToRecipe(messageId);
  chatStore(threadId).set((st) => ({
    ...st,
    messages: st.messages.map((m) => (m.id === messageId ? { ...m, saved_to_recipe: true, note_id: note.id } : m)),
  }));
  notesChanged(note.recipe_id);
  return note;
}

/** Told the answer's (and its question's) message ids after a note leaves its recipe. */
const noteRemovedListeners = new Set<(ids: string[]) => void>();
/**
 * Hear about notes taken out of their recipe: the question opens again with no new message, so a
 * cache keyed on a thread's newest message (kitchen's) has to refetch on its own. Returns unsubscribe.
 */
export function onNoteRemoved(l: (ids: string[]) => void): () => void {
  noteRemovedListeners.add(l);
  return () => {
    noteRemovedListeners.delete(l);
  };
}

/**
 * "Undo" / "Remove": take a saved answer back out of its recipe (the answer's author, the asker or
 * the dish's cook). The message stays in the chat but no longer answers its question, which opens
 * again unless someone else answered it too: every open chat, the open list and the notes follow.
 */
export async function removeNote(note: Pick<RecipeNote, 'id' | 'recipe_id' | 'answer_message_id'>): Promise<void> {
  const res = await api.removeNote(note.id);
  const answerId = res.answer_message_id || note.answer_message_id;
  const prefix = `${meId()}:`;
  const ids = new Set([answerId, res.question_message_id].filter((x): x is string => !!x));
  for (const [key, store] of chats) {
    if (!key.startsWith(prefix)) continue;
    const answer = store.get().messages.find((m) => m.id === answerId);
    if (!answer) continue;
    const qid = res.question_message_id ?? answer.reply_to ?? null;
    if (qid) ids.add(qid);
    store.set((st) => ({
      ...st,
      messages: st.messages.map((m) => {
        if (m.id === answerId) return { ...m, reply_to: null, saved_to_recipe: false, note_id: null };
        // Answered by this message: open again here, unless another reply to it still answers it.
        if (m.id === qid && m.answered_by === answer.sender_id) return { ...m, answered_by: null, answered_at: null };
        return m;
      }),
    }));
    void fetchAll(key.slice(prefix.length)).catch(() => null);
  }
  for (const l of noteRemovedListeners) l([...ids]);
  notesChanged(note.recipe_id);
  void loadOpen();
}

/** Send a recipe card to people in the family (or 'everyone'). */
export async function sendRecipe(recipeId: string, to: string[] | 'everyone', note?: string | null) {
  const res = await api.sendRecipe({ recipe_id: recipeId, to, note: note && note.trim() ? note.trim() : null });
  invalidateTable();
  void loadThreads();
  askAfterSend(res.sent.map((x) => x.profile_id));
  return res;
}

/** Push asks only for the phone's own person (or anyone on a shared phone): a lent phone's notes go to its owner. */
function askingPerson(): { me: Profile; profiles: Profile[] } | null {
  const session = getSession();
  const me = session?.me;
  if (!session || !me || (session.owner && session.owner.id !== me.id)) return null;
  return { me, profiles: session.profiles };
}

/**
 * A learner's question (or step question) reached the server: "Want a note when Dad answers?"
 * (RETENTION-HANDOFF 2.3; askForPush decides whether to ask at all). Names whoever was asked: the
 * other person in a 1:1, else the dish's cook, else the family's first cook.
 */
function askAfterQuestion(threadId: string, m: Message) {
  const who = askingPerson();
  if (!who || who.me.role !== 'learner') return;
  const spoken = !!m.audio_url;
  if (!(m.kind === 'question' || (m.kind === 'step' && (!!m.body?.trim() || spoken)))) return;
  const meta = metaByThread.get(threadId);
  let to: Profile | null = null;
  if (meta?.kind === 'pair') {
    const other = otherByThread.get(threadId);
    to = other && other.id !== 'family' ? other : null;
  } else {
    const source = m.recipe_id ? (getCachedRecipe(m.recipe_id) ?? getCachedEntry(m.recipe_id) ?? null) : null;
    const cook = cookProfile(source, who.profiles);
    to = cook && cook.id !== who.me.id ? cook : (who.profiles.find((p) => p.role === 'cook' && p.id !== who.me.id) ?? null);
  }
  // Never about a memorial person (guardrail 2: no answer will come; GET /family's `memorial`). The
  // same guard sits on cook-first-send below and kid-first-made (cook/[id].tsx).
  if (to && !to.memorial) void askForPush({ kind: 'kid-first-question', profileId: who.me.id, name: to.name, profile: to });
}

/** How long the Send button's own "Sent" check shows before the explainer rises over it. */
const AFTER_SEND_MS = 600;

/**
 * A cook's recipe card went out: "Want a note when Leo writes back?" (the first learner it went to),
 * a beat later, so the button's "Sent" is seen first.
 */
function askAfterSend(sentTo: string[]) {
  const who = askingPerson();
  if (!who || who.me.role !== 'cook') return;
  const people = sentTo.map((id) => who.profiles.find((p) => p.id === id)).filter((p): p is Profile => !!p);
  const to = people.find((p) => p.role === 'learner') ?? people[0];
  // Never about a memorial person (see askAfterQuestion).
  if (to && !to.memorial) askForPushSoon({ kind: 'cook-first-send', profileId: who.me.id, name: to.name, profile: to }, AFTER_SEND_MS);
}

export type CookedResult = {
  /** The server saved the `cooked` event: this cook counts ("I made it" milestones, "4 of 7"). */
  eventSaved: boolean;
  /** The thread and message when a message went out to the cook. */
  threadId: string | null;
  message: Message | null;
  /** A message to the cook was due but failed to send (the event may still be saved). */
  sendFailed: boolean;
};

/**
 * "I made it": logs a `cooked` event and sends a `cooked` message to the recipe's cook when they are
 * in the family (and isn't me). Never throws: says what was saved and what went out.
 */
export async function cooked(recipeId: string, note?: string | null): Promise<CookedResult> {
  const session = getSession();
  const source = getCachedRecipe(recipeId) ?? getCachedEntry(recipeId) ?? null;
  const cook = source && session ? cookProfile(source, session.profiles) : null;
  // The server keeps whose dish it was, even if the dish later leaves the library.
  const eventSaved = await api.event(recipeId, 'cooked', { cook_id: cook?.id ?? null }).then(
    () => true,
    () => false,
  );
  // Cooking a family dish lights my face at the Sunday table, even before the note to the cook sends.
  if (eventSaved) invalidateTable();
  if (!cook || cook.id === session?.me?.id) return { eventSaved, threadId: null, message: null, sendFailed: false };
  try {
    const threadId = await openChatWith(cook.id);
    const message = await api.sendMessage(threadId, {
      kind: 'cooked',
      recipe_id: recipeId,
      body: note && note.trim() ? note.trim() : null,
    });
    remember(threadId, message);
    return { eventSaved, threadId, message, sendFailed: false };
  } catch {
    return { eventSaved, threadId: null, message: null, sendFailed: true };
  }
}

/** The `cooked` card "I made it" sent: where the postcard goes. */
export type CookedRef = { threadId: string; messageId: string };

/** Photos already uploaded this run (by their local uri), so "Try again" never uploads one twice. */
const uploaded = new Map<string, string>();
/** A card sent here because "I made it" couldn't send one (offline then), so a retry sends no second. */
const sentHere = new Map<string, CookedRef>();

/**
 * The postcard after "I made it" (retention PR 3): uploads my photo and puts it, with the optional
 * 1-5 rating, on the `cooked` card "I made it" sent (POST /messages/:id/postcard), so the cook's chat
 * and Home keep one card per dish made; the server pushes the cook "Leo made your Sunday Chili". When
 * that card never went out, it is sent now (to the dish's cook) and the postcard goes on it. Throws
 * with words for a toast; the step's button then says "Try again".
 */
export async function sendPostcard(input: { recipeId: string; cooked: CookedRef | null; photo: Photo; rating: number | null }): Promise<Message> {
  const { recipeId, photo, rating } = input;
  const path = uploaded.get(photo.uri) ?? (await uploadPhoto(photo));
  uploaded.set(photo.uri, path);
  const key = `${meId()}:${recipeId}`;
  let target = input.cooked ?? sentHere.get(key) ?? null;
  if (!target) {
    const session = getSession();
    const source = getCachedRecipe(recipeId) ?? getCachedEntry(recipeId) ?? null;
    const cook = source && session ? cookProfile(source, session.profiles) : null;
    if (!cook || cook.id === session?.me?.id) throw new ApiError('There’s nobody in the family to send this to.', 400, 'http');
    const threadId = await openChatWith(cook.id);
    const card = await api.sendMessage(threadId, { kind: 'cooked', recipe_id: recipeId });
    remember(threadId, card);
    target = { threadId, messageId: card.id };
    sentHere.set(key, target);
  }
  const saved = await api.postcard(target.messageId, { photo_path: path, rating });
  replaceCached(target.threadId, saved);
  uploaded.delete(photo.uri);
  sentHere.delete(key);
  return saved;
}

/**
 * The cook's "Just like mine" on a dish someone made (a postcard on Home): a `reaction` answering the
 * `cooked` card. The server keeps one per card (a second tap returns the first) and pushes the maker.
 */
export async function sendJustLikeMine(threadId: string, cooked: Pick<Message, 'id' | 'recipe_id'>): Promise<Message> {
  const saved = await api.sendMessage(threadId, { kind: 'reaction', body: 'just_like_mine', reply_to: cooked.id, recipe_id: cooked.recipe_id ?? null });
  remember(threadId, saved);
  invalidateTable();
  return saved;
}

/**
 * A voice note sent from Home without opening the chat (hold to talk on a postcard): uploaded, then
 * sent answering `replyTo` (the `cooked` card; null when the card is in another thread, the family
 * circle). Throws with words for a toast.
 */
export async function sendVoiceReply(threadId: string, recording: VoiceRecording, replyTo: string | null): Promise<Message> {
  const { path, duration_s } = await uploadVoice(recording);
  const saved = await api.sendMessage(threadId, voiceMessage(path, duration_s, { reply_to: replyTo }));
  remember(threadId, saved);
  invalidateTable();
  return saved;
}

/** Ask someone to teach a dish ("Will you teach me your Sunday eggs?"). */
export async function request(input: { to: string; dish: string; note?: string | null; recipeId?: string | null }) {
  const body = input.note && input.note.trim() ? input.note.trim() : `Will you teach me your ${input.dish.trim()}?`;
  const threadId = await openChatWith(input.to);
  const message = await api.sendMessage(threadId, { kind: 'request', body, recipe_id: input.recipeId ?? null });
  invalidateTable();
  remember(threadId, message);
  return { threadId, message };
}

/** Fire-and-forget 'viewed' event (the server dedupes repeats within 30 min). */
export function logViewed(recipeId: string | null | undefined) {
  if (!recipeId || !meId()) return;
  api.event(recipeId, 'viewed').catch(() => {});
}

/** Who cooked / viewed a recipe and when it was last sent (Parent screens). */
export function useRecipeActivity(recipeId: string | null | undefined) {
  const { status } = useSession();
  const [activity, setActivity] = useState<RecipeActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!recipeId || status !== 'ready') return;
    let alive = true;
    api
      .activity(recipeId)
      .then((a) => alive && (setActivity(a), setError(null)))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [recipeId, status, nonce]);
  return { activity, error, refresh: () => setNonce((n) => n + 1) };
}

// ---------------------------------------------------------------------------------------------
// Helpers for screens

/** Sender ids this phone already fetched the family for (once each, for the whole session). */
const askedFor = new Set<string>();

/**
 * Someone wrote whom this phone doesn't know yet (they just joined): fetch the family again, once
 * per id, so their name and face show instead of nothing. Pass the ids not already known from the
 * thread's own members.
 */
export function useKnownSenders(ids: (string | null | undefined)[]) {
  const { profileById, refresh, status } = useSession();
  const unknown = [...new Set(ids.filter((id): id is string => !!id && !profileById(id) && !askedFor.has(id)))].sort();
  const key = unknown.join(',');
  useEffect(() => {
    if (!key || status !== 'ready') return;
    for (const id of key.split(',')) askedFor.add(id);
    void refresh();
  }, [key, status, refresh]);
}

/** True for a message that asks something (a circle question, step question, request, or a text ending in "?"). */
export function isQuestion(m: Message | null | undefined): boolean {
  return !!m && (m.kind === 'question' || m.kind === 'step' || m.kind === 'request' || (m.kind === 'text' && /\?\s*$/.test(m.body ?? '')));
}
