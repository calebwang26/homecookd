// @machine
// state-machine-test: app/scripts/test-app-update.mjs
// "Update homecookd" on Home (Caleb, Nov 10: "Also add an update check to 1.1 for next time"): a popup in the middle of
// the screen over blurred glass (Caleb, Nov 10 evening), with a button to the App Store and "Later", shown only when the
// App Store has a newer homecookd than this phone's own build.
//
//   idle     the launch, nothing asked yet. `check` (an iPhone whose own version is known): asking. `skip`: none.
//   asking   one lookup at Apple's public lookup (LOOKUP_URL), once per launch. `newer`: offered. `snoozed` (newer,
//            but "Later" was tapped for this store version under SNOOZE_MS ago): later. `same` (not newer): none.
//            `failed` (offline, slow, bad JSON, an unknown version): none.
//   offered  the popup may show (popupShows, below). `later`: later (the store version and the time are saved: lib/storage kv).
//   later    no card until the next launch after SNOOZE_MS, or a newer store version.
//   none     nothing to offer this launch.
//
// Guards, before the events: only iOS asks; this phone's own version is expo-updates' runtimeVersion, which is the
// native app version under app.json's runtimeVersion policy "appVersion" (an OTA bundle's own config can't be read
// for it). Anything not like 1.2.3 is unknown, and unknown never shows a card.
// The invariant: the popup shows only in `offered`, which only a store version newer than this phone's own reaches,
// so a TestFlight build or one in App Review (newer than the store) never sees it. Nothing waits on the lookup.
// Showing it (popupShows) is not a state of this machine: in `offered`, the popup is up only while its Home is on
// screen, the launch bloom has gone, and no other sheet is up or waiting. It gives way to every other sheet.
import { machine } from './machine';

export const APP_UPDATE_EVENTS = ['check', 'skip', 'newer', 'snoozed', 'same', 'failed', 'later'] as const;
export type AppUpdateEvent = (typeof APP_UPDATE_EVENTS)[number];
export type AppUpdateState = 'idle' | 'asking' | 'offered' | 'later' | 'none';

export const appUpdateMachine = machine<AppUpdateState, AppUpdateEvent>('appUpdate', APP_UPDATE_EVENTS, {
  idle: { check: 'asking', skip: 'none' },
  asking: { newer: 'offered', snoozed: 'later', same: 'none', failed: 'none' },
  offered: { later: 'later' },
  later: {},
  none: {},
});

export const APP_ID = 6825621614;
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_ID}`;
export const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APP_ID}`;
/** Longer than this and the launch goes on without a card. */
export const LOOKUP_TIMEOUT_MS = 5000;
// TODO(caleb): how long "Later" hides the card for the same store version (the Master's default: 7 days).
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** Where the last "Later" is kept (lib/storage kv). */
export const SNOOZE_KEY = 'appUpdate.later';

export type Snooze = { version: string; at: number };

/** "1.10.2" -> [1, 10, 2]; anything else (a fingerprint, "1.1.0-beta", empty) -> null. */
export function parseVersion(v: unknown): number[] | null {
  if (typeof v !== 'string' || !/^\d{1,6}(\.\d{1,6}){0,3}$/.test(v.trim())) return null;
  return v.trim().split('.').map(Number);
}

/** <0, 0 or >0, part by part; a missing part is 0 (1.1 == 1.1.0). Both must parse. */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The App Store's version from Apple's lookup answer, or null when it isn't ours or isn't a version. */
export function storeVersionFrom(json: unknown): string | null {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  const ours = results.find((r) => (r as { trackId?: unknown } | null)?.trackId === APP_ID) as { version?: unknown } | undefined;
  return ours && parseVersion(ours.version) ? String(ours.version).trim() : null;
}

/** One lookup at Apple, never throwing: the store's version, or null (offline, slow, bad JSON, not ours). */
export async function lookupStoreVersion(get: typeof fetch = fetch, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await get(LOOKUP_URL, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return storeVersionFrom(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "Later" still holds: tapped for this store version (or a newer one) under SNOOZE_MS ago. A clock moved back ends it. */
export function snoozed(s: Snooze | null | undefined, store: string, now: number): boolean {
  const said = parseVersion(s?.version);
  const v = parseVersion(store);
  if (!s || !said || !v || typeof s.at !== 'number') return false;
  const age = now - s.at;
  return compareVersions(v, said) <= 0 && age >= 0 && age < SNOOZE_MS;
}

/** What the lookup's answer means for this phone. */
export function lookupEvent(store: string | null, own: string | null, snooze: Snooze | null, now: number): 'newer' | 'snoozed' | 'same' | 'failed' {
  const v = parseVersion(store);
  const mine = parseVersion(own);
  if (!v || !mine) return 'failed';
  if (compareVersions(v, mine) <= 0) return 'same';
  return snoozed(snooze, store!, now) ? 'snoozed' : 'newer';
}

export type CheckDeps = {
  /** Only an iPhone asks the App Store. */
  ios: boolean;
  /** This phone's own build version (expo-updates runtimeVersion). */
  own: string | null;
  lookup: () => Promise<string | null>;
  snooze: () => Promise<Snooze | null>;
  now: () => number;
};

/**
 * The launch's one check, as events: `send` is the held machine's (it says whether the event moved it). A second call
 * in the same launch does nothing, since only `idle` takes `check`. Never throws. Resolves the store's version when
 * the card is offered (for "Later" to save), else null.
 */
export async function runCheck(send: (e: AppUpdateEvent) => boolean, d: CheckDeps): Promise<string | null> {
  if (!d.ios || !parseVersion(d.own)) {
    send('skip');
    return null;
  }
  if (!send('check')) return null;
  let store: string | null = null;
  let snooze: Snooze | null = null;
  try {
    [store, snooze] = await Promise.all([d.lookup(), d.snooze().catch(() => null)]);
  } catch {
    store = null;
  }
  const e = lookupEvent(store, d.own, snooze, d.now());
  send(e);
  return e === 'newer' ? store : null;
}

/** The launch bloom's phases (components/LaunchSplash): its overlay is up in `playing` and `revealing`. */
export type BloomPhase = 'none' | 'playing' | 'revealing' | 'done';

export type PopupScene = {
  state: AppUpdateState;
  /** Its Home is the screen on top (not under a screen a push or a link opened). */
  homeOnScreen: boolean;
  bloom: BloomPhase;
  /** Sheets whose Modal is up (lib/sheets useSheetsUp), the popup's own included once it shows. */
  sheetsUp: number;
  /** Sheets waiting to present (lib/sheets useSheetsHeld). */
  sheetsHeld: number;
};

/**
 * Whether the popup is up now, given whether it was up a moment ago (`wasUp`). It is the lowest of every sheet on
 * Home, so it never races one (#402, #410):
 *  - only in `offered`, on its Home on screen, after the launch bloom (a native Modal would present above it);
 *  - it comes up only when no sheet's Modal is up (one still going away included), as the AI consent ask does;
 *    once up, its own Modal counts there, so that alone never takes it down;
 *  - it goes the moment any sheet is held (one that wants to present: "Dad is on a new phone", the push ask, a
 *    held popup itself), and comes back after that sheet has gone. That isn't a "Later": nothing is saved.
 * No timer: every input is the sheets' own state (lib/sheets/coordinator).
 */
export function popupShows(wasUp: boolean, p: PopupScene): boolean {
  if (p.state !== 'offered' || !p.homeOnScreen) return false;
  if (p.bloom === 'playing' || p.bloom === 'revealing') return false;
  if (p.sheetsHeld > 0) return false;
  return wasUp || p.sheetsUp === 0;
}
