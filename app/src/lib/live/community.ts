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
//
// While Convex is stubbed (convex.ts) the feed is empty and the writes do nothing. The invite link
// can't be made up, so it fails there. Opening an invite (POST /invite/open) is in invite.ts.
//
// The functions added on Oct 24 (shareRequests.*, community.mySwaps / requestSwap / cookTogether /
// respondSwap, dinners.inviteLink) follow convex.ts's rule for that day's calls, so an app build that
// reaches phones before they're deployed doesn't move every Convex call to the stub: the reads and the
// invite link are "soft" (their stub, for that call only: no dishes, no swaps, "Invite links need the
// homecookd server"), and the asks are "strict" (they throw and the toast says so, instead of
// pretending homie asked).
import { useEffect, useState } from 'react';

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
  story: string | null;
  steps: { order: number; title: string; text: string }[];
};

/**
 * One of my family's ready dishes, for "Share your recipe". `notNowAt`: when its cook last said not
 * now (or homie couldn't tell); the family can ask her again a day later (choices.ASK_AGAIN_MS).
 */
export type FamilyDish = { recipeId: string; dish: string; cookName: string; mine: boolean; shared: boolean; asked: boolean; notNowAt: number | null };

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

export async function setShare(recipeId: string, on: boolean): Promise<void> {
  const sessionToken = await token();
  await call('mutation', 'community:setShare', { sessionToken, recipeId, on }, () => null);
}

export async function setLocation(lat: number, lng: number, campus?: string): Promise<void> {
  const sessionToken = await token();
  await call('mutation', 'community:setLocation', { sessionToken, lat, lng, ...(campus ? { campus } : {}) }, () => null);
}

/** My family's ready dishes (null until it answers). */
export function useFamilyDishes(enabled = true): FamilyDish[] | null {
  return useLive<FamilyDish[] | null>('shareRequests:familyDishes', null, stubDishes, enabled, {}, true);
}

/** "shared": it's on the map now (mine, or it already was); "asked": homie asked its cook. */
export async function askToShare(recipeId: string): Promise<'shared' | 'asked'> {
  const sessionToken = await token();
  return call('mutation', 'shareRequests:ask', { sessionToken, recipeId }, () => 'asked' as const, { strict: true });
}

export function useMySwaps(enabled = true): Swap[] {
  return useLive<Swap[]>('community:mySwaps', [], stubSwaps, enabled, {}, true);
}

export async function requestSwap(recipeId: string, myRecipeId?: string): Promise<string> {
  const sessionToken = await token();
  return call('mutation', 'community:requestSwap', { sessionToken, recipeId, ...(myRecipeId ? { myRecipeId } : {}) }, () => `stub-swap-${Date.now()}`, {
    strict: true,
  });
}

export async function cookTogether(recipeId: string): Promise<string> {
  const sessionToken = await token();
  return call('mutation', 'community:cookTogether', { sessionToken, recipeId }, () => `stub-cook-${Date.now()}`, { strict: true });
}

export async function respondSwap(swapId: string, accept: boolean): Promise<void> {
  const sessionToken = await token();
  await call('mutation', 'community:respondSwap', { sessionToken, swapId, accept }, () => null, { strict: true });
}

export type NewDinner = { recipeId: string; startsAt: number; placeKind?: PlaceKind; placeName: string; address: string; seats: number };

export async function createDinner(dinner: NewDinner): Promise<string> {
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
  const sessionToken = await token();
  return call('mutation', 'dinners:requestJoin', { sessionToken, dinnerId }, () => `stub-request-${Date.now()}`);
}

export async function respond(requestId: string, accept: boolean): Promise<void> {
  const sessionToken = await token();
  await call('mutation', 'dinners:respond', { sessionToken, requestId, accept }, () => null);
}

export type InviteLink = { token: string; url: string };

/** The dinner's one invite link ("https://homecookd.app/d?t=…"), the same every time. */
export async function inviteLink(dinnerId: string): Promise<InviteLink> {
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
