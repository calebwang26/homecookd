// Track G boundary: the Community calls (docs/build/STACK.md "Oct 24 additions").
//
//   useCommunityFeed(maxMiles?)                 community.feed, live: my grid cell, shared recipes + open dinners nearby
//   useCommunityRecipe(recipeId)                community.recipe, live: the story card + steps (text only)
//   await setShare(recipeId, on)                community.setShare (the recipe's cook only)
//   await setLocation(lat, lng, campus?)        community.setLocation (rounded to ~1 km on the server)
//   useFamilyDishes() / await askToShare(id)    shareRequests.familyDishes / .ask: "Put it on the map"
//                                               (shares her own dish; anyone else's asks its cook first)
//   useMySwaps() / await requestSwap(id, mine?) community.mySwaps / .requestSwap
//   await cookTogether(id)                      community.cookTogether ("Ask <cook> to make it with you")
//   await respondSwap(swapId, accept)           community.respondSwap (the family that was asked; swaps
//                                               and "cook together" both)
//   await createDinner({ recipeId, … })         dinners.create
//   useDinner(dinnerId) / useMyDinners()        dinners.get / dinners.mine, live
//   await requestJoin(dinnerId)                 dinners.requestJoin
//   await respond(requestId, accept)            dinners.respond (host only)
//   await inviteLink(dinnerId)                  dinners.inviteLink: "Invite friends" (host and guests who are in)
//   await report(kind, id, reason)              community.report: "Report or block" (gone from my family's map at once)
//   await block(kind, id)                       community.block: the family behind it, both ways
//   useBlocked() / await unblock(blockId)       community.blocked / .unblock (the list under "You")
//
// While Convex is stubbed (convex.ts) the feed is empty and the writes do nothing. The invite link
// can't be made up, so it fails there. Opening an invite (POST /invite/open) is in invite.ts.
//
// The functions added on Oct 24 (shareRequests.*, community.mySwaps / requestSwap / cookTogether /
// respondSwap, dinners.inviteLink) follow convex.ts's rule for that day's calls, so an app build that
// reaches phones before they're deployed doesn't move every Convex call to the stub: the reads and the
// invite link are "soft" (their stub, for that call only: no dishes, no swaps, "Invite links need the
// homecookd server"), and the asks are "strict" (they throw and the toast says so, instead of
// pretending homie asked). The Oct 26 "Report or block" calls follow the same rule: the list is soft,
// the writes strict (a report that didn't reach the team must say so).
import { useEffect, useState } from 'react';

import { requireAiConsent } from '@/lib/aiConsent';
import { AWS_ON } from '@/lib/aws/config';
import { errorWords } from '@/lib/aws/errorWords';
import { isAwsError } from '@/lib/aws/errors';
import { community as awsCommunity } from '@/lib/aws/community';
import { recipes as awsRecipes } from '@/lib/aws/jobs';
import { newKey } from '@/lib/aws/legacy';
import { kickReads } from '@/lib/aws/live';
import { refreshAwsRecipes } from '@/lib/aws/recipesStore';
import { messages as awsMessages } from '@/lib/aws/messages';
import { english } from '@/lib/words/words';

import { call, token, useLive } from './convex';

export type LatLng = { lat: number; lng: number };
export type FeedRecipe = {
  recipeId: string;
  dish: string;
  familyName: string;
  cookName: string;
  distanceLabel: string;
  approx: LatLng; // the cook's ~1 km grid cell, never finer
  ours: boolean; // my own family's dish
  story: string | null; // written by Muse Spark: label it AI
  culture: string | null; // Muse's label for the dish ("Filipino")
  quote: string | null; // one of the cook's own step quotes
  quoteTranslated: boolean; // she said it in another language: tag it "Translated"
  coverUrl: string | null;
  stepCount: number;
  // The soonest open dinner around the dish, with its own distance (it's where the host is).
  dinner: { dinnerId: string; startsAt: number; seatsLeft: number; hostName: string; distanceLabel: string } | null;
};
export type FeedDinner = { dinnerId: string; dish: string; hostName: string; placeName: string; startsAt: number; seatsLeft: number; distanceLabel: string };
/** `here` is my own grid cell, the map's middle (null until the feed answers). */
export type CommunityFeed = { here: LatLng | null; recipes: FeedRecipe[]; dinners: FeedDinner[] };
export type CommunityRecipe = {
  recipeId: string;
  dish: string;
  familyName: string;
  cookName: string;
  ours?: boolean; // my own family's: nothing to report (unset from a server before Oct 26)
  story: string | null;
  steps: { order: number; title: string; text: string }[];
};

/** What can be reported, and why ("Not about food", "Rude or hurtful", "Something else"). */
export type Reportable = 'recipe' | 'dinner';
export type ReportReason = 'not_food' | 'rude' | 'other';
export type BlockedFamily = { blockId: string; familyName: string };

/**
 * One of my family's ready dishes, for "Share your recipe". `notNowAt`: when its cook last said not
 * now (or homie couldn't tell); the family can ask her again a day later (choices.ASK_AGAIN_MS).
 */
export type FamilyDish = { recipeId: string; dish: string; cookName: string; mine: boolean; shared: boolean; asked: boolean; notNowAt: number | null; takenDown?: boolean };

export type SwapStatus = 'pending' | 'accepted' | 'declined';
/** A swap, or (kind 'cook') an ask to cook the other family's dish together. */
export type Swap = {
  swapId: string;
  kind: 'swap' | 'cook';
  status: SwapStatus;
  incoming: boolean; // the other family asked us
  ourDish: { recipeId: string; dish: string } | null;
  theirDish: { recipeId: string; dish: string } | null;
  familyName: string; // the other family, as the cards say it
};

export type PlaceKind = 'campus_kitchen' | 'community_center' | 'cafe' | 'home';
export type RequestStatus = 'pending' | 'accepted' | 'declined';
export type Dinner = {
  dinnerId: string;
  dish: string;
  recipeId: string | null; // the recipe's text opens (community.recipe) when set
  coverUrl: string | null; // our stock photo of the dish
  hostName: string;
  familyName?: string; // the host's family, as its cards name it (unset from a server before Oct 26)
  ours?: boolean; // my own family's dinner: nothing to report
  placeKind: PlaceKind;
  placeName: string;
  startsAt: number;
  seats: number;
  seatsLeft: number;
  inviteOpens: number; // phones and browsers that opened the invite link, once each
  status: 'open' | 'full' | 'cancelled';
  distanceLabel: string;
  isHost: boolean;
  myRequest: { requestId: string; status: RequestStatus } | null;
  address: string | null; // only for the host and accepted guests
  requests: { requestId: string; guestName: string; status: RequestStatus }[] | null; // host only
};

const EMPTY: CommunityFeed = { here: null, recipes: [], dinners: [] };

/**
 * 1.1 (AWS_ON): an api refusal as the error the Community screens read (`labels.ts` errorText reads `.data`), in the
 * app's own words for its code. `gone` (not_found) lets report and block treat "already gone" as done.
 */
async function aws<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (!isAwsError(e)) throw e;
    const words = errorWords(e);
    throw Object.assign(new Error(words), { data: words, code: e.code });
  }
}
const gone = (e: unknown) => (e as { code?: string } | null)?.code === 'not_found';
/** A share changed (or was refused as taken down): read her recipes and the share chooser's dishes again now. */
function sharesChanged() {
  refreshAwsRecipes();
  kickReads('share-dishes:');
}
const still =
  <T,>(value: T) =>
  (onData: (v: T) => void) => {
    onData(value);
    return () => {};
  };
const stubFeed = still(EMPTY);
const stubRecipe = still<CommunityRecipe | null>(null);
const stubDinner = still<Dinner | null>(null);
const stubDinners = still<Dinner[]>([]);
const stubDishes = still<FamilyDish[] | null>([]);
const stubSwaps = still<Swap[]>([]);
const stubBlocked = still<BlockedFamily[]>([]);

const QUARTER_HOUR = 15 * 60_000;
const quarter = (ms: number) => Math.floor(ms / QUARTER_HOUR) * QUARTER_HOUR;

/**
 * The feed's clock: the time rounded down to the quarter hour, checked each minute. Dinners start on
 * the hour or half hour, so one drops off the feed within a minute of starting (and the next one
 * takes its place), while the subscription only restarts four times an hour.
 */
function useFeedClock(): number {
  const [now, setNow] = useState(() => quarter(Date.now()));
  useEffect(() => {
    const t = setInterval(() => setNow(quarter(Date.now())), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function useCommunityFeed(maxMiles?: number): CommunityFeed {
  const now = useFeedClock();
  const args = maxMiles === undefined ? { now } : { now, maxMiles };
  return useLive<CommunityFeed>('community:feed', EMPTY, stubFeed, true, args);
}

/**
 * A shared recipe's text, live with this person's session (so a cold open waits for sign-in instead of
 * failing): undefined while it loads, null when it isn't shared (or isn't there).
 */
export function useCommunityRecipe(recipeId: string): CommunityRecipe | null | undefined {
  const value = useLive<CommunityRecipe | null | undefined>('community:recipe', undefined, stubRecipe, !!recipeId, { recipeId });
  return value && value.recipeId !== recipeId ? undefined : value;
}

/** On the map: Muse writes the dish's story card from her recipe, so only with this phone's yes to the AI companies. */
export async function setShare(recipeId: string, on: boolean): Promise<void> {
  if (on) await requireAiConsent();
  if (AWS_ON) {
    // Her own tap shares it (COMMUNITY.md); off is the recipe's own route (the cook only).
    try {
      await aws<unknown>(on ? awsMessages.shareAsk(recipeId) : awsRecipes.unshare(recipeId));
    } finally {
      sharesChanged(); // on, off, or taken_down: the page shows which now, not at the next front
    }
    return;
  }
  const sessionToken = await token();
  await call('mutation', 'community:setShare', { sessionToken, recipeId, on }, () => null);
}

export async function setLocation(lat: number, lng: number, campus?: string): Promise<void> {
  // TODO(aws): no route sets a place yet (COMMUNITY.md open item 2, Caleb's call); no screen calls this.
  if (AWS_ON) return;
  const sessionToken = await token();
  await call('mutation', 'community:setLocation', { sessionToken, lat, lng, ...(campus ? { campus } : {}) }, () => null);
}

/** My family's ready dishes (null until it answers). */
export function useFamilyDishes(enabled = true): FamilyDish[] | null {
  // Under AWS_ON, useLive reads GET /v1/share-requests/dishes (lib/live/convex AWS_LIVE).
  return useLive<FamilyDish[] | null>('shareRequests:familyDishes', null, stubDishes, enabled, {}, true);
}

/** "shared": it's on the map now (mine, or it already was); "asked": homie asked its cook. */
export async function askToShare(recipeId: string, cookName?: string): Promise<'shared' | 'asked'> {
  await requireAiConsent();
  if (AWS_ON) {
    try {
      return (await awsMessages.shareAsk(recipeId)).result;
    } catch (e) {
      if (!isAwsError(e)) throw e;
      // Her no, within a day: name her from the dish we hold, never from the api's sentence.
      const words = e.code === 'declined' ? english('errors.share_declined', { name: cookName?.trim() || 'The cook' }) : errorWords(e);
      throw Object.assign(new Error(words), { data: words, code: e.code });
    } finally {
      sharesChanged();
    }
  }
  const sessionToken = await token();
  return call('mutation', 'shareRequests:ask', { sessionToken, recipeId }, () => 'asked' as const, { strict: true });
}

export function useMySwaps(enabled = true): Swap[] {
  return useLive<Swap[]>('community:mySwaps', [], stubSwaps, enabled, {}, true);
}

export async function requestSwap(recipeId: string, myRecipeId?: string): Promise<string> {
  if (AWS_ON) return (await aws(awsCommunity.requestSwap(recipeId, myRecipeId))).swapId;
  const sessionToken = await token();
  return call('mutation', 'community:requestSwap', { sessionToken, recipeId, ...(myRecipeId ? { myRecipeId } : {}) }, () => `stub-swap-${Date.now()}`, {
    strict: true,
  });
}

export async function cookTogether(recipeId: string): Promise<string> {
  if (AWS_ON) return (await aws(awsCommunity.cookTogether(recipeId))).swapId;
  const sessionToken = await token();
  return call('mutation', 'community:cookTogether', { sessionToken, recipeId }, () => `stub-cook-${Date.now()}`, { strict: true });
}

export async function respondSwap(swapId: string, accept: boolean): Promise<void> {
  if (AWS_ON) return void (await aws(awsCommunity.respondSwap(swapId, accept)));
  const sessionToken = await token();
  await call('mutation', 'community:respondSwap', { sessionToken, swapId, accept }, () => null, { strict: true });
}

export type NewDinner = { recipeId: string; startsAt: number; placeKind?: PlaceKind; placeName: string; address: string; seats: number };

export async function createDinner(dinner: NewDinner): Promise<string> {
  // One key per dinner she hosts: the client repeats it on its own retries, so a lost answer never hosts twice.
  if (AWS_ON) return (await aws(awsCommunity.createDinner(dinner, newKey()))).dinnerId;
  const sessionToken = await token();
  return call('mutation', 'dinners:create', { sessionToken, ...dinner }, () => `stub-dinner-${Date.now()}`);
}

export function useDinner(dinnerId: string | null | undefined): Dinner | null {
  return useLive<Dinner | null>('dinners:get', null, stubDinner, !!dinnerId, dinnerId ? { dinnerId } : {});
}

export function useMyDinners(): Dinner[] {
  return useLive<Dinner[]>('dinners:mine', [], stubDinners);
}

export async function requestJoin(dinnerId: string): Promise<string> {
  if (AWS_ON) return (await aws(awsCommunity.join(dinnerId))).requestId;
  const sessionToken = await token();
  return call('mutation', 'dinners:requestJoin', { sessionToken, dinnerId }, () => `stub-request-${Date.now()}`);
}

export async function respond(requestId: string, accept: boolean): Promise<void> {
  if (AWS_ON) return void (await aws(awsCommunity.respond(requestId, accept)));
  const sessionToken = await token();
  await call('mutation', 'dinners:respond', { sessionToken, requestId, accept }, () => null);
}

export type InviteLink = { token: string; url: string };

/** The dinner's one invite link ("https://homecookd.app/d?t=…"), the same every time. */
export async function inviteLink(dinnerId: string): Promise<InviteLink> {
  if (AWS_ON) return aws(awsCommunity.inviteLink(dinnerId));
  const sessionToken = await token();
  return call<InviteLink>(
    'action',
    'dinners:inviteLink',
    { sessionToken, dinnerId },
    () => {
      throw new Error('Invite links need the homecookd server. Try again once it’s connected.');
    },
    { soft: true },
  );
}

export async function report(kind: Reportable, targetId: string, reason: ReportReason): Promise<void> {
  // Already gone for her family (not_found): the report did its job; the sheet thanks her and closes.
  if (AWS_ON) {
    await aws(awsCommunity.report(kind, targetId, reason)).catch((e) => (gone(e) ? null : Promise.reject(e)));
    kickReads('community:'); // the item leaves her family's feed: read it again now
    return;
  }
  const sessionToken = await token();
  await call('mutation', 'community:report', { sessionToken, kind, targetId, reason }, () => null, { strict: true });
}

export async function block(kind: Reportable, targetId: string): Promise<void> {
  if (AWS_ON) {
    await aws(awsCommunity.block(kind, targetId)).catch((e) => (gone(e) ? null : Promise.reject(e)));
    kickReads('community:'); // the item leaves her family's feed: read it again now
    return;
  }
  const sessionToken = await token();
  await call('mutation', 'community:block', { sessionToken, kind, targetId }, () => null, { strict: true });
}

/** The families mine blocked (never the ones that blocked us). */
export function useBlocked(enabled = true): BlockedFamily[] {
  return useLive<BlockedFamily[]>('community:blocked', [], stubBlocked, enabled, {}, true);
}

export async function unblock(blockId: string): Promise<void> {
  if (AWS_ON) return void (await aws(awsCommunity.unblock(blockId)).catch((e) => (gone(e) ? null : Promise.reject(e))));
  const sessionToken = await token();
  await call('mutation', 'community:unblock', { sessionToken, blockId }, () => null, { strict: true });
}
