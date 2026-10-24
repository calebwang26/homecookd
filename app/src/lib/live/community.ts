// Track G boundary: the Community calls (docs/build/STACK.md "Oct 24 additions").
//
//   useCommunityFeed(maxMiles?)                 community.feed, live: my grid cell, shared recipes + open dinners nearby
//   useCommunityRecipe(recipeId)                community.recipe, live: the story card + steps (text only)
//   await getCommunityRecipe(recipeId)          the same, once
//   await setShare(recipeId, on)                community.setShare (the recipe's cook only)
//   await setLocation(lat, lng, campus?)        community.setLocation (rounded to ~1 km on the server)
//   await createDinner({ recipeId, … })         dinners.create
//   useDinner(dinnerId) / useMyDinners()        dinners.get / dinners.mine, live
//   await requestJoin(dinnerId)                 dinners.requestJoin
//   await respond(requestId, accept)            dinners.respond (host only)
//
// While Convex is stubbed (convex.ts) the feed is empty and the writes do nothing.
import { useState } from 'react';

import { call, token, useLive } from './convex';

export type LatLng = { lat: number; lng: number };
export type FeedRecipe = {
  recipeId: string;
  dish: string;
  familyName: string;
  cookName: string;
  distanceLabel: string;
  approx: LatLng; // the cook's ~1 km grid cell, never finer
  story: string | null; // written by Muse Spark: label it AI
  culture: string | null; // Muse's label for the dish ("Filipino")
  quote: string | null; // one of the cook's own step quotes
  coverUrl: string | null;
  stepCount: number;
  dinner: { dinnerId: string; startsAt: number; seatsLeft: number } | null; // the soonest open one
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

export type PlaceKind = 'campus_kitchen' | 'community_center' | 'cafe' | 'home';
export type RequestStatus = 'pending' | 'accepted' | 'declined';
export type Dinner = {
  dinnerId: string;
  dish: string;
  recipeId: string | null; // opens with getCommunityRecipe when set
  hostName: string;
  placeKind: PlaceKind;
  placeName: string;
  startsAt: number;
  seats: number;
  seatsLeft: number;
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

/** The feed hides past dinners; `now` is fixed per screen (to the minute) so the subscription holds. */
export function useCommunityFeed(maxMiles?: number): CommunityFeed {
  const [now] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
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

export async function getCommunityRecipe(recipeId: string): Promise<CommunityRecipe | null> {
  const sessionToken = await token();
  return call('query', 'community:recipe', { sessionToken, recipeId }, () => null);
}

export async function setShare(recipeId: string, on: boolean): Promise<void> {
  const sessionToken = await token();
  await call('mutation', 'community:setShare', { sessionToken, recipeId, on }, () => null);
}

export async function setLocation(lat: number, lng: number, campus?: string): Promise<void> {
  const sessionToken = await token();
  await call('mutation', 'community:setLocation', { sessionToken, lat, lng, ...(campus ? { campus } : {}) }, () => null);
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
