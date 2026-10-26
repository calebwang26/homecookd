// The one-time "Before we start" page (app/consent.tsx): it names the AI companies that get people's
// videos, photos and voice, and asks before anything is sent to them (App Store guideline 5.1.2(i)).
// The yes is kept on this phone only, as the time of the tap, under a versioned key: a new version
// (another company, or another kind of data) asks everyone again. Signing out forgets it, so whoever
// signs in next is asked too. Tested with the phone's storage faked: node scripts/test-consent.mjs.
//
//   const consent = useAiConsent();             'loading' | 'needed' | 'given'
//   await agreeToAi();   await forgetAiConsent();
//   consentFirst(consent, status, pathname)     the root layout's gate: go to /consent now
//
// Web dev aids that draw a screen without signing in (`?as=`, `?profiles=`, `?preview=`) skip it,
// unless the URL also has `consent=ask`.
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import type { SessionStatus } from './session';
import { kvGet, kvSet } from './storage';

export const AI_CONSENT_KEY = 'aiConsent.v1';

export type Consent = 'loading' | 'needed' | 'given';

/** A saved yes is the ISO time of the tap. Nothing, or anything else, asks again. */
export function isAgreed(saved: string | null | undefined): boolean {
  return !!saved && !Number.isNaN(Date.parse(saved));
}

export async function readAiConsent(): Promise<'needed' | 'given'> {
  return isAgreed(await kvGet(AI_CONSENT_KEY)) ? 'given' : 'needed';
}

let state: Consent = 'loading';
let started = false;
const listeners = new Set<() => void>();

function set(next: Consent) {
  if (state === next) return;
  state = next;
  for (const l of listeners) l();
}

/** Read the saved yes once per run of the app. A tap or a sign-out meanwhile wins. */
function start() {
  if (started) return;
  started = true;
  void readAiConsent().then((saved) => {
    if (state === 'loading') set(saved);
  });
}

export function getAiConsent(): Consent {
  start();
  return state;
}

function subscribe(l: () => void) {
  start();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function agreeToAi(now: Date = new Date()): Promise<void> {
  await kvSet(AI_CONSENT_KEY, now.toISOString());
  set('given');
}

export async function forgetAiConsent(): Promise<void> {
  set('needed');
  await kvSet(AI_CONSENT_KEY, null);
}

/** A web dev aid is drawing a screen (see the top): no consent page in the way. */
export function devSkipsConsent(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.get('consent') !== 'ask' && ['as', 'profiles', 'preview'].some((k) => q.has(k));
}

// Read once at startup, like the session's own dev aids (the URL changes as the app navigates).
const SKIP = __DEV__ && Platform.OS === 'web' && devSkipsConsent(globalThis.location?.search ?? '');

export function useAiConsent(): Consent {
  const consent = useSyncExternalStore(subscribe, getAiConsent, getAiConsent);
  return SKIP ? 'given' : consent;
}

/** Screens that work before the yes: signing in, the invite, recipe and dinner links, and the page itself. */
const BEFORE_CONSENT = new Set(['/join', '/join-code', '/i', '/r', '/d', '/consent']);

/** In a family (or showing the last one offline) with no yes yet: the consent page comes first. */
export function consentFirst(consent: Consent, status: SessionStatus, pathname: string): boolean {
  return consent === 'needed' && (status === 'ready' || status === 'offline') && !BEFORE_CONSENT.has(pathname);
}
