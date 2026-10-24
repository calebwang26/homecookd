// Hand-offs between the sign-in screens (join, i, r) and the rest of the app.
//
//   routeInvite(input)                     a pasted or typed invite -> /i?t=…, /i?c=… or /join?s=…
//   peekShare(token)                       GET /shares/:token, at most once per link per launch (the
//                                          server counts every call as an open)
//   shareIsDead(token)                     after a peek: the server said that link is gone (404)
//   openAfterPick(recipeId)                a shared dish to open right after someone taps their face
//   holdAfterPick(pathname, search)        any other link (a dish, a chat, /my-recipe/<id>) the app
//                                          opened on before anyone was picked (the root layout's gate)
//   holdPushAfterPick(href, profileId)     a tapped push for one person, before anyone was picked: it
//                                          opens only if that person is the one who comes in
//   peekAfterPick() / takeAfterPick()      read it (the root layout does, once home shows)
//   openHeld(router, held, home)           then open it on top of that home, so Back lands there
//   linkSearch(params, segments)           the `?query` of the screen on show, minus its path's own params
//   leaveTo(href)                          go somewhere with nothing left behind to swipe back to
import { router, type Href } from 'expo-router';

import { api, ApiError, type SharePublic } from '@/lib/api';
import type { InviteInput } from '@/lib/auth';
import { openRecipe, type RouterLike } from '@/lib/navigation';

/** Open what a pasted or typed invite points at. A share link stays on the first screen as `?s=`. */
export function routeInvite(input: InviteInput): void {
  if (input.kind === 'token') router.push({ pathname: '/i', params: { t: input.token } });
  else if (input.kind === 'code') router.push({ pathname: '/i', params: { c: input.code } });
  else router.replace({ pathname: '/join', params: { s: input.share } });
}

/** Replace the whole stack with `href` (after signing in or joining). */
export function leaveTo(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

// ---------------------------------------------------------------------------------------------
// Share links

const shares = new Map<string, Promise<SharePublic | null>>();
const dead = new Set<string>();

/** Who shared a link and which dish it is. null when the link is unknown or the server can't be reached. */
export function peekShare(token: string): Promise<SharePublic | null> {
  const hit = shares.get(token);
  if (hit) return hit;
  const p = api.share(token).catch((e) => {
    if (e instanceof ApiError && e.status === 404) dead.add(token); // gone for good: keep the answer
    else shares.delete(token); // offline: let a later visit try again
    return null;
  });
  shares.set(token, p);
  return p;
}

/** The server said this share link doesn't exist (only known once peekShare has answered). */
export function shareIsDead(token: string): boolean {
  return dead.has(token);
}

// ---------------------------------------------------------------------------------------------
// Where to go once someone is picked

/** A cold start always asks "Who's in the kitchen?" first; after a long wait the link is dropped. */
const AFTER_PICK_TTL_MS = 10 * 60_000;

/**
 * A dish (it opens where that person's dishes open), or any other screen, as a path + `?query`.
 * `for`: the one person it may open for (a push on a shared phone); left out, anyone.
 */
export type AfterPick = ({ kind: 'recipe'; id: string } | { kind: 'path'; href: string }) & { for?: string };
let afterPick: { to: AfterPick; at: number } | null = null;

export function openAfterPick(recipeId: string): void {
  afterPick = recipeId ? { to: { kind: 'recipe', id: recipeId }, at: Date.now() } : null;
}

/** A dish page, in either of its places: /recipe/<id> or the kid's /kid/recipes/<id>. */
const DISH_PATH = /^\/(?:recipe|kid\/recipes)\/([^/]+)$/;
/** The two homes: the person picked lands on theirs anyway. */
const HOME_PATH = /^\/(?:kid|parent)\/home$/;

/** Hold the screen a link opened, while "Who's in the kitchen?" asks first. */
export function holdAfterPick(pathname: string, search: string): void {
  if (HOME_PATH.test(pathname)) return;
  const dish = DISH_PATH.exec(pathname);
  // The pathname comes decoded already (decoding again would throw on a stray '%').
  const to: AfterPick = dish ? { kind: 'recipe', id: dish[1] } : { kind: 'path', href: pathname + search };
  afterPick = { to, at: Date.now() };
}

/**
 * Hold a tapped push's screen (its `data.url`) for the person it was sent to, while nobody is in yet
 * (a tap that launched the app). The gate opens it only if they are the one who comes in.
 */
export function holdPushAfterPick(href: string, profileId: string): void {
  const dish = DISH_PATH.exec(href.split('?')[0]);
  afterPick = { to: dish ? { kind: 'recipe', id: dish[1], for: profileId } : { kind: 'path', href, for: profileId }, at: Date.now() };
}

export function peekAfterPick(): AfterPick | null {
  if (afterPick && Date.now() - afterPick.at > AFTER_PICK_TTL_MS) afterPick = null;
  return afterPick?.to ?? null;
}

export function takeAfterPick(): AfterPick | null {
  const to = peekAfterPick();
  afterPick = null;
  return to;
}

/** Screens only a cook has besides the parent tabs: recording a dish and sending it. */
const COOK_SCREEN = /^\/(?:record|send)(?:\?|$)/;

/**
 * Open what was held on top of `home`. A tab of the kid or parent home is switched to, but only
 * from that same home (a cook never lands in the kid tabs, a kid never in a cook's tabs, Record or
 * Send); any other screen is pushed. A missing dish or a bad path then shows its own "We couldn't
 * find this recipe" / "This page isn't here."
 */
export function openHeld(nav: RouterLike, held: AfterPick, home: string): void {
  if (held.kind === 'recipe') return openRecipe(nav, held.id);
  const tabs = /^\/(kid|parent)(?:[/?]|$)/.exec(held.href)?.[1];
  const cook = home.startsWith('/parent/');
  const cookOnly = tabs === 'parent' || COOK_SCREEN.test(held.href);
  if (cookOnly ? !cook : tabs === 'kid' && cook) return;
  if (tabs) nav.navigate(held.href as Href);
  else nav.push(held.href as Href);
}

/**
 * The `?query` of the screen on show: all its params minus the ones its path already carries
 * (`[id]`, a catch-all, the not-found screen's own). '' when there are none.
 */
export function linkSearch(params: Record<string, string | string[] | undefined>, segments: readonly string[]): string {
  const own = new Set(
    segments.map((s) => (s === '+not-found' ? 'not-found' : /^\[(?:\.\.\.)?(.+)\]$/.exec(s)?.[1])).filter((k): k is string => !!k),
  );
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (own.has(k) || v == null) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  const out = q.toString();
  return out ? `?${out}` : '';
}
