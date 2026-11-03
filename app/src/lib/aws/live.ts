// Live updates on the AWS api (1.1): GET /v1/live/<topic>?since=<version>, polled while someone is watching and
// the app is in front (ACCOUNTS.md, "Live updates"; JOBS.md, "Live topic jobs"). One poller per topic and person,
// shared by every screen that watches it, as a Convex subscription was. A second screen gets the last value at once.
//
// It waits the server's pollAfterMs between polls. A failed poll keeps what's on screen and backs off (retryDelayMs:
// retry-after, else 5 s doubling to 60 s). It stops for good on signed_out, removed_from_family and live_off
// (`onStop` hears which, so the screen can read on focus instead). No stubs: nothing is made up while it waits.
// Pure TS: the app's front/back state comes in through setForeground (lib/aws/foreground.ts wires AppState).

import { request } from './client';
import { isAwsError, retryDelayMs, type AwsError } from './errors';

type Answer<T> = { changed: boolean; version: string; pollAfterMs: number; data?: T };
export type StopReason = 'signed_out' | 'removed_from_family' | 'live_off';

type Watcher = { onData: (v: unknown) => void; onStop?: (why: StopReason) => void };
type Poller = { watchers: Set<Watcher>; value?: unknown; hasValue: boolean; stopped: StopReason | null; kick: () => void; end: () => void };

const pollers = new Map<string, Poller>();

// The app's front/back state; always "in front" until something wires it (tests, the web).
let inFront = () => true;
const frontListeners = new Set<() => void>();
/** lib/aws/foreground.ts calls this with AppState. `changed()` is how it says the app came to the front. */
export function setForeground(isActive: () => boolean): { changed: () => void } {
  inFront = isActive;
  return { changed: () => frontListeners.forEach((f) => f()) };
}

/** Hear the app coming back to the front (the recipes list reads again then). Returns the unsubscribe. */
export function onFront(fn: () => void): () => void {
  frontListeners.add(fn);
  return () => frontListeners.delete(fn);
}

let setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms);
let clearTimer: (t: unknown) => void = (t) => clearTimeout(t as ReturnType<typeof setTimeout>);
/** Tests only: a fake clock. */
export function setLiveTimersForTests(set: typeof setTimer, clear: typeof clearTimer) {
  setTimer = set;
  clearTimer = clear;
}

const STOPS = new Set<string>(['signed_out', 'removed_from_family', 'live_off']);

function startPoller(key: string, topic: string, as: string | null): Poller {
  let since = '';
  let failures = 0;
  let running = false;
  let timer: unknown = null;
  const later = (ms: number) => {
    if (!poller.stopped && poller.watchers.size) timer = setTimer(tick, ms);
  };
  const stopFor = (why: StopReason) => {
    poller.stopped = why;
    poller.watchers.forEach((w) => w.onStop?.(why));
    poller.end();
  };
  const tick = async () => {
    timer = null;
    // In the background: wait. Coming back to the front asks at once (kick).
    if (poller.stopped || running || !poller.watchers.size || !inFront()) return;
    running = true;
    try {
      const a = await request<Answer<unknown>>(`/v1/live/${encodeURIComponent(topic)}?since=${encodeURIComponent(since)}`, { auth: 'session', as });
      failures = 0;
      if (a.changed) {
        since = a.version;
        poller.value = a.data;
        poller.hasValue = true;
        poller.watchers.forEach((w) => w.onData(a.data));
      }
      later(a.pollAfterMs);
    } catch (e) {
      // A session that ended was already started again once inside request(); this is final.
      if (isAwsError(e) && (STOPS.has(e.code) || e.kind === 'signed_out')) return stopFor(e.code === 'live_off' || e.code === 'removed_from_family' ? e.code : 'signed_out');
      later(retryDelayMs(isAwsError(e) ? (e as AwsError) : null, failures++));
    } finally {
      running = false;
    }
  };
  const kick = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    void tick();
  };
  const poller: Poller = {
    watchers: new Set(),
    hasValue: false,
    stopped: null,
    kick,
    end() {
      if (timer != null) clearTimer(timer);
      timer = null;
      frontListeners.delete(kick);
      if (pollers.get(key) === poller) pollers.delete(key);
    },
  };
  frontListeners.add(kick);
  return poller;
}

/**
 * Watch a topic as `as` (default: whoever is using the app). `onData` gets the topic's data each time it changes,
 * and at once if another screen already has it. Returns the way to stop watching; the poll stops with the last watcher.
 */
export function watchTopic<T>(topic: string, onData: (value: T) => void, opts: { as?: string | null; onStop?: (why: StopReason) => void } = {}): () => void {
  const key = `${topic}:${opts.as ?? ''}`;
  let poller = pollers.get(key);
  const fresh = !poller;
  if (!poller) {
    poller = startPoller(key, topic, opts.as ?? null);
    pollers.set(key, poller);
  }
  const w: Watcher = { onData: onData as (v: unknown) => void, onStop: opts.onStop };
  poller.watchers.add(w);
  if (poller.hasValue) onData(poller.value as T);
  if (fresh) poller.kick();
  const p = poller;
  return () => {
    p.watchers.delete(w);
    if (!p.watchers.size) p.end();
  };
}

/** Forget every poller (sign-out, a new key): the next watch starts over. */
/** Read every polled read whose key starts with `prefix` again now (a write just changed what it shows). */
export function kickReads(prefix: string) {
  for (const [key, p] of reads) if (key.startsWith(prefix)) p.kick();
}

export function stopAllPolls() {
  for (const p of [...pollers.values()]) p.end();
  for (const p of [...reads.values()]) p.end();
}

// ---------------------------------------------------------------------------
// Plain reads polled until their topics exist (MESSAGES.md, "Live topics": the inbox, a thread, open questions).
// The same rules as a topic: one shared poll per key, only in front, every `everyMs`; a failure keeps what's on
// screen and backs off; signed_out and removed_from_family stop it. `read` gets the last value (for an `after` cursor).

type ReadPoller<T> = { watchers: Set<(v: T) => void>; value?: T; hasValue: boolean; end: () => void; kick: () => void };
const reads = new Map<string, ReadPoller<unknown>>();

export function watchRead<T>(
  key: string,
  read: (last: T | undefined) => Promise<T>,
  /** A number, or one picked from the last value (a card polls faster while it's merging). */
  every: number | ((v: T) => number),
  onData: (v: T) => void,
): () => void {
  const gap = (v: T | undefined) => (typeof every === 'number' ? every : v === undefined ? 15_000 : every(v));
  let p = reads.get(key) as ReadPoller<T> | undefined;
  if (!p) {
    let timer: unknown = null;
    let failures = 0;
    let running = false;
    let stopped = false;
    const poller: ReadPoller<T> = {
      watchers: new Set(),
      hasValue: false,
      kick: () => {},
      end() {
        stopped = true;
        if (timer != null) clearTimer(timer);
        offFront();
        if (reads.get(key) === poller) reads.delete(key);
      },
    };
    const later = (ms: number) => {
      if (!stopped) timer = setTimer(tick, ms);
    };
    const tick = async () => {
      timer = null;
      if (stopped || running) return;
      if (!inFront()) return; // coming back to the front asks at once
      running = true;
      try {
        const v = await read(poller.hasValue ? poller.value : undefined);
        failures = 0;
        poller.value = v;
        poller.hasValue = true;
        poller.watchers.forEach((w) => w(v));
        later(gap(v));
      } catch (e) {
        if (isAwsError(e) && (e.kind === 'signed_out' || e.code === 'removed_from_family')) return poller.end();
        later(Math.max(gap(poller.value), retryDelayMs(isAwsError(e) ? e : null, failures++)));
      } finally {
        running = false;
      }
    };
    poller.kick = () => {
      if (timer != null) clearTimer(timer);
      timer = null;
      void tick();
    };
    const offFront = onFront(poller.kick);
    p = poller;
    reads.set(key, poller as ReadPoller<unknown>);
    void tick();
  } else if (p.hasValue) {
    onData(p.value as T);
  }
  p.watchers.add(onData);
  const mine = p;
  return () => {
    mine.watchers.delete(onData);
    if (!mine.watchers.size) mine.end();
  };
}

