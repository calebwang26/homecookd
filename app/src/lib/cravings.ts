// Phase 5 (docs/PRD-V2.md §4, docs/design/phase5-cold-parents): a cook asks her kids what they're craving with a
// link; a kid names a dish on homecookd.app/miss with no install; she gets "Caleb wants your braised pork" and
// answers by filming it next time (a weekly reminder) or with a 2-minute voice note that becomes a recipe in her
// words, so he can cook it tonight.
//
// The contract with Convex & accounts' Phase 5 functions (docs/build/DISH-ASK-SPEC.md §8, branch claude/dish-ask
// d03b78c12), all public with sessionToken:
//   cravings.createLink({message?}) -> {url}          her one live link, reused (new after revokeLink or 20 cards)
//   cravings.forCook({}) -> CravingAsk[]               newest first, answered and not
//   cravings.get({id}) -> CravingAsk | null
//   cravings.sendVoiceRecipe({id, audioId, durationS, language?})   after files.generateUploadUrl (≤2 min, 5 MB)
//   cravings.setFilmingDay({id, day: 0-6 | null})      the kid's card shows "Mom's filming it Sunday"
// The push "Caleb wants your braised pork" opens /request/<id> (the Notifications & linking chat sends it). The
// reminder and "film it next time" are app-only. Until those functions are deployed every call here
// falls back to a stub on this phone (soft calls in lib/live/convex): the link is the plain /miss page, no ask
// arrives, and a voice recipe "sends" nowhere. The `?preview=craving` ask always stays on this phone.
// Web dev aid (screenshots): `?preview=craving` adds Caleb's braised pork ask.
//
//   const asks = useCravingAsks();               newest first, answered ones too
//   const ask = useCravingAsk(id);               one (the request screen)
//   await createCravingLink(message)             -> { url }  (cravings.createLink, with her line)
//   await sendVoiceRecipe(ask.id, note)          -> { status: 'writing' }
//   await setFilmingDay(ask.id, 0)               "Mom's filming it Sunday" for the kid (0 = Sunday … 6, null = none)
//   await cravingSent(profileId) / noteCravingSent(profileId)   she shared the link once (Home's card)
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { AWS_ON } from './aws/config';
import { cravings as awsCravings } from './aws/dish';
import { cravingLink, sendCravingVoice, setCravingDay, useLive } from './live/convex';
import { useSession } from './session';
import { kvGet, kvSet } from './storage';

/** One line of the kid's guess: "about 1 lb" + "pork belly" (amount "" when he has no idea). */
export type GuessLine = { amount: string; name: string };

export type CravingAsk = {
  id: string;
  /** The kid as he typed his name on the web. */
  kidName: string;
  dish: string;
  /** His guess for tonight's version, shown openly as his guess. */
  guess: GuessLine[];
  /** His voice note to her (played first), or null. */
  kidVoiceUrl: string | null;
  /** His own photo of the dish, or null: never a stock photo in its place. */
  photoUrl: string | null;
  createdAt: number;
  /** She sent a voice recipe for it, or filmed it. */
  answered: boolean;
  /** The day she said she films it (0 = Sunday … 6), or null. */
  filmingDay: number | null;
  /** The line she sent with her link. */
  message: string;
  /** Her voice recipe: being written, ready, or failed (no words heard: she can send again); null before one. */
  voiceRecipe: VoiceRecipeStatus | null;
};

export type VoiceNote = { uri: string; contentType: string; durationS: number };
export type VoiceRecipeStatus = 'writing' | 'ready' | 'failed';

const PREVIEW =
  __DEV__ && Platform.OS === 'web' && /[?&]preview=craving\b/.test(globalThis.location?.search ?? '');

const SAMPLE: CravingAsk = {
  id: 'preview-craving',
  kidName: 'Caleb',
  dish: 'braised pork',
  guess: [
    { amount: 'about 1 lb', name: 'pork belly' },
    { amount: 'about 3 tbsp', name: 'soy sauce' },
    { amount: 'about 1 tbsp', name: 'sugar' },
    { amount: '', name: 'eggs, maybe?' },
  ],
  kidVoiceUrl: null,
  photoUrl: null,
  createdAt: Date.now() - 20 * 60_000,
  answered: false,
  filmingDay: null,
  message: "What do you miss from home? Tell me and I'll make it for you.",
  voiceRecipe: null,
};

let asks: readonly CravingAsk[] = PREVIEW ? [SAMPLE] : [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const read = () => asks;

function patch(id: string, change: Partial<CravingAsk>) {
  asks = asks.map((a) => (a.id === id ? { ...a, ...change } : a));
  listeners.forEach((l) => l());
}

// The stub has no asks: cravings.forCook never answers there.
const noAsks = () => () => {};

/** Her kids' asks, newest first (answered ones too): cravings.forCook, live (soft: none until it's deployed). */
export function useCravingAsks(): readonly CravingAsk[] {
  const local = useSyncExternalStore(subscribe, read, read);
  const { me } = useSession();
  const rows = useLive<CravingAsk[] | null>('cravings:forCook', null, noAsks, !PREVIEW && me?.role === 'cook', {}, true);
  // Kept here too, so getCravingAsk (Record's fallback for a cut-short reminder link) finds them.
  useEffect(() => {
    if (!rows || rows === asks) return;
    asks = rows;
    listeners.forEach((l) => l());
  }, [rows]);
  return rows ?? local;
}

/** One ask, live (null: unknown, or not loaded yet). */
export function useCravingAsk(id: string | null | undefined): CravingAsk | null {
  const all = useCravingAsks();
  const listed = (id && all.find((a) => a.id === id)) || null;
  // 1.1 (AWS): one not in the list (a push, or past the first pages) is read by its id (DISH.md open item 7).
  const [byId, setById] = useState<CravingAsk | null>(null);
  useEffect(() => {
    if (!AWS_ON || !id || listed) return;
    let live = true;
    awsCravings.get(id).then(
      (a) => live && setById(a),
      () => {}, // not hers, or gone: nothing to show
    );
    return () => {
      live = false;
    };
  }, [id, listed]);
  return listed ?? (byId?.id === id ? byId : null);
}

export function getCravingAsk(id: string): CravingAsk | null {
  return asks.find((a) => a.id === id) ?? null;
}

/** The link she sends her kids, carrying her line (cravings.createLink; the plain /miss page until it's deployed). */
export async function createCravingLink(message?: string): Promise<{ url: string }> {
  // 1.1 (AWS): no fallback to the plain /miss page (no stubs); a failure is shown as one.
  if (AWS_ON) return { url: (await cravingLink(message?.trim() || undefined))! };
  return { url: (await cravingLink(message?.trim() || undefined)) ?? 'https://homecookd.app/miss' };
}

/** Her 2-minute voice note for an ask: the server writes it up in her words (cravings.sendVoiceRecipe; throws its
 *  ConvexError sentence, e.g. "The recording is empty."). Only the stub's (or the preview's) ask changes here. */
export async function sendVoiceRecipe(askId: string, note: VoiceNote): Promise<{ status: VoiceRecipeStatus }> {
  const sent = askId !== SAMPLE.id && (await sendCravingVoice(askId, note));
  if (!sent) patch(askId, { answered: true, voiceRecipe: 'writing' });
  return { status: 'writing' };
}

/** The day she films it, for the kid ("Mom's filming it Sunday"): cravings.setFilmingDay. */
export async function setFilmingDay(askId: string, day: number | null): Promise<void> {
  patch(askId, { filmingDay: day });
  if (askId !== SAMPLE.id) await setCravingDay(askId, day);
}

/** She filmed it: the ask is answered (and its reminder can stop). */
export function markAskFilmed(askId: string): void {
  patch(askId, { answered: true });
}

const sentKey = (profileId: string) => `craving.sent.${profileId}`;

/** Whether this person has shared the craving link once (on this phone). */
export async function cravingSent(profileId: string): Promise<boolean> {
  return (await kvGet(sentKey(profileId))) === '1';
}

/** She tapped an app in the craving share row. */
export function noteCravingSent(profileId: string): Promise<void> {
  return kvSet(sentKey(profileId), '1');
}
