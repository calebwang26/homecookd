// "Invite friends" words and the invite link's open call, as pure functions (tested by
// scripts/test-community-ui.mjs). The fetch and this phone's id are in lib/live/invite.ts.
//   inviteText      "Come to Jollof Rice Night with Mom: https://homecookd.app/d?t=…"
//   siteUrl         the Convex HTTP host (.convex.site) from the client's .convex.cloud URL
//   isInviteToken   a link's ?t= that's worth sending
//   parseOpened     POST /invite/open's reply: { dish, hostFirstName, startsAt } or null
//   randomId        this phone's id for invite opens
//   openedWords     what /d says: "You’re going to Jollof Rice Night", "Hosted by Mom", "Friday · 7 pm"
// Nothing here imports React or the app, so Node runs it as is.
import { dinnerWhen, nightTitle } from './labels';

export function inviteText(dish: string, hostName: string, url: string): string {
  const host = hostName.trim();
  return host ? `Come to ${nightTitle(dish)} with ${host}: ${url}` : `Come to ${nightTitle(dish)}: ${url}`;
}

/** https://grand-dragon-649.convex.cloud -> https://grand-dragon-649.convex.site ("" when there's none). */
export function siteUrl(cloudUrl: string | null | undefined): string {
  const url = (cloudUrl ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[\w-]+\.convex\.cloud$/.test(url) ? url.replace(/\.convex\.cloud$/, '.convex.site') : '';
}

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export function isInviteToken(t: unknown): t is string {
  return typeof t === 'string' && TOKEN.test(t);
}

export type OpenedDinner = { dish: string; hostFirstName: string; startsAt: number };

export function parseOpened(body: unknown): OpenedDinner | null {
  const b = body as Partial<OpenedDinner> | null;
  if (!b || typeof b !== 'object') return null;
  if (typeof b.dish !== 'string' || !b.dish.trim() || typeof b.hostFirstName !== 'string') return null;
  if (typeof b.startsAt !== 'number' || !Number.isFinite(b.startsAt)) return null;
  return { dish: b.dish, hostFirstName: b.hostFirstName, startsAt: b.startsAt };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** 24 random characters from [A-Za-z0-9_-] (crypto where the phone has it). Only counts opens: not a secret. */
export function randomId(length = 24): string {
  const bytes = new Uint8Array(length);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => ALPHABET[b & 63]).join('');
}

/** /d's words for an opened invite: still ahead, or already over. */
export function openedWords(d: OpenedDinner, now: number): { title: string; host: string; when: string } {
  const host = d.hostFirstName.trim();
  const night = nightTitle(d.dish);
  return {
    title: d.startsAt > now ? `You’re going to ${night}` : `${night} already happened`,
    host: host ? `Hosted by ${host}` : '',
    when: d.startsAt > now ? dinnerWhen(d.startsAt, now) : '',
  };
}
