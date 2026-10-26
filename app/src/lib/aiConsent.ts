// Asking before anything goes to the AI companies (App Store guideline 5.1.2(i)), at first use: the
// first upload, the first filming, the first hands-free cooking, the first spoken answer or dish photo.
// Each of those calls ensureAiConsent() before it sends; the first time, AiConsentHost
// (components/consent) raises a small sheet that names the companies, and only "OK, continue" says yes.
// The yes is kept on this phone only, as the time of the tap, under a versioned key: a new version
// (another company, or another kind of data) asks everyone again. Signing out forgets it, so whoever
// signs in next is asked too. Tested with the phone's storage faked: node scripts/test-consent.mjs.
//
//   if (!(await ensureAiConsent())) return;   true at once after a yes; else the sheet, true on its yes
//   if (!askAiConsentNow()) return;           the same for a touch that can't wait (a hold): false
//                                             until there's a yes, and the sheet rises meanwhile
//   await requireAiConsent();                 the senders' own check: throws without a yes, never asks
//   await hasAiConsent();                     a yes is saved (waits for the read)
//   const consent = useAiConsent();           'loading' | 'needed' | 'given'
//   await forgetAiConsent();                  signing out
import { useSyncExternalStore } from 'react';

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
let read: Promise<void> | null = null;
/** The sheet is up, and who waits on its answer. */
let asking = false;
let waiters: ((yes: boolean) => void)[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(next: Consent) {
  if (state === next) return;
  state = next;
  emit();
}

/** Read the saved yes once per run of the app. A tap or a sign-out meanwhile wins. */
function start(): Promise<void> {
  read ??= readAiConsent().then((saved) => {
    if (state === 'loading') set(saved);
  });
  return read;
}

export function getAiConsent(): Consent {
  void start();
  return state;
}

function subscribe(l: () => void) {
  void start();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAiConsent(): Consent {
  return useSyncExternalStore(subscribe, getAiConsent, getAiConsent);
}

export async function hasAiConsent(): Promise<boolean> {
  await start();
  return state === 'given';
}

export class NoAiConsent extends Error {
  constructor() {
    super('homecookd needs your OK before it uses AI for this.');
  }
}

export async function requireAiConsent(): Promise<void> {
  if (!(await hasAiConsent())) throw new NoAiConsent();
}

export async function ensureAiConsent(): Promise<boolean> {
  if (await hasAiConsent()) return true;
  return new Promise((resolve) => {
    waiters.push(resolve);
    if (!asking) {
      asking = true;
      emit();
    }
  });
}

export function askAiConsentNow(): boolean {
  if (getAiConsent() === 'given') return true;
  void ensureAiConsent();
  return false;
}

function settle(yes: boolean) {
  const waiting = waiters;
  waiters = [];
  asking = false;
  emit();
  for (const w of waiting) w(yes);
}

/** The sheet's answer: "OK, continue" saves the yes first; "Not now" (or closing it) saves nothing. */
export async function answerAiConsent(yes: boolean): Promise<void> {
  if (yes) await agreeToAi();
  settle(yes);
}

export async function agreeToAi(now: Date = new Date()): Promise<void> {
  await kvSet(AI_CONSENT_KEY, now.toISOString());
  set('given');
}

export async function forgetAiConsent(): Promise<void> {
  set('needed');
  if (asking) settle(false);
  await kvSet(AI_CONSENT_KEY, null);
}

export function useAiConsentAsking(): boolean {
  return useSyncExternalStore(subscribe, () => asking, () => asking);
}
