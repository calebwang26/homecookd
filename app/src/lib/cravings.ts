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
// reminder and "film it next time" are app-only. TODO(convex): until those functions are deployed every call here
// is a stub on this phone: the link is the plain /miss page, no ask arrives, and a voice recipe "sends" nowhere.
// Web dev aid (screenshots): `?preview=craving` adds Caleb's braised pork ask.
//
//   const asks = useCravingAsks();               newest first, answered ones too
//   const ask = useCravingAsk(id);               one (the request screen)
//   await createCravingLink(message)             -> { url }  (cravings.createLink, with her line)
//   await sendVoiceRecipe(ask.id, note)          -> { status: 'writing' }
//   await setFilmingDay(ask.id, 0)               "Mom's filming it Sunday" for the kid (0 = Sunday … 6, null = none)
//   await cravingSent(profileId) / noteCravingSent(profileId)   she shared the link once (Home's card)
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

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

/** Her kids' asks, newest first (answered ones too). */
export function useCravingAsks(): readonly CravingAsk[] {
  return useSyncExternalStore(subscribe, read, read);
}

/** One ask, live (null: unknown, or not loaded yet). */
export function useCravingAsk(id: string | null | undefined): CravingAsk | null {
  const all = useCravingAsks();
  return (id && all.find((a) => a.id === id)) || null;
}

export function getCravingAsk(id: string): CravingAsk | null {
  return asks.find((a) => a.id === id) ?? null;
}

/** The link she sends her kids, carrying her line. TODO(convex): cravings.createLink({message}). */
export async function createCravingLink(_message?: string): Promise<{ url: string }> {
  return { url: 'https://homecookd.app/miss' };
}

/** Her 2-minute voice note for an ask: the server writes it up in her words. TODO(convex): upload with
 *  files.generateUploadUrl, then cravings.sendVoiceRecipe({id, audioId, durationS}). */
export async function sendVoiceRecipe(askId: string, _note: VoiceNote): Promise<{ status: VoiceRecipeStatus }> {
  patch(askId, { answered: true, voiceRecipe: 'writing' });
  return { status: 'writing' };
}

/** The day she films it, for the kid ("Mom's filming it Sunday"). TODO(convex): cravings.setFilmingDay({id, day}). */
export async function setFilmingDay(askId: string, day: number | null): Promise<void> {
  patch(askId, { filmingDay: day });
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
