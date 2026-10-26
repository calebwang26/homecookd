// The cook's side of the family conversation, derived from real messages (GET /threads + each
// thread's messages). Shared by Parent Home, Your recipes and the parent recipe page.
//
//   const k = useKitchen();
//   k.waiting   questions from learners I haven't answered yet (newest first)
//   k.cooked    "Leo made your chili" messages to me (newest first)
//   k.sent      recipe cards I sent (newest first)
//   k.requests  "Will you teach me ...?" requests with no recipe sent back since (newest first)
//   k.liked     cooked cards I already answered "Just like mine" (their message ids; retention PR 3)
//   k.sentAt(recipeId, profileId)  when I last sent that recipe to that person, or null
//
//   questionFor(q, me, profiles)   'mine' | 'family' | null: whether an open question belongs on my Home
//
// Reads only: it never marks a thread read (the chat screen does that when it's opened).
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { readsAsQuestion } from '@/components/messages/helpers';
import { api, type Message, type Profile, type ThreadKind, type ThreadSummary } from '@/lib/api';
import { isQuestion, onNoteRemoved, useThreads } from '@/lib/messaging';
import { kitchenStamp, likedIds } from '@/lib/postcardLogic';
import { cookProfile, getCachedEntry, getCachedRecipe } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { english, type T } from '@/lib/words/words';

export type KitchenItem = { threadId: string; other: Profile; message: Message };

export type Kitchen = {
  /** False until the inbox and every thread's messages have arrived once. */
  ready: boolean;
  /** True once the inbox itself has arrived (questions can show from each thread's last message). */
  inboxReady: boolean;
  /** Set when the inbox couldn't load (e.g. offline). */
  error: string | null;
  threads: ThreadSummary[];
  waiting: KitchenItem[];
  cooked: KitchenItem[];
  sent: KitchenItem[];
  requests: KitchenItem[];
  /** Cooked cards (message ids) I already answered "Just like mine": the postcard shows it sent. */
  liked: Set<string>;
  sentAt: (recipeId: string, profileId: string) => string | null;
};

// ---------------------------------------------------------------------------------------------
// Message cache: one fetch per thread per change of its newest message.

const cache = new Map<string, { stamp: string; messages: Message[] }>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getVersion = () => version;

function ensure(meId: string, t: ThreadSummary) {
  const key = `${meId}:${t.id}`;
  // A postcard changes a cooked card in place (no new message), so the stamp also counts postcards
  // (lib/postcardLogic kitchenStamp).
  const stamp = kitchenStamp(t);
  if (cache.get(key)?.stamp === stamp) return;
  const job = `${key}@${stamp}`;
  if (inflight.has(job)) return;
  inflight.add(job);
  api
    .messages(t.id)
    .then((messages) => {
      cache.set(key, { stamp, messages });
      emit();
    })
    .catch(() => {
      // Keep the last good copy; the inbox poll retries on its next change.
      if (!cache.has(key)) {
        cache.set(key, { stamp: '', messages: t.last ? [t.last] : [] });
        emit();
      }
    })
    .finally(() => inflight.delete(job));
}

/**
 * Something I just sent from Home (a "Just like mine" on a postcard) goes into the cache at once: a
 * reaction is never a thread's newest message, so no refetch would bring it.
 */
export function keepSent(meId: string, threadId: string, m: Message) {
  const key = `${meId}:${threadId}`;
  const hit = cache.get(key);
  if (!hit || hit.messages.some((x) => x.id === m.id)) return;
  cache.set(key, { ...hit, messages: [...hit.messages, m] });
  emit();
}

/** One thread's messages again, now (a postcard's signed photo URL lasts 1 h). */
export function refetchKitchenThread(meId: string, threadId: string) {
  const key = `${meId}:${threadId}`;
  api
    .messages(threadId)
    .then((messages) => {
      cache.set(key, { stamp: cache.get(key)?.stamp ?? '', messages });
      emit();
    })
    .catch(() => null);
}

// An answer taken back out of its recipe ("Undo" / "Remove") opens its question again without a
// new message, so the stamp doesn't move: refetch the threads holding it, so k.waiting (a recipe
// page's "Leo asked" card) brings the question back.
onNoteRemoved((ids) => {
  for (const [key, hit] of cache) {
    if (!hit.messages.some((m) => ids.includes(m.id))) continue;
    api
      .messages(key.slice(key.indexOf(':') + 1))
      .then((messages) => {
        // A newer message's fetch that landed first already has this change.
        if (cache.get(key) !== hit) return;
        cache.set(key, { stamp: hit.stamp, messages });
        emit();
      })
      .catch(() => null);
  }
});

const byNewest = (a: KitchenItem, b: KitchenItem) => (a.message.created_at < b.message.created_at ? 1 : -1);

export function useKitchen(): Kitchen {
  const { me, profileById } = useSession();
  const { threads, loading, error } = useThreads();
  const meId = me?.id ?? '';

  useEffect(() => {
    if (!meId) return;
    for (const t of threads) ensure(meId, t);
  }, [meId, threads]);

  const v = useSyncExternalStore(subscribe, getVersion, getVersion);

  return useMemo(() => {
    const waiting: KitchenItem[] = [];
    const cooked: KitchenItem[] = [];
    const sent: KitchenItem[] = [];
    const requests: KitchenItem[] = [];
    const liked = new Set<string>();
    const sentMap = new Map<string, string>();
    let all = !loading;

    for (const t of threads) {
      const hit = cache.get(`${meId}:${t.id}`);
      if (!hit) all = false;
      // Reactions (a heart I sent mid-cook, "Just like mine") are stamps: never "my last message"
      // closing a question, never a dish someone made or a request.
      for (const id of likedIds(hit?.messages ?? [], meId)) liked.add(id);
      // The cached copies, not the inbox's fresh `last`: a postcard's signed photo URL is new on every
      // poll, and swapping it in would reload the photo every 8 s (a postcard arriving changes the
      // stamp, which refetches the thread; an expired URL refetches it from the row).
      const list = (hit?.messages ?? []).filter((m) => m.kind !== 'reaction');
      if (t.last && t.last.kind !== 'reaction' && !list.some((m) => m.id === t.last!.id)) list.push(t.last);
      list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

      let lastMine = -1;
      list.forEach((m, i) => {
        if (m.sender_id === meId) lastMine = i;
      });

      // The family circle: every question from someone else that no cook has answered, with its asker.
      if (t.kind === 'circle') {
        const cook = (id: string) => profileById(id)?.role === 'cook';
        for (const m of list) {
          if (m.kind !== 'question' || m.sender_id === meId || m.answered_by) continue;
          if (list.some((x) => x.reply_to === m.id && x.sender_id !== m.sender_id && cook(x.sender_id) && !(x as { local?: string }).local)) continue;
          waiting.push({ threadId: t.id, other: profileById(m.sender_id) ?? t.other, message: m });
        }
      }
      // The newest question from them that came after my last message.
      for (let i = list.length - 1; t.kind !== 'circle' && i > lastMine; i--) {
        const m = list[i];
        if (m.sender_id !== meId && isQuestion(m)) {
          // A plain text question is about the dish the thread was last talking about.
          let about = m.recipe_id;
          for (let j = i - 1; !about && j >= 0; j--) about = list[j].recipe_id;
          waiting.push({ threadId: t.id, other: t.other, message: about && !m.recipe_id ? { ...m, recipe_id: about } : m });
          break;
        }
      }

      list.forEach((m, i) => {
        const mine = m.sender_id === meId;
        if (!mine && m.kind === 'cooked') cooked.push({ threadId: t.id, other: t.other, message: m });
        if (mine && m.kind === 'recipe' && m.recipe_id) {
          sent.push({ threadId: t.id, other: t.other, message: m });
          const k = `${m.recipe_id}:${t.other.id}`;
          const prev = sentMap.get(k);
          if (!prev || prev < m.created_at) sentMap.set(k, m.created_at);
        }
        if (!mine && m.kind === 'request') {
          const answered = list.slice(i + 1).some((x) => x.sender_id === meId && x.kind === 'recipe');
          if (!answered) requests.push({ threadId: t.id, other: t.other, message: m });
        }
      });
    }

    return {
      // An inbox that failed before it ever loaded tells us nothing (not "no threads").
      ready: all && !(error && threads.length === 0),
      inboxReady: !loading || !!error,
      error,
      threads,
      waiting: waiting.sort(byNewest),
      cooked: cooked.sort(byNewest),
      sent: sent.sort(byNewest),
      requests: requests.sort(byNewest),
      liked,
      sentAt: (recipeId: string, profileId: string) => sentMap.get(`${recipeId}:${profileId}`) ?? null,
    };
    // `v` re-derives when a thread's messages arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, loading, error, meId, v, profileById]);
}

// ---------------------------------------------------------------------------------------------
// Who a question is for (one rule for Home and Messages)

/**
 * Whether an open question belongs on my Home, and how to say it:
 *  'mine'    a 1:1 question to me, or a family question about my dish ("Leo asked about your
 *            Sunday Chili"): it sorts first and makes its chat bold
 *  'family'  a family question about a dish no family cook made (a YouTube dish: the dish makes
 *            it a question, whatever the words), or about no dish and reads as one ("Leo asked
 *            the family"; a voice question with no words counts, we can't tell)
 *  null      not mine: a question about another cook's dish (theirs to answer), or a family
 *            message that only looks like a question ("hello")
 * `threadKind` 'pair' = a 1:1 chat (the open list holds only those asked of me).
 */
export function questionFor(
  q: { message: Message; thread_kind?: ThreadKind | null },
  me: Pick<Profile, 'id' | 'name'> | null | undefined,
  profiles: Profile[],
): 'mine' | 'family' | null {
  if (!me) return null;
  if (q.thread_kind === 'pair') return 'mine';
  const m = q.message;
  const id = m.recipe_id;
  const dish = id ? (getCachedEntry(id) ?? getCachedRecipe(id) ?? null) : null;
  const cook = dish ? cookProfile(dish, profiles) : null;
  if (cook) return cook.id === me.id ? 'mine' : null;
  // A dish someone attached on purpose makes it a question. The words test is only for messages
  // with no dish (old "hello"s). A dish not loaded here yet falls through to it, as before.
  if (dish) return 'family';
  const words = (m.body ?? '').trim() || (m.transcript ?? '').trim();
  if (!words) return m.audio_url || m.duration_s ? 'family' : null;
  return readsAsQuestion(words) ? 'family' : null;
}

// ---------------------------------------------------------------------------------------------
// Copy helpers (the bible's voice, from real data only)

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * The dish without the cook's name: "Dad's Sunday Chili" -> "Sunday Chili",
 * "Dad's Grilled Fish with Ginger-Scallion Sauce" -> "Grilled Fish".
 */
export function dishName(title: string | null | undefined, cook?: string | null, t: T = english): string {
  let s = (title ?? '').trim();
  if (!s) return t('parent.dish.fallback');
  const m = /^(.+?)['’]s\s+(.+)$/.exec(s);
  if (m && (!cook || norm(m[1]) === norm(cook) || m[1].split(/\s+/).length <= 2)) s = m[2];
  if (s.length > 22) {
    const short = s.split(/\s+(?:with|and|in|on)\s+/i)[0];
    if (short.length >= 4) s = short;
  }
  return s;
}

/** "Will you teach me your Sunday eggs? The ones..." -> "Sunday eggs" (or null). */
export function requestDish(body: string | null | undefined): string | null {
  const b = (body ?? '').trim();
  const m =
    /teach me (?:how to (?:make|cook|bake) )?(?:your |the |that )?([^?.!,]{2,40})/i.exec(b) ??
    /(?:recipe for|how to make) (?:your |the )?([^?.!,]{2,40})/i.exec(b);
  return m ? m[1].trim() : null;
}

/** "cooked" / "baked" from the recipe's tags or title. */
export function madeVerb(tags: string[] | null | undefined, title?: string | null): 'cooked' | 'baked' {
  const words = `${(tags ?? []).join(' ')} ${title ?? ''}`.toLowerCase();
  return /\b(bake|baked|baking|bread|cake|cheesecake|cookies?|pie|muffins?|dessert|pastry)\b/.test(words) ? 'baked' : 'cooked';
}

/** "once", "twice", "3 times". */
export function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

/** A question message as one quotable line. */
export function questionText(m: Message, t: T = english): string {
  const body = (m.body ?? '').trim() || (m.transcript ?? '').trim();
  if (body) return body;
  if (m.kind === 'question' && (m.audio_url || m.duration_s)) return t('parent.question.voice');
  if (m.kind === 'step' && m.step_order) return t('parent.question.step', { step: m.step_order });
  return t('parent.question.forYou');
}
